"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BookOpen, Bot, LayoutDashboard, MessageSquare, RotateCcw, X, type LucideIcon } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { completedStepCount, EDITABLE_STEP_COUNT } from "../../lib/workspace/steps";
import { INDUSTRY_LABELS } from "../../lib/workspace/templates";
import Brand from "../Brand";
import ConfirmDialog from "./ConfirmDialog";
import { useDraft } from "./DraftProvider";
import { Notice } from "./FormControls";
import { DraftLoading, DraftNotices } from "./StatusViews";
import styles from "./shell.module.css";

const navigation: Array<{ href: string; label: string; icon: LucideIcon }> = [
  { href: "/workspace/", label: "Pregled", icon: LayoutDashboard },
  { href: "/workspace/conversations/", label: "Razgovori", icon: MessageSquare },
  { href: "/workspace/assistant/", label: "Asistent", icon: Bot },
  { href: "/workspace/knowledge/", label: "Baza znanja", icon: BookOpen },
];

const normalize = (path: string) => path.replace(/\/+$/, "") || "/";

export default function AppShell({ children }: { children: ReactNode }) {
  const pathname = normalize(usePathname());
  const { draft, ready, flash, setFlash, resetDraft } = useDraft();
  const [confirmReset, setConfirmReset] = useState(false);
  const businessName = draft.business.name.trim();
  const completed = completedStepCount(draft);
  const flashPath = useRef(pathname);

  // A confirmation belongs to the page where it appeared; drop it once the user moves on.
  useEffect(() => {
    if (pathname === flashPath.current) return;
    flashPath.current = pathname;
    setFlash(null);
  }, [pathname, setFlash]);

  return (
    <div className={styles.shell}>
      <a className="skip-link" href="#workspace-main">Pređi na sadržaj</a>
      <aside className={styles.sidebar}>
        <div className={styles.sidebarTop}>
          <Link href="/" className={styles.brandLink} aria-label="aisistent početna"><Brand /></Link>
          <button type="button" className={styles.resetIcon} onClick={() => setConfirmReset(true)} aria-label="Obriši nacrt i počni ispočetka" disabled={!ready}><RotateCcw size={17} aria-hidden="true" /></button>
        </div>
        <div className={styles.workspaceCard}>
          <span className={styles.workspaceIcon} aria-hidden="true">{(businessName || "a").charAt(0).toUpperCase()}</span>
          <div>
            <strong>{ready ? businessName || "Novi radni prostor" : "Radni prostor"}</strong>
            <span>{ready && draft.industry ? `${INDUSTRY_LABELS[draft.industry].label} · demo` : "Demo radni prostor"}</span>
          </div>
        </div>

        <nav className={styles.navigation} aria-label="Radni prostor">
          {navigation.map(({ href, label, icon: Icon }) => {
            const active = normalize(href) === pathname;
            return (
              <Link key={href} href={href} className={active ? styles.activeLink : undefined} aria-current={active ? "page" : undefined}>
                <Icon size={17} aria-hidden="true" /><span>{label}</span>
              </Link>
            );
          })}
        </nav>

        {ready && !draft.onboardingCompleted && (
          <Link href="/onboarding/" className={styles.setupCard}>
            <span className={styles.setupTitle}>Podešavanje asistenta</span>
            <span className={styles.setupMeta}>{completed} od {EDITABLE_STEP_COUNT} koraka</span>
            <span className={styles.setupBar} aria-hidden="true"><span style={{ width: `${(completed / EDITABLE_STEP_COUNT) * 100}%` }} /></span>
            <span className={styles.setupAction}>{completed ? "Nastavi podešavanje" : "Započni podešavanje"}</span>
          </Link>
        )}

        <div className={styles.sidebarBottom}>
          <p>Primer podataka. Nacrt se čuva samo u ovoj kartici pregledača.</p>
          <button type="button" className={styles.resetButton} onClick={() => setConfirmReset(true)} disabled={!ready}><RotateCcw size={14} aria-hidden="true" />Obriši nacrt</button>
        </div>
      </aside>

      <div className={styles.content}>
        <div className={styles.notices}>
          <DraftNotices />
          {flash && (
            <div role="status">
              <Notice tone="success" action={<button type="button" onClick={() => setFlash(null)} aria-label="Zatvori obaveštenje"><X size={16} aria-hidden="true" /></button>}>{flash}</Notice>
            </div>
          )}
        </div>
        <main id="workspace-main" className={styles.main}>
          {ready ? children : <DraftLoading />}
        </main>
        <footer className={styles.footer}>
          Demo radni prostor bez prijave. Prikazani razgovori i brojke su izmišljeni primeri; nema stvarnih poziva, AI modela ni naplate.
        </footer>
      </div>

      <ConfirmDialog
        open={confirmReset}
        title="Obrisati ceo nacrt?"
        confirmLabel="Obriši nacrt"
        onClose={() => setConfirmReset(false)}
        onConfirm={() => { resetDraft(); setFlash("Nacrt je obrisan. Možete započeti novo podešavanje."); }}
      >
        <p>Uklanjaju se delatnost, podaci o poslu, radno vreme, ponašanje asistenta i baza znanja iz ove kartice. Ovo ne može da se poništi.</p>
      </ConfirmDialog>
    </div>
  );
}
