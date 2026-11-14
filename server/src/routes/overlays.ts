import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { FastifyInstance } from "fastify";
import type { WebSocket } from "ws";
import { isAllowedOrigin, requireAuth } from "../auth.js";
import type { ChannelRegistry } from "../channels.js";
import { rootDir } from "../config.js";
import { channelStore } from "../db.js";
import {
  OVERLAY_IDS,
  OVERLAY_SIZES,
  overlayBus,
  overlayState,
  setOverlayState,
  STANDALONE,
  type LayoutEntry,
  type OverlayChannel,
  type OverlayId,
} from "../overlays/bus.js";

const OVERLAY_DIR = resolve(rootDir, "server/assets/overlays");

const CLOSE_INVALID_TOKEN = 4001;

export function channelForToken(token: unknown): string | null {
  if (typeof token !== "string" || token.length < 20) return null;
  return channelStore.byOverlayToken(token)?.login ?? null;
}

function isOverlayId(id: string): id is OverlayId {
  return (OVERLAY_IDS as readonly string[]).includes(id);
}

function isChannel(id: string): id is OverlayChannel {
  return id === "layout" || isOverlayId(id);
}

export async function overlayRoutes(app: FastifyInstance, opts: { registry: ChannelRegistry }): Promise<void> {
  const { registry } = opts;
  const clients = new Map<WebSocket, { channel: string; id: OverlayChannel; token: string }>();

  const onMessage = (channel: string, id: OverlayChannel, data: unknown) => {
    const json = JSON.stringify(data);
    for (const [socket, client] of clients) {
      if (client.channel === channel && client.id === id && socket.readyState === socket.OPEN) socket.send(json);
    }
  };
  overlayBus.on("message", onMessage);

  const publishLayout = (channel: string) => {
    const runtime = registry.get(channel);
    if (!runtime) return;
    const layout: LayoutEntry[] = [];
    for (const mod of runtime.manager.list()) {
      if (!mod.overlayUrl) continue;
      const id = new URL(mod.overlayUrl).pathname.split("/").pop() ?? "";
      if (!isOverlayId(id)) continue;
      const setting = (key: string) => mod.settings.find((s) => s.key === key)?.value;
      if (setting("position") === STANDALONE) continue;
      layout.push({
        id,
        position: String(setting("position") ?? "top-left"),
        scale: Number(setting("scale") ?? 100) / 100,
        ...OVERLAY_SIZES[id],
      });
    }
    setOverlayState(channel, "layout", layout);
  };
  registry.on("modules", publishLayout);

  function closeOutdated(channel: string): void {
    const token = channelStore.get(channel)?.overlayToken;
    for (const [socket, client] of clients) {
      if (client.channel === channel && client.token !== token) socket.close(CLOSE_INVALID_TOKEN, "Link ungültig");
    }
  }
  const onRemoved = (channel: string) => closeOutdated(channel);
  registry.on("removed", onRemoved);

  const heartbeat = setInterval(() => {
    for (const socket of clients.keys()) {
      if (socket.readyState === socket.OPEN) socket.ping();
    }
  }, 30_000);

  app.addHook("onClose", async () => {
    clearInterval(heartbeat);
    overlayBus.off("message", onMessage);
    registry.off("modules", publishLayout);
    registry.off("removed", onRemoved);
    for (const socket of clients.keys()) socket.close(1001, "Server wird beendet");
  });

  app.get<{ Querystring: { token?: string } }>("/overlay", async (request, reply) => {
    if (!channelForToken(request.query.token)) {
      return reply
        .code(403)
        .type("text/plain; charset=utf-8")
        .send("Dieser Overlay-Link ist ungültig. Kopiere den aktuellen Link aus dem Dashboard.");
    }
    const html = await readFile(resolve(OVERLAY_DIR, "all.html"), "utf8");
    return reply.type("text/html; charset=utf-8").header("Cache-Control", "no-store").send(html);
  });

  app.get<{ Params: { file: string } }>("/overlay-assets/:file", async (request, reply) => {
    const match = /^[a-z0-9-]+\.(png|jpg|gif|webp)$/.exec(request.params.file);
    if (!match) return reply.code(404).send({ error: "Datei nicht gefunden." });
    const types: Record<string, string> = {
      png: "image/png",
      jpg: "image/jpeg",
      gif: "image/gif",
      webp: "image/webp",
    };
    const data = await readFile(resolve(OVERLAY_DIR, request.params.file)).catch(() => null);
    if (!data) return reply.code(404).send({ error: "Datei nicht gefunden." });
    return reply.type(types[match[1]]).header("Cache-Control", "public, max-age=3600").send(data);
  });

  app.get<{ Params: { id: string }; Querystring: { token?: string } }>("/overlay/:id", async (request, reply) => {
    const { id } = request.params;
    if (!isOverlayId(id))
      return reply.code(404).type("text/plain; charset=utf-8").send("Dieses Overlay gibt es nicht.");
    if (!channelForToken(request.query.token)) {
      return reply
        .code(403)
        .type("text/plain; charset=utf-8")
        .send("Dieser Overlay-Link ist ungültig. Kopiere den aktuellen Link aus dem Dashboard.");
    }
    const html = await readFile(resolve(OVERLAY_DIR, `${id}.html`), "utf8");
    return reply.type("text/html; charset=utf-8").header("Cache-Control", "no-store").send(html);
  });

  app.get<{ Params: { id: string }; Querystring: { token?: string } }>(
    "/overlay/:id/ws",
    { websocket: true },
    (socket, request) => {
      const { id } = request.params;
      const token = request.query.token;
      const channel = channelForToken(token);
      if (!isChannel(id) || !channel) {
        socket.close(CLOSE_INVALID_TOKEN, "Ungültiger Link");
        return;
      }
      clients.set(socket, { channel, id, token: token as string });
      const state = overlayState(channel, id);
      if (state !== undefined) socket.send(JSON.stringify(state));
      socket.on("close", () => clients.delete(socket));
      socket.on("error", () => clients.delete(socket));
    }
  );

  app.post("/api/overlays/renew-token", { preHandler: requireAuth }, async (request, reply) => {
    if (!isAllowedOrigin(request)) return reply.code(403).send({ error: "Ungültige Herkunft." });
    await channelStore.renewToken(request.channel);
    closeOutdated(request.channel);
    registry.get(request.channel)?.manager.notifyChanged();
    return { message: "Neue Links erstellt. Die alten funktionieren nicht mehr, trag die neuen in OBS ein." };
  });
}
