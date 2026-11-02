import assert from "node:assert/strict";
import test from "node:test";
import { describeChanges } from "../recovery/snapshots.ts";

const live = {
  functions: [
    { signature: "app.member_role(uuid)", definition: "CREATE FUNCTION app.member_role(uuid)\n SECURITY DEFINER\nAS $$ select 1 $$", owner: "<owner>", acl: ["<owner>=EXECUTE", "aisistent_runtime=EXECUTE"] },
    { signature: "app.removed(uuid)", definition: "x", owner: "<owner>", acl: [] },
  ],
  indexes: [{ tablename: "users", indexname: "users_pkey", indexdef: "CREATE UNIQUE INDEX users_pkey ON app.users USING btree (id)" }],
};

test("restore differences name the object, the property and both values, without table rows", () => {
  const copy = {
    functions: [
      { signature: "app.member_role(uuid)", definition: "CREATE FUNCTION app.member_role(uuid)\n STABLE SECURITY DEFINER\nAS $$ select 1 $$", owner: "<owner>", acl: ["<owner>=EXECUTE", "PUBLIC=EXECUTE", "aisistent_runtime=EXECUTE"] },
      { signature: "app.extra()", definition: "y", owner: "<owner>", acl: [] },
    ],
    indexes: live.indexes,
  };
  assert.deepEqual(describeChanges(copy, live), [
    'functions app.member_role(uuid): definition differs at line 2: live "SECURITY DEFINER", copy "STABLE SECURITY DEFINER"',
    'functions app.member_role(uuid): acl live ["<owner>=EXECUTE","aisistent_runtime=EXECUTE"], copy ["<owner>=EXECUTE","PUBLIC=EXECUTE","aisistent_runtime=EXECUTE"]',
    "functions app.removed(uuid): missing in the copy",
    "functions app.extra(): only in the copy",
  ]);
  assert.deepEqual(describeChanges(live, live), []);
});

test("a long list of restore differences is cut short", () => {
  const many = { functions: Array.from({ length: 20 }, (_, index) => ({ signature: `app.f${index}()`, definition: "x", owner: "<owner>", acl: [] })) };
  const changes = describeChanges({ functions: [] }, many, 5);
  assert.equal(changes.length, 6);
  assert.equal(changes.at(-1), "… and 15 more");
});
