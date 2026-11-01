import type { EmailMessage } from "./lettermint.ts";

const ROLE_LABELS = { admin: "administrator", member: "član" } as const;
const NAME_LIMIT = 80;
// Mail programs turn these into links, so a firm's name must not contain them: anyone can name a firm and invite any address.
const LINK_LIKE = /:\/\/|www\.|@|[\p{L}\p{N}-]+\.\p{L}{2,}/iu;

/** The firm's name as plain text, or null when it could read as a link. */
export function safeFirmName(name: string): string | null {
  const clean = name.replace(/[\p{C}\s]+/gu, " ").trim().slice(0, NAME_LIMIT).trim();
  return clean && !LINK_LIKE.test(clean) ? clean : null;
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (character) => `&#${character.charCodeAt(0)};`);
}

export function invitationEmail(input: { to: string; organizationName: string; role: "admin" | "member"; link: string; validDays: number }): EmailMessage {
  const firm = safeFirmName(input.organizationName);
  const role = ROLE_LABELS[input.role];
  const note = `Poziv važi ${input.validDays} dana i može ga iskoristiti samo nalog sa potvrđenom adresom na koju je poslat. Ako ga niste očekivali, slobodno zanemarite ovaj email.`;
  const lead = (name: string) => `Pozvani ste da se pridružite ${name} na aisistent-u, kao ${role}.`;
  const link = escapeHtml(input.link);

  return {
    to: input.to,
    subject: firm ? `Poziv u firmu ${firm} na aisistent-u` : "Poziv u firmu na aisistent-u",
    text: `${lead(firm ? `firmi ${firm}` : "jednoj firmi")}\n\nPrihvatite poziv na ovoj adresi:\n${input.link}\n\n${note}\n`,
    html: `<!doctype html><html lang="sr-Latn"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head><body style="margin:0 auto;padding:24px;max-width:560px;background:#ffffff;color:#142038;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.5">
<p style="margin:0 0 20px">${lead(firm ? `firmi <strong>${escapeHtml(firm)}</strong>` : "jednoj firmi")}</p>
<p style="margin:0 0 20px"><a href="${link}" style="display:inline-block;padding:12px 20px;border-radius:8px;background:#2159e8;color:#ffffff;font-weight:bold;text-decoration:none">Prihvatite poziv</a></p>
<p style="margin:0 0 20px;color:#62708a;font-size:14px;overflow-wrap:anywhere">Ako dugme ne radi, otvorite ovu adresu:<br>${link}</p>
<p style="margin:0;color:#62708a;font-size:14px">${escapeHtml(note)}</p>
</body></html>`,
  };
}
