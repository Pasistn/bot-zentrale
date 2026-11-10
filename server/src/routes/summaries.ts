import type { FastifyInstance } from "fastify";
import { isAllowedOrigin, requireAuth } from "../auth.js";
import type { ModuleManager } from "../modules/manager.js";
import { discardSummary, listSummaries, postSummary } from "../summaries.js";
import type { TwitchHub } from "../twitch/hub.js";
import { handleError } from "./modules.js";

export async function summaryRoutes(
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

  app.get("/api/summaries", async () => ({ summaries: await listSummaries() }));

  app.post<{ Params: { id: string } }>("/api/summaries/:id/post", async (request, reply) => {
    const id = Number(request.params.id);
    if (!Number.isInteger(id)) return reply.code(400).send({ error: "Ungültige ID." });
    try {
      const settings = manager.requireSettings("stream-summary");
      return { summary: await postSummary(id, settings, hub.channel) };
    } catch (err) {
      return handleError(reply, err);
    }
  });

  app.post<{ Params: { id: string } }>("/api/summaries/:id/discard", async (request, reply) => {
    const id = Number(request.params.id);
    if (!Number.isInteger(id)) return reply.code(400).send({ error: "Ungültige ID." });
    try {
      return { summary: await discardSummary(id) };
    } catch (err) {
      return handleError(reply, err);
    }
  });
}
