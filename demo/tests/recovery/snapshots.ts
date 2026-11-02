import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import type { Client } from "pg";

const digest = (value: string) => createHash("sha256").update(value).digest("hex");

type Queryable = Pick<Client, "query" | "escapeIdentifier">;

export type TableSnapshot = { table: string; count: number; sha256: string };

/** Row counts and digests of every application table and the migration history. */
export async function dataSnapshot(client: Queryable): Promise<TableSnapshot[]> {
  // Timestamps print in the session's time zone, which differs between a provider and this computer.
  // A numeric offset, because the bundled PostgreSQL on Windows has no time zone names.
  await client.query("SET TIME ZONE 0");
  const { rows: tables } = await client.query<{ schema: string; name: string }>(
    `SELECT schemaname AS schema, tablename AS name FROM pg_tables
     WHERE schemaname = 'app' OR (schemaname = 'public' AND tablename = 'schema_migrations')
     ORDER BY schemaname, tablename`,
  );
  const snapshot: TableSnapshot[] = [];
  for (const { schema, name } of tables) {
    const qualified = `${client.escapeIdentifier(schema)}.${client.escapeIdentifier(name)}`;
    const { rows } = await client.query<{ row: string }>(`SELECT to_jsonb(t)::text AS row FROM ${qualified} t ORDER BY to_jsonb(t)::text COLLATE "C"`);
    snapshot.push({ table: `${schema}.${name}`, count: rows.length, sha256: digest(JSON.stringify(rows)) });
  }
  return snapshot;
}

// The migration owner differs between databases (a provider's admin role, or
// whoever restored the copy), so it is compared as "<owner>". Grantors are left
// out for the same reason; who received which privilege is compared exactly. Text is
// sorted as "C": a provider's database may sort by a language (en_US), this copy does not.
const OWNER = "(SELECT nspowner FROM pg_namespace WHERE nspname = 'app')";
const role = (column: string) => `CASE WHEN ${column} = 0 THEN 'PUBLIC' WHEN ${column} = ${OWNER} THEN '<owner>' ELSE pg_get_userbyid(${column}) END`;
// A NULL ACL means the default privileges, which pg_restore may produce from an explicit owner-only ACL.
const acl = (column: string, kind: string, owner: string) => `(SELECT coalesce(array_agg(entry ORDER BY entry COLLATE "C"), '{}') FROM (
    SELECT format('%s=%s%s', ${role("a.grantee")}, a.privilege_type, CASE WHEN a.is_grantable THEN '*' ELSE '' END) AS entry
    FROM aclexplode(coalesce(${column}, acldefault(${kind}, ${owner}))) a) entries)`;

/** Ownership, privileges, RLS policies, function bodies, constraints and indexes of the application schema. */
export async function securitySnapshot(client: Queryable): Promise<Record<string, unknown[]>> {
  const queries = {
    relations: `SELECT n.nspname AS schema, c.relname, c.relkind, c.relrowsecurity, c.relforcerowsecurity,
      ${role("c.relowner")} AS owner,
      ${acl("c.relacl", `(CASE WHEN c.relkind = 'S' THEN 's' ELSE 'r' END)::"char"`, "c.relowner")} AS acl
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'app' OR (n.nspname = 'public' AND c.relname IN ('schema_migrations', 'schema_migrations_pkey'))
      ORDER BY n.nspname, c.relname`,
    schema: `SELECT n.nspname, ${role("n.nspowner")} AS owner, ${acl("n.nspacl", `'n'::"char"`, "n.nspowner")} AS acl
      FROM pg_namespace n WHERE n.nspname = 'app'`,
    policies: `SELECT * FROM pg_policies WHERE schemaname = 'app' ORDER BY tablename, policyname`,
    functions: `SELECT p.oid::regprocedure::text AS signature, pg_get_functiondef(p.oid) AS definition,
      ${role("p.proowner")} AS owner, ${acl("p.proacl", `'f'::"char"`, "p.proowner")} AS acl
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'app' ORDER BY p.oid::regprocedure::text COLLATE "C"`,
    constraints: `SELECT c.conrelid::regclass::text AS relation, c.conname, pg_get_constraintdef(c.oid) AS definition
      FROM pg_constraint c JOIN pg_namespace n ON n.oid = c.connamespace WHERE n.nspname = 'app' ORDER BY c.conrelid::regclass::text COLLATE "C", c.conname`,
    indexes: `SELECT tablename, indexname, indexdef FROM pg_indexes WHERE schemaname = 'app' ORDER BY tablename, indexname`,
  };
  const result: Record<string, unknown[]> = {};
  for (const [key, sql] of Object.entries(queries)) result[key] = (await client.query(sql)).rows;
  return result;
}

type Row = Record<string, unknown>;

const KEYS: Record<string, (row: Row) => string> = {
  relations: (row) => `${row.schema}.${row.relname}`,
  schema: (row) => String(row.nspname),
  policies: (row) => `${row.schemaname}.${row.tablename}.${row.policyname}`,
  functions: (row) => String(row.signature),
  constraints: (row) => `${row.relation}.${row.conname}`,
  indexes: (row) => `${row.tablename}.${row.indexname}`,
};
const TEXT_FIELDS = new Set(["definition", "qual", "with_check", "indexdef"]);

function firstDifferentLine(live: string, copy: string): string {
  const [a, b] = [live.split("\n"), copy.split("\n")];
  for (let index = 0; index < Math.max(a.length, b.length); index++) {
    if (a[index] !== b[index]) return `line ${index + 1}: live ${JSON.stringify((a[index] ?? "").trim().slice(0, 160))}, copy ${JSON.stringify((b[index] ?? "").trim().slice(0, 160))}`;
  }
  return "no line";
}

/**
 * What differs between the live and the restored access rules, by object and
 * property. Only schema definitions appear here, never table rows.
 */
export function describeChanges(copy: Record<string, unknown[]>, live: Record<string, unknown[]>, limit = 12): string[] {
  const changes: string[] = [];
  for (const section of Object.keys(live)) {
    const key = KEYS[section] ?? ((row: Row) => JSON.stringify(row));
    const before = new Map((live[section] as Row[]).map((row) => [key(row), row]));
    const after = new Map(((copy[section] ?? []) as Row[]).map((row) => [key(row), row]));
    for (const [name, row] of before) {
      const other = after.get(name);
      if (!other) {
        changes.push(`${section} ${name}: missing in the copy`);
        continue;
      }
      for (const field of Object.keys(row)) {
        if (isDeepStrictEqual(row[field], other[field])) continue;
        changes.push(TEXT_FIELDS.has(field) && typeof row[field] === "string" && typeof other[field] === "string"
          ? `${section} ${name}: ${field} differs at ${firstDifferentLine(row[field] as string, other[field] as string)}`
          : `${section} ${name}: ${field} live ${JSON.stringify(row[field])}, copy ${JSON.stringify(other[field])}`);
      }
    }
    for (const name of after.keys()) if (!before.has(name)) changes.push(`${section} ${name}: only in the copy`);
  }
  return changes.length > limit ? [...changes.slice(0, limit), `… and ${changes.length - limit} more`] : changes;
}

/** Roles other than the owner and PUBLIC that hold a privilege or appear in a policy. */
export function granteesOf(security: Record<string, unknown[]>): string[] {
  const names = new Set<string>();
  for (const key of ["relations", "schema", "functions"]) {
    for (const row of security[key] as { acl: string[] }[]) {
      for (const entry of row.acl) names.add(entry.slice(0, entry.lastIndexOf("=")));
    }
  }
  for (const policy of security.policies as { roles: string[] | string }[]) {
    const roles = Array.isArray(policy.roles) ? policy.roles : String(policy.roles).replace(/^\{|\}$/g, "").split(",");
    for (const name of roles) names.add(name);
  }
  for (const name of ["<owner>", "PUBLIC", "public", ""]) names.delete(name);
  return [...names].sort();
}
