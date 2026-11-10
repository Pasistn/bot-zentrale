import { randomBytes } from "node:crypto";
import { mkdir, readdir, rename, stat, unlink, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { config } from "./config.js";

export const MAX_MEDIA_BYTES = 25 * 1024 * 1024;

export type MediaKind = "image" | "video" | "audio";

interface MediaType {
  ext: string;
  kind: MediaKind;
  mime: string;
  matches: (b: Buffer) => boolean;
}

const ascii = (b: Buffer, start: number, text: string) => b.subarray(start, start + text.length).toString("latin1") === text;

const TYPES: MediaType[] = [
  { ext: "png", kind: "image", mime: "image/png", matches: (b) => b[0] === 0x89 && ascii(b, 1, "PNG") },
  { ext: "jpg", kind: "image", mime: "image/jpeg", matches: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { ext: "gif", kind: "image", mime: "image/gif", matches: (b) => ascii(b, 0, "GIF8") },
  { ext: "webp", kind: "image", mime: "image/webp", matches: (b) => ascii(b, 0, "RIFF") && ascii(b, 8, "WEBP") },
  { ext: "webm", kind: "video", mime: "video/webm", matches: (b) => b.readUInt32BE(0) === 0x1a45dfa3 },
  { ext: "mp4", kind: "video", mime: "video/mp4", matches: (b) => ascii(b, 4, "ftyp") },
  { ext: "mp3", kind: "audio", mime: "audio/mpeg", matches: (b) => ascii(b, 0, "ID3") || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0) },
  { ext: "ogg", kind: "audio", mime: "audio/ogg", matches: (b) => ascii(b, 0, "OggS") },
  { ext: "wav", kind: "audio", mime: "audio/wav", matches: (b) => ascii(b, 0, "RIFF") && ascii(b, 8, "WAVE") },
];

const FILE_PATTERN = /^[a-f0-9]{12}--[a-z0-9-]{1,40}\.(png|jpg|gif|webp|webm|mp4|mp3|ogg|wav)$/;

export interface MediaFile {
  file: string;
  name: string;
  kind: MediaKind;
  size: number;
}

export class MediaError extends Error {}

function typeOfFile(file: string): MediaType | undefined {
  const ext = file.split(".").pop();
  return TYPES.find((t) => t.ext === ext);
}

export function isMediaFile(file: string): boolean {
  return FILE_PATTERN.test(file);
}

export function mediaKind(file: string): MediaKind | null {
  return isMediaFile(file) ? typeOfFile(file)!.kind : null;
}

export function mediaMime(file: string): string {
  return typeOfFile(file)?.mime ?? "application/octet-stream";
}

function channelDir(channel: string): string {
  if (!/^[a-z0-9_]{1,25}$/.test(channel)) throw new MediaError("Ungültiger Kanal.");
  return resolve(config.mediaDir, channel);
}

export function mediaPath(channel: string, file: string): string {
  if (!isMediaFile(file)) throw new MediaError("Ungültiger Dateiname.");
  return resolve(channelDir(channel), file);
}

export async function adoptLegacyMedia(channel: string): Promise<number> {
  let files: string[];
  try {
    files = await readdir(config.mediaDir);
  } catch {
    return 0;
  }
  const legacy = files.filter(isMediaFile);
  if (legacy.length === 0) return 0;
  await mkdir(channelDir(channel), { recursive: true });
  for (const file of legacy) await rename(resolve(config.mediaDir, file), mediaPath(channel, file));
  return legacy.length;
}

export function mediaUrl(file: string): string | null {
  return isMediaFile(file) ? `/overlay-media/${file}` : null;
}

function slug(name: string): string {
  const base = name.replace(/\.[^.]+$/, "").toLowerCase();
  const clean = base
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/, "");
  return clean || "datei";
}

export async function saveMedia(channel: string, originalName: string, data: Buffer): Promise<MediaFile> {
  if (data.length === 0) throw new MediaError("Die Datei ist leer.");
  if (data.length > MAX_MEDIA_BYTES) throw new MediaError("Die Datei ist größer als 25 MB.");
  const type = data.length >= 12 ? TYPES.find((t) => t.matches(data)) : undefined;
  if (!type) {
    throw new MediaError("Dieses Format geht nicht. Erlaubt: PNG, JPG, GIF, WebP, WebM, MP4, MP3, OGG, WAV.");
  }

  const name = slug(originalName);
  const file = `${randomBytes(6).toString("hex")}--${name}.${type.ext}`;
  await mkdir(channelDir(channel), { recursive: true });
  await writeFile(mediaPath(channel, file), data);
  return { file, name, kind: type.kind, size: data.length };
}

export async function listMedia(channel: string): Promise<MediaFile[]> {
  let files: string[];
  try {
    files = await readdir(channelDir(channel));
  } catch {
    return [];
  }
  const list: MediaFile[] = [];
  for (const file of files) {
    if (!isMediaFile(file)) continue;
    const info = await stat(mediaPath(channel, file)).catch(() => null);
    if (!info) continue;
    list.push({ file, name: file.slice(14).replace(/\.[^.]+$/, ""), kind: typeOfFile(file)!.kind, size: info.size });
  }
  return list.sort((a, b) => a.name.localeCompare(b.name));
}

export async function deleteMedia(channel: string, file: string): Promise<void> {
  await unlink(mediaPath(channel, file)).catch((err: NodeJS.ErrnoException) => {
    if (err.code !== "ENOENT") throw err;
  });
}
