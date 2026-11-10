import { EventEmitter } from "node:events";
import tmi from "tmi.js";
import { log } from "../logger.js";
import { TwitchHub, type ChatUserstate } from "./hub.js";

const channelName = (raw: unknown) => String(raw ?? "").replace(/^#/, "").toLowerCase();

export class TwitchChat extends EventEmitter<{ status: [boolean] }> {
  private readonly client: tmi.Client;
  private readonly hubs = new Map<string, TwitchHub>();
  private isConnected = false;

  constructor() {
    super();
    this.client = new tmi.Client({
      options: { debug: false },
      logger: { info: () => undefined, warn: () => undefined, error: () => undefined },
      connection: { reconnect: true, secure: true },
      channels: [],
    });

    this.client.on("raw_message", (_cloned, message) => {
      const params = (message.params ?? []) as unknown[];
      const hub = this.hubs.get(channelName(params[0]));
      if (!hub) return;
      hub.handleRaw(String(message.command ?? ""), (message.tags ?? {}) as Record<string, unknown>, params);
    });

    this.client.on("message", (channel, userstate, text, self) => {
      if (self) return;
      this.hubs.get(channelName(channel))?.handleChat(userstate as ChatUserstate, text);
    });

    this.client.on("connected", () => {
      this.isConnected = true;
      log("info", "twitch", `Mit dem Twitch-Chat verbunden, ${this.hubs.size} Kanäle`);
      this.emit("status", true);
      for (const hub of this.hubs.values()) hub.emit("status", true);
    });

    this.client.on("disconnected", (reason) => {
      this.isConnected = false;
      log("warn", "twitch", `Verbindung getrennt: ${reason}`);
      this.emit("status", false);
      for (const hub of this.hubs.values()) hub.emit("status", false);
    });
  }

  get connected(): boolean {
    return this.isConnected;
  }

  createHub(channel: string): TwitchHub {
    const hub = new TwitchHub(channel, () => this.isConnected);
    this.hubs.set(channel, hub);
    const joined = this.client.getOptions().channels ?? [];
    if (!joined.includes(`#${channel}`)) joined.push(`#${channel}`);
    this.client.getOptions().channels = joined;
    if (this.isConnected) {
      this.client.join(channel).catch((err) => log("warn", "twitch", `Beitritt fehlgeschlagen: ${String(err)}`, channel));
    }
    return hub;
  }

  removeHub(channel: string): void {
    this.hubs.get(channel)?.removeAllListeners();
    this.hubs.delete(channel);
    const options = this.client.getOptions();
    options.channels = (options.channels ?? []).filter((c) => c !== `#${channel}`);
    if (this.isConnected) this.client.part(channel).catch(() => undefined);
  }

  async start(): Promise<void> {
    try {
      await this.client.connect();
    } catch (err) {
      log("error", "twitch", `Verbindung fehlgeschlagen: ${String(err)}`);
    }
  }

  async stop(): Promise<void> {
    await this.client.disconnect().catch(() => undefined);
  }
}
