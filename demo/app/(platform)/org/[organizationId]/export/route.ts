import { getCurrentAccount } from "../../../../../lib/auth/account.ts";
import { mfaRequired } from "../../../../../lib/auth/auth0.ts";
import { ForbiddenError, withOrganization } from "../../../../../lib/db/context.ts";
import { getPool } from "../../../../../lib/db/pool.ts";
import { exportOrganization, TeamError } from "../../../../../lib/db/team.ts";
import { actionLimit, actionLog } from "../../../../../lib/operations/action-guard.ts";

function message(status: number, text: string): Response {
  return new Response(text, { status, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
}

/**
 * Downloads everything the organization holds as one JSON file, for owners
 * (with MFA when required). A GET, so a plain link works; requests started by
 * another site are refused so they cannot spend the owner's export budget.
 */
export async function GET(request: Request, context: RouteContext<"/org/[organizationId]/export">) {
  const site = request.headers.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "none") return message(403, "Preuzmite podatke sa stranice Firma.");

  const { organizationId } = await context.params;
  const account = await getCurrentAccount();
  const pool = getPool();
  if (!account || !pool) return message(401, "Prijavite se da biste preuzeli podatke firme.");
  const limitError = await actionLimit(pool, "organization.export", account.userId);
  if (limitError) return message(429, limitError);
  if (mfaRequired() && !account.mfa) {
    await actionLog("organization.export", "denied");
    return message(403, "Za izvoz podataka potrebna je prijava sa dvofaktorskom potvrdom.");
  }

  let document: Record<string, unknown>;
  try {
    document = await withOrganization(pool, { userId: account.userId, organizationId }, (client) => exportOrganization(client));
  } catch (error) {
    if (error instanceof ForbiddenError || error instanceof TeamError) {
      await actionLog("organization.export", "denied");
      return error instanceof ForbiddenError ? message(404, "Firma nije pronađena.") : message(403, "Podatke firme preuzima vlasnik.");
    }
    await actionLog("organization.export", "error", error);
    return message(500, "Izvoz trenutno nije moguć. Pokušajte ponovo kasnije.");
  }
  await actionLog("organization.export", "success");
  return new Response(JSON.stringify(document, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="aisistent-podaci-firme-${new Date().toISOString().slice(0, 10)}.json"`,
      "Cache-Control": "no-store",
    },
  });
}
