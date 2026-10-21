"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BookOpen, Bot, LayoutDashboard, MessageSquare, RotateCcw, UserRound, X, type LucideIcon } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { completedStepCount, EDITABLE_STEP_COUNT, onboardingStartHref } from "../../lib/workspace/steps";
import { INDUSTRY_LABELS } from "../../lib/workspace/templates";
import Brand from "../Brand";
import ConfirmDialog from "./ConfirmDialog";
import { useDraft } from "./DraftProvider";
import { Notice } from "./FormControls";
import { DraftLoading, DraftNotices, SaveIndicator } from "./StatusViews";
import { ROLE_LABELS, useWorkspaceEnvironment, workspacePath } from "./WorkspaceEnvironment";
import styles from "./shell.module.css";

const navigation: Array<{ page: string; label: string; icon: LucideIcon }> = [
  { page: "", label: "Pregled", icon: LayoutDashboard },
  { page: "conversations", label: "Razgovori", icon: MessageSquare },
  { page: "assistant", label: "Asistent", icon: Bot },
  { page: "knowledge", label: "Baza znanja", icon: BookOpen },
];

const normalize = (path: string) => path.replace(/\/+$/, "") || "/";

export default function AppShell({ children }: { children: ReactNode }) {
  const pathname = normalize(usePathname());
  const environment = useWorkspaceEnvironment();
  const isDemo = environment.mode === "demo";
  const { draft, ready, flash, setFlash, resetDraft } = useDraft();
  const [confirmReset, setConfirmReset] = useState(false);
  const businessName = draft.business.name.trim();
  const displayName = isDemo ? businessName : environment.organizationName ?? businessName;
  const completed = completedStepCount(draft);
  const flashPath = useRef(pathname);

  // A confirmation belongs to the page where it appeared; drop it once the user moves on.
  useEffect(() => {
    if (pathname === flashPath.current) return;
    flashPath.current = pathname;
    setFlash(null);
  }, [pathname, setFlash]);

  const subtitle = isDemo
    ? ready && draft.industry ? `${INDUSTRY_LABELS[draft.industry].label} · demo` : "Demo radni prostor"
    : [environment.role ? ROLE_LABELS[environment.role] : null, draft.industry ? INDUSTRY_LABELS[draft.industry].label : null].filter(Boolean).join(" · ");

  return (
    <div className={styles.shell}>
      <a className="skip-link" href="#workspace-main">Pređi na sadržaj</a>
      <aside className={styles.sidebar}>
        <div className={styles.sidebarTop}>
          <Link href="/" className={styles.brandLink} aria-label="aisistent početna"><Brand /></Link>
          {isDemo
            ? <button type="button" className={styles.resetIcon} onClick={() => setConfirmReset(true)} aria-label="Obriši nacrt i počni ispočetka" disabled={!ready}><RotateCcw size={17} aria-hidden="true" /></button>
            : <SaveIndicator className={styles.saveCompact} />}
        </div>
        <div className={styles.workspaceCard}>
          <span className={styles.workspaceIcon} aria-hidden="true">{(displayName || "a").charAt(0).toUpperCase()}</span>
          <div>
            <strong>{ready ? displayName || "Novi radni prostor" : "Radni prostor"}</strong>
            <span>{subtitle}</span>
          </div>
        </div>

        <nav className={styles.navigation} aria-label="Radni prostor">
          {navigation.map(({ page, label, icon: Icon }) => {
            const href = workspacePath(environment, page);
            const active = normalize(href) === pathname;
            return (
              <Link key={page || "overview"} href={href} className={active ? styles.activeLink : undefined} aria-current={active ? "page" : undefined}>
                <Icon size={17} aria-hidden="true" /><span>{label}</span>
              </Link>
            );
          })}
        </nav>

        {ready && !draft.onboardingCompleted && (
          <Link href={onboardingStartHref(environment.onboardingBasePath)} className={styles.setupCard}>
            <span className={styles.setupTitle}>Podešavanje asistenta</span>
            <span className={styles.setupMeta}>{completed} od {EDITABLE_STEP_COUNT} koraka</span>
            <span className={styles.setupBar} aria-hidden="true"><span style={{ width: `${(completed / EDITABLE_STEP_COUNT) * 100}%` }} /></span>
            <span className={styles.setupAction}>{completed ? "Nastavi podešavanje" : "Započni podešavanje"}</span>
          </Link>
        )}

        <div className={styles.sidebarBottom}>
          {isDemo ? (
            <>
              <p>Primer podataka. Nacrt se čuva samo u ovoj kartici pregledača.</p>
              <button type="button" className={styles.resetButton} onClick={() => setConfirmReset(true)} disabled={!ready}><RotateCcw size={14} aria-hidden="true" />Obriši nacrt</button>
            </>
          ) : (
            <>
              <SaveIndicator />
              <p>Izmene se automatski čuvaju za vašu firmu.</p>
              <a href="/account/" className={styles.resetButton}><UserRound size={14} aria-hidden="true" />Nalog i firme</a>
            </>
          )}
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
          {isDemo
            ? "Demo radni prostor bez prijave. Prikazani razgovori i brojke su izmišljeni primeri; nema stvarnih poziva, AI modela ni naplate."
            : "Test okruženje. Podešavanje i baza znanja su podaci vaše firme; razgovori i brojke su i dalje primeri. Asistent nije povezan sa telefonom."}
        </footer>
      </div>

      {isDemo && (
        <ConfirmDialog
          open={confirmReset}
          title="Obrisati ceo nacrt?"
          confirmLabel="Obriši nacrt"
          onClose={() => setConfirmReset(false)}
          onConfirm={() => { resetDraft(); setFlash("Nacrt je obrisan. Možete započeti novo podešavanje."); }}
        >
          <p>Uklanjaju se delatnost, podaci o poslu, radno vreme, ponašanje asistenta i baza znanja iz ove kartice. Ovo ne može da se poništi.</p>
        </ConfirmDialog>
      )}
    </div>
  );
}
