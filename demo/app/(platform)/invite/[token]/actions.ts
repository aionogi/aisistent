"use server";

import { redirect } from "next/navigation";
import { getCurrentAccount } from "../../../../lib/auth/account.ts";
import { getPool } from "../../../../lib/db/pool.ts";
import { acceptInvitation, TeamError } from "../../../../lib/db/team.ts";
import { actionLimit, actionLog } from "../../../../lib/operations/action-guard.ts";

export type AcceptState = { error: string | null };

const MESSAGES: Record<string, string> = {
  invitation_not_found: "Poziv nije pronađen.",
  invitation_used: "Ovaj poziv je već iskorišćen.",
  invitation_revoked: "Vlasnik firme je opozvao ovaj poziv.",
  invitation_expired: "Poziv je istekao. Zatražite novi od vlasnika firme.",
  invitation_email_mismatch: "Poziv glasi na drugu email adresu. Prijavite se nalogom sa tom adresom.",
};

/** Accepts the invitation for the signed-in user; the database checks token, expiry, and email. */
export async function acceptInvitationAction(token: string, _previous: AcceptState): Promise<AcceptState> {
  const account = await getCurrentAccount();
  const pool = getPool();
  if (!account || !pool) return { error: "Prijavite se da biste prihvatili poziv." };
  const limitError = await actionLimit(pool, "invitation.accept", account.userId);
  if (limitError) return { error: limitError };
  if (!account.emailVerified) return { error: "Potvrdite email adresu pre nego što prihvatite poziv." };
  let organizationId: string;
  try {
    organizationId = await acceptInvitation(pool, account.userId, token);
    await actionLog("invitation.accept", "success");
  } catch (error) {
    await actionLog("invitation.accept", error instanceof TeamError ? "denied" : "error", error);
    if (error instanceof TeamError) return { error: MESSAGES[error.code] ?? "Poziv nije prihvaćen." };
    return { error: "Poziv trenutno nije moguće prihvatiti. Pokušajte ponovo kasnije." };
  }
  redirect(`/org/${organizationId}/`);
}
