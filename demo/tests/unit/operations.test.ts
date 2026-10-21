import assert from "node:assert/strict";
import { test } from "node:test";
import type { Pool } from "pg";
import { serializeEvent } from "../../lib/operations/logging.ts";
import { checkRateLimit, clientIdentity, rateLimitKey, requestOperation } from "../../lib/operations/rate-limits.ts";

test("IP trust is opt-in; arbitrary forwarded chains and invalid values share a bounded fallback", () => {
  assert.equal(clientIdentity(new Headers({ "x-forwarded-for": "203.0.113.7" }), ""), "unknown-client");
  for (const value of ["203.0.113.1, 10.0.0.1", "not-an-ip", "fe80::1%eth0", "", "1.2.3.4:80"]) {
    assert.equal(clientIdentity(new Headers({ "x-ingress-ip": value }), "x-ingress-ip"), "unknown-client");
  }
  assert.equal(clientIdentity(new Headers({ "x-ingress-ip": "203.0.113.7" }), "x-ingress-ip"), "203.0.113.7");
  assert.equal(clientIdentity(new Headers({ "x-ingress-ip": "2001:0DB8:0000:0000:0000:0000:0000:0001" }), "x-ingress-ip"), "2001:db8::1");
});

test("rate keys are secret-dependent, scoped digests; sensitive values never appear in storage keys", () => {
  const secret = "test-only-rate-secret-0123456789abcdef";
  const first = rateLimitKey("workspace.save", "user-123", secret);
  assert.equal(first.length, 32);
  assert.deepEqual(first, rateLimitKey("workspace.save", "user-123", secret));
  assert.notDeepEqual(first, rateLimitKey("team.change", "user-123", secret));
  assert.notDeepEqual(first, rateLimitKey("workspace.save", "user-456", secret));
  assert.notDeepEqual(first, rateLimitKey("workspace.save", "user-123", `${secret}changed`));
  assert.throws(() => rateLimitKey("workspace.save", "user", "short"));
});

test("budgets cover native form POSTs and isolate authentication callbacks from login bursts", () => {
  assert.equal(requestOperation("/account/", "POST"), "action.ip");
  assert.equal(requestOperation("/org/any/knowledge/", "POST"), "action.ip");
  assert.equal(requestOperation("/auth/login/", "GET"), "auth.login");
  assert.equal(requestOperation("/auth/callback", "GET"), "auth.callback");
  assert.equal(requestOperation("/auth/backchannel-logout", "POST"), "auth.logout");
  assert.equal(requestOperation("/auth/arbitrary", "GET"), "auth.other");
  assert.equal(requestOperation("/workspace/", "GET"), null);
});

test("operational log serialization drops untrusted fields, errors, URLs, IDs and injected text", () => {
  const secret = "secret@example.test\nforged-log";
  const log = serializeEvent("action.failed", {
    requestId: secret, operation: secret, outcome: secret, retryAfterSeconds: -1,
    email: secret, token: secret, error: new Error(secret), body: secret,
  } as never);
  const parsed = JSON.parse(log);
  assert.equal(parsed.event, "action.failed");
  assert.equal(parsed.level, "error");
  assert.match(parsed.requestId, /^[a-f0-9-]{36}$/);
  assert.doesNotMatch(log, /secret|forged|token|body/);
  assert.equal(parsed.operation, undefined);
  assert.equal(parsed.outcome, undefined);
  assert.equal(parsed.retryAfterSeconds, undefined);
});

test("database failure never admits protected work or emits raw database errors", async () => {
  const oldSecret = process.env.RATE_LIMIT_SECRET;
  process.env.RATE_LIMIT_SECRET = "test-only-rate-secret-0123456789abcdef";
  const lines: string[] = [];
  const originalLog = console.log;
  console.log = (line: string) => { lines.push(line); };
  try {
    const pool = { query: async () => { throw new Error("password=private email=person@example.test"); } } as unknown as Pool;
    assert.deepEqual(await checkRateLimit(pool, "workspace.save", "user"), { allowed: false, status: 503, retryAfterSeconds: 30 });
    process.env.RATE_LIMIT_SECRET = "";
    assert.deepEqual(await checkRateLimit(pool, "workspace.save", "user"), { allowed: false, status: 503, retryAfterSeconds: 30 });
    assert.equal(lines.length, 2);
    for (const line of lines) assert.doesNotMatch(line, /password|private|person/);
  } finally {
    console.log = originalLog;
    if (oldSecret === undefined) delete process.env.RATE_LIMIT_SECRET;
    else process.env.RATE_LIMIT_SECRET = oldSecret;
  }
});
