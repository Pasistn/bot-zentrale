import { db } from "./connection.js";

export type StreamEventType = "raid" | "gift" | "sub" | "cheer";

export interface StreamEvent {
  type: StreamEventType;
  login: string;
  displayName: string;
  amount: number;
  createdAt: number;
}

export const streamEventStore = {
  async add(channel: string, event: Omit<StreamEvent, "createdAt">, createdAt = Date.now()): Promise<void> {
    await db.run(
      "INSERT INTO stream_events (channel, type, login, display_name, amount, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      [channel, event.type, event.login, event.displayName, event.amount, createdAt]
    );
  },

  async between(channel: string, from: number, to: number): Promise<StreamEvent[]> {
    const rows = await db.all<{
      type: StreamEventType;
      login: string;
      display_name: string;
      amount: number;
      created_at: number;
    }>(
      `SELECT type, login, display_name, amount, created_at FROM stream_events
       WHERE channel = ? AND created_at >= ? AND created_at <= ? ORDER BY created_at`,
      [channel, from, to]
    );
    return rows.map((r) => ({
      type: r.type,
      login: r.login,
      displayName: r.display_name,
      amount: r.amount,
      createdAt: r.created_at,
    }));
  },

  async purgeBefore(time: number): Promise<number> {
    return db.run("DELETE FROM stream_events WHERE created_at < ?", [time]);
  },
};

export type StreamSessionStatus = "live" | "pending" | "posted" | "discarded";

export interface StreamSession {
  id: number;
  channel: string;
  streamId: string;
  streamer: string;
  title: string;
  games: string[];
  startedAt: number;
  lastSeenAt: number;
  endedAt: number | null;
  peakViewers: number;
  chatMessages: number;
  viewerSum: number;
  viewerSamples: number;
  followersStart: number | null;
  followersEnd: number | null;
  status: StreamSessionStatus;
  postedAt: number | null;
  postError: string | null;
}

interface StreamSessionRow {
  id: number;
  channel: string;
  stream_id: string;
  streamer: string;
  title: string;
  games: string;
  started_at: number;
  last_seen_at: number;
  ended_at: number | null;
  peak_viewers: number;
  chat_messages: number;
  viewer_sum: number;
  viewer_samples: number;
  followers_start: number | null;
  followers_end: number | null;
  status: StreamSessionStatus;
  posted_at: number | null;
  post_error: string | null;
}

function toStreamSession(row: StreamSessionRow): StreamSession {
  let games: string[];
  try {
    games = JSON.parse(row.games);
  } catch {
    games = [];
  }
  return {
    id: Number(row.id),
    channel: row.channel,
    streamId: row.stream_id,
    streamer: row.streamer,
    title: row.title,
    games,
    startedAt: row.started_at,
    lastSeenAt: row.last_seen_at,
    endedAt: row.ended_at,
    peakViewers: row.peak_viewers,
    chatMessages: row.chat_messages ?? 0,
    viewerSum: row.viewer_sum ?? 0,
    viewerSamples: row.viewer_samples ?? 0,
    followersStart: row.followers_start,
    followersEnd: row.followers_end,
    status: row.status,
    postedAt: row.posted_at,
    postError: row.post_error,
  };
}

export const streamSessionStore = {
  async get(channel: string, id: number): Promise<StreamSession | null> {
    const row = await db.get<StreamSessionRow>("SELECT * FROM stream_sessions WHERE channel = ? AND id = ?", [
      channel,
      id,
    ]);
    return row ? toStreamSession(row) : null;
  },

  async live(channel: string): Promise<StreamSession | null> {
    const row = await db.get<StreamSessionRow>(
      "SELECT * FROM stream_sessions WHERE channel = ? AND status = 'live' ORDER BY id DESC LIMIT 1",
      [channel]
    );
    return row ? toStreamSession(row) : null;
  },

  async recent(channel: string, limit: number): Promise<StreamSession[]> {
    const rows = await db.all<StreamSessionRow>(
      "SELECT * FROM stream_sessions WHERE channel = ? ORDER BY started_at DESC LIMIT ?",
      [channel, limit]
    );
    return rows.map(toStreamSession);
  },

  async open(input: {
    channel: string;
    streamId: string;
    streamer: string;
    title: string;
    game: string;
    startedAt: number;
    viewers: number;
    followers: number | null;
  }): Promise<StreamSession> {
    const row = await db.get<{ id: number }>(
      `INSERT INTO stream_sessions
         (channel, stream_id, streamer, title, games, started_at, last_seen_at, peak_viewers, viewer_sum,
          viewer_samples, followers_start, followers_end)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
       RETURNING id`,
      [
        input.channel,
        input.streamId,
        input.streamer,
        input.title,
        JSON.stringify(input.game ? [input.game] : []),
        input.startedAt,
        Date.now(),
        input.viewers,
        input.viewers,
        input.followers,
        input.followers,
      ]
    );
    return (await this.get(input.channel, Number(row!.id)))!;
  },

  async seen(
    session: StreamSession,
    input: { streamId: string; title: string; game: string; viewers: number; followers: number | null }
  ): Promise<void> {
    const games = input.game && !session.games.includes(input.game) ? [...session.games, input.game] : session.games;
    await db.run(
      `UPDATE stream_sessions
       SET stream_id = ?, title = ?, games = ?, last_seen_at = ?,
           peak_viewers = CASE WHEN peak_viewers > ? THEN peak_viewers ELSE ? END,
           viewer_sum = viewer_sum + ?, viewer_samples = viewer_samples + 1,
           followers_start = COALESCE(followers_start, ?),
           followers_end = COALESCE(?, followers_end)
       WHERE id = ?`,
      [
        input.streamId,
        input.title,
        JSON.stringify(games),
        Date.now(),
        input.viewers,
        input.viewers,
        input.viewers,
        input.followers,
        input.followers,
        session.id,
      ]
    );
  },

  async addMessageCount(id: number, count: number): Promise<void> {
    await db.run("UPDATE stream_sessions SET chat_messages = chat_messages + ? WHERE id = ? AND status = 'live'", [
      count,
      id,
    ]);
  },

  async end(id: number, endedAt: number): Promise<void> {
    await db.run("UPDATE stream_sessions SET ended_at = ?, status = 'pending' WHERE id = ? AND status = 'live'", [
      endedAt,
      id,
    ]);
  },

  async markPosted(id: number): Promise<void> {
    await db.run("UPDATE stream_sessions SET status = 'posted', posted_at = ?, post_error = NULL WHERE id = ?", [
      Date.now(),
      id,
    ]);
  },

  async markFailed(id: number, error: string): Promise<void> {
    await db.run("UPDATE stream_sessions SET post_error = ? WHERE id = ?", [error, id]);
  },

  async markDiscarded(id: number): Promise<void> {
    await db.run("UPDATE stream_sessions SET status = 'discarded', post_error = NULL WHERE id = ?", [id]);
  },
};
