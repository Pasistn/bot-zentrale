import type { WatchStreak } from "../twitch/types.js";
import { DISCORD_WEBHOOK_PATTERN, escapeMarkdown, sendDiscordWebhook } from "./discord-webhook.js";
import { avatarFor, SHOW_AVATAR_SETTING } from "./avatar.js";
import type { BotModule, ModuleContext } from "./types.js";

const DELAY_BETWEEN_POSTS_MS = 1000;

function buildPayload(ctx: ModuleContext, s: WatchStreak, avatarUrl: string | null) {
  const fields: { name: string; value: string; inline: boolean }[] = [
    { name: "Streak", value: `🔥 ${s.streak} Streams`, inline: true },
  ];

  if (s.channelPoints !== null && ctx.settings.showChannelPoints === true) {
    fields.push({ name: "Kanalpunkte", value: `+${s.channelPoints}`, inline: true });
  }

  if (s.userMessage && ctx.settings.showUserMessage === true) {
    fields.push({ name: "Nachricht", value: escapeMarkdown(s.userMessage).slice(0, 1024), inline: false });
  }

  return {
    username: String(ctx.settings.botName),
    allowed_mentions: { parse: [] as string[] },
    embeds: [
      {
        title: "🔥 Neue Watch-Streak!",
        description: `**${escapeMarkdown(s.displayName)}** hat **${s.streak} Streams in Folge** geschaut!`,
        url: `https://twitch.tv/${ctx.channel}`,
        color: Number.parseInt(String(ctx.settings.embedColor).replace("#", ""), 16),
        thumbnail: avatarUrl ? { url: avatarUrl } : undefined,
        fields,
        footer: { text: `twitch.tv/${ctx.channel}` },
        timestamp: new Date().toISOString(),
      },
    ],
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function createWatchStreakModule(): BotModule {
  let queue: Promise<void> = Promise.resolve();
  let generation = 0;

  async function post(ctx: ModuleContext, s: WatchStreak): Promise<void> {
    const avatarUrl = await avatarFor(ctx, s.login);
    await sendDiscordWebhook(String(ctx.settings.webhookUrl), buildPayload(ctx, s, avatarUrl));
  }

  function enqueue(ctx: ModuleContext, s: WatchStreak, gen: number): void {
    queue = queue
      .then(async () => {
        if (gen !== generation) return;
        await post(ctx, s);
        ctx.log("info", `An Discord gesendet: ${s.displayName} (${s.streak} Streams)`);
        await sleep(DELAY_BETWEEN_POSTS_MS);
      })
      .catch((err) => {
        ctx.log("error", `Senden fehlgeschlagen: ${err instanceof Error ? err.message : String(err)}`);
      });
  }

  return {
    id: "watch-streak",
    category: "twitch-discord",
    name: "Watch-Streaks in Discord",
    description: "Postet geteilte Watch-Streaks aus dem Twitch-Chat mit Name und Anzahl in einen Discord-Kanal.",
    settings: [
      {
        key: "webhookUrl",
        label: "Discord-Webhook-URL",
        type: "secret",
        default: "",
        required: true,
        description: "Discord: Kanal bearbeiten → Integrationen → Webhooks → Webhook-URL kopieren.",
        pattern: DISCORD_WEBHOOK_PATTERN,
        patternMessage: "Das ist keine Discord-Webhook-URL. Sie beginnt mit https://discord.com/api/webhooks/",
      },
      {
        key: "minStreak",
        label: "Mindest-Streak",
        type: "number",
        default: 1,
        min: 1,
        max: 1000,
        description: "Erst ab dieser Anzahl Streams in Folge wird gepostet.",
      },
      {
        key: "botName",
        label: "Absendername in Discord",
        type: "text",
        default: "Stream Streak Bot",
      },
      {
        key: "embedColor",
        label: "Farbe des Beitrags",
        type: "color",
        default: "#9146FF",
      },
      {
        key: "showChannelPoints",
        label: "Kanalpunkte anzeigen",
        type: "boolean",
        default: true,
      },
      {
        key: "showUserMessage",
        label: "Nachricht des Zuschauers anzeigen",
        type: "boolean",
        default: true,
      },
      SHOW_AVATAR_SETTING,
    ],
    actions: [
      {
        id: "test",
        label: "Testbeitrag senden",
        run: async (ctx) => {
          await post(ctx, {
            displayName: "Test_User",
            login: ctx.channel,
            streak: 42,
            channelPoints: 450,
            userMessage: "Das ist nur ein Test 🎉",
          });
          return "Testbeitrag ist in Discord angekommen.";
        },
      },
    ],
    start(ctx) {
      generation++;
      const gen = generation;
      const minStreak = Number(ctx.settings.minStreak);

      ctx.on("watchStreak", (s) => {
        if (s.streak < minStreak) {
          ctx.log("info", `${s.displayName} (${s.streak}) liegt unter der Mindest-Streak von ${minStreak}`);
          return;
        }
        ctx.log("info", `Watch-Streak erkannt: ${s.displayName} → ${s.streak} Streams`);
        enqueue(ctx, s, gen);
      });
    },
    stop() {
      generation++;
    },
  };
}
