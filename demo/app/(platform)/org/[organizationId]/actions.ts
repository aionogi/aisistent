"use server";

import { getCurrentAccount } from "../../../../lib/auth/account.ts";
import { canManage, ForbiddenError, withOrganization } from "../../../../lib/db/context.ts";
import { getPool } from "../../../../lib/db/pool.ts";
import { ConflictError, saveWorkspace } from "../../../../lib/db/repositories.ts";
import { checkDraftLimits, toStoredConfig, type SaveWorkspaceResult } from "../../../../lib/workspace/persistence.ts";
import { parseDraft } from "../../../../lib/workspace/storage.ts";
import { mfaRequired } from "../../../../lib/auth/auth0.ts";
import { actionLimit, actionLog } from "../../../../lib/operations/action-guard.ts";
import { MAX_URL_LENGTH } from "../../../../lib/import/destination.ts";
import { fetchPublicPage, type FetchError } from "../../../../lib/import/fetch-page.ts";
import { knowledgeFromPage } from "../../../../lib/import/web-knowledge.ts";
import type { UrlImportResult } from "../../../../lib/workspace/knowledge-import.ts";

/**
 * Saves the organization's workspace from the editor. Everything the browser
 * sends is untrusted: the signed-in user, membership, and role come from the
 * server; the draft is re-parsed and size-checked; the organization id is
 * only a lookup key that withOrganization() verifies against membership.
 */
export async function saveWorkspaceAction(organizationId: string, draft: unknown, expectedRevision: unknown): Promise<SaveWorkspaceResult> {
  const account = await getCurrentAccount();
  const pool = getPool();
  if (!account || !pool) return { status: "signed-out" };
  const rateError = await actionLimit(pool, "workspace.save", account.userId);
  if (rateError) return { status: "invalid", message: rateError };
  if (mfaRequired() && !account.mfa) {
    await actionLog("workspace.save", "denied");
    return { status: "forbidden" };
  }
  if (typeof expectedRevision !== "number" || !Number.isInteger(expectedRevision) || expectedRevision < 0) return { status: "invalid", message: "Neispravan zahtev za čuvanje." };

  const parsed = parseDraft(draft);
  if (!parsed) return { status: "invalid", message: "Podaci nisu u očekivanom obliku. Osvežite stranicu." };
  const limitError = checkDraftLimits(parsed);
  if (limitError) return { status: "invalid", message: limitError };

  try {
    const result = await withOrganization(pool, { userId: account.userId, organizationId }, async (client, role) => {
      if (!canManage(role)) return { status: "forbidden" } as const;
      const { revision, idMap } = await saveWorkspace(client, {
        config: toStoredConfig(parsed) as unknown as Record<string, unknown>,
        knowledge: parsed.knowledge,
        expectedRevision,
      });
      return { status: "saved", revision, savedAt: new Date().toISOString(), idMap } as const;
    });
    await actionLog("workspace.save", result.status === "saved" ? "success" : "denied");
    return result;
  } catch (error) {
    if (error instanceof ConflictError) return { status: "conflict" };
    if (error instanceof ForbiddenError) return { status: "forbidden" };
    await actionLog("workspace.save", "error", error);
    return { status: "error" };
  }
}

const IMPORT_MESSAGES: Record<FetchError, string> = {
  invalid_url: "Unesite punu adresu stranice, na primer https://vasafirma.rs/cesta-pitanja.",
  unsupported_scheme: "Podržane su samo adrese koje počinju sa http:// ili https://.",
  credentials: "Adresa ne sme da sadrži korisničko ime ili lozinku.",
  port: "Podržane su samo adrese bez posebnog porta (na primer bez :8080).",
  blocked_destination: "Ova adresa vodi na privatnu ili internu mrežu, pa je ne preuzimamo. Unesite javnu stranicu vašeg sajta.",
  host_not_found: "Sajt nije pronađen. Proverite adresu.",
  unreachable: "Sajt nije odgovorio. Pokušajte ponovo kasnije.",
  tls: "Sigurna veza sa sajtom nije uspela (problem sa sertifikatom sajta).",
  timeout: "Sajt nije odgovorio za 10 sekundi. Pokušajte ponovo kasnije.",
  too_many_redirects: "Stranica preusmerava previše puta.",
  http_status: "Sajt je vratio grešku. Proverite adresu stranice.",
  unsupported_type: "Na ovoj adresi nije HTML ili tekstualna stranica. PDF dokumenti i slike se ne uvoze.",
  too_large: "Stranica je veća od 2 MB, pa je ne uvozimo.",
  unreadable: "Sadržaj stranice nije mogao da se pročita.",
};

/**
 * Reads one public web page and returns suggested knowledge entries; it
 * changes nothing. Only people who may edit the organization can make the
 * server fetch a page, after the same identity, MFA and request-budget checks
 * as saving. Membership is checked in its own short transaction so the
 * outbound fetch never holds a database connection. Logs omit the address.
 */
export async function importKnowledgeFromUrlAction(organizationId: string, url: unknown): Promise<UrlImportResult> {
  const account = await getCurrentAccount();
  const pool = getPool();
  if (!account || !pool) return { status: "signed-out" };
  const rateError = await actionLimit(pool, "knowledge.import", account.userId);
  if (rateError) return { status: "invalid", message: rateError };
  if (mfaRequired() && !account.mfa) {
    await actionLog("knowledge.import", "denied");
    return { status: "forbidden" };
  }
  if (typeof url !== "string" || url.length > MAX_URL_LENGTH) return { status: "invalid", message: IMPORT_MESSAGES.invalid_url };

  try {
    const allowed = await withOrganization(pool, { userId: account.userId, organizationId }, async (_client, role) => canManage(role));
    if (!allowed) {
      await actionLog("knowledge.import", "denied");
      return { status: "forbidden" };
    }
  } catch (error) {
    if (error instanceof ForbiddenError) return { status: "forbidden" };
    await actionLog("knowledge.import", "error", error);
    return { status: "error" };
  }

  const fetched = await fetchPublicPage(url);
  if (!fetched.ok) {
    await actionLog("knowledge.import", "denied");
    const message = fetched.error === "http_status" && fetched.status === 404 ? "Stranica ne postoji (greška 404). Proverite adresu." : IMPORT_MESSAGES[fetched.error];
    return { status: "invalid", message };
  }
  const { title, records } = knowledgeFromPage(fetched.page);
  await actionLog("knowledge.import", "success");
  return { status: "ok", source: new URL(fetched.page.url).hostname, title, records };
}
