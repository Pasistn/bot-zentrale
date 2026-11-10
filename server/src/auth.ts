import { randomBytes } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { config } from "./config.js";
import { sessionStore, type SessionUser } from "./db.js";
import { log } from "./logger.js";
import { keepLoginToken, LOGIN_SCOPES, type LoginTokens } from "./twitch/user-token.js";

declare module "fastify" {
  interface FastifyRequest {
    user: SessionUser | null;
  }
}

const SESSION_COOKIE = "bz_session";
const STATE_COOKIE = "bz_oauth_state";

function cookieBase() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: config.secureCookies,
    signed: true,
  };
}

export async function userFromRequest(request: FastifyRequest): Promise<SessionUser | null> {
  const raw = request.cookies[SESSION_COOKIE];
  if (!raw) return null;
  const unsigned = request.unsignCookie(raw);
  if (!unsigned.valid || !unsigned.value) return null;
  return sessionStore.get(unsigned.value);
}

export async function requireAuth(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const user = await userFromRequest(request);
  if (!user) {
    await reply.code(401).send({ error: "Nicht angemeldet." });
    return;
  }
  request.user = user;
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

async function revokeToken(accessToken: string): Promise<void> {
  await fetch("https://id.twitch.tv/oauth2/revoke", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: config.twitchClientId, token: accessToken }),
  }).catch(() => undefined);
}

export async function authRoutes(app: FastifyInstance): Promise<void> {
  app.decorateRequest("user", null);

  app.get("/auth/login", async (_request, reply) => {
    const state = randomBytes(24).toString("hex");
    reply.setCookie(STATE_COOKIE, state, { ...cookieBase(), path: "/auth", maxAge: 600 });

    const url = new URL("https://id.twitch.tv/oauth2/authorize");
    url.searchParams.set("client_id", config.twitchClientId);
    url.searchParams.set("redirect_uri", config.redirectUri);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", LOGIN_SCOPES.join(" "));
    url.searchParams.set("state", state);

    return reply.redirect(url.toString());
  });

  app.get<{ Querystring: { code?: string; state?: string; error?: string } }>(
    "/auth/callback",
    async (request, reply) => {
      const { code, state, error } = request.query;
      const rawState = request.cookies[STATE_COOKIE];
      reply.clearCookie(STATE_COOKIE, { path: "/auth" });

      if (error) return redirectWithError(reply, "denied");

      const storedState = rawState ? request.unsignCookie(rawState) : null;
      if (!code || !state || !storedState?.valid || storedState.value !== state) {
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

      if (!config.adminLogins.includes(user.login)) {
        await revokeToken(tokens.accessToken);
        log("warn", "auth", `Login verweigert für ${user.login} (nicht in ADMIN_LOGINS)`);
        return redirectWithError(reply, "forbidden");
      }

      const kept = await keepLoginToken(user.login, user.id, tokens).catch((err) => {
        log("warn", "auth", `Twitch-Zugang nicht gespeichert: ${err instanceof Error ? err.message : String(err)}`);
        return false;
      });
      if (!kept) await revokeToken(tokens.accessToken);

      const sessionId = randomBytes(32).toString("hex");
      const maxAgeSeconds = Math.round(config.sessionDays * 24 * 60 * 60);
      await sessionStore.create(sessionId, user, Date.now() + maxAgeSeconds * 1000);

      reply.setCookie(SESSION_COOKIE, sessionId, { ...cookieBase(), path: "/", maxAge: maxAgeSeconds });
      log("info", "auth", `${user.displayName} hat sich angemeldet`);
      return reply.redirect(`${config.publicUrl}/`);
    }
  );

  app.post("/auth/logout", async (request, reply) => {
    if (!isAllowedOrigin(request)) return reply.code(403).send({ error: "Ungültige Herkunft." });
    const raw = request.cookies[SESSION_COOKIE];
    if (raw) {
      const unsigned = request.unsignCookie(raw);
      if (unsigned.valid && unsigned.value) await sessionStore.delete(unsigned.value);
    }
    reply.clearCookie(SESSION_COOKIE, { path: "/" });
    return { ok: true };
  });

  app.get("/api/me", { preHandler: requireAuth }, async (request) => {
    return { user: request.user };
  });
}
