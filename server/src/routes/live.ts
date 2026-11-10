import type { FastifyInstance } from "fastify";
import type { WebSocket } from "ws";
import { isAllowedOrigin, userFromRequest } from "../auth.js";
import { logEvents, recentLogs, type LogEntry } from "../logger.js";
import type { ModuleManager } from "../modules/manager.js";
import { getStatsOverview } from "../stream/stats.js";
import { listSummaries, summaryEvents } from "../summaries.js";
import type { TwitchHub } from "../twitch/hub.js";

export async function liveRoutes(
  app: FastifyInstance,
  opts: { manager: ModuleManager; hub: TwitchHub }
): Promise<void> {
  const { manager, hub } = opts;
  const clients = new Set<WebSocket>();

  function broadcast(message: unknown): void {
    const data = JSON.stringify(message);
    for (const socket of clients) {
      if (socket.readyState === socket.OPEN) socket.send(data);
    }
  }

  const onLog = (entry: LogEntry) => broadcast({ type: "log", entry });
  let summaryTimer: NodeJS.Timeout | null = null;
  const onSummaries = () => {
    if (clients.size === 0 || summaryTimer) return;
    summaryTimer = setTimeout(async () => {
      summaryTimer = null;
      try {
        const [summaries, stats] = await Promise.all([listSummaries(), getStatsOverview()]);
        broadcast({ type: "summaries", summaries });
        broadcast({ type: "stats", stats });
      } catch (err) {
        app.log.error(err);
      }
    }, 1000);
  };
  const onModules = () => {
    broadcast({ type: "modules", modules: manager.list() });
    onSummaries();
  };
  const onStatus = (connected: boolean) =>
    broadcast({ type: "twitch", twitch: { connected, channel: hub.channel } });

  logEvents.on("entry", onLog);
  manager.on("changed", onModules);
  hub.on("status", onStatus);
  summaryEvents.on("changed", onSummaries);

  const heartbeat = setInterval(() => {
    for (const socket of clients) {
      if (socket.readyState === socket.OPEN) socket.ping();
    }
  }, 30_000);

  app.addHook("onClose", async () => {
    clearInterval(heartbeat);
    if (summaryTimer) clearTimeout(summaryTimer);
    logEvents.off("entry", onLog);
    manager.off("changed", onModules);
    hub.off("status", onStatus);
    summaryEvents.off("changed", onSummaries);
    for (const socket of clients) socket.close(1001, "Server wird beendet");
  });

  app.get(
    "/ws",
    {
      websocket: true,
      preValidation: async (request, reply) => {
        if (!isAllowedOrigin(request)) {
          await reply.code(403).send({ error: "Ungültige Herkunft." });
          return;
        }
        const user = await userFromRequest(request);
        if (!user) {
          await reply.code(401).send({ error: "Nicht angemeldet." });
          return;
        }
        request.user = user;
      },
    },
    async (socket) => {
      clients.add(socket);
      socket.on("close", () => clients.delete(socket));
      socket.on("error", () => clients.delete(socket));
      const [summaries, stats] = await Promise.all([listSummaries(), getStatsOverview()]);
      if (socket.readyState !== socket.OPEN) return;
      socket.send(
        JSON.stringify({
          type: "snapshot",
          modules: manager.list(),
          logs: recentLogs(),
          summaries,
          stats,
          twitch: { connected: hub.connected, channel: hub.channel },
        })
      );
    }
  );
}
