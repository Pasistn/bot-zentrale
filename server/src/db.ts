import { randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { config } from "./config.js";
import { openPostgres, openSqlite, type Db, type Dialect, type SqlParam } from "./db/driver.js";
import type { LogLevel } from "./logger.js";

let db: Db;

type Log = (level: LogLevel, message: string) => void;

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

function newOverlayToken(): string {
  return randomBytes(24).toString("base64url");
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

async function migrate(target: Db): Promise<void> {
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
    "id", "channel", "stream_id", "streamer", "title", "games", "started_at", "last_seen_at", "ended_at",
    "peak_viewers", "status", "posted_at", "post_error", "chat_messages", "viewer_sum", "viewer_samples",
    "followers_start", "followers_end",
  ],
  giveaways: ["id", "channel", "keyword", "follower_only", "min_follow_minutes", "status", "created_at", "ended_at"],
  giveaway_entries: ["giveaway_id", "login", "user_id", "display_name", "followed_at", "entered_at", "won_at"],
  app_settings: ["key", "value"],
  twitch_tokens: ["login", "user_id", "access_token", "refresh_token", "scopes", "expires_at"],
};

const IMPORTED_KEY = "imported_from_sqlite";

async function importFromSqlite(target: Db, sqlitePath: string, log: Log): Promise<void> {
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

async function backupBeforeUpgrade(target: Db, path: string, log: Log): Promise<void> {
  if (!(await tableExists(target, "modules"))) return;
  const backup = path.replace(/(\.db)?$/, ".vor-umbau.db");
  if (existsSync(backup)) return;
  await target.exec(`VACUUM INTO '${backup.replace(/'/g, "''")}'`);
  log("info", `Sicherung der alten Datenbank: ${backup}`);
}

export async function initDb(log: Log): Promise<void> {
  if (config.databaseUrl) {
    const ca = config.databaseCaPath ? readFileSync(config.databaseCaPath, "utf8") : null;
    db = await openPostgres(config.databaseUrl, ca, (message) => log("warn", message));
    await migrate(db);
    await importFromSqlite(db, config.dbPath, log);
    log("info", "Datenbank: Postgres");
  } else {
    db = openSqlite(config.dbPath);
    await backupBeforeUpgrade(db, config.dbPath, log);
    await migrate(db);
    log("info", `Datenbank: ${config.dbPath}`);
  }
  await channelStore.load();
  await accessStore.load();
  await moduleStore.load();
}

export async function closeDb(): Promise<void> {
  await db?.close();
}

export interface Channel {
  login: string;
  displayName: string;
  overlayToken: string;
  createdAt: number;
}

const channels = new Map<string, Channel>();
const channelsByToken = new Map<string, string>();

function cacheChannel(channel: Channel): void {
  const previous = channels.get(channel.login);
  if (previous) channelsByToken.delete(previous.overlayToken);
  channels.set(channel.login, channel);
  channelsByToken.set(channel.overlayToken, channel.login);
}

export const channelStore = {
  async load(): Promise<void> {
    channels.clear();
    channelsByToken.clear();
    const rows = await db.all<{ login: string; display_name: string; overlay_token: string; created_at: number }>(
      "SELECT login, display_name, overlay_token, created_at FROM channels"
    );
    for (const r of rows) {
      cacheChannel({ login: r.login, displayName: r.display_name, overlayToken: r.overlay_token, createdAt: r.created_at });
    }
  },

  list(): Channel[] {
    return [...channels.values()].sort((a, b) => a.login.localeCompare(b.login));
  },

  get(login: string): Channel | null {
    return channels.get(login) ?? null;
  },

  byOverlayToken(token: string): Channel | null {
    const login = channelsByToken.get(token);
    return login ? channels.get(login) ?? null : null;
  },

  async add(login: string, displayName: string): Promise<Channel> {
    const existing = channels.get(login);
    if (existing) return existing;
    const channel: Channel = { login, displayName, overlayToken: newOverlayToken(), createdAt: Date.now() };
    await db.run(
      "INSERT INTO channels (login, display_name, overlay_token, created_at) VALUES (?, ?, ?, ?)",
      [channel.login, channel.displayName, channel.overlayToken, channel.createdAt]
    );
    cacheChannel(channel);
    return channel;
  },

  async remove(login: string): Promise<void> {
    await db.run("DELETE FROM channels WHERE login = ?", [login]);
    const channel = channels.get(login);
    if (channel) channelsByToken.delete(channel.overlayToken);
    channels.delete(login);
  },

  async setDisplayName(login: string, displayName: string): Promise<void> {
    const channel = channels.get(login);
    if (!channel || channel.displayName === displayName) return;
    await db.run("UPDATE channels SET display_name = ? WHERE login = ?", [displayName, login]);
    cacheChannel({ ...channel, displayName });
  },

  async renewToken(login: string): Promise<string> {
    const channel = channels.get(login);
    if (!channel) throw new Error(`Kanal ${login} gibt es nicht.`);
    const token = newOverlayToken();
    await db.run("UPDATE channels SET overlay_token = ? WHERE login = ?", [token, login]);
    cacheChannel({ ...channel, overlayToken: token });
    return token;
  },
};

const access = new Map<string, Set<string>>();

export const accessStore = {
  async load(): Promise<void> {
    access.clear();
    const rows = await db.all<{ channel: string; login: string }>("SELECT channel, login FROM channel_access");
    for (const r of rows) {
      const set = access.get(r.channel) ?? new Set<string>();
      set.add(r.login);
      access.set(r.channel, set);
    }
  },

  list(channel: string): string[] {
    return [...(access.get(channel) ?? [])].sort();
  },

  has(channel: string, login: string): boolean {
    return access.get(channel)?.has(login) ?? false;
  },

  channelsOf(login: string): string[] {
    return [...access].filter(([, logins]) => logins.has(login)).map(([channel]) => channel);
  },

  async add(channel: string, login: string): Promise<void> {
    await db.run("INSERT INTO channel_access (channel, login) VALUES (?, ?) ON CONFLICT DO NOTHING", [channel, login]);
    const set = access.get(channel) ?? new Set<string>();
    set.add(login);
    access.set(channel, set);
  },

  async remove(channel: string, login: string): Promise<void> {
    await db.run("DELETE FROM channel_access WHERE channel = ? AND login = ?", [channel, login]);
    access.get(channel)?.delete(login);
  },
};

async function getChannelSetting(channel: string, key: string): Promise<string | null> {
  const row = await db.get<{ value: string }>("SELECT value FROM channel_settings WHERE channel = ? AND key = ?", [
    channel,
    key,
  ]);
  return row?.value ?? null;
}

async function setChannelSetting(channel: string, key: string, value: string): Promise<void> {
  await db.run(
    `INSERT INTO channel_settings (channel, key, value) VALUES (?, ?, ?)
     ON CONFLICT(channel, key) DO UPDATE SET value = excluded.value`,
    [channel, key, value]
  );
}

export interface StoredModule {
  enabled: boolean;
  settings: Record<string, unknown>;
}

const moduleCache = new Map<string, StoredModule>();
const moduleKey = (channel: string, id: string) => `${channel}/${id}`;

export const moduleStore = {
  async load(): Promise<void> {
    moduleCache.clear();
    const rows = await db.all<{ channel: string; id: string; enabled: number; settings: string }>(
      "SELECT channel, id, enabled, settings FROM channel_modules"
    );
    for (const row of rows) {
      let settings: Record<string, unknown> = {};
      try {
        settings = JSON.parse(row.settings);
      } catch {
        settings = {};
      }
      moduleCache.set(moduleKey(row.channel, row.id), { enabled: Number(row.enabled) === 1, settings });
    }
  },

  get(channel: string, id: string): StoredModule {
    return moduleCache.get(moduleKey(channel, id)) ?? { enabled: false, settings: {} };
  },

  async setEnabled(channel: string, id: string, enabled: boolean): Promise<void> {
    await db.run(
      `INSERT INTO channel_modules (channel, id, enabled) VALUES (?, ?, ?)
       ON CONFLICT(channel, id) DO UPDATE SET enabled = excluded.enabled`,
      [channel, id, enabled ? 1 : 0]
    );
    moduleCache.set(moduleKey(channel, id), { ...this.get(channel, id), enabled });
  },

  async setSettings(channel: string, id: string, settings: Record<string, unknown>): Promise<void> {
    await db.run(
      `INSERT INTO channel_modules (channel, id, settings) VALUES (?, ?, ?)
       ON CONFLICT(channel, id) DO UPDATE SET settings = excluded.settings`,
      [channel, id, JSON.stringify(settings)]
    );
    moduleCache.set(moduleKey(channel, id), { ...this.get(channel, id), settings });
  },
};

export interface StoredChatter {
  login: string;
  displayName: string;
  count: number;
  lastAt: number;
}

const TOP_CHATTER_SESSION_KEY = "top_chatter_session";

export const topChatterStore = {
  async all(channel: string): Promise<StoredChatter[]> {
    const rows = await db.all<{ login: string; display_name: string; count: number; last_at: number }>(
      "SELECT login, display_name, count, last_at FROM chatter_counts WHERE channel = ?",
      [channel]
    );
    return rows.map((r) => ({ login: r.login, displayName: r.display_name, count: r.count, lastAt: r.last_at }));
  },

  async save(channel: string, chatters: StoredChatter[]): Promise<void> {
    const upsert = `INSERT INTO chatter_counts (channel, login, display_name, count, last_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(channel, login) DO UPDATE SET
         display_name = excluded.display_name, count = excluded.count, last_at = excluded.last_at`;
    await db.batch(chatters.map((c) => [upsert, [channel, c.login, c.displayName, c.count, c.lastAt]]));
  },

  async clear(channel: string): Promise<void> {
    await db.run("DELETE FROM chatter_counts WHERE channel = ?", [channel]);
  },

  async getSessionId(channel: string): Promise<number | null> {
    const raw = await getChannelSetting(channel, TOP_CHATTER_SESSION_KEY);
    return raw === null ? null : Number(raw);
  },

  async setSessionId(channel: string, id: number): Promise<void> {
    await setChannelSetting(channel, TOP_CHATTER_SESSION_KEY, String(id));
  },
};

export type StreamEventType = "raid" | "gift" | "sub" | "cheer";

export interface StreamEvent {
  type: StreamEventType;
  login: string;
  displayName: string;
  amount: number;
  createdAt: number;
}

export const streamEventStore = {
  async add(channel: string, event: Omit<StreamEvent, "createdAt">, createdAt = Date.now()): Promise<void> {
    await db.run(
      "INSERT INTO stream_events (channel, type, login, display_name, amount, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      [channel, event.type, event.login, event.displayName, event.amount, createdAt]
    );
  },

  async between(channel: string, from: number, to: number): Promise<StreamEvent[]> {
    const rows = await db.all<{
      type: StreamEventType;
      login: string;
      display_name: string;
      amount: number;
      created_at: number;
    }>(
      `SELECT type, login, display_name, amount, created_at FROM stream_events
       WHERE channel = ? AND created_at >= ? AND created_at <= ? ORDER BY created_at`,
      [channel, from, to]
    );
    return rows.map((r) => ({
      type: r.type,
      login: r.login,
      displayName: r.display_name,
      amount: r.amount,
      createdAt: r.created_at,
    }));
  },

  async purgeBefore(time: number): Promise<number> {
    return db.run("DELETE FROM stream_events WHERE created_at < ?", [time]);
  },
};

export type StreamSessionStatus = "live" | "pending" | "posted" | "discarded";

export interface StreamSession {
  id: number;
  channel: string;
  streamId: string;
  streamer: string;
  title: string;
  games: string[];
  startedAt: number;
  lastSeenAt: number;
  endedAt: number | null;
  peakViewers: number;
  chatMessages: number;
  viewerSum: number;
  viewerSamples: number;
  followersStart: number | null;
  followersEnd: number | null;
  status: StreamSessionStatus;
  postedAt: number | null;
  postError: string | null;
}

interface StreamSessionRow {
  id: number;
  channel: string;
  stream_id: string;
  streamer: string;
  title: string;
  games: string;
  started_at: number;
  last_seen_at: number;
  ended_at: number | null;
  peak_viewers: number;
  chat_messages: number;
  viewer_sum: number;
  viewer_samples: number;
  followers_start: number | null;
  followers_end: number | null;
  status: StreamSessionStatus;
  posted_at: number | null;
  post_error: string | null;
}

function toStreamSession(row: StreamSessionRow): StreamSession {
  let games: string[] = [];
  try {
    games = JSON.parse(row.games);
  } catch {
    games = [];
  }
  return {
    id: Number(row.id),
    channel: row.channel,
    streamId: row.stream_id,
    streamer: row.streamer,
    title: row.title,
    games,
    startedAt: row.started_at,
    lastSeenAt: row.last_seen_at,
    endedAt: row.ended_at,
    peakViewers: row.peak_viewers,
    chatMessages: row.chat_messages ?? 0,
    viewerSum: row.viewer_sum ?? 0,
    viewerSamples: row.viewer_samples ?? 0,
    followersStart: row.followers_start,
    followersEnd: row.followers_end,
    status: row.status,
    postedAt: row.posted_at,
    postError: row.post_error,
  };
}

export const streamSessionStore = {
  async get(channel: string, id: number): Promise<StreamSession | null> {
    const row = await db.get<StreamSessionRow>("SELECT * FROM stream_sessions WHERE channel = ? AND id = ?", [
      channel,
      id,
    ]);
    return row ? toStreamSession(row) : null;
  },

  async live(channel: string): Promise<StreamSession | null> {
    const row = await db.get<StreamSessionRow>(
      "SELECT * FROM stream_sessions WHERE channel = ? AND status = 'live' ORDER BY id DESC LIMIT 1",
      [channel]
    );
    return row ? toStreamSession(row) : null;
  },

  async recent(channel: string, limit: number): Promise<StreamSession[]> {
    const rows = await db.all<StreamSessionRow>(
      "SELECT * FROM stream_sessions WHERE channel = ? ORDER BY started_at DESC LIMIT ?",
      [channel, limit]
    );
    return rows.map(toStreamSession);
  },

  async open(input: {
    channel: string;
    streamId: string;
    streamer: string;
    title: string;
    game: string;
    startedAt: number;
    viewers: number;
    followers: number | null;
  }): Promise<StreamSession> {
    const row = await db.get<{ id: number }>(
      `INSERT INTO stream_sessions
         (channel, stream_id, streamer, title, games, started_at, last_seen_at, peak_viewers, viewer_sum,
          viewer_samples, followers_start, followers_end)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
       RETURNING id`,
      [
        input.channel,
        input.streamId,
        input.streamer,
        input.title,
        JSON.stringify(input.game ? [input.game] : []),
        input.startedAt,
        Date.now(),
        input.viewers,
        input.viewers,
        input.followers,
        input.followers,
      ]
    );
    return (await this.get(input.channel, Number(row!.id)))!;
  },

  async seen(
    session: StreamSession,
    input: { streamId: string; title: string; game: string; viewers: number; followers: number | null }
  ): Promise<void> {
    const games = input.game && !session.games.includes(input.game) ? [...session.games, input.game] : session.games;
    await db.run(
      `UPDATE stream_sessions
       SET stream_id = ?, title = ?, games = ?, last_seen_at = ?,
           peak_viewers = CASE WHEN peak_viewers > ? THEN peak_viewers ELSE ? END,
           viewer_sum = viewer_sum + ?, viewer_samples = viewer_samples + 1,
           followers_start = COALESCE(followers_start, ?),
           followers_end = COALESCE(?, followers_end)
       WHERE id = ?`,
      [
        input.streamId,
        input.title,
        JSON.stringify(games),
        Date.now(),
        input.viewers,
        input.viewers,
        input.viewers,
        input.followers,
        input.followers,
        session.id,
      ]
    );
  },

  async addMessageCount(id: number, count: number): Promise<void> {
    await db.run("UPDATE stream_sessions SET chat_messages = chat_messages + ? WHERE id = ? AND status = 'live'", [
      count,
      id,
    ]);
  },

  async end(id: number, endedAt: number): Promise<void> {
    await db.run("UPDATE stream_sessions SET ended_at = ?, status = 'pending' WHERE id = ? AND status = 'live'", [
      endedAt,
      id,
    ]);
  },

  async markPosted(id: number): Promise<void> {
    await db.run("UPDATE stream_sessions SET status = 'posted', posted_at = ?, post_error = NULL WHERE id = ?", [
      Date.now(),
      id,
    ]);
  },

  async markFailed(id: number, error: string): Promise<void> {
    await db.run("UPDATE stream_sessions SET post_error = ? WHERE id = ?", [error, id]);
  },

  async markDiscarded(id: number): Promise<void> {
    await db.run("UPDATE stream_sessions SET status = 'discarded', post_error = NULL WHERE id = ?", [id]);
  },
};

export interface SessionUser {
  id: string;
  login: string;
  displayName: string;
  avatarUrl: string | null;
}

export interface Session {
  user: SessionUser;
  channel: string;
}

export const sessionStore = {
  async create(sessionId: string, user: SessionUser, channel: string, expiresAt: number): Promise<void> {
    await db.run(
      `INSERT INTO sessions (id, user_id, login, display_name, avatar_url, channel, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [sessionId, user.id, user.login, user.displayName, user.avatarUrl, channel, Date.now(), expiresAt]
    );
  },

  async get(sessionId: string): Promise<Session | null> {
    const row = await db.get<{
      user_id: string;
      login: string;
      display_name: string;
      avatar_url: string | null;
      channel: string;
      expires_at: number;
    }>("SELECT user_id, login, display_name, avatar_url, channel, expires_at FROM sessions WHERE id = ?", [sessionId]);
    if (!row) return null;
    if (row.expires_at < Date.now()) {
      await this.delete(sessionId);
      return null;
    }
    return {
      user: { id: row.user_id, login: row.login, displayName: row.display_name, avatarUrl: row.avatar_url },
      channel: row.channel,
    };
  },

  async setChannel(sessionId: string, channel: string): Promise<void> {
    await db.run("UPDATE sessions SET channel = ? WHERE id = ?", [channel, sessionId]);
  },

  async delete(sessionId: string): Promise<void> {
    await db.run("DELETE FROM sessions WHERE id = ?", [sessionId]);
  },

  async purgeExpired(): Promise<number> {
    return db.run("DELETE FROM sessions WHERE expires_at < ?", [Date.now()]);
  },
};

export interface TwitchToken {
  login: string;
  userId: string;
  accessToken: string;
  refreshToken: string;
  scopes: string[];
  expiresAt: number;
}

export const twitchTokenStore = {
  async get(channel: string): Promise<TwitchToken | null> {
    const row = await db.get<{
      login: string;
      user_id: string;
      access_token: string;
      refresh_token: string;
      scopes: string;
      expires_at: number;
    }>("SELECT * FROM twitch_tokens WHERE login = ?", [channel]);
    if (!row) return null;
    return {
      login: row.login,
      userId: row.user_id,
      accessToken: row.access_token,
      refreshToken: row.refresh_token,
      scopes: row.scopes.split(" ").filter(Boolean),
      expiresAt: row.expires_at,
    };
  },

  async save(token: TwitchToken): Promise<void> {
    await db.run(
      `INSERT INTO twitch_tokens (login, user_id, access_token, refresh_token, scopes, expires_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(login) DO UPDATE SET
         user_id = excluded.user_id, access_token = excluded.access_token, refresh_token = excluded.refresh_token,
         scopes = excluded.scopes, expires_at = excluded.expires_at`,
      [token.login, token.userId, token.accessToken, token.refreshToken, token.scopes.join(" "), token.expiresAt]
    );
  },

  async delete(channel: string): Promise<void> {
    await db.run("DELETE FROM twitch_tokens WHERE login = ?", [channel]);
  },
};

export type GiveawayStatus = "open" | "closed" | "ended";

export interface Giveaway {
  id: number;
  channel: string;
  keyword: string;
  followerOnly: boolean;
  minFollowMinutes: number;
  status: GiveawayStatus;
  createdAt: number;
  endedAt: number | null;
}

export interface GiveawayEntry {
  login: string;
  userId: string;
  displayName: string;
  followedAt: number | null;
  enteredAt: number;
  wonAt: number | null;
}

interface GiveawayRow {
  id: number;
  channel: string;
  keyword: string;
  follower_only: number;
  min_follow_minutes: number;
  status: GiveawayStatus;
  created_at: number;
  ended_at: number | null;
}

interface GiveawayEntryRow {
  login: string;
  user_id: string;
  display_name: string;
  followed_at: number | null;
  entered_at: number;
  won_at: number | null;
}

const toGiveaway = (r: GiveawayRow): Giveaway => ({
  id: Number(r.id),
  channel: r.channel,
  keyword: r.keyword,
  followerOnly: Number(r.follower_only) === 1,
  minFollowMinutes: Number(r.min_follow_minutes),
  status: r.status,
  createdAt: r.created_at,
  endedAt: r.ended_at,
});

const toEntry = (r: GiveawayEntryRow): GiveawayEntry => ({
  login: r.login,
  userId: r.user_id,
  displayName: r.display_name,
  followedAt: r.followed_at,
  enteredAt: r.entered_at,
  wonAt: r.won_at,
});

export const giveawayStore = {
  async current(channel: string): Promise<Giveaway | null> {
    const row = await db.get<GiveawayRow>(
      "SELECT * FROM giveaways WHERE channel = ? AND status <> 'ended' ORDER BY id DESC LIMIT 1",
      [channel]
    );
    return row ? toGiveaway(row) : null;
  },

  async create(
    channel: string,
    input: { keyword: string; followerOnly: boolean; minFollowMinutes: number }
  ): Promise<Giveaway> {
    const row = await db.get<GiveawayRow>(
      `INSERT INTO giveaways (channel, keyword, follower_only, min_follow_minutes, status, created_at)
       VALUES (?, ?, ?, ?, 'open', ?) RETURNING *`,
      [channel, input.keyword, input.followerOnly ? 1 : 0, input.minFollowMinutes, Date.now()]
    );
    return toGiveaway(row!);
  },

  async setStatus(id: number, status: GiveawayStatus): Promise<void> {
    await db.run("UPDATE giveaways SET status = ?, ended_at = ? WHERE id = ?", [
      status,
      status === "ended" ? Date.now() : null,
      id,
    ]);
  },

  async entries(id: number): Promise<GiveawayEntry[]> {
    const rows = await db.all<GiveawayEntryRow>(
      "SELECT login, user_id, display_name, followed_at, entered_at, won_at FROM giveaway_entries WHERE giveaway_id = ? ORDER BY entered_at",
      [id]
    );
    return rows.map(toEntry);
  },

  async addEntry(id: number, entry: Omit<GiveawayEntry, "wonAt">): Promise<boolean> {
    const changed = await db.run(
      `INSERT INTO giveaway_entries (giveaway_id, login, user_id, display_name, followed_at, entered_at)
       VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING`,
      [id, entry.login, entry.userId, entry.displayName, entry.followedAt, entry.enteredAt]
    );
    return changed > 0;
  },

  async removeEntry(id: number, login: string): Promise<void> {
    await db.run("DELETE FROM giveaway_entries WHERE giveaway_id = ? AND login = ?", [id, login]);
  },

  async markWinner(id: number, login: string): Promise<void> {
    await db.run("UPDATE giveaway_entries SET won_at = ? WHERE giveaway_id = ? AND login = ?", [Date.now(), id, login]);
  },

  async recentWinners(channel: string, limit: number): Promise<(GiveawayEntry & { keyword: string })[]> {
    const rows = await db.all<GiveawayEntryRow & { keyword: string }>(
      `SELECT e.login, e.user_id, e.display_name, e.followed_at, e.entered_at, e.won_at, g.keyword
       FROM giveaway_entries e JOIN giveaways g ON g.id = e.giveaway_id
       WHERE g.channel = ? AND e.won_at IS NOT NULL ORDER BY e.won_at DESC LIMIT ?`,
      [channel, limit]
    );
    return rows.map((r) => ({ ...toEntry(r), keyword: r.keyword }));
  },
};
