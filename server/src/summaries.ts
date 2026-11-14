import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { rootDir } from "./config.js";
import {
  moduleStore,
  streamEventStore,
  streamSessionStore,
  type StreamSession,
  type StreamSessionStatus,
} from "./db.js";
import { log } from "./logger.js";
import { discordColor, escapeMarkdown, sendDiscordWebhook, type WebhookFile } from "./modules/discord-webhook.js";
import { NotFoundError, ValidationError } from "./modules/manager.js";
import type { SettingsValues } from "./modules/types.js";
import { getClips, type Clip } from "./twitch/helix.js";

const CLIP_AFTER_STREAM_MS = 60 * 60 * 1000;

const CLIP_PLACEHOLDER_PATH = resolve(rootDir, "server/assets/clip-placeholder.png");
const CLIP_PLACEHOLDER_NAME = "clip-placeholder.png";

const LIST_LIMIT = 20;
const TOP_LIMIT = 5;

export const summaryEvents = new EventEmitter<{ changed: [channel: string] }>();

export interface SummaryEntry {
  name: string;
  login: string;
  amount: number;
}

export interface SummaryView {
  id: number;
  status: StreamSessionStatus;
  streamer: string;
  title: string;
  games: string[];
  startedAt: string;
  endedAt: string | null;
  durationMinutes: number;
  peakViewers: number;
  chatMessages: number;
  raids: { count: number; viewers: number; list: SummaryEntry[] };
  gifts: { count: number; gifters: SummaryEntry[] };
  text: string;
  postedAt: string | null;
  postError: string | null;
}

function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${h} Std. ${m} Min.` : `${m} Min.`;
}

function joinGerman(parts: string[]): string {
  if (parts.length <= 1) return parts.join("");
  return `${parts.slice(0, -1).join(", ")} und ${parts[parts.length - 1]}`;
}

export interface SummaryOptions {
  raids: boolean;
  gifts: boolean;
  chat: boolean;
}

export function summaryOptions(settings: Record<string, unknown>): SummaryOptions {
  return {
    raids: settings.showRaids !== false,
    gifts: settings.showGifts !== false,
    chat: settings.showChat !== false,
  };
}

export function summaryText(v: Omit<SummaryView, "text">, options: SummaryOptions): string {
  const duration = formatDuration(v.durationMinutes);
  const parts = [v.status === "live" ? `ist seit ${duration} live` : `war ${duration} live`];

  if (options.raids && v.raids.count > 0) {
    const viewers = v.raids.viewers === 1 ? "1 Viewer" : `${v.raids.viewers} Viewern`;
    parts.push(`wurde ${v.raids.count}× geraidet mit insgesamt ${viewers}`);
  }

  if (options.chat && v.chatMessages > 0) {
    const n = v.chatMessages.toLocaleString("de-DE");
    parts.push(`hatte ${n} Chatnachricht${v.chatMessages === 1 ? "" : "en"}`);
  }

  if (options.gifts && v.gifts.count > 0) {
    parts.push(`bekam ${v.gifts.count} Gifted Sub${v.gifts.count === 1 ? "" : "s"}`);
  }
  parts.push(`hatte einen Viewer-Peak von ${v.peakViewers}`);

  return `${v.streamer} ${joinGerman(parts)}.`;
}

async function toView(session: StreamSession): Promise<SummaryView> {
  const until = session.endedAt ?? Date.now();
  const events = await streamEventStore.between(session.channel, session.startedAt, until);

  const raidList = events
    .filter((e) => e.type === "raid")
    .map((e) => ({ name: e.displayName, login: e.login, amount: e.amount }))
    .sort((a, b) => b.amount - a.amount);

  const gifters = new Map<string, SummaryEntry>();
  for (const e of events) {
    if (e.type !== "gift") continue;
    const key = e.login || `anon:${e.displayName}`;
    const entry = gifters.get(key) ?? { name: e.displayName, login: e.login, amount: 0 };
    entry.amount += e.amount;
    gifters.set(key, entry);
  }
  const gifterList = [...gifters.values()].sort((a, b) => b.amount - a.amount);

  const base: Omit<SummaryView, "text"> = {
    id: session.id,
    status: session.status,
    streamer: session.streamer,
    title: session.title,
    games: session.games,
    startedAt: new Date(session.startedAt).toISOString(),
    endedAt: session.endedAt ? new Date(session.endedAt).toISOString() : null,
    durationMinutes: Math.max(0, Math.round((until - session.startedAt) / 60_000)),
    peakViewers: session.peakViewers,
    chatMessages: session.chatMessages,
    raids: {
      count: raidList.length,
      viewers: raidList.reduce((sum, r) => sum + r.amount, 0),
      list: raidList,
    },
    gifts: {
      count: gifterList.reduce((sum, g) => sum + g.amount, 0),
      gifters: gifterList,
    },
    postedAt: session.postedAt ? new Date(session.postedAt).toISOString() : null,
    postError: session.postError,
  };
  return {
    ...base,
    text: summaryText(base, summaryOptions(moduleStore.get(session.channel, "stream-summary").settings)),
  };
}

export async function listSummaries(channel: string): Promise<SummaryView[]> {
  return Promise.all((await streamSessionStore.recent(channel, LIST_LIMIT)).map(toView));
}

export async function getSummary(channel: string, id: number): Promise<SummaryView | null> {
  const session = await streamSessionStore.get(channel, id);
  return session ? toView(session) : null;
}

function topLines(entries: SummaryEntry[], unit: (amount: number) => string): string {
  const lines = entries.slice(0, TOP_LIMIT).map((e) => `**${escapeMarkdown(e.name)}** – ${unit(e.amount)}`);
  if (entries.length > TOP_LIMIT) lines.push(`… und ${entries.length - TOP_LIMIT} weitere`);
  return lines.join("\n");
}

let placeholderImage: Uint8Array<ArrayBuffer> | null = null;

function loadPlaceholder(): WebhookFile | null {
  try {
    placeholderImage ??= new Uint8Array(readFileSync(CLIP_PLACEHOLDER_PATH));
  } catch {
    log("warn", "stream-summary", `Platzhalterbild fehlt: ${CLIP_PLACEHOLDER_PATH}`);
    return null;
  }
  return { name: CLIP_PLACEHOLDER_NAME, data: placeholderImage, contentType: "image/png" };
}

async function pickClip(v: SummaryView, channel: string): Promise<Clip | null> {
  const from = Date.parse(v.startedAt);
  const until = Math.min((v.endedAt ? Date.parse(v.endedAt) : Date.now()) + CLIP_AFTER_STREAM_MS, Date.now());
  try {
    const clips = await getClips(channel, from, until);
    return clips.length > 0 ? clips[Math.floor(Math.random() * clips.length)] : null;
  } catch (err) {
    log("warn", "stream-summary", `Clips nicht abrufbar: ${err instanceof Error ? err.message : String(err)}`, channel);
    return null;
  }
}

export async function buildSummaryMessage(
  v: SummaryView,
  settings: SettingsValues,
  channel: string
): Promise<{ payload: unknown; files: WebhookFile[] }> {
  const options = summaryOptions(settings);
  const date = new Date(v.startedAt).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });
  const channelUrl = `https://twitch.tv/${channel}`;
  const text = summaryText(v, options);

  const fields: { name: string; value: string; inline: boolean }[] = [
    { name: "👀 Viewer-Peak", value: String(v.peakViewers), inline: true },
  ];
  if (options.raids && v.raids.count > 0) {
    fields.push({ name: "🚀 Raids", value: `${v.raids.count}× (${v.raids.viewers} Viewer)`, inline: true });
  }
  if (options.gifts && v.gifts.count > 0) {
    fields.push({ name: "🎁 Gifted Subs", value: String(v.gifts.count), inline: true });
  }

  if (options.chat && v.chatMessages > 0) {
    fields.push({ name: "💬 Chatnachrichten", value: v.chatMessages.toLocaleString("de-DE"), inline: true });
  }

  fields.push({ name: "⏱️ Dauer", value: formatDuration(v.durationMinutes), inline: true });

  if (v.games.length > 0) {
    fields.push({ name: "🎮 Kategorie", value: escapeMarkdown(v.games.join(", ")).slice(0, 1024), inline: true });
  }
  fields.push({ name: "📺 Kanal", value: `[twitch.tv/${channel}](${channelUrl})`, inline: true });

  if (options.raids && v.raids.list.length > 0) {
    fields.push({ name: "Raids", value: topLines(v.raids.list, (n) => `${n} Viewer`), inline: false });
  }
  if (options.gifts && v.gifts.gifters.length > 0) {
    fields.push({
      name: "Top-Schenker",
      value: topLines(v.gifts.gifters, (n) => (n === 1 ? "1 Sub" : `${n} Subs`)),
      inline: false,
    });
  }

  const files: WebhookFile[] = [];
  let image: { url: string } | undefined;

  if (settings.showClip !== false) {
    const clip = await pickClip(v, channel);
    if (clip) {
      const clipTitle = escapeMarkdown((clip.title || "Clip ansehen").replace(/[[\]]/g, ""));
      fields.push({
        name: "🎬 Clip des Streams",
        value: `[${clipTitle}](${clip.url}) · geclippt von ${escapeMarkdown(clip.creatorName)}`.slice(0, 1024),
        inline: false,
      });
      image = { url: clip.thumbnailUrl };
    } else {
      const placeholder = loadPlaceholder();
      if (placeholder) {
        files.push(placeholder);
        image = { url: `attachment://${placeholder.name}` };
      }
      fields.push({ name: "🎬 Clip des Streams", value: "Diesmal wurde kein Clip erstellt.", inline: false });
    }
  }

  const description = v.title ? `${escapeMarkdown(text)}\n\n> ${escapeMarkdown(v.title)}` : escapeMarkdown(text);

  const payload = {
    username: String(settings.botName),
    allowed_mentions: { parse: [] as string[] },
    embeds: [
      {
        title: `📊 Stream-Highlights vom ${date}`,
        description: description.slice(0, 4096),
        url: channelUrl,
        color: discordColor(settings.embedColor),
        fields,
        image,
        footer: { text: `twitch.tv/${channel}` },
        timestamp: v.endedAt ?? new Date().toISOString(),
      },
    ],
  };
  return { payload, files };
}

const posting = new Set<number>();

export async function postSummary(channel: string, id: number, settings: SettingsValues): Promise<SummaryView> {
  const session = await streamSessionStore.get(channel, id);
  if (!session) throw new NotFoundError("Diese Zusammenfassung gibt es nicht.");
  if (session.status === "live")
    throw new ValidationError("Der Stream läuft noch. Die Zusammenfassung ist erst nach dem Stream fertig.");
  if (session.status === "posted") throw new ValidationError("Diese Zusammenfassung wurde schon gepostet.");
  if (posting.has(id)) throw new ValidationError("Die Zusammenfassung wird gerade gepostet.");

  posting.add(id);
  try {
    const { payload, files } = await buildSummaryMessage(await toView(session), settings, channel);
    await sendDiscordWebhook(String(settings.webhookUrl), payload, files);
    await streamSessionStore.markPosted(id);
    log("info", "stream-summary", `Zusammenfassung von ${session.streamer} in Discord gepostet`, channel);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await streamSessionStore.markFailed(id, message);
    log("error", "stream-summary", `Zusammenfassung nicht gepostet: ${message}`, channel);
    throw new ValidationError(message);
  } finally {
    posting.delete(id);
    summaryEvents.emit("changed", channel);
  }
  return (await getSummary(channel, id))!;
}

export async function discardSummary(channel: string, id: number): Promise<SummaryView> {
  const session = await streamSessionStore.get(channel, id);
  if (!session) throw new NotFoundError("Diese Zusammenfassung gibt es nicht.");
  if (session.status === "live") throw new ValidationError("Der Stream läuft noch.");
  if (session.status === "posted") throw new ValidationError("Diese Zusammenfassung wurde schon gepostet.");

  await streamSessionStore.markDiscarded(id);
  log("info", "stream-summary", `Zusammenfassung von ${session.streamer} verworfen`, channel);
  summaryEvents.emit("changed", channel);
  return (await getSummary(channel, id))!;
}
