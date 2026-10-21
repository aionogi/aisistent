import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { Notice } from "../../../../../../components/workspace/FormControls";
import { PageHeader } from "../../../../../../components/workspace/PageParts";
import styles from "../../../../../../components/workspace/team/team.module.css";
import { getCurrentAccount } from "../../../../../../lib/auth/account.ts";
import { canManage, ForbiddenError, withOrganization } from "../../../../../../lib/db/context.ts";
import { getPool } from "../../../../../../lib/db/pool.ts";
import { getAuditLog, type AuditEntry } from "../../../../../../lib/db/team.ts";

export const metadata: Metadata = { title: "Aktivnost — aisistent" };

const ACTION_LABELS: Record<string, string> = {
  "organization.create": "Firma je napravljena",
  "workspace.save": "Podešavanje je sačuvano",
  "invitation.create": "Poziv je napravljen",
  "invitation.revoke": "Poziv je opozvan",
  "invitation.accept": "Poziv je prihvaćen",
  "member.role_change": "Uloga je promenjena",
  "member.remove": "Član je uklonjen",
};

const RESULT_LABELS: Record<string, string> = { success: "Uspešno", denied: "Odbijeno", error: "Greška" };

const timeFormat = new Intl.DateTimeFormat("sr-Latn-RS", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Belgrade" });

/** Organization audit log for owners and admins; members see an explanation instead. */
export default async function ActivityPage({ params }: PageProps<"/org/[organizationId]/activity">) {
  const { organizationId } = await params;
  const account = await getCurrentAccount();
  const pool = getPool();
  if (!account || !pool) redirect("/account/");

  let entries: AuditEntry[] | null;
  try {
    entries = await withOrganization(pool, { userId: account.userId, organizationId }, async (client, role) => (canManage(role) ? getAuditLog(client, 100) : null));
  } catch (error) {
    if (error instanceof ForbiddenError) notFound();
    throw error;
  }

  return (
    <>
      <PageHeader title="Aktivnost" badge="Podaci firme" description="Poslednjih 100 važnih izmena u firmi: tim, pozivi i podešavanje. Automatsko čuvanje se beleži najviše jednom u 15 minuta po osobi." />
      {entries === null ? (
        <Notice tone="info">Aktivnost firme vide vlasnik i administratori.</Notice>
      ) : entries.length === 0 ? (
        <Notice tone="info">Još nema zabeleženih izmena.</Notice>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr><th scope="col">Vreme</th><th scope="col">Ko</th><th scope="col">Izmena</th><th scope="col">Ishod</th></tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <tr key={entry.id}>
                  <td className={styles.time}>{timeFormat.format(entry.createdAt)}</td>
                  <td>{entry.actorName ?? "Nepoznat korisnik"}</td>
                  <td>{ACTION_LABELS[entry.action] ?? entry.action}</td>
                  <td>{RESULT_LABELS[entry.result] ?? entry.result}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
