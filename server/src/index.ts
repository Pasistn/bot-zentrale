import Fastify from "fastify";
import fastifyCookie from "@fastify/cookie";
import fastifyStatic from "@fastify/static";
import fastifyWebsocket from "@fastify/websocket";
import { existsSync } from "node:fs";
import { config } from "./config.js";
import { closeDb, initDb, sessionStore } from "./db.js";
import { log } from "./logger.js";
import { authRoutes } from "./auth.js";
import { createModules } from "./modules/index.js";
import { ModuleManager } from "./modules/manager.js";
import { moduleRoutes } from "./routes/modules.js";
import { liveRoutes } from "./routes/live.js";
import { mediaRoutes } from "./routes/media.js";
import { overlayRoutes } from "./routes/overlays.js";
import { summaryRoutes } from "./routes/summaries.js";
import { StreamTracker } from "./stream/tracker.js";
import { TwitchHub } from "./twitch/hub.js";

async function main(): Promise<void> {
  await initDb((level, message) => log(level, "db", message));

  const hub = new TwitchHub(config.twitchChannel);
  const tracker = new StreamTracker(hub);
  const manager = new ModuleManager(hub, tracker, createModules());

  const app = Fastify({ logger: false, trustProxy: true, bodyLimit: 64 * 1024 });

  await app.register(fastifyCookie, { secret: config.sessionSecret });
  await app.register(fastifyWebsocket);
  await app.register(authRoutes);
  await app.register(moduleRoutes, { manager, hub });
  await app.register(summaryRoutes, { manager, hub });
  await app.register(liveRoutes, { manager, hub });
  await app.register(overlayRoutes, { manager });
  await app.register(mediaRoutes);

  if (existsSync(config.webDist)) {
    await app.register(fastifyStatic, { root: config.webDist, wildcard: false });
    app.setNotFoundHandler((request, reply) => {
      const isApi = request.url.startsWith("/api") || request.url.startsWith("/auth") || request.url.startsWith("/ws") || request.url.startsWith("/overlay");
      if (request.method === "GET" && !isApi) return reply.sendFile("index.html");
      return reply.code(404).send({ error: "Nicht gefunden." });
    });
  }

  app.setErrorHandler((err, _request, reply) => {
    log("error", "server", err.message);
    const status = err.statusCode && err.statusCode < 500 ? err.statusCode : 500;
    reply.code(status).send({ error: status === 500 ? "Interner Serverfehler." : err.message });
  });

  const purgeTimer = setInterval(async () => {
    const removed = await sessionStore.purgeExpired().catch(() => 0);
    if (removed > 0) log("info", "auth", `${removed} abgelaufene Sitzung(en) entfernt`);
  }, 60 * 60 * 1000);

  await manager.init();
  await hub.start();
  await tracker.start();
  await app.listen({ port: config.port, host: config.host });

  log("info", "server", `Läuft auf http://${config.host}:${config.port}`);
  log("info", "server", `Dashboard: ${config.publicUrl}`);
  if (!existsSync(config.webDist)) {
    log("info", "server", "Kein Web-Build gefunden. Im Entwicklungsmodus liefert Vite das Dashboard aus.");
  }

  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    log("info", "server", "Wird beendet ...");
    clearInterval(purgeTimer);
    await manager.shutdown();
    await tracker.stop();
    await hub.stop();
    await app.close();
    await closeDb();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  if (process.send) {
    process.on("message", (message) => {
      if (message === "shutdown") void shutdown();
    });
    process.on("disconnect", () => void shutdown());
  }
}

main().catch((err) => {
  console.error("Start fehlgeschlagen:", err);
  process.exit(1);
});
