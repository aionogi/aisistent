/**
 * Where a signed-in person enters the product: `/app/` sends them to their
 * own organization's workspace, never to the demo.
 *
 * The last organization opened on this device is remembered in a cookie that
 * holds only its id. The cookie is a convenience, not an authorization: the
 * entry page uses it only when the id is one of the person's current
 * memberships, which it reads from the database on every visit.
 */

/** Where sign-in returns by default, and the home page's sign-in link. */
export const APP_HOME_PATH = "/app/";

export const LAST_ORGANIZATION_COOKIE = "aisistent_last_org";

/** 90 days: long enough to skip the choice on a regular device, short enough to fade on a forgotten one. */
export const LAST_ORGANIZATION_MAX_AGE_SECONDS = 90 * 24 * 60 * 60;

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** True for a well-formed organization id; anything else from a URL or cookie is ignored. */
export function isOrganizationId(value: unknown): value is string {
  return typeof value === "string" && uuidPattern.test(value);
}

export type EntryDecision =
  | { kind: "create" }
  | { kind: "open"; organizationId: string }
  | { kind: "choose" };

/**
 * No organization: create one. One: open it. Several: open the remembered one
 * when it is still among them, otherwise let the person choose.
 */
export function chooseEntry(memberships: readonly { organizationId: string }[], remembered: string | undefined): EntryDecision {
  if (memberships.length === 0) return { kind: "create" };
  if (memberships.length === 1) return { kind: "open", organizationId: memberships[0].organizationId };
  const match = isOrganizationId(remembered)
    ? memberships.find((membership) => membership.organizationId.toLowerCase() === remembered.toLowerCase())
    : undefined;
  return match ? { kind: "open", organizationId: match.organizationId } : { kind: "choose" };
}

/** Workspace root of an organization. */
export function organizationHomePath(organizationId: string): string {
  return `/org/${organizationId}/`;
}

/** `document.cookie` value that remembers an organization on this device; Secure on HTTPS. */
export function rememberOrganizationCookie(organizationId: string, secure: boolean): string {
  if (!isOrganizationId(organizationId)) throw new Error("Not an organization id");
  return `${LAST_ORGANIZATION_COOKIE}=${organizationId}; Path=/; Max-Age=${LAST_ORGANIZATION_MAX_AGE_SECONDS}; SameSite=Lax${secure ? "; Secure" : ""}`;
}

/** `Set-Cookie` value that forgets the remembered organization, sent with sign-out. */
export function forgetOrganizationCookie(secure: boolean): string {
  return `${LAST_ORGANIZATION_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax${secure ? "; Secure" : ""}`;
}
