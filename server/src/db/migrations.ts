import { existsSync } from "node:fs";
import { config } from "../config.js";
import type { LogLevel } from "../logger.js";
import { openSqlite, type Db, type Dialect, type SqlParam } from "./driver.js";
import { hashSessionId, seal } from "./secrets.js";

export type Log = (level: LogLevel, message: string) => void;

function schema(dialect: Dialect): string {
  const id = dialect === "postgres" ? "BIGSERIAL PRIMARY KEY" : "INTEGER PRIMARY KEY AUTOINCREMENT";
  return `
  CREATE TABLE IF NOT EXISTS channels (
    login TEXT PRIMARY KEY,
    display_name TEXT NOT NULL,
    overlay_token TEXT NOT NULL UNIQUE,
    created_at BIGINT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS channel_access (
    channel TEXT NOT NULL,
    login TEXT NOT NULL,
    PRIMARY KEY (channel, login)
  );

  CREATE TABLE IF NOT EXISTS channel_modules (
    channel TEXT NOT NULL,
    id TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 0,
    settings TEXT NOT NULL DEFAULT '{}',
    PRIMARY KEY (channel, id)
  );

  CREATE TABLE IF NOT EXISTS channel_settings (
    channel TEXT NOT NULL,
    key TEXT NOT NULL,
    value TEXT NOT NULL,
    PRIMARY KEY (channel, key)
  );

  CREATE TABLE IF NOT EXISTS chatter_counts (
    channel TEXT NOT NULL,
    login TEXT NOT NULL,
    display_name TEXT NOT NULL,
    count BIGINT NOT NULL,
    last_at BIGINT NOT NULL,
    PRIMARY KEY (channel, login)
  );

  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    login TEXT NOT NULL,
    display_name TEXT NOT NULL,
    avatar_url TEXT,
    created_at BIGINT NOT NULL,
    expires_at BIGINT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS stream_events (
    id ${id},
    type TEXT NOT NULL,
    login TEXT NOT NULL,
    display_name TEXT NOT NULL,
    amount BIGINT NOT NULL,
    created_at BIGINT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS stream_events_created ON stream_events (created_at);

  CREATE TABLE IF NOT EXISTS stream_sessions (
    id ${id},
    stream_id TEXT NOT NULL,
    streamer TEXT NOT NULL,
    title TEXT NOT NULL DEFAULT '',
    games TEXT NOT NULL DEFAULT '[]',
    started_at BIGINT NOT NULL,
    last_seen_at BIGINT NOT NULL,
    ended_at BIGINT,
    peak_viewers BIGINT NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'live',
    posted_at BIGINT,
    post_error TEXT
  );

  CREATE TABLE IF NOT EXISTS app_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS giveaways (
    id ${id},
    channel TEXT NOT NULL,
    keyword TEXT NOT NULL,
    follower_only INTEGER NOT NULL DEFAULT 0,
    min_follow_minutes BIGINT NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'open',
    created_at BIGINT NOT NULL,
    ended_at BIGINT
  );
  CREATE INDEX IF NOT EXISTS giveaways_channel ON giveaways (channel, id);

  CREATE TABLE IF NOT EXISTS giveaway_entries (
    giveaway_id BIGINT NOT NULL,
    login TEXT NOT NULL,
    user_id TEXT NOT NULL,
    display_name TEXT NOT NULL,
    followed_at BIGINT,
    entered_at BIGINT NOT NULL,
    won_at BIGINT,
    PRIMARY KEY (giveaway_id, login)
  );

  CREATE TABLE IF NOT EXISTS twitch_tokens (
    login TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    access_token TEXT NOT NULL,
    refresh_token TEXT NOT NULL,
    scopes TEXT NOT NULL DEFAULT '',
    expires_at BIGINT NOT NULL
  );
`;
}

const ADDED_COLUMNS: [table: string, column: string, definition: string][] = [
  ["stream_sessions", "chat_messages", "BIGINT NOT NULL DEFAULT 0"],
  ["stream_sessions", "viewer_sum", "BIGINT NOT NULL DEFAULT 0"],
  ["stream_sessions", "viewer_samples", "BIGINT NOT NULL DEFAULT 0"],
  ["stream_sessions", "followers_start", "BIGINT"],
  ["stream_sessions", "followers_end", "BIGINT"],
  ["stream_sessions", "channel", "TEXT NOT NULL DEFAULT ''"],
  ["stream_events", "channel", "TEXT NOT NULL DEFAULT ''"],
  ["sessions", "channel", "TEXT NOT NULL DEFAULT ''"],
  ["giveaways", "entry_mode", "TEXT NOT NULL DEFAULT 'chat'"],
  ["giveaways", "reward_id", "TEXT"],
  ["giveaways", "reward_title", "TEXT"],
  ["giveaways", "reward_cost", "BIGINT"],
  ["giveaways", "max_tickets", "BIGINT NOT NULL DEFAULT 1"],
  ["giveaways", "sub_only", "INTEGER NOT NULL DEFAULT 0"],
  ["giveaways", "sub_multiplier", "BIGINT NOT NULL DEFAULT 1"],
  ["giveaway_entries", "tickets", "BIGINT NOT NULL DEFAULT 1"],
  ["giveaway_entries", "subscriber", "INTEGER NOT NULL DEFAULT 0"],
];

const INDEXES = [
  "CREATE INDEX IF NOT EXISTS stream_events_channel ON stream_events (channel, created_at)",
  "CREATE INDEX IF NOT EXISTS stream_sessions_channel ON stream_sessions (channel, started_at)",
  "CREATE INDEX IF NOT EXISTS channel_access_login ON channel_access (login)",
];

async function tableExists(target: Db, name: string): Promise<boolean> {
  if (target.dialect === "postgres") {
    const row = await target.get<{ name: string | null }>("SELECT to_regclass(?)::text AS name", [name]);
    return Boolean(row?.name);
  }
  return Boolean(await target.get("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?", [name]));
}

export function legacyChannel(): string {
  return config.ownChannel ?? config.ownerLogins[0];
}

async function adoptSingleChannelData(target: Db, owner: string): Promise<void> {
  const statements: [string, SqlParam[]][] = [];

  if (await tableExists(target, "modules")) {
    statements.push(
      [
        `INSERT INTO channel_modules (channel, id, enabled, settings)
         SELECT ?, id, enabled, settings FROM modules WHERE true ON CONFLICT DO NOTHING`,
        [owner],
      ],
      ["DROP TABLE modules", []]
    );
  }

  if (await tableExists(target, "top_chatters")) {
    statements.push(
      [
        `INSERT INTO chatter_counts (channel, login, display_name, count, last_at)
         SELECT ?, login, display_name, count, last_at FROM top_chatters WHERE true ON CONFLICT DO NOTHING`,
        [owner],
      ],
      ["DROP TABLE top_chatters", []]
    );
  }

  const legacyToken = await target.get<{ value: string }>("SELECT value FROM app_settings WHERE key = 'overlay_token'");
  if (legacyToken) {
    statements.push(
      [
        `INSERT INTO channels (login, display_name, overlay_token, created_at) VALUES (?, ?, ?, ?)
         ON CONFLICT DO NOTHING`,
        [owner, owner, legacyToken.value, Date.now()],
      ],
      ["DELETE FROM app_settings WHERE key = 'overlay_token'", []]
    );
  }

  const chatterSession = await target.get<{ value: string }>(
    "SELECT value FROM app_settings WHERE key = 'top_chatter_session'"
  );
  if (chatterSession) {
    statements.push(
      [
        "INSERT INTO channel_settings (channel, key, value) VALUES (?, 'top_chatter_session', ?) ON CONFLICT DO NOTHING",
        [owner, chatterSession.value],
      ],
      ["DELETE FROM app_settings WHERE key = 'top_chatter_session'", []]
    );
  }

  statements.push(
    ["UPDATE stream_events SET channel = ? WHERE channel = ''", [owner]],
    ["UPDATE stream_sessions SET channel = ? WHERE channel = ''", [owner]],
    ["DELETE FROM sessions WHERE channel = ''", []]
  );

  await target.batch(statements);
}

export async function migrate(target: Db): Promise<void> {
  await target.exec(schema(target.dialect));
  for (const [table, column, definition] of ADDED_COLUMNS) {
    if (target.dialect === "postgres") {
      await target.exec(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS ${column} ${definition}`);
      continue;
    }
    const columns = await target.all<{ name: string }>(`PRAGMA table_info(${table})`);
    if (!columns.some((c) => c.name === column)) {
      await target.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    }
  }
  for (const index of INDEXES) await target.exec(index);
  await adoptSingleChannelData(target, legacyChannel());
}

const COPY_TABLES: Record<string, string[]> = {
  channels: ["login", "display_name", "overlay_token", "created_at"],
  channel_access: ["channel", "login"],
  channel_modules: ["channel", "id", "enabled", "settings"],
  channel_settings: ["channel", "key", "value"],
  chatter_counts: ["channel", "login", "display_name", "count", "last_at"],
  sessions: ["id", "user_id", "login", "display_name", "avatar_url", "created_at", "expires_at", "channel"],
  stream_events: ["id", "channel", "type", "login", "display_name", "amount", "created_at"],
  stream_sessions: [
    "id",
    "channel",
    "stream_id",
    "streamer",
    "title",
    "games",
    "started_at",
    "last_seen_at",
    "ended_at",
    "peak_viewers",
    "status",
    "posted_at",
    "post_error",
    "chat_messages",
    "viewer_sum",
    "viewer_samples",
    "followers_start",
    "followers_end",
  ],
  giveaways: [
    "id",
    "channel",
    "keyword",
    "follower_only",
    "min_follow_minutes",
    "status",
    "created_at",
    "ended_at",
    "entry_mode",
    "reward_id",
    "reward_title",
    "reward_cost",
    "max_tickets",
    "sub_only",
    "sub_multiplier",
  ],
  giveaway_entries: [
    "giveaway_id",
    "login",
    "user_id",
    "display_name",
    "followed_at",
    "entered_at",
    "won_at",
    "tickets",
    "subscriber",
  ],
  app_settings: ["key", "value"],
  twitch_tokens: ["login", "user_id", "access_token", "refresh_token", "scopes", "expires_at"],
};

const IMPORTED_KEY = "imported_from_sqlite";

export async function importFromSqlite(target: Db, sqlitePath: string, log: Log): Promise<void> {
  if (await target.get("SELECT value FROM app_settings WHERE key = ?", [IMPORTED_KEY])) return;

  const markDone = () =>
    target.run("INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO NOTHING", [
      IMPORTED_KEY,
      new Date().toISOString(),
    ]);

  const used = await target.get<{ n: number }>(
    "SELECT (SELECT COUNT(*) FROM channel_modules) + (SELECT COUNT(*) FROM stream_sessions) AS n"
  );
  if (!existsSync(sqlitePath) || (used?.n ?? 0) > 0) {
    await markDone();
    return;
  }

  const source = openSqlite(sqlitePath);
  try {
    await migrate(source);
    const statements: [string, SqlParam[]][] = [];
    let rows = 0;
    for (const [table, columns] of Object.entries(COPY_TABLES)) {
      const data = await source.all<Record<string, SqlParam>>(`SELECT ${columns.join(", ")} FROM ${table}`);
      const insert = `INSERT INTO ${table} (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")})
        ON CONFLICT DO NOTHING`;
      for (const row of data) statements.push([insert, columns.map((c) => row[c] ?? null)]);
      rows += data.length;
    }
    for (const table of ["stream_events", "stream_sessions", "giveaways"]) {
      statements.push([
        `SELECT setval(pg_get_serial_sequence('${table}', 'id'), COALESCE((SELECT MAX(id) FROM ${table}), 0) + 1, false)`,
        [],
      ]);
    }
    statements.push(["INSERT INTO app_settings (key, value) VALUES (?, ?)", [IMPORTED_KEY, new Date().toISOString()]]);
    await target.batch(statements);
    log("info", `${rows} Einträge aus der lokalen Datenbank nach Postgres übernommen`);
  } finally {
    await source.close();
  }
}

export async function backupBeforeUpgrade(target: Db, path: string, log: Log): Promise<void> {
  if (!(await tableExists(target, "modules"))) return;
  const backup = path.replace(/(\.db)?$/, ".vor-umbau.db");
  if (existsSync(backup)) return;
  await target.exec(`VACUUM INTO '${backup.replace(/'/g, "''")}'`);
  log("info", `Sicherung der alten Datenbank: ${backup}`);
}

const SESSIONS_HASHED_KEY = "sessions_hashed";

export async function hashStoredSessions(target: Db): Promise<void> {
  if (await target.get("SELECT value FROM app_settings WHERE key = ?", [SESSIONS_HASHED_KEY])) return;
  const rows = await target.all<{ id: string }>("SELECT id FROM sessions");
  const statements: [string, SqlParam[]][] = rows.map((r) => [
    "UPDATE sessions SET id = ? WHERE id = ?",
    [hashSessionId(r.id), r.id],
  ]);
  statements.push([
    "INSERT INTO app_settings (key, value) VALUES (?, ?)",
    [SESSIONS_HASHED_KEY, new Date().toISOString()],
  ]);
  await target.batch(statements);
}

export async function sealStoredTokens(target: Db): Promise<void> {
  const rows = await target.all<{ login: string; access_token: string; refresh_token: string }>(
    "SELECT login, access_token, refresh_token FROM twitch_tokens WHERE access_token NOT LIKE 'v1:%'"
  );
  if (rows.length === 0) return;
  await target.batch(
    rows.map((r) => [
      "UPDATE twitch_tokens SET access_token = ?, refresh_token = ? WHERE login = ?",
      [seal(r.access_token), seal(r.refresh_token), r.login],
    ])
  );
}
