"use client";

import { CircleAlert, CircleCheck, LoaderCircle } from "lucide-react";
import { formatUpdatedAt } from "../../lib/workspace/format";
import { useDraft } from "./DraftProvider";
import { Notice } from "./FormControls";
import { useWorkspaceEnvironment } from "./WorkspaceEnvironment";
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
  const { storageMode, loadNotice, dismissLoadNotice, saveState, readOnly } = useDraft();
  const { stepUpPath } = useWorkspaceEnvironment();
  return (
    <>
      {readOnly && stepUpPath && (
        <Notice tone="warning" title="Potvrdite prijavu za izmene" action={<a href={stepUpPath}>Dvofaktorska potvrda</a>}>
          Možete da pregledate podatke firme. Za izmene je potrebna prijava sa dvofaktorskom potvrdom.
        </Notice>
      )}
      {readOnly && !stepUpPath && (
        <Notice tone="info" title="Samo pregled">
          Kao član firme možete da pregledate podešavanje. Izmene prave vlasnik i administratori.
        </Notice>
      )}
      {saveState.status === "conflict" && (
        <Notice tone="warning" title="Neko je u međuvremenu izmenio podešavanje" action={<button type="button" onClick={() => window.location.reload()}>Osveži</button>}>
          Vaše poslednje izmene nisu sačuvane, da ne bi zamenile tuđe. Osvežite stranicu da biste videli trenutno stanje.
        </Notice>
      )}
      {saveState.status === "signed-out" && (
        <Notice tone="warning" title="Sesija je istekla" action={<a href="/account/">Prijava</a>}>
          Prijavite se ponovo. Izmene posle isteka sesije nisu sačuvane.
        </Notice>
      )}
      {saveState.status === "forbidden" && (
        <Notice tone="warning" title="Nemate pravo izmene">
          Izmene nisu sačuvane. Možda vam je promenjena uloga ili ste uklonjeni iz firme.
        </Notice>
      )}
      {saveState.status === "invalid" && (
        <Notice tone="warning" title="Izmena nije sačuvana">{saveState.message ?? "Proverite unete podatke."}</Notice>
      )}
      {saveState.status === "error" && (
        <Notice tone="warning" title="Čuvanje nije uspelo">
          Proverite vezu. Pokušaćemo ponovo pri sledećoj izmeni.
        </Notice>
      )}
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

/** Save progress for organization data; renders nothing in the demo. */
export function SaveIndicator({ className }: { className?: string }) {
  const { storageMode, saveState } = useDraft();
  if (storageMode !== "server") return null;
  const failed = ["error", "conflict", "forbidden", "signed-out", "invalid"].includes(saveState.status);
  const label = saveState.status === "saving" ? "Čuvanje…"
    : failed ? "Nije sačuvano"
      : saveState.savedAt ? formatUpdatedAt(saveState.savedAt).replace("Poslednja izmena", "Sačuvano") : "Sve je sačuvano";
  const Icon = saveState.status === "saving" ? LoaderCircle : failed ? CircleAlert : CircleCheck;
  return (
    <span className={`${styles.saveIndicator} ${failed ? styles.saveFailed : ""} ${className ?? ""}`} role="status">
      <Icon size={14} className={saveState.status === "saving" ? styles.spinner : undefined} aria-hidden="true" />{label}
    </span>
  );
}
