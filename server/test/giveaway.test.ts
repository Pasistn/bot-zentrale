import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { closeDb, giveawayStore, initDb } from "../src/db.js";
import { GiveawayService } from "../src/giveaway.js";
import { ValidationError } from "../src/modules/manager.js";
import { TwitchHub } from "../src/twitch/hub.js";

const services: GiveawayService[] = [];

async function setup(channel: string) {
  const hub = new TwitchHub(channel, () => true);
  const service = new GiveawayService(channel, hub);
  services.push(service);
  await service.start();
  let nextId = 1;
  const chat = (login: string, text: string, extra: { subscriber?: boolean; broadcaster?: boolean } = {}) =>
    hub.handleChat(
      {
        username: login,
        "display-name": login,
        "user-id": String(nextId++),
        subscriber: extra.subscriber === true,
        badges: extra.broadcaster ? { broadcaster: "1" } : {},
      },
      text
    );
  return { service, chat };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

async function logins(service: GiveawayService): Promise<string[]> {
  return ((await service.view()).active?.entries ?? []).map((e) => e.login).sort();
}

describe("GiveawayService", () => {
  before(() => initDb(() => undefined));
  after(async () => {
    for (const service of services) service.stop();
    await closeDb();
  });

  it("prüft die Regeln beim Start", async () => {
    const { service } = await setup("kanal_regeln");
    await assert.rejects(service.open({ mode: "chat", keyword: "zwei worte" }), ValidationError);
    await assert.rejects(service.open({ mode: "chat", keyword: "!join", subMultiplier: 11 }), ValidationError);
    await service.open({ mode: "chat", keyword: "!join" });
    await assert.rejects(service.open({ mode: "chat", keyword: "!join" }), /schon ein Giveaway/);
  });

  it("nimmt Teilnehmer per Stichwort auf", async () => {
    const { service, chat } = await setup("kanal_stichwort");
    await service.open({ mode: "chat", keyword: "!Join" });

    chat("anna", "!join");
    chat("anna", "!join");
    chat("ben", "!JOIN bitte");
    chat("carl", "ich will auch !join");
    chat("kanal_stichwort", "!join", { broadcaster: true });
    await settle();

    assert.deepEqual(await logins(service), ["anna", "ben"]);
  });

  it("lässt bei „nur Subs“ niemand anderen rein", async () => {
    const { service, chat } = await setup("kanal_subs");
    await service.open({ mode: "chat", keyword: "!join", subOnly: true });
    chat("sub", "!join", { subscriber: true });
    chat("gast", "!join");
    await settle();

    assert.deepEqual(await logins(service), ["sub"]);
    assert.equal((await service.view()).active?.rejected, 1);
  });

  it("gewichtet Subs mit dem Bonus", async () => {
    const { service, chat } = await setup("kanal_bonus");
    await service.open({ mode: "chat", keyword: "!join", subMultiplier: 3 });
    chat("sub", "!join", { subscriber: true });
    chat("gast", "!join");
    await settle();

    const chances = Object.fromEntries((await service.view()).active!.entries.map((e) => [e.login, e.chance]));
    assert.equal(chances.sub, 75);
    assert.equal(chances.gast, 25);
  });

  it("zieht jeden Gewinner nur einmal, auch bei gleichzeitigen Ziehungen", async () => {
    const { service, chat } = await setup("kanal_ziehung");
    await service.open({ mode: "chat", keyword: "!join" });
    chat("anna", "!join");
    chat("ben", "!join");
    await settle();

    await Promise.all([service.draw(), service.draw()]);
    const view = await service.view();
    assert.equal(view.active?.entries.filter((e) => e.won).length, 2);
    await assert.rejects(service.draw(), /Niemand mehr im Topf/);

    const stored = await giveawayStore.entries(view.active!.id);
    assert.equal(stored.filter((e) => e.wonAt !== null).length, 2);
  });

  it("nimmt nach dem Schließen niemanden mehr auf", async () => {
    const { service, chat } = await setup("kanal_zu");
    await service.open({ mode: "chat", keyword: "!join" });
    await service.close();
    chat("spaet", "!join");
    await settle();
    assert.deepEqual(await logins(service), []);

    await service.reopen();
    chat("spaet", "!join");
    await settle();
    assert.deepEqual(await logins(service), ["spaet"]);
  });

  it("legt beendete Giveaways im Verlauf ab", async () => {
    const { service, chat } = await setup("kanal_verlauf");
    await service.endIfActive();
    await service.open({ mode: "chat", keyword: "!join" });
    chat("anna", "!join");
    await settle();
    await service.draw();
    await service.end();

    const view = await service.view();
    assert.equal(view.active, null);
    assert.equal(view.history.length, 1);
    assert.equal(view.history[0].entryCount, 1);
    assert.deepEqual(
      view.history[0].winners.map((w) => w.displayName),
      ["anna"]
    );
    assert.deepEqual(
      (await service.pastEntries(view.history[0].id)).map((e) => e.login),
      ["anna"]
    );
    await assert.rejects(service.pastEntries(view.history[0].id + 999), ValidationError);
  });
});
