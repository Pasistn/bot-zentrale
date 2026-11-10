import type { Sub } from "../twitch/types.js";
import {
  createPostQueue,
  DISCORD_WEBHOOK_PATTERN,
  discordColor,
  escapeMarkdown,
  sendDiscordWebhook,
} from "./discord-webhook.js";
import { avatarFor, SHOW_AVATAR_SETTING } from "./avatar.js";
import type { BotModule, ModuleContext } from "./types.js";

function monthsLabel(months: number): string {
  return months === 1 ? "1 Monat" : `${months} Monate`;
}

function tierLabel(s: Sub): string {
  return s.prime ? "Prime" : `Tier ${s.tier}`;
}

function parseMilestones(raw: unknown): Set<number> {
  return new Set(
    String(raw)
      .split(",")
      .map((part) => Number(part.trim()))
      .filter((n) => Number.isInteger(n) && n > 0)
  );
}

function buildPayload(ctx: ModuleContext, s: Sub, avatarUrl: string | null) {
  const channelUrl = `https://twitch.tv/${ctx.channel}`;
  const name = `**${escapeMarkdown(s.displayName)}**`;
  const title = s.firstTime ? "⭐ Neuer Sub!" : `🎉 ${monthsLabel(s.months)} Sub!`;
  const description = s.firstTime
    ? `${name} hat zum ersten Mal gesubt! Willkommen in der Community 💜`
    : `${name} ist seit **${monthsLabel(s.months)}** dabei! Danke für die Treue 💜`;

  const fields: { name: string; value: string; inline: boolean }[] = [
    { name: "Monate", value: `📅 ${s.months}`, inline: true },
    { name: "Stufe", value: tierLabel(s), inline: true },
    { name: "Kanal", value: `[twitch.tv/${ctx.channel}](${channelUrl})`, inline: true },
  ];

  if (s.userMessage && ctx.settings.showUserMessage === true) {
    fields.push({ name: "Nachricht", value: escapeMarkdown(s.userMessage).slice(0, 1024), inline: false });
  }

  return {
    username: String(ctx.settings.botName),
    allowed_mentions: { parse: [] as string[] },
    embeds: [
      {
        title,
        description,
        url: channelUrl,
        color: discordColor(ctx.settings.embedColor),
        thumbnail: avatarUrl ? { url: avatarUrl } : undefined,
        fields,
        footer: { text: `twitch.tv/${ctx.channel}` },
        timestamp: new Date().toISOString(),
      },
    ],
  };
}

export function createSubsModule(): BotModule {
  const queue = createPostQueue();

  async function post(ctx: ModuleContext, s: Sub): Promise<void> {
    const avatarUrl = await avatarFor(ctx, s.login);
    await sendDiscordWebhook(String(ctx.settings.webhookUrl), buildPayload(ctx, s, avatarUrl));
  }

  return {
    id: "subs",
    category: "twitch-discord",
    name: "Subs in Discord",
    description:
      "Postet neue Subs beim ersten Mal und Resubs zu bestimmten Monaten (z. B. 6, 12, 18, 24) in einen Discord-Kanal.",
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
        key: "postFirstSubs",
        label: "Erste Subs posten",
        type: "boolean",
        default: true,
        description: "Postet, wenn jemand zum allerersten Mal in deinem Kanal subt.",
      },
      {
        key: "milestones",
        label: "Resubs posten bei … Monaten",
        type: "text",
        default: "6, 12, 18, 24",
        description: "Monatszahlen mit Komma getrennt. Leer lassen, um keine Resubs zu posten.",
        pattern: /^\s*\d+(\s*,\s*\d+)*\s*$/,
        patternMessage: "Bitte nur Zahlen mit Komma getrennt eintragen, z. B. 6, 12, 18, 24",
      },
      {
        key: "showUserMessage",
        label: "Nachricht des Zuschauers anzeigen",
        type: "boolean",
        default: true,
      },
      SHOW_AVATAR_SETTING,
      {
        key: "botName",
        label: "Absendername in Discord",
        type: "text",
        default: "Stream Sub Bot",
      },
      {
        key: "embedColor",
        label: "Farbe des Beitrags",
        type: "color",
        default: "#F1C40F",
      },
    ],
    actions: [
      {
        id: "test",
        label: "Testbeitrag senden",
        run: async (ctx) => {
          await post(ctx, {
            login: ctx.channel,
            displayName: "Test_User",
            months: 12,
            firstTime: false,
            tier: 1,
            prime: false,
            userMessage: "Das ist nur ein Test 🎉",
          });
          return "Testbeitrag ist in Discord angekommen.";
        },
      },
    ],
    start(ctx) {
      queue.reset();
      const milestones = parseMilestones(ctx.settings.milestones);

      ctx.on("sub", (s) => {
        if (s.firstTime && ctx.settings.postFirstSubs !== true) {
          ctx.log("info", `Erster Sub von ${s.displayName} wird nicht gepostet (ausgeschaltet)`);
          return;
        }
        if (!s.firstTime && !milestones.has(s.months)) {
          ctx.log("info", `Resub von ${s.displayName} (${monthsLabel(s.months)}) ist kein Meilenstein`);
          return;
        }
        const label = s.firstTime ? "erster Sub" : monthsLabel(s.months);
        ctx.log("info", `Sub erkannt: ${s.displayName} → ${label}`);
        queue.push(
          async () => {
            await post(ctx, s);
            ctx.log("info", `An Discord gesendet: ${s.displayName} (${label})`);
          },
          (message) => ctx.log("error", `Senden fehlgeschlagen: ${message}`)
        );
      });
    },
    stop() {
      queue.reset();
    },
  };
}
