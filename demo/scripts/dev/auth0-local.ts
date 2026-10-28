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
import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";
import { startTestDatabase } from "../../tests/db/harness.ts";

const projectDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const envFile = path.join(projectDir, ".env.auth0.local");
const port = Number(process.env.PORT ?? 4320);
const appUrl = `http://127.0.0.1:${port}`;

function fail(message: string): never {
  console.error(`\n${message}\n`);
  process.exit(1);
}

if (!Number.isInteger(port) || port < 1024 || port > 65535) fail("PORT must be a number between 1024 and 65535.");
if (!existsSync(envFile)) {
  fail(`Missing ${envFile}.
Create it with these lines (values from your Auth0 application's Settings page):
  AUTH0_DOMAIN=<your-tenant>.eu.auth0.com
  AUTH0_CLIENT_ID=<Client ID>
  AUTH0_CLIENT_SECRET=<Client Secret>
In Auth0, set Allowed Callback URLs to ${appUrl}/auth/callback and Allowed Logout URLs to ${appUrl}/`);
}

const settings = parseEnv(readFileSync(envFile, "utf8"));
const value = (key: string) => settings[key]?.trim() ?? "";
const missing = ["AUTH0_DOMAIN", "AUTH0_CLIENT_ID", "AUTH0_CLIENT_SECRET"].filter((key) => !value(key));
if (missing.length) fail(`${path.basename(envFile)} is missing: ${missing.join(", ")}.`);

// The SDK expects the tenant host; accept a pasted https:// address too, but never plain http.
const domain = value("AUTH0_DOMAIN").replace(/^https:\/\//i, "").replace(/\/+$/, "");
if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(domain)) fail("AUTH0_DOMAIN must be the tenant host, for example aisistent-dev.eu.auth0.com (no http://).");
if (value("AUTH0_SECRET") && value("AUTH0_SECRET").length < 32) fail("AUTH0_SECRET must be at least 32 characters, or leave it out to generate one per run.");
if (value("AUTH_REQUIRE_MFA") && !["true", "false"].includes(value("AUTH_REQUIRE_MFA"))) fail("AUTH_REQUIRE_MFA must be true or false.");

console.log("Starting a temporary PostgreSQL database and applying migrations…");
const db = await startTestDatabase();

const next = spawn(process.execPath, [path.join(projectDir, "node_modules/next/dist/bin/next"), "dev", "--hostname", "127.0.0.1", "--port", String(port)], {
  cwd: projectDir,
  env: {
    ...process.env,
    NODE_ENV: "development",
    DATABASE_URL: db.appUrl,
    AUTH0_DOMAIN: domain,
    AUTH0_CLIENT_ID: value("AUTH0_CLIENT_ID"),
    AUTH0_CLIENT_SECRET: value("AUTH0_CLIENT_SECRET"),
    // A new secret per run is fine: the database, and with it every session, is temporary too.
    AUTH0_SECRET: value("AUTH0_SECRET") || randomBytes(32).toString("hex"),
    APP_BASE_URL: appUrl,
    // The real tenant is https only; the insecure switch is for the mock provider.
    AUTH0_ALLOW_INSECURE_LOCAL: "false",
    AUTH_REQUIRE_MFA: value("AUTH_REQUIRE_MFA") || "false",
    RATE_LIMIT_SECRET: randomBytes(32).toString("hex"),
    // No ingress locally: requests deliberately share the fallback bucket.
    RATE_LIMIT_IP_HEADER: "",
    NEXT_TELEMETRY_DISABLED: "1",
  },
  stdio: "inherit",
});

let stopping = false;
async function shutdown(code = 0) {
  if (stopping) return;
  stopping = true;
  // next dev starts worker processes; on Windows only taskkill /T ends the whole tree.
  if (next.exitCode === null) {
    const exited = new Promise((resolve) => next.once("exit", resolve));
    if (process.platform === "win32" && next.pid) spawnSync("taskkill", ["/pid", String(next.pid), "/t", "/f"], { stdio: "ignore" });
    else next.kill();
    await exited;
  }
  await db.stop();
  process.exit(code);
}
process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
next.once("exit", (code) => {
  if (!stopping) {
    console.error(`next dev exited with code ${code}.`);
    void shutdown(1);
  }
});

const deadline = Date.now() + 120_000;
while (!stopping && Date.now() < deadline) {
  try {
    if ((await fetch(`${appUrl}/api/health/`)).ok) break;
  } catch {
    // Not listening yet.
  }
  await new Promise((resolve) => setTimeout(resolve, 500));
}
if (!stopping) {
  console.log(`\nReady with your Auth0 tenant (${domain}): ${appUrl}/account/
Sign up or sign in there. The database is temporary: accounts, organizations and sessions disappear when you stop this command (Ctrl+C).\n`);
}
