import type { Instrumentation } from "next";
import { reportingDsn } from "./lib/observability/reporting.ts";

// Error reporting stays off, and its packages unloaded, until a DSN is set.
const dsn = reportingDsn(process.env.NEXT_PUBLIC_SENTRY_DSN);

export async function register(): Promise<void> {
  if (!dsn || process.env.NEXT_RUNTIME !== "nodejs") return;
  const { startServerReporting } = await import("./lib/observability/sentry-server.ts");
  startServerReporting(dsn);
}

/** Next.js calls this for errors nothing caught while rendering or handling a request. */
export const onRequestError: Instrumentation.onRequestError = async (...args) => {
  if (!dsn || process.env.NEXT_RUNTIME !== "nodejs") return;
  const { captureRequestError } = await import("@sentry/nextjs");
  captureRequestError(...args);
};
