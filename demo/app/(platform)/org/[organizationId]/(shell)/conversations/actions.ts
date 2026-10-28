"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCurrentAccount } from "../../../../../../lib/auth/account.ts";
import { mfaRequired } from "../../../../../../lib/auth/auth0.ts";
import { canManage, ForbiddenError, withOrganization } from "../../../../../../lib/db/context.ts";
import { deleteConversation } from "../../../../../../lib/db/conversations.ts";
import { getPool } from "../../../../../../lib/db/pool.ts";
import { actionLimit, actionLog } from "../../../../../../lib/operations/action-guard.ts";

export type ConversationActionResult = { error: string | null };

/** Deletes one stored conversation: owners and admins, with MFA when required; RLS enforces the same. */
export async function deleteConversationAction(organizationId: string, conversationId: string): Promise<ConversationActionResult> {
  const account = await getCurrentAccount();
  const pool = getPool();
  if (!account || !pool) return { error: "Sesija je istekla. Prijavite se ponovo." };
  const limitError = await actionLimit(pool, "workspace.save", account.userId);
  if (limitError) return { error: limitError };
  if (mfaRequired() && !account.mfa) return { error: "Za brisanje razgovora potrebna je prijava sa dvofaktorskom potvrdom." };
  let deleted: boolean;
  try {
    deleted = await withOrganization(pool, { userId: account.userId, organizationId }, (client, role) => canManage(role) ? deleteConversation(client, conversationId) : Promise.resolve(false));
  } catch (error) {
    await actionLog("workspace.save", error instanceof ForbiddenError ? "denied" : "error");
    return { error: error instanceof ForbiddenError ? "Nemate pristup ovoj firmi." : "Brisanje trenutno nije moguće. Pokušajte ponovo kasnije." };
  }
  await actionLog("workspace.save", deleted ? "success" : "denied");
  if (!deleted) return { error: "Razgovor nije obrisan: ne postoji više ili nemate pravo da ga obrišete." };
  revalidatePath(`/org/${organizationId}/conversations/`);
  redirect(`/org/${organizationId}/conversations/`);
}
