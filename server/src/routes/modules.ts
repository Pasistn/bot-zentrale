import type { FastifyInstance, FastifyReply } from "fastify";
import { isAllowedOrigin, requireAuth } from "../auth.js";
import { recentLogs } from "../logger.js";
import { getStatsOverview } from "../stream/stats.js";
import { NotFoundError, ValidationError, type ModuleManager } from "../modules/manager.js";
import type { TwitchHub } from "../twitch/hub.js";

export function handleError(reply: FastifyReply, err: unknown) {
  if (err instanceof NotFoundError) return reply.code(404).send({ error: err.message });
  if (err instanceof ValidationError) return reply.code(400).send({ error: err.message });
  throw err;
}

export async function moduleRoutes(
  app: FastifyInstance,
  opts: { manager: ModuleManager; hub: TwitchHub }
): Promise<void> {
  const { manager, hub } = opts;

  app.addHook("preHandler", requireAuth);

  app.addHook("preHandler", async (request, reply) => {
    if (request.method !== "GET" && !isAllowedOrigin(request)) {
      await reply.code(403).send({ error: "Ungültige Herkunft." });
    }
  });

  app.get("/api/status", async () => ({
    twitch: { connected: hub.connected, channel: hub.channel },
  }));

  app.get("/api/modules", async () => ({ modules: manager.list() }));

  app.get("/api/logs", async () => ({ logs: recentLogs() }));

  app.get("/api/stats", async () => ({ stats: await getStatsOverview() }));

  app.post<{ Params: { id: string }; Body: { enabled?: unknown } }>(
    "/api/modules/:id/enabled",
    async (request, reply) => {
      const enabled = request.body?.enabled;
      if (typeof enabled !== "boolean") {
        return reply.code(400).send({ error: "„enabled“ muss true oder false sein." });
      }
      try {
        return { module: await manager.setEnabled(request.params.id, enabled) };
      } catch (err) {
        return handleError(reply, err);
      }
    }
  );

  app.put<{ Params: { id: string }; Body: unknown }>("/api/modules/:id/settings", async (request, reply) => {
    try {
      return { module: await manager.updateSettings(request.params.id, request.body) };
    } catch (err) {
      return handleError(reply, err);
    }
  });

  app.post<{ Params: { id: string; actionId: string } }>(
    "/api/modules/:id/actions/:actionId",
    async (request, reply) => {
      try {
        const message = await manager.runAction(request.params.id, request.params.actionId);
        return { message };
      } catch (err) {
        return handleError(reply, err);
      }
    }
  );
}
