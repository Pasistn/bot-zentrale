import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { after, before, describe, it } from "node:test";
import { config } from "../src/config.js";
import { closeDb, initDb, sessionStore, twitchTokenStore } from "../src/db.js";

const user = { id: "1", login: "zuschauer", displayName: "Zuschauer", avatarUrl: null };

function raw<T>(sql: string, ...params: string[]): T {
  const db = new DatabaseSync(config.dbPath, { readOnly: true });
  try {
    return db.prepare(sql).get(...params) as T;
  } finally {
    db.close();
  }
}

describe("Datenbank", () => {
  before(() => initDb(() => undefined));
  after(() => closeDb());

  it("speichert Session-IDs nur als Hash", async () => {
    await sessionStore.create("geheime-session-id", user, "kanal", Date.now() + 60_000);

    assert.equal((await sessionStore.get("geheime-session-id"))?.user.login, "zuschauer");
    assert.equal(raw("SELECT id FROM sessions WHERE id = ?", "geheime-session-id"), undefined);
  });

  it("verwirft abgelaufene Sitzungen", async () => {
    await sessionStore.create("alt", user, "kanal", Date.now() - 1);
    assert.equal(await sessionStore.get("alt"), null);
  });

  it("speichert Twitch-Tokens verschlüsselt", async () => {
    await twitchTokenStore.save({
      login: "kanal",
      userId: "1",
      accessToken: "access-klartext",
      refreshToken: "refresh-klartext",
      scopes: ["channel:manage:redemptions"],
      expiresAt: Date.now() + 60_000,
    });

    const row = raw<{ access_token: string; refresh_token: string }>(
      "SELECT access_token, refresh_token FROM twitch_tokens WHERE login = ?",
      "kanal"
    );
    assert.ok(row.access_token.startsWith("v1:"));
    assert.ok(!row.access_token.includes("klartext"));
    assert.ok(!row.refresh_token.includes("klartext"));

    const token = await twitchTokenStore.get("kanal");
    assert.equal(token?.accessToken, "access-klartext");
    assert.equal(token?.refreshToken, "refresh-klartext");
    assert.deepEqual(token?.scopes, ["channel:manage:redemptions"]);
  });

  it("verwirft manipulierte Tokens", async () => {
    const row = raw<{ access_token: string }>("SELECT access_token FROM twitch_tokens WHERE login = ?", "kanal");
    const tampered = row.access_token.slice(0, -2) + (row.access_token.endsWith("A") ? "BB" : "AA");
    const db = new DatabaseSync(config.dbPath);
    db.prepare("UPDATE twitch_tokens SET access_token = ? WHERE login = ?").run(tampered, "kanal");
    db.close();

    assert.equal(await twitchTokenStore.get("kanal"), null);
  });
});
