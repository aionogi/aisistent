"use server";

import { revalidatePath } from "next/cache";
import { getCurrentAccount } from "../../../../../../lib/auth/account.ts";
import { mfaRequired } from "../../../../../../lib/auth/auth0.ts";
import { ForbiddenError, withOrganization } from "../../../../../../lib/db/context.ts";
import { getPool } from "../../../../../../lib/db/pool.ts";
import { SiteChatError, setSiteChat } from "../../../../../../lib/db/site-chat.ts";
import { actionLimit, actionLog } from "../../../../../../lib/operations/action-guard.ts";
import { MAX_DAILY_MESSAGE_LIMIT, MIN_DAILY_MESSAGE_LIMIT, parseOrigins } from "../../../../../../lib/site-chat/policy.ts";

/** `origins` are the stored websites after a successful save. */
export type SiteChatState = { error: string | null; saved: boolean; origins?: string[] };

const failed = (error: string): SiteChatState => ({ error, saved: false });

/**
 * Owners and admins turn the website chat on or off, list the websites that
 * may show it and set the firm's daily message limit. MFA when required; the
 * database checks the role and the values again.
 */
export async function saveSiteChatAction(organizationId: string, _previous: SiteChatState, formData: FormData): Promise<SiteChatState> {
  const account = await getCurrentAccount();
  const pool = getPool();
  if (!account || !pool) return failed("Sesija je istekla. Prijavite se ponovo.");
  const limitError = await actionLimit(pool, "site.settings", account.userId);
  if (limitError) return failed(limitError);
  if (mfaRequired() && !account.mfa) {
    await actionLog("site.settings", "denied");
    return failed("Za izmenu chata potrebna je prijava sa dvofaktorskom potvrdom.");
  }

  const enabled = formData.get("enabled") === "on";
  const parsed = parseOrigins(String(formData.get("origins") ?? "").slice(0, 2000));
  if ("error" in parsed) return failed(parsed.error);
  if (enabled && parsed.origins.length === 0) return failed("Upišite bar jedan sajt na kom se chat prikazuje.");
  const limitText = String(formData.get("dailyLimit") ?? "").trim();
  const dailyMessageLimit = Number(limitText);
  if (!/^\d{1,5}$/.test(limitText) || dailyMessageLimit < MIN_DAILY_MESSAGE_LIMIT || dailyMessageLimit > MAX_DAILY_MESSAGE_LIMIT) {
    return failed(`Dnevni limit mora biti broj od ${MIN_DAILY_MESSAGE_LIMIT} do ${MAX_DAILY_MESSAGE_LIMIT}.`);
  }

  try {
    await withOrganization(pool, { userId: account.userId, organizationId }, (client) => setSiteChat(client, { enabled, allowedOrigins: parsed.origins, dailyMessageLimit }));
  } catch (error) {
    const denied = error instanceof ForbiddenError || (error instanceof SiteChatError && error.code !== "invalid");
    await actionLog("site.settings", denied ? "denied" : "error", error);
    if (error instanceof ForbiddenError) return failed("Nemate pristup ovoj firmi.");
    if (error instanceof SiteChatError && error.code === "forbidden") return failed("Chat na sajtu menjaju vlasnik i administratori firme.");
    if (error instanceof SiteChatError && error.code === "invalid") return failed("Proverite adrese sajtova i dnevni limit.");
    return failed("Čuvanje trenutno nije moguće. Pokušajte ponovo kasnije.");
  }
  await actionLog("site.settings", "success");
  revalidatePath(`/org/${organizationId}/channels/`);
  return { error: null, saved: true, origins: parsed.origins };
}
