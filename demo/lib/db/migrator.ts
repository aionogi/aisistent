import { createHash, createHmac, pbkdf2Sync, randomBytes } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { Client } from "pg";
import { APP_LOGIN_ROLE, RUNTIME_ROLE } from "./config.ts";

/** Arbitrary constant; serializes concurrent migration runs (for example two deploys). */
const MIGRATION_LOCK_ID = 7_302_024_001;

export type MigrationResult = { applied: string[]; skipped: string[] };

type MigrationFile = { version: string; sql: string; checksum: string };

async function readMigrations(directory: string): Promise<MigrationFile[]> {
  const names = (await readdir(directory)).filter((name) => /^\d{4}_[a-z0-9_]+\.sql$/.test(name)).sort();
  return Promise.all(names.map(async (name) => {
    const sql = await readFile(path.join(directory, name), "utf8");
    return { version: name.replace(/\.sql$/, ""), sql, checksum: createHash("sha256").update(sql).digest("hex") };
  }));
}

/**
 * Applies pending SQL migrations in order, each in its own transaction, as the
 * database owner. Refuses to continue if an applied migration file has changed.
 */
export async function migrate(client: Client, directory: string): Promise<MigrationResult> {
  const result: MigrationResult = { applied: [], skipped: [] };
  await client.query("SELECT pg_advisory_lock($1)", [MIGRATION_LOCK_ID]);
  try {
    await client.query(`CREATE TABLE IF NOT EXISTS public.schema_migrations (
      version text PRIMARY KEY,
      checksum text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    )`);
    const { rows } = await client.query<{ version: string; checksum: string }>("SELECT version, checksum FROM public.schema_migrations");
    const applied = new Map(rows.map((row) => [row.version, row.checksum]));

    for (const migration of await readMigrations(directory)) {
      const previous = applied.get(migration.version);
      if (previous) {
        if (previous !== migration.checksum) {
          throw new Error(`Migration ${migration.version} was changed after it was applied. Add a new migration instead.`);
        }
        result.skipped.push(migration.version);
        continue;
      }
      await client.query("BEGIN");
      try {
        await client.query(migration.sql);
        await client.query("INSERT INTO public.schema_migrations (version, checksum) VALUES ($1, $2)", [migration.version, migration.checksum]);
        await client.query("COMMIT");
        result.applied.push(migration.version);
      } catch (error) {
        await client.query("ROLLBACK");
        throw new Error(`Migration ${migration.version} failed: ${(error as Error).message}`, { cause: error });
      }
    }
    return result;
  } finally {
    await client.query("SELECT pg_advisory_unlock($1)", [MIGRATION_LOCK_ID]);
  }
}

const SCRAM_ITERATIONS = 4096;

/**
 * The password as a SCRAM-SHA-256 verifier in PostgreSQL's stored format
 * (RFC 5802/7677). PostgreSQL keeps a pre-hashed value as given, so the plain
 * password never appears in the SQL text, statement logs or pg_stat_activity.
 * Only printable ASCII is accepted: PostgreSQL would apply SASLprep to other
 * characters at sign-in, which this function does not replicate.
 */
export function scramVerifier(password: string, salt: Buffer = randomBytes(16), iterations = SCRAM_ITERATIONS): string {
  if (!/^[\x21-\x7e]+$/.test(password)) throw new Error("The application database password must be printable ASCII without spaces.");
  const salted = pbkdf2Sync(password, salt, iterations, 32, "sha256");
  const storedKey = createHash("sha256").update(createHmac("sha256", salted).update("Client Key").digest()).digest();
  const serverKey = createHmac("sha256", salted).update("Server Key").digest();
  return `SCRAM-SHA-256$${iterations}:${salt.toString("base64")}$${storedKey.toString("base64")}:${serverKey.toString("base64")}`;
}

/**
 * Limits for every session of the application login. They are role settings,
 * not connection options, so they also apply through a transaction pooler
 * (Supabase's Supavisor), which does not pass connection options on.
 */
export const APP_LOGIN_SETTINGS = { statement_timeout: "10s", idle_in_transaction_session_timeout: "30s" } as const;

/**
 * Ensures the application's login role exists with the given password, only
 * the runtime role's privileges, and APP_LOGIN_SETTINGS. It is not a member of
 * the owner role, so a compromised application connection cannot switch to
 * owner rights.
 */
export async function ensureAppLogin(client: Pick<Client, "query" | "escapeLiteral">, password: string): Promise<void> {
  if (password.length < 32) throw new Error("The application database password must be at least 32 characters.");
  const exists = await client.query("SELECT 1 FROM pg_roles WHERE rolname = $1", [APP_LOGIN_ROLE]);
  const literal = client.escapeLiteral(scramVerifier(password));
  if (exists.rowCount === 0) {
    await client.query(`CREATE ROLE ${APP_LOGIN_ROLE} LOGIN PASSWORD ${literal} IN ROLE ${RUNTIME_ROLE}`);
  } else {
    await client.query(`ALTER ROLE ${APP_LOGIN_ROLE} WITH LOGIN PASSWORD ${literal}`);
    await client.query(`GRANT ${RUNTIME_ROLE} TO ${APP_LOGIN_ROLE}`);
  }
  for (const [setting, value] of Object.entries(APP_LOGIN_SETTINGS)) {
    await client.query(`ALTER ROLE ${APP_LOGIN_ROLE} SET ${setting} = ${client.escapeLiteral(value)}`);
  }
}
