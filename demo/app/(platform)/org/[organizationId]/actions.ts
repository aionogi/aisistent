"use server";

import { getCurrentAccount } from "../../../../lib/auth/account.ts";
import { canManage, ForbiddenError, withOrganization } from "../../../../lib/db/context.ts";
import { getPool } from "../../../../lib/db/pool.ts";
import { ConflictError, saveWorkspace } from "../../../../lib/db/repositories.ts";
import { checkDraftLimits, toStoredConfig, type SaveWorkspaceResult } from "../../../../lib/workspace/persistence.ts";
import { parseDraft } from "../../../../lib/workspace/storage.ts";

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
  if (typeof expectedRevision !== "number" || !Number.isInteger(expectedRevision) || expectedRevision < 0) return { status: "invalid", message: "Neispravan zahtev za čuvanje." };

  const parsed = parseDraft(draft);
  if (!parsed) return { status: "invalid", message: "Podaci nisu u očekivanom obliku. Osvežite stranicu." };
  const limitError = checkDraftLimits(parsed);
  if (limitError) return { status: "invalid", message: limitError };

  try {
    return await withOrganization(pool, { userId: account.userId, organizationId }, async (client, role) => {
      if (!canManage(role)) return { status: "forbidden" } as const;
      const { revision, idMap } = await saveWorkspace(client, {
        config: toStoredConfig(parsed) as unknown as Record<string, unknown>,
        knowledge: parsed.knowledge,
        expectedRevision,
      });
      return { status: "saved", revision, savedAt: new Date().toISOString(), idMap } as const;
    });
  } catch (error) {
    if (error instanceof ConflictError) return { status: "conflict" };
    if (error instanceof ForbiddenError) return { status: "forbidden" };
    console.error("Workspace save failed:", (error as Error).message);
    return { status: "error" };
  }
}
