import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import OrganizationView from "../../../../../../components/workspace/team/OrganizationView";
import { getCurrentAccount } from "../../../../../../lib/auth/account.ts";
import { mfaRequired } from "../../../../../../lib/auth/auth0.ts";
import { ForbiddenError, withOrganization } from "../../../../../../lib/db/context.ts";
import { getPool } from "../../../../../../lib/db/pool.ts";
import { getOrganizationName } from "../../../../../../lib/db/repositories.ts";
import { listMembers } from "../../../../../../lib/db/team.ts";
import { deleteOrganizationAction, leaveOrganizationAction } from "./actions.ts";

export const metadata: Metadata = { title: "Firma — aisistent" };

export default async function OrganizationPage({ params }: PageProps<"/org/[organizationId]/settings">) {
  const { organizationId } = await params;
  const account = await getCurrentAccount();
  const pool = getPool();
  if (!account || !pool) redirect("/account/");

  let data;
  try {
    data = await withOrganization(pool, { userId: account.userId, organizationId }, async (client, role) => ({
      role,
      name: (await getOrganizationName(client)) ?? "",
      owners: (await listMembers(client)).filter((member) => member.role === "owner").length,
    }));
  } catch (error) {
    if (error instanceof ForbiddenError) notFound();
    throw error;
  }

  return (
    <OrganizationView
      organizationName={data.name}
      role={data.role}
      canManageData={data.role === "owner" && (account.mfa || !mfaRequired())}
      lastOwner={data.role === "owner" && data.owners <= 1}
      exportHref={`/org/${organizationId}/export/`}
      actions={{
        leave: leaveOrganizationAction.bind(null, organizationId),
        remove: deleteOrganizationAction.bind(null, organizationId),
      }}
    />
  );
}
