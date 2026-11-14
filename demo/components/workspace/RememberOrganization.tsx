"use client";

import { useEffect } from "react";
import { rememberOrganizationCookie } from "../../lib/workspace/entry.ts";

/**
 * Remembers on this device that the organization's workspace was opened, so
 * the next sign-in returns here (see lib/workspace/entry.ts).
 *
 * Written in the browser once the page is actually shown: the proxy cannot
 * tell a link prefetch from a visit, so a cookie set there would follow
 * prefetched links to other organizations.
 */
export default function RememberOrganization({ organizationId }: { organizationId: string }) {
  useEffect(() => {
    document.cookie = rememberOrganizationCookie(organizationId, window.location.protocol === "https:");
  }, [organizationId]);
  return null;
}
