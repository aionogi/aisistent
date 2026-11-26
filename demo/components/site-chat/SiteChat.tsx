"use client";

import { RotateCcw, SendHorizontal } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { MAX_SITE_MESSAGE_LENGTH } from "../../lib/site-chat/policy";
import styles from "./site-chat.module.css";

type Line = { speaker: "customer" | "assistant"; body: string };
type ApiResult =
  | { status: "ok"; token?: string; reply?: string; ended?: boolean; messages?: Line[] }
  | { status: "error"; code: string; message: string };

const storageKey = (publicId: string) => `aisistent-chat:${publicId}`;

/** sessionStorage can be missing or refuse access in a frame; the chat then lasts as long as the page. */
function readToken(publicId: string): string | null {
  try {
    return window.sessionStorage.getItem(storageKey(publicId));
  } catch {
    return null;
  }
}

function writeToken(publicId: string, token: string | null): void {
  try {
    if (token) window.sessionStorage.setItem(storageKey(publicId), token);
    else window.sessionStorage.removeItem(storageKey(publicId));
  } catch {
    // Nothing to do: the conversation stays in this page only.
  }
}

async function call(publicId: string, body: Record<string, unknown>): Promise<ApiResult> {
  try {
    const response = await fetch(`/api/chat/${publicId}/`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), cache: "no-store" });
    const result = (await response.json()) as ApiResult;
    return result && typeof result === "object" && "status" in result ? result : { status: "error", code: "error", message: "Poruka nije poslata. Pokušajte ponovo." };
  } catch {
    return { status: "error", code: "error", message: "Veza nije uspela. Pokušajte ponovo." };
  }
}

/** Messages after the stored greeting, which the chat shows from the firm's current settings. */
function afterGreeting(messages: Line[]): Line[] {
  const start = messages.findIndex((message) => message.speaker === "customer");
  return start < 0 ? [] : messages.slice(start);
}

/**
 * The visitor's side of a firm's website chat. The browser holds only the
 * conversation token; the server keeps the history and answers from the
 * firm's settings. It says plainly that an AI answers and who reads the chat.
 */
export default function SiteChat({ publicId, assistantName, businessName, greeting }: { publicId: string; assistantName: string; businessName: string; greeting: string }) {
  const [token, setToken] = useState<string | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [ended, setEnded] = useState(false);
  const [pending, setPending] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const endRef = useRef<HTMLLIElement>(null);
  const team = businessName ? `tim firme ${businessName}` : "tim firme";

  async function restore(stored: string) {
    const result = await call(publicId, { type: "history", token: stored });
    if (result.status !== "ok") return;
    const messages = afterGreeting(result.messages ?? []);
    if (messages.length === 0 && !result.ended) {
      writeToken(publicId, null);
      return;
    }
    setToken(stored);
    setLines(messages);
    setEnded(result.ended === true);
  }

  useEffect(() => {
    const stored = readToken(publicId);
    // Reopens the conversation after the visitor moves to another page of the firm's website.
    if (stored) void restore(stored);
  }, [publicId]);

  useEffect(() => {
    endRef.current?.scrollIntoView?.({ block: "nearest" });
  }, [lines, pending]);

  async function submit(event?: FormEvent) {
    event?.preventDefault();
    const text = input.trim();
    if (!text || pending || ended) return;
    setError(null);
    setInput("");
    setLines((current) => [...current, { speaker: "customer", body: text }]);
    setPending(true);
    const result = await call(publicId, { type: "message", token, message: text });
    setPending(false);
    if (result.status === "ok" && result.token && result.reply) {
      setToken(result.token);
      writeToken(publicId, result.token);
      setLines((current) => [...current, { speaker: "assistant", body: result.reply! }]);
      if (result.ended) setEnded(true);
    } else {
      // The message was not answered: take it back into the field so nothing typed is lost.
      setLines((current) => current.slice(0, -1));
      setInput(text);
      const failed = result.status === "error" ? result : { code: "error", message: "Poruka nije poslata. Pokušajte ponovo." };
      setError(failed.message);
      if (failed.code === "restart") startOver(false);
      if (failed.code === "changed" && token) void restore(token);
    }
    inputRef.current?.focus();
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    // Enter sends, Shift+Enter starts a new line; composing (IME) input is left alone.
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void submit();
    }
  }

  function startOver(clearError = true) {
    writeToken(publicId, null);
    setToken(null);
    setLines([]);
    setEnded(false);
    if (clearError) setError(null);
    inputRef.current?.focus();
  }

  return (
    <section className={styles.chat} aria-labelledby="site-chat-title">
      <header className={styles.header}>
        <span className={styles.avatar} aria-hidden="true">{assistantName.charAt(0).toUpperCase()}</span>
        <div>
          <h1 id="site-chat-title">{assistantName}</h1>
          <p>AI asistent{businessName ? ` · ${businessName}` : ""}</p>
        </div>
        <button type="button" className={styles.restart} onClick={() => startOver()} disabled={pending || (lines.length === 0 && !error)} aria-label="Novi razgovor" title="Novi razgovor">
          <RotateCcw size={16} aria-hidden="true" />
        </button>
      </header>

      <p className={styles.notice}>Odgovara AI asistent, ne čovek. Razgovor vidi {team}. Ne upisujte lozinke ni podatke o platnim karticama.</p>

      <ol className={styles.log} role="log" aria-live="polite" aria-label="Razgovor sa asistentom">
        {greeting && (
          <li className={`${styles.bubble} ${styles.assistant}`}>
            <span className={styles.speaker}>{assistantName}</span>
            <p>{greeting}</p>
          </li>
        )}
        {lines.map((line, index) => (
          <li key={index} className={`${styles.bubble} ${line.speaker === "customer" ? styles.customer : styles.assistant}`}>
            <span className={styles.speaker}>{line.speaker === "customer" ? "Vi" : assistantName}</span>
            <p>{line.body}</p>
          </li>
        ))}
        {pending && (
          <li className={`${styles.bubble} ${styles.assistant} ${styles.typing}`}>
            <span className={styles.speaker}>{assistantName}</span>
            <p>Piše odgovor…</p>
          </li>
        )}
        <li ref={endRef} className={styles.end} aria-hidden="true" />
      </ol>

      {error && <p className={styles.error} role="alert">{error}</p>}
      {ended ? (
        <div className={styles.ended} role="status">
          <p>Razgovor je završen jer poruke nisu bile u vezi sa poslovanjem firme. Za pitanja o uslugama započnite novi razgovor.</p>
          <button type="button" onClick={() => startOver()}>Novi razgovor</button>
        </div>
      ) : (
        <form className={styles.form} onSubmit={submit}>
          <label htmlFor="site-chat-message" className="visually-hidden">Vaša poruka</label>
          <textarea
            id="site-chat-message"
            ref={inputRef}
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={onKeyDown}
            maxLength={MAX_SITE_MESSAGE_LENGTH}
            rows={1}
            placeholder="Napišite pitanje…"
            disabled={pending}
          />
          <button type="submit" disabled={pending || !input.trim()} aria-label="Pošalji">
            <SendHorizontal size={18} aria-hidden="true" />
          </button>
        </form>
      )}
    </section>
  );
}
