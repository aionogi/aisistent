"use client";

import { LoaderCircle } from "lucide-react";
import { useDraft } from "./DraftProvider";
import { Notice } from "./FormControls";
import styles from "./pages.module.css";

/** Shown while the draft is read from this tab's storage after hydration. */
export function DraftLoading({ label = "Učitavanje nacrta…" }: { label?: string }) {
  return (
    <div className={styles.loading} role="status" aria-live="polite">
      <span className={styles.loadingRow}><LoaderCircle size={20} className={styles.spinner} aria-hidden="true" />{label}</span>
      <div className={styles.skeleton} aria-hidden="true"><i /><i /><i /></div>
    </div>
  );
}

/** Storage problems that change what the user can expect from the draft. */
export function DraftNotices() {
  const { storageMode, loadNotice, dismissLoadNotice } = useDraft();
  return (
    <>
      {storageMode === "memory" && (
        <Notice tone="warning" title="Nacrt se ne može sačuvati u ovoj kartici">
          Pregledač blokira privremeno skladište. Izmene ostaju dok ne osvežite ili zatvorite stranicu.
        </Notice>
      )}
      {loadNotice === "discarded" && (
        <Notice tone="warning" title="Prethodni nacrt nije mogao da se učita" action={<button type="button" onClick={dismissLoadNotice}>U redu</button>}>
          Sačuvani podaci nisu bili u očekivanom obliku, pa su uklonjeni. Počinjete od praznog nacrta.
        </Notice>
      )}
    </>
  );
}
