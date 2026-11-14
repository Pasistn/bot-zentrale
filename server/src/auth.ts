import { randomBytes } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { config } from "./config.js";
import { canAccess, canManageAccess, channelsFor, defaultChannelFor, isOwner } from "./channels.js";
import { channelStore, sessionStore, type Session, type SessionUser } from "./db.js";
import { log } from "./logger.js";
import { keepLoginToken, LOGIN_SCOPES, revokeToken, STREAMER_SCOPES, type LoginTokens } from "./twitch/user-token.js";

declare module "fastify" {
  interface FastifyRequest {
    user: SessionUser | null;
    channel: string;
  }
}

const SESSION_COOKIE = "bz_session";
const AUTH_LIMIT = { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } };
const STATE_COOKIE = "bz_oauth_state";

function cookieBase() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: config.secureCookies,
    signed: true,
  };
}

function sessionId(request: FastifyRequest): string | null {
  const raw = request.cookies[SESSION_COOKIE];
  if (!raw) return null;
  const unsigned = request.unsignCookie(raw);
  return unsigned.valid && unsigned.value ? unsigned.value : null;
}

export async function sessionFromRequest(request: FastifyRequest): Promise<Session | null> {
  const id = sessionId(request);
  if (!id) return null;
  const session = await sessionStore.get(id);
  if (!session) return null;
  if (canAccess(session.user.login, session.channel)) return session;

  const fallback = defaultChannelFor(session.user.login);
  if (!fallback) {
    await sessionStore.delete(id);
    return null;
  }
  await sessionStore.setChannel(id, fallback);
  return { ...session, channel: fallback };
}

export async function requireAuth(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const session = await sessionFromRequest(request);
  if (!session) {
    await reply.code(401).send({ error: "Nicht angemeldet." });
    return;
  }
  request.user = session.user;
  request.channel = session.channel;
}

export function isAllowedOrigin(request: FastifyRequest): boolean {
  const origin = request.headers.origin;
  if (!origin) return true;
  return origin === config.publicOrigin;
}

function redirectWithError(reply: FastifyReply, code: string) {
  return reply.redirect(`${config.publicUrl}/?login_error=${encodeURIComponent(code)}`);
}

interface TwitchTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  scope?: string[];
}

interface TwitchUsersResponse {
  data: { id: string; login: string; display_name: string; profile_image_url: string }[];
}

async function exchangeCode(code: string): Promise<LoginTokens> {
  const res = await fetch("https://id.twitch.tv/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: config.twitchClientId,
      client_secret: config.twitchClientSecret,
      code,
      grant_type: "authorization_code",
      redirect_uri: config.redirectUri,
    }),
  });
  if (!res.ok) {
    throw new Error(`Token-Tausch fehlgeschlagen (${res.status}): ${(await res.text()).slice(0, 200)}`);
  }
  const data = (await res.json()) as TwitchTokenResponse;
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresIn: data.expires_in,
    scopes: data.scope ?? [],
  };
}

async function fetchTwitchUser(accessToken: string): Promise<SessionUser> {
  const res = await fetch("https://api.twitch.tv/helix/users", {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Client-Id": config.twitchClientId,
    },
  });
  if (!res.ok) throw new Error(`Twitch-Profil konnte nicht geladen werden (${res.status}).`);
  const data = (await res.json()) as TwitchUsersResponse;
  const user = data.data[0];
  if (!user) throw new Error("Twitch hat kein Profil zurückgegeben.");
  return {
    id: user.id,
    login: user.login.toLowerCase(),
    displayName: user.display_name,
    avatarUrl: user.profile_image_url || null,
  };
}

export async function authRoutes(app: FastifyInstance): Promise<void> {
  app.decorateRequest("user", null);
  app.decorateRequest("channel", "");

  app.get<{ Querystring: { streamer?: string } }>("/auth/login", AUTH_LIMIT, async (request, reply) => {
    const state = randomBytes(24).toString("hex");
    const streamer = request.query.streamer === "1";
    reply.setCookie(STATE_COOKIE, `${state}.${streamer ? 1 : 0}`, { ...cookieBase(), path: "/auth", maxAge: 600 });

    const url = new URL("https://id.twitch.tv/oauth2/authorize");
    url.searchParams.set("client_id", config.twitchClientId);
    url.searchParams.set("redirect_uri", config.redirectUri);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", (streamer ? [...LOGIN_SCOPES, ...STREAMER_SCOPES] : LOGIN_SCOPES).join(" "));
    url.searchParams.set("state", state);

    return reply.redirect(url.toString());
  });

  app.get<{ Querystring: { code?: string; state?: string; error?: string } }>(
    "/auth/callback",
    AUTH_LIMIT,
    async (request, reply) => {
      const { code, state, error } = request.query;
      const rawState = request.cookies[STATE_COOKIE];
      reply.clearCookie(STATE_COOKIE, { path: "/auth" });

      if (error) return redirectWithError(reply, "denied");

      const storedState = rawState ? request.unsignCookie(rawState) : null;
      const [expectedState, streamerFlag] = (storedState?.valid ? (storedState.value ?? "") : "").split(".");
      if (!code || !state || !expectedState || expectedState !== state) {
        log("warn", "auth", "Login abgelehnt: ungültiger oder abgelaufener State");
        return redirectWithError(reply, "state");
      }

      let user: SessionUser;
      let tokens: LoginTokens;
      try {
        tokens = await exchangeCode(code);
        user = await fetchTwitchUser(tokens.accessToken);
      } catch (err) {
        log("error", "auth", err instanceof Error ? err.message : String(err));
        return redirectWithError(reply, "twitch");
      }

      const channel = defaultChannelFor(user.login);
      if (!channel) {
        await revokeToken(tokens.accessToken);
        log("warn", "auth", `Login verweigert für ${user.login}, kein freigeschalteter Kanal`);
        return redirectWithError(reply, "forbidden");
      }
      await channelStore.setDisplayName(user.login, user.displayName);

      const kept = await keepLoginToken(user.login, user.id, tokens).catch((err) => {
        log("warn", "auth", `Twitch-Zugang nicht gespeichert: ${err instanceof Error ? err.message : String(err)}`);
        return false;
      });
      if (!kept) await revokeToken(tokens.accessToken);

      const sessionId = randomBytes(32).toString("hex");
      const maxAgeSeconds = Math.round(config.sessionDays * 24 * 60 * 60);
      await sessionStore.create(sessionId, user, channel, Date.now() + maxAgeSeconds * 1000);

      reply.setCookie(SESSION_COOKIE, sessionId, { ...cookieBase(), path: "/", maxAge: maxAgeSeconds });
      log("info", "auth", `${user.displayName} hat sich angemeldet`, channel);
      if (streamerFlag === "1") {
        if (kept) log("info", "auth", "Kanalpunkte und Sub-Status für den Bot freigegeben", channel);
        return reply.redirect(`${config.publicUrl}/#giveaway`);
      }
      return reply.redirect(`${config.publicUrl}/`);
    }
  );

  app.post("/auth/logout", async (request, reply) => {
    if (!isAllowedOrigin(request)) return reply.code(403).send({ error: "Ungültige Herkunft." });
    const id = sessionId(request);
    if (id) await sessionStore.delete(id);
    reply.clearCookie(SESSION_COOKIE, { path: "/" });
    return { ok: true };
  });

  app.get("/api/me", { preHandler: requireAuth }, async (request) => {
    const login = request.user!.login;
    return {
      user: request.user,
      channel: request.channel,
      channels: channelsFor(login).map((c) => ({ login: c.login, displayName: c.displayName })),
      owner: isOwner(login),
      canManageAccess: canManageAccess(login, request.channel),
    };
  });

  app.post<{ Body: { channel?: unknown } }>("/api/me/channel", { preHandler: requireAuth }, async (request, reply) => {
    if (!isAllowedOrigin(request)) return reply.code(403).send({ error: "Ungültige Herkunft." });
    const channel = String(request.body?.channel ?? "");
    if (!canAccess(request.user!.login, channel))
      return reply.code(403).send({ error: "Kein Zugriff auf diesen Kanal." });
    await sessionStore.setChannel(sessionId(request)!, channel);
    return { channel };
  });
}
