"use client";

import { Check } from "lucide-react";
import { useActionState } from "react";
import type { AcceptState } from "../../app/(platform)/invite/[token]/actions";
import { Notice } from "../workspace/FormControls";
import forms from "../workspace/forms.module.css";
import styles from "./account.module.css";

export default function AcceptInvitationForm({ action }: { action: (previous: AcceptState) => Promise<AcceptState> }) {
  const [state, formAction, pending] = useActionState(action, { error: null });
  return (
    <form action={formAction} className={forms.formStack}>
      {state.error && <div role="alert"><Notice tone="warning">{state.error}</Notice></div>}
      <button type="submit" className={`${forms.primaryButton} ${styles.submit}`} disabled={pending}>
        <Check size={16} aria-hidden="true" />{pending ? "Prihvatam…" : "Prihvati poziv"}
      </button>
    </form>
  );
}
