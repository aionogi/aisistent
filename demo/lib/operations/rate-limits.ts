import { createHmac } from "node:crypto";
import { isIP } from "node:net";
import type { Pool } from "pg";
import { consumeRateLimit } from "./store.ts";
import { logEvent, type Operation } from "./logging.ts";

// Initial staging budgets. User budgets span organizations and sessions.
export const RATE_POLICIES = {
  "auth.login": { limit: 30, seconds: 60 },
  "auth.callback": { limit: 60, seconds: 60 },
  "auth.logout": { limit: 120, seconds: 60 },
  "auth.other": { limit: 60, seconds: 60 },
  "action.ip": { limit: 180, seconds: 60 },
  "organization.create": { limit: 5, seconds: 3600 },
  "workspace.save": { limit: 90, seconds: 60 },
  "team.change": { limit: 30, seconds: 60 },
  "invitation.accept": { limit: 20, seconds: 60 },
  "organization.export": { limit: 10, seconds: 3600 },
  "organization.delete": { limit: 10, seconds: 3600 },
} as const satisfies Record<Operation, { limit: number; seconds: number }>;

/** Select budgets using a fixed route class, never attacker-controlled paths or query strings. */
export function requestOperation(pathname: string, method: string): Operation | null {
  const path = pathname.replace(/\/+$/, "");
  if (path === "/auth/login") return "auth.login";
  if (path === "/auth/callback") return "auth.callback";
  if (path === "/auth/logout" || path === "/auth/backchannel-logout") return "auth.logout";
  if (path === "/auth" || path.startsWith("/auth/")) return "auth.other";
  return method === "POST" ? "action.ip" : null;
}

/**
 * Trust exactly one IP header only after an ingress is configured to OVERWRITE
 * it and direct origin access is blocked. Never guess trust from X-Forwarded-For.
 * Until then all clients share the conservative unknown-client budget.
 */
export function clientIdentity(headers: Pick<Headers, "get">, headerName = process.env.RATE_LIMIT_IP_HEADER): string {
  if (!headerName || !/^[a-z0-9-]{1,80}$/i.test(headerName)) return "unknown-client";
  const value = headers.get(headerName)?.trim();
  if (!value || value.length > 45 || value.includes("%") || !isIP(value)) return "unknown-client";
  // URL normalization collapses equivalent IPv6 spellings.
  return isIP(value) === 6 ? new URL(`http://[${value}]/`).hostname.slice(1, -1) : value;
}

export function rateLimitKey(operation: Operation, identity: string, secret = process.env.RATE_LIMIT_SECRET): Buffer {
  if (!secret || secret.length < 32) throw new Error("Rate limiting is not configured.");
  return createHmac("sha256", secret).update(JSON.stringify([operation, identity])).digest();
}

export type LimitResult = { allowed: true } | { allowed: false; status: 429 | 503; retryAfterSeconds: number };

/** Database/configuration failure blocks protected work; there is no in-memory fallback. */
export async function checkRateLimit(pool: Pool, operation: Operation, identity: string, requestId?: string): Promise<LimitResult> {
  try {
    const policy = RATE_POLICIES[operation];
    const result = await consumeRateLimit(pool, rateLimitKey(operation, identity), policy.limit, policy.seconds);
    if (result.allowed) return { allowed: true };
    logEvent("request.blocked", { operation, requestId, outcome: "denied", retryAfterSeconds: result.retryAfterSeconds });
    return { allowed: false, status: 429, retryAfterSeconds: result.retryAfterSeconds };
  } catch {
    logEvent("rate_limit.unavailable", { operation, requestId, outcome: "error" });
    return { allowed: false, status: 503, retryAfterSeconds: 30 };
  }
}

export function limitMessage(result: Exclude<LimitResult, { allowed: true }>): string {
  return result.status === 429
    ? `Previše zahteva. Sačekajte ${result.retryAfterSeconds} sekundi pa pokušajte ponovo.`
    : "Usluga trenutno nije dostupna. Pokušajte ponovo za 30 sekundi.";
}
