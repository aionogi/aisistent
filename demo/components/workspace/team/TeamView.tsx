"use client";

import { Check, Copy, Send, Trash2, UserMinus, Users } from "lucide-react";
import { useActionState, useState, useTransition } from "react";
import type { InviteState, TeamActionResult } from "../../../app/(platform)/org/[organizationId]/(shell)/team/actions";
import type { MemberRole } from "../../../lib/db/context";
import ConfirmDialog from "../ConfirmDialog";
import { FieldMessage, Notice } from "../FormControls";
import { PageHeader } from "../PageParts";
import { ROLE_LABELS } from "../WorkspaceEnvironment";
import forms from "../forms.module.css";
import styles from "./team.module.css";

type MemberRow = { userId: string; displayName: string | null; email: string | null; role: MemberRole; joinedAt: string };
type InvitationRow = { id: string; email: string; role: "admin" | "member"; expiresAt: string; status: "pending" | "accepted" | "revoked" | "expired" };

type TeamActions = {
  invite: (previous: InviteState, formData: FormData) => Promise<InviteState>;
  revoke: (invitationId: string) => Promise<TeamActionResult>;
  changeRole: (userId: string, role: MemberRole) => Promise<TeamActionResult>;
  remove: (userId: string) => Promise<TeamActionResult>;
};

const STATUS_LABELS: Record<InvitationRow["status"], string> = { pending: "Čeka prihvatanje", accepted: "Prihvaćen", revoked: "Opozvan", expired: "Istekao" };
/** Serbian count form: 1 osoba, 2–4 osobe, 5+ osoba (with 12–14 osoba). */
function peopleLabel(count: number): string {
  const lastDigit = count % 10;
  const lastTwo = count % 100;
  return `${count} ${lastDigit >= 2 && lastDigit <= 4 && (lastTwo < 12 || lastTwo > 14) ? "osobe" : "osoba"}`;
}

const dateFormat = new Intl.DateTimeFormat("sr-Latn-RS", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });

function InviteForm({ invite }: { invite: TeamActions["invite"] }) {
  const [state, formAction, pending] = useActionState(invite, { error: null, invitation: null });
  const [copied, setCopied] = useState(false);
  const link = state.invitation ? `${typeof window === "undefined" ? "" : window.location.origin}${state.invitation.path}` : "";

  async function copy() {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <section className={styles.panel} aria-labelledby="invite-title">
      <h2 id="invite-title">Pozovite člana</h2>
      <p className={styles.lead}>Napravićemo link za poziv. Pošaljite ga osobi; može ga iskoristiti samo nalog sa potvrđenom adresom na koju glasi poziv.</p>
      <form action={formAction} className={styles.inviteForm} noValidate>
        <div className={forms.field}>
          <label htmlFor="invite-email" className={forms.label}>Email adresa</label>
          <input id="invite-email" name="email" type="email" autoComplete="off" required maxLength={320} placeholder="ime@firma.rs" disabled={pending}
            aria-invalid={state.error ? true : undefined} aria-describedby={state.error ? "invite-email-error" : undefined} />
          <FieldMessage id="invite-email" error={state.error ?? undefined} />
        </div>
        <div className={forms.field}>
          <label htmlFor="invite-role" className={forms.label}>Uloga</label>
          <select id="invite-role" name="role" defaultValue="member" disabled={pending} className={styles.select}>
            <option value="member">Član (pregled)</option>
            <option value="admin">Administrator (izmene)</option>
          </select>
        </div>
        <button type="submit" className={`${forms.primaryButton} ${styles.submit}`} disabled={pending}><Send size={15} aria-hidden="true" />{pending ? "Pravim poziv…" : "Napravi poziv"}</button>
      </form>
      {state.invitation && (
        <div role="status">
          <Notice tone="success" title={`Poziv za ${state.invitation.email}`} action={<button type="button" onClick={copy}>{copied ? <Check size={15} aria-hidden="true" /> : <Copy size={15} aria-hidden="true" />}{copied ? "Kopirano" : "Kopiraj link"}</button>}>
            <span className={styles.link}>{link}</span>
            Link važi do {dateFormat.format(new Date(state.invitation.expiresAt))} i prikazuje se samo sada. Slanje emaila još nije povezano.
          </Notice>
        </div>
      )}
    </section>
  );
}

export default function TeamView({ currentUserId, role, members, invitations, actions }: {
  currentUserId: string;
  role: MemberRole;
  members: MemberRow[];
  invitations: InvitationRow[];
  actions: TeamActions;
}) {
  const isOwner = role === "owner";
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [removing, setRemoving] = useState<MemberRow | null>(null);

  function run(work: () => Promise<TeamActionResult>) {
    setMessage(null);
    startTransition(async () => {
      const result = await work();
      if (result.error) setMessage(result.error);
    });
  }

  const name = (member: MemberRow) => member.displayName ?? member.email ?? "Korisnik";

  return (
    <>
      <PageHeader title="Tim" badge="Podaci firme" description="Ko ima pristup radnom prostoru firme i sa kojom ulogom. Vlasnici pozivaju članove i menjaju uloge." />
      {message && <div role="alert"><Notice tone="warning">{message}</Notice></div>}
      {!isOwner && <Notice tone="info">Članove poziva i uloge menja vlasnik firme.</Notice>}

      <section className={styles.panel} aria-labelledby="members-title">
        <div className={styles.panelHeading}>
          <h2 id="members-title"><Users size={17} aria-hidden="true" />Članovi</h2>
          <span>{peopleLabel(members.length)}</span>
        </div>
        <ul className={styles.list}>
          {members.map((member) => (
            <li key={member.userId} className={styles.row}>
              <span className={styles.avatar} aria-hidden="true">{name(member).charAt(0).toUpperCase()}</span>
              <span className={styles.person}>
                <strong>{name(member)}{member.userId === currentUserId ? " (vi)" : ""}</strong>
                {member.email && <span>{member.email}</span>}
              </span>
              {isOwner ? (
                <span className={styles.controls}>
                  <label className="visually-hidden" htmlFor={`role-${member.userId}`}>Uloga za {name(member)}</label>
                  <select id={`role-${member.userId}`} className={styles.select} value={member.role} disabled={pending}
                    onChange={(event) => run(() => actions.changeRole(member.userId, event.target.value as MemberRole))}>
                    <option value="owner">{ROLE_LABELS.owner}</option>
                    <option value="admin">{ROLE_LABELS.admin}</option>
                    <option value="member">{ROLE_LABELS.member}</option>
                  </select>
                  {member.userId !== currentUserId && (
                    <button type="button" className={styles.iconButton} disabled={pending} onClick={() => setRemoving(member)} aria-label={`Ukloni ${name(member)} iz firme`}>
                      <UserMinus size={16} aria-hidden="true" />
                    </button>
                  )}
                </span>
              ) : (
                <span className={styles.roleChip}>{ROLE_LABELS[member.role]}</span>
              )}
            </li>
          ))}
        </ul>
        <p className={styles.note}>Vlasnik: tim i sve izmene. Administrator: podešavanje i baza znanja. Član: samo pregled.</p>
      </section>

      {isOwner && <InviteForm invite={actions.invite} />}

      {isOwner && invitations.length > 0 && (
        <section className={styles.panel} aria-labelledby="invitations-title">
          <div className={styles.panelHeading}><h2 id="invitations-title">Pozivi</h2></div>
          <ul className={styles.list}>
            {invitations.map((invitation) => (
              <li key={invitation.id} className={styles.row}>
                <span className={styles.person}>
                  <strong>{invitation.email}</strong>
                  <span>{ROLE_LABELS[invitation.role]} · {invitation.status === "pending" ? `važi do ${dateFormat.format(new Date(invitation.expiresAt))}` : STATUS_LABELS[invitation.status]}</span>
                </span>
                {invitation.status === "pending" && (
                  <button type="button" className={styles.textButton} disabled={pending} onClick={() => run(() => actions.revoke(invitation.id))}>
                    <Trash2 size={15} aria-hidden="true" />Opozovi
                  </button>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      <ConfirmDialog
        open={removing !== null}
        title="Ukloniti člana iz firme?"
        confirmLabel="Ukloni"
        onClose={() => setRemoving(null)}
        onConfirm={() => { const member = removing; if (member) run(() => actions.remove(member.userId)); }}
      >
        <p>{removing ? name(removing) : ""} više neće imati pristup radnom prostoru firme, od sledećeg otvaranja stranice.</p>
      </ConfirmDialog>
    </>
  );
}
