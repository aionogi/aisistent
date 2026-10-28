"use client";

import Link from "next/link";
import { MessageSquare, Phone, Search, SearchX, Trash2 } from "lucide-react";
import { useState, useTransition } from "react";
import type { ConversationActionResult } from "../../../app/(platform)/org/[organizationId]/(shell)/conversations/actions";
import type { ConversationOutcome, ConversationSpeaker } from "../../../lib/db/conversations";
import ConfirmDialog from "../ConfirmDialog";
import { useDraft } from "../DraftProvider";
import { Notice } from "../FormControls";
import { EmptyState, PageHeader } from "../PageParts";
import styles from "../pages.module.css";

export type ConversationRow = {
  id: string;
  channel: "call" | "message";
  outcome: ConversationOutcome;
  customerName: string | null;
  customerContact: string | null;
  summary: string | null;
  startedAt: string;
  endedAt: string | null;
};

const OUTCOMES: Record<ConversationOutcome, { label: string; pending: boolean }> = {
  booked: { label: "Zakazan termin", pending: false },
  answered: { label: "Odgovoreno", pending: false },
  handoff: { label: "Za vaš tim", pending: true },
  unanswered: { label: "Bez odgovora", pending: true },
};

// The same zone as the server render, so times do not change on hydration.
const timeFormat = new Intl.DateTimeFormat("sr-Latn-RS", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Belgrade" });

const displayName = (row: ConversationRow) => row.customerName ?? row.customerContact ?? "Nepoznat klijent";
// Letters only, so a phone number shown in place of a name gives "?" rather than "+6".
const initials = (name: string) => name.split(/\s+/).filter((part) => /^\p{L}/u.test(part)).slice(0, 2).map((part) => part[0]!.toUpperCase()).join("") || "?";
function duration(row: ConversationRow): string | null {
  if (!row.endedAt) return null;
  const seconds = Math.max(0, Math.round((Date.parse(row.endedAt) - Date.parse(row.startedAt)) / 1000));
  return seconds < 60 ? `${seconds} s` : `${Math.round(seconds / 60)} min`;
}

/** Conversations the assistant recorded for this organization, with transcripts and deletion for owners and admins. */
export default function StoredConversationsView({ conversations, selectedId, messages, retentionDays, basePath, canDelete, remove }: {
  conversations: ConversationRow[];
  selectedId: string;
  messages: Array<{ speaker: ConversationSpeaker; body: string }>;
  retentionDays: number;
  basePath: string;
  canDelete: boolean;
  remove: (conversationId: string) => Promise<ConversationActionResult>;
}) {
  const { draft } = useDraft();
  const [query, setQuery] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleting, startDeleting] = useTransition();

  const normalized = query.trim().toLocaleLowerCase("sr-Latn");
  const visible = conversations.filter((row) => !normalized || `${displayName(row)} ${row.summary ?? ""}`.toLocaleLowerCase("sr-Latn").includes(normalized));
  const selected = conversations.find((row) => row.id === selectedId);
  const assistantName = draft.assistant.name.trim() || "Asistent";

  function deleteSelected() {
    if (!selected) return;
    setError(null);
    startDeleting(async () => {
      const result = await remove(selected.id);
      if (result.error) setError(result.error);
    });
  }

  return (
    <>
      <PageHeader title="Razgovori" badge="Podaci firme" description={`Razgovori koje je asistent sačuvao za vašu firmu. Čuvaju se ${retentionDays} dana, zatim se brišu.`} />

      <div className={styles.toolbar}>
        <div className={styles.searchField}>
          <Search size={16} aria-hidden="true" />
          <label htmlFor="conversation-search" className="visually-hidden">Pretraži razgovore</label>
          <input id="conversation-search" type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Pretraži po imenu ili sažetku" autoComplete="off" />
        </div>
        <span className={styles.toolbarMeta}>{conversations.length === 1 ? "1 razgovor" : `Razgovora: ${conversations.length}`}</span>
      </div>

      {visible.length === 0 ? (
        <EmptyState icon={SearchX} title="Nema razgovora za ovu pretragu" actions={<button type="button" className={styles.secondaryAction} onClick={() => setQuery("")}>Poništi pretragu</button>}>
          Pokušajte sa drugim imenom ili rečju iz sažetka.
        </EmptyState>
      ) : (
        <div className={styles.conversationLayout}>
          <ul className={styles.conversationList} aria-label="Sačuvani razgovori">
            {visible.map((row) => {
              const active = row.id === selected?.id;
              const outcome = OUTCOMES[row.outcome];
              return (
                <li key={row.id}>
                  <Link href={`${basePath}?c=${row.id}`} scroll={false} className={`${styles.conversationRow} ${active ? styles.selectedRow : ""}`} aria-current={active ? "true" : undefined}>
                    <span className={styles.initials} aria-hidden="true">{initials(displayName(row))}</span>
                    <span className={styles.compactPerson}>
                      <strong>{displayName(row)}</strong>
                      <span>{row.channel === "call" ? <Phone size={12} aria-hidden="true" /> : <MessageSquare size={12} aria-hidden="true" />}{row.channel === "call" ? "Poziv" : "Poruka"}{duration(row) ? ` · ${duration(row)}` : ""}</span>
                    </span>
                    <span className={styles.rowMeta}>
                      <span className={`${styles.chip} ${outcome.pending ? styles.chipPending : ""}`}>{outcome.label}</span>
                      <span className={styles.time}>{timeFormat.format(new Date(row.startedAt))}</span>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>

          {selected && (
            <section id="conversation-detail" className={styles.conversationDetail} aria-labelledby="conversation-detail-title">
              <div className={styles.detailHeader}>
                <div>
                  <h2 id="conversation-detail-title">{displayName(selected)}</h2>
                  <span>{selected.channel === "call" ? "Poziv" : "Poruka"} · {timeFormat.format(new Date(selected.startedAt))}{duration(selected) ? ` · ${duration(selected)}` : ""}{selected.customerContact && selected.customerName ? ` · ${selected.customerContact}` : ""}</span>
                </div>
                <span className={`${styles.chip} ${OUTCOMES[selected.outcome].pending ? styles.chipPending : ""}`}>{OUTCOMES[selected.outcome].label}</span>
              </div>
              {selected.summary && (
                <div className={styles.summaryBox}>
                  <strong>Sažetak</strong>
                  <p>{selected.summary}</p>
                </div>
              )}
              {messages.length > 0 ? (
                <ol className={styles.transcript} aria-label="Tok razgovora">
                  {messages.map((message, index) => (
                    <li key={index} className={`${styles.bubble} ${message.speaker === "customer" ? styles.callerBubble : styles.assistantBubble}`}>
                      <span className={styles.bubbleSpeaker}>{message.speaker === "assistant" ? assistantName : message.speaker === "team" ? "Vaš tim" : displayName(selected)}</span>
                      <p>{message.body}</p>
                    </li>
                  ))}
                </ol>
              ) : <p className={styles.previewNote}>Za ovaj razgovor nije sačuvan zapis toka.</p>}
              {error && <div role="alert"><Notice tone="warning">{error}</Notice></div>}
              {canDelete && (
                <div className={styles.inlineButtons}>
                  <button type="button" className={styles.secondaryAction} onClick={() => setConfirmDelete(true)} disabled={deleting}>
                    <Trash2 size={15} aria-hidden="true" />{deleting ? "Brisanje…" : "Obriši razgovor"}
                  </button>
                </div>
              )}
            </section>
          )}
        </div>
      )}

      {canDelete && (
        <ConfirmDialog open={confirmDelete} title="Obrisati razgovor?" confirmLabel="Obriši razgovor" onClose={() => setConfirmDelete(false)} onConfirm={deleteSelected}>
          <p>Razgovor sa „{selected ? displayName(selected) : ""}“ i njegov zapis biće trajno obrisani.</p>
        </ConfirmDialog>
      )}
    </>
  );
}
