import { ChevronRight } from "lucide-react";
import type { Membership } from "../../lib/db/repositories.ts";
import { organizationHomePath } from "../../lib/workspace/entry.ts";
import styles from "./account.module.css";

// Kept here: a server component cannot read constants from the client module that also has them.
const ROLE_LABELS: Record<Membership["role"], string> = { owner: "Vlasnik", admin: "Administrator", member: "Član" };

/**
 * The signed-in person's organizations, each opening its workspace. Plain
 * links, not prefetched: opening a workspace loads that organization's data.
 */
export default function OrganizationList({ memberships }: { memberships: Membership[] }) {
  return (
    <ul className={styles.organizations}>
      {memberships.map((membership) => (
        <li key={membership.organizationId}>
          <a href={organizationHomePath(membership.organizationId)} className={styles.organizationLink}>
            <strong>{membership.organizationName}</strong>
            <span className={styles.role}>{ROLE_LABELS[membership.role]}<ChevronRight size={16} aria-hidden="true" /></span>
          </a>
        </li>
      ))}
    </ul>
  );
}
