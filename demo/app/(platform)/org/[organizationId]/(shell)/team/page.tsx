import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import TeamView from "../../../../../../components/workspace/team/TeamView";
import { getCurrentAccount } from "../../../../../../lib/auth/account.ts";
import { mfaRequired } from "../../../../../../lib/auth/auth0.ts";
import { ForbiddenError, withOrganization } from "../../../../../../lib/db/context.ts";
import { getPool } from "../../../../../../lib/db/pool.ts";
import { listInvitations, listMembers } from "../../../../../../lib/db/team.ts";
import { changeRoleAction, inviteMemberAction, removeMemberAction, revokeInvitationAction } from "./actions.ts";

export const metadata: Metadata = { title: "Tim — aisistent" };

export default async function TeamPage({ params }: PageProps<"/org/[organizationId]/team">) {
  const { organizationId } = await params;
  const account = await getCurrentAccount();
  const pool = getPool();
  if (!account || !pool) redirect("/account/");

  let data;
  try {
    data = await withOrganization(pool, { userId: account.userId, organizationId }, async (client, role) => ({
      role,
      members: await listMembers(client),
      invitations: role === "owner" ? await listInvitations(client) : [],
    }));
  } catch (error) {
    if (error instanceof ForbiddenError) notFound();
    throw error;
  }

  return (
    <TeamView
      currentUserId={account.userId}
      role={data.role}
      canChange={data.role === "owner" && (account.mfa || !mfaRequired())}
      members={data.members.map((member) => ({ ...member, joinedAt: member.joinedAt.toISOString() }))}
      invitations={data.invitations.map((invitation) => ({
        id: invitation.id,
        email: invitation.email,
        role: invitation.role,
        expiresAt: invitation.expiresAt.toISOString(),
        status: invitation.acceptedAt ? "accepted" : invitation.revokedAt ? "revoked" : invitation.expiresAt <= new Date() ? "expired" : "pending",
      }))}
      actions={{
        invite: inviteMemberAction.bind(null, organizationId),
        revoke: revokeInvitationAction.bind(null, organizationId),
        changeRole: changeRoleAction.bind(null, organizationId),
        remove: removeMemberAction.bind(null, organizationId),
      }}
    />
  );
}
