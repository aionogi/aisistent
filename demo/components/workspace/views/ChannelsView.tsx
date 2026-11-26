"use client";

import { Check, Copy, Globe, ShieldCheck } from "lucide-react";
import { useActionState, useEffect, useState } from "react";
import type { SiteChatState } from "../../../app/(platform)/org/[organizationId]/(shell)/channels/actions";
import { DEFAULT_DAILY_MESSAGE_LIMIT, embedCode, MAX_ALLOWED_ORIGINS, MAX_DAILY_MESSAGE_LIMIT, MAX_SITE_CONVERSATION_MESSAGES, MIN_DAILY_MESSAGE_LIMIT, OFF_TOPIC_LIMIT } from "../../../lib/site-chat/policy";
import { Notice } from "../FormControls";
import { PageHeader } from "../PageParts";
import forms from "../forms.module.css";
import team from "../team/team.module.css";
import styles from "./channels.module.css";

export type SiteChatSettingsView = { publicId: string; enabled: boolean; allowedOrigins: string[]; dailyMessageLimit: number };

function EmbedCode({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }
  return (
    <div className={styles.embed}>
      <label htmlFor="embed-code" className={forms.label}>Kod za vaš sajt</label>
      <textarea id="embed-code" className={styles.code} value={code} readOnly rows={3} spellCheck={false} onFocus={(event) => event.currentTarget.select()} />
      <p className={forms.hint}>Nalepite ga u svaku stranicu sajta, pre oznake &lt;/body&gt;. Ako sajt koristi Content-Security-Policy, dozvolite ovu adresu u script-src i frame-src.</p>
      <button type="button" className={forms.secondaryButton} onClick={copy}>
        {copied ? <Check size={15} aria-hidden="true" /> : <Copy size={15} aria-hidden="true" />}{copied ? "Kopirano" : "Kopiraj kod"}
      </button>
    </div>
  );
}

const originLines = (origins: string[]) => origins.map((origin) => origin.replace(/^https:\/\//, "")).join("\n");

function SettingsForm({ settings, save }: { settings: SiteChatSettingsView | null; save: (previous: SiteChatState, formData: FormData) => Promise<SiteChatState> }) {
  const [state, formAction, pending] = useActionState(save, { error: null, saved: false });
  // Controlled, so a refused save keeps what the person typed (React resets uncontrolled fields after an action).
  const [enabled, setEnabled] = useState(settings?.enabled ?? false);
  const [origins, setOrigins] = useState(originLines(settings?.allowedOrigins ?? []));
  const [dailyLimit, setDailyLimit] = useState(String(settings?.dailyMessageLimit ?? DEFAULT_DAILY_MESSAGE_LIMIT));

  // After saving, show the addresses as the server stored them (for example without a path).
  useEffect(() => {
    if (state.saved && state.origins) setOrigins(originLines(state.origins));
  }, [state]);

  return (
    <form action={formAction} className={styles.form}>
      {state.error && <div role="alert"><Notice tone="warning">{state.error}</Notice></div>}
      <label className={forms.switchRow}>
        <input type="checkbox" role="switch" name="enabled" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} disabled={pending} />
        <span className={forms.switchTrack} aria-hidden="true"><span /></span>
        <span className={forms.choiceText}>
          <strong>Chat na sajtu</strong>
          <span>{enabled ? "Uključeno: posetioci vaših sajtova pišu asistentu." : "Isključeno: chat na sajtu prikazuje da nije dostupan."}</span>
        </span>
      </label>
      <div className={forms.field}>
        <label htmlFor="site-origins" className={forms.label}>Sajtovi na kojima se chat prikazuje</label>
        <textarea id="site-origins" name="origins" rows={3} maxLength={2000} spellCheck={false} autoComplete="off" disabled={pending}
          value={origins} onChange={(event) => setOrigins(event.target.value)} placeholder={"salon.rs\nwww.salon.rs"} aria-describedby="site-origins-hint" />
        <p id="site-origins-hint" className={forms.hint}>Do {MAX_ALLOWED_ORIGINS} adresa, jedna po redu. Adresa sa „www“ i bez njega su različite, pa upišite obe ako sajt radi na obe. Samo sajtovi sa https.</p>
      </div>
      <div className={forms.field}>
        <label htmlFor="site-daily-limit" className={forms.label}>Dnevni limit poruka</label>
        <input id="site-daily-limit" name="dailyLimit" type="number" inputMode="numeric" min={MIN_DAILY_MESSAGE_LIMIT} max={MAX_DAILY_MESSAGE_LIMIT} step={1} required disabled={pending}
          value={dailyLimit} onChange={(event) => setDailyLimit(event.target.value)} className={styles.number} aria-describedby="site-daily-limit-hint" />
        <p id="site-daily-limit-hint" className={forms.hint}>Kada posetioci za jedan dan pošalju ovoliko poruka, chat ih do sutra upućuje da vas kontaktiraju telefonom ili e-poštom.</p>
      </div>
      <button type="submit" className={`${forms.primaryButton} ${styles.submit}`} disabled={pending}><Check size={15} aria-hidden="true" />{pending ? "Čuvam…" : "Sačuvaj"}</button>
      <p className={team.note} role="status">{state.saved ? "Podešavanje chata je sačuvano." : ""}</p>
    </form>
  );
}

/**
 * Where the firm's assistant answers customers. For now one channel: the
 * chat on the firm's own websites, which owners and admins turn on and embed.
 * Conversations appear under Razgovori.
 */
export default function ChannelsView({ canEdit, isEditor, assistantEnabled, appOrigin, settings, save }: {
  /** Owner or admin, with MFA when required. */
  canEdit: boolean;
  isEditor: boolean;
  assistantEnabled: boolean;
  appOrigin: string;
  settings: SiteChatSettingsView | null;
  save: (previous: SiteChatState, formData: FormData) => Promise<SiteChatState>;
}) {
  return (
    <>
      <PageHeader title="Kanali" badge="Chat na sajtu" description="Gde vaš asistent odgovara klijentima. Za sada je to chat na vašem sajtu; razgovori se pojavljuju pod „Razgovori“." />

      <Notice tone="warning" title="Probna faza">
        Poruke posetilaca za sada obrađuje AI servis van Evropske unije. Dok to ne promenimo, chat uključite samo na probnom sajtu, a ne na sajtu sa pravim klijentima.
      </Notice>
      {!assistantEnabled && (
        <Notice tone="info" title="AI servis nije povezan">
          Na ovom serveru AI servis još nije uključen, pa chat posetiocima prikazuje da nije dostupan.
        </Notice>
      )}

      <section className={team.panel} aria-labelledby="site-chat-title">
        <h2 id="site-chat-title"><Globe size={17} aria-hidden="true" />Chat na vašem sajtu</h2>
        <p className={team.lead}>Na sajtu se pojavljuje dugme za chat. Asistent odgovara iz podešavanja i baze znanja vaše firme i jasno kaže da je AI. Chat radi samo na sajtovima koje ovde navedete.</p>
        {canEdit
          ? <SettingsForm settings={settings} save={save} />
          : (
            <p className={team.note}>
              {settings?.enabled ? `Uključeno na: ${settings.allowedOrigins.join(", ")}.` : "Chat na sajtu je isključen."}{" "}
              {isEditor ? "Izmene su dostupne posle dvofaktorske potvrde prijave." : "Chat uključuju vlasnik i administratori firme."}
            </p>
          )}
        {settings && canEdit && <EmbedCode code={embedCode(appOrigin, settings.publicId)} />}
      </section>

      <section className={team.panel} aria-labelledby="site-chat-safety">
        <h2 id="site-chat-safety"><ShieldCheck size={17} aria-hidden="true" />Zaštita od zloupotrebe</h2>
        <ul className={styles.list}>
          <li>Asistent odgovara samo o vašoj firmi i uslugama. Na matematiku, pisanje tekstova i slična pitanja ljubazno odbija.</li>
          <li>Posle {OFF_TOPIC_LIMIT} poruke zaredom koje nisu u vezi sa firmom razgovor se završava.</li>
          <li>Jedan razgovor ima najviše {MAX_SITE_CONVERSATION_MESSAGES} poruka, a jedna poruka najviše 500 znakova.</li>
          <li>Broj poruka sa jedne adrese je ograničen po minutu i po satu, a vaš dnevni limit važi za sve posetioce zajedno.</li>
          <li>Drugi sajtovi ne mogu da prikažu vaš chat niti da šalju poruke preko posetilaca.</li>
        </ul>
      </section>
    </>
  );
}
