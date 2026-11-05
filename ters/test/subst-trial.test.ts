// A trial (Subst.trial) reads through to the substitution it was made
// from and keeps what it adds to itself: the palette tries each offer in
// one and throws it away (I167e). What an interface a variable needs is
// read through too, so adding one in a trial mustn't reach the base.

import { test } from "node:test";
import assert from "node:assert/strict";
import { Subst } from "../src/lang/types.ts";

test("a trial's interface needs stay its own", () => {
  const s = new Subst();
  const a = s.fresh();
  s.requireInterface(a, "iface.one", "here");
  const t = s.trial();
  t.requireInterface(a, "iface.two", "there");
  const b = t.fresh();
  t.requireInterface(b, "iface.one", "there");
  assert.deepEqual([...t.needs.get((a as { v: number }).v)!.keys()], ["iface.one", "iface.two"]);
  assert.deepEqual([...s.needs.get((a as { v: number }).v)!.keys()], ["iface.one"]);
  assert.equal(s.needs.has((b as { v: number }).v), false);
});
