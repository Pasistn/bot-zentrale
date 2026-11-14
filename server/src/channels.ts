import { EventEmitter } from "node:events";
import { config } from "./config.js";
import { accessStore, channelStore, legacyChannel, streamEventStore, type Channel } from "./db.js";
import { GiveawayService } from "./giveaway.js";
import { clearLogs, log } from "./logger.js";
import { adoptLegacyMedia } from "./media.js";
import { createModules } from "./modules/index.js";
import { ModuleManager } from "./modules/manager.js";
import { clearOverlayStates } from "./overlays/bus.js";
import { StreamTracker } from "./stream/tracker.js";
import type { TwitchChat } from "./twitch/chat.js";
import type { TwitchHub } from "./twitch/hub.js";
import { forgetStreamerToken } from "./twitch/user-token.js";

const KEEP_EVENTS_MS = 90 * 24 * 60 * 60 * 1000;

export const LOGIN_PATTERN = /^[a-z0-9_]{3,25}$/;

export function normalizeLogin(raw: unknown): string {
  return String(raw ?? "")
    .trim()
    .toLowerCase()
    .replace(/^[@#]/, "")
    .replace(/^https?:\/\/(www\.)?twitch\.tv\//, "");
}

export function isOwner(login: string): boolean {
  return config.ownerLogins.includes(login);
}

export function canAccess(login: string, channel: string): boolean {
  if (!channelStore.get(channel)) return false;
  return login === channel || isOwner(login) || accessStore.has(channel, login);
}

export function canManageAccess(login: string, channel: string): boolean {
  return login === channel || isOwner(login);
}

export function channelsFor(login: string): Channel[] {
  return channelStore.list().filter((c) => canAccess(login, c.login));
}

export function defaultChannelFor(login: string): string | null {
  if (channelStore.get(login)) return login;
  const own = accessStore.channelsOf(login).find((c) => channelStore.get(c));
  return own ?? channelsFor(login)[0]?.login ?? null;
}

export interface ChannelRuntime {
  channel: string;
  hub: TwitchHub;
  tracker: StreamTracker;
  manager: ModuleManager;
  giveaway: GiveawayService;
}

export class ChannelRegistry extends EventEmitter<{
  modules: [channel: string];
  giveaway: [channel: string];
  removed: [channel: string];
  accessRevoked: [channel: string, login: string];
}> {
  private readonly runtimes = new Map<string, ChannelRuntime>();

  constructor(private readonly chat: TwitchChat) {
    super();
  }

  get(channel: string): ChannelRuntime | null {
    return this.runtimes.get(channel) ?? null;
  }

  async startAll(): Promise<void> {
    const removed = await streamEventStore.purgeBefore(Date.now() - KEEP_EVENTS_MS);
    if (removed > 0) log("info", "stream", `${removed} alte Einträge (Raids, Subs, Bits) gelöscht`);

    const own = config.ownChannel;
    if (own && !channelStore.get(own)) await channelStore.add(own, own);

    const owner = channelStore.get(legacyChannel());
    if (owner) {
      const moved = await adoptLegacyMedia(owner.login);
      if (moved > 0) log("info", "media", `${moved} Dateien in den Ordner von #${owner.login} verschoben`);
    }

    for (const channel of channelStore.list()) await this.start(channel.login);
  }

  async add(login: string, displayName: string): Promise<Channel> {
    const channel = await channelStore.add(login, displayName);
    await this.start(login);
    return channel;
  }

  async remove(login: string): Promise<void> {
    await this.get(login)
      ?.giveaway.endIfActive()
      .catch((err) =>
        log("warn", "giveaway", `Giveaway nicht beendet: ${err instanceof Error ? err.message : String(err)}`, login)
      );
    await this.stop(login);
    await forgetStreamerToken(login);
    await channelStore.remove(login);
    this.emit("removed", login);
  }

  async shutdown(): Promise<void> {
    for (const channel of [...this.runtimes.keys()]) await this.stop(channel);
  }

  private async start(channel: string): Promise<void> {
    if (this.runtimes.has(channel)) return;
    const hub = this.chat.createHub(channel);
    const tracker = new StreamTracker(hub);
    const manager = new ModuleManager(channel, hub, tracker, createModules(channel));
    const giveaway = new GiveawayService(channel, hub);
    const runtime = { channel, hub, tracker, manager, giveaway };
    this.runtimes.set(channel, runtime);

    manager.on("changed", () => this.emit("modules", channel));
    await manager.init();
    await tracker.start();
    await giveaway.start();
    giveaway.on("changed", () => this.emit("giveaway", channel));
    log("info", "server", `Kanal #${channel} gestartet`);
  }

  private async stop(channel: string): Promise<void> {
    const runtime = this.runtimes.get(channel);
    if (!runtime) return;
    this.runtimes.delete(channel);
    await runtime.manager.shutdown();
    await runtime.tracker.stop();
    runtime.giveaway.stop();
    runtime.manager.removeAllListeners();
    this.chat.removeHub(channel);
    clearOverlayStates(channel);
    clearLogs(channel);
    log("info", "server", `Kanal #${channel} gestoppt`);
  }
}
