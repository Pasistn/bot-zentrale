import { db } from "./connection.js";

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
      let settings: Record<string, unknown>;
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
