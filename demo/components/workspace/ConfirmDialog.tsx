"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import styles from "./forms.module.css";

type ConfirmDialogProps = {
  open: boolean;
  title: string;
  children: ReactNode;
  confirmLabel: string;
  onConfirm: () => void;
  onClose: () => void;
};

/** Native modal dialog: the browser traps focus, handles Escape, and restores focus on close. */
export default function ConfirmDialog({ open, title, children, confirmLabel, onConfirm, onClose }: ConfirmDialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog ref={ref} className={styles.dialog} aria-labelledby={titleId} onClose={onClose} onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className={styles.dialogBody}>
        <h2 id={titleId}>{title}</h2>
        <div className={styles.dialogText}>{children}</div>
        <div className={styles.inlineActions}>
          <button type="button" className={styles.secondaryButton} onClick={onClose} autoFocus>Otkaži</button>
          <button type="button" className={styles.dangerButton} onClick={() => { onConfirm(); onClose(); }}>{confirmLabel}</button>
        </div>
      </div>
    </dialog>
  );
}
