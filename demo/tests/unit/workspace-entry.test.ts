import assert from "node:assert/strict";
import { test } from "node:test";
import {
  chooseEntry,
  forgetOrganizationCookie,
  isOrganizationId,
  LAST_ORGANIZATION_COOKIE,
  LAST_ORGANIZATION_MAX_AGE_SECONDS,
  organizationHomePath,
  rememberOrganizationCookie,
} from "../../lib/workspace/entry.ts";

const first = "0f8b7a52-1d7e-4e64-9a3c-6a1d2b3c4d5e";
const second = "7c1e2d3f-4a5b-4c6d-8e9f-a0b1c2d3e4f5";

test("someone without an organization is asked to create one, whatever the cookie says", () => {
  assert.deepEqual(chooseEntry([], undefined), { kind: "create" });
  assert.deepEqual(chooseEntry([], first), { kind: "create" });
});

test("a single organization opens directly, even when the cookie names another", () => {
  assert.deepEqual(chooseEntry([{ organizationId: first }], undefined), { kind: "open", organizationId: first });
  assert.deepEqual(chooseEntry([{ organizationId: first }], second), { kind: "open", organizationId: first });
});

test("with several organizations only a remembered current membership opens directly", () => {
  const memberships = [{ organizationId: first }, { organizationId: second }];
  assert.deepEqual(chooseEntry(memberships, second), { kind: "open", organizationId: second });
  assert.deepEqual(chooseEntry(memberships, second.toUpperCase()), { kind: "open", organizationId: second });
  // An organization the person left, someone else's, or anything malformed leads to the choice.
  assert.deepEqual(chooseEntry(memberships, "11111111-2222-4333-8444-555555555555"), { kind: "choose" });
  assert.deepEqual(chooseEntry(memberships, undefined), { kind: "choose" });
  assert.deepEqual(chooseEntry(memberships, ""), { kind: "choose" });
  assert.deepEqual(chooseEntry(memberships, `${second}; Path=/`), { kind: "choose" });
});

test("only well-formed organization ids are accepted from URLs and cookies", () => {
  assert.equal(isOrganizationId(first), true);
  for (const value of ["", "org", `${first}x`, `../${first}`, undefined, null, 42]) assert.equal(isOrganizationId(value), false);
  assert.equal(organizationHomePath(first), `/org/${first}/`);
});

test("the remembered organization cookie holds only the id, for the whole site, and is Secure on HTTPS", () => {
  assert.equal(rememberOrganizationCookie(first, true), `${LAST_ORGANIZATION_COOKIE}=${first}; Path=/; Max-Age=${LAST_ORGANIZATION_MAX_AGE_SECONDS}; SameSite=Lax; Secure`);
  assert.doesNotMatch(rememberOrganizationCookie(first, false), /Secure/);
  assert.throws(() => rememberOrganizationCookie("x; Domain=evil.example", true));
  assert.equal(forgetOrganizationCookie(true), `${LAST_ORGANIZATION_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax; Secure`);
});
