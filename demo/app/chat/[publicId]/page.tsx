import type { Metadata } from "next";
import SiteChat from "../../../components/site-chat/SiteChat";
import { assistantConfig } from "../../../lib/assistant/config.ts";
import { getPool } from "../../../lib/db/pool.ts";
import { openSiteChat } from "../../../lib/db/site-chat.ts";
import { isPublicId } from "../../../lib/site-chat/policy.ts";
import { draftFromStored } from "../../../lib/workspace/persistence.ts";

export const metadata: Metadata = { title: "Chat — aisistent", robots: { index: false, follow: false } };

type Widget = { assistantName: string; businessName: string; greeting: string } | null;

/** Only the names and the greeting reach the browser; the firm's settings stay on the server. */
async function loadWidget(publicId: string): Promise<Widget> {
  const pool = getPool();
  if (!pool || !assistantConfig() || !isPublicId(publicId)) return null;
  try {
    const open = await openSiteChat(pool, publicId);
    const draft = open ? draftFromStored(open.config, open.knowledge, open.configUpdatedAt) : null;
    if (!draft) return null;
    return {
      assistantName: draft.assistant.name.trim() || "Asistent",
      businessName: draft.business.name.trim(),
      greeting: draft.assistant.greeting.trim(),
    };
  } catch {
    return null;
  }
}

/**
 * The chat that a firm's website shows in a frame (public/widget.js). Which
 * websites may frame it is set per firm in proxy.ts; a chat that is off or
 * unknown shows a short notice instead.
 */
export default async function SiteChatPage({ params }: PageProps<"/chat/[publicId]">) {
  const { publicId } = await params;
  const widget = await loadWidget(publicId);
  return (
    <main>
      {widget
        ? <SiteChat publicId={publicId} {...widget} />
        : (
          <section className="status-page" aria-labelledby="chat-unavailable">
            <div className="status-card">
              <h1 id="chat-unavailable">Chat trenutno nije dostupan</h1>
              <p>Kontaktirajte firmu telefonom ili e-poštom.</p>
            </div>
          </section>
        )}
    </main>
  );
}
