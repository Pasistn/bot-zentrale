import { randomInt } from "node:crypto";
import { EventEmitter } from "node:events";
import { giveawayStore, type Giveaway, type GiveawayEntry, type GiveawayMode, type GiveawayRules } from "./db.js";
import { log } from "./logger.js";
import { ValidationError } from "./modules/manager.js";
import { RedemptionListener, type Redemption } from "./twitch/eventsub.js";
import type { TwitchHub } from "./twitch/hub.js";
import type { ChatMessage } from "./twitch/types.js";
import {
  createReward,
  deleteReward,
  getFollowedAt,
  hasPointsAccess,
  hasStreamerToken,
  isSubscriber,
  setRedemptionStatus,
  setRewardPaused,
  TwitchApiError,
} from "./twitch/user-token.js";

const KEYWORD_PATTERN = /^\S{1,30}$/;
const MAX_FOLLOW_MINUTES = 3 * 365 * 24 * 60;
const MAX_TICKETS = 100;
const MAX_MULTIPLIER = 10;
const MAX_COST = 1_000_000;
const MAX_TITLE = 45;
const RECHECK_AFTER_MS = 60_000;
const WINNER_MESSAGES = 20;
const RECENT_WINNERS = 10;
const EMIT_DELAY_MS = 300;
const REWARD_PROMPT =
  "Ein Los für das Giveaway. Bist du schon mit allen Losen dabei oder erfüllst die Bedingungen nicht, bekommst du die Punkte zurück.";

export interface GiveawayEntryView {
  login: string;
  displayName: string;
  followedAt: string | null;
  enteredAt: string;
  won: boolean;
  tickets: number;
  subscriber: boolean;
  chance: number | null;
}

export interface GiveawayWinnerView {
  login: string;
  displayName: string;
  followedAt: string | null;
  subscriber: boolean;
  tickets: number;
  messages: { text: string; at: string }[];
}

export interface GiveawayView {
  active:
    | (GiveawayRules & {
        id: number;
        status: "open" | "closed";
        createdAt: string;
        entries: GiveawayEntryView[];
        tickets: number;
        rejected: number;
        winner: GiveawayWinnerView | null;
      })
    | null;
  recentWinners: { login: string; displayName: string; keyword: string; wonAt: string }[];
  followCheckAvailable: boolean;
  pointsAvailable: boolean;
}

export interface GiveawayInput {
  mode?: unknown;
  keyword?: unknown;
  rewardTitle?: unknown;
  rewardCost?: unknown;
  maxTickets?: unknown;
  followerOnly?: unknown;
  minFollowDays?: unknown;
  minFollowHours?: unknown;
  subOnly?: unknown;
  subMultiplier?: unknown;
}

const iso = (time: number | null) => (time === null ? null : new Date(time).toISOString());

function wholeNumber(raw: unknown, label: string, min: number, max: number, fallback: number): number {
  const value = raw === undefined || raw === null || raw === "" ? fallback : Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new ValidationError(`${label} muss eine ganze Zahl von ${min.toLocaleString("de-DE")} bis ${max.toLocaleString("de-DE")} sein.`);
  }
  return value;
}

function followAge(minutes: number): string {
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const parts = [];
  if (days) parts.push(days === 1 ? "einem Tag" : `${days} Tagen`);
  if (hours) parts.push(hours === 1 ? "einer Stunde" : `${hours} Stunden`);
  return parts.join(" und ");
}

function readRules(input: GiveawayInput): GiveawayRules {
  const mode: GiveawayMode = input.mode === "points" ? "points" : "chat";
  const followerOnly = input.followerOnly === true;
  const rules: GiveawayRules = {
    mode,
    keyword: "",
    rewardTitle: null,
    rewardCost: null,
    maxTickets: 1,
    followerOnly,
    minFollowMinutes: followerOnly
      ? wholeNumber(input.minFollowDays, "Tage", 0, 1095, 0) * 1440 + wholeNumber(input.minFollowHours, "Stunden", 0, 23, 0) * 60
      : 0,
    subOnly: input.subOnly === true,
    subMultiplier: wholeNumber(input.subMultiplier, "Der Sub-Bonus", 1, MAX_MULTIPLIER, 1),
  };
  if (rules.minFollowMinutes > MAX_FOLLOW_MINUTES) throw new ValidationError("Die Mindestdauer darf höchstens 3 Jahre sein.");

  if (mode === "chat") {
    rules.keyword = String(input.keyword ?? "").trim();
    if (!KEYWORD_PATTERN.test(rules.keyword)) {
      throw new ValidationError("Das Stichwort muss ein einzelnes Wort mit höchstens 30 Zeichen sein, z. B. !join.");
    }
    return rules;
  }

  rules.rewardTitle = String(input.rewardTitle ?? "").trim();
  if (!rules.rewardTitle || rules.rewardTitle.length > MAX_TITLE) {
    throw new ValidationError(`Der Name der Belohnung muss 1 bis ${MAX_TITLE} Zeichen lang sein.`);
  }
  rules.rewardCost = wholeNumber(input.rewardCost, "Der Preis", 1, MAX_COST, 1000);
  rules.maxTickets = wholeNumber(input.maxTickets, "Die Anzahl Lose", 1, MAX_TICKETS, 1);
  return rules;
}

export class GiveawayService extends EventEmitter<{ changed: [] }> {
  private giveaway: Giveaway | null = null;
  private readonly entries = new Map<string, GiveawayEntry>();
  private readonly checking = new Set<string>();
  private readonly rejected = new Map<string, number>();
  private winner: { login: string; messages: { text: string; at: number }[] } | null = null;
  private recentWinners: GiveawayView["recentWinners"] = [];
  private listener: RedemptionListener | null = null;
  private redemptions: Promise<void> = Promise.resolve();
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
      if (this.giveaway.mode === "points" && this.giveaway.rewardId) this.listen(this.giveaway.rewardId);
    }
    await this.loadRecentWinners();
    this.hub.on("chat", this.onChat);
  }

  stop(): void {
    this.hub.off("chat", this.onChat);
    this.listener?.stop();
    this.listener = null;
    if (this.emitTimer) clearTimeout(this.emitTimer);
    this.removeAllListeners();
  }

  async view(): Promise<GiveawayView> {
    const g = this.giveaway;
    const winnerEntry = this.winner ? this.entries.get(this.winner.login) : undefined;
    const pool = [...this.entries.values()].filter((e) => e.wonAt === null);
    const poolWeight = g ? pool.reduce((sum, e) => sum + this.weight(g, e), 0) : 0;
    const [followCheckAvailable, pointsAvailable] = await Promise.all([
      hasStreamerToken(this.channel),
      hasPointsAccess(this.channel).catch(() => false),
    ]);

    return {
      active:
        g && g.status !== "ended"
          ? {
              id: g.id,
              mode: g.mode,
              keyword: g.keyword,
              rewardTitle: g.rewardTitle,
              rewardCost: g.rewardCost,
              maxTickets: g.maxTickets,
              followerOnly: g.followerOnly,
              minFollowMinutes: g.minFollowMinutes,
              subOnly: g.subOnly,
              subMultiplier: g.subMultiplier,
              status: g.status,
              createdAt: new Date(g.createdAt).toISOString(),
              entries: [...this.entries.values()].map((e) => ({
                login: e.login,
                displayName: e.displayName,
                followedAt: iso(e.followedAt),
                enteredAt: new Date(e.enteredAt).toISOString(),
                won: e.wonAt !== null,
                tickets: e.tickets,
                subscriber: e.subscriber,
                chance: e.wonAt === null && poolWeight > 0 ? (this.weight(g, e) / poolWeight) * 100 : null,
              })),
              tickets: [...this.entries.values()].reduce((sum, e) => sum + e.tickets, 0),
              rejected: this.rejected.size,
              winner:
                this.winner && winnerEntry
                  ? {
                      login: winnerEntry.login,
                      displayName: winnerEntry.displayName,
                      followedAt: iso(winnerEntry.followedAt),
                      subscriber: winnerEntry.subscriber,
                      tickets: winnerEntry.tickets,
                      messages: this.winner.messages.map((m) => ({ text: m.text, at: new Date(m.at).toISOString() })),
                    }
                  : null,
            }
          : null,
      recentWinners: this.recentWinners,
      followCheckAvailable,
      pointsAvailable,
    };
  }

  async open(input: GiveawayInput): Promise<void> {
    if (this.giveaway) throw new ValidationError("Es läuft schon ein Giveaway. Beende es zuerst.");
    const rules = readRules(input);

    if (rules.followerOnly && !(await hasStreamerToken(this.channel))) {
      throw new ValidationError(
        "Für die Follower-Prüfung muss sich der Streamer oder ein Mod einmal neu anmelden, damit Twitch die Follower freigibt."
      );
    }

    let rewardId: string | null = null;
    if (rules.mode === "points") {
      if (!(await hasPointsAccess(this.channel))) {
        throw new ValidationError("Kanalpunkte sind für diesen Kanal noch nicht freigeschaltet. Der Streamer muss sie einmal erlauben.");
      }
      try {
        rewardId = await createReward(this.channel, {
          title: rules.rewardTitle!,
          cost: rules.rewardCost!,
          prompt: REWARD_PROMPT,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (/DUPLICATE/i.test(message)) {
          throw new ValidationError(`Auf Twitch gibt es schon eine Belohnung „${rules.rewardTitle}“. Nimm einen anderen Namen.`);
        }
        if (err instanceof TwitchApiError && err.status === 403) {
          throw new ValidationError("Twitch erlaubt keine Belohnungen für diesen Kanal. Kanalpunkte gibt es nur für Affiliates und Partner.");
        }
        throw new ValidationError(`Twitch hat die Belohnung nicht angelegt: ${message}`);
      }
    }

    this.giveaway = await giveawayStore.create(this.channel, { ...rules, rewardId });
    this.entries.clear();
    this.rejected.clear();
    this.winner = null;
    if (rewardId) this.listen(rewardId);
    log("info", "giveaway", `Giveaway gestartet: ${this.describe(this.giveaway)}`, this.channel);
    this.changed();
  }

  async close(): Promise<void> {
    const g = this.require();
    if (g.status !== "open") return;
    await giveawayStore.setStatus(g.id, "closed");
    g.status = "closed";
    if (g.rewardId) await this.pauseReward(g.rewardId, true);
    log("info", "giveaway", `Teilnahme geschlossen, ${this.entries.size} im Topf`, this.channel);
    this.changed();
  }

  async reopen(): Promise<void> {
    const g = this.require();
    if (g.status !== "closed") return;
    await giveawayStore.setStatus(g.id, "open");
    g.status = "open";
    if (g.rewardId) await this.pauseReward(g.rewardId, false);
    log("info", "giveaway", "Teilnahme wieder offen", this.channel);
    this.changed();
  }

  async draw(): Promise<void> {
    const g = this.require();
    const pool = [...this.entries.values()].filter((e) => e.wonAt === null);

    while (pool.length > 0) {
      const total = pool.reduce((sum, e) => sum + this.weight(g, e), 0);
      let pick = randomInt(total);
      const index = pool.findIndex((e) => (pick -= this.weight(g, e)) < 0);
      const [candidate] = pool.splice(index, 1);

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
    this.listener?.stop();
    this.listener = null;
    if (g.rewardId) {
      await deleteReward(this.channel, g.rewardId).catch((err) =>
        log("warn", "giveaway", `Belohnung nicht gelöscht: ${err instanceof Error ? err.message : String(err)}`, this.channel)
      );
    }
    log("info", "giveaway", `Giveaway beendet: ${this.describe(g)}`, this.channel);
    this.giveaway = null;
    this.entries.clear();
    this.rejected.clear();
    this.winner = null;
    this.changed();
  }

  private describe(g: Giveaway): string {
    const parts = [g.mode === "points" ? `„${g.rewardTitle}“ für ${g.rewardCost} Kanalpunkte` : `„${g.keyword}“ im Chat`];
    if (g.mode === "points" && g.maxTickets > 1) parts.push(`bis ${g.maxTickets} Lose`);
    if (g.followerOnly) parts.push(g.minFollowMinutes > 0 ? `Follower seit ${followAge(g.minFollowMinutes)}` : "nur Follower");
    if (g.subOnly) parts.push("nur Subs");
    if (g.subMultiplier > 1) parts.push(`Sub-Lose ×${g.subMultiplier}`);
    return parts.join(", ");
  }

  private weight(g: Giveaway, e: GiveawayEntry): number {
    return e.tickets * (e.subscriber ? g.subMultiplier : 1);
  }

  private require(): Giveaway {
    if (!this.giveaway) throw new ValidationError("Gerade läuft kein Giveaway.");
    return this.giveaway;
  }

  private listen(rewardId: string): void {
    this.listener?.stop();
    this.listener = new RedemptionListener(this.channel, rewardId);
    this.listener.on("redemption", (r) => {
      this.redemptions = this.redemptions.then(() => this.redeem(r)).catch((err) =>
        log("error", "giveaway", `Einlösung nicht verarbeitet: ${err instanceof Error ? err.message : String(err)}`, this.channel)
      );
    });
    this.listener.start();
  }

  private async pauseReward(rewardId: string, paused: boolean): Promise<void> {
    await setRewardPaused(this.channel, rewardId, paused).catch((err) =>
      log("warn", "giveaway", `Belohnung nicht ${paused ? "pausiert" : "freigegeben"}: ${err instanceof Error ? err.message : String(err)}`, this.channel)
    );
  }

  private async settle(r: Redemption, status: "FULFILLED" | "CANCELED", reason?: string): Promise<void> {
    try {
      await setRedemptionStatus(this.channel, r.rewardId, r.id, status);
    } catch (err) {
      log("warn", "giveaway", `Einlösung von ${r.userName} nicht abgeschlossen: ${err instanceof Error ? err.message : String(err)}`, this.channel);
      return;
    }
    if (status === "CANCELED") log("info", "giveaway", `${r.userName} bekommt die Punkte zurück: ${reason}`, this.channel);
  }

  private async redeem(r: Redemption): Promise<void> {
    const g = this.giveaway;
    if (!g || g.mode !== "points" || g.rewardId !== r.rewardId) return this.settle(r, "CANCELED", "kein laufendes Giveaway");
    if (g.status !== "open") return this.settle(r, "CANCELED", "Teilnahme ist geschlossen");
    if (r.userLogin === this.channel) return this.settle(r, "CANCELED", "der Streamer kann nicht mitmachen");

    const existing = this.entries.get(r.userLogin);
    if (existing?.wonAt) return this.settle(r, "CANCELED", "hat schon gewonnen");
    if (existing && existing.tickets >= g.maxTickets) {
      return this.settle(r, "CANCELED", g.maxTickets === 1 ? "ist schon dabei" : `hat schon ${g.maxTickets} Lose`);
    }

    if (existing) {
      existing.tickets += 1;
      await giveawayStore.setTickets(g.id, existing.login, existing.tickets);
      await this.settle(r, "FULFILLED");
      this.changed();
      return;
    }

    let followedAt: number | null = null;
    if (g.followerOnly) {
      const result = await this.followProblem(g, r.userId);
      if (typeof result === "string") return this.settle(r, "CANCELED", result);
      followedAt = result;
    }

    let subscriber = false;
    if (g.subOnly || g.subMultiplier > 1) {
      const status = await isSubscriber(this.channel, r.userId);
      if (status === undefined && g.subOnly) return this.settle(r, "CANCELED", "Sub-Status nicht prüfbar");
      subscriber = status === true;
      if (g.subOnly && !subscriber) return this.settle(r, "CANCELED", "ist kein Subscriber");
    }

    if (this.giveaway?.id !== g.id) return this.settle(r, "CANCELED", "kein laufendes Giveaway");
    const entry = {
      login: r.userLogin,
      userId: r.userId,
      displayName: r.userName || r.userLogin,
      followedAt,
      enteredAt: Date.now(),
      tickets: 1,
      subscriber,
    };
    await giveawayStore.addEntry(g.id, entry);
    this.entries.set(entry.login, { ...entry, wonAt: null });
    await this.settle(r, "FULFILLED");
    this.changed();
  }

  private readonly onChat = (msg: ChatMessage) => {
    const login = msg.login.toLowerCase();
    if (this.winner?.login === login) {
      this.winner.messages.push({ text: msg.text, at: Date.now() });
      if (this.winner.messages.length > WINNER_MESSAGES) this.winner.messages.shift();
      this.changed();
    }

    const g = this.giveaway;
    if (!g || g.mode !== "chat" || g.status !== "open" || msg.isBroadcaster || !login || !msg.userId) return;
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
      const reject = (reason: string) => {
        this.rejected.set(msg.login, Date.now());
        log("info", "giveaway", `${msg.displayName} nicht aufgenommen: ${reason}`, this.channel);
        this.changed();
      };
      if (g.subOnly && !msg.isSubscriber) return reject("ist kein Subscriber");

      let followedAt: number | null = null;
      if (g.followerOnly) {
        const result = await this.followProblem(g, msg.userId);
        if (typeof result === "string") return reject(result);
        followedAt = result;
      }
      if (this.giveaway?.id !== g.id || g.status !== "open") return;

      const entry = {
        login: msg.login,
        userId: msg.userId,
        displayName: msg.displayName || msg.login,
        followedAt,
        enteredAt: Date.now(),
        tickets: 1,
        subscriber: msg.isSubscriber,
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
