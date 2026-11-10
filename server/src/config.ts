import { config as loadEnv } from "dotenv";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

export const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

loadEnv({ path: resolve(rootDir, ".env") });

function fail(message: string): never {
  console.error(`Fehler: ${message}`);
  process.exit(1);
}

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) fail(`Die Variable ${name} fehlt in der .env-Datei.`);
  return value;
}

function optionalNumber(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value)) fail(`${name} muss eine Zahl sein.`);
  return value;
}

const publicUrl = required("PUBLIC_URL").replace(/\/+$/, "");
let publicOrigin: string;
try {
  publicOrigin = new URL(publicUrl).origin;
} catch {
  fail("PUBLIC_URL ist keine gültige URL, z. B. http://localhost:5173");
}

const sessionSecret = required("SESSION_SECRET");
if (sessionSecret.length < 32) {
  fail("SESSION_SECRET muss mindestens 32 Zeichen lang sein. Erzeuge eins mit: npm run secret");
}

const adminLogins = required("ADMIN_LOGINS")
  .split(",")
  .map((login) => login.trim().toLowerCase())
  .filter(Boolean);

if (adminLogins.length === 0) fail("ADMIN_LOGINS muss mindestens einen Twitch-Namen enthalten.");

const dbPath = resolve(rootDir, process.env.DB_PATH?.trim() || "data/bot.db");

export const config = {
  port: optionalNumber("PORT", 3000),
  host: process.env.HOST?.trim() || "127.0.0.1",
  publicUrl,
  publicOrigin,
  redirectUri: `${publicUrl}/auth/callback`,
  secureCookies: publicUrl.startsWith("https://"),
  twitchClientId: required("TWITCH_CLIENT_ID"),
  twitchClientSecret: required("TWITCH_CLIENT_SECRET"),
  twitchChannel: required("TWITCH_CHANNEL").toLowerCase().replace(/^#/, ""),
  adminLogins,
  sessionSecret,
  sessionDays: optionalNumber("SESSION_DAYS", 7),
  dbPath,
  mediaDir: resolve(dirname(dbPath), "media"),
  databaseUrl: process.env.DATABASE_URL?.trim() || null,
  databaseCaPath: process.env.DATABASE_CA?.trim() ? resolve(rootDir, process.env.DATABASE_CA.trim()) : null,
  webDist: resolve(rootDir, "web/dist"),
};
