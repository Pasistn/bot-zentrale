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
  CREATE TABLE IF NOT EXISTS modules (
    id TEXT PRIMARY KEY,
    enabled INTEGER NOT NULL DEFAULT 0,
    settings TEXT NOT NULL DEFAULT '{}'
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

  CREATE TABLE IF NOT EXISTS top_chatters (
    login TEXT PRIMARY KEY,
    display_name TEXT NOT NULL,
    count BIGINT NOT NULL,
    last_at BIGINT NOT NULL
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
];

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
}

const COPY_TABLES: Record<string, string[]> = {
  modules: ["id", "enabled", "settings"],
  sessions: ["id", "user_id", "login", "display_name", "avatar_url", "created_at", "expires_at"],
  stream_events: ["id", "type", "login", "display_name", "amount", "created_at"],
  stream_sessions: [
    "id", "stream_id", "streamer", "title", "games", "started_at", "last_seen_at", "ended_at", "peak_viewers",
    "status", "posted_at", "post_error", "chat_messages", "viewer_sum", "viewer_samples", "followers_start",
    "followers_end",
  ],
  app_settings: ["key", "value"],
  top_chatters: ["login", "display_name", "count", "last_at"],
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
    "SELECT (SELECT COUNT(*) FROM modules) + (SELECT COUNT(*) FROM stream_sessions) AS n"
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
      const insert = `INSERT INTO ${table} (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`;
      for (const row of data) statements.push([insert, columns.map((c) => row[c] ?? null)]);
      rows += data.length;
    }
    for (const table of ["stream_events", "stream_sessions"]) {
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

export async function initDb(log: Log): Promise<void> {
  if (config.databaseUrl) {
    const ca = config.databaseCaPath ? readFileSync(config.databaseCaPath, "utf8") : null;
    db = await openPostgres(config.databaseUrl, ca, (message) => log("warn", message));
    await migrate(db);
    await importFromSqlite(db, config.dbPath, log);
    log("info", "Datenbank: Postgres");
  } else {
    db = openSqlite(config.dbPath);
    await migrate(db);
    log("info", `Datenbank: ${config.dbPath}`);
  }
  await moduleStore.load();
  await overlayTokenStore.load();
}

export async function closeDb(): Promise<void> {
  await db?.close();
}

async function getAppSetting(key: string): Promise<string | null> {
  const row = await db.get<{ value: string }>("SELECT value FROM app_settings WHERE key = ?", [key]);
  return row?.value ?? null;
}

async function setAppSetting(key: string, value: string): Promise<void> {
  await db.run(
    `INSERT INTO app_settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    [key, value]
  );
}

export interface StoredModule {
  enabled: boolean;
  settings: Record<string, unknown>;
}

const moduleCache = new Map<string, StoredModule>();

export const moduleStore = {
  async load(): Promise<void> {
    moduleCache.clear();
    const rows = await db.all<{ id: string; enabled: number; settings: string }>(
      "SELECT id, enabled, settings FROM modules"
    );
    for (const row of rows) {
      let settings: Record<string, unknown> = {};
      try {
        settings = JSON.parse(row.settings);
      } catch {
        settings = {};
      }
      moduleCache.set(row.id, { enabled: Number(row.enabled) === 1, settings });
    }
  },

  get(id: string): StoredModule {
    return moduleCache.get(id) ?? { enabled: false, settings: {} };
  },

  async setEnabled(id: string, enabled: boolean): Promise<void> {
    await db.run(
      `INSERT INTO modules (id, enabled) VALUES (?, ?)
       ON CONFLICT(id) DO UPDATE SET enabled = excluded.enabled`,
      [id, enabled ? 1 : 0]
    );
    moduleCache.set(id, { ...this.get(id), enabled });
  },

  async setSettings(id: string, settings: Record<string, unknown>): Promise<void> {
    await db.run(
      `INSERT INTO modules (id, settings) VALUES (?, ?)
       ON CONFLICT(id) DO UPDATE SET settings = excluded.settings`,
      [id, JSON.stringify(settings)]
    );
    moduleCache.set(id, { ...this.get(id), settings });
  },
};

const OVERLAY_TOKEN_KEY = "overlay_token";
let overlayToken = "";

export const overlayTokenStore = {
  async load(): Promise<void> {
    overlayToken = (await getAppSetting(OVERLAY_TOKEN_KEY)) ?? (await this.renew());
  },

  get(): string {
    return overlayToken;
  },

  async renew(): Promise<string> {
    const token = randomBytes(24).toString("base64url");
    await setAppSetting(OVERLAY_TOKEN_KEY, token);
    overlayToken = token;
    return token;
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
  async all(): Promise<StoredChatter[]> {
    const rows = await db.all<{ login: string; display_name: string; count: number; last_at: number }>(
      "SELECT login, display_name, count, last_at FROM top_chatters"
    );
    return rows.map((r) => ({ login: r.login, displayName: r.display_name, count: r.count, lastAt: r.last_at }));
  },

  async save(chatters: StoredChatter[]): Promise<void> {
    const upsert = `INSERT INTO top_chatters (login, display_name, count, last_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(login) DO UPDATE SET
         display_name = excluded.display_name, count = excluded.count, last_at = excluded.last_at`;
    await db.batch(chatters.map((c) => [upsert, [c.login, c.displayName, c.count, c.lastAt]]));
  },

  async clear(): Promise<void> {
    await db.run("DELETE FROM top_chatters");
  },

  async getSessionId(): Promise<number | null> {
    const raw = await getAppSetting(TOP_CHATTER_SESSION_KEY);
    return raw === null ? null : Number(raw);
  },

  async setSessionId(id: number): Promise<void> {
    await setAppSetting(TOP_CHATTER_SESSION_KEY, String(id));
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
  async add(event: Omit<StreamEvent, "createdAt">, createdAt = Date.now()): Promise<void> {
    await db.run(
      "INSERT INTO stream_events (type, login, display_name, amount, created_at) VALUES (?, ?, ?, ?, ?)",
      [event.type, event.login, event.displayName, event.amount, createdAt]
    );
  },

  async between(from: number, to: number): Promise<StreamEvent[]> {
    const rows = await db.all<{
      type: StreamEventType;
      login: string;
      display_name: string;
      amount: number;
      created_at: number;
    }>(
      `SELECT type, login, display_name, amount, created_at FROM stream_events
       WHERE created_at >= ? AND created_at <= ? ORDER BY created_at`,
      [from, to]
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
  async get(id: number): Promise<StreamSession | null> {
    const row = await db.get<StreamSessionRow>("SELECT * FROM stream_sessions WHERE id = ?", [id]);
    return row ? toStreamSession(row) : null;
  },

  async live(): Promise<StreamSession | null> {
    const row = await db.get<StreamSessionRow>(
      "SELECT * FROM stream_sessions WHERE status = 'live' ORDER BY id DESC LIMIT 1"
    );
    return row ? toStreamSession(row) : null;
  },

  async recent(limit: number): Promise<StreamSession[]> {
    const rows = await db.all<StreamSessionRow>("SELECT * FROM stream_sessions ORDER BY started_at DESC LIMIT ?", [
      limit,
    ]);
    return rows.map(toStreamSession);
  },

  async open(input: {
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
         (stream_id, streamer, title, games, started_at, last_seen_at, peak_viewers, viewer_sum, viewer_samples,
          followers_start, followers_end)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
       RETURNING id`,
      [
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
    return (await this.get(Number(row!.id)))!;
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

export const sessionStore = {
  async create(sessionId: string, user: SessionUser, expiresAt: number): Promise<void> {
    await db.run(
      `INSERT INTO sessions (id, user_id, login, display_name, avatar_url, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [sessionId, user.id, user.login, user.displayName, user.avatarUrl, Date.now(), expiresAt]
    );
  },

  async get(sessionId: string): Promise<SessionUser | null> {
    const row = await db.get<{
      user_id: string;
      login: string;
      display_name: string;
      avatar_url: string | null;
      expires_at: number;
    }>("SELECT user_id, login, display_name, avatar_url, expires_at FROM sessions WHERE id = ?", [sessionId]);
    if (!row) return null;
    if (row.expires_at < Date.now()) {
      await this.delete(sessionId);
      return null;
    }
    return { id: row.user_id, login: row.login, displayName: row.display_name, avatarUrl: row.avatar_url };
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
  async get(login: string): Promise<TwitchToken | null> {
    const row = await db.get<{
      login: string;
      user_id: string;
      access_token: string;
      refresh_token: string;
      scopes: string;
      expires_at: number;
    }>("SELECT * FROM twitch_tokens WHERE login = ?", [login]);
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

  async delete(login: string): Promise<void> {
    await db.run("DELETE FROM twitch_tokens WHERE login = ?", [login]);
  },
};
