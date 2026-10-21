"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { MemberRole } from "../../lib/db/context.ts";

/**
 * Where the shared workspace screens are running:
 * - `demo`: example data in this browser tab (`/workspace/`, `/onboarding/`);
 * - `organization`: a signed-in organization's data, saved on the server (`/org/<id>/`).
 */
export type WorkspaceEnvironment = {
  mode: "demo" | "organization";
  /** Workspace root without a trailing slash, e.g. `/workspace` or `/org/<id>`. */
  basePath: string;
  /** Onboarding root without a trailing slash. */
  onboardingBasePath: string;
  organizationName?: string;
  role?: MemberRole;
  /** Set by the server when this privileged session needs MFA before editing. */
  stepUpPath?: string;
};

export const DEMO_ENVIRONMENT: WorkspaceEnvironment = { mode: "demo", basePath: "/workspace", onboardingBasePath: "/onboarding" };

const EnvironmentContext = createContext<WorkspaceEnvironment>(DEMO_ENVIRONMENT);

export function WorkspaceEnvironmentProvider({ value, children }: { value: WorkspaceEnvironment; children: ReactNode }) {
  return <EnvironmentContext.Provider value={value}>{children}</EnvironmentContext.Provider>;
}

export function useWorkspaceEnvironment(): WorkspaceEnvironment {
  return useContext(EnvironmentContext);
}

/** Path to a workspace page, e.g. `workspacePath(env, "knowledge")` → `/workspace/knowledge/`. */
export function workspacePath(environment: WorkspaceEnvironment, page = ""): string {
  return page ? `${environment.basePath}/${page}/` : `${environment.basePath}/`;
}

export const ROLE_LABELS: Record<MemberRole, string> = { owner: "Vlasnik", admin: "Administrator", member: "Član" };
