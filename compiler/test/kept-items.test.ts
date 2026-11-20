// `keep` over a List kept as an array, a loop pushing the kept items
// (G1b1, kept-items.ts): the greenhouse's `keep(things, is moth)` with no
// list of the things taken apart, no list of answers reversed and no
// array made of it. That every program prints the same is the sweeps'.

import { test } from "node:test";
import assert from "node:assert/strict";
import { represented } from "../../ters/cli/represented.ts";
import { representationsIn } from "../../ters/src/lang/represent.ts";
import { load } from "../src/program.ts";
import { lowerCore } from "../src/core-js.ts";
import { kids, type SExpr } from "../src/scalar.ts";

const found = (e: SExpr, p: (e: SExpr) => boolean): boolean => p(e) || kids(e).some((k) => found(k, p));

test("keep over an array's items is a loop pushing the kept ones (G1b1)", () => {
  const p = load("../../compiler/gaps/greenhouse"), main = p.named("main");
  // Its Lists as arrays, as the compiler represents them.
  const r = represented({ title: "greenhouse", code: p.code, own: p.own.defs, names: p.pres.names, info: p.info, reps: representationsIn(p.code, p.info, p.pres.names, p.own.defs), options: p.options }, main, true);
  const ir = lowerCore(r.code, r.info, r.names, [main]);
  const loop = ir.funcs.find((f) => f.name === "keep·is moth.value.kept");
  assert.ok(loop, ir.funcs.map((f) => f.name).join(", "));
  assert.ok(ir.funcs.some((f) => f.name === "keep·is moth.value" && f.body.k === "call" && ir.funcs[f.body.fn] === loop), "keep calls its loop");
  assert.ok(found(loop.body, (e) => e.k === "rt" && /^array\.push\.a\d+$/.test(e.fn)), "the kept item pushed");
  assert.ok(found(loop.body, (e) => e.k === "rt" && /^array\.get\.a\d+$/.test(e.fn)), "the item read by position");
  assert.ok(!found(loop.body, (e) => e.k === "rt" && /^(array\.(items|of)\.a\d+|choose\.split)$/.test(e.fn)), "no list between");
});
