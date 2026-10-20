"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { firstIncompleteStep, onboardingHref } from "../../../lib/workspace/steps";
import { useDraft } from "../DraftProvider";
import { DraftLoading } from "../StatusViews";

/** `/onboarding/` resumes at the first step that still needs input. */
export default function OnboardingStart() {
  const { draft, ready } = useDraft();
  const router = useRouter();

  useEffect(() => {
    if (ready) router.replace(onboardingHref(firstIncompleteStep(draft)));
  }, [ready, draft, router]);

  return <DraftLoading label="Otvaranje podešavanja…" />;
}
