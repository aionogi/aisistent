/**
 * Reports an error that reached an error page. A digest means the server
 * failed and has already reported it, under the real error rather than the
 * generic text the browser receives.
 */
export function reportRenderError(error: unknown): void {
  if (!process.env.NEXT_PUBLIC_SENTRY_DSN) return;
  if (typeof error === "object" && error !== null && "digest" in error) return;
  void import("./sentry-client.ts").then(({ captureClientError }) => captureClientError(error)).catch(() => undefined);
}
