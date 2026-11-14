import { config } from "../config.js";
import { accessStore, channelStore, twitchTokenStore, type TwitchToken } from "../db.js";
import { getUserId } from "./helix.js";

export const LOGIN_SCOPES = ["moderator:read:followers"];
export const STREAMER_SCOPES = ["channel:manage:redemptions", "channel:read:subscriptions"];

export interface LoginTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  scopes: string[];
}

async function tokenTarget(login: string): Promise<string | null> {
  if (channelStore.get(login)) return login;
  for (const channel of accessStore.channelsOf(login)) {
    if (!(await twitchTokenStore.get(channel))) return channel;
  }
  return null;
}

export async function keepLoginToken(login: string, userId: string, tokens: LoginTokens): Promise<boolean> {
  const hasScopes = LOGIN_SCOPES.every((s) => tokens.scopes.includes(s));
  if (!hasScopes || !tokens.refreshToken) return false;

  const channel = await tokenTarget(login);
  if (!channel) return false;

  const existing = await twitchTokenStore.get(channel);
  const wouldLoseScopes = existing?.userId === userId && existing.scopes.some((s) => !tokens.scopes.includes(s));
  if (wouldLoseScopes) return false;

  await twitchTokenStore.save({
    login: channel,
    userId,
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    scopes: tokens.scopes,
    expiresAt: Date.now() + tokens.expiresIn * 1000,
  });
  return true;
}

export async function revokeToken(accessToken: string): Promise<void> {
  await fetch("https://id.twitch.tv/oauth2/revoke", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: config.twitchClientId, token: accessToken }),
  }).catch(() => undefined);
}

export async function forgetStreamerToken(channel: string): Promise<void> {
  const token = await twitchTokenStore.get(channel);
  if (!token) return;
  await twitchTokenStore.delete(channel);
  await revokeToken(token.refreshToken);
}

const refreshing = new Map<string, Promise<TwitchToken | null>>();

function refresh(token: TwitchToken): Promise<TwitchToken | null> {
  const running = refreshing.get(token.login);
  if (running) return running;
  const task = requestRefresh(token).finally(() => refreshing.delete(token.login));
  refreshing.set(token.login, task);
  return task;
}

async function requestRefresh(token: TwitchToken): Promise<TwitchToken | null> {
  const stored = await twitchTokenStore.get(token.login);
  if (!stored) return null;
  if (stored.accessToken !== token.accessToken && stored.expiresAt > Date.now() + 60_000) return stored;

  const res = await fetch("https://id.twitch.tv/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: config.twitchClientId,
      client_secret: config.twitchClientSecret,
      grant_type: "refresh_token",
      refresh_token: stored.refreshToken,
    }),
  });
  if (res.status === 400 || res.status === 401) {
    const latest = await twitchTokenStore.get(token.login);
    if (latest && latest.refreshToken !== stored.refreshToken) return latest;
    await twitchTokenStore.delete(token.login);
    return null;
  }
  if (!res.ok) throw new Error(`Twitch-Token konnte nicht erneuert werden (${res.status}).`);
  const data = (await res.json()) as {
    access_token: string;
    refresh_token: string;
    expires_in: number;
    scope?: string[];
  };
  const next: TwitchToken = {
    ...stored,
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: Date.now() + data.expires_in * 1000,
    scopes: data.scope ?? stored.scopes,
  };
  await twitchTokenStore.save(next);
  return next;
}

export async function hasStreamerToken(channel: string): Promise<boolean> {
  return (await twitchTokenStore.get(channel)) !== null;
}

export async function hasPointsAccess(channel: string): Promise<boolean> {
  const token = await twitchTokenStore.get(channel);
  if (!token || !STREAMER_SCOPES.every((s) => token.scopes.includes(s))) return false;
  return token.userId === (await getUserId(channel));
}

export class TwitchApiError extends Error {
  constructor(
    message: string,
    public readonly status: number
  ) {
    super(message);
  }
}

interface StreamerRequest {
  method?: string;
  path: string;
  params?: Record<string, string>;
  body?: unknown;
  accept?: number[];
}

async function streamerRequest<T>(
  channel: string,
  request: StreamerRequest
): Promise<{ status: number; data: T | null } | null> {
  let token = await twitchTokenStore.get(channel);
  if (!token) return null;

  const broadcasterId = await getUserId(channel);
  if (!broadcasterId) return null;

  for (let attempt = 1; attempt <= 2; attempt++) {
    if (token.expiresAt < Date.now() + 60_000) {
      token = await refresh(token);
      if (!token) return null;
    }
    const url = new URL(`https://api.twitch.tv/helix/${request.path}`);
    if (request.path !== "eventsub/subscriptions") url.searchParams.set("broadcaster_id", broadcasterId);
    for (const [key, value] of Object.entries(request.params ?? {})) url.searchParams.set(key, value);
    const res = await fetch(url, {
      method: request.method ?? "GET",
      headers: {
        Authorization: `Bearer ${token.accessToken}`,
        "Client-Id": config.twitchClientId,
        ...(request.body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: request.body !== undefined ? JSON.stringify(request.body) : undefined,
    });
    if (res.status === 401 && attempt === 1) {
      token = { ...token, expiresAt: 0 };
      continue;
    }
    if (!res.ok && !(request.accept ?? []).includes(res.status)) {
      const detail = ((await res.json().catch(() => ({}))) as { message?: string }).message;
      throw new TwitchApiError(
        `Twitch-API antwortet mit ${res.status} auf /${request.path}${detail ? `: ${detail}` : ""}`,
        res.status
      );
    }
    const data = res.status === 204 ? null : ((await res.json().catch(() => null)) as T | null);
    return { status: res.status, data };
  }
  return null;
}

interface FollowersResponse {
  total: number;
  data: { user_id: string; followed_at: string }[];
}

export async function getFollowerCount(channel: string): Promise<number | null> {
  const result = await streamerRequest<FollowersResponse>(channel, {
    path: "channels/followers",
    params: { first: "1" },
  });
  return result?.data?.total ?? null;
}

export async function getFollowedAt(channel: string, userId: string): Promise<number | null | undefined> {
  const result = await streamerRequest<FollowersResponse>(channel, {
    path: "channels/followers",
    params: { user_id: userId },
  });
  if (!result?.data) return undefined;
  const entry = result.data.data[0];
  return entry ? Date.parse(entry.followed_at) : null;
}

export async function isSubscriber(channel: string, userId: string): Promise<boolean | undefined> {
  const result = await streamerRequest<{ data: unknown[] }>(channel, {
    path: "subscriptions",
    params: { user_id: userId },
    accept: [404],
  });
  if (!result) return undefined;
  return result.status === 200 && (result.data?.data.length ?? 0) > 0;
}

export async function createReward(
  channel: string,
  input: { title: string; cost: number; prompt: string }
): Promise<string> {
  const result = await streamerRequest<{ data: { id: string }[] }>(channel, {
    method: "POST",
    path: "channel_points/custom_rewards",
    body: { ...input, is_enabled: true, should_redemptions_skip_request_queue: false, background_color: "#6FA8FF" },
  });
  const id = result?.data?.data[0]?.id;
  if (!id) throw new Error("Twitch hat die Belohnung nicht angelegt.");
  return id;
}

export async function setRewardPaused(channel: string, rewardId: string, paused: boolean): Promise<void> {
  await streamerRequest(channel, {
    method: "PATCH",
    path: "channel_points/custom_rewards",
    params: { id: rewardId },
    body: { is_paused: paused },
    accept: [404],
  });
}

export async function deleteReward(channel: string, rewardId: string): Promise<void> {
  await streamerRequest(channel, {
    method: "DELETE",
    path: "channel_points/custom_rewards",
    params: { id: rewardId },
    accept: [404],
  });
}

export async function setRedemptionStatus(
  channel: string,
  rewardId: string,
  redemptionId: string,
  status: "FULFILLED" | "CANCELED"
): Promise<void> {
  await streamerRequest(channel, {
    method: "PATCH",
    path: "channel_points/custom_rewards/redemptions",
    params: { reward_id: rewardId, id: redemptionId },
    body: { status },
    accept: [404],
  });
}

export async function subscribeToRedemptions(channel: string, sessionId: string, rewardId: string): Promise<void> {
  const broadcasterId = await getUserId(channel);
  if (!broadcasterId) throw new Error(`Twitch kennt den Kanal ${channel} nicht.`);
  const result = await streamerRequest(channel, {
    method: "POST",
    path: "eventsub/subscriptions",
    body: {
      type: "channel.channel_points_custom_reward_redemption.add",
      version: "1",
      condition: { broadcaster_user_id: broadcasterId, reward_id: rewardId },
      transport: { method: "websocket", session_id: sessionId },
    },
  });
  if (!result) throw new Error("Kein Twitch-Zugang für diesen Kanal.");
}
