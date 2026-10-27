import { Auth0Client } from "@auth0/nextjs-auth0/server";
import type { SessionData, User } from "@auth0/nextjs-auth0/types";
import { NextResponse } from "next/server";
import { getPool } from "../db/pool.ts";
import { provisionUser } from "../db/repositories.ts";
import { PostgresSessionStore, SESSION_DURATIONS } from "./session-store.ts";
import { logEvent } from "../operations/logging.ts";

const REQUIRED_ENV = ["AUTH0_DOMAIN", "AUTH0_CLIENT_ID", "AUTH0_CLIENT_SECRET", "AUTH0_SECRET", "APP_BASE_URL"] as const;

/** Where the user lands after signing in, and where failures are reported. */
export const ACCOUNT_PATH = "/account/";

const globalForAuth = globalThis as typeof globalThis & { aisistentAuth0?: Auth0Client | null };

/** Claims kept in the server-side session. Everything else from the ID token is dropped. */
function minimalUser(user: User, amr: unknown): User {
  return {
    sub: user.sub,
    name: user.name,
    email: user.email,
    email_verified: user.email_verified,
    ...(Array.isArray(amr) ? { amr: amr.filter((value): value is string => typeof value === "string") } : {}),
  };
}

function decodeJwtPayload(token: string): Record<string, unknown> {
  const [, payload] = token.split(".");
  return payload ? (JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Record<string, unknown>) : {};
}

/** Resolves `returnTo` to a path on this site; anything pointing elsewhere falls back to the account page. */
export function safeReturnPath(value: string | undefined, base: string): string {
  if (!value) return ACCOUNT_PATH;
  try {
    const origin = new URL(base).origin;
    const target = new URL(value, origin);
    if (target.origin !== origin || value.startsWith("//") || value.includes("\\")) return ACCOUNT_PATH;
    return `${target.pathname}${target.search}`;
  } catch {
    return ACCOUNT_PATH;
  }
}

function createClient(): Auth0Client | null {
  if (REQUIRED_ENV.some((key) => !process.env[key])) return null;
  // Sessions and user records live in PostgreSQL, so sign-in requires the database.
  const pool = getPool();
  if (!pool) return null;

  return new Auth0Client({
    domain: process.env.AUTH0_DOMAIN,
    clientId: process.env.AUTH0_CLIENT_ID,
    clientSecret: process.env.AUTH0_CLIENT_SECRET,
    secret: process.env.AUTH0_SECRET,
    appBaseUrl: process.env.APP_BASE_URL,
    // Only for a local mock identity provider over http; the SDK refuses it in production.
    allowInsecureRequests: process.env.NODE_ENV !== "production" && process.env.AUTH0_ALLOW_INSECURE_LOCAL === "true",
    // No offline_access: the app does not call Auth0 APIs, so no refresh token is stored.
    authorizationParameters: { scope: "openid profile email" },
    signInReturnToPath: ACCOUNT_PATH,
    session: {
      rolling: true,
      absoluteDuration: SESSION_DURATIONS.absolute,
      inactivityDuration: SESSION_DURATIONS.inactivity,
      cookie: { sameSite: "lax" },
    },
    sessionStore: new PostgresSessionStore(pool, process.env.AUTH0_SECRET!),
    enableAccessTokenEndpoint: false,
    noContentProfileResponseWhenUnauthenticated: true,

    async beforeSessionSaved(session: SessionData, idToken: string | null): Promise<SessionData> {
      const claims = idToken ? decodeJwtPayload(idToken) : {};
      const user = minimalUser(session.user, idToken ? claims.amr : session.user.amr);
      if (idToken) {
        // A fresh ID token means the SDK has just verified a sign-in: create or refresh the user record.
        await provisionUser(pool, {
          subject: user.sub,
          email: user.email_verified === true && typeof user.email === "string" ? user.email : null,
          displayName: typeof user.name === "string" ? user.name.slice(0, 120) : null,
        });
      }
      return { ...session, user };
    },

    async onCallback(error, context) {
      const base = context.appBaseUrl ?? process.env.APP_BASE_URL!;
      if (error) {
        // Do not reflect provider error text; it can contain user input.
        logEvent("auth.callback_failed", { operation: "auth.callback", outcome: "error" });
        return NextResponse.redirect(new URL(`${ACCOUNT_PATH}?status=login-failed`, base));
      }
      return NextResponse.redirect(new URL(safeReturnPath(context.returnTo, base), base));
    },
  });
}

/** The shared Auth0 client, or null when sign-in is not configured on this server. */
export function getAuth0(): Auth0Client | null {
  if (globalForAuth.aisistentAuth0 === undefined) globalForAuth.aisistentAuth0 = createClient();
  return globalForAuth.aisistentAuth0;
}

/** When true, creating or managing organizations requires a session established with MFA. */
export function mfaRequired(): boolean {
  return process.env.AUTH_REQUIRE_MFA === "true";
}

/** Signs in again with MFA (Auth0 step-up), then returns to `returnTo` on this site. */
export function mfaStepUpPath(returnTo: string = ACCOUNT_PATH): string {
  return `/auth/login?acr_values=${encodeURIComponent("http://schemas.openid.net/pape/policies/2007/06/multi-factor")}&max_age=0&returnTo=${encodeURIComponent(returnTo)}`;
}

export const MFA_STEP_UP_PATH = mfaStepUpPath();
