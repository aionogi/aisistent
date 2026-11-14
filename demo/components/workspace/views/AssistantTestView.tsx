"use client";

import Link from "next/link";
import { ArrowLeft, MessageSquare, RotateCcw, SendHorizontal } from "lucide-react";
import { useEffect, useRef, useState, useTransition, type FormEvent, type KeyboardEvent } from "react";
import type { TestChatResult } from "../../../app/(platform)/org/[organizationId]/(shell)/assistant/test/actions";
import { MAX_TEST_MESSAGE_LENGTH } from "../../../lib/assistant/limits";
import { onboardingStartHref } from "../../../lib/workspace/steps";
import { useDraft } from "../DraftProvider";
import { Notice } from "../FormControls";
import { PageHeader } from "../PageParts";
import { useWorkspaceEnvironment, workspacePath } from "../WorkspaceEnvironment";
import styles from "../pages.module.css";
import chat from "../test-chat.module.css";

type Line = { speaker: "customer" | "assistant"; body: string };

/**
 * A text conversation with the organization's own assistant, answered by the
 * AI provider from the organization's settings and knowledge base. Owners and
 * admins only; the server enforces the same and keeps the history.
 */
export default function AssistantTestView({ enabled, send }: { enabled: boolean; send: (conversationId: string | null, message: string) => Promise<TestChatResult> }) {
  const { draft, readOnly } = useDraft();
  const environment = useWorkspaceEnvironment();
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startSending] = useTransition();
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const endRef = useRef<HTMLLIElement>(null);
  const assistantName = draft.assistant.name.trim() || "Asistent";
  const greeting = draft.assistant.greeting.trim();
  const businessName = draft.business.name.trim() || environment.organizationName || "vaša firma";
  const canChat = enabled && !readOnly;

  useEffect(() => {
    endRef.current?.scrollIntoView?.({ block: "nearest" });
  }, [lines, pending]);

  function submit(event?: FormEvent) {
    event?.preventDefault();
    const text = input.trim();
    if (!text || pending) return;
    setError(null);
    setInput("");
    setLines((current) => [...current, { speaker: "customer", body: text }]);
    startSending(async () => {
      let result: TestChatResult;
      try {
        result = await send(conversationId, text);
      } catch {
        result = { status: "error", message: "Veza sa serverom nije uspela. Pokušajte ponovo." };
      }
      if (result.status === "ok") {
        setConversationId(result.conversationId);
        setLines((current) => [...current, { speaker: "assistant", body: result.reply }]);
      } else {
        // The message was not answered: take it back into the field so nothing typed is lost.
        setLines((current) => current.slice(0, -1));
        setInput(text);
        setError(result.message);
        if (result.restart) {
          setConversationId(null);
          setLines([]);
        }
      }
      inputRef.current?.focus();
    });
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    // Enter sends, Shift+Enter starts a new line; composing (IME) input is left alone.
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      submit();
    }
  }

  function restart() {
    setConversationId(null);
    setLines([]);
    setError(null);
    inputRef.current?.focus();
  }

  return (
    <>
      <PageHeader
        title="Probni razgovor"
        badge="AI asistent"
        description="Pišite kao vaš klijent i proverite kako asistent odgovara iz podešavanja i baze znanja vaše firme."
        actions={<Link href={workspacePath(environment, "assistant")} className={styles.secondaryAction}><ArrowLeft size={15} aria-hidden="true" />Podešavanje asistenta</Link>}
      />

      {!enabled && (
        <Notice tone="info" title="Probni razgovor još nije uključen">
          Uključuje se kada se na serveru poveže AI servis. Do tada na stranici „Asistent“ vidite primere odgovora sastavljene iz pravila, bez AI-ja.
        </Notice>
      )}
      {enabled && readOnly && !environment.stepUpPath && (
        <Notice tone="info" title="Samo za vlasnika i administratore">
          Probni razgovor troši plaćene AI zahteve, pa ga koriste vlasnik i administratori firme.
        </Notice>
      )}
      {canChat && !draft.onboardingCompleted && (
        <Notice tone="warning" title="Podešavanje nije završeno" action={<Link href={onboardingStartHref(environment.onboardingBasePath)} className={styles.noticeLink}>Nastavi podešavanje</Link>}>
          Asistent odgovara samo iz podataka koje ste do sada uneli.
        </Notice>
      )}

      {canChat && (
        <section className={chat.panel} aria-labelledby="test-chat-title">
          <header className={chat.header}>
            <span className={chat.avatar} aria-hidden="true">{assistantName.charAt(0).toUpperCase()}</span>
            <div>
              <h2 id="test-chat-title">{assistantName}</h2>
              <p>AI asistent · {businessName}</p>
            </div>
            <button type="button" className={styles.secondaryAction} onClick={restart} disabled={pending || (lines.length === 0 && !error)}>
              <RotateCcw size={15} aria-hidden="true" />Novi razgovor
            </button>
          </header>

          <ol className={`${styles.transcript} ${chat.log}`} role="log" aria-live="polite" aria-label="Probni razgovor">
            {greeting && (
              <li className={`${styles.bubble} ${styles.assistantBubble}`}>
                <span className={styles.bubbleSpeaker}>{assistantName}</span>
                <p>{greeting}</p>
              </li>
            )}
            {lines.map((line, index) => (
              <li key={index} className={`${styles.bubble} ${line.speaker === "customer" ? styles.callerBubble : styles.assistantBubble}`}>
                <span className={styles.bubbleSpeaker}>{line.speaker === "customer" ? "Vi" : assistantName}</span>
                <p>{line.body}</p>
              </li>
            ))}
            {pending && (
              <li className={`${styles.bubble} ${styles.assistantBubble} ${chat.typing}`}>
                <span className={styles.bubbleSpeaker}>{assistantName}</span>
                <p>Piše odgovor…</p>
              </li>
            )}
            <li ref={endRef} className={chat.end} aria-hidden="true" />
          </ol>

          {error && <div role="alert"><Notice tone="warning">{error}</Notice></div>}

          <form className={chat.form} onSubmit={submit}>
            <label htmlFor="test-chat-input" className="visually-hidden">Vaša poruka asistentu</label>
            <textarea
              id="test-chat-input"
              ref={inputRef}
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={onKeyDown}
              maxLength={MAX_TEST_MESSAGE_LENGTH}
              rows={2}
              placeholder="Npr. Da li radite subotom?"
              aria-describedby="test-chat-hint"
            />
            <button type="submit" className={styles.primaryAction} disabled={pending || !input.trim()}>
              <SendHorizontal size={15} aria-hidden="true" />{pending ? "Šalje se…" : "Pošalji"}
            </button>
          </form>
          <p id="test-chat-hint" className={chat.hint}>
            Enter šalje, Shift+Enter prelazi u novi red · {input.length}/{MAX_TEST_MESSAGE_LENGTH}.
            {" "}Odgovore piše AI model na osnovu podataka vaše firme i može da pogreši. Ne upisujte stvarne podatke klijenata.
            {" "}Razgovor se čuva u <Link href={workspacePath(environment, "conversations")}><MessageSquare size={12} aria-hidden="true" />Razgovorima</Link>.
          </p>
        </section>
      )}
    </>
  );
}
