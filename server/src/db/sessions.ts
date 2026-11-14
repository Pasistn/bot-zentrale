import { db } from "./connection.js";
import { hashSessionId, seal, unseal } from "./secrets.js";

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
      [hashSessionId(sessionId), user.id, user.login, user.displayName, user.avatarUrl, channel, Date.now(), expiresAt]
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
    }>("SELECT user_id, login, display_name, avatar_url, channel, expires_at FROM sessions WHERE id = ?", [
      hashSessionId(sessionId),
    ]);
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
    await db.run("UPDATE sessions SET channel = ? WHERE id = ?", [channel, hashSessionId(sessionId)]);
  },

  async delete(sessionId: string): Promise<void> {
    await db.run("DELETE FROM sessions WHERE id = ?", [hashSessionId(sessionId)]);
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
    const accessToken = unseal(row.access_token);
    const refreshToken = unseal(row.refresh_token);
    if (accessToken === null || refreshToken === null) return null;
    return {
      login: row.login,
      userId: row.user_id,
      accessToken,
      refreshToken,
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
      [
        token.login,
        token.userId,
        seal(token.accessToken),
        seal(token.refreshToken),
        token.scopes.join(" "),
        token.expiresAt,
      ]
    );
  },

  async delete(channel: string): Promise<void> {
    await db.run("DELETE FROM twitch_tokens WHERE login = ?", [channel]);
  },
};
