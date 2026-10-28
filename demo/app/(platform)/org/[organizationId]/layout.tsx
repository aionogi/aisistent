import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import OrganizationDraftProvider from "../../../../components/workspace/OrganizationDraftProvider";
import { WorkspaceEnvironmentProvider, type WorkspaceEnvironment } from "../../../../components/workspace/WorkspaceEnvironment";
import { getCurrentAccount } from "../../../../lib/auth/account.ts";
import { getAuth0, mfaRequired, mfaStepUpPath } from "../../../../lib/auth/auth0.ts";
import { canManage, ForbiddenError, withOrganization } from "../../../../lib/db/context.ts";
import { getPool } from "../../../../lib/db/pool.ts";
import { getAssistantConfig, getOrganizationName, listKnowledge } from "../../../../lib/db/repositories.ts";
import { draftFromStored } from "../../../../lib/workspace/persistence.ts";
import { importKnowledgeFromUrlAction, saveWorkspaceAction } from "./actions.ts";

export const metadata: Metadata = { title: "Radni prostor firme — aisistent" };

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Loads one organization for a signed-in member and provides it to the shared
 * workspace screens. Non-members and unknown ids get the same 404, so the
 * page does not reveal which organizations exist.
 */
export default async function OrganizationLayout({ children, params }: LayoutProps<"/org/[organizationId]">) {
  const { organizationId } = await params;
  if (!uuidPattern.test(organizationId)) notFound();
  const pool = getPool();
  if (!getAuth0() || !pool) redirect("/account/");
  const account = await getCurrentAccount();
  if (!account) redirect(`/auth/login?returnTo=${encodeURIComponent(`/org/${organizationId}/`)}`);

  let loaded;
  try {
    loaded = await withOrganization(pool, { userId: account.userId, organizationId }, async (client, role) => ({
      role,
      name: await getOrganizationName(client),
      config: await getAssistantConfig(client),
      knowledge: await listKnowledge(client),
    }));
  } catch (error) {
    if (error instanceof ForbiddenError) notFound();
    throw error;
  }

  const draft = draftFromStored(loaded.config?.config ?? null, loaded.knowledge, loaded.config?.updatedAt ?? null);
  // A stored document in an unexpected shape is not overwritten from the editor.
  if (!draft) throw new Error("The organization's stored configuration does not match the current format.");

  const environment: WorkspaceEnvironment = {
    mode: "organization",
    basePath: `/org/${organizationId}`,
    onboardingBasePath: `/org/${organizationId}/onboarding`,
    organizationName: loaded.name ?? undefined,
    role: loaded.role,
    stepUpPath: canManage(loaded.role) && mfaRequired() && !account.mfa ? mfaStepUpPath(`/org/${organizationId}/`) : undefined,
    importFromUrl: importKnowledgeFromUrlAction.bind(null, organizationId),
  };

  return (
    <WorkspaceEnvironmentProvider value={environment}>
      <OrganizationDraftProvider
        initialDraft={draft}
        initialRevision={loaded.config?.revision ?? 0}
        readOnly={!canManage(loaded.role) || (mfaRequired() && !account.mfa)}
        save={saveWorkspaceAction.bind(null, organizationId)}
      >
        {children}
      </OrganizationDraftProvider>
    </WorkspaceEnvironmentProvider>
  );
}
