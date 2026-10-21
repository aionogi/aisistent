import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import pg, { type PoolClient } from "pg";
import { ForbiddenError, withOrganization, withUser } from "../../lib/db/context.ts";
import { migrate } from "../../lib/db/migrator.ts";
import {
  addKnowledge,
  ConflictError,
  createOrganization,
  deleteKnowledge,
  getAssistantConfig,
  listKnowledge,
  listMemberships,
  provisionUser,
  recordAudit,
  saveAssistantConfig,
  updateKnowledge,
} from "../../lib/db/repositories.ts";
import { MIGRATIONS_DIR, startTestDatabase, type TestDatabase } from "./harness.ts";

/**
 * Expects `work` to fail inside a savepoint, so the surrounding transaction
 * stays usable for the next assertion (a failed statement aborts it otherwise).
 */
async function rejectsInSavepoint(client: PoolClient, work: () => Promise<unknown>, expected: RegExp | ((error: Error) => boolean)): Promise<void> {
  await client.query("SAVEPOINT expected_failure");
  await assert.rejects(work(), expected);
  await client.query("ROLLBACK TO SAVEPOINT expected_failure");
}

// Two organizations: Alice owns A, Bob owns B, Carol is a plain member of A.
let db: TestDatabase;
let alice: string, bob: string, carol: string;
let orgA: string, orgB: string;
let knowledgeB: string;

before(async () => {
  db = await startTestDatabase();
  alice = await provisionUser(db.appPool, { subject: "auth0|alice", email: "alice@example.test", displayName: "Alice" });
  bob = await provisionUser(db.appPool, { subject: "auth0|bob", email: "bob@example.test", displayName: "Bob" });
  carol = await provisionUser(db.appPool, { subject: "auth0|carol", email: "carol@example.test", displayName: null });
  orgA = await createOrganization(db.appPool, alice, "Studio Mila");
  orgB = await createOrganization(db.appPool, bob, "Servis Jovanović");
  // Invitations are not built yet; the owner connection adds Carol directly.
  await db.admin.query("INSERT INTO app.memberships (organization_id, user_id, role) VALUES ($1, $2, 'member')", [orgA, carol]);

  await withOrganization(db.appPool, { userId: alice, organizationId: orgA }, async (client) => {
    await saveAssistantConfig(client, { business: { name: "Studio Mila" } }, 0);
    await addKnowledge(client, { question: "Da li je potrebno zakazivanje?", answer: "Preporučujemo zakazivanje." });
  });
  knowledgeB = await withOrganization(db.appPool, { userId: bob, organizationId: orgB }, async (client) => {
    await saveAssistantConfig(client, { business: { name: "Servis Jovanović" } }, 0);
    return addKnowledge(client, { question: "Da li čuvate gume?", answer: "Da, sezonski." });
  });
});

after(async () => {
  await db?.stop();
});

describe("database roles", () => {
  test("the application connects as a non-owner role without BYPASSRLS", async () => {
    const { rows } = await db.appPool.query(
      `SELECT current_user AS name, r.rolbypassrls AS bypass, r.rolsuper AS super,
              pg_has_role(current_user, 'render_owner', 'MEMBER') AS owner_member
       FROM pg_roles r WHERE r.rolname = current_user`,
    );
    assert.deepEqual(rows[0], { name: "aisistent_app", bypass: false, super: false, owner_member: false });
  });

  test("the application role cannot switch to the owner or change table security", async () => {
    await assert.rejects(db.appPool.query("SET ROLE render_owner"), /permission denied|must be member/);
    await assert.rejects(db.appPool.query("ALTER TABLE app.knowledge_entries DISABLE ROW LEVEL SECURITY"), /must be owner/);
    await assert.rejects(db.appPool.query("INSERT INTO app.memberships (organization_id, user_id, role) VALUES ($1, $2, 'owner')", [orgB, alice]), /permission denied/);
  });

  test("running migrations again applies nothing", async () => {
    const result = await migrate(db.admin, MIGRATIONS_DIR);
    assert.deepEqual(result.applied, []);
    assert.deepEqual(result.skipped, ["0001_core_tenancy"]);
  });
});

describe("tenant isolation", () => {
  test("queries without a verified user context see no tenant data", async () => {
    for (const table of ["users", "organizations", "memberships", "assistant_configs", "knowledge_entries", "audit_events"]) {
      const { rowCount } = await db.appPool.query(`SELECT 1 FROM app.${table}`);
      assert.equal(rowCount, 0, `${table} leaked rows without context`);
    }
  });

  test("users list only their own memberships", async () => {
    assert.deepEqual((await listMemberships(db.appPool, alice)).map((m) => [m.organizationName, m.role]), [["Studio Mila", "owner"]]);
    assert.deepEqual((await listMemberships(db.appPool, carol)).map((m) => [m.organizationName, m.role]), [["Studio Mila", "member"]]);
    assert.deepEqual((await listMemberships(db.appPool, bob)).map((m) => m.organizationName), ["Servis Jovanović"]);
  });

  test("a non-member cannot open another organization", async () => {
    await assert.rejects(withOrganization(db.appPool, { userId: alice, organizationId: orgB }, async () => "opened"), ForbiddenError);
  });

  test("even with a forged organization setting, RLS hides and protects other tenants' rows", async () => {
    // Bypasses withOrganization's membership check to exercise PostgreSQL's own boundary.
    await withUser(db.appPool, alice, async (client) => {
      await client.query("SELECT set_config('app.organization_id', $1, true)", [orgB]);
      assert.equal((await client.query("SELECT 1 FROM app.knowledge_entries")).rowCount, 0);
      assert.equal((await client.query("SELECT 1 FROM app.assistant_configs")).rowCount, 0);
      assert.equal((await client.query("UPDATE app.knowledge_entries SET answer = 'x' WHERE id = $1", [knowledgeB])).rowCount, 0);
      assert.equal((await client.query("DELETE FROM app.knowledge_entries WHERE id = $1", [knowledgeB])).rowCount, 0);
      await assert.rejects(client.query("INSERT INTO app.knowledge_entries (organization_id, question, answer) VALUES ($1, 'q', 'a')", [orgB]), /row-level security/);
    });
    const { rows } = await db.admin.query("SELECT answer FROM app.knowledge_entries WHERE id = $1", [knowledgeB]);
    assert.equal(rows[0].answer, "Da, sezonski.");
  });

  test("inside its own organization a member cannot write rows for another one", async () => {
    await withOrganization(db.appPool, { userId: alice, organizationId: orgA }, async (client) => {
      await rejectsInSavepoint(client, () => client.query("INSERT INTO app.knowledge_entries (organization_id, question, answer) VALUES ($1, 'q', 'a')", [orgB]), /row-level security/);
      assert.equal(await updateKnowledge(client, knowledgeB, { question: "q", answer: "a" }), false);
      assert.equal(await deleteKnowledge(client, knowledgeB), false);
    });
  });

  test("each organization reads only its own configuration and knowledge", async () => {
    await withOrganization(db.appPool, { userId: alice, organizationId: orgA }, async (client) => {
      assert.deepEqual((await getAssistantConfig(client))?.config, { business: { name: "Studio Mila" } });
      assert.deepEqual((await listKnowledge(client)).map((entry) => entry.question), ["Da li je potrebno zakazivanje?"]);
    });
    await withOrganization(db.appPool, { userId: bob, organizationId: orgB }, async (client) => {
      assert.deepEqual((await getAssistantConfig(client))?.config, { business: { name: "Servis Jovanović" } });
      assert.deepEqual((await listKnowledge(client)).map((entry) => entry.question), ["Da li čuvate gume?"]);
    });
  });

  test("users cannot read other users' profiles", async () => {
    await withUser(db.appPool, alice, async (client) => {
      const { rows } = await client.query("SELECT auth_subject FROM app.users");
      assert.deepEqual(rows.map((row) => row.auth_subject), ["auth0|alice"]);
    });
  });
});

describe("roles inside an organization", () => {
  test("members can read but not change configuration or knowledge", async () => {
    await withOrganization(db.appPool, { userId: carol, organizationId: orgA }, async (client, role) => {
      assert.equal(role, "member");
      assert.equal((await listKnowledge(client)).length, 1);
      await rejectsInSavepoint(client, () => addKnowledge(client, { question: "q", answer: "a" }), /row-level security/);
      await rejectsInSavepoint(client, () => saveAssistantConfig(client, { business: { name: "Changed" } }, 1), /row-level security/);
      assert.deepEqual((await getAssistantConfig(client))?.config, { business: { name: "Studio Mila" } });
    });
  });

  test("members cannot read the audit log; owners can", async () => {
    await withOrganization(db.appPool, { userId: carol, organizationId: orgA }, async (client) => {
      assert.equal((await client.query("SELECT 1 FROM app.audit_events")).rowCount, 0);
    });
    await withOrganization(db.appPool, { userId: alice, organizationId: orgA }, async (client) => {
      await recordAudit(client, { action: "knowledge.update", result: "success" });
      const { rows } = await client.query("SELECT action FROM app.audit_events ORDER BY id");
      assert.deepEqual(rows.map((row) => row.action), ["organization.create", "knowledge.update"]);
    });
  });

  test("audit events cannot be attributed to someone else", async () => {
    await withOrganization(db.appPool, { userId: alice, organizationId: orgA }, async (client) => {
      await assert.rejects(
        client.query("INSERT INTO app.audit_events (organization_id, actor_user_id, action, result) VALUES ($1, $2, 'x', 'success')", [orgA, carol]),
        /row-level security/,
      );
    });
  });

  test("a removed member loses access on the next request", async () => {
    const dave = await provisionUser(db.appPool, { subject: "auth0|dave", email: null, displayName: null });
    await db.admin.query("INSERT INTO app.memberships (organization_id, user_id, role) VALUES ($1, $2, 'admin')", [orgA, dave]);
    assert.equal(await withOrganization(db.appPool, { userId: dave, organizationId: orgA }, async (client) => (await listKnowledge(client)).length), 1);
    await db.admin.query("DELETE FROM app.memberships WHERE organization_id = $1 AND user_id = $2", [orgA, dave]);
    await assert.rejects(withOrganization(db.appPool, { userId: dave, organizationId: orgA }, async () => "opened"), ForbiddenError);
  });
});

describe("writes and concurrency", () => {
  test("configuration saves use optimistic revisions", async () => {
    await withOrganization(db.appPool, { userId: alice, organizationId: orgA }, async (client) => {
      const current = await getAssistantConfig(client);
      assert.ok(current);
      const next = await saveAssistantConfig(client, { business: { name: "Studio Mila 2" } }, current.revision);
      assert.equal(next, current.revision + 1);
      await assert.rejects(saveAssistantConfig(client, { business: { name: "Stale" } }, current.revision), ConflictError);
    });
  });

  test("context settings do not leak between pooled transactions", async () => {
    const single = new pg.Pool({ connectionString: db.appUrl, max: 1 });
    try {
      await withOrganization(single, { userId: alice, organizationId: orgA }, async (client) => {
        await listKnowledge(client);
      });
      const { rows } = await single.query("SELECT current_setting('app.user_id', true) AS user_id, current_setting('app.organization_id', true) AS org_id");
      assert.deepEqual(rows[0], { user_id: "", org_id: "" });
      assert.equal((await single.query("SELECT 1 FROM app.knowledge_entries")).rowCount, 0);
    } finally {
      await single.end();
    }
  });

  test("invalid identifiers are rejected before reaching SQL", async () => {
    await assert.rejects(withOrganization(db.appPool, { userId: "not-a-uuid", organizationId: orgA }, async () => "opened"), ForbiddenError);
    await assert.rejects(withUser(db.appPool, "' OR 1=1 --", async () => "opened"), ForbiddenError);
  });

  test("creating an organization requires a user context", async () => {
    await assert.rejects(db.appPool.query("SELECT app.create_organization('Bez korisnika')"), /requires an authenticated user/);
  });
});
