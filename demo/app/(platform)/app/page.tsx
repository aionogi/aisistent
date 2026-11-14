import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import AccountFrame from "../../../components/account/AccountFrame";
import CreateOrganizationForm from "../../../components/account/CreateOrganizationForm";
import OrganizationList from "../../../components/account/OrganizationList";
import styles from "../../../components/account/account.module.css";
import { Notice } from "../../../components/workspace/FormControls";
import { getCurrentAccount } from "../../../lib/auth/account.ts";
import { getAuth0, mfaRequired, mfaStepUpPath } from "../../../lib/auth/auth0.ts";
import { getPool } from "../../../lib/db/pool.ts";
import { listMemberships } from "../../../lib/db/repositories.ts";
import { APP_HOME_PATH, chooseEntry, LAST_ORGANIZATION_COOKIE, organizationHomePath } from "../../../lib/workspace/entry.ts";

export const metadata: Metadata = { title: "Radni prostor — aisistent" };

/**
 * Where sign-in lands: the signed-in person's own workspace, never the demo.
 * One organization opens directly, several open the one last used on this
 * device, and someone without an organization creates one first.
 */
export default async function AppEntryPage() {
  const pool = getPool();
  // The account page explains that sign-in is not configured on this server.
  if (!getAuth0() || !pool) redirect("/account/");
  const account = await getCurrentAccount();
  if (!account) redirect(`/auth/login?returnTo=${encodeURIComponent(APP_HOME_PATH)}`);

  const memberships = await listMemberships(pool, account.userId);
  const remembered = (await cookies()).get(LAST_ORGANIZATION_COOKIE)?.value;
  const decision = chooseEntry(memberships, remembered);
  if (decision.kind === "open") redirect(organizationHomePath(decision.organizationId));

  if (decision.kind === "choose") {
    return (
      <AccountFrame signedIn accountLink>
        <section className={styles.card} aria-labelledby="entry-title">
          <h1 id="entry-title">Izaberite firmu</h1>
          <p className={styles.lead}>Član ste više firmi. Sledeći put na ovom uređaju otvaramo onu koju ste poslednju koristili.</p>
          <OrganizationList memberships={memberships} />
        </section>
      </AccountFrame>
    );
  }

  const needsMfa = mfaRequired() && !account.mfa;
  return (
    <AccountFrame signedIn accountLink>
      <section className={styles.card} aria-labelledby="entry-title">
        <h1 id="entry-title">{account.name ? `Dobro došli, ${account.name}` : "Dobro došli"}</h1>
        <p className={styles.lead}>Napravite firmu da biste podesili svog asistenta. Odmah zatim vas vodimo kroz podešavanje: delatnost, podatke o poslu, radno vreme i ponašanje asistenta.</p>
        {!account.emailVerified && <Notice tone="warning">Potvrdite email adresu preko poruke koju vam je poslao Auth0, pa se ponovo prijavite.</Notice>}
        {needsMfa && (
          <Notice tone="warning" action={<a href={mfaStepUpPath(APP_HOME_PATH)} className={styles.textLink}>Potvrdi</a>}>
            Za pravljenje firme potrebna je prijava sa dvofaktorskom potvrdom.
          </Notice>
        )}
        <CreateOrganizationForm disabled={!account.emailVerified || needsMfa} />
        <p className={styles.note}>Ako vas je neko pozvao u svoju firmu, otvorite link iz poziva. Demo sa primerima je i dalje na <a href="/workspace/">demo radnom prostoru</a>.</p>
      </section>
    </AccountFrame>
  );
}
