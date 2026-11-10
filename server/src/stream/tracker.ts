import { streamEventStore, streamSessionStore, type StreamSession } from "../db.js";
import { log } from "../logger.js";
import { summaryEvents } from "../summaries.js";
import { getLiveStream } from "../twitch/helix.js";
import type { TwitchHub } from "../twitch/hub.js";
import type { StreamInfo } from "../twitch/types.js";
import { getFollowerCount } from "../twitch/user-token.js";

export const POLL_INTERVAL_MS = 60_000;

const OFFLINE_GRACE_MS = 5 * 60_000;

export class StreamTracker {
  private timer: NodeJS.Timeout | null = null;
  private polling = false;
  private lastPollError: string | null = null;
  private lastFollowerError: string | null = null;
  private chatCounter = 0;
  private current: StreamInfo | null = null;

  private readonly channel: string;

  constructor(private readonly hub: TwitchHub) {
    this.channel = hub.channel;
  }

  get live(): StreamInfo | null {
    return this.current;
  }

  async start(): Promise<void> {
    this.hub.on("chat", this.onChat);
    this.hub.on("raid", this.onRaid);
    this.hub.on("giftSub", this.onGift);
    this.hub.on("sub", this.onSub);
    this.hub.on("cheer", this.onCheer);

    this.timer = setInterval(() => void this.poll(), POLL_INTERVAL_MS);
    void this.poll();
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.hub.off("chat", this.onChat);
    this.hub.off("raid", this.onRaid);
    this.hub.off("giftSub", this.onGift);
    this.hub.off("sub", this.onSub);
    this.hub.off("cheer", this.onCheer);
    await this.flushChat().catch(() => undefined);
  }

  private readonly onChat = () => {
    this.chatCounter++;
  };

  private readonly onRaid = (r: { login: string; displayName: string; viewers: number }) =>
    this.record({ type: "raid", login: r.login, displayName: r.displayName, amount: r.viewers });

  private readonly onGift = (g: { gifterLogin: string | null; gifterName: string; amount: number }) =>
    this.record({ type: "gift", login: g.gifterLogin ?? "", displayName: g.gifterName, amount: g.amount });

  private readonly onSub = (s: { login: string; displayName: string }) =>
    this.record({ type: "sub", login: s.login, displayName: s.displayName, amount: 1 });

  private readonly onCheer = (c: { login: string; displayName: string; bits: number }) =>
    this.record({ type: "cheer", login: c.login, displayName: c.displayName, amount: c.bits });

  private record(event: Parameters<typeof streamEventStore.add>[1]): void {
    streamEventStore
      .add(this.channel, event)
      .then(() => summaryEvents.emit("changed", this.channel))
      .catch((err) =>
        log("error", "stream", `Ereignis nicht gespeichert: ${err instanceof Error ? err.message : String(err)}`, this.channel)
      );
  }

  private async flushChat(): Promise<void> {
    if (this.chatCounter === 0) return;
    const count = this.chatCounter;
    this.chatCounter = 0;
    const live = await streamSessionStore.live(this.channel);
    if (live) await streamSessionStore.addMessageCount(live.id, count);
  }

  private async followers(): Promise<number | null> {
    try {
      const count = await getFollowerCount(this.channel);
      if (this.lastFollowerError) log("info", "stream", "Follower-Zahl ist wieder abrufbar", this.channel);
      this.lastFollowerError = null;
      return count;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message !== this.lastFollowerError) log("warn", "stream", `Follower-Zahl nicht abrufbar: ${message}`, this.channel);
      this.lastFollowerError = message;
      return null;
    }
  }

  private async finish(session: StreamSession): Promise<void> {
    await streamSessionStore.end(session.id, Math.min(session.lastSeenAt + POLL_INTERVAL_MS, Date.now()));
    const info = { sessionId: session.id, startedAt: session.startedAt };
    this.current = null;
    log("info", "stream", "Stream beendet", this.channel);
    summaryEvents.emit("changed", this.channel);
    this.hub.emit("streamOffline", info);
  }

  private online(session: StreamSession): void {
    const changed = this.current?.sessionId !== session.id;
    this.current = { sessionId: session.id, startedAt: session.startedAt };
    if (changed) this.hub.emit("streamOnline", this.current);
  }

  private async poll(): Promise<void> {
    if (this.polling) return;
    this.polling = true;
    try {
      const stream = await getLiveStream(this.channel);
      if (this.lastPollError) log("info", "stream", "Twitch-API ist wieder erreichbar", this.channel);
      this.lastPollError = null;
      await this.flushChat();

      const current = await streamSessionStore.live(this.channel);
      const now = Date.now();

      if (stream) {
        const followers = await this.followers();
        const sameStream = current && (current.streamId === stream.id || now - current.lastSeenAt < OFFLINE_GRACE_MS);
        if (current && sameStream) {
          if (current.streamId !== stream.id) log("info", "stream", "Stream nach kurzer Unterbrechung fortgesetzt", this.channel);
          await streamSessionStore.seen(current, {
            streamId: stream.id,
            title: stream.title,
            game: stream.gameName,
            viewers: stream.viewers,
            followers,
          });
          this.online(current);
        } else {
          if (current) await this.finish(current);
          const session = await streamSessionStore.open({
            channel: this.channel,
            streamId: stream.id,
            streamer: stream.userName,
            title: stream.title,
            game: stream.gameName,
            startedAt: stream.startedAt,
            viewers: stream.viewers,
            followers,
          });
          log("info", "stream", `Stream läuft: „${stream.title}“`, this.channel);
          this.online(session);
        }
        summaryEvents.emit("changed", this.channel);
      } else if (current && now - current.lastSeenAt >= OFFLINE_GRACE_MS) {
        await this.finish(current);
      } else if (current) {
        this.online(current);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message !== this.lastPollError) log("warn", "stream", `Stream-Status nicht abrufbar: ${message}`, this.channel);
      this.lastPollError = message;
    } finally {
      this.polling = false;
    }
  }
}
