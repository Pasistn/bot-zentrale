import { EventEmitter } from "node:events";
import { log } from "../logger.js";
import { subscribeToRedemptions } from "./user-token.js";

const EVENTSUB_URL = "wss://eventsub.wss.twitch.tv/ws";
const MAX_RETRY_MS = 60_000;

export interface Redemption {
  id: string;
  rewardId: string;
  userId: string;
  userLogin: string;
  userName: string;
}

interface EventSubMessage {
  metadata: { message_type: string; subscription_type?: string };
  payload: {
    session?: { id: string; keepalive_timeout_seconds: number | null; reconnect_url: string | null };
    event?: { id: string; user_id: string; user_login: string; user_name: string; reward: { id: string } };
    subscription?: { status: string };
  };
}

export class RedemptionListener extends EventEmitter<{ redemption: [Redemption] }> {
  private socket: WebSocket | null = null;
  private keepaliveTimer: NodeJS.Timeout | null = null;
  private retryTimer: NodeJS.Timeout | null = null;
  private retryDelay = 1000;
  private stopped = false;

  constructor(
    private readonly channel: string,
    private readonly rewardId: string
  ) {
    super();
  }

  start(): void {
    this.connect(EVENTSUB_URL, true);
  }

  stop(): void {
    this.stopped = true;
    this.clearTimers();
    this.socket?.close();
    this.socket = null;
    this.removeAllListeners();
  }

  private connect(url: string, subscribe: boolean): void {
    if (this.stopped) return;
    const socket = new WebSocket(url);
    const previous = this.socket;
    this.socket = socket;

    socket.addEventListener("message", (event) => {
      if (this.socket !== socket) return;
      let message: EventSubMessage;
      try {
        message = JSON.parse(String(event.data)) as EventSubMessage;
      } catch {
        return;
      }
      void this.handle(socket, message, subscribe, previous);
    });

    socket.addEventListener("close", () => {
      if (this.socket !== socket || this.stopped) return;
      this.scheduleReconnect("Verbindung zu Twitch EventSub getrennt");
    });

    socket.addEventListener("error", () => undefined);
  }

  private async handle(
    socket: WebSocket,
    message: EventSubMessage,
    subscribe: boolean,
    previous: WebSocket | null
  ): Promise<void> {
    const timeout = message.payload.session?.keepalive_timeout_seconds;
    this.watchKeepalive(timeout ?? undefined);

    switch (message.metadata.message_type) {
      case "session_welcome": {
        previous?.close();
        this.retryDelay = 1000;
        if (!subscribe) return;
        try {
          await subscribeToRedemptions(this.channel, message.payload.session!.id, this.rewardId);
          log("info", "giveaway", "Kanalpunkte-Einlösungen werden empfangen", this.channel);
        } catch (err) {
          log("error", "giveaway", `Einlösungen nicht abonniert: ${err instanceof Error ? err.message : String(err)}`, this.channel);
          socket.close();
        }
        return;
      }
      case "session_reconnect": {
        const url = message.payload.session?.reconnect_url;
        if (url) this.connect(url, false);
        return;
      }
      case "notification": {
        const e = message.payload.event;
        if (message.metadata.subscription_type !== "channel.channel_points_custom_reward_redemption.add" || !e) return;
        this.emit("redemption", {
          id: e.id,
          rewardId: e.reward.id,
          userId: e.user_id,
          userLogin: e.user_login.toLowerCase(),
          userName: e.user_name,
        });
        return;
      }
      case "revocation":
        log("warn", "giveaway", `Twitch hat das Abo beendet (${message.payload.subscription?.status})`, this.channel);
        this.scheduleReconnect("Abo neu anlegen");
        return;
    }
  }

  private watchKeepalive(seconds?: number): void {
    if (this.keepaliveTimer) clearTimeout(this.keepaliveTimer);
    const limit = ((seconds ?? 10) + 10) * 1000;
    this.keepaliveTimer = setTimeout(() => this.scheduleReconnect("Keine Nachricht von Twitch EventSub"), limit);
  }

  private scheduleReconnect(reason: string): void {
    if (this.stopped || this.retryTimer) return;
    this.clearTimers();
    const socket = this.socket;
    this.socket = null;
    socket?.close();
    log("warn", "giveaway", `${reason}, neuer Versuch in ${Math.round(this.retryDelay / 1000)} s`, this.channel);
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.connect(EVENTSUB_URL, true);
    }, this.retryDelay);
    this.retryDelay = Math.min(this.retryDelay * 2, MAX_RETRY_MS);
  }

  private clearTimers(): void {
    if (this.keepaliveTimer) clearTimeout(this.keepaliveTimer);
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.keepaliveTimer = null;
    this.retryTimer = null;
  }
}
