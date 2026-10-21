// Liveness check for Render's healthCheckPath. It reports only that the
// server is up; database readiness is not exposed publicly.
export const dynamic = "force-dynamic";

export function GET() {
  return Response.json({ status: "ok" }, { headers: { "Cache-Control": "no-store" } });
}
