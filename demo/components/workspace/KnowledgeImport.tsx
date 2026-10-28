"use client";

import { Check, FileUp, Globe, X } from "lucide-react";
import { useId, useState, type ChangeEvent, type FormEvent } from "react";
import { acceptRecords, decodeImportFile, MAX_IMPORT_BYTES, parseKnowledgeImport, type ImportedEntry, type ImportEncoding, type SkippedEntry, type SkipReason, type UrlImportResult } from "../../lib/workspace/knowledge-import";
import { MAX_KNOWLEDGE_ENTRIES } from "../../lib/workspace/persistence";
import { LIMITS } from "../../lib/workspace/validation";
import { Notice, TextField, fieldId } from "./FormControls";
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

const PAGE_ERRORS: Record<Exclude<UrlImportResult["status"], "ok" | "invalid">, string> = {
  forbidden: "Nemate pravo da uvozite odgovore u ovu firmu.",
  "signed-out": "Prijava je istekla. Osvežite stranicu i prijavite se ponovo.",
  error: "Stranica nije mogla da se učita. Pokušajte ponovo.",
};

const SKIPPED_ROWS = 50;

/** "1 odgovor", "21 odgovor", "3 odgovora", "11 odgovora". */
export function answersLabel(count: number): string {
  return `${count} ${count % 10 === 1 && count % 100 !== 11 ? "odgovor" : "odgovora"}`;
}

type Origin = { kind: "file"; fileName: string; encoding: ImportEncoding } | { kind: "web"; source: string; title: string | null };
type Parsed = { origin: Origin; entries: ImportedEntry[]; skipped: SkippedEntry[] };
type Source = "file" | "web";

/**
 * Previews knowledge entries from a CSV/text file read in the browser or, in
 * an organization, from one public web page read by the server. Every entry
 * starts selected; only the selected ones are added to the draft.
 */
export default function KnowledgeImport({ existingQuestions, capacity, onImport, onCancel, importFromUrl }: {
  existingQuestions: string[];
  capacity: number;
  onImport: (entries: ImportedEntry[]) => void;
  onCancel: () => void;
  importFromUrl?: (url: string) => Promise<UrlImportResult>;
}) {
  const inputId = useId();
  const choiceId = useId();
  const [source, setSource] = useState<Source>("file");
  const [parsed, setParsed] = useState<Parsed | null>(null);
  const [selected, setSelected] = useState<boolean[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const [url, setUrl] = useState("");
  const [urlError, setUrlError] = useState<string>();

  function show(next: Parsed | null) {
    setParsed(next);
    setSelected(next ? next.entries.map(() => true) : []);
  }

  function chooseSource(next: Source) {
    if (next === source) return;
    setSource(next);
    show(null);
    setError(null);
    setUrlError(undefined);
  }

  async function handleFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    // Clearing the input lets the same file be chosen again after editing it.
    event.target.value = "";
    show(null);
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
      else show({ origin: { kind: "file", fileName: file.name, encoding: decoded.encoding }, ...parseKnowledgeImport(decoded.text, { fileName: file.name, existingQuestions, capacity }) });
    } catch {
      setError("Fajl nije mogao da se pročita. Pokušajte ponovo.");
    } finally {
      setReading(false);
    }
  }

  async function handleUrl(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!importFromUrl || reading) return;
    show(null);
    setError(null);
    if (!url.trim()) {
      setUrlError("Unesite adresu stranice.");
      document.getElementById(fieldId("knowledge.url"))?.focus();
      return;
    }
    setUrlError(undefined);
    setReading(true);
    try {
      const result = await importFromUrl(url.trim());
      if (result.status === "ok") show({ origin: { kind: "web", source: result.source, title: result.title }, ...acceptRecords(result.records, { existingQuestions, capacity }) });
      else setError(result.status === "invalid" ? result.message : PAGE_ERRORS[result.status]);
    } catch {
      setError(PAGE_ERRORS.error);
    } finally {
      setReading(false);
    }
  }

  const entries = parsed?.entries ?? [];
  const skipped = parsed?.skipped ?? [];
  const web = parsed?.origin.kind === "web" ? parsed.origin : null;
  const chosen = entries.filter((_, index) => selected[index]);
  const allSelected = chosen.length === entries.length;

  return (
    <section className={styles.knowledgeForm} aria-labelledby="knowledge-import-title">
      <h2 id="knowledge-import-title" tabIndex={-1}>{importFromUrl ? "Uvoz odgovora" : "Uvoz iz fajla"}</h2>
      {importFromUrl && (
        <div className={`${styles.segmented} ${styles.importSource}`} role="group" aria-label="Odakle uvozite">
          <button type="button" aria-pressed={source === "file"} onClick={() => chooseSource("file")} disabled={reading}><FileUp size={15} aria-hidden="true" />Iz fajla</button>
          <button type="button" aria-pressed={source === "web"} onClick={() => chooseSource("web")} disabled={reading}><Globe size={15} aria-hidden="true" />Sa stranice sajta</button>
        </div>
      )}

      {source === "file" ? (
        <>
          <p className={styles.importHint}>CSV ili tekstualni fajl do {MAX_IMPORT_BYTES / 1024} KB. Fajl se čita samo u vašem pregledaču; pre dodavanja birate šta će biti uvezeno.</p>
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
            <span className={styles.fileName}>{parsed?.origin.kind === "file" ? parsed.origin.fileName : "Fajl nije izabran"}</span>
          </div>
        </>
      ) : (
        <form className={styles.importUrl} onSubmit={handleUrl} noValidate>
          <p className={styles.importHint}>Server preuzima samo tu jednu javnu stranicu (do 2 MB) i ne prati linkove sa nje. Najbolje rade stranice sa čestim pitanjima, cenovnikom ili radnim vremenom. Pre dodavanja birate šta će biti uvezeno.</p>
          <TextField path="knowledge.url" label="Adresa stranice" value={url} onChange={setUrl} error={urlError} placeholder="https://vasafirma.rs/cesta-pitanja" inputMode="url" autoComplete="url" maxLength={2048} />
          <div className={styles.inlineButtons}>
            <button type="submit" className={styles.secondaryAction} disabled={reading}><Globe size={15} aria-hidden="true" />Učitaj stranicu</button>
          </div>
        </form>
      )}

      {error && <div role="alert"><Notice tone="warning">{error}</Notice></div>}

      <div role="status" className={styles.importSummary}>
        {reading && <p>{source === "web" ? "Učitavam stranicu…" : "Čitam fajl…"}</p>}
        {parsed && (
          <>
            <p>
              <strong>{entries.length
                ? `${web ? "Pronađeno" : "Spremno za uvoz"}: ${answersLabel(entries.length)}`
                : web ? "Na stranici nema novih odgovora za uvoz" : "Nema novih odgovora za uvoz"}</strong>
              {skipped.length > 0 && `; preskočeno ${web ? "stavki" : "redova"}: ${skipped.length}`}.
            </p>
            {web && <p className={styles.importHint}>Izvor: {web.title ? `„${web.title}“, ` : ""}{web.source}. Tekst sa sajta može biti zastareo: proverite odgovore pre dodavanja.</p>}
            {web && !entries.length && !skipped.length && <p className={styles.importHint}>Uvoz prepoznaje česta pitanja, naslove sa tekstom ispod njih, liste i tabele. Probajte stranicu sa čestim pitanjima ili cenovnikom.</p>}
            {parsed.origin.kind === "file" && parsed.origin.encoding === "windows-1250" && <p className={styles.importHint}>Fajl je pročitan u Windows-1250 kodiranju (Excel, srpska latinica). Proverite slova č, ć, š, đ i ž u pregledu.</p>}
          </>
        )}
      </div>

      {entries.length > 0 && (
        <fieldset className={styles.importChoices}>
          <legend className="visually-hidden">Odgovori za uvoz</legend>
          {entries.length > 1 && (
            <button type="button" className={styles.importToggle} onClick={() => setSelected(entries.map(() => !allSelected))}>
              {allSelected ? "Poništi izbor" : "Izaberi sve"}
            </button>
          )}
          <ul className={styles.importPreview}>
            {entries.map((entry, index) => (
              <li key={index} className={styles.importChoice}>
                <input
                  type="checkbox"
                  id={`${choiceId}-${index}`}
                  aria-describedby={`${choiceId}-${index}-answer`}
                  checked={selected[index] ?? false}
                  onChange={() => setSelected((current) => current.map((value, position) => (position === index ? !value : value)))}
                />
                <label htmlFor={`${choiceId}-${index}`}>{entry.question}</label>
                <span id={`${choiceId}-${index}-answer`}>{entry.answer}</span>
              </li>
            ))}
          </ul>
        </fieldset>
      )}

      {skipped.length > 0 && (
        <details className={styles.importFormats}>
          <summary>{web ? "Preskočene stavke" : "Preskočeni redovi"} ({skipped.length})</summary>
          <ul className={styles.importSkipped}>
            {skipped.slice(0, SKIPPED_ROWS).map((row) => (
              <li key={`${row.line}-${row.reason}`}>{web ? "Stavka" : "Red"} {row.line}{row.question ? `, „${row.question}“` : ""}: {REASONS[row.reason]}</li>
            ))}
            {skipped.length > SKIPPED_ROWS && <li>i još {skipped.length - SKIPPED_ROWS}</li>}
          </ul>
        </details>
      )}

      <div className={styles.inlineButtons}>
        {chosen.length > 0 && (
          <button type="button" className={styles.primaryAction} onClick={() => onImport(chosen)}>
            <Check size={15} aria-hidden="true" />Dodaj {answersLabel(chosen.length)}
          </button>
        )}
        <button type="button" className={styles.secondaryAction} onClick={onCancel}><X size={15} aria-hidden="true" />Otkaži</button>
      </div>
    </section>
  );
}
