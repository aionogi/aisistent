"use client";

import { LogOut } from "lucide-react";
import { useActionState, useEffect } from "react";
import type { SignOutEverywhereState } from "../../app/(platform)/account/actions";
import { Notice } from "../workspace/FormControls";
import styles from "./account.module.css";

/** After the server ends every session, a full navigation to /auth/logout signs this browser out at the provider too. */
export default function SignOutEverywhereForm({ action }: { action: (previous: SignOutEverywhereState) => Promise<SignOutEverywhereState> }) {
  const [state, formAction, pending] = useActionState(action, { error: null, done: false });
  useEffect(() => {
    if (state.done) window.location.assign("/auth/logout");
  }, [state.done]);
  return (
    <form action={formAction} className={styles.sessionForm}>
      {state.error && <div role="alert"><Notice tone="warning">{state.error}</Notice></div>}
      <button type="submit" className={styles.textLink} disabled={pending || state.done}>
        <LogOut size={15} aria-hidden="true" />{pending || state.done ? "Odjavljujem…" : "Odjavi me sa svih uređaja"}
      </button>
    </form>
  );
}
