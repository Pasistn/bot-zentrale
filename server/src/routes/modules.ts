import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { isAllowedOrigin, requireAuth } from "../auth.js";
import type { ChannelRegistry, ChannelRuntime } from "../channels.js";
import { recentLogs } from "../logger.js";
import { getStatsOverview } from "../stream/stats.js";
import { NotFoundError, ValidationError } from "../modules/manager.js";
import type { TwitchChat } from "../twitch/chat.js";

export function handleError(reply: FastifyReply, err: unknown) {
  if (err instanceof NotFoundError) return reply.code(404).send({ error: err.message });
  if (err instanceof ValidationError) return reply.code(400).send({ error: err.message });
  throw err;
}

export class ChannelUnavailableError extends Error {}

export function runtimeFor(registry: ChannelRegistry, request: FastifyRequest): ChannelRuntime {
  const runtime = registry.get(request.channel);
  if (!runtime) throw new ChannelUnavailableError("Der Kanal ist gerade nicht aktiv.");
  return runtime;
}

export async function protectedRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", requireAuth);

  app.addHook("preHandler", async (request, reply) => {
    if (request.method !== "GET" && !isAllowedOrigin(request)) {
      await reply.code(403).send({ error: "Ungültige Herkunft." });
    }
  });

  app.setErrorHandler((err, _request, reply) => {
    if (err instanceof ChannelUnavailableError) return reply.code(503).send({ error: err.message });
    throw err;
  });
}

export async function moduleRoutes(
  app: FastifyInstance,
  opts: { registry: ChannelRegistry; chat: TwitchChat }
): Promise<void> {
  const { registry, chat } = opts;
  await protectedRoutes(app);

  app.get("/api/status", async (request) => ({
    twitch: { connected: chat.connected, channel: request.channel },
  }));

  app.get("/api/modules", async (request) => ({ modules: runtimeFor(registry, request).manager.list() }));

  app.get("/api/logs", async (request) => ({ logs: recentLogs(request.channel) }));

  app.get("/api/stats", async (request) => ({ stats: await getStatsOverview(request.channel) }));

  app.post<{ Params: { id: string }; Body: { enabled?: unknown } }>(
    "/api/modules/:id/enabled",
    async (request, reply) => {
      const enabled = request.body?.enabled;
      if (typeof enabled !== "boolean") {
        return reply.code(400).send({ error: "„enabled“ muss true oder false sein." });
      }
      try {
        return { module: await runtimeFor(registry, request).manager.setEnabled(request.params.id, enabled) };
      } catch (err) {
        return handleError(reply, err);
      }
    }
  );

  app.put<{ Params: { id: string }; Body: unknown }>("/api/modules/:id/settings", async (request, reply) => {
    try {
      return { module: await runtimeFor(registry, request).manager.updateSettings(request.params.id, request.body) };
    } catch (err) {
      return handleError(reply, err);
    }
  });

  app.post<{ Params: { id: string; actionId: string } }>(
    "/api/modules/:id/actions/:actionId",
    async (request, reply) => {
      try {
        const message = await runtimeFor(registry, request).manager.runAction(
          request.params.id,
          request.params.actionId
        );
        return { message };
      } catch (err) {
        return handleError(reply, err);
      }
    }
  );
}
