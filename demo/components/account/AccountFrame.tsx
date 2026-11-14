import { LogOut } from "lucide-react";
import type { ReactNode } from "react";
import Brand from "../Brand";
import SupportChat from "../support/SupportChat";
import styles from "./account.module.css";

/** Page frame of the signed-in area outside a workspace: the account page and the entry page. */
export default function AccountFrame({ children, signedIn, accountLink = false }: { children: ReactNode; signedIn: boolean; accountLink?: boolean }) {
  return (
    <div className={styles.page}>
      <header className={styles.topbar}>
        <a href="/" className={styles.brandLink} aria-label="aisistent početna"><Brand /></a>
        <div className={styles.topbarActions}>
          <span className={styles.envBadge}>Test okruženje</span>
          {signedIn && accountLink && <a href="/account/" className={styles.textLink}>Nalog</a>}
          {/* Plain links: auth routes must not be prefetched. */}
          {signedIn && <a href="/auth/logout" className={styles.textLink}><LogOut size={15} aria-hidden="true" />Odjava</a>}
        </div>
      </header>
      <main id="main" className={styles.main}>{children}</main>
      <footer className={styles.footer}>
        Test okruženje za razvoj. Ne unosite stvarne podatke klijenata dok platforma ne prođe bezbednosne provere.
      </footer>
      <SupportChat />
    </div>
  );
}
