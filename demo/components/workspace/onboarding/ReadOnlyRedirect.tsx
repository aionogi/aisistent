"use client";

import { useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";
import { useDraft } from "../DraftProvider";
import { DraftLoading } from "../StatusViews";
import { useWorkspaceEnvironment, workspacePath } from "../WorkspaceEnvironment";

/** Members who cannot edit are sent from guided setup back to the workspace overview. */
export default function ReadOnlyRedirect({ children }: { children: ReactNode }) {
  const { readOnly } = useDraft();
  const environment = useWorkspaceEnvironment();
  const router = useRouter();

  useEffect(() => {
    if (readOnly) router.replace(workspacePath(environment));
  }, [readOnly, router, environment]);

  return readOnly ? <DraftLoading label="Otvaranje radnog prostora…" /> : children;
}
