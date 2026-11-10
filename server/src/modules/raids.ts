import { getChannelProfile, type ChannelProfile } from "../twitch/helix.js";
import type { Raid } from "../twitch/types.js";
import {
  createPostQueue,
  DISCORD_WEBHOOK_PATTERN,
  discordColor,
  escapeMarkdown,
  sendDiscordWebhook,
} from "./discord-webhook.js";
import type { BotModule, ModuleContext } from "./types.js";

function viewersLabel(viewers: number): string {
  return viewers === 1 ? "1 Viewer" : `${viewers} Viewern`;
}

function buildPayload(ctx: ModuleContext, r: Raid, profile: ChannelProfile | null) {
  const channelUrl = `https://twitch.tv/${r.login}`;
  const fields: { name: string; value: string; inline: boolean }[] = [
    { name: "Viewer", value: `🚀 ${r.viewers}`, inline: true },
    { name: "Kanal", value: `[twitch.tv/${r.login}](${channelUrl})`, inline: true },
  ];

  if (profile?.gameName) {
    fields.push({ name: "Zuletzt gestreamt", value: escapeMarkdown(profile.gameName), inline: true });
  }

  return {
    username: String(ctx.settings.botName),
    allowed_mentions: { parse: [] as string[] },
    embeds: [
      {
        title: `🚀 Raid von ${r.displayName}!`,
        description:
          `**${escapeMarkdown(r.displayName)}** raidet den Stream mit **${viewersLabel(r.viewers)}**!\n` +
          `Schaut bei ${channelUrl} vorbei und lasst einen Follow da 💜`,
        url: channelUrl,
        color: discordColor(ctx.settings.embedColor),
        thumbnail: profile?.avatarUrl ? { url: profile.avatarUrl } : undefined,
        fields,
        footer: { text: `twitch.tv/${ctx.channel}` },
        timestamp: new Date().toISOString(),
      },
    ],
  };
}

export function createRaidsModule(): BotModule {
  const queue = createPostQueue();

  async function post(ctx: ModuleContext, r: Raid): Promise<void> {
    let profile: ChannelProfile | null = null;
    if (ctx.settings.showProfile === true) {
      try {
        profile = await getChannelProfile(r.login);
      } catch (err) {
        ctx.log("warn", `Profil von ${r.login} nicht geladen: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    await sendDiscordWebhook(String(ctx.settings.webhookUrl), buildPayload(ctx, r, profile));
  }

  return {
    id: "raids",
    category: "twitch-discord",
    name: "Raids in Discord",
    description:
      "Postet eingehende Raids ab einer bestimmten Viewerzahl mit Streamer, Anzahl der Viewer und Link zu seinem Kanal in einen Discord-Kanal.",
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
        key: "minViewers",
        label: "Mindestanzahl Viewer",
        type: "number",
        default: 5,
        min: 1,
        max: 100000,
        description: "Nur Raids mit mindestens so vielen Viewern werden gepostet.",
      },
      {
        key: "showProfile",
        label: "Profilbild und Kategorie des Streamers anzeigen",
        type: "boolean",
        default: true,
        description: "Holt Profilbild und zuletzt gestreamte Kategorie über die Twitch-API.",
      },
      {
        key: "botName",
        label: "Absendername in Discord",
        type: "text",
        default: "Stream Raid Bot",
      },
      {
        key: "embedColor",
        label: "Farbe des Beitrags",
        type: "color",
        default: "#00B894",
      },
    ],
    actions: [
      {
        id: "test",
        label: "Testbeitrag senden",
        run: async (ctx) => {
          await post(ctx, { login: ctx.channel, displayName: ctx.channel, viewers: 42 });
          return "Testbeitrag ist in Discord angekommen.";
        },
      },
    ],
    start(ctx) {
      queue.reset();
      const minViewers = Number(ctx.settings.minViewers);

      ctx.on("raid", (r) => {
        if (r.viewers < minViewers) {
          ctx.log("info", `Raid von ${r.displayName} (${r.viewers}) liegt unter der Mindestanzahl von ${minViewers}`);
          return;
        }
        ctx.log("info", `Raid erkannt: ${r.displayName} mit ${viewersLabel(r.viewers)}`);
        queue.push(
          async () => {
            await post(ctx, r);
            ctx.log("info", `An Discord gesendet: Raid von ${r.displayName} (${r.viewers} Viewer)`);
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
