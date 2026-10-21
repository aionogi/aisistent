// Applies database migrations as the owner and refreshes the application login.
// Render runs this as the web service's preDeployCommand: `npm run db:migrate`.
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { adminConnectionString } from "../../lib/db/config.ts";
import { ensureAppLogin, migrate } from "../../lib/db/migrator.ts";

const migrationsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../db/migrations");

const client = new pg.Client({ connectionString: adminConnectionString(), application_name: "aisistent-migrate" });
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
