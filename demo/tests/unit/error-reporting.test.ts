import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, test } from "node:test";
import { fileURLToPath } from "node:url";
import type { ErrorEvent } from "@sentry/browser";
import { createBeforeSend, fromOwnScripts, minimalEvent, PRIVATE_OPTIONS, reportingDsn, reportingOrigin, scrubText } from "../../lib/observability/reporting.ts";
import { logEvent, reportFailure, setFailureReporter } from "../../lib/operations/logging.ts";
import { contentSecurityPolicy } from "../../lib/security/content-security-policy.ts";

const projectDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const DSN = "https://abc123@o1.ingest.de.sentry.io/42";
const failure = (fields: Partial<ErrorEvent> = {}): ErrorEvent => ({ type: undefined, event_id: "e1", timestamp: 1, level: "error", ...fields });

afterEach(() => setFailureReporter(undefined));

test("only a complete HTTPS DSN turns reporting on; plain HTTP only on this computer", () => {
  assert.equal(reportingDsn(DSN), DSN);
  assert.equal(reportingDsn(`  ${DSN}\n`), DSN);
  assert.equal(reportingOrigin(DSN), "https://o1.ingest.de.sentry.io");
  assert.equal(reportingDsn("http://abc@127.0.0.1:4591/1"), "http://abc@127.0.0.1:4591/1");
  for (const bad of [undefined, "", "   ", "not a url", "http://abc@sentry.example/1", "https://o1.ingest.de.sentry.io/42", "https://abc@o1.ingest.de.sentry.io/"]) {
    assert.equal(reportingDsn(bad), null, String(bad));
    assert.equal(reportingOrigin(bad), null, String(bad));
  }
});

test("the CSP allows the reporting host only for connections, and only when configured", () => {
  const withReporting = contentSecurityPolicy("bm9uY2U=", false, reportingOrigin(DSN));
  assert.match(withReporting, /connect-src 'self' https:\/\/o1\.ingest\.de\.sentry\.io;/);
  assert.equal(withReporting.split("sentry.io").length, 2);
  assert.match(contentSecurityPolicy("bm9uY2U=", false, null), /connect-src 'self';/);
  assert.match(contentSecurityPolicy("bm9uY2U=", false), /connect-src 'self';/);
});

test("messages lose addresses, quoted values, identifiers, tokens and phone numbers", () => {
  for (const [input, secret] of [
    ["duplicate key for ana@example.test", "ana@example.test"],
    ["invalid input syntax for type uuid: \"Ana Petrovic\"", "Ana Petrovic"],
    ["value 'Ana Petrovic' is too long", "Ana Petrovic"],
    ["fetch failed https://example.test/invite/abc?x=1", "example.test"],
    ["org 3f2b8c1e-9a7d-4e6f-8b5a-1c2d3e4f5a6b not found", "3f2b8c1e"],
    ["invitation abcdefghijklmnopqrstuvwxyz012345 expired", "abcdefghijklmnop"],
    ["call +381 64 123 4567 failed", "123 4567"],
  ]) assert.ok(!scrubText(input).includes(secret), input);
  assert.equal(scrubText("Cannot read properties of undefined"), "Cannot read properties of undefined");
  assert.equal(scrubText("action.failed"), "action.failed");
});

test("scrubbing stays fast and bounded on long input", () => {
  for (const long of ["a".repeat(200_000), "@".repeat(200_000), "\"".repeat(200_000), "1 ".repeat(100_000), "a@".repeat(100_000)]) {
    const started = performance.now();
    const result = scrubText(long);
    assert.ok(performance.now() - started < 100);
    assert.ok(result.length <= 500);
  }
});

test("an event keeps what helps find the bug and nothing about the person or request", () => {
  const safe = minimalEvent(failure({
    environment: "production",
    release: "abc",
    transaction: "GET /org/[organizationId]",
    tags: { event: "action.failed", operation: "workspace.save", email: "ana@example.test" },
    user: { id: "u1", email: "ana@example.test", ip_address: "203.0.113.9" },
    request: { url: "https://app.test/invite/token123", headers: { cookie: "session=abc", "User-Agent": "x" }, cookies: { session: "abc" }, data: "body" },
    breadcrumbs: [{ message: "ana@example.test" }],
    extra: { secret: "x" },
    contexts: { nextjs: { request_path: "/invite/token123" } },
    server_name: "host",
    modules: { pg: "8" },
    sdkProcessingMetadata: { normalizedRequest: { headers: { cookie: "session=abc" } } },
    sdk: { name: "sentry.javascript.browser", version: "11", settings: { infer_ip: "auto" }, integrations: ["GlobalHandlers"] },
    exception: {
      values: [{
        type: "Error",
        value: "failed for ana@example.test",
        mechanism: { type: "generic", handled: false, data: { url: "https://app.test/invite/token123" } },
        stacktrace: { frames: [
          { filename: "https://app.test/invite/token123", function: "page", lineno: 1, colno: 2, vars: { password: "x" }, context_line: "const secret", pre_context: ["a"], post_context: ["b"], in_app: true },
          { filename: "https://app.test/_next/static/chunks/a.js?dpl=1", function: "render", lineno: 3, colno: 4 },
          { filename: "/var/task/.next/server/app/page.js", function: "load", lineno: 5, colno: 6 },
          { filename: "C:\\Users\\ana\\project\\demo\\.next\\server\\chunk.js", function: "load", lineno: 7, colno: 8 },
          { filename: "/var/task/node_modules/pg/lib/client.js", function: "query", lineno: 9, colno: 1 },
          { filename: "node:internal/process/task_queues", function: "tick", lineno: 2, colno: 3 },
        ] },
      }],
    },
  }));

  assert.deepEqual(Object.keys(safe).filter((key) => safe[key as keyof ErrorEvent] !== undefined).sort(), ["environment", "event_id", "exception", "level", "release", "sdk", "tags", "timestamp", "transaction"]);
  assert.deepEqual(safe.sdk?.settings, { infer_ip: "never" }, "Sentry is told not to store the IP address");
  assert.deepEqual(safe.tags, { event: "action.failed", operation: "workspace.save" });
  assert.equal(safe.transaction, "GET /org/[organizationId]");
  const exception = safe.exception!.values![0];
  assert.equal(exception.value, "failed for [email]");
  assert.deepEqual(exception.mechanism, { type: "generic", handled: false });
  assert.deepEqual(exception.stacktrace!.frames!.map((frame) => frame.filename), ["[page]", "/_next/static/chunks/a.js", ".next/server/app/page.js", ".next\\server\\chunk.js", "node_modules/pg/lib/client.js", "node:internal/process/task_queues"]);
  const serialized = JSON.stringify(safe);
  for (const secret of ["example.test", "token123", "session=abc", "203.0.113.9", "password", "const secret", "body", "\"host\"", "Users", "\"auto\"", "GlobalHandlers"]) assert.ok(!serialized.includes(secret), secret);
});

test("the SDK is told to collect nothing about people or requests", () => {
  assert.deepEqual(PRIVATE_OPTIONS.dataCollection, { userInfo: false, cookies: false, httpHeaders: false, httpBodies: [], urlQueryParams: false, databaseQueryData: false, queues: false, stackFrameVariables: false, frameContextLines: 0 });
  assert.equal(PRIVATE_OPTIONS.maxBreadcrumbs, 0);
});

test("in the browser only the app's own scripts count", () => {
  const withFrames = (...filenames: string[]) => failure({ exception: { values: [{ type: "Error", stacktrace: { frames: filenames.map((filename) => ({ filename })) } }] } });
  assert.ok(fromOwnScripts(withFrames("<anonymous>", "http://127.0.0.1:4315/_next/static/chunks/a.js")));
  assert.ok(!fromOwnScripts(withFrames("<anonymous>")));
  assert.ok(!fromOwnScripts(withFrames("chrome-extension://abc/content.js")));
  assert.ok(!fromOwnScripts(failure()));
});

test("the same failure is sent once a minute; different failures are not held back", () => {
  let now = 0;
  const beforeSend = createBeforeSend(() => now);
  const same = () => failure({ message: "database.idle_error", tags: { event: "database.idle_error" } });
  assert.ok(beforeSend(same()));
  now = 59_000;
  assert.equal(beforeSend(same()), null);
  assert.ok(beforeSend(failure({ message: "auth.callback_failed", tags: { event: "auth.callback_failed" } })));
  assert.ok(beforeSend(failure({ message: "database.idle_error", tags: { event: "action.failed", operation: "workspace.save" } })));
  now = 60_000;
  assert.ok(beforeSend(same()));
});

test("many different failures cannot grow the throttle without limit", () => {
  const beforeSend = createBeforeSend(() => 0);
  for (let index = 0; index < 150; index += 1) assert.ok(beforeSend(failure({ exception: { values: [{ type: `Error${index}` }] } })));
  assert.ok(beforeSend(failure({ exception: { values: [{ type: "Error0" }] } })), "the oldest entries were dropped");
});

test("only error-level log events reach the reporter, with their cause", (context) => {
  context.mock.method(console, "log", () => undefined);
  const received: unknown[][] = [];
  setFailureReporter((...args) => received.push(args));
  const cause = new Error("boom");

  logEvent("action.completed", { operation: "team.change", outcome: "denied" }, cause);
  logEvent("request.blocked", { operation: "auth.login", outcome: "denied" });
  assert.equal(received.length, 0);

  logEvent("action.failed", { operation: "workspace.save", outcome: "error" }, cause);
  logEvent("database.idle_error", { outcome: "error" });
  assert.deepEqual(received, [["action.failed", { operation: "workspace.save" }, cause], ["database.idle_error", { operation: undefined }, undefined]]);
});

test("the log line never holds the cause, and a failing reporter never breaks the caller", (context) => {
  const lines: string[] = [];
  context.mock.method(console, "log", (line: string) => lines.push(line));
  setFailureReporter(() => { throw new Error("reporter down"); });
  logEvent("action.failed", { operation: "workspace.save", outcome: "error" }, new Error("ana@example.test"));
  assert.doesNotThrow(() => reportFailure("operations.cleanup"));
  assert.equal(lines.length, 1);
  assert.ok(!lines[0].includes("ana@example.test"));
});

test("without a reporter logging works as before", (context) => {
  const lines: string[] = [];
  context.mock.method(console, "log", (line: string) => lines.push(line));
  logEvent("action.failed", { outcome: "error" }, new Error("boom"));
  assert.equal(lines.length, 1);
});

test("Sentry packages are imported only in the observability folder and instrumentation", async () => {
  const offenders: string[] = [];
  async function walk(directory: string): Promise<void> {
    for (const entry of await readdir(path.join(projectDir, directory), { withFileTypes: true })) {
      const relative = path.join(directory, entry.name);
      if (entry.isDirectory()) await walk(relative);
      else if (/\.tsx?$/.test(entry.name) && (await readFile(path.join(projectDir, relative), "utf8")).includes("@sentry/")) offenders.push(relative.replaceAll("\\", "/"));
    }
  }
  for (const directory of ["app", "components", "lib", "scripts"]) await walk(directory);
  assert.deepEqual(offenders.filter((file) => !file.startsWith("lib/observability/")), []);
  assert.ok(!(await readFile(path.join(projectDir, "proxy.ts"), "utf8")).includes("@sentry/"));
  assert.ok(!(await readFile(path.join(projectDir, "lib/observability/reporting.ts"), "utf8")).match(/^import (?!type).*@sentry/m), "the rules load no provider code");
});
