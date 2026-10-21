import { headers } from "next/headers";
import type { Pool } from "pg";
import { checkRateLimit, limitMessage } from "./rate-limits.ts";
import { logEvent, type Operation } from "./logging.ts";

export type ActionOperation = "organization.create" | "workspace.save" | "team.change" | "invitation.accept";

/** Call with the server-resolved account ID, before every protected mutation. */
export async function actionLimit(pool: Pool, operation: ActionOperation, userId: string): Promise<string | null> {
  const requestId = (await headers()).get("x-request-id") ?? undefined;
  const result = await checkRateLimit(pool, operation, userId, requestId);
  return result.allowed ? null : limitMessage(result);
}

export async function actionLog(operation: Operation, outcome: "success" | "denied" | "error"): Promise<void> {
  const requestId = (await headers()).get("x-request-id") ?? undefined;
  logEvent(outcome === "error" ? "action.failed" : "action.completed", { operation, outcome, requestId });
}
