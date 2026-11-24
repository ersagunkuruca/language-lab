// Two arrays joined (C324, GAPS round 23 BG2): bazaar's `concat arrays`,
// `array of(append(items of array(a), items of array(b)))`, joins two rows
// at every match of a hash join. On the core IR's JavaScript the items are
// copied into one array, with no list of them made and read back
// (core-js.ts writtenArrays), and it prints what the evaluator does.

import { test } from "node:test";
import assert from "node:assert/strict";
import { kids, type SExpr } from "../src/scalar.ts";
import { lowerCore } from "../src/core-js.ts";
import { program, ways } from "../gaps/bazaar.ts";

test("bazaar's concat arrays copies the two rows into one, no list between (C324)", async () => {
  const p = program();
  const ir = lowerCore(p.code, p.info, p.names, [p.main]);
  const all = (e: SExpr): SExpr[] => [e, ...kids(e).flatMap(all)];
  const concat = ir.funcs.find((f) => f.name === "concat arrays")!;
  assert.ok(all(concat.body).some((e) => e.k === "rt" && /^array\.concat\.a\d+$/.test(e.fn)), "concat arrays joins in one step");
  assert.ok(!all(concat.body).some((e) => e.k === "rt" && /^array\.items\.a\d+$/.test(e.fn)), "no list of either row's items");
  const w = await ways();
  assert.deepEqual(w.core(["400"]), w.evaluator(["400"]));
});
