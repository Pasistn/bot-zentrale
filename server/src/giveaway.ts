import { randomInt } from "node:crypto";
import { EventEmitter } from "node:events";
import { giveawayStore, type Giveaway, type GiveawayEntry } from "./db.js";
import { log } from "./logger.js";
import { ValidationError } from "./modules/manager.js";
import type { TwitchHub } from "./twitch/hub.js";
import type { ChatMessage } from "./twitch/types.js";
import { getFollowedAt, hasStreamerToken } from "./twitch/user-token.js";

const KEYWORD_PATTERN = /^\S{1,30}$/;
const MAX_FOLLOW_MINUTES = 3 * 365 * 24 * 60;
const RECHECK_AFTER_MS = 60_000;
const WINNER_MESSAGES = 20;
const RECENT_WINNERS = 10;
const EMIT_DELAY_MS = 300;

export interface GiveawayEntryView {
  login: string;
  displayName: string;
  followedAt: string | null;
  enteredAt: string;
  won: boolean;
}

export interface GiveawayWinnerView {
  login: string;
  displayName: string;
  followedAt: string | null;
  messages: { text: string; at: string }[];
}

export interface GiveawayView {
  active: {
    id: number;
    keyword: string;
    followerOnly: boolean;
    minFollowMinutes: number;
    status: "open" | "closed";
    createdAt: string;
    entries: GiveawayEntryView[];
    rejected: number;
    winner: GiveawayWinnerView | null;
  } | null;
  recentWinners: { login: string; displayName: string; keyword: string; wonAt: string }[];
  followCheckAvailable: boolean;
}

export interface GiveawayInput {
  keyword?: unknown;
  followerOnly?: unknown;
  minFollowDays?: unknown;
  minFollowHours?: unknown;
}

const iso = (time: number | null) => (time === null ? null : new Date(time).toISOString());

function wholeNumber(raw: unknown, label: string): number {
  const value = raw === undefined || raw === null || raw === "" ? 0 : Number(raw);
  if (!Number.isInteger(value) || value < 0) throw new ValidationError(`${label} muss eine ganze Zahl ab 0 sein.`);
  return value;
}

function followAge(minutes: number): string {
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  if (days > 0 && hours > 0) return `${days} Tagen und ${hours} Stunden`;
  if (days > 0) return days === 1 ? "einem Tag" : `${days} Tagen`;
  return hours === 1 ? "einer Stunde" : `${hours} Stunden`;
}

export class GiveawayService extends EventEmitter<{ changed: [] }> {
  private giveaway: Giveaway | null = null;
  private readonly entries = new Map<string, GiveawayEntry>();
  private readonly checking = new Set<string>();
  private readonly rejected = new Map<string, number>();
  private winner: { login: string; messages: { text: string; at: number }[] } | null = null;
  private recentWinners: GiveawayView["recentWinners"] = [];
  private emitTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly channel: string,
    private readonly hub: TwitchHub
  ) {
    super();
  }

  async start(): Promise<void> {
    this.giveaway = await giveawayStore.current(this.channel);
    if (this.giveaway) {
      for (const entry of await giveawayStore.entries(this.giveaway.id)) this.entries.set(entry.login, entry);
    }
    await this.loadRecentWinners();
    this.hub.on("chat", this.onChat);
  }

  stop(): void {
    this.hub.off("chat", this.onChat);
    if (this.emitTimer) clearTimeout(this.emitTimer);
    this.removeAllListeners();
  }

  async view(): Promise<GiveawayView> {
    const g = this.giveaway;
    const winnerEntry = this.winner ? this.entries.get(this.winner.login) : undefined;
    return {
      active:
        g && g.status !== "ended"
          ? {
              id: g.id,
              keyword: g.keyword,
              followerOnly: g.followerOnly,
              minFollowMinutes: g.minFollowMinutes,
              status: g.status,
              createdAt: new Date(g.createdAt).toISOString(),
              entries: [...this.entries.values()].map((e) => ({
                login: e.login,
                displayName: e.displayName,
                followedAt: iso(e.followedAt),
                enteredAt: new Date(e.enteredAt).toISOString(),
                won: e.wonAt !== null,
              })),
              rejected: this.rejected.size,
              winner:
                this.winner && winnerEntry
                  ? {
                      login: winnerEntry.login,
                      displayName: winnerEntry.displayName,
                      followedAt: iso(winnerEntry.followedAt),
                      messages: this.winner.messages.map((m) => ({ text: m.text, at: new Date(m.at).toISOString() })),
                    }
                  : null,
            }
          : null,
      recentWinners: this.recentWinners,
      followCheckAvailable: await hasStreamerToken(this.channel),
    };
  }

  async open(input: GiveawayInput): Promise<void> {
    if (this.giveaway) throw new ValidationError("Es läuft schon ein Giveaway. Beende es zuerst.");

    const keyword = String(input.keyword ?? "").trim();
    if (!KEYWORD_PATTERN.test(keyword)) {
      throw new ValidationError("Das Stichwort muss ein einzelnes Wort mit höchstens 30 Zeichen sein, z. B. !join.");
    }
    const followerOnly = input.followerOnly === true;
    const minutes = followerOnly
      ? wholeNumber(input.minFollowDays, "Tage") * 1440 + wholeNumber(input.minFollowHours, "Stunden") * 60
      : 0;
    if (minutes > MAX_FOLLOW_MINUTES) throw new ValidationError("Die Mindestdauer darf höchstens 3 Jahre sein.");
    if (followerOnly && !(await hasStreamerToken(this.channel))) {
      throw new ValidationError(
        "Für die Follower-Prüfung muss sich der Streamer oder ein Mod einmal neu anmelden, damit Twitch die Follower freigibt."
      );
    }

    this.giveaway = await giveawayStore.create(this.channel, { keyword, followerOnly, minFollowMinutes: minutes });
    this.entries.clear();
    this.rejected.clear();
    this.winner = null;
    const rule = followerOnly
      ? minutes > 0
        ? `, nur Follower seit mindestens ${followAge(minutes)}`
        : ", nur Follower"
      : "";
    log("info", "giveaway", `Giveaway gestartet: „${keyword}“${rule}`, this.channel);
    this.changed();
  }

  async close(): Promise<void> {
    const g = this.require();
    if (g.status !== "open") return;
    await giveawayStore.setStatus(g.id, "closed");
    g.status = "closed";
    log("info", "giveaway", `Teilnahme geschlossen, ${this.entries.size} im Topf`, this.channel);
    this.changed();
  }

  async reopen(): Promise<void> {
    const g = this.require();
    if (g.status !== "closed") return;
    await giveawayStore.setStatus(g.id, "open");
    g.status = "open";
    log("info", "giveaway", "Teilnahme wieder offen", this.channel);
    this.changed();
  }

  async draw(): Promise<void> {
    const g = this.require();
    const pool = [...this.entries.values()].filter((e) => e.wonAt === null);

    while (pool.length > 0) {
      const [candidate] = pool.splice(randomInt(pool.length), 1);
      if (g.followerOnly && !(await this.stillQualifies(g, candidate))) {
        await giveawayStore.removeEntry(g.id, candidate.login);
        this.entries.delete(candidate.login);
        log("info", "giveaway", `${candidate.displayName} erfüllt die Follower-Bedingung nicht mehr und wurde entfernt`, this.channel);
        continue;
      }
      await giveawayStore.markWinner(g.id, candidate.login);
      candidate.wonAt = Date.now();
      this.winner = { login: candidate.login, messages: [] };
      await this.loadRecentWinners();
      log("info", "giveaway", `Gewinner: ${candidate.displayName}`, this.channel);
      this.changed();
      return;
    }

    this.changed();
    throw new ValidationError("Niemand mehr im Topf, der gewinnen kann.");
  }

  async remove(login: string): Promise<void> {
    const g = this.require();
    if (!this.entries.has(login)) return;
    await giveawayStore.removeEntry(g.id, login);
    this.entries.delete(login);
    if (this.winner?.login === login) this.winner = null;
    this.changed();
  }

  async end(): Promise<void> {
    const g = this.require();
    await giveawayStore.setStatus(g.id, "ended");
    log("info", "giveaway", `Giveaway „${g.keyword}“ beendet`, this.channel);
    this.giveaway = null;
    this.entries.clear();
    this.rejected.clear();
    this.winner = null;
    this.changed();
  }

  private require(): Giveaway {
    if (!this.giveaway) throw new ValidationError("Gerade läuft kein Giveaway.");
    return this.giveaway;
  }

  private readonly onChat = (msg: ChatMessage) => {
    const login = msg.login.toLowerCase();
    if (this.winner?.login === login) {
      this.winner.messages.push({ text: msg.text, at: Date.now() });
      if (this.winner.messages.length > WINNER_MESSAGES) this.winner.messages.shift();
      this.changed();
    }

    const g = this.giveaway;
    if (!g || g.status !== "open" || msg.isBroadcaster || !login || !msg.userId) return;
    const word = msg.text.trim().split(/\s+/)[0]?.toLowerCase();
    if (word !== g.keyword.toLowerCase()) return;
    if (this.entries.has(login) || this.checking.has(login)) return;
    const rejectedAt = this.rejected.get(login);
    if (rejectedAt && Date.now() - rejectedAt < RECHECK_AFTER_MS) return;

    void this.enter(g, { ...msg, login });
  };

  private async enter(g: Giveaway, msg: ChatMessage): Promise<void> {
    this.checking.add(msg.login);
    try {
      let followedAt: number | null = null;
      if (g.followerOnly) {
        const reason = await this.followProblem(g, msg.userId);
        if (typeof reason === "string") {
          this.rejected.set(msg.login, Date.now());
          log("info", "giveaway", `${msg.displayName} nicht aufgenommen: ${reason}`, this.channel);
          this.changed();
          return;
        }
        followedAt = reason;
      }
      if (this.giveaway?.id !== g.id || g.status !== "open") return;

      const entry = {
        login: msg.login,
        userId: msg.userId,
        displayName: msg.displayName || msg.login,
        followedAt,
        enteredAt: Date.now(),
      };
      if (await giveawayStore.addEntry(g.id, entry)) {
        this.entries.set(entry.login, { ...entry, wonAt: null });
        this.rejected.delete(entry.login);
        this.changed();
      }
    } catch (err) {
      log("warn", "giveaway", `Teilnahme von ${msg.displayName} nicht geprüft: ${err instanceof Error ? err.message : String(err)}`, this.channel);
    } finally {
      this.checking.delete(msg.login);
    }
  }

  private async followProblem(g: Giveaway, userId: string): Promise<string | number> {
    const followedAt = await getFollowedAt(this.channel, userId);
    if (followedAt === undefined) return "Follower-Prüfung nicht möglich";
    if (followedAt === null) return "folgt nicht";
    if (Date.now() - followedAt < g.minFollowMinutes * 60_000) return `folgt noch nicht seit ${followAge(g.minFollowMinutes)}`;
    return followedAt;
  }

  private async stillQualifies(g: Giveaway, entry: GiveawayEntry): Promise<boolean> {
    let followedAt: number | null | undefined;
    try {
      followedAt = await getFollowedAt(this.channel, entry.userId);
    } catch (err) {
      log("warn", "giveaway", `Follower-Prüfung beim Ziehen fehlgeschlagen: ${err instanceof Error ? err.message : String(err)}`, this.channel);
      return true;
    }
    if (followedAt === undefined) {
      log("warn", "giveaway", "Follower-Prüfung beim Ziehen nicht möglich, Gewinner ungeprüft", this.channel);
      return true;
    }
    return followedAt !== null && Date.now() - followedAt >= g.minFollowMinutes * 60_000;
  }

  private async loadRecentWinners(): Promise<void> {
    this.recentWinners = (await giveawayStore.recentWinners(this.channel, RECENT_WINNERS)).map((w) => ({
      login: w.login,
      displayName: w.displayName,
      keyword: w.keyword,
      wonAt: new Date(w.wonAt!).toISOString(),
    }));
  }

  private changed(): void {
    if (this.emitTimer) return;
    this.emitTimer = setTimeout(() => {
      this.emitTimer = null;
      this.emit("changed");
    }, EMIT_DELAY_MS);
  }
}
