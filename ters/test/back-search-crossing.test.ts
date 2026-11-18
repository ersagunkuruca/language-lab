// What Run's search hands its worker (editor/backSearch.ts sendable, I319):
// a long list crosses as its items, so postMessage's copy doesn't recurse
// into its tails, and a value with a function inside stays on the page.

import { test } from "node:test";
import assert from "node:assert/strict";
import { received, sendable } from "../../editor/backSearch.ts";
import { toList, fromList, type Data } from "../src/lang/run.ts";

test("a list of 100,000 crosses as its items and comes back the same", () => {
  const xs = Array.from({ length: 100000 }, (_, i) => ({ tag: "pair", fields: [i, `p${i}`] }));
  const sent = sendable({ patches: toList(xs), n: 3 });
  assert.ok(sent);
  const back = received(structuredClone(sent));
  assert.equal(back.n, 3);
  const items = fromList(back.patches as Data) as Data[];
  assert.equal(items.length, 100000);
  assert.deepEqual(items[99999], { tag: "pair", fields: [99999, "p99999"] });
});

test("a function anywhere inside a value isn't sent", () => {
  const f = () => [];
  assert.equal(sendable({ a: 1, b: toList([{ tag: "box", fields: [f] }]) }), null);
  assert.equal(sendable({ a: { tag: "box", fields: [[1, f]] } }), null);
});
