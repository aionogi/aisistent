import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import styles from "./pages.module.css";

export function PageHeader({ title, description, badge = "Primer podataka", actions }: { title: string; description?: string; badge?: string; actions?: ReactNode }) {
  return (
    <header className={styles.pageHeader}>
      <div>
        <span className={styles.badge}><span aria-hidden="true" />{badge}</span>
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      {actions && <div className={styles.headerActions}>{actions}</div>}
    </header>
  );
}

export function EmptyState({ icon: Icon, title, children, actions }: { icon: LucideIcon; title: string; children: ReactNode; actions?: ReactNode }) {
  return (
    <div className={styles.emptyState}>
      <span className={styles.emptyIcon}><Icon size={22} strokeWidth={1.8} aria-hidden="true" /></span>
      <h2>{title}</h2>
      <p>{children}</p>
      {actions && <div className={styles.emptyActions}>{actions}</div>}
    </div>
  );
}
