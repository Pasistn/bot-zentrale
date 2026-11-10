import type { FastifyInstance } from "fastify";
import type { ChannelRegistry } from "../channels.js";
import { discardSummary, listSummaries, postSummary } from "../summaries.js";
import { handleError, protectedRoutes, runtimeFor } from "./modules.js";

export async function summaryRoutes(app: FastifyInstance, opts: { registry: ChannelRegistry }): Promise<void> {
  const { registry } = opts;
  await protectedRoutes(app);

  app.get("/api/summaries", async (request) => ({ summaries: await listSummaries(request.channel) }));

  app.post<{ Params: { id: string } }>("/api/summaries/:id/post", async (request, reply) => {
    const id = Number(request.params.id);
    if (!Number.isInteger(id)) return reply.code(400).send({ error: "Ungültige ID." });
    try {
      const settings = runtimeFor(registry, request).manager.requireSettings("stream-summary");
      return { summary: await postSummary(request.channel, id, settings) };
    } catch (err) {
      return handleError(reply, err);
    }
  });

  app.post<{ Params: { id: string } }>("/api/summaries/:id/discard", async (request, reply) => {
    const id = Number(request.params.id);
    if (!Number.isInteger(id)) return reply.code(400).send({ error: "Ungültige ID." });
    try {
      return { summary: await discardSummary(request.channel, id) };
    } catch (err) {
      return handleError(reply, err);
    }
  });
}
