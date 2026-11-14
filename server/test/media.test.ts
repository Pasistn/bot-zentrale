import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isMediaFile, listMedia, MAX_MEDIA_BYTES, MediaError, mediaKind, mediaPath, saveMedia } from "../src/media.js";

const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32)]);
const mp3 = Buffer.concat([Buffer.from("ID3"), Buffer.alloc(32)]);

describe("saveMedia", () => {
  it("erkennt das Format am Inhalt, nicht am Dateinamen", async () => {
    const media = await saveMedia("kanal_a", "Mein Bild.mp3", png);
    assert.equal(media.kind, "image");
    assert.match(media.file, /^[a-f0-9]{12}--mein-bild\.png$/);
  });

  it("lehnt HTML und SVG ab, auch mit Bild-Endung", async () => {
    await assert.rejects(
      saveMedia("kanal_a", "x.png", Buffer.from("<html><script>alert(1)</script></html>")),
      MediaError
    );
    await assert.rejects(
      saveMedia("kanal_a", "x.svg", Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'></svg>")),
      MediaError
    );
  });

  it("lehnt leere und zu große Dateien ab", async () => {
    await assert.rejects(saveMedia("kanal_a", "leer.png", Buffer.alloc(0)), MediaError);
    await assert.rejects(saveMedia("kanal_a", "gross.png", Buffer.alloc(MAX_MEDIA_BYTES + 1)), MediaError);
  });

  it("trennt Dateien nach Kanal", async () => {
    await saveMedia("kanal_b", "ton.mp3", mp3);
    const a = await listMedia("kanal_a");
    const b = await listMedia("kanal_b");
    assert.ok(a.every((m) => m.kind === "image"));
    assert.deepEqual(
      b.map((m) => m.kind),
      ["audio"]
    );
  });

  it("begrenzt den Speicher pro Kanal", async () => {
    const part = Buffer.concat([png, Buffer.alloc(400 * 1024)]);
    await saveMedia("kanal_c", "eins.png", part);
    await saveMedia("kanal_c", "zwei.png", part);
    await assert.rejects(saveMedia("kanal_c", "drei.png", part), /Speicher für diesen Kanal ist voll \(1 MB\)/);
    await saveMedia("kanal_d", "anderer-kanal.png", part);
  });
});

describe("Dateinamen", () => {
  it("lässt nur selbst erzeugte Namen zu", () => {
    assert.equal(isMediaFile("0123456789ab--bild.png"), true);
    for (const name of [
      "../bot.db",
      "0123456789ab--../../x.png",
      "0123456789ab--bild.html",
      "bild.png",
      "0123456789ab--Bild.png",
    ]) {
      assert.equal(isMediaFile(name), false, name);
    }
  });

  it("verhindert Pfade außerhalb des Kanalordners", () => {
    assert.throws(() => mediaPath("kanal_a", "../../etc/passwd"), MediaError);
    assert.throws(() => mediaPath("../kanal", "0123456789ab--bild.png"), MediaError);
  });

  it("ordnet Endungen der richtigen Art zu", () => {
    assert.equal(mediaKind("0123456789ab--clip.webm"), "video");
    assert.equal(mediaKind("0123456789ab--ton.ogg"), "audio");
    assert.equal(mediaKind("kein-medium.txt"), null);
  });
});
