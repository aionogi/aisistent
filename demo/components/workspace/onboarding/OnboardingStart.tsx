"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { firstIncompleteStep, onboardingHref } from "../../../lib/workspace/steps";
import { useDraft } from "../DraftProvider";
import { useWorkspaceEnvironment } from "../WorkspaceEnvironment";
import { DraftLoading } from "../StatusViews";

/** The onboarding root resumes at the first step that still needs input. */
export default function OnboardingStart() {
  const { draft, ready } = useDraft();
  const { onboardingBasePath } = useWorkspaceEnvironment();
  const router = useRouter();

  useEffect(() => {
    if (ready) router.replace(onboardingHref(firstIncompleteStep(draft), onboardingBasePath));
  }, [ready, draft, router, onboardingBasePath]);

  return <DraftLoading label="Otvaranje podešavanja…" />;
}
