import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseGiftSub, parseRaid, parseSub, parseWatchStreak, TwitchHub } from "../src/twitch/hub.js";
import type { ChatMessage, GiftSub } from "../src/twitch/types.js";

describe("parseWatchStreak", () => {
  it("liest Name, Streak und Nachricht", () => {
    const streak = parseWatchStreak(
      "USERNOTICE",
      {
        "msg-id": "viewermilestone",
        "msg-param-category": "watch-streak",
        "msg-param-value": "12",
        "msg-param-copoReward": "450",
        login: "zuschauer",
        "display-name": "Zu\\sSchauer",
      },
      ["#kanal", "  hallo  "]
    );
    assert.deepEqual(streak, {
      displayName: "Zu Schauer",
      login: "zuschauer",
      streak: 12,
      channelPoints: 450,
      userMessage: "hallo",
    });
  });

  it("ignoriert andere Meilensteine und Befehle", () => {
    const tags = { "msg-id": "viewermilestone", "msg-param-category": "other", "msg-param-value": "3" };
    assert.equal(parseWatchStreak("USERNOTICE", tags, []), null);
    assert.equal(parseWatchStreak("PRIVMSG", { ...tags, "msg-param-category": "watch-streak" }, []), null);
  });
});

describe("parseRaid", () => {
  it("liest Raider und Viewerzahl", () => {
    const raid = parseRaid("USERNOTICE", {
      "msg-id": "raid",
      "msg-param-login": "RaiderKanal",
      "msg-param-displayName": "RaiderKanal",
      "msg-param-viewerCount": "42",
    });
    assert.deepEqual(raid, { login: "raiderkanal", displayName: "RaiderKanal", viewers: 42 });
  });

  it("verwirft Raids ohne Viewerzahl", () => {
    assert.equal(parseRaid("USERNOTICE", { "msg-id": "raid", "msg-param-login": "x" }), null);
  });
});

describe("parseSub", () => {
  it("erkennt erste Subs und Resubs mit Stufe", () => {
    const first = parseSub("USERNOTICE", { "msg-id": "sub", login: "neu", "msg-param-sub-plan": "1000" }, []);
    assert.equal(first?.firstTime, true);
    assert.equal(first?.tier, 1);

    const resub = parseSub(
      "USERNOTICE",
      { "msg-id": "resub", login: "treu", "msg-param-cumulative-months": "18", "msg-param-sub-plan": "3000" },
      ["#kanal", "danke"]
    );
    assert.equal(resub?.months, 18);
    assert.equal(resub?.tier, 3);
    assert.equal(resub?.userMessage, "danke");
  });

  it("erkennt Prime", () => {
    const prime = parseSub("USERNOTICE", { "msg-id": "sub", login: "p", "msg-param-sub-plan": "Prime" }, []);
    assert.equal(prime?.prime, true);
  });
});

describe("parseGiftSub", () => {
  it("behandelt anonyme Geschenke", () => {
    const gift = parseGiftSub("USERNOTICE", {
      "msg-id": "anonsubgift",
      login: "ananonymousgifter",
      "msg-param-recipient-display-name": "Glueckspilz",
    });
    assert.equal(gift?.gift.gifterLogin, null);
    assert.equal(gift?.gift.gifterName, "Anonym");
    assert.equal(gift?.gift.recipientName, "Glueckspilz");
  });

  it("liest die Anzahl bei Community-Gifts", () => {
    const gift = parseGiftSub("USERNOTICE", {
      "msg-id": "submysterygift",
      login: "spender",
      "display-name": "Spender",
      "msg-param-mass-gift-count": "5",
    });
    assert.equal(gift?.community, true);
    assert.equal(gift?.gift.amount, 5);
  });
});

describe("TwitchHub", () => {
  it("meldet ein Community-Gift nur einmal statt einmal pro Empfänger", () => {
    const hub = new TwitchHub("kanal", () => true);
    const gifts: GiftSub[] = [];
    hub.on("giftSub", (g) => gifts.push(g));

    hub.handleRaw("USERNOTICE", { "msg-id": "submysterygift", login: "spender", "msg-param-mass-gift-count": "3" }, []);
    for (let i = 0; i < 3; i++) {
      hub.handleRaw(
        "USERNOTICE",
        {
          "msg-id": "subgift",
          login: "spender",
          "msg-param-community-gift-id": "abc",
          "msg-param-recipient-display-name": `E${i}`,
        },
        []
      );
    }
    hub.handleRaw(
      "USERNOTICE",
      { "msg-id": "subgift", login: "spender", "msg-param-recipient-display-name": "Einzeln" },
      []
    );

    assert.equal(gifts.length, 2);
    assert.equal(gifts[0].amount, 3);
    assert.equal(gifts[1].recipientName, "Einzeln");
  });

  it("wandelt Chatnachrichten um und meldet Bits", () => {
    const hub = new TwitchHub("kanal", () => true);
    const messages: ChatMessage[] = [];
    const cheers: number[] = [];
    hub.on("chat", (m) => messages.push(m));
    hub.on("cheer", (c) => cheers.push(c.bits));

    hub.handleChat(
      {
        username: "fan",
        "display-name": "Fan",
        "user-id": "7",
        subscriber: true,
        badges: { broadcaster: "1" },
        bits: "100",
      },
      "Cheer100 hi"
    );

    assert.equal(messages[0].isSubscriber, true);
    assert.equal(messages[0].isBroadcaster, true);
    assert.equal(messages[0].userId, "7");
    assert.deepEqual(cheers, [100]);
  });
});
