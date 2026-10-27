"use client";

import { Download, LogOut, Trash2 } from "lucide-react";
import { useActionState, useState, useTransition } from "react";
import type { OrganizationActionResult } from "../../../app/(platform)/org/[organizationId]/(shell)/settings/actions";
import type { MemberRole } from "../../../lib/db/context";
import ConfirmDialog from "../ConfirmDialog";
import { Notice } from "../FormControls";
import { PageHeader } from "../PageParts";
import forms from "../forms.module.css";
import styles from "./team.module.css";

type OrganizationActions = {
  leave: () => Promise<OrganizationActionResult>;
  remove: (previous: OrganizationActionResult, formData: FormData) => Promise<OrganizationActionResult>;
};

function DeleteForm({ organizationName, remove }: { organizationName: string; remove: OrganizationActions["remove"] }) {
  const [state, formAction, pending] = useActionState(remove, { error: null });
  const [typed, setTyped] = useState("");
  const matches = typed.trim() !== "" && typed.trim() === organizationName.trim();
  return (
    <form action={formAction} className={styles.deleteForm}>
      {state.error && <div role="alert"><Notice tone="warning">{state.error}</Notice></div>}
      <div className={forms.field}>
        <label htmlFor="confirm-name" className={forms.label}>Za potvrdu upišite naziv firme: {organizationName}</label>
        <input id="confirm-name" name="confirmName" autoComplete="off" spellCheck={false} maxLength={200} value={typed} onChange={(event) => setTyped(event.target.value)} disabled={pending} />
      </div>
      <button type="submit" className={forms.dangerButton} disabled={!matches || pending}>
        <Trash2 size={15} aria-hidden="true" />{pending ? "Brisanje…" : "Trajno obriši firmu"}
      </button>
    </form>
  );
}

/** Export, leaving, and deletion for the current organization. The server re-checks every rule. */
export default function OrganizationView({ organizationName, role, canManageData, lastOwner, exportHref, actions }: {
  organizationName: string;
  role: MemberRole;
  /** Owner, with MFA when required: may export and delete. */
  canManageData: boolean;
  /** The only owner cannot leave. */
  lastOwner: boolean;
  exportHref: string;
  actions: OrganizationActions;
}) {
  const isOwner = role === "owner";
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [leaveError, setLeaveError] = useState<string | null>(null);
  const [leaving, startLeaving] = useTransition();

  function leave() {
    setLeaveError(null);
    startLeaving(async () => {
      const result = await actions.leave();
      if (result.error) setLeaveError(result.error);
    });
  }

  return (
    <>
      <PageHeader title="Firma" badge="Podaci firme" description={`Podaci firme „${organizationName}“ i vaše članstvo u njoj.`} />

      <section className={styles.panel} aria-labelledby="export-title">
        <h2 id="export-title"><Download size={17} aria-hidden="true" />Izvoz podataka</h2>
        <p className={styles.lead}>Jedan JSON fajl sa svim podacima firme: naziv, članovi sa email adresama, pozivi, podešavanje asistenta, baza znanja i aktivnost. Fajl sadrži lične podatke članova, pa ga čuvajte bezbedno.</p>
        {canManageData
          ? <a href={exportHref} download className={forms.secondaryButton}><Download size={15} aria-hidden="true" />Preuzmi podatke (JSON)</a>
          : <p className={styles.note}>{isOwner ? "Izvoz je dostupan posle dvofaktorske potvrde prijave." : "Podatke firme preuzima vlasnik."}</p>}
      </section>

      <section className={styles.panel} aria-labelledby="leave-title">
        <h2 id="leave-title"><LogOut size={17} aria-hidden="true" />Napuštanje firme</h2>
        <p className={styles.lead}>Gubite pristup ovoj firmi. Vaš nalog i druge firme ostaju, a vlasnik vas kasnije može ponovo pozvati.</p>
        {leaveError && <div role="alert"><Notice tone="warning">{leaveError}</Notice></div>}
        {lastOwner
          ? <p className={styles.note}>Vi ste jedini vlasnik, pa ne možete da napustite firmu. Prvo na stranici Tim postavite drugog vlasnika ili obrišite firmu.</p>
          : <button type="button" className={`${styles.textButton} ${styles.startAligned}`} onClick={() => setConfirmLeave(true)} disabled={leaving}><LogOut size={15} aria-hidden="true" />{leaving ? "Napuštam…" : "Napusti firmu"}</button>}
      </section>

      {isOwner && (
        <section className={`${styles.panel} ${styles.dangerPanel}`} aria-labelledby="delete-title">
          <h2 id="delete-title"><Trash2 size={17} aria-hidden="true" />Brisanje firme</h2>
          <p className={styles.lead}>Trajno briše firmu za sve članove: podešavanje asistenta, bazu znanja, pozive, članstva i aktivnost. Ovo ne može da se poništi, pa podatke koji vam trebaju prvo preuzmite.</p>
          {canManageData
            ? <DeleteForm organizationName={organizationName} remove={actions.remove} />
            : <p className={styles.note}>Brisanje je dostupno posle dvofaktorske potvrde prijave.</p>}
        </section>
      )}

      <ConfirmDialog open={confirmLeave} title="Napustiti firmu?" confirmLabel="Napusti firmu" onClose={() => setConfirmLeave(false)} onConfirm={leave}>
        <p>Više nećete imati pristup firmi „{organizationName}“. Za povratak vam treba novi poziv.</p>
      </ConfirmDialog>
    </>
  );
}
