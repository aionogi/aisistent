// Applies database migrations as the owner and refreshes the application login.
// Run it from a trusted machine or CI before deploying, never in the Vercel
// build: the web environment must not hold DATABASE_ADMIN_URL. On Supabase use
// the session pooler or a direct connection (the migrator needs a session for
// its advisory lock) and set DATABASE_CA_CERT; see docs/operations/RUNBOOK.md.
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { adminConnectionString, connectionOptions } from "../../lib/db/config.ts";
import { ensureAppLogin, migrate } from "../../lib/db/migrator.ts";

const migrationsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../db/migrations");

const client = new pg.Client({ ...connectionOptions(adminConnectionString()), application_name: "aisistent-migrate" });
await client.connect();
try {
  const { applied, skipped } = await migrate(client, migrationsDir);
  console.log(`Migrations applied: ${applied.length ? applied.join(", ") : "none"} (${skipped.length} already applied).`);
  const password = process.env.DATABASE_APP_PASSWORD;
  if (password) {
    await ensureAppLogin(client, password);
    console.log("Application database login is up to date.");
  } else {
    console.log("DATABASE_APP_PASSWORD is not set; skipped the application login.");
  }
} finally {
  await client.end();
}
