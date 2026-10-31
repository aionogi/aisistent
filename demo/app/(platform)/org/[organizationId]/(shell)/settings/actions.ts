"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCurrentAccount } from "../../../../../../lib/auth/account.ts";
import { mfaRequired } from "../../../../../../lib/auth/auth0.ts";
import { ForbiddenError, withOrganization } from "../../../../../../lib/db/context.ts";
import { RETENTION_OPTIONS } from "../../../../../../lib/db/conversations.ts";
import { getPool } from "../../../../../../lib/db/pool.ts";
import { deleteOrganization, leaveOrganization, setConversationRetention, TeamError } from "../../../../../../lib/db/team.ts";
import { actionLimit, actionLog } from "../../../../../../lib/operations/action-guard.ts";

export type OrganizationActionResult = { error: string | null };
export type RetentionState = { error: string | null; saved: boolean };

/** The signed-in member leaves; the database refuses the last owner. Needs no MFA, since it only gives up access. */
export async function leaveOrganizationAction(organizationId: string): Promise<OrganizationActionResult> {
  const account = await getCurrentAccount();
  const pool = getPool();
  if (!account || !pool) return { error: "Sesija je istekla. Prijavite se ponovo." };
  const limitError = await actionLimit(pool, "team.change", account.userId);
  if (limitError) return { error: limitError };
  try {
    await withOrganization(pool, { userId: account.userId, organizationId }, (client) => leaveOrganization(client));
  } catch (error) {
    await actionLog("team.change", error instanceof TeamError || error instanceof ForbiddenError ? "denied" : "error", error);
    if (error instanceof TeamError && error.code === "last_owner") return { error: "Vi ste jedini vlasnik. Prvo na stranici Tim postavite drugog vlasnika ili obrišite firmu." };
    if (error instanceof ForbiddenError) return { error: "Više niste član ove firme. Osvežite stranicu." };
    return { error: "Napuštanje firme trenutno nije moguće. Pokušajte ponovo kasnije." };
  }
  await actionLog("team.change", "success");
  redirect("/account/?status=left");
}

/** Permanently deletes the organization: owner, MFA when required, and the exact name, all checked again here and in the database. */
export async function deleteOrganizationAction(organizationId: string, _previous: OrganizationActionResult, formData: FormData): Promise<OrganizationActionResult> {
  const confirmName = String(formData.get("confirmName") ?? "").slice(0, 200);
  const account = await getCurrentAccount();
  const pool = getPool();
  if (!account || !pool) return { error: "Sesija je istekla. Prijavite se ponovo." };
  const limitError = await actionLimit(pool, "organization.delete", account.userId);
  if (limitError) return { error: limitError };
  if (mfaRequired() && !account.mfa) {
    await actionLog("organization.delete", "denied");
    return { error: "Za brisanje firme potrebna je prijava sa dvofaktorskom potvrdom." };
  }
  try {
    await withOrganization(pool, { userId: account.userId, organizationId }, (client) => deleteOrganization(client, confirmName));
  } catch (error) {
    await actionLog("organization.delete", error instanceof TeamError || error instanceof ForbiddenError ? "denied" : "error", error);
    if (error instanceof TeamError && error.code === "confirmation_mismatch") return { error: "Naziv se ne poklapa. Upišite tačan naziv firme." };
    if (error instanceof TeamError) return { error: "Firmu može da obriše samo vlasnik." };
    if (error instanceof ForbiddenError) return { error: "Firma nije pronađena ili više niste njen član." };
    return { error: "Brisanje trenutno nije moguće. Pokušajte ponovo kasnije." };
  }
  await actionLog("organization.delete", "success");
  redirect("/account/?status=organization-deleted");
}

/** Owners choose how long conversations are kept; MFA when required. */
export async function setRetentionAction(organizationId: string, _previous: RetentionState, formData: FormData): Promise<RetentionState> {
  const days = Number(formData.get("days"));
  const account = await getCurrentAccount();
  const pool = getPool();
  if (!account || !pool) return { error: "Sesija je istekla. Prijavite se ponovo.", saved: false };
  const limitError = await actionLimit(pool, "team.change", account.userId);
  if (limitError) return { error: limitError, saved: false };
  if (mfaRequired() && !account.mfa) return { error: "Za izmenu roka potrebna je prijava sa dvofaktorskom potvrdom.", saved: false };
  if (!(RETENTION_OPTIONS as readonly number[]).includes(days)) return { error: "Izaberite jedan od ponuđenih rokova.", saved: false };
  try {
    await withOrganization(pool, { userId: account.userId, organizationId }, (client) => setConversationRetention(client, days));
  } catch (error) {
    await actionLog("team.change", error instanceof TeamError || error instanceof ForbiddenError ? "denied" : "error", error);
    if (error instanceof TeamError) return { error: "Rok čuvanja menja vlasnik firme.", saved: false };
    if (error instanceof ForbiddenError) return { error: "Nemate pristup ovoj firmi.", saved: false };
    return { error: "Izmena trenutno nije moguća. Pokušajte ponovo kasnije.", saved: false };
  }
  await actionLog("team.change", "success");
  revalidatePath(`/org/${organizationId}/settings/`);
  revalidatePath(`/org/${organizationId}/conversations/`);
  return { error: null, saved: true };
}
