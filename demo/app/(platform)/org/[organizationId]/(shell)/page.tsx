import { notFound, redirect } from "next/navigation";
import OrganizationOverviewView from "../../../../../components/workspace/views/OrganizationOverviewView";
import { getCurrentAccount } from "../../../../../lib/auth/account.ts";
import { ForbiddenError, withOrganization } from "../../../../../lib/db/context.ts";
import { countConversations, listConversations } from "../../../../../lib/db/conversations.ts";
import { getPool } from "../../../../../lib/db/pool.ts";
import { listInvitations, listMembers } from "../../../../../lib/db/team.ts";
import { dayInBelgrade } from "../../../../../lib/workspace/format.ts";

/** The organization's own overview: only real numbers, unlike the demo's illustrated one. */
export default async function OrganizationOverviewPage({ params }: PageProps<"/org/[organizationId]">) {
  const { organizationId } = await params;
  const account = await getCurrentAccount();
  const pool = getPool();
  if (!account || !pool) redirect("/account/");

  let data;
  try {
    data = await withOrganization(pool, { userId: account.userId, organizationId }, async (client, role) => {
      const invitations = role === "owner" ? await listInvitations(client) : [];
      const now = Date.now();
      return {
        members: (await listMembers(client)).length,
        pendingInvitations: invitations.filter((invitation) => !invitation.acceptedAt && !invitation.revokedAt && invitation.expiresAt.getTime() > now).length,
        conversationCount: await countConversations(client),
        recent: await listConversations(client, 3),
      };
    });
  } catch (error) {
    if (error instanceof ForbiddenError) notFound();
    throw error;
  }

  return (
    <OrganizationOverviewView
      today={dayInBelgrade(new Date())}
      members={data.members}
      pendingInvitations={data.pendingInvitations}
      conversationCount={data.conversationCount}
      recent={data.recent.map((row) => ({ ...row, startedAt: row.startedAt.toISOString(), endedAt: row.endedAt?.toISOString() ?? null }))}
    />
  );
}
