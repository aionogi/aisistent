import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { contentSecurityPolicy } from "../../lib/security/content-security-policy.ts";

const projectDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const directives = (policy: string) => new Map(policy.split("; ").map((part) => {
  const [name, ...values] = part.split(" ");
  return [name, values] as const;
}));

test("production allows no inline styles or eval; scripts and styles need the request nonce", () => {
  const policy = directives(contentSecurityPolicy("bm9uY2U=", false));
  assert.deepEqual(policy.get("script-src"), ["'self'", "'nonce-bm9uY2U='", "'strict-dynamic'"]);
  assert.deepEqual(policy.get("style-src"), ["'self'", "'nonce-bm9uY2U='"]);
  assert.deepEqual(policy.get("frame-ancestors"), ["'none'"]);
  assert.deepEqual(policy.get("object-src"), ["'none'"]);
  assert.ok(policy.has("upgrade-insecure-requests"));
  assert.ok(![...policy.values()].flat().some((value) => value === "'unsafe-inline'" || value === "'unsafe-eval'"));
});

test("development keeps what the Next.js dev overlay and hot reloading need", () => {
  const policy = directives(contentSecurityPolicy("bm9uY2U=", true));
  assert.deepEqual(policy.get("style-src"), ["'self'", "'unsafe-inline'"]);
  assert.ok(policy.get("script-src")?.includes("'unsafe-eval'"));
  assert.ok(!policy.has("upgrade-insecure-requests"));
});

async function sourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map((entry) => {
    const target = path.join(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(target) : Promise.resolve(/\.(tsx|jsx)$/.test(entry.name) ? [target] : []);
  }));
  return nested.flat();
}

test("components render no inline style attributes or raw HTML, which the production policy would block", async () => {
  const files = [...await sourceFiles(path.join(projectDir, "app")), ...await sourceFiles(path.join(projectDir, "components"))];
  assert.ok(files.length > 20);
  const offenders: string[] = [];
  for (const file of files) {
    const source = await readFile(file, "utf8");
    if (/\sstyle=\{|\sstyle="|dangerouslySetInnerHTML/.test(source)) offenders.push(path.relative(projectDir, file));
  }
  assert.deepEqual(offenders, [], "use CSS classes, or the CSSOM like components/ProgressFill.tsx");
});
