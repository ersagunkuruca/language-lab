// A list built onto a call of itself (`map`'s cons(f(x), map(rest, f)),
// the strings program's FFT a level at a time) is a loop keeping the items
// so far newest first (scalar.ts modCons), turned round at the end onto
// the answer (C279): in JavaScript each of those cells is turned where it
// is, as only that loop has seen them, so no list is made a second time.
// That every program still prints the same is every other test's.

import { test } from "node:test";
import assert from "node:assert/strict";
import { represented } from "../../ters/cli/represented.ts";
import { representationsIn } from "../../ters/src/lang/represent.ts";
import { load } from "../src/program.ts";
import { emitCoreJs, lowerCore } from "../src/core-js.ts";
import { kids, type SExpr } from "../src/scalar.ts";

const found = (e: SExpr, p: (e: SExpr) => boolean): boolean => p(e) || kids(e).some((k) => found(k, p));

test("an onto loop's items are turned round in their own cells (C279)", () => {
  const p = load("../../compiler/gaps/strings"), main = p.named("main");
  const r = represented({ title: "strings", code: p.code, own: p.own.defs, names: p.pres.names, info: p.info, reps: representationsIn(p.code, p.info, p.pres.names, p.own.defs), options: p.options }, main, true);
  const ir = lowerCore(r.code, r.info, r.names, [main]);
  const turned = new Set(ir.funcs.map((f, i) => [f, i] as const).filter(([f]) => f.name.endsWith(".turned")).map(([, i]) => i));
  assert.ok(turned.size > 0);
  // Every onto loop ends turning its items so far, never by the plain reverse.
  const onto = ir.funcs.filter((f) => f.name.endsWith(".onto"));
  assert.ok(onto.length > 0);
  const reverse = new Set(ir.funcs.map((f, i) => [f, i] as const).filter(([f]) => f.name.endsWith(".reverse")).map(([, i]) => i));
  for (const f of onto) {
    assert.ok(found(f.body, (e) => e.k === "call" && turned.has(e.fn)), f.name);
    assert.ok(!found(f.body, (e) => e.k === "call" && reverse.has(e.fn)), f.name);
  }
  // In JavaScript, written into the cell; anything else made anew.
  const { js } = emitCoreJs(ir);
  assert.match(js, /\(l0 instanceof K\d+ \? \(l0\.f1 = l1, l0\) : new K\d+\(/);
});
