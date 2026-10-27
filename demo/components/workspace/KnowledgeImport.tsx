"use client";

import { Check, FileUp, X } from "lucide-react";
import { useId, useState, type ChangeEvent } from "react";
import { decodeImportFile, MAX_IMPORT_BYTES, parseKnowledgeImport, type ImportedEntry, type ImportEncoding, type ImportResult, type SkipReason } from "../../lib/workspace/knowledge-import";
import { MAX_KNOWLEDGE_ENTRIES } from "../../lib/workspace/persistence";
import { LIMITS } from "../../lib/workspace/validation";
import { Notice } from "./FormControls";
import styles from "./pages.module.css";

const REASONS: Record<SkipReason, string> = {
  missing_question: "nema pitanja",
  missing_answer: "nema odgovora",
  question_too_long: `pitanje je duže od ${LIMITS.question} znakova`,
  answer_too_long: `odgovor je duži od ${LIMITS.answer} znakova`,
  duplicate: "pitanje već postoji",
  over_limit: `baza znanja je dostigla ${MAX_KNOWLEDGE_ENTRIES} odgovora`,
};

const FILE_ERRORS = {
  empty: "Fajl je prazan.",
  too_large: `Fajl je veći od ${MAX_IMPORT_BYTES / 1024} KB. Podelite ga na manje delove.`,
  binary: "Ovo nije tekstualni fajl. Tabelu iz Excela sačuvajte kao CSV, pa je uvezite.",
};

const PREVIEW_ROWS = 5;
const SKIPPED_ROWS = 50;

/** "1 odgovor", "21 odgovor", "3 odgovora", "11 odgovora". */
export function answersLabel(count: number): string {
  return `${count} ${count % 10 === 1 && count % 100 !== 11 ? "odgovor" : "odgovora"}`;
}

type Parsed = { fileName: string; encoding: ImportEncoding; result: ImportResult };

/** Reads a CSV or text file in the browser and previews what would be added. */
export default function KnowledgeImport({ existingQuestions, capacity, onImport, onCancel }: {
  existingQuestions: string[];
  capacity: number;
  onImport: (entries: ImportedEntry[]) => void;
  onCancel: () => void;
}) {
  const inputId = useId();
  const [parsed, setParsed] = useState<Parsed | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reading, setReading] = useState(false);

  async function handleFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    // Clearing the input lets the same file be chosen again after editing it.
    event.target.value = "";
    setParsed(null);
    setError(null);
    if (!file) return;
    if (file.size > MAX_IMPORT_BYTES) {
      setError(FILE_ERRORS.too_large);
      return;
    }
    setReading(true);
    try {
      const decoded = decodeImportFile(new Uint8Array(await file.arrayBuffer()));
      if (!decoded.ok) setError(FILE_ERRORS[decoded.error]);
      else setParsed({ fileName: file.name, encoding: decoded.encoding, result: parseKnowledgeImport(decoded.text, { fileName: file.name, existingQuestions, capacity }) });
    } catch {
      setError("Fajl nije mogao da se pročita. Pokušajte ponovo.");
    } finally {
      setReading(false);
    }
  }

  const entries = parsed?.result.entries ?? [];
  const skipped = parsed?.result.skipped ?? [];

  return (
    <section className={styles.knowledgeForm} aria-labelledby="knowledge-import-title">
      <h2 id="knowledge-import-title" tabIndex={-1}>Uvoz iz fajla</h2>
      <p className={styles.importHint}>CSV ili tekstualni fajl do {MAX_IMPORT_BYTES / 1024} KB. Fajl se čita samo u vašem pregledaču; pre dodavanja vidite šta će biti uvezeno.</p>
      <details className={styles.importFormats}>
        <summary>Kako treba da izgleda fajl</summary>
        <p><strong>Tabela (CSV):</strong> prva kolona je pitanje, druga odgovor. Prvi red može biti naslov. U Excelu izaberite „Sačuvaj kao“ → CSV.</p>
        <pre>{"Pitanje;Odgovor\nDa li radite nedeljom?;Ne, nedeljom ne radimo.\nImate li parking?;Da, ispred salona."}</pre>
        <p><strong>Tekst:</strong> pitanje u jednom redu, odgovor ispod njega, prazan red između parova.</p>
        <pre>{"Da li primate kartice?\nDa, primamo sve kartice.\n\nGde se nalazite?\nCvetna 12, Novi Sad."}</pre>
      </details>
      {/* A styled label instead of the browser's own button text, which follows the browser language. */}
      <div className={styles.fileField}>
        <input id={inputId} type="file" accept=".csv,.tsv,.txt,text/csv,text/plain" onChange={handleFile} disabled={reading} className={`visually-hidden ${styles.fileInput}`} />
        <label htmlFor={inputId} className={styles.secondaryAction}><FileUp size={15} aria-hidden="true" />Izaberite fajl</label>
        <span className={styles.fileName}>{parsed?.fileName ?? "Fajl nije izabran"}</span>
      </div>

      {error && <div role="alert"><Notice tone="warning">{error}</Notice></div>}

      <div role="status" className={styles.importSummary}>
        {reading && <p>Čitam fajl…</p>}
        {parsed && (
          <>
            <p>
              <strong>{entries.length ? `Spremno za uvoz: ${answersLabel(entries.length)}` : "Nema novih odgovora za uvoz"}</strong>
              {skipped.length > 0 && `; preskočeno redova: ${skipped.length}`}.
            </p>
            {parsed.encoding === "windows-1250" && <p className={styles.importHint}>Fajl je pročitan u Windows-1250 kodiranju (Excel, srpska latinica). Proverite slova č, ć, š, đ i ž u pregledu.</p>}
          </>
        )}
      </div>

      {entries.length > 0 && (
        <ul className={styles.importPreview} aria-label="Pregled odgovora za uvoz">
          {entries.slice(0, PREVIEW_ROWS).map((entry, index) => (
            <li key={index}><strong>{entry.question}</strong><span>{entry.answer}</span></li>
          ))}
          {entries.length > PREVIEW_ROWS && <li className={styles.importMore}>i još {answersLabel(entries.length - PREVIEW_ROWS)}</li>}
        </ul>
      )}

      {skipped.length > 0 && (
        <details className={styles.importFormats}>
          <summary>Preskočeni redovi ({skipped.length})</summary>
          <ul className={styles.importSkipped}>
            {skipped.slice(0, SKIPPED_ROWS).map((row) => (
              <li key={`${row.line}-${row.reason}`}>Red {row.line}{row.question ? `, „${row.question}“` : ""}: {REASONS[row.reason]}</li>
            ))}
            {skipped.length > SKIPPED_ROWS && <li>i još {skipped.length - SKIPPED_ROWS}</li>}
          </ul>
        </details>
      )}

      <div className={styles.inlineButtons}>
        {entries.length > 0 && (
          <button type="button" className={styles.primaryAction} onClick={() => onImport(entries)}>
            <Check size={15} aria-hidden="true" />Dodaj {answersLabel(entries.length)}
          </button>
        )}
        <button type="button" className={styles.secondaryAction} onClick={onCancel}><X size={15} aria-hidden="true" />Otkaži</button>
      </div>
    </section>
  );
}
