"use client";

import { BookOpen, Check, PencilLine, Plus, Search, SearchX, Trash2, X } from "lucide-react";
import { useRef, useState, type FormEvent } from "react";
import { applyIndustryTemplate, createId } from "../../../lib/workspace/templates";
import type { KnowledgeEntry } from "../../../lib/workspace/types";
import { LIMITS, validateKnowledgeEntry, type FieldErrors } from "../../../lib/workspace/validation";
import ConfirmDialog from "../ConfirmDialog";
import { useDraft } from "../DraftProvider";
import { TextField } from "../FormControls";
import { EmptyState, PageHeader } from "../PageParts";
import { useWorkspaceEnvironment } from "../WorkspaceEnvironment";
import styles from "../pages.module.css";

type Editor = { mode: "add" } | { mode: "edit"; id: string };

export default function KnowledgeView() {
  const { draft, updateDraft, readOnly } = useDraft();
  const isDemo = useWorkspaceEnvironment().mode === "demo";
  const [query, setQuery] = useState("");
  const [editor, setEditor] = useState<Editor | null>(null);
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [status, setStatus] = useState("");
  const [pendingDelete, setPendingDelete] = useState<KnowledgeEntry | null>(null);
  const addButtonRef = useRef<HTMLButtonElement>(null);

  const normalizedQuery = query.trim().toLocaleLowerCase("sr-Latn");
  const visible = draft.knowledge.filter((entry) => !normalizedQuery || `${entry.question} ${entry.answer}`.toLocaleLowerCase("sr-Latn").includes(normalizedQuery));
  const templateAvailable = draft.industry && draft.industry !== "other";

  function openEditor(next: Editor) {
    const entry = next.mode === "edit" ? draft.knowledge.find((item) => item.id === next.id) : undefined;
    setEditor(next);
    setQuestion(entry?.question ?? "");
    setAnswer(entry?.answer ?? "");
    setErrors({});
    setStatus("");
    window.setTimeout(() => document.getElementById("field-knowledge-question")?.focus(), 0);
  }

  function closeEditor() {
    setEditor(null);
    setErrors({});
    window.setTimeout(() => addButtonRef.current?.focus(), 0);
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editor) return;
    const nextErrors = validateKnowledgeEntry(question, answer);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) {
      document.getElementById(nextErrors.question ? "field-knowledge-question" : "field-knowledge-answer")?.focus();
      return;
    }
    const value = { question: question.trim(), answer: answer.trim() };
    if (editor.mode === "add") {
      updateDraft((current) => ({ ...current, knowledge: [...current.knowledge, { id: createId("knowledge"), ...value }] }));
      setStatus(isDemo ? "Odgovor je dodat u bazu znanja ovog nacrta." : "Odgovor je dodat u bazu znanja.");
    } else {
      updateDraft((current) => ({ ...current, knowledge: current.knowledge.map((entry) => entry.id === editor.id ? { ...entry, ...value } : entry) }));
      setStatus(isDemo ? "Izmena je sačuvana u nacrtu." : "Izmena je primenjena.");
    }
    closeEditor();
  }

  function restoreExamples() {
    if (!draft.industry) return;
    const examples = applyIndustryTemplate(draft, draft.industry).knowledge;
    updateDraft((current) => ({ ...current, knowledge: examples }));
    setStatus("Vraćeni su primeri odgovora za vašu delatnost.");
  }

  const form = editor && (
    <form className={styles.knowledgeForm} onSubmit={handleSubmit} noValidate aria-labelledby="knowledge-form-title">
      <h2 id="knowledge-form-title">{editor.mode === "add" ? "Novi odgovor" : "Izmena odgovora"}</h2>
      <TextField path="knowledge.question" label="Pitanje klijenta" value={question} onChange={setQuestion} error={errors.question} maxLength={LIMITS.question} placeholder="Npr. Da li imate parking?" />
      <TextField path="knowledge.answer" label="Odgovor asistenta" value={answer} onChange={setAnswer} error={errors.answer} maxLength={LIMITS.answer} multiline rows={3} showCount placeholder="Kratak i tačan odgovor koji asistent može da ponovi." />
      <div className={styles.inlineButtons}>
        <button type="submit" className={styles.primaryAction}><Check size={15} aria-hidden="true" />{editor.mode === "add" ? "Dodaj odgovor" : "Sačuvaj izmenu"}</button>
        <button type="button" className={styles.secondaryAction} onClick={closeEditor}><X size={15} aria-hidden="true" />Otkaži</button>
      </div>
    </form>
  );

  return (
    <>
      <PageHeader
        title="Baza znanja"
        badge={isDemo ? "Primer podataka" : "Podaci firme"}
        description={isDemo ? "Česta pitanja i odgovori koje asistent koristi u primerima razgovora. Čuvaju se samo u ovom nacrtu." : "Česta pitanja i odgovori vaše firme. Izmene se čuvaju automatski."}
        actions={readOnly ? undefined : <button ref={addButtonRef} type="button" className={styles.primaryAction} onClick={() => openEditor({ mode: "add" })} disabled={editor?.mode === "add"}><Plus size={15} aria-hidden="true" />Dodaj odgovor</button>}
      />
      <p className={styles.formStatus} role="status">{status}</p>

      {editor?.mode === "add" && form}

      {draft.knowledge.length === 0 ? (
        !editor && (
          <EmptyState icon={BookOpen} title="Baza znanja je prazna" actions={readOnly ? undefined : <>
            <button type="button" className={styles.primaryAction} onClick={() => openEditor({ mode: "add" })}><Plus size={15} aria-hidden="true" />Dodaj prvi odgovor</button>
            {templateAvailable && <button type="button" className={styles.secondaryAction} onClick={restoreExamples}>Vrati primere za delatnost</button>}
          </>}>
            Bez odgovora asistent postupa prema pravilu za nepoznata pitanja. Dodajte pitanja koja klijenti najčešće postavljaju.
          </EmptyState>
        )
      ) : (
        <>
          <div className={styles.toolbar}>
            <div className={styles.searchField}>
              <Search size={16} aria-hidden="true" />
              <label htmlFor="knowledge-search" className="visually-hidden">Pretraži bazu znanja</label>
              <input id="knowledge-search" type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Pretraži pitanja i odgovore" autoComplete="off" />
            </div>
            <span className={styles.toolbarMeta}>{draft.knowledge.length === 1 ? "1 odgovor" : `${draft.knowledge.length} odgovora`}</span>
          </div>

          {visible.length === 0 ? (
            <EmptyState icon={SearchX} title="Nema odgovora za ovu pretragu" actions={<button type="button" className={styles.secondaryAction} onClick={() => setQuery("")}>Poništi pretragu</button>}>
              Proverite pravopis ili dodajte novo pitanje u bazu znanja.
            </EmptyState>
          ) : (
            <ul className={styles.knowledgeList}>
              {visible.map((entry) => (
                <li key={entry.id} className={styles.knowledgeItem}>
                  {editor?.mode === "edit" && editor.id === entry.id ? form : (
                    <>
                      <BookOpen size={17} aria-hidden="true" className={styles.knowledgeIcon} />
                      <div className={styles.knowledgeText}>
                        <strong>{entry.question}</strong>
                        <p>{entry.answer}</p>
                      </div>
                      <div className={styles.itemActions} hidden={readOnly}>
                        <button type="button" className={styles.iconAction} onClick={() => openEditor({ mode: "edit", id: entry.id })} aria-label={`Izmeni: ${entry.question}`}><PencilLine size={16} aria-hidden="true" /></button>
                        <button type="button" className={styles.iconAction} onClick={() => setPendingDelete(entry)} aria-label={`Obriši: ${entry.question}`}><Trash2 size={16} aria-hidden="true" /></button>
                      </div>
                    </>
                  )}
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      <ConfirmDialog
        open={pendingDelete !== null}
        title="Obrisati odgovor?"
        confirmLabel="Obriši odgovor"
        onClose={() => setPendingDelete(null)}
        onConfirm={() => {
          if (!pendingDelete) return;
          updateDraft((current) => ({ ...current, knowledge: current.knowledge.filter((entry) => entry.id !== pendingDelete.id) }));
          setStatus(`Obrisan je odgovor „${pendingDelete.question}“.`);
          window.setTimeout(() => addButtonRef.current?.focus(), 0);
        }}
      >
        <p>„{pendingDelete?.question}“ biće uklonjen iz baze znanja {isDemo ? " ovog nacrta" : ""}.</p>
      </ConfirmDialog>
    </>
  );
}
