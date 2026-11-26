import { randomUUID } from "node:crypto";
import { assistantConfig } from "../../../../lib/assistant/config.ts";
import { getPool } from "../../../../lib/db/pool.ts";
import { clientIdentity } from "../../../../lib/operations/rate-limits.ts";
import { answerVisitor, visitorHistory, type SiteChatFailure } from "../../../../lib/site-chat/conversation.ts";

// The website chat's only endpoint, called by the chat page that firms embed
// (app/chat/[publicId]). It accepts JSON from that page on this origin only,
// so other websites cannot make their visitors' browsers send messages; scripts
// outside a browser meet the limits in lib/site-chat/conversation.ts.
//   {"type":"message","token":null|"…","message":"…"}  → reply
//   {"type":"history","token":"…"}                       → the conversation so far
export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 4096;
const STATUS: Record<SiteChatFailure, number> = {
  unavailable: 404, invalid: 400, limited: 429, firm_limit: 429, restart: 409, changed: 409, provider: 503, error: 500,
};

/** This site's own origin: the address the request came to, or the configured public address. */
function sameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  if (origin === new URL(request.url).origin) return true;
  try {
    return process.env.APP_BASE_URL !== undefined && origin === new URL(process.env.APP_BASE_URL).origin;
  } catch {
    return false;
  }
}

export async function POST(request: Request, context: RouteContext<"/api/chat/[publicId]">) {
  const requestId = randomUUID();
  const headers = { "Cache-Control": "no-store", "x-request-id": requestId };
  const reply = (body: unknown, status = 200, retryAfter?: number) =>
    Response.json(body, { status, headers: retryAfter ? { ...headers, "Retry-After": String(retryAfter) } : headers });
  const refuse = (status: number) => reply({ status: "error", code: "invalid", message: "Zahtev nije prihvaćen." }, status);

  const site = request.headers.get("sec-fetch-site");
  if (!sameOrigin(request) || (site !== null && site !== "same-origin")) return refuse(403);
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) return refuse(415);
  if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) return refuse(413);
  const text = await request.text();
  if (Buffer.byteLength(text) > MAX_BODY_BYTES) return refuse(413);
  let body: { type?: unknown; token?: unknown; message?: unknown };
  try {
    const parsed: unknown = JSON.parse(text);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return refuse(400);
    body = parsed;
  } catch {
    return refuse(400);
  }

  const pool = getPool();
  if (!pool) return reply({ status: "error", code: "unavailable", message: "Chat trenutno nije dostupan." }, 404);
  const { publicId } = await context.params;
  const identity = clientIdentity(request.headers);

  const result = body.type === "message"
    ? await answerVisitor({ pool, config: assistantConfig(), identity, requestId }, { publicId, token: body.token, message: body.message })
    : body.type === "history"
      ? await visitorHistory({ pool, identity, requestId }, { publicId, token: body.token })
      : null;
  if (!result) return refuse(400);
  return result.status === "ok" ? reply(result) : reply(result, STATUS[result.code], result.retryAfterSeconds);
}
