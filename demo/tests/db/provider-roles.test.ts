import assert from "node:assert/strict";
import { test } from "node:test";
import { migrate, PROVIDER_API_ROLES } from "../../lib/db/migrator.ts";
import { MIGRATIONS_DIR, startTestDatabase } from "./harness.ts";

// Every privilege any of these roles holds on the app's schema, its objects or the migration history.
const PRIVILEGES = `
  SELECT 'relation ' || n.nspname || '.' || c.relname AS object, pg_get_userbyid(a.grantee) AS role, a.privilege_type
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace, aclexplode(c.relacl) a
    WHERE (n.nspname = 'app' OR (n.nspname = 'public' AND c.relname = 'schema_migrations')) AND pg_get_userbyid(a.grantee) = ANY($1)
  UNION ALL
  SELECT 'routine ' || p.oid::regprocedure::text, pg_get_userbyid(a.grantee), a.privilege_type
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace, aclexplode(p.proacl) a
    WHERE n.nspname = 'app' AND pg_get_userbyid(a.grantee) = ANY($1)
  UNION ALL
  SELECT 'schema app', pg_get_userbyid(a.grantee), a.privilege_type
    FROM pg_namespace n, aclexplode(n.nspacl) a
    WHERE n.nspname = 'app' AND pg_get_userbyid(a.grantee) = ANY($1)
  ORDER BY 1, 2, 3`;

test("migrations leave the provider's API roles without privileges, even where defaults grant them everything", { timeout: 120_000 }, async (t) => {
  const db = await startTestDatabase({ migrate: false });
  t.after(() => db.stop());
  const roles = PROVIDER_API_ROLES.map((name) => db.admin.escapeIdentifier(name)).join(", ");
  for (const name of PROVIDER_API_ROLES) await db.admin.query(`CREATE ROLE ${db.admin.escapeIdentifier(name)} NOLOGIN`);
  // Like a provider that grants its API roles everything the owner creates, everywhere and in public.
  for (const kind of ["TABLES", "SEQUENCES", "FUNCTIONS"]) {
    await db.admin.query(`ALTER DEFAULT PRIVILEGES GRANT ALL ON ${kind} TO ${roles}`);
    await db.admin.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON ${kind} TO ${roles}`);
  }
  await db.admin.query(`GRANT USAGE ON SCHEMA public TO ${roles}`);

  const first = await migrate(db.admin, MIGRATIONS_DIR);
  assert.ok(first.applied.length > 0);
  assert.deepEqual(first.revokedFrom, [...PROVIDER_API_ROLES].sort());
  assert.deepEqual((await db.admin.query(PRIVILEGES, [PROVIDER_API_ROLES])).rows, []);

  // Granted again later, for example by hand: the next run takes it away even with nothing to apply.
  await db.admin.query(`GRANT SELECT ON public.schema_migrations TO ${roles}`);
  await db.admin.query(`GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA app TO ${roles}`);
  const again = await migrate(db.admin, MIGRATIONS_DIR);
  assert.deepEqual(again.applied, []);
  assert.deepEqual((await db.admin.query(PRIVILEGES, [PROVIDER_API_ROLES])).rows, []);
});

test("without the provider's roles the migrations revoke nothing", async (t) => {
  const db = await startTestDatabase({ migrate: false });
  t.after(() => db.stop());
  assert.deepEqual((await migrate(db.admin, MIGRATIONS_DIR)).revokedFrom, []);
});
