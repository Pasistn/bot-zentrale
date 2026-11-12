import { EventEmitter } from "node:events";
import type { GiftSub, HubEvents, Raid, Sub, SubTier, WatchStreak } from "./types.js";

type Tags = Record<string, unknown>;

const COMMUNITY_GIFT_WINDOW_MS = 5 * 60 * 1000;

function unescapeTag(value: string): string {
  return value.replace(/\\(.)/g, (_match, ch: string) => {
    switch (ch) {
      case "s":
        return " ";
      case ":":
        return ";";
      case "r":
        return "\r";
      case "n":
        return "\n";
      default:
        return ch;
    }
  });
}

function tagString(tags: Tags, key: string): string | null {
  const value = tags[key];
  if (value === undefined || value === null || typeof value === "boolean") return null;
  const str = unescapeTag(String(value)).trim();
  return str === "" ? null : str;
}

function tagNumber(tags: Tags, key: string): number | null {
  const str = tagString(tags, key);
  if (str === null) return null;
  const num = Number(str);
  return Number.isFinite(num) ? num : null;
}

export function parseWatchStreak(command: string, tags: Tags, params: unknown[]): WatchStreak | null {
  if (command !== "USERNOTICE") return null;
  if (tagString(tags, "msg-id") !== "viewermilestone") return null;
  if (tagString(tags, "msg-param-category") !== "watch-streak") return null;

  const streak = tagNumber(tags, "msg-param-value");
  if (streak === null) return null;

  const login = tagString(tags, "login") ?? "";
  const rawMessage = typeof params[1] === "string" ? params[1].trim() : "";

  return {
    displayName: tagString(tags, "display-name") ?? (login || "Unbekannt"),
    login,
    streak,
    channelPoints: tagNumber(tags, "msg-param-copoReward"),
    userMessage: rawMessage === "" ? null : rawMessage,
  };
}

export function parseRaid(command: string, tags: Tags): Raid | null {
  if (command !== "USERNOTICE") return null;
  if (tagString(tags, "msg-id") !== "raid") return null;

  const viewers = tagNumber(tags, "msg-param-viewerCount");
  const login = (tagString(tags, "msg-param-login") ?? tagString(tags, "login") ?? "").toLowerCase();
  if (viewers === null || login === "") return null;

  return {
    login,
    displayName: tagString(tags, "msg-param-displayName") ?? tagString(tags, "display-name") ?? login,
    viewers,
  };
}

function parseTier(plan: string | null): SubTier {
  if (plan === "2000") return 2;
  if (plan === "3000") return 3;
  return 1;
}

export function parseSub(command: string, tags: Tags, params: unknown[]): Sub | null {
  if (command !== "USERNOTICE") return null;
  const msgId = tagString(tags, "msg-id");
  if (msgId !== "sub" && msgId !== "resub") return null;

  const login = tagString(tags, "login")?.toLowerCase() ?? "";
  const plan = tagString(tags, "msg-param-sub-plan");
  const rawMessage = typeof params[1] === "string" ? params[1].trim() : "";

  return {
    login,
    displayName: tagString(tags, "display-name") ?? (login || "Unbekannt"),
    months: Math.max(1, tagNumber(tags, "msg-param-cumulative-months") ?? 1),
    firstTime: msgId === "sub",
    tier: parseTier(plan),
    prime: plan === "Prime",
    userMessage: rawMessage === "" ? null : rawMessage,
  };
}

const ANONYMOUS_GIFTER = "ananonymousgifter";

export interface ParsedGift {
  community: boolean;
  communityGiftId: string | null;
  gift: GiftSub;
}

export function parseGiftSub(command: string, tags: Tags): ParsedGift | null {
  if (command !== "USERNOTICE") return null;
  const msgId = tagString(tags, "msg-id") ?? "";
  const community = msgId === "submysterygift" || msgId === "anonsubmysterygift";
  const single = msgId === "subgift" || msgId === "anonsubgift";
  if (!community && !single) return null;

  const login = tagString(tags, "login")?.toLowerCase() ?? null;
  const anonymous = msgId.startsWith("anon") || login === null || login === ANONYMOUS_GIFTER;
  const amount = community ? tagNumber(tags, "msg-param-mass-gift-count") ?? 1 : 1;
  const senderTotal = tagNumber(tags, "msg-param-sender-count");

  return {
    community,
    communityGiftId: single ? tagString(tags, "msg-param-community-gift-id") : null,
    gift: {
      gifterLogin: anonymous ? null : login,
      gifterName: anonymous ? "Anonym" : tagString(tags, "display-name") ?? login ?? "Unbekannt",
      amount,
      tier: parseTier(tagString(tags, "msg-param-sub-plan")),
      recipientName: single ? tagString(tags, "msg-param-recipient-display-name") : null,
      senderTotal: senderTotal !== null && senderTotal > 0 ? senderTotal : null,
    },
  };
}

export type ChatUserstate = Record<string, unknown> & {
  username?: string;
  "display-name"?: string;
  badges?: Record<string, string | undefined> | null;
  mod?: boolean;
  subscriber?: boolean;
  bits?: string;
};

export class TwitchHub extends EventEmitter<HubEvents> {
  private readonly pendingCommunityGifts = new Map<string, { remaining: number; expiresAt: number }>();

  constructor(
    public readonly channel: string,
    private readonly isConnected: () => boolean
  ) {
    super();
    this.setMaxListeners(50);
  }

  get connected(): boolean {
    return this.isConnected();
  }

  handleRaw(command: string, tags: Tags, params: unknown[]): void {
    const streak = parseWatchStreak(command, tags, params);
    if (streak) this.emit("watchStreak", streak);

    const raid = parseRaid(command, tags);
    if (raid) this.emit("raid", raid);

    const sub = parseSub(command, tags, params);
    if (sub) this.emit("sub", sub);

    const gift = parseGiftSub(command, tags);
    if (gift) this.handleGift(gift);
  }

  handleChat(userstate: ChatUserstate, text: string): void {
    const badges = userstate.badges ?? {};
    const login = userstate.username ?? "";
    const displayName = userstate["display-name"] ?? login;
    this.emit("chat", {
      userId: String(userstate["user-id"] ?? ""),
      login,
      displayName,
      text,
      isMod: userstate.mod === true,
      isBroadcaster: badges.broadcaster === "1",
      isSubscriber: userstate.subscriber === true,
    });

    const bits = Number(userstate.bits ?? 0);
    if (bits > 0) this.emit("cheer", { login, displayName, bits });
  }

  private handleGift({ community, communityGiftId, gift }: ParsedGift): void {
    const now = Date.now();
    for (const [key, entry] of this.pendingCommunityGifts) {
      if (entry.expiresAt < now || entry.remaining <= 0) this.pendingCommunityGifts.delete(key);
    }

    const key = gift.gifterLogin ?? ANONYMOUS_GIFTER;

    if (community) {
      const open = this.pendingCommunityGifts.get(key)?.remaining ?? 0;
      this.pendingCommunityGifts.set(key, {
        remaining: open + gift.amount,
        expiresAt: now + COMMUNITY_GIFT_WINDOW_MS,
      });
      this.emit("giftSub", gift);
      return;
    }

    const pending = this.pendingCommunityGifts.get(key);
    if (communityGiftId && pending && pending.remaining > 0) {
      pending.remaining--;
      return;
    }

    this.emit("giftSub", gift);
  }
}
