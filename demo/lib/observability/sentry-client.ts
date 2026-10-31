import { BrowserClient, captureException, dedupeIntegration, defaultStackParser, getCurrentScope, globalHandlersIntegration, linkedErrorsIntegration, makeFetchTransport } from "@sentry/browser";
import { createBeforeSend, fromOwnScripts, PRIVATE_OPTIONS, reportingDsn } from "./reporting.ts";

/**
 * Error reporting in the browser, loaded as a separate chunk only when a DSN
 * is configured. Built from the SDK's parts so the default integrations
 * (clicks, console, network, sessions) are neither sent nor downloaded.
 */
const dsn = reportingDsn(process.env.NEXT_PUBLIC_SENTRY_DSN);
if (dsn) {
  const beforeSend = createBeforeSend();
  const client = new BrowserClient({
    ...PRIVATE_OPTIONS,
    dsn,
    environment: process.env.NEXT_PUBLIC_VERCEL_ENV ?? process.env.NODE_ENV,
    release: process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA,
    transport: makeFetchTransport,
    stackParser: defaultStackParser,
    integrations: [globalHandlersIntegration(), linkedErrorsIntegration(), dedupeIntegration()],
    beforeSend: (event) => (fromOwnScripts(event) ? beforeSend(event) : null),
  });
  getCurrentScope().setClient(client);
  client.init();
}

export function captureClientError(error: unknown): void {
  captureException(error);
}
