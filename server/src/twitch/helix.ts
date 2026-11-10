import { config } from "../config.js";

let appToken: { value: string; expiresAt: number } | null = null;

async function getAppToken(): Promise<string> {
  if (appToken && appToken.expiresAt > Date.now() + 60_000) return appToken.value;

  const res = await fetch("https://id.twitch.tv/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: config.twitchClientId,
      client_secret: config.twitchClientSecret,
      grant_type: "client_credentials",
    }),
  });
  if (!res.ok) {
    throw new Error(`Twitch-App-Token konnte nicht geholt werden (${res.status}). Stimmen Client-ID und Secret?`);
  }
  const data = (await res.json()) as { access_token: string; expires_in: number };
  appToken = { value: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 };
  return appToken.value;
}

async function helix<T>(path: string, params: Record<string, string>): Promise<T> {
  const url = new URL(`https://api.twitch.tv/helix/${path}`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);

  for (let attempt = 1; attempt <= 2; attempt++) {
    const token = await getAppToken();
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}`, "Client-Id": config.twitchClientId },
    });
    if (res.status === 401 && attempt === 1) {
      appToken = null;
      continue;
    }
    if (!res.ok) throw new Error(`Twitch-API antwortet mit ${res.status} auf /${path}`);
    return (await res.json()) as T;
  }
  throw new Error(`Twitch-API lehnt das App-Token ab (/${path}).`);
}

export interface LiveStream {
  id: string;
  userName: string;
  title: string;
  gameName: string;
  viewers: number;
  startedAt: number;
}

interface HelixStreamsResponse {
  data: {
    id: string;
    user_name: string;
    title: string;
    game_name: string;
    viewer_count: number;
    started_at: string;
  }[];
}

export async function getLiveStream(login: string): Promise<LiveStream | null> {
  const { data } = await helix<HelixStreamsResponse>("streams", { user_login: login });
  const stream = data[0];
  if (!stream) return null;
  return {
    id: stream.id,
    userName: stream.user_name,
    title: stream.title,
    gameName: stream.game_name,
    viewers: stream.viewer_count,
    startedAt: Date.parse(stream.started_at),
  };
}

export interface ChannelProfile {
  displayName: string;
  avatarUrl: string | null;
  gameName: string | null;
  title: string | null;
}

interface HelixUsersResponse {
  data: { id: string; display_name: string; profile_image_url: string }[];
}

interface HelixChannelsResponse {
  data: { game_name: string; title: string }[];
}

const USER_CACHE_MS = 60 * 60 * 1000;

const users = new Map<string, { id: string; avatarUrl: string | null; fetchedAt: number }>();

async function getUser(login: string) {
  const key = login.toLowerCase();
  const cached = users.get(key);
  if (cached && Date.now() - cached.fetchedAt < USER_CACHE_MS) return cached;

  const { data } = await helix<HelixUsersResponse>("users", { login: key });
  const user = data[0];
  if (!user) return null;
  const entry = { id: user.id, avatarUrl: user.profile_image_url || null, fetchedAt: Date.now() };
  users.set(key, entry);
  return entry;
}

export async function getUserId(login: string): Promise<string | null> {
  return (await getUser(login))?.id ?? null;
}

export async function getAvatarUrl(login: string): Promise<string | null> {
  return (await getUser(login))?.avatarUrl ?? null;
}

export interface Clip {
  id: string;
  url: string;
  title: string;
  creatorName: string;
  thumbnailUrl: string;
  views: number;
  createdAt: number;
}

interface HelixClipsResponse {
  data: {
    id: string;
    url: string;
    title: string;
    creator_name: string;
    thumbnail_url: string;
    view_count: number;
    created_at: string;
  }[];
}

export async function getClips(login: string, from: number, to: number): Promise<Clip[]> {
  const broadcasterId = await getUserId(login);
  if (!broadcasterId) return [];
  const { data } = await helix<HelixClipsResponse>("clips", {
    broadcaster_id: broadcasterId,
    started_at: new Date(from).toISOString(),
    ended_at: new Date(to).toISOString(),
    first: "100",
  });
  return data.map((c) => ({
    id: c.id,
    url: c.url,
    title: c.title,
    creatorName: c.creator_name,
    thumbnailUrl: c.thumbnail_url,
    views: c.view_count,
    createdAt: Date.parse(c.created_at),
  }));
}

export async function getChannelProfile(login: string): Promise<ChannelProfile | null> {
  const users = await helix<HelixUsersResponse>("users", { login });
  const user = users.data[0];
  if (!user) return null;

  const channels = await helix<HelixChannelsResponse>("channels", { broadcaster_id: user.id });
  const channel = channels.data[0];

  return {
    displayName: user.display_name,
    avatarUrl: user.profile_image_url || null,
    gameName: channel?.game_name || null,
    title: channel?.title || null,
  };
}
