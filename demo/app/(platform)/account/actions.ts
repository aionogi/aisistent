"use server";

import { redirect } from "next/navigation";
import { getCurrentAccount } from "../../../lib/auth/account.ts";
import { mfaRequired } from "../../../lib/auth/auth0.ts";
import { getPool } from "../../../lib/db/pool.ts";
import { createOrganization } from "../../../lib/db/repositories.ts";
import { actionLimit, actionLog } from "../../../lib/operations/action-guard.ts";

export type CreateOrganizationState = { error: string | null; name: string };

/**
 * Creates an organization owned by the signed-in user. Identity, email
 * verification, and MFA are checked here on the server; the form only
 * supplies the name.
 */
export async function createOrganizationAction(_previous: CreateOrganizationState, formData: FormData): Promise<CreateOrganizationState> {
  const name = String(formData.get("name") ?? "").trim();
  const account = await getCurrentAccount();
  const pool = getPool();
  if (!account || !pool) redirect("/auth/login?returnTo=/account/");
  const limitError = await actionLimit(pool, "organization.create", account.userId);
  if (limitError) return { error: limitError, name };
  if (!account.emailVerified) return { error: "Potvrdite email adresu pre nego što napravite firmu.", name };
  if (mfaRequired() && !account.mfa) return { error: "Za pravljenje firme potrebna je prijava sa dvofaktorskom potvrdom.", name };
  if (name.length < 2 || name.length > 60) return { error: "Naziv firme mora imati od 2 do 60 znakova.", name };

  let organizationId: string;
  try {
    organizationId = await createOrganization(pool, account.userId, name);
    await actionLog("organization.create", "success");
  } catch {
    await actionLog("organization.create", "error");
    return { error: "Firma nije napravljena. Pokušajte ponovo kasnije.", name };
  }
  // Start guided setup for the new organization right away.
  redirect(`/org/${organizationId}/onboarding/`);
}
