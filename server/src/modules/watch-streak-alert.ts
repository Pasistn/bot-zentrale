import { mediaKind, mediaUrl } from "../media.js";
import { overlayLayoutSettings, sendToOverlay } from "../overlays/bus.js";
import { getAvatarUrl } from "../twitch/helix.js";
import type { WatchStreak } from "../twitch/types.js";
import type { BotModule, ModuleContext } from "./types.js";

export interface WatchStreakAlert {
  type: "alert";
  template: string;
  name: string;
  streak: number;
  message: string | null;
  avatarUrl: string | null;
  imageUrl: string | null;
  imageKind: "image" | "video" | null;
  backgroundUrl?: string | null;
  soundUrl: string | null;
  accentColor: string;
  durationMs: number;
  sound: boolean;
  volume: number;
}

export function createWatchStreakAlertModule(): BotModule {
  async function show(ctx: ModuleContext, s: WatchStreak): Promise<void> {
    const image = String(ctx.settings.image);
    const kind = mediaKind(image);
    let avatarUrl: string | null = null;
    if (!kind && ctx.settings.showAvatar === true && s.login) {
      avatarUrl = await getAvatarUrl(s.login).catch(() => null);
    }
    const alert: WatchStreakAlert = {
      type: "alert",
      template: String(ctx.settings.text),
      name: s.displayName,
      streak: s.streak,
      message: ctx.settings.showUserMessage === true ? s.userMessage : null,
      avatarUrl,
      imageUrl: mediaUrl(image),
      imageKind: kind === "image" || kind === "video" ? kind : null,
      soundUrl: mediaUrl(String(ctx.settings.sound)),
      backgroundUrl: mediaUrl(String(ctx.settings.background)),
      accentColor: String(ctx.settings.accentColor),
      durationMs: Number(ctx.settings.durationSeconds) * 1000,
      sound: ctx.settings.playSound === true,
      volume: Number(ctx.settings.volume) / 100,
    };
    sendToOverlay(ctx.channel, "watch-streak", alert);
  }

  return {
    id: "watch-streak-alert",
    category: "obs",
    name: "Watch-Streak-Alert",
    description:
      "Blendet geteilte Watch-Streaks als Alert in OBS ein, mit Name, Anzahl und Nachricht des Zuschauers. Mehrere Alerts laufen nacheinander.",
    overlayPath: "/overlay/watch-streak",
    settings: [
      {
        key: "minStreak",
        label: "Mindest-Streak",
        type: "number",
        default: 1,
        min: 1,
        max: 1000,
        description: "Erst ab dieser Anzahl Streams in Folge erscheint ein Alert.",
      },
      {
        key: "text",
        label: "Text",
        type: "text",
        default: "{name} schaut seit {streak} Streams in Folge!",
        required: true,
        description: "Platzhalter: {name} für den Namen, {streak} für die Anzahl.",
      },
      {
        key: "showUserMessage",
        label: "Nachricht des Zuschauers anzeigen",
        type: "boolean",
        default: true,
      },
      {
        key: "image",
        label: "Eigenes Bild oder Video",
        type: "media",
        accept: "image",
        default: "",
        description:
          "PNG, JPG, GIF (auch animiert), WebP oder ein kurzes Video (WebM, MP4). Ersetzt Profilbild und Flamme.",
      },
      {
        key: "background",
        label: "Eigenes Hintergrundbild",
        type: "media",
        accept: "image",
        default: "",
        description: "PNG, JPG, GIF (auch animiert) oder WebP. Wird hinter dem Alert angezeigt.",
      },
      {
        key: "showAvatar",
        label: "Profilbild anzeigen",
        type: "boolean",
        default: true,
        description: "Nur ohne eigenes Bild.",
      },
      {
        key: "durationSeconds",
        label: "Anzeigedauer in Sekunden",
        type: "number",
        default: 8,
        min: 3,
        max: 30,
      },
      {
        key: "accentColor",
        label: "Akzentfarbe",
        type: "color",
        default: "#FF7A1A",
      },
      {
        key: "playSound",
        label: "Sound abspielen",
        type: "boolean",
        default: true,
        description: "In OBS bei der Browserquelle „Audio über OBS steuern“ anhaken, um ihn im Mixer zu regeln.",
      },
      {
        key: "sound",
        label: "Eigener Ton",
        type: "media",
        accept: "audio",
        default: "",
        description: "MP3, OGG oder WAV. Ohne eigene Datei ertönt ein kurzer eingebauter Ton.",
      },
      {
        key: "volume",
        label: "Lautstärke in Prozent",
        type: "number",
        default: 50,
        min: 0,
        max: 100,
      },
      ...overlayLayoutSettings("top-center"),
    ],
    actions: [
      {
        id: "test",
        label: "Test-Alert zeigen",
        run: async (ctx) => {
          await show(ctx, {
            displayName: "Test_User",
            login: ctx.channel,
            streak: 42,
            channelPoints: 450,
            userMessage: "Das ist nur ein Test 🎉",
          });
          return "Test-Alert gesendet. Ist das Overlay in OBS offen, erscheint er jetzt.";
        },
      },
    ],
    start(ctx) {
      const minStreak = Number(ctx.settings.minStreak);
      ctx.on("watchStreak", (s) => {
        if (s.streak < minStreak) return;
        void show(ctx, s);
      });
    },
  };
}
