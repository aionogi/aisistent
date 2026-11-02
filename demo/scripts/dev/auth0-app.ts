// Runs `next dev` against a given database with the real Auth0 tenant. Shared
// by `npm run dev:auth0` and `npm run drill:restore -- --serve`. Values from
// the settings files are never printed.
import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { parseEnv } from "node:util";

/** A setting the person running the command can fix; the message holds no values. */
export class Auth0SettingsError extends Error {}

export type Auth0Settings = { domain: string; clientId: string; clientSecret: string; secret: string; requireMfa: string };

/** Reads AUTH0_* from the first files that have them (later files win). */
export function readAuth0Settings(files: string[], appUrl: string): Auth0Settings {
  const settings: Record<string, string | undefined> = Object.assign({}, ...files.filter((file) => existsSync(file)).map((file) => parseEnv(readFileSync(file, "utf8"))));
  const value = (key: string) => settings[key]?.trim() ?? "";
  const missing = ["AUTH0_DOMAIN", "AUTH0_CLIENT_ID", "AUTH0_CLIENT_SECRET"].filter((key) => !value(key) || value(key).includes("<"));
  if (missing.length) {
    throw new Auth0SettingsError(`Missing ${missing.join(", ")} in ${files.map((file) => path.basename(file)).join(" or ")}.
Add these lines (values from your Auth0 application's Settings page):
  AUTH0_DOMAIN=<your-tenant>.eu.auth0.com
  AUTH0_CLIENT_ID=<Client ID>
  AUTH0_CLIENT_SECRET=<Client Secret>
In Auth0, set Allowed Callback URLs to ${appUrl}/auth/callback and Allowed Logout URLs to ${appUrl}/`);
  }
  // The SDK expects the tenant host; accept a pasted https:// address too, but never plain http.
  const domain = value("AUTH0_DOMAIN").replace(/^https:\/\//i, "").replace(/\/+$/, "");
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(domain)) throw new Auth0SettingsError("AUTH0_DOMAIN must be the tenant host, for example aisistent-dev.eu.auth0.com (no http://).");
  if (value("AUTH0_SECRET") && value("AUTH0_SECRET").length < 32) throw new Auth0SettingsError("AUTH0_SECRET must be at least 32 characters, or leave it out to generate one per run.");
  if (value("AUTH_REQUIRE_MFA") && !["true", "false"].includes(value("AUTH_REQUIRE_MFA"))) throw new Auth0SettingsError("AUTH_REQUIRE_MFA must be true or false.");
  return {
    domain,
    clientId: value("AUTH0_CLIENT_ID"),
    clientSecret: value("AUTH0_CLIENT_SECRET"),
    // A new secret per run is fine: the database, and with it every session, is temporary too.
    secret: value("AUTH0_SECRET") || randomBytes(32).toString("hex"),
    requireMfa: value("AUTH_REQUIRE_MFA") || "false",
  };
}

type RunOptions = {
  projectDir: string;
  port: number;
  databaseUrl: string;
  settings: Auth0Settings;
  /** Runs after next dev has stopped, for example to remove the database. */
  onStop: () => Promise<void>;
  ready: (appUrl: string) => string;
};

/**
 * Starts next dev on 127.0.0.1 and stops it, then onStop, on Ctrl+C. Email
 * and error reporting stay off even when a local .env file sets them: these
 * databases are temporary copies, not the live site.
 */
export async function runAppWithAuth0({ projectDir, port, databaseUrl, settings, onStop, ready }: RunOptions): Promise<void> {
  const appUrl = `http://127.0.0.1:${port}`;
  const next = spawn(process.execPath, [path.join(projectDir, "node_modules/next/dist/bin/next"), "dev", "--hostname", "127.0.0.1", "--port", String(port)], {
    cwd: projectDir,
    env: {
      ...process.env,
      NODE_ENV: "development",
      DATABASE_URL: databaseUrl,
      AUTH0_DOMAIN: settings.domain,
      AUTH0_CLIENT_ID: settings.clientId,
      AUTH0_CLIENT_SECRET: settings.clientSecret,
      AUTH0_SECRET: settings.secret,
      APP_BASE_URL: appUrl,
      // The real tenant is https only; the insecure switch is for the mock provider.
      AUTH0_ALLOW_INSECURE_LOCAL: "false",
      AUTH_REQUIRE_MFA: settings.requireMfa,
      RATE_LIMIT_SECRET: randomBytes(32).toString("hex"),
      // No ingress locally: requests deliberately share the fallback bucket.
      RATE_LIMIT_IP_HEADER: "",
      // Set but empty, so Next.js does not take them from a .env file.
      NEXT_PUBLIC_SENTRY_DSN: "",
      LETTERMINT_API_TOKEN: "",
      EMAIL_FROM: "",
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
    await onStop();
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
  if (!stopping) console.log(ready(appUrl));
}
