import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { LogIn, LogOut, UserPlus } from "lucide-react";
import Brand from "../../../../components/Brand";
import AcceptInvitationForm from "../../../../components/account/AcceptInvitationForm";
import styles from "../../../../components/account/account.module.css";
import { Notice } from "../../../../components/workspace/FormControls";
import { getCurrentAccount } from "../../../../lib/auth/account.ts";
import { getAuth0 } from "../../../../lib/auth/auth0.ts";
import { getPool } from "../../../../lib/db/pool.ts";
import { previewInvitation } from "../../../../lib/db/team.ts";
import { acceptInvitationAction } from "./actions.ts";

// No per-page "no-referrer": it makes browsers send `Origin: null` on the
// form POST, which Next.js rejects as a cross-site Server Action. The global
// strict-origin-when-cross-origin policy already keeps the token path from
// leaving this site.
export const metadata: Metadata = { title: "Poziv u firmu — aisistent" };

const tokenPattern = /^[A-Za-z0-9_-]{20,100}$/;
const ROLE_TEXT = { admin: "administrator", member: "član" } as const;

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <div className={styles.page}>
      <header className={styles.topbar}>
        <a href="/" className={styles.brandLink} aria-label="aisistent početna"><Brand /></a>
        <span className={styles.envBadge}>Test okruženje</span>
      </header>
      <main id="main" className={styles.main}>
        <section className={styles.card} aria-labelledby="invite-title">{children}</section>
      </main>
    </div>
  );
}

/** Landing page for an invitation link: sign in, check the invited address, then accept. */
export default async function InvitationPage({ params }: PageProps<"/invite/[token]">) {
  const { token } = await params;
  if (!tokenPattern.test(token)) notFound();
  const returnTo = encodeURIComponent(`/invite/${token}/`);

  const pool = getPool();
  if (!getAuth0() || !pool) {
    return <Frame><h1 id="invite-title">Prijava još nije podešena</h1><p className={styles.lead}>Na ovom serveru poziv ne može da se prihvati.</p></Frame>;
  }

  const account = await getCurrentAccount();
  if (!account) {
    return (
      <Frame>
        <h1 id="invite-title">Pozvani ste u firmu na aisistent-u</h1>
        <p className={styles.lead}>Prijavite se ili napravite nalog sa email adresom na koju je poziv poslat, pa ga prihvatite.</p>
        <div className={styles.identity}>
          <a href={`/auth/login?returnTo=${returnTo}`} className={styles.primaryLink}><LogIn size={16} aria-hidden="true" />Prijava</a>
          <a href={`/auth/login?screen_hint=signup&returnTo=${returnTo}`} className={styles.textLink}><UserPlus size={15} aria-hidden="true" />Napravite nalog</a>
        </div>
      </Frame>
    );
  }

  const preview = await previewInvitation(pool, account.userId, token);
  if (!preview) {
    return <Frame><h1 id="invite-title">Poziv nije pronađen</h1><p className={styles.lead}>Proverite da li ste otvorili ceo link ili zatražite novi poziv od vlasnika firme.</p></Frame>;
  }

  const emailMatches = account.emailVerified && account.email?.toLowerCase() === preview.email;
  return (
    <Frame>
      <h1 id="invite-title">Poziv u firmu „{preview.organizationName}“</h1>
      <p className={styles.lead}>Uloga: {ROLE_TEXT[preview.role]}. Poziv glasi na <strong>{preview.email}</strong>.</p>
      {preview.status === "valid" && emailMatches && <AcceptInvitationForm action={acceptInvitationAction.bind(null, token)} />}
      {preview.status === "valid" && !emailMatches && (
        <Notice tone="warning" title="Prijavljeni ste drugim nalogom" action={<a href="/auth/logout">Odjava</a>}>
          {account.email ? `Trenutno ste prijavljeni kao ${account.email}${account.emailVerified ? "" : " (adresa nije potvrđena)"}.` : "Vaš nalog nema potvrđenu email adresu."} Prihvatiti može samo nalog sa adresom {preview.email}.
        </Notice>
      )}
      {preview.status === "accepted" && <Notice tone="info">Ovaj poziv je već prihvaćen. <a href="/account/">Otvorite svoje firme</a>.</Notice>}
      {preview.status === "revoked" && <Notice tone="warning">Vlasnik firme je opozvao ovaj poziv.</Notice>}
      {preview.status === "expired" && <Notice tone="warning">Poziv je istekao. Zatražite novi od vlasnika firme.</Notice>}
      <p className={styles.note}><a href="/auth/logout"><LogOut size={13} aria-hidden="true" /> Odjava</a></p>
    </Frame>
  );
}
