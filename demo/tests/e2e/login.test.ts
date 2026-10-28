import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { RATE_POLICIES } from "../../lib/operations/rate-limits.ts";
import { startLocalAuthStack, type LocalAuthStack } from "../support/local-auth-stack.ts";
import { readFile } from "node:fs/promises";
import { addKnowledge, createOrganization, provisionUser } from "../../lib/db/repositories.ts";
import { withOrganization } from "../../lib/db/context.ts";
import { recordConversation } from "../../lib/db/conversations.ts";
import { createInvitation } from "../../lib/db/team.ts";
import { createEmptyDraft } from "../../lib/workspace/templates.ts";

// Full sign-in round trip through the real Auth0 SDK, proxy, session store,
// and database, with a mock OpenID Connect provider standing in for Auth0.

let stack: LocalAuthStack;
before(async () => { stack = await startLocalAuthStack({ appPort: 4391, issuerPort: 4491, quiet: true }); }, { timeout: 180_000 });
after(async () => { await stack?.stop(); });
beforeEach(async () => {
  await stack.db.admin.query("DELETE FROM app.rate_limit_buckets");
  await stack.db.admin.query("DELETE FROM app.auth_sessions");
});

/** Minimal browser: keeps cookies for the app origin and follows redirects across the app and the mock provider. */
class Browser {
  readonly cookies = new Map<string, string>();
  readonly setCookieHeaders: string[] = [];

  async get(url: string): Promise<{ response: Response; url: string; body: string }> {
    let current = new URL(url, stack.appUrl);
    for (let hop = 0; hop < 12; hop++) {
      const isApp = current.origin === new URL(stack.appUrl).origin;
      const headers: Record<string, string> = {};
      if (isApp && this.cookies.size) headers.cookie = [...this.cookies].map(([name, value]) => `${name}=${value}`).join("; ");
      const response = await fetch(current, { headers, redirect: "manual" });
      if (isApp) this.store(response);
      const location = response.headers.get("location");
      if (response.status >= 300 && response.status < 400 && location) {
        current = new URL(location, current);
        continue;
      }
      return { response, url: current.toString(), body: await response.text() };
    }
    throw new Error("Too many redirects");
  }

  /** Submit the server-rendered native form without a Next-Action header. */
  async post(url: string, form: FormData, additionalHeaders: Record<string, string> = {}): Promise<{ response: Response; body: string }> {
    const response = await fetch(new URL(url, stack.appUrl), {
      method: "POST",
      headers: {
        origin: stack.appUrl,
        cookie: [...this.cookies].map(([name, value]) => `${name}=${value}`).join("; "),
        ...additionalHeaders,
      },
      body: form,
      redirect: "manual",
    });
    this.store(response);
    return { response, body: await response.text() };
  }

  private store(response: Response): void {
    for (const header of response.headers.getSetCookie()) {
      this.setCookieHeaders.push(header);
      const [pair, ...attributes] = header.split(";");
      const index = pair.indexOf("=");
      const name = pair.slice(0, index).trim();
      const value = pair.slice(index + 1).trim();
      const expired = attributes.some((attribute) => /^\s*max-age=0\s*$/i.test(attribute) || /^\s*expires=thu, 01 jan 1970/i.test(attribute));
      if (!value || expired) this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
  }
}

const sessionCount = async () => Number((await stack.db.admin.query("SELECT count(*) FROM app.auth_sessions")).rows[0].count);

function decodeAttribute(value: string): string {
  const named: Record<string, string> = { amp: "&", quot: '"', apos: "'", lt: "<", gt: ">" };
  return value.replace(/&(#x[0-9a-f]+|#\d+|amp|quot|apos|lt|gt);/gi, (_, entity: string) => {
    if (entity.startsWith("#")) return String.fromCodePoint(parseInt(entity.slice(entity[1]?.toLowerCase() === "x" ? 2 : 1), entity[1]?.toLowerCase() === "x" ? 16 : 10));
    return named[entity.toLowerCase()];
  });
}

/** Read action metadata from the actual page, never hard-code a generated action id. */
function nativeForm(html: string, inputId: string, values: Record<string, string>): FormData {
  const form = [...html.matchAll(/<form\b[^>]*>[\s\S]*?<\/form>/gi)].map(([markup]) => markup).find((markup) => markup.includes(`id="${inputId}"`));
  assert.ok(form, `the form with #${inputId} is rendered`);
  const data = new FormData();
  for (const [input] of form.matchAll(/<input\b[^>]*>/gi)) {
    const attributes = Object.fromEntries([...input.matchAll(/([\w$:-]+)="([^"]*)"/g)].map(([, key, value]) => [key, decodeAttribute(value)]));
    if (attributes.type === "hidden" && attributes.name) data.append(attributes.name, attributes.value ?? "");
  }
  assert.ok([...data.keys()].some((key) => key.startsWith("$ACTION_")), "native action metadata is rendered");
  for (const [name, value] of Object.entries(values)) data.set(name, value);
  return data;
}

const organizationForm = (html: string, name: string) => nativeForm(html, "organization-name", { name });

/** The compiled id of a Server Action from a route that has already been rendered. */
async function compiledActionId(exportedName: string): Promise<string> {
  const manifest = JSON.parse(await readFile(new URL("../../.next/dev/server/server-reference-manifest.json", import.meta.url), "utf8")) as { node: Record<string, { exportedName: string }> };
  const actionId = Object.entries(manifest.node).find(([, action]) => action.exportedName === exportedName)?.[0];
  assert.ok(actionId, `${exportedName} was compiled from the rendered route`);
  return actionId;
}

const userIdFor = async (subject: string) => (await stack.db.admin.query("SELECT id FROM app.users WHERE auth_subject = $1", [subject])).rows[0].id as string;

function assertBlocked(response: Response, expectedStatus: 429 | 503): void {
  assert.equal(response.status, expectedStatus);
  assert.match(response.headers.get("cache-control") ?? "", /no-store/);
  const retryAfter = Number(response.headers.get("retry-after"));
  assert.ok(Number.isInteger(retryAfter) && retryAfter > 0, "Retry-After is a positive number of seconds");
  assert.match(response.headers.get("x-request-id") ?? "", /^[0-9a-f-]{36}$/i);
}

test("signed-out visitors see the sign-in page, not account data", async () => {
  const browser = new Browser();
  const { response, body } = await browser.get("/account/");
  assert.equal(response.status, 200);
  assert.match(body, /Prijavite se/);
  assert.doesNotMatch(body, /Vaš nalog/);
});

test("workspace writes require MFA and current membership through the actual Server Action", async () => {
  const verified = new Browser();
  await verified.get("/auth/login?returnTo=/account/");
  const userId = (await stack.db.admin.query("SELECT id FROM app.users WHERE auth_subject = 'mock|ana'")).rows[0].id as string;
  const organizationId = await createOrganization(stack.db.appPool, userId, "MFA regression organization");
  const path = `/org/${organizationId}/knowledge/`;
  assert.equal((await verified.get(path)).response.status, 200);

  // Discover the current compiled action reference; never persist generated IDs.
  const manifest = JSON.parse(await readFile(new URL("../../.next/dev/server/server-reference-manifest.json", import.meta.url), "utf8")) as { node: Record<string, { exportedName: string }> };
  const actionId = Object.entries(manifest.node).find(([, action]) => action.exportedName === "saveWorkspaceAction")?.[0];
  assert.ok(actionId, "the workspace save action was compiled from the rendered route");
  const draft = createEmptyDraft();
  draft.business.name = "Verified edit";
  async function save(browser: Browser, revision: number) {
    const response = await fetch(`${stack.appUrl}${path}`, {
      method: "POST", redirect: "manual",
      headers: { origin: stack.appUrl, "next-action": actionId!, "content-type": "text/plain;charset=UTF-8", accept: "text/x-component", cookie: [...browser.cookies].map(([name, value]) => `${name}=${value}`).join("; ") },
      body: JSON.stringify([organizationId, draft, revision]),
    });
    return { response, body: await response.text() };
  }
  const admitted = await save(verified, 0);
  assert.equal(admitted.response.status, 200);
  assert.match(admitted.body, /"status":"saved"/);

  stack.user.mfa = false;
  try {
    const withoutMfa = new Browser();
    await withoutMfa.get("/auth/login?returnTo=/account/");
    const page = await withoutMfa.get(path);
    assert.match(page.body, /Potvrdite prijavu za izmene/);
    assert.match(page.body, /Dvofaktorska potvrda/);
    draft.business.name = "Unauthorized edit";
    const denied = await save(withoutMfa, 1);
    assert.match(denied.body, /"status":"forbidden"/);
    const stored = await stack.db.admin.query("SELECT revision, config->'business'->>'name' AS name FROM app.assistant_configs WHERE organization_id = $1", [organizationId]);
    assert.deepEqual(stored.rows, [{ revision: 1, name: "Verified edit" }]);
  } finally {
    stack.user.mfa = true;
  }

  await stack.db.admin.query("DELETE FROM app.memberships WHERE organization_id = $1 AND user_id = $2", [organizationId, userId]);
  const removed = await save(verified, 1);
  assert.match(removed.body, /"status":"forbidden"/);
  assert.equal((await stack.db.admin.query("SELECT revision FROM app.assistant_configs WHERE organization_id = $1", [organizationId])).rows[0].revision, 1);
});

test("sign-in creates the user, an encrypted server-side session, and an HttpOnly cookie", async () => {
  const browser = new Browser();
  const { url, body, response } = await browser.get("/auth/login?returnTo=/account/");
  assert.equal(response.status, 200);
  assert.equal(new URL(url).pathname, "/account/");
  assert.match(body, /Vaš nalog/);
  assert.match(body, /Ana Test/);
  assert.match(body, /Email potvrđen/);
  assert.match(body, /Dvofaktorska prijava/);

  const sessionHeader = browser.setCookieHeaders.find((header) => header.startsWith("__session="));
  assert.ok(sessionHeader, "session cookie set");
  assert.match(sessionHeader, /HttpOnly/i);
  assert.match(sessionHeader, /SameSite=Lax/i);

  const users = await stack.db.admin.query("SELECT email, display_name FROM app.users WHERE auth_subject = 'mock|ana'");
  assert.deepEqual(users.rows, [{ email: "ana@example.test", display_name: "Ana Test" }]);
  assert.equal(await sessionCount(), 1);

  const cookieValue = browser.cookies.get("__session")!;
  const payloads = await stack.db.admin.query("SELECT encode(payload, 'escape') AS raw, encode(id_hash, 'hex') AS id FROM app.auth_sessions");
  assert.ok(!payloads.rows[0].raw.includes("ana@example.test"), "session payload is encrypted");
  assert.ok(!payloads.rows[0].raw.includes(cookieValue) && !cookieValue.includes(payloads.rows[0].id), "neither the cookie nor the id appears in the table");

  // A second visit reuses the same server-side session.
  const again = await browser.get("/account/");
  assert.match(again.body, /Vaš nalog/);
  assert.equal(await sessionCount(), 1);
});

test("a forged or altered session cookie is treated as signed out", async () => {
  const browser = new Browser();
  await browser.get("/auth/login?returnTo=/account/");
  const real = browser.cookies.get("__session")!;
  browser.cookies.set("__session", `${real.slice(0, -4)}AAAA`);
  const { body } = await browser.get("/account/");
  assert.match(body, /Prijavite se/);
});

test("logout deletes the server-side session", async () => {
  const before = await sessionCount();
  const browser = new Browser();
  await browser.get("/auth/login?returnTo=/account/");
  assert.equal(await sessionCount(), before + 1);
  const cookie = browser.cookies.get("__session")!;

  await browser.get("/auth/logout");
  assert.equal(await sessionCount(), before);
  assert.equal(browser.cookies.get("__session"), undefined);

  // Replaying the old cookie no longer works: the session is gone on the server.
  browser.cookies.set("__session", cookie);
  const { body } = await browser.get("/account/");
  assert.match(body, /Prijavite se/);
});

test("without MFA the account page asks for a step-up before creating organizations", async () => {
  stack.user.mfa = false;
  try {
    const browser = new Browser();
    const { body } = await browser.get("/auth/login?returnTo=/account/");
    assert.match(body, /Bez dvofaktorske prijave/);
    assert.match(body, /potrebna je prijava sa dvofaktorskom potvrdom/);
    assert.match(body, /acr_values=http%3A%2F%2Fschemas\.openid\.net%2Fpape%2Fpolicies%2F2007%2F06%2Fmulti-factor/);
  } finally {
    stack.user.mfa = true;
  }
});

test("the workspace step-up link signs in again with MFA and returns to the organization with editing restored", async () => {
  stack.user.mfa = false;
  try {
    const browser = new Browser();
    await browser.get("/auth/login?returnTo=/account/");
    const userId = (await stack.db.admin.query("SELECT id FROM app.users WHERE auth_subject = 'mock|ana'")).rows[0].id as string;
    const organizationId = await createOrganization(stack.db.appPool, userId, "Step-up regression organization");
    const home = `/org/${organizationId}/`;

    // Without MFA: notice with a step-up link back to this organization, and no team controls that would fail.
    const before = await browser.get(home);
    assert.match(before.body, /Potvrdite prijavu za izmene/);
    const link = before.body.match(/href="(\/auth\/login\?acr_values=[^"]+)"/)?.[1];
    assert.ok(link, "step-up link rendered");
    const stepUp = decodeAttribute(link);
    assert.equal(new URL(stepUp, stack.appUrl).searchParams.get("returnTo"), home);
    assert.equal(new URL(stepUp, stack.appUrl).searchParams.get("max_age"), "0");
    assert.doesNotMatch((await browser.get(`${home}team/`)).body, /Napravi poziv/);

    // The provider now authenticates with MFA; the callback validates auth_time for max_age=0.
    stack.user.mfa = true;
    const after = await browser.get(stepUp);
    assert.equal(after.response.status, 200);
    assert.equal(new URL(after.url).pathname, home);
    assert.doesNotMatch(after.body, /Potvrdite prijavu za izmene/);
    assert.match((await browser.get(`${home}team/`)).body, /Napravi poziv/);
  } finally {
    stack.user.mfa = true;
  }
});

test("returnTo cannot send the user to another site", async () => {
  const browser = new Browser();
  const { url } = await browser.get("/auth/login?returnTo=https://evil.example/steal");
  assert.equal(new URL(url).origin, new URL(stack.appUrl).origin);
});

test("the client-side access token endpoint is disabled", async () => {
  const browser = new Browser();
  await browser.get("/auth/login?returnTo=/account/");
  const { response } = await browser.get("/auth/access-token");
  assert.notEqual(response.status, 200);
});

test("auth admission returns 429 and cannot be bypassed by prefetch or untrusted forwarding headers", async () => {
  const admitted = await fetch(`${stack.appUrl}/auth/login/`, { redirect: "manual" });
  assert.ok(admitted.status >= 300 && admitted.status < 400);
  const seeded = await stack.db.admin.query("UPDATE app.rate_limit_buckets SET request_count = $1, expires_at = now() + interval '5 minutes' RETURNING bucket_key", [RATE_POLICIES["auth.login"].limit]);
  assert.equal(seeded.rowCount, 1);

  const headerVariants: Record<string, string>[] = [{}, { "next-router-prefetch": "1", purpose: "prefetch" }, { "x-forwarded-for": "198.51.100.1" }, { "x-forwarded-for": "203.0.113.2" }];
  for (const headers of headerVariants) {
    const response = await fetch(`${stack.appUrl}/auth/login/?returnTo=/account/`, { headers, redirect: "manual" });
    assertBlocked(response, 429);
    assert.match(await response.text(), /Previše zahteva/);
  }
  const counters = await stack.db.admin.query("SELECT request_count FROM app.rate_limit_buckets");
  assert.deepEqual(counters.rows, [{ request_count: RATE_POLICIES["auth.login"].limit }], "spoofed IPs did not create a new bucket");

  // A full login bucket must not prevent an in-flight callback or a logout.
  for (const path of ["/auth/callback/", "/auth/logout/"]) {
    const response = await fetch(`${stack.appUrl}${path}`, { redirect: "manual" });
    assert.notEqual(response.status, 429);
    assert.notEqual(response.status, 503);
  }
  const scopes = await stack.db.admin.query("SELECT request_count FROM app.rate_limit_buckets ORDER BY request_count");
  assert.deepEqual(scopes.rows, [{ request_count: 1 }, { request_count: 1 }, { request_count: RATE_POLICIES["auth.login"].limit }]);
});

test("auth admission fails closed with 503 when its database function is unavailable", async () => {
  await stack.db.admin.query("REVOKE EXECUTE ON FUNCTION app.consume_rate_limit(bytea, integer, integer) FROM aisistent_runtime");
  try {
    const response = await fetch(`${stack.appUrl}/auth/login/`, { redirect: "manual" });
    assertBlocked(response, 503);
    assert.equal(response.headers.get("retry-after"), "30");
    assert.match(await response.text(), /Usluga trenutno nije dostupna/);
    assert.equal(response.headers.get("location"), null, "failed admission does not reach the identity provider");
  } finally {
    await stack.db.admin.query("GRANT EXECUTE ON FUNCTION app.consume_rate_limit(bytea, integer, integer) TO aisistent_runtime");
  }
  const recovered = await fetch(`${stack.appUrl}/auth/login/`, { redirect: "manual" });
  assert.ok(recovered.status >= 300 && recovered.status < 400, "admission recovers after the database capability is restored");
});

test("native Server Action forms consume the request budget without a Next-Action header", async () => {
  const browser = new Browser();
  const page = await browser.get("/auth/login?returnTo=/account/");
  await stack.db.admin.query("DELETE FROM app.rate_limit_buckets");
  const first = await browser.post("/account/", organizationForm(page.body, "x"));
  assert.equal(first.response.status, 200);
  assert.match(first.body, /Naziv firme mora imati od 2 do 60 znakova/);
  const requestBucket = await stack.db.admin.query("UPDATE app.rate_limit_buckets SET request_count = $1, expires_at = now() + interval '5 minutes' WHERE expires_at < now() + interval '2 minutes' RETURNING bucket_key", [RATE_POLICIES["action.ip"].limit]);
  assert.equal(requestBucket.rowCount, 1, "native POST created the short request bucket");
  const blocked = await browser.post("/account/", organizationForm(page.body, "Blocked organization"), { "next-router-prefetch": "1", purpose: "prefetch", "x-forwarded-for": "198.51.100.5" });
  assertBlocked(blocked.response, 429);
});

test("organization creation budgets use the verified user across sessions and isolate other users", async () => {
  const firstSession = new Browser();
  const secondSession = new Browser();
  const otherUser = new Browser();
  const firstPage = await firstSession.get("/auth/login?returnTo=/account/");
  const secondPage = await secondSession.get("/auth/login?returnTo=/account/");
  const otherPage = await otherUser.get("/auth/login?returnTo=/account/&login_hint=marko@example.test");
  await stack.db.admin.query("DELETE FROM app.rate_limit_buckets");

  const first = await firstSession.post("/account/", organizationForm(firstPage.body, "x"));
  assert.match(first.body, /Naziv firme mora imati od 2 do 60 znakova/);
  const userBucket = await stack.db.admin.query("UPDATE app.rate_limit_buckets SET request_count = $1 WHERE expires_at > now() + interval '5 minutes' RETURNING bucket_key", [RATE_POLICIES["organization.create"].limit]);
  assert.equal(userBucket.rowCount, 1);

  const before = Number((await stack.db.admin.query("SELECT count(*) FROM app.organizations")).rows[0].count);
  const denied = await secondSession.post("/account/", organizationForm(secondPage.body, "Blocked organization"));
  assert.equal(denied.response.status, 200);
  assert.match(denied.body, /Previše zahteva/);
  assert.equal(Number((await stack.db.admin.query("SELECT count(*) FROM app.organizations")).rows[0].count), before, "a second session cannot reset the user budget");

  const admitted = await otherUser.post("/account/", organizationForm(otherPage.body, "Marko test organization"));
  assert.equal(admitted.response.status, 303);
  assert.match(admitted.response.headers.get("location") ?? "", /^\/org\/[0-9a-f-]+\/onboarding\/?$/i);
  assert.equal(Number((await stack.db.admin.query("SELECT count(*) FROM app.organizations")).rows[0].count), before + 1, "another verified user has an independent action budget");
});

test("invitation acceptance requires the current session's verified matching email, not just a verified database profile", async () => {
  const ownerId = await provisionUser(stack.db.appPool, { subject: "mock|invitation-owner", email: "owner@example.test", displayName: "Invitation Owner" });
  const organizationId = await createOrganization(stack.db.appPool, ownerId, "Invitation HTTP regression");
  const invitation = await withOrganization(stack.db.appPool, { userId: ownerId, organizationId }, (client) => createInvitation(client, { email: "ana@example.test", role: "member" }));
  const path = `/invite/${invitation.token}/`;
  const unverified = new Browser();
  stack.user.emailVerified = false;
  try {
    await unverified.get("/auth/login?returnTo=/account/");
  } finally {
    stack.user.emailVerified = true;
  }
  // A newer verified session updates the shared profile, but the earlier
  // unverified session must not inherit its proof of email ownership.
  const verified = new Browser();
  await verified.get("/auth/login?returnTo=/account/");
  const page = await verified.get(path);
  assert.match(page.body, /Prihvati poziv/);
  const manifest = JSON.parse(await readFile(new URL("../../.next/dev/server/server-reference-manifest.json", import.meta.url), "utf8")) as { node: Record<string, { exportedName: string }> };
  const actionId = Object.entries(manifest.node).find(([, action]) => action.exportedName === "acceptInvitationAction")?.[0];
  assert.ok(actionId, "the invitation page provides the current compiled action reference");
  const inviteeId = (await stack.db.admin.query("SELECT id FROM app.users WHERE auth_subject = 'mock|ana' AND email = 'ana@example.test'")).rows[0].id as string;

  async function accept(browser: Browser) {
    const response = await fetch(`${stack.appUrl}${path}`, {
      method: "POST", redirect: "manual",
      headers: { origin: stack.appUrl, "next-action": actionId!, "content-type": "text/plain;charset=UTF-8", accept: "text/x-component", cookie: [...browser.cookies].map(([name, value]) => `${name}=${value}`).join("; ") },
      body: JSON.stringify([invitation.token, { error: null }]),
    });
    return { response, body: await response.text() };
  }
  assert.match((await accept(new Browser())).body, /Prijavite se da biste prihvatili poziv/);
  assert.match((await accept(unverified)).body, /Potvrdite email adresu pre nego što prihvatite poziv/);
  const wrongUser = new Browser();
  await wrongUser.get("/auth/login?returnTo=/account/&login_hint=wrong-invitee@example.test");
  assert.match((await accept(wrongUser)).body, /Poziv glasi na drugu email adresu/);
  assert.equal((await stack.db.admin.query("SELECT 1 FROM app.memberships WHERE organization_id = $1 AND user_id <> $2", [organizationId, ownerId])).rowCount, 0);
  assert.equal((await stack.db.admin.query("SELECT accepted_at FROM app.invitations WHERE id = $1", [invitation.id])).rows[0].accepted_at, null);

  const accepted = await accept(verified);
  // Next may stream the redirect with 200; the redirect header and persisted
  // membership are the authoritative completion signals for this action.
  assert.ok([200, 303].includes(accepted.response.status));
  assert.match(accepted.response.headers.get("x-action-redirect") ?? "", new RegExp(`/org/${organizationId}/`));
  assert.deepEqual((await stack.db.admin.query("SELECT role FROM app.memberships WHERE organization_id = $1 AND user_id = $2", [organizationId, inviteeId])).rows, [{ role: "member" }]);
  assert.ok((await stack.db.admin.query("SELECT accepted_at FROM app.invitations WHERE id = $1", [invitation.id])).rows[0].accepted_at);
});

test("only an owner with MFA downloads the organization export, and only from this site", async () => {
  const owner = new Browser();
  await owner.get("/auth/login?returnTo=/account/");
  const anaId = await userIdFor("mock|ana");
  const organizationId = await createOrganization(stack.db.appPool, anaId, "Export HTTP regression");
  await withOrganization(stack.db.appPool, { userId: anaId, organizationId }, (client) => addKnowledge(client, { question: "Izvozno pitanje", answer: "Izvozni odgovor" }));
  const path = `/org/${organizationId}/export/`;

  const download = await owner.get(path);
  assert.equal(download.response.status, 200);
  assert.match(download.response.headers.get("content-type") ?? "", /^application\/json/);
  assert.match(download.response.headers.get("content-disposition") ?? "", /^attachment; filename="aisistent-podaci-firme-\d{4}-\d{2}-\d{2}\.json"$/);
  assert.match(download.response.headers.get("cache-control") ?? "", /no-store/);
  const document = JSON.parse(download.body) as { format: string; organization: { name: string }; knowledge: Array<{ question: string }> };
  assert.equal(document.format, "aisistent.organization-export");
  assert.equal(document.organization.name, "Export HTTP regression");
  assert.deepEqual(document.knowledge.map(({ question }) => question), ["Izvozno pitanje"]);

  const crossSite = await fetch(`${stack.appUrl}${path}`, { redirect: "manual", headers: { "sec-fetch-site": "cross-site", cookie: [...owner.cookies].map(([name, value]) => `${name}=${value}`).join("; ") } });
  assert.equal(crossSite.status, 403);

  const member = new Browser();
  await member.get("/auth/login?returnTo=/account/&login_hint=export-member@example.test");
  await stack.db.admin.query("INSERT INTO app.memberships (organization_id, user_id, role) VALUES ($1, $2, 'admin')", [organizationId, await userIdFor("mock|export-member")]);
  assert.equal((await member.get(path)).response.status, 403, "admins cannot export");
  const stranger = new Browser();
  await stranger.get("/auth/login?returnTo=/account/&login_hint=export-stranger@example.test");
  assert.equal((await stranger.get(path)).response.status, 404);
  assert.equal((await new Browser().get(path)).response.status, 401);

  stack.user.mfa = false;
  try {
    const withoutMfa = new Browser();
    await withoutMfa.get("/auth/login?returnTo=/account/");
    const refused = await withoutMfa.get(path);
    assert.equal(refused.response.status, 403);
    assert.match(refused.body, /dvofaktorskom potvrdom/);
  } finally {
    stack.user.mfa = true;
  }
  const { rows } = await stack.db.admin.query("SELECT actor_user_id FROM app.audit_events WHERE organization_id = $1 AND action = 'organization.export'", [organizationId]);
  assert.deepEqual(rows, [{ actor_user_id: anaId }], "only the successful export is recorded");
});

test("deleting an organization through the native form needs MFA and the exact name", async () => {
  const owner = new Browser();
  await owner.get("/auth/login?returnTo=/account/");
  const anaId = await userIdFor("mock|ana");
  const organizationId = await createOrganization(stack.db.appPool, anaId, "Delete HTTP regression");
  const colleague = await provisionUser(stack.db.appPool, { subject: "mock|delete-colleague", email: "delete-colleague@example.test", displayName: "Colleague" });
  await stack.db.admin.query("INSERT INTO app.memberships (organization_id, user_id, role) VALUES ($1, $2, 'member')", [organizationId, colleague]);
  const path = `/org/${organizationId}/settings/`;
  const page = await owner.get(path);
  assert.match(page.body, /Trajno obriši firmu/);
  const exists = async () => (await stack.db.admin.query("SELECT 1 FROM app.organizations WHERE id = $1", [organizationId])).rowCount === 1;

  const wrongName = await owner.post(path, nativeForm(page.body, "confirm-name", { confirmName: "Pogrešan naziv" }));
  assert.equal(wrongName.response.status, 200);
  assert.match(wrongName.body, /Naziv se ne poklapa/);
  assert.ok(await exists());

  stack.user.mfa = false;
  try {
    const withoutMfa = new Browser();
    await withoutMfa.get("/auth/login?returnTo=/account/");
    const view = await withoutMfa.get(path);
    assert.match(view.body, /Brisanje je dostupno posle dvofaktorske potvrde/);
    assert.doesNotMatch(view.body, /id="confirm-name"/);
    const refused = await withoutMfa.post(path, nativeForm(page.body, "confirm-name", { confirmName: "Delete HTTP regression" }));
    assert.match(refused.body, /Za brisanje firme potrebna je prijava sa dvofaktorskom potvrdom/);
    assert.ok(await exists());
  } finally {
    stack.user.mfa = true;
  }

  const deleted = await owner.post(path, nativeForm(page.body, "confirm-name", { confirmName: "Delete HTTP regression" }));
  assert.equal(deleted.response.status, 303);
  assert.equal(deleted.response.headers.get("location"), "/account/?status=organization-deleted");
  assert.ok(!(await exists()));
  assert.equal((await stack.db.admin.query("SELECT 1 FROM app.memberships WHERE organization_id = $1", [organizationId])).rowCount, 0);
  assert.deepEqual((await stack.db.admin.query("SELECT actor_user_id FROM app.audit_events WHERE action = 'organization.delete' AND target = $1", [organizationId])).rows, [{ actor_user_id: anaId }]);
  assert.equal((await owner.get(`/org/${organizationId}/`)).response.status, 404);
  assert.match((await owner.get("/account/?status=organization-deleted")).body, /Firma i njeni podaci su trajno obrisani/);
});

test("a member leaves through the Server Action, and the last owner is refused", async () => {
  const owner = new Browser();
  await owner.get("/auth/login?returnTo=/account/");
  const anaId = await userIdFor("mock|ana");
  const organizationId = await createOrganization(stack.db.appPool, anaId, "Leave HTTP regression");
  const member = new Browser();
  await member.get("/auth/login?returnTo=/account/&login_hint=leaver@example.test");
  const leaverId = await userIdFor("mock|leaver");
  await stack.db.admin.query("INSERT INTO app.memberships (organization_id, user_id, role) VALUES ($1, $2, 'member')", [organizationId, leaverId]);
  const path = `/org/${organizationId}/settings/`;
  assert.match((await member.get(path)).body, /Napusti firmu/);
  assert.match((await owner.get(path)).body, /Vi ste jedini vlasnik/);
  const actionId = await compiledActionId("leaveOrganizationAction");

  async function leave(browser: Browser) {
    const response = await fetch(`${stack.appUrl}${path}`, {
      method: "POST", redirect: "manual",
      headers: { origin: stack.appUrl, "next-action": actionId, "content-type": "text/plain;charset=UTF-8", accept: "text/x-component", cookie: [...browser.cookies].map(([name, value]) => `${name}=${value}`).join("; ") },
      body: JSON.stringify([organizationId]),
    });
    return { response, body: await response.text() };
  }
  assert.match((await leave(owner)).body, /Vi ste jedini vlasnik/);
  assert.equal((await stack.db.admin.query("SELECT role FROM app.memberships WHERE organization_id = $1 AND user_id = $2", [organizationId, anaId])).rows[0].role, "owner");

  const left = await leave(member);
  assert.match(left.response.headers.get("x-action-redirect") ?? "", /\/account\/\?status=left/);
  assert.equal((await stack.db.admin.query("SELECT 1 FROM app.memberships WHERE organization_id = $1 AND user_id = $2", [organizationId, leaverId])).rowCount, 0);
  assert.equal((await member.get(path)).response.status, 404);
});

test("signing out everywhere ends every session of that user and no one else's", async () => {
  const laptop = new Browser();
  const phone = new Browser();
  const otherUser = new Browser();
  await laptop.get("/auth/login?returnTo=/account/");
  await phone.get("/auth/login?returnTo=/account/");
  await otherUser.get("/auth/login?returnTo=/account/&login_hint=sessions-other@example.test");
  const page = await laptop.get("/account/");
  assert.match(page.body, /Aktivnih prijava: 2/);
  assert.match(page.body, /Odjavi me sa svih uređaja/);
  const actionId = await compiledActionId("signOutEverywhereAction");

  const response = await fetch(`${stack.appUrl}/account/`, {
    method: "POST", redirect: "manual",
    headers: { origin: stack.appUrl, "next-action": actionId, "content-type": "text/plain;charset=UTF-8", accept: "text/x-component", cookie: [...laptop.cookies].map(([name, value]) => `${name}=${value}`).join("; ") },
    body: JSON.stringify([{ error: null, done: false }]),
  });
  assert.match(await response.text(), /"done":true/);
  const sessionsFor = async (subject: string) => Number((await stack.db.admin.query("SELECT count(*) FROM app.auth_sessions WHERE subject = $1", [subject])).rows[0].count);
  assert.equal(await sessionsFor("mock|ana"), 0);
  assert.match((await phone.get("/account/")).body, /Prijavite se/, "the other device is signed out on its next request");
  assert.match((await laptop.get("/account/")).body, /Prijavite se/);
  assert.equal(await sessionsFor("mock|sessions-other"), 1);
  assert.match((await otherUser.get("/account/")).body, /Vaš nalog/);
  const { rows } = await stack.db.admin.query("SELECT target FROM app.audit_events WHERE action = 'auth.sessions_end' AND actor_user_id = $1", [await userIdFor("mock|ana")]);
  assert.deepEqual(rows, [{ target: "2" }]);
});

test("stored conversations appear for members, stay private to the organization, and only owners or admins delete them", async () => {
  const owner = new Browser();
  await owner.get("/auth/login?returnTo=/account/");
  const anaId = await userIdFor("mock|ana");
  const organizationId = await createOrganization(stack.db.appPool, anaId, "Conversation HTTP regression");
  const otherOrganization = await createOrganization(stack.db.appPool, anaId, "Other conversation organization");
  const record = (name: string, minutesAgo: number) => ({
    channel: "call" as const, outcome: "handoff" as const, customerName: name, summary: `Sažetak za ${name}.`,
    startedAt: new Date(Date.now() - minutesAgo * 60_000), endedAt: new Date(Date.now() - (minutesAgo - 2) * 60_000),
    messages: [{ speaker: "customer" as const, body: `Pitanje od ${name}` }, { speaker: "assistant" as const, body: "Prosleđujem timu." }],
  });
  const first = await recordConversation(stack.db.admin, organizationId, record("Jovana Test", 10));
  const second = await recordConversation(stack.db.admin, organizationId, record("Petar Test", 60));
  const foreign = await recordConversation(stack.db.admin, otherOrganization, record("Tuđi Klijent", 5));
  const path = `/org/${organizationId}/conversations/`;

  const page = await owner.get(path);
  assert.match(page.body, /Čuvaju se 90 dana/);
  assert.match(page.body, /Jovana Test/);
  assert.match(page.body, /Pitanje od Jovana Test/, "the newest conversation is open by default");
  assert.doesNotMatch(page.body, /Izmišljen primer/);
  assert.match((await owner.get(`${path}?c=${second}`)).body, /Pitanje od Petar Test/);
  const probe = await owner.get(`${path}?c=${foreign}`);
  assert.doesNotMatch(probe.body, /Tuđi Klijent|Pitanje od Tuđi/, "an id from another organization shows nothing of it");

  const member = new Browser();
  await member.get("/auth/login?returnTo=/account/&login_hint=conversation-member@example.test");
  await stack.db.admin.query("INSERT INTO app.memberships (organization_id, user_id, role) VALUES ($1, $2, 'member')", [organizationId, await userIdFor("mock|conversation-member")]);
  const memberPage = await member.get(path);
  assert.match(memberPage.body, /Jovana Test/);
  assert.doesNotMatch(memberPage.body, /Obriši razgovor/);

  const actionId = await compiledActionId("deleteConversationAction");
  const remove = (browser: Browser, conversationId: string) => fetch(`${stack.appUrl}${path}`, {
    method: "POST", redirect: "manual",
    headers: { origin: stack.appUrl, "next-action": actionId, "content-type": "text/plain;charset=UTF-8", accept: "text/x-component", cookie: [...browser.cookies].map(([name, value]) => `${name}=${value}`).join("; ") },
    body: JSON.stringify([organizationId, conversationId]),
  }).then(async (response) => ({ response, body: await response.text() }));
  const exists = async (id: string) => (await stack.db.admin.query("SELECT 1 FROM app.conversations WHERE id = $1", [id])).rowCount === 1;

  assert.match((await remove(member, first)).body, /nemate pravo da ga obrišete/);
  assert.ok(await exists(first));
  assert.match((await remove(owner, foreign)).body, /nemate pravo da ga obrišete/, "the bound organization decides, not the id");
  assert.ok(await exists(foreign));
  const deleted = await remove(owner, first);
  assert.match(deleted.response.headers.get("x-action-redirect") ?? "", new RegExp(`/org/${organizationId}/conversations/`));
  assert.ok(!(await exists(first)));
  assert.equal((await stack.db.admin.query("SELECT 1 FROM app.conversation_messages WHERE conversation_id = $1", [first])).rowCount, 0);
});

test("owners change the conversation retention through the native form; admins cannot", async () => {
  const owner = new Browser();
  await owner.get("/auth/login?returnTo=/account/");
  const organizationId = await createOrganization(stack.db.appPool, await userIdFor("mock|ana"), "Retention HTTP regression");
  const path = `/org/${organizationId}/settings/`;
  const page = await owner.get(path);
  assert.match(page.body, /Čuvanje razgovora/);
  const retention = async () => (await stack.db.admin.query("SELECT conversation_retention_days AS days FROM app.organizations WHERE id = $1", [organizationId])).rows[0].days as number;

  const invalid = await owner.post(path, nativeForm(page.body, "retention-days", { days: "45" }));
  assert.match(invalid.body, /Izaberite jedan od ponuđenih rokova/);
  assert.equal(await retention(), 90);
  const saved = await owner.post(path, nativeForm(page.body, "retention-days", { days: "30" }));
  assert.match(saved.body, /Rok je sačuvan/);
  assert.equal(await retention(), 30);

  const admin = new Browser();
  await admin.get("/auth/login?returnTo=/account/&login_hint=retention-admin@example.test");
  await stack.db.admin.query("INSERT INTO app.memberships (organization_id, user_id, role) VALUES ($1, $2, 'admin')", [organizationId, await userIdFor("mock|retention-admin")]);
  const adminPage = await admin.get(path);
  assert.match(adminPage.body, /Razgovori se čuvaju 30 dana/);
  assert.doesNotMatch(adminPage.body, /id="retention-days"/);
  const refused = await admin.post(path, nativeForm(page.body, "retention-days", { days: "365" }));
  assert.match(refused.body, /Rok čuvanja menja vlasnik firme/);
  assert.equal(await retention(), 30);
});
