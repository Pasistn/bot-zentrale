import { readFileSync } from "node:fs";
import { config } from "./config.js";
import { accessStore, channelStore } from "./db/channels.js";
import { db, useDb } from "./db/connection.js";
import { openPostgres, openSqlite } from "./db/driver.js";
import {
  backupBeforeUpgrade,
  hashStoredSessions,
  importFromSqlite,
  migrate,
  sealStoredTokens,
  type Log,
} from "./db/migrations.js";
import { moduleStore } from "./db/modules.js";

export * from "./db/channels.js";
export * from "./db/giveaways.js";
export * from "./db/modules.js";
export * from "./db/sessions.js";
export * from "./db/streams.js";
export { legacyChannel } from "./db/migrations.js";

export async function initDb(log: Log): Promise<void> {
  if (config.databaseUrl) {
    const ca = config.databaseCaPath ? readFileSync(config.databaseCaPath, "utf8") : null;
    useDb(await openPostgres(config.databaseUrl, ca, (message) => log("warn", message)));
    await migrate(db);
    await importFromSqlite(db, config.dbPath, log);
    log("info", "Datenbank: Postgres");
  } else {
    useDb(openSqlite(config.dbPath));
    await backupBeforeUpgrade(db, config.dbPath, log);
    await migrate(db);
    log("info", `Datenbank: ${config.dbPath}`);
  }
  await hashStoredSessions(db);
  await sealStoredTokens(db);
  await channelStore.load();
  await accessStore.load();
  await moduleStore.load();
}

export async function closeDb(): Promise<void> {
  await db?.close();
}
