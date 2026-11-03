// Restore drill for the live Supabase database, run on your own computer. It
// takes a consistent, read-only copy of the application's data, restores it
// into a temporary PostgreSQL 17 database on this computer with new
// credentials, checks the copy, lists changes made after the snapshot, and
// deletes the copy. The live database is never changed.
//
// Settings come from demo/.env.supabase.local, the file `npm run
// setup:supabase` uses (created as a template when missing). It also needs
// PostgreSQL 17's pg_dump and pg_restore: PG_CLIENT_BIN_DIR in that file or in
// the environment, or on PATH. Values are never printed.
//
//   npm run drill:restore              checks, then deletes everything
//   npm run drill:restore:serve        also opens the restored copy at
//                                      http://127.0.0.1:4320 to sign in with
//                                      your Auth0 tenant; Ctrl+C deletes it
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";
import { connectionHint, SetupError, supabaseConnection } from "../../lib/db/supabase-setup.ts";
import { DrillError, formatDrillReport, runRestoreDrill } from "../../tests/recovery/drill.ts";
import { Auth0SettingsError, readAuth0Settings, runAppWithAuth0 } from "../dev/auth0-app.ts";

const projectDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const settingsFile = path.join(projectDir, ".env.supabase.local");
const auth0File = path.join(projectDir, ".env.auth0.local");
const serve = process.argv.includes("--serve");
const port = Number(process.env.PORT ?? 4320);
const appUrl = `http://127.0.0.1:${port}`;

const TEMPLATE = `# Settings for npm run drill:restore (and npm run setup:supabase). Git ignores this file. Keep the single quotes.
# Supabase -> Connect -> Session pooler, exactly as shown:
SUPABASE_SESSION_POOLER_URL='<session pooler address>'
# The database password:
SUPABASE_DB_PASSWORD='<database password>'
# The certificate you downloaded, for example C:\\Users\\you\\Documents\\aisistent\\prod-ca-2021.crt
SUPABASE_CA_CERT_FILE='<path to prod-ca-2021.crt>'
# The folder with PostgreSQL 17's pg_dump.exe and pg_restore.exe:
PG_CLIENT_BIN_DIR='<folder>'
# Only for --serve, from the Auth0 application's Settings page (or use .env.auth0.local):
# AUTH0_DOMAIN='<tenant>.eu.auth0.com'
# AUTH0_CLIENT_ID='<Client ID>'
# AUTH0_CLIENT_SECRET='<Client Secret>'
`;

try {
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new SetupError("PORT must be a number between 1024 and 65535.");
  if (!existsSync(settingsFile)) {
    writeFileSync(settingsFile, TEMPLATE);
    throw new SetupError(`Created ${settingsFile}. Fill it in and run this command again.`);
  }
  const settings = parseEnv(readFileSync(settingsFile, "utf8"));
  const value = (key: string) => settings[key]?.trim() ?? "";
  const { adminUrl, caCert } = supabaseConnection(settings, settingsFile);
  const toolDir = process.env.PG_CLIENT_BIN_DIR || (value("PG_CLIENT_BIN_DIR").includes("<") ? "" : value("PG_CLIENT_BIN_DIR"));
  if (toolDir) process.env.PG_CLIENT_BIN_DIR = toolDir;
  // Read before the drill, so a missing Auth0 setting does not waste a copy.
  const auth0 = serve ? readAuth0Settings([settingsFile, auth0File], appUrl) : undefined;

  const { report, target } = await runRestoreDrill({
    sourceUrl: adminUrl,
    caCert,
    migrationsDir: path.join(projectDir, "db/migrations"),
    log: (line) => console.log(line),
    keepTarget: serve,
  });
  console.log(formatDrillReport(report, serve));
  if (target && auth0) {
    console.log("Starting the app on the restored copy…");
    await runAppWithAuth0({
      projectDir,
      port,
      databaseUrl: target.appUrl,
      settings: auth0,
      onStop: () => target.stop(),
      ready: (url) => `\nThe restored copy is open at ${url}/account/ with your Auth0 tenant (${auth0.domain}).
Sign in as yourself: your firms and settings should be there as they were at ${report.snapshotAt}. Try one change.
Nothing here reaches the live site. Ctrl+C deletes the copy.\n`,
    });
  }
} catch (error) {
  const message = (error as Error).message;
  const known = error instanceof SetupError || error instanceof DrillError || error instanceof Auth0SettingsError;
  console.error(`\n${known ? "" : "Restore drill failed: "}${message}${error instanceof SetupError || error instanceof Auth0SettingsError ? "" : connectionHint(message)}\n`);
  process.exitCode = 1;
}
