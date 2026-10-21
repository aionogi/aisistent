import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Events, OAuth2Server } from "oauth2-mock-server";
import { startTestDatabase, type TestDatabase } from "../db/harness.ts";

const projectDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

export type MockUser = { sub: string; email: string; name: string; emailVerified: boolean; mfa: boolean };

export const DEFAULT_MOCK_USER: MockUser = { sub: "mock|ana", email: "ana@example.test", name: "Ana Test", emailVerified: true, mfa: true };

export type LocalAuthStack = {
  appUrl: string;
  issuerUrl: string;
  db: TestDatabase;
  /** The identity the mock provider issues on the next sign-in. */
  user: MockUser;
  stop: () => Promise<void>;
};

async function waitForHttp(url: string, server: ChildProcess, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) throw new Error(`next dev exited with code ${server.exitCode}`);
    try {
      const response = await fetch(url, { redirect: "manual" });
      if (response.status < 500) return;
    } catch {
      // Not listening yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error(`${url} did not respond within ${timeoutMs / 1000} s.`);
}

/**
 * A local stand-in for staging, without any external account: a temporary
 * PostgreSQL 17 database, an OpenID Connect mock in place of Auth0, and
 * `next dev` configured for both. Development only — the Auth0 SDK refuses
 * the insecure (http) provider when NODE_ENV is production.
 */
export async function startLocalAuthStack(options: { appPort: number; issuerPort: number; user?: MockUser; quiet?: boolean }): Promise<LocalAuthStack> {
  const db = await startTestDatabase();
  const user: MockUser = { ...(options.user ?? DEFAULT_MOCK_USER) };

  const issuer = new OAuth2Server();
  await issuer.issuer.keys.generate("RS256");
  // `/auth/login?login_hint=marko@example.test` signs in as another mock user,
  // so invitations can be tried with two people.
  const userForCode = new Map<string, MockUser>();
  issuer.service.on(Events.BeforeAuthorizeRedirect, (redirect, req) => {
    const hint = new URL(req.url ?? "/", "http://localhost").searchParams.get("login_hint")?.toLowerCase();
    const code = redirect.url.searchParams.get("code");
    if (!code || !hint || hint === user.email || !/^[a-z0-9._-]+@example\.test$/.test(hint)) return;
    const local = hint.split("@")[0];
    userForCode.set(code, { sub: `mock|${local}`, email: hint, name: `${local.charAt(0).toUpperCase()}${local.slice(1)} Test`, emailVerified: true, mfa: user.mfa });
  });
  issuer.service.on(Events.BeforeTokenSigning, (token, req) => {
    const code = (req.body as Record<string, unknown> | undefined)?.code;
    const signedIn = (typeof code === "string" && userForCode.get(code)) || user;
    Object.assign(token.payload, {
      sub: signedIn.sub,
      email: signedIn.email,
      email_verified: signedIn.emailVerified,
      name: signedIn.name,
      amr: signedIn.mfa ? ["pwd", "mfa"] : ["pwd"],
      sid: `mock-session-${randomBytes(6).toString("hex")}`,
    });
  });
  await issuer.start(options.issuerPort, "localhost");
  const issuerUrl = issuer.issuer.url!;

  const appUrl = `http://127.0.0.1:${options.appPort}`;
  const next = spawn(process.execPath, [path.join(projectDir, "node_modules/next/dist/bin/next"), "dev", "--hostname", "127.0.0.1", "--port", String(options.appPort)], {
    cwd: projectDir,
    env: {
      ...process.env,
      NODE_ENV: "development",
      DATABASE_URL: db.appUrl,
      AUTH0_DOMAIN: issuerUrl,
      AUTH0_CLIENT_ID: "local-client",
      AUTH0_CLIENT_SECRET: "local-client-secret",
      AUTH0_SECRET: randomBytes(32).toString("hex"),
      APP_BASE_URL: appUrl,
      AUTH0_ALLOW_INSECURE_LOCAL: "true",
      AUTH_REQUIRE_MFA: "true",
      RATE_LIMIT_SECRET: randomBytes(32).toString("hex"),
      // No ingress in this local stack: requests deliberately share the fallback bucket.
      RATE_LIMIT_IP_HEADER: "",
      NEXT_TELEMETRY_DISABLED: "1",
    },
    stdio: options.quiet ? "ignore" : "inherit",
  });
  await waitForHttp(`${appUrl}/api/health/`, next, 120_000);

  return {
    appUrl,
    issuerUrl,
    db,
    user,
    stop: async () => {
      const exited = new Promise((resolve) => next.once("exit", resolve));
      // next dev starts worker processes; on Windows only taskkill /T ends the whole tree.
      if (process.platform === "win32" && next.pid) spawnSync("taskkill", ["/pid", String(next.pid), "/t", "/f"], { stdio: "ignore" });
      else next.kill();
      await exited;
      await issuer.stop();
      await db.stop();
    },
  };
}
