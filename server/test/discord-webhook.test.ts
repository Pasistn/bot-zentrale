import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DISCORD_WEBHOOK_PATTERN, discordColor, escapeMarkdown } from "../src/modules/discord-webhook.js";

describe("DISCORD_WEBHOOK_PATTERN", () => {
  it("nimmt echte Webhook-URLs an", () => {
    assert.ok(DISCORD_WEBHOOK_PATTERN.test("https://discord.com/api/webhooks/123456/abc_DEF-ghi"));
    assert.ok(DISCORD_WEBHOOK_PATTERN.test("https://ptb.discord.com/api/webhooks/1/x"));
    assert.ok(DISCORD_WEBHOOK_PATTERN.test("https://discordapp.com/api/webhooks/1/x"));
  });

  it("lehnt fremde Ziele ab", () => {
    for (const url of [
      "http://discord.com/api/webhooks/1/x",
      "https://discord.com.evil.example/api/webhooks/1/x",
      "https://evil.example/https://discord.com/api/webhooks/1/x",
      "https://discord.com/api/webhooks/1/x?wait=true",
      "https://127.0.0.1/api/webhooks/1/x",
    ]) {
      assert.equal(DISCORD_WEBHOOK_PATTERN.test(url), false, url);
    }
  });
});

describe("escapeMarkdown", () => {
  it("entschärft Markdown in Namen und Nachrichten", () => {
    assert.equal(escapeMarkdown("**fett** _x_ [link](y)"), "\\*\\*fett\\*\\* \\_x\\_ \\[link\\]\\(y\\)");
  });
});

describe("discordColor", () => {
  it("wandelt Hex in eine Zahl um", () => {
    assert.equal(discordColor("#9146FF"), 0x9146ff);
  });
});
