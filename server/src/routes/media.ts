import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { isAllowedOrigin, requireAuth, sessionFromRequest } from "../auth.js";
import { log } from "../logger.js";
import { deleteMedia, isMediaFile, listMedia, MAX_MEDIA_BYTES, MediaError, mediaMime, mediaPath, saveMedia } from "../media.js";
import { channelForToken } from "./overlays.js";

async function requireOrigin(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (!isAllowedOrigin(request)) await reply.code(403).send({ error: "Ungültige Herkunft." });
}

export async function mediaRoutes(app: FastifyInstance): Promise<void> {
  app.addContentTypeParser("*", { parseAs: "buffer", bodyLimit: MAX_MEDIA_BYTES + 1024 }, (_request, body, done) =>
    done(null, body)
  );

  app.get("/api/media", { preHandler: requireAuth }, async (request) => ({ media: await listMedia(request.channel) }));

  app.post<{ Querystring: { name?: string } }>(
    "/api/media",
    { preHandler: [requireAuth, requireOrigin], bodyLimit: MAX_MEDIA_BYTES + 1024 },
    async (request, reply) => {
      if (!Buffer.isBuffer(request.body)) return reply.code(400).send({ error: "Keine Datei erhalten." });
      try {
        const media = await saveMedia(request.channel, String(request.query.name ?? "datei"), request.body);
        log("info", "media", `Datei hochgeladen: ${media.name} (${Math.round(media.size / 1024)} KB)`, request.channel);
        return { media };
      } catch (err) {
        if (err instanceof MediaError) return reply.code(400).send({ error: err.message });
        throw err;
      }
    }
  );

  app.delete<{ Params: { file: string } }>(
    "/api/media/:file",
    { preHandler: [requireAuth, requireOrigin] },
    async (request, reply) => {
      if (!isMediaFile(request.params.file)) return reply.code(400).send({ error: "Ungültiger Dateiname." });
      await deleteMedia(request.channel, request.params.file);
      return { ok: true };
    }
  );

  app.get<{ Params: { file: string }; Querystring: { token?: string } }>(
    "/overlay-media/:file",
    async (request, reply) => {
      const channel = channelForToken(request.query.token) ?? (await sessionFromRequest(request))?.channel;
      if (!channel) return reply.code(403).send({ error: "Kein Zugriff." });

      const { file } = request.params;
      if (!isMediaFile(file)) return reply.code(404).send({ error: "Nicht gefunden." });
      const path = mediaPath(channel, file);
      const info = await stat(path).catch(() => null);
      if (!info) return reply.code(404).send({ error: "Nicht gefunden." });

      return reply
        .type(mediaMime(file))
        .header("Content-Length", info.size)
        .header("Cache-Control", "private, max-age=86400")
        .header("X-Content-Type-Options", "nosniff")
        .send(createReadStream(path));
    }
  );
}
