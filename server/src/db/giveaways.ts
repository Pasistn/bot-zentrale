import { db } from "./connection.js";

export type GiveawayStatus = "open" | "closed" | "ended";
export type GiveawayMode = "chat" | "points";

export interface GiveawayRules {
  mode: GiveawayMode;
  keyword: string;
  rewardTitle: string | null;
  rewardCost: number | null;
  maxTickets: number;
  followerOnly: boolean;
  minFollowMinutes: number;
  subOnly: boolean;
  subMultiplier: number;
}

export interface Giveaway extends GiveawayRules {
  id: number;
  channel: string;
  rewardId: string | null;
  status: GiveawayStatus;
  createdAt: number;
  endedAt: number | null;
}

export interface GiveawayEntry {
  login: string;
  userId: string;
  displayName: string;
  followedAt: number | null;
  enteredAt: number;
  wonAt: number | null;
  tickets: number;
  subscriber: boolean;
}

interface GiveawayRow {
  id: number;
  channel: string;
  keyword: string;
  entry_mode: GiveawayMode;
  reward_id: string | null;
  reward_title: string | null;
  reward_cost: number | null;
  max_tickets: number;
  follower_only: number;
  min_follow_minutes: number;
  sub_only: number;
  sub_multiplier: number;
  status: GiveawayStatus;
  created_at: number;
  ended_at: number | null;
}

interface GiveawayEntryRow {
  login: string;
  user_id: string;
  display_name: string;
  followed_at: number | null;
  entered_at: number;
  won_at: number | null;
  tickets: number;
  subscriber: number;
}

const toGiveaway = (r: GiveawayRow): Giveaway => ({
  id: Number(r.id),
  channel: r.channel,
  mode: r.entry_mode,
  keyword: r.keyword,
  rewardId: r.reward_id,
  rewardTitle: r.reward_title,
  rewardCost: r.reward_cost === null ? null : Number(r.reward_cost),
  maxTickets: Number(r.max_tickets),
  followerOnly: Number(r.follower_only) === 1,
  minFollowMinutes: Number(r.min_follow_minutes),
  subOnly: Number(r.sub_only) === 1,
  subMultiplier: Number(r.sub_multiplier),
  status: r.status,
  createdAt: r.created_at,
  endedAt: r.ended_at,
});

const toEntry = (r: GiveawayEntryRow): GiveawayEntry => ({
  login: r.login,
  userId: r.user_id,
  displayName: r.display_name,
  followedAt: r.followed_at,
  enteredAt: r.entered_at,
  wonAt: r.won_at,
  tickets: Number(r.tickets),
  subscriber: Number(r.subscriber) === 1,
});

const ENTRY_COLUMNS = "login, user_id, display_name, followed_at, entered_at, won_at, tickets, subscriber";

export const giveawayStore = {
  async current(channel: string): Promise<Giveaway | null> {
    const row = await db.get<GiveawayRow>(
      "SELECT * FROM giveaways WHERE channel = ? AND status <> 'ended' ORDER BY id DESC LIMIT 1",
      [channel]
    );
    return row ? toGiveaway(row) : null;
  },

  async create(channel: string, rules: GiveawayRules & { rewardId?: string | null }): Promise<Giveaway> {
    const row = await db.get<GiveawayRow>(
      `INSERT INTO giveaways (channel, keyword, entry_mode, reward_id, reward_title, reward_cost, max_tickets,
         follower_only, min_follow_minutes, sub_only, sub_multiplier, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?) RETURNING *`,
      [
        channel,
        rules.keyword,
        rules.mode,
        rules.rewardId ?? null,
        rules.rewardTitle,
        rules.rewardCost,
        rules.maxTickets,
        rules.followerOnly ? 1 : 0,
        rules.minFollowMinutes,
        rules.subOnly ? 1 : 0,
        rules.subMultiplier,
        Date.now(),
      ]
    );
    return toGiveaway(row!);
  },

  async setStatus(id: number, status: GiveawayStatus): Promise<void> {
    await db.run("UPDATE giveaways SET status = ?, ended_at = ? WHERE id = ?", [
      status,
      status === "ended" ? Date.now() : null,
      id,
    ]);
  },

  async entries(id: number): Promise<GiveawayEntry[]> {
    const rows = await db.all<GiveawayEntryRow>(
      `SELECT ${ENTRY_COLUMNS} FROM giveaway_entries WHERE giveaway_id = ? ORDER BY entered_at`,
      [id]
    );
    return rows.map(toEntry);
  },

  async addEntry(id: number, entry: Omit<GiveawayEntry, "wonAt">): Promise<boolean> {
    const changed = await db.run(
      `INSERT INTO giveaway_entries (giveaway_id, login, user_id, display_name, followed_at, entered_at, tickets, subscriber)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING`,
      [
        id,
        entry.login,
        entry.userId,
        entry.displayName,
        entry.followedAt,
        entry.enteredAt,
        entry.tickets,
        entry.subscriber ? 1 : 0,
      ]
    );
    return changed > 0;
  },

  async setTickets(id: number, login: string, tickets: number): Promise<void> {
    await db.run("UPDATE giveaway_entries SET tickets = ? WHERE giveaway_id = ? AND login = ?", [tickets, id, login]);
  },

  async removeEntry(id: number, login: string): Promise<void> {
    await db.run("DELETE FROM giveaway_entries WHERE giveaway_id = ? AND login = ?", [id, login]);
  },

  async markWinner(id: number, login: string): Promise<void> {
    await db.run("UPDATE giveaway_entries SET won_at = ? WHERE giveaway_id = ? AND login = ?", [Date.now(), id, login]);
  },

  async history(channel: string, limit: number): Promise<GiveawaySummary[]> {
    const rows = await db.all<GiveawayRow & { entry_count: number; ticket_count: number }>(
      `SELECT g.*, COUNT(e.login) AS entry_count, COALESCE(SUM(e.tickets), 0) AS ticket_count
       FROM giveaways g LEFT JOIN giveaway_entries e ON e.giveaway_id = g.id
       WHERE g.channel = ? AND g.status = 'ended'
       GROUP BY g.id ORDER BY g.created_at DESC LIMIT ?`,
      [channel, limit]
    );
    if (rows.length === 0) return [];

    const ids = rows.map((r) => Number(r.id));
    const winners = await db.all<{ giveaway_id: number; display_name: string; won_at: number }>(
      `SELECT giveaway_id, display_name, won_at FROM giveaway_entries
       WHERE won_at IS NOT NULL AND giveaway_id IN (${ids.map(() => "?").join(", ")}) ORDER BY won_at`,
      ids
    );
    return rows.map((r) => ({
      ...toGiveaway(r),
      entryCount: Number(r.entry_count),
      ticketCount: Number(r.ticket_count),
      winners: winners
        .filter((w) => Number(w.giveaway_id) === Number(r.id))
        .map((w) => ({ displayName: w.display_name, wonAt: w.won_at })),
    }));
  },

  async endedEntries(channel: string, id: number): Promise<GiveawayEntry[] | null> {
    const owner = await db.get("SELECT id FROM giveaways WHERE channel = ? AND id = ? AND status = 'ended'", [
      channel,
      id,
    ]);
    if (!owner) return null;
    return this.entries(id);
  },
};

export interface GiveawaySummary extends Giveaway {
  entryCount: number;
  ticketCount: number;
  winners: { displayName: string; wonAt: number }[];
}
