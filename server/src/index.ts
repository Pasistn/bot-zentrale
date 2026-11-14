import Fastify from "fastify";
import fastifyCookie from "@fastify/cookie";
import fastifyRateLimit from "@fastify/rate-limit";
import fastifyStatic from "@fastify/static";
import fastifyWebsocket from "@fastify/websocket";
import { existsSync } from "node:fs";
import { config } from "./config.js";
import { closeDb, initDb, sessionStore } from "./db.js";
import { log } from "./logger.js";
import { authRoutes } from "./auth.js";
import { moduleRoutes } from "./routes/modules.js";
import { liveRoutes } from "./routes/live.js";
import { mediaRoutes } from "./routes/media.js";
import { overlayRoutes } from "./routes/overlays.js";
import { summaryRoutes } from "./routes/summaries.js";
import { ChannelRegistry } from "./channels.js";
import { channelRoutes } from "./routes/channels.js";
import { giveawayRoutes } from "./routes/giveaway.js";
import { TwitchChat } from "./twitch/chat.js";

const TWITCH_IMAGES = "https://static-cdn.jtvnw.net";

const DASHBOARD_CSP = [
  "default-src 'self'",
  `img-src 'self' data: ${TWITCH_IMAGES}`,
  "media-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self'",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

const OVERLAY_CSP = [
  "default-src 'self'",
  `img-src 'self' data: ${TWITCH_IMAGES}`,
  "media-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "frame-ancestors 'self'",
].join("; ");

async function main(): Promise<void> {
  await initDb((level, message) => log(level, "db", message));

  const chat = new TwitchChat();
  const registry = new ChannelRegistry(chat);

  const app = Fastify({ logger: false, trustProxy: "loopback", bodyLimit: 64 * 1024 });

  app.addHook("onSend", async (request, reply) => {
    const overlay = request.url.startsWith("/overlay");
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header("Referrer-Policy", "strict-origin-when-cross-origin");
    reply.header("X-Frame-Options", overlay ? "SAMEORIGIN" : "DENY");
    reply.header("Content-Security-Policy", overlay ? OVERLAY_CSP : DASHBOARD_CSP);
    if (config.secureCookies) reply.header("Strict-Transport-Security", "max-age=31536000");
  });

  await app.register(fastifyRateLimit, {
    max: 600,
    timeWindow: "1 minute",
    errorResponseBuilder: () =>
      Object.assign(new Error("Zu viele Anfragen. Bitte kurz warten und dann noch einmal versuchen."), {
        statusCode: 429,
      }),
  });
  await app.register(fastifyCookie, { secret: config.sessionSecret });
  await app.register(fastifyWebsocket);
  await app.register(authRoutes);
  await app.register(moduleRoutes, { registry, chat });
  await app.register(summaryRoutes, { registry });
  await app.register(channelRoutes, { registry });
  await app.register(giveawayRoutes, { registry });
  await app.register(liveRoutes, { registry, chat });
  await app.register(overlayRoutes, { registry });
  await app.register(mediaRoutes);

  if (existsSync(config.webDist)) {
    await app.register(fastifyStatic, { root: config.webDist, wildcard: false });
    app.setNotFoundHandler((request, reply) => {
      const isApi =
        request.url.startsWith("/api") ||
        request.url.startsWith("/auth") ||
        request.url.startsWith("/ws") ||
        request.url.startsWith("/overlay");
      if (request.method === "GET" && !isApi) return reply.sendFile("index.html");
      return reply.code(404).send({ error: "Nicht gefunden." });
    });
  }

  app.setErrorHandler((err, _request, reply) => {
    const message = err instanceof Error ? err.message : String(err);
    const code = (err as { statusCode?: unknown }).statusCode;
    const status = typeof code === "number" && code >= 400 && code < 500 ? code : 500;
    if (status === 500) log("error", "server", message);
    reply.code(status).send({ error: status === 500 ? "Interner Serverfehler." : message });
  });

  const purgeTimer = setInterval(
    async () => {
      const removed = await sessionStore.purgeExpired().catch(() => 0);
      if (removed > 0) log("info", "auth", `${removed} abgelaufene Sitzung(en) entfernt`);
    },
    60 * 60 * 1000
  );

  await registry.startAll();
  await chat.start();
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
    await registry.shutdown();
    await chat.stop();
    await app.close();
    await closeDb();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error("Start fehlgeschlagen:", err);
  process.exit(1);
});
