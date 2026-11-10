import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import pg from "pg";

export type Dialect = "sqlite" | "postgres";
export type SqlParam = string | number | null;

export interface Db {
  readonly dialect: Dialect;
  all<T>(sql: string, params?: SqlParam[]): Promise<T[]>;
  get<T>(sql: string, params?: SqlParam[]): Promise<T | undefined>;
  run(sql: string, params?: SqlParam[]): Promise<number>;
  exec(sql: string): Promise<void>;
  batch(statements: [string, SqlParam[]][]): Promise<void>;
  close(): Promise<void>;
}

export function openSqlite(path: string): Db {
  mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec("PRAGMA journal_mode = WAL");

  return {
    dialect: "sqlite",
    async all<T>(sql: string, params: SqlParam[] = []) {
      return db.prepare(sql).all(...params) as T[];
    },
    async get<T>(sql: string, params: SqlParam[] = []) {
      return db.prepare(sql).get(...params) as T | undefined;
    },
    async run(sql, params = []) {
      return Number(db.prepare(sql).run(...params).changes);
    },
    async exec(sql) {
      db.exec(sql);
    },
    async batch(statements) {
      db.exec("BEGIN");
      try {
        for (const [sql, params] of statements) db.prepare(sql).run(...params);
        db.exec("COMMIT");
      } catch (err) {
        db.exec("ROLLBACK");
        throw err;
      }
    },
    async close() {
      db.close();
    },
  };
}

function toPg(sql: string): string {
  let n = 0;
  return sql.replace(/\?/g, () => `$${++n}`);
}

pg.types.setTypeParser(20, (value) => Number(value));
pg.types.setTypeParser(1700, (value) => Number(value));

function sslFor(url: URL, ca: string | null, warn: (message: string) => void): pg.PoolConfig["ssl"] {
  const mode = url.searchParams.get("sslmode");
  if (mode === "disable") return false;
  if (["localhost", "127.0.0.1", "::1"].includes(url.hostname) && !mode) return false;
  if (ca) return { ca, rejectUnauthorized: true };
  warn(
    "Postgres-Verbindung ist verschlüsselt, aber das Serverzertifikat wird nicht geprüft. " +
      "Für volle Sicherheit DATABASE_CA auf das CA-Zertifikat deines Anbieters setzen (Supabase: Database Settings → SSL Configuration)."
  );
  return { rejectUnauthorized: false };
}

export async function openPostgres(
  connectionString: string,
  ca: string | null,
  warn: (message: string) => void
): Promise<Db> {
  let url: URL;
  try {
    url = new URL(connectionString);
  } catch {
    throw new Error("DATABASE_URL ist keine gültige Adresse. Sie beginnt mit postgresql://");
  }
  const ssl = sslFor(url, ca, warn);
  url.searchParams.delete("sslmode");

  const pool = new pg.Pool({ connectionString: url.toString(), ssl, max: 5 });
  pool.on("error", () => undefined);

  const client = await pool.connect().catch((err: Error) => {
    throw new Error(`Postgres nicht erreichbar (${url.hostname}): ${err.message}`);
  });
  client.release();

  return {
    dialect: "postgres",
    async all<T>(sql: string, params: SqlParam[] = []) {
      return (await pool.query(toPg(sql), params)).rows as T[];
    },
    async get<T>(sql: string, params: SqlParam[] = []) {
      return (await pool.query(toPg(sql), params)).rows[0] as T | undefined;
    },
    async run(sql, params = []) {
      return (await pool.query(toPg(sql), params)).rowCount ?? 0;
    },
    async exec(sql) {
      await pool.query(sql);
    },
    async batch(statements) {
      const tx = await pool.connect();
      try {
        await tx.query("BEGIN");
        for (const [sql, params] of statements) await tx.query(toPg(sql), params);
        await tx.query("COMMIT");
      } catch (err) {
        await tx.query("ROLLBACK").catch(() => undefined);
        throw err;
      } finally {
        tx.release();
      }
    },
    async close() {
      await pool.end();
    },
  };
}
