import { randomUUID } from "node:crypto";

const EVENTS = ["request.blocked", "rate_limit.unavailable", "action.completed", "action.failed", "auth.callback_failed", "database.idle_error"] as const;
const OPERATIONS = ["auth.login", "auth.callback", "auth.logout", "auth.other", "action.ip", "organization.create", "workspace.save", "team.change", "invitation.accept", "organization.export", "organization.delete", "account.sessions", "knowledge.import"] as const;
export type Operation = typeof OPERATIONS[number];
type Event = typeof EVENTS[number];
type Fields = { requestId?: string; operation?: Operation; outcome?: "success" | "denied" | "error"; retryAfterSeconds?: number };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Only allowlisted fields cross the log boundary; never serialize errors, URLs or request bodies. */
export function serializeEvent(event: Event, fields: Fields = {}): string {
  return JSON.stringify({
    timestamp: new Date().toISOString(),
    level: event.endsWith("failed") || event.endsWith("error") || event.endsWith("unavailable") ? "error" : event === "request.blocked" ? "warn" : "info",
    event: EVENTS.includes(event) ? event : "action.failed",
    requestId: typeof fields.requestId === "string" && UUID.test(fields.requestId) ? fields.requestId : randomUUID(),
    ...(OPERATIONS.includes(fields.operation!) ? { operation: fields.operation } : {}),
    ...(["success", "denied", "error"].includes(fields.outcome!) ? { outcome: fields.outcome } : {}),
    ...(Number.isInteger(fields.retryAfterSeconds) && fields.retryAfterSeconds! >= 1 && fields.retryAfterSeconds! <= 86400 ? { retryAfterSeconds: fields.retryAfterSeconds } : {}),
  });
}

export function logEvent(event: Event, fields: Fields = {}): void {
  console.log(serializeEvent(event, fields));
}
