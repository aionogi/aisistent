import { NextResponse, type NextRequest } from "next/server";
import { getAuth0 } from "./lib/auth/auth0.ts";

/**
 * Runs before every page and auth route:
 * 1. Auth0's middleware serves /auth/* (login, callback, logout, back-channel
 *    logout) and rolls the server-side session on other requests.
 * 2. A per-request Content-Security-Policy with a script nonce. Next.js reads
 *    the nonce from the request header and applies it to its own scripts,
 *    which is why every page renders dynamically (see app/layout.tsx).
 *
 * Styles allow 'unsafe-inline' because server-rendered style attributes
 * (for example the landing-page waveform heights) cannot carry a nonce.
 */
export async function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const isDevelopment = process.env.NODE_ENV === "development";
  const policy = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDevelopment ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' blob: data:",
    "font-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(isDevelopment ? [] : ["upgrade-insecure-requests"]),
  ].join("; ");

  const auth0 = getAuth0();
  const authResponse = auth0 ? await auth0.middleware(request) : null;
  // Auth routes answer directly (redirects, logout, 204s); pass them through unchanged.
  if (authResponse && authResponse.headers.get("x-middleware-next") !== "1") return authResponse;

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", policy);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", policy);
  // Keep the session cookie Auth0 refreshed while rolling the session.
  for (const cookie of authResponse?.headers.getSetCookie() ?? []) response.headers.append("set-cookie", cookie);
  return response;
}

export const config = {
  matcher: [
    {
      source: "/((?!api/|_next/static|_next/image|icon.svg).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
