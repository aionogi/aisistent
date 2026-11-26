import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import ChannelsView from "../../../../../../components/workspace/views/ChannelsView";
import { assistantConfig } from "../../../../../../lib/assistant/config.ts";
import { getCurrentAccount } from "../../../../../../lib/auth/account.ts";
import { mfaRequired } from "../../../../../../lib/auth/auth0.ts";
import { canManage, ForbiddenError, withOrganization } from "../../../../../../lib/db/context.ts";
import { getPool } from "../../../../../../lib/db/pool.ts";
import { getSiteChatSettings } from "../../../../../../lib/db/site-chat.ts";
import { saveSiteChatAction } from "./actions.ts";

export const metadata: Metadata = { title: "Kanali — aisistent" };

/** The address firms' websites load the widget from: the configured public address, or the one this page was opened at. */
async function appOrigin(): Promise<string> {
  try {
    if (process.env.APP_BASE_URL) return new URL(process.env.APP_BASE_URL).origin;
  } catch {
    // Fall back to the request's own address.
  }
  const list = await headers();
  const host = list.get("x-forwarded-host") ?? list.get("host") ?? "localhost";
  const protocol = list.get("x-forwarded-proto") ?? (host.startsWith("127.0.0.1") || host.startsWith("localhost") ? "http" : "https");
  return `${protocol}://${host}`;
}

export default async function ChannelsPage({ params }: PageProps<"/org/[organizationId]/channels">) {
  const { organizationId } = await params;
  const account = await getCurrentAccount();
  const pool = getPool();
  if (!account || !pool) redirect("/account/");

  let data;
  try {
    data = await withOrganization(pool, { userId: account.userId, organizationId }, async (client, role) => ({ role, settings: await getSiteChatSettings(client) }));
  } catch (error) {
    if (error instanceof ForbiddenError) notFound();
    throw error;
  }
  const settings = data.settings;
  return (
    <ChannelsView
      canEdit={canManage(data.role) && (account.mfa || !mfaRequired())}
      isEditor={canManage(data.role)}
      assistantEnabled={assistantConfig() !== null}
      appOrigin={await appOrigin()}
      settings={settings ? { publicId: settings.publicId, enabled: settings.enabled, allowedOrigins: settings.allowedOrigins, dailyMessageLimit: settings.dailyMessageLimit } : null}
      save={saveSiteChatAction.bind(null, organizationId)}
    />
  );
}
