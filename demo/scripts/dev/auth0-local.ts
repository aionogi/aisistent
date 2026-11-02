// Runs the app locally against a real Auth0 tenant, with a temporary
// PostgreSQL database that is discarded on exit. The tenant settings come from
// demo/.env.auth0.local, which git ignores and Next.js does not load on its own:
//
//   AUTH0_DOMAIN=aisistent-dev.eu.auth0.com
//   AUTH0_CLIENT_ID=...
//   AUTH0_CLIENT_SECRET=...
//   # optional: AUTH0_SECRET (32+ characters, otherwise generated per run), AUTH_REQUIRE_MFA=true
//
// The Auth0 application (Regular Web Application) needs these URLs:
//   Allowed Callback URLs  http://127.0.0.1:4320/auth/callback
//   Allowed Logout URLs    http://127.0.0.1:4320/
//
//   npm run dev:auth0            → http://127.0.0.1:4320/account/
//   PORT=4321 npm run dev:auth0  (then use port 4321 in Auth0 as well)
//
// Stop this project's other dev server first: two `next dev` processes in one
// directory conflict. Values from the file are never printed.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startTestDatabase } from "../../tests/db/harness.ts";
import { Auth0SettingsError, readAuth0Settings, runAppWithAuth0 } from "./auth0-app.ts";

const projectDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const port = Number(process.env.PORT ?? 4320);

function fail(message: string): never {
  console.error(`\n${message}\n`);
  process.exit(1);
}

if (!Number.isInteger(port) || port < 1024 || port > 65535) fail("PORT must be a number between 1024 and 65535.");
let settings;
try {
  settings = readAuth0Settings([path.join(projectDir, ".env.auth0.local")], `http://127.0.0.1:${port}`);
} catch (error) {
  if (error instanceof Auth0SettingsError) fail(error.message);
  throw error;
}

console.log("Starting a temporary PostgreSQL database and applying migrations…");
const db = await startTestDatabase();
await runAppWithAuth0({
  projectDir,
  port,
  databaseUrl: db.appUrl,
  settings,
  onStop: () => db.stop(),
  ready: (appUrl) => `\nReady with your Auth0 tenant (${settings.domain}): ${appUrl}/account/
Sign up or sign in there. The database is temporary: accounts, organizations and sessions disappear when you stop this command (Ctrl+C).\n`,
});
