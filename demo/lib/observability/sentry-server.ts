import * as Sentry from "@sentry/nextjs";
import { after } from "next/server";
import { setFailureReporter } from "../operations/logging.ts";
import { createBeforeSend, PRIVATE_OPTIONS } from "./reporting.ts";

/** Keeps a serverless function alive until the report is sent; outside a request there is nothing to extend. */
function flushAfterResponse(): void {
  try {
    after(() => Sentry.flush(2000));
  } catch {
    void Sentry.flush(2000);
  }
}

/**
 * Starts error reporting on the server (see instrumentation.ts). No default
 * integrations, so nothing collects requests, console output or source lines,
 * and no tracing. Failures the app handles itself arrive through logEvent.
 */
export function startServerReporting(dsn: string): void {
  Sentry.init({
    ...PRIVATE_OPTIONS,
    dsn,
    environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV,
    release: process.env.VERCEL_GIT_COMMIT_SHA,
    enableOpenTelemetrySetup: false,
    defaultIntegrations: false,
    integrations: [Sentry.linkedErrorsIntegration(), Sentry.onUncaughtExceptionIntegration(), Sentry.onUnhandledRejectionIntegration({ mode: "none" })],
    beforeSend: createBeforeSend(),
  });
  setFailureReporter((event, fields, cause) => {
    const tags = { event, ...(fields.operation ? { operation: fields.operation } : {}) };
    if (cause === undefined) Sentry.captureMessage(event, { level: "error", tags });
    else Sentry.captureException(cause, { tags });
    flushAfterResponse();
  });
}
