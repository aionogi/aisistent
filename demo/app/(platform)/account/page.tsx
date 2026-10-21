import type { Metadata } from "next";
import Link from "next/link";
import { ChevronRight, CircleAlert, CircleCheck, LogIn, LogOut, ShieldCheck } from "lucide-react";
import Brand from "../../../components/Brand";
import CreateOrganizationForm from "../../../components/account/CreateOrganizationForm";
import styles from "../../../components/account/account.module.css";
import { Notice } from "../../../components/workspace/FormControls";
import { getCurrentAccount } from "../../../lib/auth/account.ts";
import { getAuth0, MFA_STEP_UP_PATH, mfaRequired } from "../../../lib/auth/auth0.ts";
import { getPool } from "../../../lib/db/pool.ts";
import { listMemberships, type Membership } from "../../../lib/db/repositories.ts";

export const metadata: Metadata = { title: "Nalog — aisistent" };

const ROLE_LABELS: Record<Membership["role"], string> = { owner: "Vlasnik", admin: "Administrator", member: "Član" };

const STATUS_MESSAGES: Record<string, { tone: "success" | "warning"; text: string }> = {
  created: { tone: "success", text: "Firma je napravljena. Vi ste njen vlasnik." },
  "login-failed": { tone: "warning", text: "Prijava nije uspela. Pokušajte ponovo." },
};

function Frame({ children, signedIn }: { children: React.ReactNode; signedIn: boolean }) {
  return (
    <div className={styles.page}>
      <header className={styles.topbar}>
        <a href="/" className={styles.brandLink} aria-label="aisistent početna"><Brand /></a>
        <div className={styles.topbarActions}>
          <span className={styles.envBadge}>Test okruženje</span>
          {/* Plain links: auth routes must not be prefetched. */}
          {signedIn && <a href="/auth/logout" className={styles.textLink}><LogOut size={15} aria-hidden="true" />Odjava</a>}
        </div>
      </header>
      <main id="main" className={styles.main}>{children}</main>
      <footer className={styles.footer}>
        Test okruženje za razvoj. Ne unosite stvarne podatke klijenata dok platforma ne prođe bezbednosne provere.
      </footer>
    </div>
  );
}

export default async function AccountPage({ searchParams }: PageProps<"/account">) {
  const { status } = await searchParams;
  const message = typeof status === "string" ? STATUS_MESSAGES[status] : undefined;

  if (!getAuth0()) {
    return (
      <Frame signedIn={false}>
        <section className={styles.card} aria-labelledby="account-title">
          <h1 id="account-title">Prijava još nije podešena</h1>
          <p className={styles.lead}>Na ovom serveru nisu postavljeni podaci za Auth0 i bazu podataka. Demo radni prostor sa primerima i dalje radi bez prijave.</p>
          <a href="/workspace/" className={styles.primaryLink}>Otvori demo radni prostor</a>
        </section>
      </Frame>
    );
  }

  const account = await getCurrentAccount();
  if (!account) {
    return (
      <Frame signedIn={false}>
        {message && <Notice tone={message.tone}>{message.text}</Notice>}
        <section className={styles.card} aria-labelledby="account-title">
          <h1 id="account-title">Prijavite se</h1>
          <p className={styles.lead}>Prijava se obavlja preko Auth0. Posle prijave možete da napravite svoju firmu i podesite asistenta.</p>
          <a href="/auth/login?returnTo=/account/" className={styles.primaryLink}><LogIn size={16} aria-hidden="true" />Prijava</a>
        </section>
      </Frame>
    );
  }

  const memberships = await listMemberships(getPool()!, account.userId);
  const needsMfa = mfaRequired() && !account.mfa;

  return (
    <Frame signedIn>
      {message && <Notice tone={message.tone}>{message.text}</Notice>}
      <section className={styles.card} aria-labelledby="account-title">
        <h1 id="account-title">Vaš nalog</h1>
        <div className={styles.identity}>
          <strong>{account.name ?? account.email ?? "Korisnik"}</strong>
          {account.email && <span className={styles.lead}>{account.email}</span>}
        </div>
        <div className={styles.identity}>
          {account.emailVerified
            ? <span className={styles.chip}><CircleCheck size={13} aria-hidden="true" />Email potvrđen</span>
            : <span className={`${styles.chip} ${styles.chipWarn}`}><CircleAlert size={13} aria-hidden="true" />Email nije potvrđen</span>}
          {account.mfa
            ? <span className={styles.chip}><ShieldCheck size={13} aria-hidden="true" />Dvofaktorska prijava</span>
            : <span className={`${styles.chip} ${styles.chipWarn}`}><CircleAlert size={13} aria-hidden="true" />Bez dvofaktorske prijave</span>}
        </div>
      </section>

      <section className={styles.card} aria-labelledby="organizations-title">
        <h2 id="organizations-title">Vaše firme</h2>
        {memberships.length === 0
          ? <p className={styles.empty}>Još niste član nijedne firme.</p>
          : (
            <ul className={styles.organizations}>
              {memberships.map((membership) => (
                <li key={membership.organizationId}>
                  <Link href={`/org/${membership.organizationId}/`} className={styles.organizationLink}>
                    <strong>{membership.organizationName}</strong>
                    <span className={styles.role}>{ROLE_LABELS[membership.role]}<ChevronRight size={16} aria-hidden="true" /></span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        <p className={styles.note}>Otvorite firmu da biste podesili asistenta i bazu znanja. Podaci se čuvaju za firmu; demo radni prostor i dalje koristi samo primere iz pregledača.</p>
      </section>

      <section className={styles.card} aria-labelledby="create-title">
        <h2 id="create-title">Nova firma</h2>
        {!account.emailVerified && <Notice tone="warning">Potvrdite email adresu preko poruke koju vam je poslao Auth0, pa se ponovo prijavite.</Notice>}
        {needsMfa && (
          <Notice tone="warning" action={<a href={MFA_STEP_UP_PATH} className={styles.textLink}>Potvrdi</a>}>
            Za pravljenje firme potrebna je prijava sa dvofaktorskom potvrdom.
          </Notice>
        )}
        <CreateOrganizationForm disabled={!account.emailVerified || needsMfa} />
      </section>
    </Frame>
  );
}
