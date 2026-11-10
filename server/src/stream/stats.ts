import { streamEventStore, streamSessionStore, type StreamSession } from "../db.js";
import { hasStreamerToken } from "../twitch/user-token.js";

const LIST_LIMIT = 20;

export interface StreamStats {
  id: number;
  live: boolean;
  streamer: string;
  title: string;
  games: string[];
  startedAt: string;
  endedAt: string | null;
  durationMinutes: number;
  avgViewers: number;
  peakViewers: number;
  newFollowers: number | null;
  chatMessages: number;
  subs: number;
  giftedSubs: number;
  bits: number;
  raids: number;
  raidViewers: number;
}

export interface StatsOverview {
  streams: StreamStats[];
  followersAvailable: boolean;
}

async function toStats(session: StreamSession): Promise<StreamStats> {
  const until = session.endedAt ?? Date.now();
  const events = await streamEventStore.between(session.startedAt, until);
  const sum = (type: string) => events.filter((e) => e.type === type).reduce((total, e) => total + e.amount, 0);
  const raids = events.filter((e) => e.type === "raid");

  const followers =
    session.followersStart !== null && session.followersEnd !== null
      ? Math.max(0, session.followersEnd - session.followersStart)
      : null;

  return {
    id: session.id,
    live: session.status === "live",
    streamer: session.streamer,
    title: session.title,
    games: session.games,
    startedAt: new Date(session.startedAt).toISOString(),
    endedAt: session.endedAt ? new Date(session.endedAt).toISOString() : null,
    durationMinutes: Math.max(0, Math.round((until - session.startedAt) / 60_000)),
    avgViewers: session.viewerSamples > 0 ? Math.round(session.viewerSum / session.viewerSamples) : session.peakViewers,
    peakViewers: session.peakViewers,
    newFollowers: followers,
    chatMessages: session.chatMessages,
    subs: sum("sub"),
    giftedSubs: sum("gift"),
    bits: sum("cheer"),
    raids: raids.length,
    raidViewers: raids.reduce((total, e) => total + e.amount, 0),
  };
}

export async function getStatsOverview(): Promise<StatsOverview> {
  const sessions = await streamSessionStore.recent(LIST_LIMIT);
  return {
    streams: await Promise.all(sessions.map(toStats)),
    followersAvailable: await hasStreamerToken(),
  };
}
