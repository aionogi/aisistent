import { randomUUID } from "node:crypto";

const EVENTS = ["request.blocked", "rate_limit.unavailable", "action.completed", "action.failed", "auth.callback_failed", "database.idle_error"] as const;
const OPERATIONS = ["auth.login", "auth.callback", "auth.logout", "auth.other", "action.ip", "organization.create", "workspace.save", "team.change", "invitation.accept", "organization.export", "organization.delete", "account.sessions", "knowledge.import"] as const;
export type Operation = typeof OPERATIONS[number];
type Event = typeof EVENTS[number];
type Fields = { requestId?: string; operation?: Operation; outcome?: "success" | "denied" | "error"; retryAfterSeconds?: number };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type FailureReporter = (event: string, fields: { operation?: Operation }, cause?: unknown) => void;
// On globalThis: Next.js bundles instrumentation.ts apart from the pages that log.
const reporting = globalThis as typeof globalThis & { aisistentFailureReporter?: FailureReporter };

/** Set once at server start (instrumentation.ts) when error reporting is configured. */
export function setFailureReporter(reporter: FailureReporter | undefined): void {
  reporting.aisistentFailureReporter = reporter;
}

/** Tells the reporter about a failure. The cause stays out of the logs and passes the reporter's allowlist; reporting never breaks the caller. */
export function reportFailure(event: string, fields: { operation?: Operation } = {}, cause?: unknown): void {
  try {
    reporting.aisistentFailureReporter?.(event, fields, cause);
  } catch {
    // Nothing to do: the log line is still written.
  }
}

function eventLevel(event: Event): "error" | "warn" | "info" {
  return event.endsWith("failed") || event.endsWith("error") || event.endsWith("unavailable") ? "error" : event === "request.blocked" ? "warn" : "info";
}

/** Only allowlisted fields cross the log boundary; never serialize errors, URLs or request bodies. */
export function serializeEvent(event: Event, fields: Fields = {}): string {
  return JSON.stringify({
    timestamp: new Date().toISOString(),
    level: eventLevel(event),
    event: EVENTS.includes(event) ? event : "action.failed",
    requestId: typeof fields.requestId === "string" && UUID.test(fields.requestId) ? fields.requestId : randomUUID(),
    ...(OPERATIONS.includes(fields.operation!) ? { operation: fields.operation } : {}),
    ...(["success", "denied", "error"].includes(fields.outcome!) ? { outcome: fields.outcome } : {}),
    ...(Number.isInteger(fields.retryAfterSeconds) && fields.retryAfterSeconds! >= 1 && fields.retryAfterSeconds! <= 86400 ? { retryAfterSeconds: fields.retryAfterSeconds } : {}),
  });
}

export function logEvent(event: Event, fields: Fields = {}, cause?: unknown): void {
  console.log(serializeEvent(event, fields));
  if (eventLevel(event) === "error") reportFailure(event, { operation: fields.operation }, cause);
}
