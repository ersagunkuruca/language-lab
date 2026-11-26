// The passes after the scalar lowering taken again for an edit of a
// number (ir-again.ts): their last answer with the new numbers put in,
// unless a pass read a changed number's value, made a number of its old
// value, or the number left its class.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { CoreIR, SExpr } from "../src/scalar.ts";
import { passesAgain, passesAgainCount, readValue } from "../src/ir-again.ts";
import { forgetKept } from "../../ters/src/kept.ts";

const lowered = (v: number): CoreIR => ({
  funcs: [{ def: "d", name: "f", params: ["f64"], result: "f64", locals: ["f64"], body: { k: "op", op: "add", args: [{ k: "local", i: 0 }, { k: "num", v }] }, spends: false, budgeted: false }],
  refused: new Map(), records: [], data: [], arrays: [], tables: [], fns: [], shapes: [], escapes: [], rounded: new Set(),
  code: { nodes: {}, defs: [] }, info: {} as CoreIR["info"],
});
// A pass that puts the body under a negation, keeping what it was given.
const negated = (ir: CoreIR) => { for (const f of ir.funcs) f.body = { k: "op", op: "neg", args: [f.body] }; return ir; };
const numberIn = (ir: CoreIR) => ((ir.funcs[0].body as Extract<SExpr, { k: "op" }>).args[0] as Extract<SExpr, { k: "op" }>).args[1];

test("a number's new value is put in the passes' last answer", () => {
  forgetKept();
  let runs = 0;
  const run = (ir: CoreIR) => { runs++; return negated(ir); };
  passesAgain("t", lowered(2), run);
  const was = passesAgainCount;
  const again = passesAgain("t", lowered(5), run);
  assert.equal(runs, 1);
  assert.equal(passesAgainCount, was + 1);
  assert.deepEqual(numberIn(again), { k: "num", v: 5 });
  // Compared with the lowering they last ran on: 2, not 5.
  assert.deepEqual(numberIn(passesAgain("t", lowered(7), run)), { k: "num", v: 7 });
  assert.equal(runs, 1);
});

test("the passes run again where one read the number's value, made a number of its old value, or the number changed class", () => {
  for (const [why, pass, to] of [
    ["read", (ir: CoreIR) => { readValue((ir.funcs[0].body as Extract<SExpr, { k: "op" }>).args[1]); return negated(ir); }, 5],
    ["copied", (ir: CoreIR) => { const b = ir.funcs[0].body as Extract<SExpr, { k: "op" }>; ir.funcs[0].body = { k: "op", op: "neg", args: [{ ...b, args: [b.args[0], { ...b.args[1] }] }] }; return ir; }, 5],
    ["class", negated, -5],
  ] as const) {
    forgetKept();
    let runs = 0;
    const run = (ir: CoreIR) => { runs++; return pass(ir); };
    passesAgain("t", lowered(2), run);
    const again = passesAgain("t", lowered(to), run);
    assert.equal(runs, 2, why);
    assert.deepEqual(numberIn(again), { k: "num", v: to }, why);
  }
});
