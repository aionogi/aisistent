import { getPool } from "../db/pool.ts";
import { provisionUser } from "../db/repositories.ts";
import { getAuth0 } from "./auth0.ts";

export type CurrentAccount = {
  userId: string;
  subject: string;
  name: string | null;
  email: string | null;
  emailVerified: boolean;
  /** The current session was established with multi-factor authentication. */
  mfa: boolean;
};

/**
 * The signed-in user for this request, resolved on the server from the
 * session store and the database; null when signed out or not configured.
 * Never accept a user id from the browser instead.
 */
export async function getCurrentAccount(): Promise<CurrentAccount | null> {
  const auth0 = getAuth0();
  const pool = getPool();
  if (!auth0 || !pool) return null;
  const session = await auth0.getSession();
  if (!session) return null;

  const { user } = session;
  const email = typeof user.email === "string" ? user.email : null;
  const emailVerified = user.email_verified === true;
  const name = typeof user.name === "string" ? user.name : null;
  const { rows } = await pool.query<{ id: string | null }>("SELECT app.lookup_user($1) AS id", [user.sub]);
  // Normally provisioned at sign-in; recreate the record if it is missing (for example after a database reset).
  const userId = rows[0]?.id ?? (await provisionUser(pool, { subject: user.sub, email: emailVerified ? email : null, displayName: name }));
  const amr = Array.isArray(user.amr) ? user.amr : [];
  return { userId, subject: user.sub, name, email, emailVerified, mfa: amr.includes("mfa") };
}
