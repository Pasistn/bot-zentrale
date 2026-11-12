import type { FastifyInstance } from "fastify";
import type { ChannelRegistry } from "../channels.js";
import type { GiveawayInput } from "../giveaway.js";
import { handleError, protectedRoutes, runtimeFor } from "./modules.js";

export async function giveawayRoutes(app: FastifyInstance, opts: { registry: ChannelRegistry }): Promise<void> {
  const { registry } = opts;
  await protectedRoutes(app);

  const giveaway = (request: Parameters<typeof runtimeFor>[1]) => runtimeFor(registry, request).giveaway;

  app.get("/api/giveaway", async (request) => ({ giveaway: await giveaway(request).view() }));

  app.post<{ Body: GiveawayInput }>("/api/giveaway", async (request, reply) => {
    try {
      const service = giveaway(request);
      await service.open(request.body ?? {});
      return { giveaway: await service.view() };
    } catch (err) {
      return handleError(reply, err);
    }
  });

  for (const action of ["close", "reopen", "draw", "end"] as const) {
    app.post(`/api/giveaway/${action}`, async (request, reply) => {
      try {
        const service = giveaway(request);
        await service[action]();
        return { giveaway: await service.view() };
      } catch (err) {
        return handleError(reply, err);
      }
    });
  }

  app.get<{ Params: { id: string } }>("/api/giveaway/history/:id", async (request, reply) => {
    const id = Number(request.params.id);
    if (!Number.isInteger(id)) return reply.code(400).send({ error: "Ungültige ID." });
    try {
      return { entries: await giveaway(request).pastEntries(id) };
    } catch (err) {
      return handleError(reply, err);
    }
  });

  app.delete<{ Params: { login: string } }>("/api/giveaway/entries/:login", async (request, reply) => {
    try {
      const service = giveaway(request);
      await service.remove(request.params.login.toLowerCase());
      return { giveaway: await service.view() };
    } catch (err) {
      return handleError(reply, err);
    }
  });
}
