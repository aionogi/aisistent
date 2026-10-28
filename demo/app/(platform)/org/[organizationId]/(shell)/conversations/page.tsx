import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import ConversationsView from "../../../../../../components/workspace/views/ConversationsView";
import StoredConversationsView from "../../../../../../components/workspace/views/StoredConversationsView";
import { getCurrentAccount } from "../../../../../../lib/auth/account.ts";
import { mfaRequired } from "../../../../../../lib/auth/auth0.ts";
import { canManage, ForbiddenError, withOrganization } from "../../../../../../lib/db/context.ts";
import { getConversationMessages, getConversationRetention, listConversations } from "../../../../../../lib/db/conversations.ts";
import { getPool } from "../../../../../../lib/db/pool.ts";
import { deleteConversationAction } from "./actions.ts";

export const metadata: Metadata = { title: "Razgovori — aisistent" };

/** Stored conversations when the assistant has recorded any (M4 adds the recording); otherwise the examples built from the configuration. */
export default async function OrganizationConversationsPage({ params, searchParams }: PageProps<"/org/[organizationId]/conversations">) {
  const { organizationId } = await params;
  const { c } = await searchParams;
  const account = await getCurrentAccount();
  const pool = getPool();
  if (!account || !pool) redirect("/account/");

  let data;
  try {
    data = await withOrganization(pool, { userId: account.userId, organizationId }, async (client, role) => {
      const conversations = await listConversations(client);
      const selectedId = (typeof c === "string" && conversations.some((row) => row.id === c) ? c : conversations[0]?.id) ?? "";
      return {
        role,
        conversations,
        selectedId,
        messages: selectedId ? await getConversationMessages(client, selectedId) : [],
        retentionDays: (await getConversationRetention(client)) ?? 90,
      };
    });
  } catch (error) {
    if (error instanceof ForbiddenError) notFound();
    throw error;
  }

  if (data.conversations.length === 0) return <ConversationsView />;
  return (
    <StoredConversationsView
      conversations={data.conversations.map((row) => ({ ...row, startedAt: row.startedAt.toISOString(), endedAt: row.endedAt?.toISOString() ?? null }))}
      selectedId={data.selectedId}
      messages={data.messages.map(({ speaker, body }) => ({ speaker, body }))}
      retentionDays={data.retentionDays}
      basePath={`/org/${organizationId}/conversations/`}
      canDelete={canManage(data.role) && (account.mfa || !mfaRequired())}
      remove={deleteConversationAction.bind(null, organizationId)}
    />
  );
}
