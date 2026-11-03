// Applies new database migrations to the live Supabase database, from your own
// computer, and nothing else. Unlike npm run setup:supabase it never changes
// the app login's password or any secret and writes no file, so the live site
// keeps working. Every run also removes privileges Supabase's API roles hold
// on the app's objects. Settings come from demo/.env.supabase.local
// (SUPABASE_SESSION_POOLER_URL, SUPABASE_DB_PASSWORD, SUPABASE_CA_CERT_FILE).
// Values are never printed.
//
//   npm run migrate:supabase
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";
import { connectionHint, migrateDatabase, SetupError, supabaseConnection } from "../../lib/db/supabase-setup.ts";

const projectDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const settingsFile = path.join(projectDir, ".env.supabase.local");

try {
  if (!existsSync(settingsFile)) {
    throw new SetupError(`Missing ${settingsFile}. It needs SUPABASE_SESSION_POOLER_URL, SUPABASE_DB_PASSWORD and SUPABASE_CA_CERT_FILE, as for npm run setup:supabase.`);
  }
  const { adminUrl, caCert } = supabaseConnection(parseEnv(readFileSync(settingsFile, "utf8")), settingsFile);
  console.log("Applying migrations…");
  const report = await migrateDatabase({ adminUrl, caCert, migrationsDir: path.join(projectDir, "db/migrations") });
  console.log(`
Migrations: ${report.applied.length ? report.applied.join(", ") : "none new"} (${report.alreadyApplied} already in place).
PostgreSQL: ${report.postgresMajor}${report.postgresMajor === 17 ? "" : " (the app is developed and tested on 17; tell your developer)"}.
Supabase's API roles: ${report.revokedFrom.length ? `no privileges left on the app's objects (checked ${report.revokedFrom.join(", ")})` : "not present"}.
The app login, its password and the secrets were not changed; nothing in Vercel needs updating.
`);
} catch (error) {
  const message = (error as Error).message;
  console.error(`\n${message}${error instanceof SetupError ? "" : connectionHint(message)}\n`);
  process.exitCode = 1;
}
