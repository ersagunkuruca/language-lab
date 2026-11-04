// `with fuel` around several answers on the core IR (C137c21): each answer
// goes on to the rest of the search, which spends the budget outside, and
// running out of either ends that budget's search, as in the evaluator.
// Checked on the core IR's JavaScript, WebAssembly and C.

import { test } from "node:test";
import assert from "node:assert/strict";
import { Lang } from "../../ters/src/lang/dsl.ts";
import { infer } from "../../ters/src/lang/infer.ts";
import { base, baseNames } from "../../ters/src/lang/load.ts";
import { LIBRARY } from "../../ters/src/lang/library.ts";
import { makeRunner } from "../../ters/src/lang/run.ts";
import { CONS, NIL, S } from "../../ters/src/lang/std.ts";
import { B } from "../../ters/src/prelude.ts";
import { emitCoreJs, loadCoreJs, lowerCore } from "../src/core-js.ts";
import { lowerScalar } from "../src/scalar.ts";
import { emitWasm, instantiate } from "../src/wasm.ts";
import { build, skip } from "./c-harness.ts";

const BUDGETS = [[3, 40], [12, 40], [12, 9], [30, 25], [100, 100], [0, 5], [7, 0]];

// down(n) takes about n calls the checker can't see end, so each spends
// one. inner: y + down(y · x) for y of 1 to 5, under its own fuel; outer:
// every inner answer plus down(x), under another; score: outer's answers
// as one number, a digit (base 100) each, so every engine gives a Float64.
function program() {
  const k = new Lang(LIBRARY.code);
  const down = k.def("down"), digits = k.def("digits");
  k.define(digits, k.fn(["xs"], (xs) => k.match(xs, [
    { variant: NIL, names: [], body: () => k.lit(0) },
    { variant: CONS, names: ["h", "t"], body: ([h, t]) => k.call(B.add, h, k.call(B.mul, k.lit(100), k.call(digits, t))) },
  ])));
  k.define(down, k.fn(["n"], (n) => k.if(k.call(S.less, n, k.lit(0.5)), k.lit(0), k.call(down, k.call(B.sub, n, k.lit(1))))));
  const defs = BUDGETS.map(([i, o]) => {
    const inner = k.def(`inner ${i} ${o}`), outer = k.def(`outer ${i} ${o}`), score = k.def(`score ${i} ${o}`);
    k.define(inner, k.fn(["x"], (x) => k.call(S.fuel, k.lit(i), k.thunk(() => {
      const y = k.call(S.oneOf, k.listOf(...[1, 2, 3, 4, 5].map((v) => k.lit(v))));
      return k.call(k.fn(["y"], (y) => k.call(B.add, y, k.call(down, k.call(B.mul, y, x)))), y);
    }))));
    k.define(outer, k.fn(["x"], (x) => k.call(S.all, k.thunk(() => k.call(S.fuel, k.lit(o), k.thunk(() => k.call(B.add, k.call(inner, x), k.call(down, x))))))));
    k.define(score, k.fn(["x"], (x) => k.call(digits, k.call(outer, x))));
    return { outer, score };
  });
  const code = base(k.code), names = baseNames(k.names), info = infer(code, names);
  assert.deepEqual(info.errors.map((e) => e.message), []);
  return { code, names, info, defs, down };
}
const XS = [0, 1, 2, 3];
const list = (v: unknown): number[] => { const out: number[] = []; for (let c = v as { tag: string; fields: unknown[] }; c.fields.length; c = c.fields[1] as typeof c) out.push(c.fields[0] as number); return out; };

test("with fuel around several answers, the rest spending the budget outside: the evaluator's answers", async () => {
  const p = program();
  const r = makeRunner(p.code, p.info, { print: () => {}, names: p.names });
  const ev = (d: string, x: number) => { for (const v of r.call(r.value(d), x)) return v; };
  // Some budgets cut the answers short, inside and outside.
  const lists = p.defs.map((d) => XS.map((x) => list(ev(d.outer, x))));
  assert.ok(lists.some((w) => w.some((a) => a.length < 5)) && lists.some((w) => w.some((a) => a.length === 5)) && lists.some((w) => w.some((a) => !a.length)));
  const want = p.defs.flatMap((d) => XS.map((x) => ev(d.score, x)));
  const scores = p.defs.map((d) => d.score);
  const core = lowerCore(p.code, p.info, p.names, scores);
  assert.deepEqual([...core.refused.entries()], []);
  const fs = loadCoreJs(core), at = (fns: { def: string; inner?: boolean }[], d: string) => fns.findIndex((g) => g.def === d && !g.inner);
  assert.deepEqual(scores.flatMap((d) => XS.map((x) => fs[at(core.funcs, d)](x))), want, "core IR's JavaScript");
  const lowered = lowerScalar(p.code, p.info, p.names, scores, { data: true });
  assert.deepEqual([...lowered.refused.entries()], []);
  const w = await instantiate(emitWasm(lowered)) as unknown as Record<string, (x: number) => unknown>;
  assert.deepEqual(scores.flatMap((d) => XS.map((x) => w[lowered.funcs[at(lowered.funcs, d)].name](x))), want, "WebAssembly");
  if (!skip) {
    const got = build(lowered)(scores.flatMap((d) => XS.map((x): [number, number[]] => [at(lowered.funcs, d), [x]])));
    assert.deepEqual(got.map((g) => g.value), want, "C");
    assert.ok(got.every((g) => g.live === 0));
  }
});

// The fuel is endless outside a budget, so a program that sets none spends
// none (C171): down alone counts nothing on any target; under the scores'
// budgets it spends.
test("a function that may not end spends fuel only where a budget is set", () => {
  const p = program();
  const spends = (roots: string[]) => lowerScalar(p.code, p.info, p.names, roots, { data: true }).funcs.filter((f) => f.name === "down").map((f) => f.spends);
  assert.deepEqual(spends([p.down]), [false]);
  assert.ok(spends(p.defs.map((d) => d.score)).every(Boolean));
  assert.doesNotMatch(emitCoreJs(lowerCore(p.code, p.info, p.names, [p.down])).js, /fuel/);
});
