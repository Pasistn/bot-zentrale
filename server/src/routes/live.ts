import type { FastifyInstance } from "fastify";
import type { WebSocket } from "ws";
import { isAllowedOrigin, sessionFromRequest } from "../auth.js";
import type { ChannelRegistry } from "../channels.js";
import { logEvents, recentLogs, type LogEntry } from "../logger.js";
import { getStatsOverview } from "../stream/stats.js";
import { listSummaries, summaryEvents } from "../summaries.js";
import type { TwitchChat } from "../twitch/chat.js";

const CLOSE_CHANNEL_REMOVED = 4003;

export async function liveRoutes(
  app: FastifyInstance,
  opts: { registry: ChannelRegistry; chat: TwitchChat }
): Promise<void> {
  const { registry, chat } = opts;
  const clients = new Map<WebSocket, string>();

  function broadcast(channel: string, message: unknown): void {
    const data = JSON.stringify(message);
    for (const [socket, ch] of clients) {
      if (ch === channel && socket.readyState === socket.OPEN) socket.send(data);
    }
  }

  const watched = (channel: string) => [...clients.values()].includes(channel);

  const onLog = (channel: string, entry: LogEntry) => broadcast(channel, { type: "log", entry });

  const summaryTimers = new Map<string, NodeJS.Timeout>();
  const onSummaries = (channel: string) => {
    if (!watched(channel) || summaryTimers.has(channel)) return;
    summaryTimers.set(
      channel,
      setTimeout(async () => {
        summaryTimers.delete(channel);
        try {
          const [summaries, stats] = await Promise.all([listSummaries(channel), getStatsOverview(channel)]);
          broadcast(channel, { type: "summaries", summaries });
          broadcast(channel, { type: "stats", stats });
        } catch (err) {
          app.log.error(err);
        }
      }, 1000)
    );
  };

  const onModules = (channel: string) => {
    const runtime = registry.get(channel);
    if (!runtime || !watched(channel)) return;
    broadcast(channel, { type: "modules", modules: runtime.manager.list() });
    onSummaries(channel);
  };

  const onGiveaway = async (channel: string) => {
    const runtime = registry.get(channel);
    if (!runtime || !watched(channel)) return;
    try {
      broadcast(channel, { type: "giveaway", giveaway: await runtime.giveaway.view() });
    } catch (err) {
      app.log.error(err);
    }
  };

  const onStatus = (connected: boolean) => {
    for (const channel of new Set(clients.values())) broadcast(channel, { type: "twitch", twitch: { connected, channel } });
  };

  const onRemoved = (channel: string) => {
    for (const [socket, ch] of clients) {
      if (ch === channel) socket.close(CLOSE_CHANNEL_REMOVED, "Kanal entfernt");
    }
  };

  logEvents.on("entry", onLog);
  registry.on("modules", onModules);
  registry.on("giveaway", onGiveaway);
  registry.on("removed", onRemoved);
  chat.on("status", onStatus);
  summaryEvents.on("changed", onSummaries);

  const heartbeat = setInterval(() => {
    for (const socket of clients.keys()) {
      if (socket.readyState === socket.OPEN) socket.ping();
    }
  }, 30_000);

  app.addHook("onClose", async () => {
    clearInterval(heartbeat);
    for (const timer of summaryTimers.values()) clearTimeout(timer);
    logEvents.off("entry", onLog);
    registry.off("modules", onModules);
    registry.off("giveaway", onGiveaway);
    registry.off("removed", onRemoved);
    chat.off("status", onStatus);
    summaryEvents.off("changed", onSummaries);
    for (const socket of clients.keys()) socket.close(1001, "Server wird beendet");
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
        const session = await sessionFromRequest(request);
        if (!session) {
          await reply.code(401).send({ error: "Nicht angemeldet." });
          return;
        }
        request.user = session.user;
        request.channel = session.channel;
      },
    },
    async (socket, request) => {
      const channel = request.channel;
      clients.set(socket, channel);
      socket.on("close", () => clients.delete(socket));
      socket.on("error", () => clients.delete(socket));

      const runtime = registry.get(channel);
      const [summaries, stats, giveaway] = await Promise.all([
        listSummaries(channel),
        getStatsOverview(channel),
        runtime ? runtime.giveaway.view() : null,
      ]);
      if (socket.readyState !== socket.OPEN) return;
      socket.send(
        JSON.stringify({
          type: "snapshot",
          modules: runtime?.manager.list() ?? [],
          logs: recentLogs(channel),
          summaries,
          stats,
          giveaway,
          twitch: { connected: chat.connected, channel },
        })
      );
    }
  );
}
