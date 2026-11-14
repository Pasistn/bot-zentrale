import {
  getSummary,
  postSummary,
  buildSummaryMessage,
  summaryOptions,
  summaryText,
  type SummaryView,
} from "../summaries.js";
import { DISCORD_WEBHOOK_PATTERN, sendDiscordWebhook } from "./discord-webhook.js";
import type { BotModule, ModuleContext } from "./types.js";

export function createStreamSummaryModule(): BotModule {
  async function finished(ctx: ModuleContext, sessionId: number): Promise<void> {
    const summary = await getSummary(ctx.channel, sessionId);
    ctx.log("info", `Stream beendet. ${summary?.text ?? ""}`);

    if (ctx.settings.autoPost !== true) {
      ctx.log("info", "Die Zusammenfassung wartet im Dashboard auf deine Freigabe");
      return;
    }
    try {
      await postSummary(ctx.channel, sessionId, ctx.settings);
    } catch {
      ctx.log("warn", "Automatisches Posten fehlgeschlagen. Die Zusammenfassung wartet im Dashboard.");
    }
  }

  return {
    id: "stream-summary",
    category: "twitch-discord",
    name: "Stream-Zusammenfassung",
    description:
      "Nach jedem Stream erscheint die Zusammenfassung mit Raids, Gifted Subs, Chat und Viewer-Peak im Dashboard und wird automatisch oder nach deiner Freigabe in Discord gepostet.",
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
        key: "autoPost",
        label: "Automatisch in Discord posten",
        type: "boolean",
        default: false,
        description: "Aus: Die Zusammenfassung wartet im Dashboard, bis du sie freigibst.",
      },
      {
        key: "showChat",
        label: "Chatnachrichten anzeigen",
        type: "boolean",
        default: true,
        description: "Zeigt die Anzahl der Chatnachrichten im Stream an.",
      },
      {
        key: "showRaids",
        label: "Raids anzeigen",
        type: "boolean",
        default: true,
        description: "Gab es im Stream keine Raids, fällt der Abschnitt automatisch weg.",
      },
      {
        key: "showGifts",
        label: "Gifted Subs anzeigen",
        type: "boolean",
        default: true,
        description: "Gab es im Stream keine Gifted Subs, fällt der Abschnitt automatisch weg.",
      },
      {
        key: "showClip",
        label: "Clip des Streams anhängen",
        type: "boolean",
        default: true,
        description:
          "Hängt einen Clip aus dem Stream an, bei mehreren einen zufälligen. Gab es keinen Clip, erscheint ein Platzhalterbild.",
      },
      {
        key: "botName",
        label: "Absendername in Discord",
        type: "text",
        default: "Stream Highlights",
      },
      {
        key: "embedColor",
        label: "Farbe des Beitrags",
        type: "color",
        default: "#9146FF",
      },
    ],
    actions: [
      {
        id: "test",
        label: "Testbeitrag senden",
        run: async (ctx) => {
          const base: Omit<SummaryView, "text"> = {
            id: 0,
            status: "pending",
            streamer: ctx.channel,
            title: "Das ist nur ein Test 🎉",
            games: ["Just Chatting"],
            startedAt: new Date(Date.now() - 192 * 60_000).toISOString(),
            endedAt: new Date().toISOString(),
            durationMinutes: 192,
            peakViewers: 15,
            chatMessages: 1234,
            raids: {
              count: 3,
              viewers: 100,
              list: [
                { name: "Raider_Eins", login: "raider_eins", amount: 60 },
                { name: "Raider_Zwei", login: "raider_zwei", amount: 30 },
                { name: "Raider_Drei", login: "raider_drei", amount: 10 },
              ],
            },
            gifts: { count: 4, gifters: [{ name: "Test_User", login: "test_user", amount: 4 }] },
            postedAt: null,
            postError: null,
          };

          const { payload, files } = await buildSummaryMessage(
            { ...base, text: summaryText(base, summaryOptions(ctx.settings)) },
            ctx.settings,
            ctx.channel
          );
          await sendDiscordWebhook(String(ctx.settings.webhookUrl), payload, files);
          return "Testbeitrag ist in Discord angekommen.";
        },
      },
    ],
    start(ctx) {
      ctx.on("streamOffline", (info) => void finished(ctx, info.sessionId));
    },
  };
}
