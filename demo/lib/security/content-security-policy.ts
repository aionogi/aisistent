/**
 * The per-request Content-Security-Policy. Next.js reads the nonce from the
 * request header and applies it to its own scripts (see proxy.ts).
 *
 * Production allows no inline styles: style attributes are blocked and only
 * <style> elements carrying the nonce apply, so components set dynamic sizes
 * through the CSSOM (see components/ProgressFill.tsx) and fixed ones in CSS.
 * Development keeps 'unsafe-inline' for styles and 'unsafe-eval' for scripts,
 * which the Next.js dev overlay and hot reloading need.
 */
export function contentSecurityPolicy(nonce: string, development: boolean): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${development ? " 'unsafe-eval'" : ""}`,
    development ? "style-src 'self' 'unsafe-inline'" : `style-src 'self' 'nonce-${nonce}'`,
    "img-src 'self' blob: data:",
    "font-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(development ? [] : ["upgrade-insecure-requests"]),
  ].join("; ");
}
