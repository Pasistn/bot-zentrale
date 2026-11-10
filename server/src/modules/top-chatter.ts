import { topChatterStore } from "../db.js";
import { overlayLayoutSettings, setOverlayState } from "../overlays/bus.js";
import { getAvatarUrl } from "../twitch/helix.js";
import type { StreamInfo } from "../twitch/types.js";
import type { BotModule, ModuleContext, SettingsValues } from "./types.js";

const PUBLISH_DELAY_MS = 1_000;

const PENDING_KEEP_MS = 30 * 60_000;
const PENDING_MAX = 5_000;

const TEST_DURATION_MS = 15_000;

const DEFAULT_IGNORED = "nightbot, streamelements, streamlabs, moobot, fossabot, wizebot, soundalerts, sery_bot";

export interface TopChatter {
  login: string;
  displayName: string;
  count: number;
  avatarUrl: string | null;
}

export interface TopChatterState {
  title: string;
  accentColor: string;
  showCount: boolean;
  chatters: TopChatter[];
}

const EMPTY_STATE: TopChatterState = { title: "", accentColor: "#9146FF", showCount: true, chatters: [] };

function parseLogins(raw: unknown): Set<string> {
  return new Set(
    String(raw ?? "")
      .split(/[\s,;]+/)
      .map((login) => login.trim().toLowerCase().replace(/^@/, ""))
      .filter(Boolean)
  );
}

function baseState(settings: SettingsValues): Omit<TopChatterState, "chatters"> {
  return {
    title: String(settings.title ?? ""),
    accentColor: String(settings.accentColor ?? EMPTY_STATE.accentColor),
    showCount: settings.showCount !== false,
  };
}

export function createTopChatterModule(): BotModule {
  const chatters = new Map<string, { displayName: string; count: number; lastAt: number }>();
  const dirty = new Set<string>();
  let loaded = false;
  let sessionId: number | null = null;
  let pending: { login: string; displayName: string; at: number }[] = [];

  const avatars = new Map<string, string | null>();
  const loadingAvatars = new Set<string>();

  let publishTimer: NodeJS.Timeout | null = null;
  let testTimer: NodeJS.Timeout | null = null;
  let activeCtx: ModuleContext | null = null;

  async function load(): Promise<void> {
    if (loaded) return;
    for (const c of await topChatterStore.all()) {
      chatters.set(c.login, { displayName: c.displayName, count: c.count, lastAt: c.lastAt });
    }
    sessionId = await topChatterStore.getSessionId();
    loaded = true;
  }

  function count(login: string, displayName: string, at: number): void {
    const entry = chatters.get(login) ?? { displayName, count: 0, lastAt: 0 };
    entry.displayName = displayName;
    entry.count++;
    entry.lastAt = at;
    chatters.set(login, entry);
    dirty.add(login);
  }

  function save(ctx: ModuleContext | null): void {
    if (dirty.size === 0) return;
    const batch = [...dirty].map((login) => ({ login, ...chatters.get(login)! }));
    dirty.clear();
    topChatterStore.save(batch).catch((err) => {
      for (const c of batch) dirty.add(c.login);
      ctx?.log("error", `Zähler nicht gespeichert: ${err instanceof Error ? err.message : String(err)}`);
    });
  }

  async function resetCounts(): Promise<void> {
    chatters.clear();
    dirty.clear();
    await topChatterStore.clear();
  }

  async function sync(ctx: ModuleContext, info: StreamInfo): Promise<void> {
    if (sessionId !== info.sessionId) {
      sessionId = info.sessionId;
      await resetCounts();
      await topChatterStore.setSessionId(info.sessionId);
      ctx.log("info", "Neuer Stream erkannt, die Top-Chatter beginnen bei 0");
    }
    for (const msg of pending) {
      if (msg.at >= info.startedAt) count(msg.login, msg.displayName, msg.at);
    }
    pending = [];
    if (activeCtx === ctx) publish(ctx);
  }

  function ranking(settings: SettingsValues): TopChatter[] {
    return [...chatters]
      .sort(([, a], [, b]) => b.count - a.count || a.lastAt - b.lastAt)
      .slice(0, Number(settings.places))
      .map(([login, entry]) => ({
        login,
        displayName: entry.displayName,
        count: entry.count,
        avatarUrl: settings.showAvatar === true ? avatars.get(login) ?? null : null,
      }));
  }

  function loadAvatars(ctx: ModuleContext, list: TopChatter[]): void {
    if (ctx.settings.showAvatar !== true) return;
    for (const { login } of list) {
      if (avatars.has(login) || loadingAvatars.has(login)) continue;
      loadingAvatars.add(login);
      getAvatarUrl(login)
        .then((url) => avatars.set(login, url))
        .catch((err) => {
          avatars.set(login, null);
          ctx.log("warn", `Profilbild von ${login} nicht geladen: ${err instanceof Error ? err.message : String(err)}`);
        })
        .finally(() => {
          loadingAvatars.delete(login);
          if (activeCtx === ctx) publish(ctx);
        });
    }
  }

  function publish(ctx: ModuleContext): void {
    save(ctx);
    if (testTimer) return;
    const list = ranking(ctx.settings);
    loadAvatars(ctx, list);
    setOverlayState("top-chatter", { ...baseState(ctx.settings), chatters: list });
  }

  function schedulePublish(ctx: ModuleContext): void {
    if (publishTimer) return;
    publishTimer = setTimeout(() => {
      publishTimer = null;
      if (activeCtx === ctx) publish(ctx);
    }, PUBLISH_DELAY_MS);
  }

  return {
    id: "top-chatter",
    category: "obs",
    name: "Top-Chatter-Overlay",
    description:
      "Zeigt die aktivsten Chatter des laufenden Streams als Browserquelle in OBS. Bei jedem neuen Stream beginnt die Zählung bei 0.",
    overlayPath: "/overlay/top-chatter",
    settings: [
      {
        key: "places",
        label: "Anzahl Plätze",
        type: "number",
        default: 3,
        min: 1,
        max: 10,
      },
      {
        key: "title",
        label: "Überschrift",
        type: "text",
        default: "Top Chatter",
        description: "Leer lassen, um keine Überschrift anzuzeigen.",
      },
      {
        key: "showCount",
        label: "Anzahl der Nachrichten anzeigen",
        type: "boolean",
        default: true,
      },
      {
        key: "showAvatar",
        label: "Profilbild anzeigen",
        type: "boolean",
        default: true,
        description: "Holt das Twitch-Profilbild über die Twitch-API. Ohne Bild erscheint der Anfangsbuchstabe.",
      },
      {
        key: "accentColor",
        label: "Akzentfarbe",
        type: "color",
        default: "#9146FF",
      },
      {
        key: "ignoreCommands",
        label: "Befehle nicht zählen",
        type: "boolean",
        default: true,
        description: "Nachrichten, die mit ! beginnen, z. B. !discord, zählen nicht.",
      },
      {
        key: "ignoreBroadcaster",
        label: "Eigene Nachrichten nicht zählen",
        type: "boolean",
        default: true,
      },
      {
        key: "ignoreLogins",
        label: "Diese Accounts nicht zählen",
        type: "text",
        default: DEFAULT_IGNORED,
        description: "Twitch-Namen mit Komma getrennt, z. B. Bots.",
      },
      ...overlayLayoutSettings("top-left"),
    ],
    actions: [
      {
        id: "test",
        label: "Testanzeige (15 Sek.)",
        run: async (ctx) => {
          if (testTimer) clearTimeout(testTimer);
          testTimer = setTimeout(() => {
            testTimer = null;
            if (activeCtx) publish(activeCtx);
            else setOverlayState("top-chatter", EMPTY_STATE);
          }, TEST_DURATION_MS);

          const names = ["Chatkönig", "Dauerschreiber", "Emote_Fan", "Lurker_Nicht", "Frage_Steller"];
          setOverlayState("top-chatter", {
            ...baseState(ctx.settings),
            chatters: names.slice(0, Number(ctx.settings.places)).map((name, i) => ({
              login: name.toLowerCase(),
              displayName: name,
              count: 120 - i * 37,
              avatarUrl: null,
            })),
          });
          return "Das Overlay zeigt 15 Sekunden lang Testdaten. Ideal, um es in OBS zu platzieren.";
        },
      },
      {
        id: "reset",
        label: "Zähler zurücksetzen",
        run: async () => {
          await load();
          await resetCounts();
          pending = [];
          if (activeCtx) publish(activeCtx);
          return "Alle Zähler stehen wieder auf 0.";
        },
      },
    ],
    async start(ctx) {
      await load();
      activeCtx = ctx;
      const ignored = parseLogins(ctx.settings.ignoreLogins);

      ctx.on("streamOnline", (info) => void sync(ctx, info));

      ctx.on("chat", (msg) => {
        const login = msg.login.toLowerCase();
        if (!login || ignored.has(login)) return;
        if (msg.isBroadcaster && ctx.settings.ignoreBroadcaster === true) return;
        if (ctx.settings.ignoreCommands === true && msg.text.trimStart().startsWith("!")) return;

        const displayName = msg.displayName || login;
        const now = Date.now();
        const live = ctx.liveStream();
        if (live && live.sessionId === sessionId) {
          count(login, displayName, now);
          schedulePublish(ctx);
          return;
        }

        pending.push({ login, displayName, at: now });
        if (pending.length > PENDING_MAX || now - pending[0].at > PENDING_KEEP_MS) {
          pending = pending.filter((m) => now - m.at <= PENDING_KEEP_MS).slice(-PENDING_MAX);
        }
      });

      const live = ctx.liveStream();
      if (live) await sync(ctx, live);
      publish(ctx);
    },
    stop() {
      activeCtx = null;
      if (publishTimer) clearTimeout(publishTimer);
      publishTimer = null;
      save(null);
      if (!testTimer) setOverlayState("top-chatter", EMPTY_STATE);
    },
  };
}
