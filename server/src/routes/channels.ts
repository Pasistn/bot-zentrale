import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { canManageAccess, isOwner, LOGIN_PATTERN, normalizeLogin, type ChannelRegistry } from "../channels.js";
import { accessStore, channelStore } from "../db.js";
import { log } from "../logger.js";
import { getChannelProfile } from "../twitch/helix.js";
import { protectedRoutes } from "./modules.js";

async function requireOwner(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (!isOwner(request.user!.login)) await reply.code(403).send({ error: "Nur für Betreiber der Zentrale." });
}

async function requireAccessManager(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (!canManageAccess(request.user!.login, request.channel)) {
    await reply.code(403).send({ error: "Nur der Streamer selbst kann den Zugriff verwalten." });
  }
}

function readLogin(body: unknown): string | null {
  const login = normalizeLogin((body as { login?: unknown } | undefined)?.login);
  return LOGIN_PATTERN.test(login) ? login : null;
}

export async function channelRoutes(app: FastifyInstance, opts: { registry: ChannelRegistry }): Promise<void> {
  const { registry } = opts;
  await protectedRoutes(app);

  const channelList = () =>
    channelStore.list().map((c) => ({
      login: c.login,
      displayName: c.displayName,
      createdAt: new Date(c.createdAt).toISOString(),
      access: accessStore.list(c.login),
    }));

  app.get("/api/channels", { preHandler: requireOwner }, async () => ({ channels: channelList() }));

  app.post("/api/channels", { preHandler: requireOwner }, async (request, reply) => {
    const login = readLogin(request.body);
    if (!login) return reply.code(400).send({ error: "Bitte einen gültigen Twitch-Namen eingeben." });
    if (channelStore.get(login)) return reply.code(400).send({ error: `#${login} ist schon freigeschaltet.` });

    const profile = await getChannelProfile(login).catch(() => null);
    if (!profile) return reply.code(400).send({ error: `Twitch kennt keinen Kanal „${login}“.` });

    await registry.add(login, profile.displayName);
    log("info", "channels", `${request.user!.login} hat #${login} freigeschaltet`);
    return { channels: channelList() };
  });

  app.delete<{ Params: { login: string } }>(
    "/api/channels/:login",
    { preHandler: requireOwner },
    async (request, reply) => {
      const login = normalizeLogin(request.params.login);
      if (!channelStore.get(login)) return reply.code(404).send({ error: "Diesen Kanal gibt es nicht." });
      await registry.remove(login);
      log("info", "channels", `${request.user!.login} hat #${login} entfernt`);
      return { channels: channelList() };
    }
  );

  app.get("/api/access", { preHandler: requireAccessManager }, async (request) => ({
    logins: accessStore.list(request.channel),
  }));

  app.post("/api/access", { preHandler: requireAccessManager }, async (request, reply) => {
    const login = readLogin(request.body);
    if (!login) return reply.code(400).send({ error: "Bitte einen gültigen Twitch-Namen eingeben." });
    if (login === request.channel) return reply.code(400).send({ error: "Der Streamer hat immer Zugriff." });
    await accessStore.add(request.channel, login);
    log("info", "channels", `Zugriff für ${login} freigegeben`, request.channel);
    return { logins: accessStore.list(request.channel) };
  });

  app.delete<{ Params: { login: string } }>(
    "/api/access/:login",
    { preHandler: requireAccessManager },
    async (request) => {
      const login = normalizeLogin(request.params.login);
      await accessStore.remove(request.channel, login);
      registry.emit("accessRevoked", request.channel, login);
      log("info", "channels", `Zugriff für ${login} entzogen`, request.channel);
      return { logins: accessStore.list(request.channel) };
    }
  );
}
