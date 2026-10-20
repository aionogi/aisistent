"use client";

import type { ReactNode, Ref } from "react";
import { AlertCircle, CircleCheck, Info, TriangleAlert } from "lucide-react";
import type { FieldErrors } from "../../lib/workspace/validation";
import styles from "./forms.module.css";

/** DOM id for the control that owns a validation path, e.g. `business.name` → `field-business-name`. */
export function fieldId(path: string): string {
  return `field-${path.replace(/\./g, "-")}`;
}

function describedBy(id: string, hint?: string, error?: string): string | undefined {
  const ids = [hint ? `${id}-hint` : "", error ? `${id}-error` : ""].filter(Boolean);
  return ids.length ? ids.join(" ") : undefined;
}

export function FieldMessage({ id, error }: { id: string; error?: string }) {
  if (!error) return null;
  return <p className={styles.fieldError} id={`${id}-error`}><AlertCircle size={14} aria-hidden="true" />{error}</p>;
}

type TextFieldProps = {
  path: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  hint?: string;
  optional?: boolean;
  maxLength?: number;
  placeholder?: string;
  autoComplete?: string;
  inputMode?: "text" | "url";
  multiline?: boolean;
  rows?: number;
  showCount?: boolean;
};

export function TextField({ path, label, value, onChange, error, hint, optional, maxLength, placeholder, autoComplete = "off", inputMode, multiline, rows = 3, showCount }: TextFieldProps) {
  const id = fieldId(path);
  const shared = {
    id,
    value,
    maxLength,
    placeholder,
    autoComplete,
    "aria-invalid": error ? true : undefined,
    "aria-describedby": describedBy(id, hint, error),
    onChange: (event: { target: { value: string } }) => onChange(event.target.value),
  };

  return (
    <div className={styles.field}>
      <label htmlFor={id} className={styles.label}>
        {label}{optional && <span className={styles.optional}>neobavezno</span>}
      </label>
      {multiline ? <textarea {...shared} rows={rows} /> : <input {...shared} type="text" inputMode={inputMode} />}
      {(hint || (showCount && maxLength)) && (
        <p className={styles.hint} id={hint ? `${id}-hint` : undefined}>
          <span>{hint}</span>
          {showCount && maxLength && <span className={styles.count} aria-hidden="true">{value.length}/{maxLength}</span>}
        </p>
      )}
      <FieldMessage id={id} error={error} />
    </div>
  );
}

/** Lists every blocking problem with links that move focus to the affected control. */
export function ErrorSummary({ errors, title = "Proverite označena polja", ref }: { errors: FieldErrors; title?: string; ref?: Ref<HTMLDivElement> }) {
  const entries = Object.entries(errors);
  if (entries.length === 0) return null;
  return (
    <div className={styles.errorSummary} ref={ref} tabIndex={-1} role="alert" aria-labelledby="error-summary-title">
      <strong id="error-summary-title"><TriangleAlert size={17} aria-hidden="true" />{title}</strong>
      <ul>
        {entries.map(([path, message]) => (
          <li key={path}>
            <a href={`#${fieldId(path)}`} onClick={(event) => {
              const target = document.getElementById(fieldId(path));
              if (!target) return;
              event.preventDefault();
              target.focus();
              target.scrollIntoView({ block: "center" });
            }}>{message}</a>
          </li>
        ))}
      </ul>
    </div>
  );
}

type NoticeTone = "info" | "success" | "warning";

export function Notice({ tone = "info", title, children, action }: { tone?: NoticeTone; title?: string; children: ReactNode; action?: ReactNode }) {
  const Icon = tone === "success" ? CircleCheck : tone === "warning" ? TriangleAlert : Info;
  return (
    <div className={`${styles.notice} ${styles[`notice-${tone}`]}`}>
      <Icon size={18} aria-hidden="true" />
      <div className={styles.noticeBody}>
        {title && <strong>{title}</strong>}
        <div>{children}</div>
      </div>
      {action && <div className={styles.noticeAction}>{action}</div>}
    </div>
  );
}
