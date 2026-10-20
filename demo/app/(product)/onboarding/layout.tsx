import type { Metadata } from "next";
import OnboardingFrame from "../../../components/workspace/onboarding/OnboardingFrame";

export const metadata: Metadata = { title: "Podešavanje asistenta — aisistent demo" };

export default function OnboardingLayout({ children }: LayoutProps<"/onboarding">) {
  return <OnboardingFrame>{children}</OnboardingFrame>;
}
