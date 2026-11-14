import { randomBytes } from "node:crypto";
import { db } from "./connection.js";

function newOverlayToken(): string {
  return randomBytes(24).toString("base64url");
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
      cacheChannel({
        login: r.login,
        displayName: r.display_name,
        overlayToken: r.overlay_token,
        createdAt: r.created_at,
      });
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
    return login ? (channels.get(login) ?? null) : null;
  },

  async add(login: string, displayName: string): Promise<Channel> {
    const existing = channels.get(login);
    if (existing) return existing;
    const channel: Channel = { login, displayName, overlayToken: newOverlayToken(), createdAt: Date.now() };
    await db.run("INSERT INTO channels (login, display_name, overlay_token, created_at) VALUES (?, ?, ?, ?)", [
      channel.login,
      channel.displayName,
      channel.overlayToken,
      channel.createdAt,
    ]);
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
