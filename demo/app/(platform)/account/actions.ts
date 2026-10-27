"use server";

import { redirect } from "next/navigation";
import { getCurrentAccount } from "../../../lib/auth/account.ts";
import { mfaRequired } from "../../../lib/auth/auth0.ts";
import { withUser } from "../../../lib/db/context.ts";
import { getPool } from "../../../lib/db/pool.ts";
import { createOrganization } from "../../../lib/db/repositories.ts";
import { endMySessions } from "../../../lib/db/sessions.ts";
import { actionLimit, actionLog } from "../../../lib/operations/action-guard.ts";

export type CreateOrganizationState = { error: string | null; name: string };
export type SignOutEverywhereState = { error: string | null; done: boolean };

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

/**
 * Ends every application session of the signed-in user on every device. The
 * form then sends this browser through /auth/logout to end the identity
 * provider's session here too; sessions at the provider on other devices are
 * not affected.
 */
export async function signOutEverywhereAction(_previous: SignOutEverywhereState): Promise<SignOutEverywhereState> {
  const account = await getCurrentAccount();
  const pool = getPool();
  if (!account || !pool) return { error: null, done: true };
  const limitError = await actionLimit(pool, "account.sessions", account.userId);
  if (limitError) return { error: limitError, done: false };
  try {
    await withUser(pool, account.userId, (client) => endMySessions(client));
  } catch {
    await actionLog("account.sessions", "error");
    return { error: "Odjava sa svih uređaja trenutno nije moguća. Pokušajte ponovo kasnije.", done: false };
  }
  await actionLog("account.sessions", "success");
  return { error: null, done: true };
}
