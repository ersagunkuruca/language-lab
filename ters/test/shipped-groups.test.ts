// A shipped example's definition groups (E314, editor/keptChecks.ts) are
// taken by the editor's group store when its check first asks for one, as
// a group kept in the browser is, and kept there from then on.
import { test } from "node:test";
import assert from "node:assert/strict";
import { addShipped, groupStore, hashOf, keepInMemory, pack, shippedFor } from "../../editor/checkStore.ts";

test("a shipped group is taken when the check asks for it", () => {
  keepInMemory("b1");
  const closed = { types: new Map([["x", 1]]), names: new Set(["a"]), gone: undefined };
  const k = `b1|group|${hashOf("some group")}`;
  addShipped({ [k]: JSON.parse(pack(closed)) }, "sheet");
  assert.ok(shippedFor("sheet"));
  assert.equal(groupStore.load("another group"), undefined);
  const got = groupStore.load("some group") as unknown as typeof closed;
  assert.deepEqual(got.types, new Map([["x", 1]]));
  assert.deepEqual(got.names, new Set(["a"]));
  // Another build's isn't.
  keepInMemory("b2");
  assert.equal(groupStore.load("some group"), undefined);
});
