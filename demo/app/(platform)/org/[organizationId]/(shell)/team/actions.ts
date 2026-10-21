"use server";

import { revalidatePath } from "next/cache";
import { getCurrentAccount, type CurrentAccount } from "../../../../../../lib/auth/account.ts";
import { mfaRequired } from "../../../../../../lib/auth/auth0.ts";
import { ForbiddenError, withOrganization, type MemberRole } from "../../../../../../lib/db/context.ts";
import { getPool } from "../../../../../../lib/db/pool.ts";
import { changeMemberRole, createInvitation, isValidInvitationEmail, removeMember, revokeInvitation, TeamError, type TeamErrorCode } from "../../../../../../lib/db/team.ts";

export type TeamActionResult = { error: string | null };
export type InviteState = { error: string | null; invitation: { path: string; email: string; expiresAt: string } | null };

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const MESSAGES: Partial<Record<TeamErrorCode, string>> = {
  owner_required: "Samo vlasnik firme može da menja tim.",
  already_member: "Ova osoba je već član firme.",
  last_owner: "Firma mora imati bar jednog vlasnika. Prvo postavite drugog vlasnika.",
  member_not_found: "Član više nije u firmi. Osvežite stranicu.",
  invalid_role: "Nepoznata uloga.",
};

type Guard = { account: CurrentAccount; error: null } | { account: null; error: string };

/** Identity and the MFA policy for team changes, checked on every action. */
async function guard(): Promise<Guard> {
  const account = await getCurrentAccount();
  if (!account) return { account: null, error: "Sesija je istekla. Prijavite se ponovo." };
  if (mfaRequired() && !account.mfa) return { account: null, error: "Za izmene tima potrebna je prijava sa dvofaktorskom potvrdom." };
  return { account, error: null };
}

async function runTeamChange(organizationId: string, work: Parameters<typeof withOrganization<void>>[2]): Promise<TeamActionResult> {
  const checked = await guard();
  const pool = getPool();
  if (!checked.account || !pool) return { error: checked.error ?? "Prijava nije podešena." };
  try {
    await withOrganization(pool, { userId: checked.account.userId, organizationId }, work);
  } catch (error) {
    if (error instanceof TeamError) return { error: MESSAGES[error.code] ?? "Izmena nije uspela." };
    if (error instanceof ForbiddenError) return { error: "Nemate pristup ovoj firmi." };
    throw error;
  }
  revalidatePath(`/org/${organizationId}/team/`);
  return { error: null };
}

export async function inviteMemberAction(organizationId: string, _previous: InviteState, formData: FormData): Promise<InviteState> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const role = formData.get("role") === "admin" ? "admin" : "member";
  if (!isValidInvitationEmail(email)) return { error: "Unesite ispravnu email adresu.", invitation: null };

  let created: { token: string; expiresAt: Date } | null = null;
  const result = await runTeamChange(organizationId, async (client) => {
    created = await createInvitation(client, { email, role });
  });
  if (result.error || !created) return { error: result.error ?? "Poziv nije napravljen.", invitation: null };
  const { token, expiresAt } = created as { token: string; expiresAt: Date };
  return { error: null, invitation: { path: `/invite/${token}/`, email, expiresAt: expiresAt.toISOString() } };
}

export async function revokeInvitationAction(organizationId: string, invitationId: string): Promise<TeamActionResult> {
  if (!uuidPattern.test(invitationId)) return { error: "Neispravan poziv." };
  return runTeamChange(organizationId, async (client) => { await revokeInvitation(client, invitationId); });
}

export async function changeRoleAction(organizationId: string, userId: string, role: MemberRole): Promise<TeamActionResult> {
  if (!uuidPattern.test(userId) || !["owner", "admin", "member"].includes(role)) return { error: "Neispravna izmena." };
  return runTeamChange(organizationId, (client) => changeMemberRole(client, userId, role));
}

export async function removeMemberAction(organizationId: string, userId: string): Promise<TeamActionResult> {
  if (!uuidPattern.test(userId)) return { error: "Neispravna izmena." };
  return runTeamChange(organizationId, (client) => removeMember(client, userId));
}
