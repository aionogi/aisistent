"use server";

import { revalidatePath } from "next/cache";
import type { Pool } from "pg";
import { getCurrentAccount, type CurrentAccount } from "../../../../../../lib/auth/account.ts";
import { mfaRequired } from "../../../../../../lib/auth/auth0.ts";
import { ForbiddenError, withOrganization, type MemberRole } from "../../../../../../lib/db/context.ts";
import { getPool } from "../../../../../../lib/db/pool.ts";
import { getOrganizationName } from "../../../../../../lib/db/repositories.ts";
import { changeMemberRole, createInvitation, INVITATION_LIFETIME_DAYS, isValidInvitationEmail, removeMember, revokeInvitation, TeamError, type TeamErrorCode } from "../../../../../../lib/db/team.ts";
import { invitationEmail } from "../../../../../../lib/email/invitation.ts";
import { emailConfig, sendEmail } from "../../../../../../lib/email/lettermint.ts";
import { actionLimit, actionLog } from "../../../../../../lib/operations/action-guard.ts";

export type TeamActionResult = { error: string | null };
export type InviteDelivery = "sent" | "failed" | "limited" | "off";
export type InviteState = { error: string | null; invitation: { link: string; email: string; expiresAt: string; delivery: InviteDelivery } | null };

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

type AppliedChange = { error: string } | { error: null; userId: string; pool: Pool };

async function applyTeamChange(organizationId: string, work: Parameters<typeof withOrganization<void>>[2]): Promise<AppliedChange> {
  const checked = await guard();
  const pool = getPool();
  if (!checked.account || !pool) return { error: checked.error ?? "Prijava nije podešena." };
  const limitError = await actionLimit(pool, "team.change", checked.account.userId);
  if (limitError) return { error: limitError };
  try {
    await withOrganization(pool, { userId: checked.account.userId, organizationId }, work);
  } catch (error) {
    await actionLog("team.change", error instanceof TeamError || error instanceof ForbiddenError ? "denied" : "error", error);
    if (error instanceof TeamError) return { error: MESSAGES[error.code] ?? "Izmena nije uspela." };
    if (error instanceof ForbiddenError) return { error: "Nemate pristup ovoj firmi." };
    return { error: "Izmena trenutno nije moguća. Pokušajte ponovo kasnije." };
  }
  await actionLog("team.change", "success");
  revalidatePath(`/org/${organizationId}/team/`);
  return { error: null, userId: checked.account.userId, pool };
}

async function runTeamChange(organizationId: string, work: Parameters<typeof withOrganization<void>>[2]): Promise<TeamActionResult> {
  const { error } = await applyTeamChange(organizationId, work);
  return { error };
}

/** The invitation is already saved, so a failure here only means the owner sends the link by hand. */
async function deliverInvitation(pool: Pool, userId: string, invitation: { to: string; organizationName: string; role: "admin" | "member"; link: string }): Promise<InviteDelivery> {
  const config = emailConfig();
  if (!config) return "off";
  if (await actionLimit(pool, "invitation.email", userId)) return "limited";
  try {
    await sendEmail(config, invitationEmail({ ...invitation, validDays: INVITATION_LIFETIME_DAYS }));
  } catch (error) {
    await actionLog("invitation.email", "error", error);
    return "failed";
  }
  await actionLog("invitation.email", "success");
  return "sent";
}

export async function inviteMemberAction(organizationId: string, _previous: InviteState, formData: FormData): Promise<InviteState> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const role = formData.get("role") === "admin" ? "admin" : "member";
  if (!isValidInvitationEmail(email)) return { error: "Unesite ispravnu email adresu.", invitation: null };

  type Created = { token: string; expiresAt: Date; organizationName: string };
  let created: Created | null = null;
  const applied = await applyTeamChange(organizationId, async (client) => {
    const { token, expiresAt } = await createInvitation(client, { email, role });
    created = { token, expiresAt, organizationName: (await getOrganizationName(client)) ?? "" };
  });
  if (applied.error !== null || !created) return { error: applied.error ?? "Poziv nije napravljen.", invitation: null };
  const { token, expiresAt, organizationName } = created as Created;
  // From the configured address, never the request's Host header, which the sender could choose.
  const link = new URL(`/invite/${token}/`, process.env.APP_BASE_URL).href;
  const delivery = await deliverInvitation(applied.pool, applied.userId, { to: email, organizationName, role, link });
  return { error: null, invitation: { link, email, expiresAt: expiresAt.toISOString(), delivery } };
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
