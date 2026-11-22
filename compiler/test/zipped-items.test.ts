// A fold over `zipped` of two arrays reads both in place (C275, GAPS
// round 20 ST1): strings' YIN difference, `sum(map(zipped(take(xs, w),
// take(drop(xs, lag), w)), f))`, makes no array of pairs. That the
// program prints the same is strings.test.ts's.

import { test } from "node:test";
import assert from "node:assert/strict";
import { represented } from "../../ters/cli/represented.ts";
import { representationsIn } from "../../ters/src/lang/represent.ts";
import { load } from "../src/program.ts";
import { lowerCore } from "../src/core-js.ts";
import { kids, type SExpr } from "../src/scalar.ts";

const found = (e: SExpr, p: (e: SExpr) => boolean): boolean => p(e) || kids(e).some((k) => found(k, p));

test("a fold over zipped arrays reads both by position, with no array of pairs (C275)", () => {
  const p = load("../../compiler/gaps/strings"), main = p.named("main");
  const r = represented({ title: "strings", code: p.code, own: p.own.defs, names: p.pres.names, info: p.info, reps: representationsIn(p.code, p.info, p.pres.names, p.own.defs), options: p.options }, main, true);
  const ir = lowerCore(r.code, r.info, r.names, [main]);
  const loop = ir.funcs.find((f) => f.name.startsWith("difference") && f.name.endsWith(".fold.zipped"));
  assert.ok(loop, ir.funcs.map((f) => f.name).filter((n) => n.startsWith("difference")).join(", "));
  const gets = (e: SExpr) => e.k === "rt" && /^array\.(get|cget\d+)\.a\d+$/.test(e.fn);
  let reads = 0;
  found(loop.body, (e) => { if (gets(e)) reads++; return false; });
  assert.equal(reads, 2, "each array read at the item");
  const difference = ir.funcs.find((f) => /^difference( at Float64)?$/.test(f.name))!;
  assert.ok(difference, "difference lowered");
  const zipped = new Set(ir.funcs.map((f, i) => [f, i] as const).filter(([f]) => /^zipped/.test(f.name)).map(([, i]) => i));
  assert.ok(!found(difference.body, (e) => e.k === "call" && zipped.has(e.fn)), "zipped isn't called");
});
