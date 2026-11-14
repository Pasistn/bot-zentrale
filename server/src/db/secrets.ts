import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes } from "node:crypto";
import { config } from "../config.js";

export function hashSessionId(id: string): string {
  return createHash("sha256").update(id).digest("hex");
}

const SEALED_PREFIX = "v1:";
const tokenKey = Buffer.from(hkdfSync("sha256", config.sessionSecret, "", "bot-zentrale/twitch-tokens", 32));

export function seal(value: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", tokenKey, iv);
  const data = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return SEALED_PREFIX + Buffer.concat([iv, cipher.getAuthTag(), data]).toString("base64url");
}

export function unseal(value: string): string | null {
  if (!value.startsWith(SEALED_PREFIX)) return value;
  try {
    const raw = Buffer.from(value.slice(SEALED_PREFIX.length), "base64url");
    const decipher = createDecipheriv("aes-256-gcm", tokenKey, raw.subarray(0, 12));
    decipher.setAuthTag(raw.subarray(12, 28));
    return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}
