import { NextResponse, type NextRequest } from "next/server";
import { getAuth0 } from "./lib/auth/auth0.ts";
import { getPool } from "./lib/db/pool.ts";
import { checkRateLimit, clientIdentity, limitMessage, requestOperation } from "./lib/operations/rate-limits.ts";
import { contentSecurityPolicy } from "./lib/security/content-security-policy.ts";

/**
 * Runs before every page and auth route:
 * 1. Auth0's middleware serves /auth/* (login, callback, logout, back-channel
 *    logout) and rolls the server-side session on other requests.
 * 2. A per-request Content-Security-Policy with a nonce (see
 *    lib/security/content-security-policy.ts). Next.js reads the nonce from
 *    the request header and applies it to its own scripts, which is why every
 *    page renders dynamically (see app/layout.tsx).
 */
export async function proxy(request: NextRequest) {
  const requestId = crypto.randomUUID();
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const policy = contentSecurityPolicy(nonce, process.env.NODE_ENV === "development");

  // Every POST is covered, including native form submissions without Next-Action.
  // Budgets run before the identity SDK and do not trust prefetch headers.
  const operation = requestOperation(request.nextUrl.pathname, request.method);
  const pool = getPool();
  if (operation && pool) {
    const result = await checkRateLimit(pool, operation, clientIdentity(request.headers), requestId);
    if (!result.allowed) {
      return new NextResponse(limitMessage(result), {
        status: result.status,
        headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", "Retry-After": String(result.retryAfterSeconds), "x-request-id": requestId, "Content-Security-Policy": policy },
      });
    }
  }

  const auth0 = getAuth0();
  const authResponse = auth0 ? await auth0.middleware(request) : null;
  // Auth routes answer directly (redirects, logout, 204s); pass them through unchanged.
  if (authResponse && authResponse.headers.get("x-middleware-next") !== "1") {
    authResponse.headers.set("x-request-id", requestId);
    authResponse.headers.set("Cache-Control", "no-store");
    return authResponse;
  }

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("x-request-id", requestId);
  requestHeaders.set("Content-Security-Policy", policy);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", policy);
  response.headers.set("x-request-id", requestId);
  // Keep the session cookie Auth0 refreshed while rolling the session.
  for (const cookie of authResponse?.headers.getSetCookie() ?? []) response.headers.append("set-cookie", cookie);
  return response;
}

export const config = {
  matcher: ["/((?!api/|_next/static|_next/image|icon.svg).*)"],
};
