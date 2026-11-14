import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { closeDb, initDb } from "../src/db.js";
import { ModuleManager, NotFoundError, ValidationError } from "../src/modules/manager.js";
import type { BotModule } from "../src/modules/types.js";
import type { StreamTracker } from "../src/stream/tracker.js";
import { TwitchHub } from "../src/twitch/hub.js";

function testModule(seen: string[]): BotModule {
  return {
    id: "test",
    category: "twitch",
    name: "Test",
    description: "",
    settings: [
      { key: "url", label: "URL", type: "secret", default: "", required: true, pattern: /^https:\/\// },
      { key: "every", label: "Alle", type: "number", default: 10, min: 1, max: 100 },
      { key: "color", label: "Farbe", type: "color", default: "#FFFFFF" },
      {
        key: "mode",
        label: "Modus",
        type: "select",
        default: "a",
        options: [
          { value: "a", label: "A" },
          { value: "b", label: "B" },
        ],
      },
      { key: "active", label: "Aktiv", type: "boolean", default: true },
    ],
    actions: [{ id: "ping", label: "Ping", run: async (ctx) => `pong ${ctx.settings.every}` }],
    start(ctx) {
      ctx.on("chat", (msg) => seen.push(msg.text));
    },
  };
}

function setup(channel: string) {
  const seen: string[] = [];
  const hub = new TwitchHub(channel, () => true);
  const tracker = { live: null } as unknown as StreamTracker;
  const manager = new ModuleManager(channel, hub, tracker, [testModule(seen)]);
  const chat = (text: string) => hub.handleChat({ username: "fan", "user-id": "1" }, text);
  return { seen, hub, manager, chat };
}

describe("ModuleManager", () => {
  before(() => initDb(() => undefined));
  after(() => closeDb());

  it("startet ein Modul erst, wenn alle Pflichtfelder gesetzt sind", async () => {
    const { manager } = setup("kanal_pflicht");
    const view = await manager.setEnabled("test", true);
    assert.equal(view.status, "error");
    assert.match(view.error ?? "", /URL/);
  });

  it("prüft und normalisiert Einstellungen", async () => {
    const { manager } = setup("kanal_werte");
    await assert.rejects(manager.updateSettings("test", { every: 0 }), ValidationError);
    await assert.rejects(manager.updateSettings("test", { every: "abc" }), ValidationError);
    await assert.rejects(manager.updateSettings("test", { mode: "c" }), ValidationError);
    await assert.rejects(manager.updateSettings("test", { color: "rot" }), ValidationError);
    await assert.rejects(manager.updateSettings("test", { active: "ja" }), ValidationError);
    await assert.rejects(manager.updateSettings("test", { url: "http://unsicher" }), ValidationError);
    await assert.rejects(manager.updateSettings("test", ["kein", "objekt"]), ValidationError);

    const view = await manager.updateSettings("test", { every: "25", color: "9146ff", url: "https://geheim" });
    const value = (key: string) => view.settings.find((s) => s.key === key);
    assert.equal(value("every")?.value, 25);
    assert.equal(value("color")?.value, "#9146FF");
    assert.equal(value("url")?.value, "");
    assert.equal(value("url")?.isSet, true);
  });

  it("behält ein Secret, wenn es leer gesendet wird", async () => {
    const { manager } = setup("kanal_secret");
    await manager.updateSettings("test", { url: "https://geheim" });
    await manager.updateSettings("test", { url: "", every: 5 });
    assert.equal(manager.requireSettings("test").url, "https://geheim");
  });

  it("meldet Listener beim Ausschalten ab", async () => {
    const { manager, hub, seen, chat } = setup("kanal_listener");
    await manager.updateSettings("test", { url: "https://x" });
    const view = await manager.setEnabled("test", true);
    assert.equal(view.status, "running");

    chat("eins");
    await manager.setEnabled("test", false);
    chat("zwei");

    assert.deepEqual(seen, ["eins"]);
    assert.equal(hub.listenerCount("chat"), 0);
  });

  it("führt Aktionen mit den gespeicherten Einstellungen aus", async () => {
    const { manager } = setup("kanal_aktion");
    await manager.updateSettings("test", { url: "https://x", every: 7 });
    assert.equal(await manager.runAction("test", "ping"), "pong 7");
    await assert.rejects(manager.runAction("test", "gibtsnicht"), NotFoundError);
    await assert.rejects(manager.setEnabled("gibtsnicht", true), NotFoundError);
  });

  it("trennt Einstellungen nach Kanal", async () => {
    const a = setup("kanal_eins");
    const b = setup("kanal_zwei");
    await a.manager.updateSettings("test", { every: 50 });
    assert.equal(b.manager.get("test").settings.find((s) => s.key === "every")?.value, 10);
  });
});
