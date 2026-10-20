"use client";

import Link from "next/link";
import { ArrowRight, MessageSquare, MessagesSquare, Phone, Search, SearchX } from "lucide-react";
import { useState } from "react";
import { buildExampleConversations, type ConversationStatus } from "../../../lib/workspace/conversations";
import { useDraft } from "../DraftProvider";
import { EmptyState, PageHeader } from "../PageParts";
import styles from "../pages.module.css";

type Filter = "all" | ConversationStatus;

const filters: Array<{ id: Filter; label: string }> = [
  { id: "all", label: "Svi" },
  { id: "resolved", label: "Rešeni" },
  { id: "team", label: "Za vaš tim" },
];

export default function ConversationsView() {
  const { draft } = useDraft();
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  if (!draft.onboardingCompleted) {
    return (
      <>
        <PageHeader title="Razgovori" />
        <EmptyState icon={MessagesSquare} title="Još nema primera razgovora" actions={<Link href="/onboarding/" className={styles.primaryLink}>Podesi asistenta<ArrowRight size={16} aria-hidden="true" /></Link>}>
          Primeri razgovora se sastavljaju iz vaših podešavanja. Završite podešavanje da biste videli kako bi asistent odgovarao vašim klijentima.
        </EmptyState>
      </>
    );
  }

  const conversations = buildExampleConversations(draft);
  const normalizedQuery = query.trim().toLocaleLowerCase("sr-Latn");
  const visible = conversations.filter((conversation) =>
    (filter === "all" || conversation.status === filter)
    && (!normalizedQuery || [conversation.name, conversation.summary, ...conversation.messages.map((message) => message.text)].some((text) => text.toLocaleLowerCase("sr-Latn").includes(normalizedQuery))));
  const selected = visible.find((conversation) => conversation.id === selectedId) ?? visible[0];

  function select(id: string) {
    setSelectedId(id);
    // On narrow screens the detail sits below the list; bring it into view.
    if (window.matchMedia("(max-width: 860px)").matches) {
      window.setTimeout(() => document.getElementById("conversation-detail")?.scrollIntoView({ block: "start" }), 0);
    }
  }

  return (
    <>
      <PageHeader title="Razgovori" badge="Primeri iz podešavanja" description="Izmišljeni klijenti, sa odgovorima sastavljenim iz vaših usluga, radnog vremena i baze znanja." />

      <div className={styles.toolbar}>
        <div className={styles.searchField}>
          <Search size={16} aria-hidden="true" />
          <label htmlFor="conversation-search" className="visually-hidden">Pretraži razgovore</label>
          <input id="conversation-search" type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Pretraži po imenu ili tekstu" autoComplete="off" />
        </div>
        <div className={styles.segmented} role="group" aria-label="Filtriraj razgovore">
          {filters.map((item) => {
            const count = conversations.filter((conversation) => item.id === "all" || conversation.status === item.id).length;
            return (
              <button key={item.id} type="button" aria-pressed={filter === item.id} onClick={() => setFilter(item.id)}>
                {item.label}<span className={styles.count}>{count}</span>
              </button>
            );
          })}
        </div>
      </div>
      <p className="visually-hidden" role="status">{visible.length === 1 ? "Prikazan je 1 razgovor." : `Prikazano razgovora: ${visible.length}.`}</p>

      {visible.length === 0 || !selected ? (
        <EmptyState icon={SearchX} title="Nema razgovora za ovu pretragu" actions={<button type="button" className={styles.secondaryAction} onClick={() => { setQuery(""); setFilter("all"); }}>Poništi pretragu i filtere</button>}>
          Pokušajte sa drugim imenom ili izaberite filter „Svi“.
        </EmptyState>
      ) : (
        <div className={styles.conversationLayout}>
          <ul className={styles.conversationList} aria-label="Primeri razgovora">
            {visible.map((conversation) => {
              const active = conversation.id === selected.id;
              return (
                <li key={conversation.id}>
                  <button type="button" className={`${styles.conversationRow} ${active ? styles.selectedRow : ""}`} aria-pressed={active} aria-controls="conversation-detail" onClick={() => select(conversation.id)}>
                    <span className={styles.initials} aria-hidden="true">{conversation.initials}</span>
                    <span className={styles.compactPerson}>
                      <strong>{conversation.name}</strong>
                      <span>{conversation.channel === "call" ? <Phone size={12} aria-hidden="true" /> : <MessageSquare size={12} aria-hidden="true" />}{conversation.channel === "call" ? "Poziv" : "Poruka"} · {conversation.length}</span>
                    </span>
                    <span className={styles.rowMeta}>
                      <span className={`${styles.chip} ${conversation.status === "team" ? styles.chipPending : ""}`}>{conversation.outcome}</span>
                      <span className={styles.time}>{conversation.time}</span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>

          <section id="conversation-detail" className={styles.conversationDetail} aria-labelledby="conversation-detail-title" aria-live="polite">
            <div className={styles.detailHeader}>
              <div>
                <h2 id="conversation-detail-title">{selected.name}</h2>
                <span>{selected.channel === "call" ? "Poziv" : "Poruka"} · danas u {selected.time} · {selected.length}</span>
              </div>
              <span className={`${styles.chip} ${selected.status === "team" ? styles.chipPending : ""}`}>{selected.outcome}</span>
            </div>
            <div className={styles.summaryBox}>
              <strong>Sažetak</strong>
              <p>{selected.summary}</p>
            </div>
            <ol className={styles.transcript} aria-label="Tok razgovora">
              {selected.messages.map((message, index) => (
                <li key={index} className={`${styles.bubble} ${message.from === "assistant" ? styles.assistantBubble : styles.callerBubble}`}>
                  <span className={styles.bubbleSpeaker}>{message.from === "assistant" ? draft.assistant.name || "Asistent" : selected.name.split(" ")[0]}</span>
                  <p>{message.text}</p>
                </li>
              ))}
            </ol>
            <p className={styles.previewNote}>Izmišljen primer. Nije zabeležen stvaran poziv ili poruka.</p>
          </section>
        </div>
      )}
    </>
  );
}
