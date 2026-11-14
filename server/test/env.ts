import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "bot-zentrale-test-"));

Object.assign(process.env, {
  PUBLIC_URL: "http://localhost:5173",
  TWITCH_CLIENT_ID: "test-client",
  TWITCH_CLIENT_SECRET: "test-secret",
  OWNER_LOGINS: "testowner",
  TWITCH_CHANNEL: "",
  SESSION_SECRET: "0123456789abcdef0123456789abcdef0123456789abcdef",
  DB_PATH: join(dir, "bot.db"),
  DATABASE_URL: "",
  MEDIA_QUOTA_MB: "1",
});
