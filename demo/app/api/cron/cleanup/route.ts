import { createHash, timingSafeEqual } from "node:crypto";
import { getPool } from "../../../../lib/db/pool.ts";
import { runCleanup } from "../../../../lib/operations/cleanup.ts";
import { reportFailure } from "../../../../lib/operations/logging.ts";

// Daily cleanup for Vercel Cron (vercel.json). Vercel sends
// `Authorization: Bearer <CRON_SECRET>` when the CRON_SECRET variable is set;
// without a configured secret the route refuses to run. The response and log
// carry only counts.
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };
const digest = (value: string) => createHash("sha256").update(value).digest();

function authorized(request: Request, secret: string): boolean {
  return timingSafeEqual(digest(request.headers.get("authorization") ?? ""), digest(`Bearer ${secret}`));
}

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || secret.length < 32) return Response.json({ error: "not_configured" }, { status: 503, headers: NO_STORE });
  if (!authorized(request, secret)) return Response.json({ error: "unauthorized" }, { status: 401, headers: NO_STORE });
  const pool = getPool();
  if (!pool) return Response.json({ error: "not_configured" }, { status: 503, headers: NO_STORE });
  try {
    const { passes, reachedPassLimit, ...counts } = await runCleanup(pool);
    console.log(JSON.stringify({ event: "operations.cleanup", result: "success", passes, reachedPassLimit, ...counts }));
    return Response.json({ result: "success", passes, reachedPassLimit, ...counts }, { headers: NO_STORE });
  } catch (error) {
    console.error(JSON.stringify({ event: "operations.cleanup", result: "error" }));
    reportFailure("operations.cleanup", {}, error);
    return Response.json({ result: "error" }, { status: 500, headers: NO_STORE });
  }
}
