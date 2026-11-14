import type { GiftSub } from "../twitch/types.js";
import {
  createPostQueue,
  DISCORD_WEBHOOK_PATTERN,
  discordColor,
  escapeMarkdown,
  sendDiscordWebhook,
} from "./discord-webhook.js";
import { avatarFor, SHOW_AVATAR_SETTING } from "./avatar.js";
import type { BotModule, ModuleContext } from "./types.js";

function subsLabel(amount: number): string {
  return amount === 1 ? "1 Sub" : `${amount} Subs`;
}

function buildPayload(ctx: ModuleContext, g: GiftSub, avatarUrl: string | null) {
  const name = `**${escapeMarkdown(g.gifterName)}**`;
  const description = g.recipientName
    ? `${name} hat **${escapeMarkdown(g.recipientName)}** einen Sub geschenkt!`
    : `${name} hat **${subsLabel(g.amount)}** an die Community verschenkt!`;

  const fields: { name: string; value: string; inline: boolean }[] = [
    { name: "Anzahl", value: `🎁 ${subsLabel(g.amount)}`, inline: true },
    { name: "Stufe", value: `Tier ${g.tier}`, inline: true },
  ];

  if (g.senderTotal !== null && ctx.settings.showTotal === true) {
    fields.push({ name: "Insgesamt verschenkt", value: subsLabel(g.senderTotal), inline: true });
  }

  return {
    username: String(ctx.settings.botName),
    allowed_mentions: { parse: [] as string[] },
    embeds: [
      {
        title: "🎁 Gifted Subs!",
        description,
        url: `https://twitch.tv/${ctx.channel}`,
        color: discordColor(ctx.settings.embedColor),
        thumbnail: avatarUrl ? { url: avatarUrl } : undefined,
        fields,
        footer: { text: `twitch.tv/${ctx.channel}` },
        timestamp: new Date().toISOString(),
      },
    ],
  };
}

export function createGiftSubsModule(): BotModule {
  const queue = createPostQueue();

  async function post(ctx: ModuleContext, g: GiftSub): Promise<void> {
    const avatarUrl = await avatarFor(ctx, g.gifterLogin);
    await sendDiscordWebhook(String(ctx.settings.webhookUrl), buildPayload(ctx, g, avatarUrl));
  }

  return {
    id: "gift-subs",
    category: "twitch-discord",
    name: "Gifted Subs in Discord",
    description: "Postet verschenkte Subs mit dem Namen des Schenkers und der Anzahl in einen Discord-Kanal.",
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
        key: "minGifts",
        label: "Mindestanzahl",
        type: "number",
        default: 1,
        min: 1,
        max: 1000,
        description: "Erst ab so vielen verschenkten Subs auf einmal wird gepostet.",
      },
      {
        key: "includeAnonymous",
        label: "Anonyme Geschenke posten",
        type: "boolean",
        default: true,
      },
      {
        key: "showTotal",
        label: "Gesamtzahl des Schenkers anzeigen",
        type: "boolean",
        default: true,
        description:
          "Wie viele Subs die Person bisher insgesamt in deinem Kanal verschenkt hat, sofern Twitch das mitschickt.",
      },
      SHOW_AVATAR_SETTING,
      {
        key: "botName",
        label: "Absendername in Discord",
        type: "text",
        default: "Stream Gift Bot",
      },
      {
        key: "embedColor",
        label: "Farbe des Beitrags",
        type: "color",
        default: "#E91E63",
      },
    ],
    actions: [
      {
        id: "test",
        label: "Testbeitrag senden",
        run: async (ctx) => {
          await post(ctx, {
            gifterLogin: ctx.channel,
            gifterName: "Test_User",
            amount: 5,
            tier: 1,
            recipientName: null,
            senderTotal: 23,
          });
          return "Testbeitrag ist in Discord angekommen.";
        },
      },
    ],
    start(ctx) {
      queue.reset();
      const minGifts = Number(ctx.settings.minGifts);

      ctx.on("giftSub", (g) => {
        if (g.gifterLogin === null && ctx.settings.includeAnonymous !== true) {
          ctx.log("info", `Anonymes Geschenk (${subsLabel(g.amount)}) wird nicht gepostet`);
          return;
        }
        if (g.amount < minGifts) {
          ctx.log("info", `${g.gifterName} (${subsLabel(g.amount)}) liegt unter der Mindestanzahl von ${minGifts}`);
          return;
        }
        ctx.log("info", `Gifted Subs erkannt: ${g.gifterName} → ${subsLabel(g.amount)}`);
        queue.push(
          async () => {
            await post(ctx, g);
            ctx.log("info", `An Discord gesendet: ${g.gifterName} (${subsLabel(g.amount)})`);
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
