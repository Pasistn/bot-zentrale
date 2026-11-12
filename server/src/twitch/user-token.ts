import { config } from "../config.js";
import { accessStore, channelStore, twitchTokenStore, type TwitchToken } from "../db.js";
import { getUserId } from "./helix.js";

export const LOGIN_SCOPES = ["moderator:read:followers"];

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

async function refresh(token: TwitchToken): Promise<TwitchToken | null> {
  const res = await fetch("https://id.twitch.tv/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: config.twitchClientId,
      client_secret: config.twitchClientSecret,
      grant_type: "refresh_token",
      refresh_token: token.refreshToken,
    }),
  });
  if (res.status === 400 || res.status === 401) {
    await twitchTokenStore.delete(token.login);
    return null;
  }
  if (!res.ok) throw new Error(`Twitch-Token konnte nicht erneuert werden (${res.status}).`);
  const data = (await res.json()) as { access_token: string; refresh_token: string; expires_in: number; scope?: string[] };
  const next: TwitchToken = {
    ...token,
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: Date.now() + data.expires_in * 1000,
    scopes: data.scope ?? token.scopes,
  };
  await twitchTokenStore.save(next);
  return next;
}

export async function hasStreamerToken(channel: string): Promise<boolean> {
  return (await twitchTokenStore.get(channel)) !== null;
}

interface FollowersResponse {
  total: number;
  data: { user_id: string; followed_at: string }[];
}

async function followers(channel: string, params: Record<string, string>): Promise<FollowersResponse | null> {
  let token = await twitchTokenStore.get(channel);
  if (!token) return null;

  const broadcasterId = await getUserId(channel);
  if (!broadcasterId) return null;

  for (let attempt = 1; attempt <= 2; attempt++) {
    if (token.expiresAt < Date.now() + 60_000) {
      token = await refresh(token);
      if (!token) return null;
    }
    const url = new URL("https://api.twitch.tv/helix/channels/followers");
    url.searchParams.set("broadcaster_id", broadcasterId);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token.accessToken}`, "Client-Id": config.twitchClientId },
    });
    if (res.status === 401 && attempt === 1) {
      token = { ...token, expiresAt: 0 };
      continue;
    }
    if (!res.ok) throw new Error(`Twitch-API antwortet mit ${res.status} auf /channels/followers`);
    return (await res.json()) as FollowersResponse;
  }
  return null;
}

export async function getFollowerCount(channel: string): Promise<number | null> {
  return (await followers(channel, { first: "1" }))?.total ?? null;
}

export async function getFollowedAt(channel: string, userId: string): Promise<number | null | undefined> {
  const result = await followers(channel, { user_id: userId });
  if (!result) return undefined;
  const entry = result.data[0];
  return entry ? Date.parse(entry.followed_at) : null;
}
