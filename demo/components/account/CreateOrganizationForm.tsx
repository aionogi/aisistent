"use client";

import { Plus } from "lucide-react";
import { useActionState } from "react";
import { createOrganizationAction, type CreateOrganizationState } from "../../app/(platform)/account/actions.ts";
import { FieldMessage } from "../workspace/FormControls";
import forms from "../workspace/forms.module.css";
import styles from "./account.module.css";

const initialState: CreateOrganizationState = { error: null, name: "" };

export default function CreateOrganizationForm({ disabled }: { disabled?: boolean }) {
  const [state, formAction, pending] = useActionState(createOrganizationAction, initialState);
  const id = "organization-name";
  return (
    <form action={formAction} className={forms.formStack} noValidate>
      <div className={forms.field}>
        <label htmlFor={id} className={forms.label}>Naziv firme</label>
        <input id={id} name="name" defaultValue={state.name} required minLength={2} maxLength={60} autoComplete="organization" placeholder="Npr. Studio Mila" disabled={disabled || pending}
          aria-invalid={state.error ? true : undefined} aria-describedby={state.error ? `${id}-error` : undefined} />
        <FieldMessage id={id} error={state.error ?? undefined} />
      </div>
      <button type="submit" className={`${forms.primaryButton} ${styles.submit}`} disabled={disabled || pending}>
        <Plus size={15} aria-hidden="true" />{pending ? "Pravim firmu…" : "Napravi firmu"}
      </button>
    </form>
  );
}
