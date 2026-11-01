// relate run backwards through a 16-part Clifford product (BACKLOG I95):
// given only the answer of times(a, b) = table product(Cl(1, 3)'s table,
// a, b), the search makes thousands of part-by-part constraints on the
// same 32 unknowns. It must stay within its step budget and its memory:
// before, putting each constraint to sleep copied the list of those
// already asleep on its unknowns, and showing what was left substituted
// every leftover equation into every other, so the run used all the
// memory without spending a step.

import { test } from "node:test";
import assert from "node:assert/strict";
import { Lang } from "../src/lang/dsl.ts";
import { LIBRARY } from "../src/lang/library.ts";
import { base } from "../src/lang/load.ts";
import { relate } from "../src/lang/relate.ts";
import { NUMBER } from "../src/lang/types.ts";
import type { Id } from "../src/model.ts";

test("relate backwards through a Cl(1, 3) product ends within its budget", () => {
  const N = 16;
  const k = new Lang(LIBRARY.code);
  const lib = (name: string) => LIBRARY.modules.flatMap((m) => m.exports).find((d) => LIBRARY.names[d] === name)!;
  const M = k.type("Mv", [], [["mv", Array.from({ length: N }, (_, i) => [`p${i}`, () => k.tref(NUMBER)] as [string, () => Id])]]);
  const def = (name: string, body: () => Id) => { const d = k.def(name); k.define(d, body()); return d; };
  const unit = (i: number) => k.call(M.v.mv, ...Array.from({ length: N }, (_, j) => k.lit(j === i ? 1 : 0)));
  const table = def("cl13", () => k.call(lib("clifford table"), k.list(...[1, -1, -1, -1].map((x) => k.lit(x))), k.list(...Array.from({ length: N }, (_, i) => unit(i)))));
  const times = def("times", () => k.fn(["a", "b"], (a, b) => k.call(lib("table product"), k.x(table), a, b)));
  let steps = 0;
  const BUDGET = 5000;
  const spend = () => ++steps < BUDGET;
  const out = { tag: M.v.mv, fields: Array.from({ length: N }, (_, i) => (i === 0 ? 1 : 0)) };
  const t0 = Date.now();
  const first = relate(base(k.code), times, { out }, { spend }).next();
  assert.ok(steps <= BUDGET, `spent ${steps}`);
  assert.ok(Date.now() - t0 < 60_000, `took ${Date.now() - t0} ms`);
  // a · b = 1 has a family of answers: one with unknowns left, and what is
  // left is counted, not written out.
  if (!first.done) assert.ok(first.value.free.length > 0 && first.value.residual.some((r) => /equations are left/.test(r)), first.value.residual.slice(0, 3).join("; "));
});
