// A `with fuel` whose budget is worked out as the program runs (C367): an
// argument, or a number made from one. JavaScript, WebAssembly and C
// refused it, holding only a number written down. Now they work it out
// first, on the fuel outside, and give the body that much, as the evaluator
// does. A budget below 0 runs out at the first step, as 0 does.
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
import { loadCoreJs, lowerCore } from "../src/core-js.ts";
import { lowerScalar } from "../src/scalar.ts";
import { emitWasm, instantiate } from "../src/wasm.ts";
import { build, skip } from "./c-harness.ts";

// down(x) takes about x calls the checker can't see end, so each spends one.
// within(n, x): down(x) + 1 under a budget of n, or −1 when it runs out.
// twice(n, x): the same with a budget of n · 2.
// each(n, x): every y + down(y · x) for y of 1 to 4 under n, as digits.
function program() {
  const k = new Lang(LIBRARY.code);
  const down = k.def("down"), digits = k.def("digits"), within = k.def("within"), twice = k.def("twice"), each = k.def("each");
  k.define(digits, k.fn(["xs"], (xs) => k.match(xs, [
    { variant: NIL, names: [], body: () => k.lit(0) },
    { variant: CONS, names: ["h", "t"], body: ([h, t]) => k.call(B.add, h, k.call(B.mul, k.lit(100), k.call(digits, t))) },
  ])));
  k.define(down, k.fn(["n"], (n) => k.if(k.call(S.less, n, k.lit(0.5)), k.lit(0), k.call(down, k.call(B.sub, n, k.lit(1))))));
  const under = (n: string, x: string) => k.call(S.first, k.thunk(() => k.call(S.fuel, n, k.thunk(() => k.call(B.add, k.call(down, x), k.lit(1))))), k.thunk(() => k.lit(-1)));
  k.define(within, k.fn(["n", "x"], (n, x) => under(n, x)));
  k.define(twice, k.fn(["n", "x"], (n, x) => under(k.call(B.mul, n, k.lit(2)), x)));
  k.define(each, k.fn(["n", "x"], (n, x) => k.call(digits, k.call(S.all, k.thunk(() => k.call(S.fuel, n, k.thunk(() => {
    const y = k.call(S.oneOf, k.listOf(...[1, 2, 3, 4].map((v) => k.lit(v))));
    return k.call(k.fn(["y"], (y) => k.call(B.add, y, k.call(down, k.call(B.mul, y, x)))), y);
  })))))));
  const code = base(k.code), names = baseNames(k.names), info = infer(code, names);
  assert.deepEqual(info.errors.map((e) => e.message), []);
  return { code, names, info, roots: [within, twice, each] };
}
const NS = [-3, 0, 1, 2, 2.5, 4, 9, 40];
const XS = [0, 1, 3, 8];
const CASES = NS.flatMap((n) => XS.map((x): [number, number] => [n, x]));

test("with fuel given a budget as the program runs: the evaluator's answers on every target", async () => {
  const p = program();
  const r = makeRunner(p.code, p.info, { print: () => {}, names: p.names });
  const ev = (d: string, n: number, x: number) => { for (const v of r.call(r.value(d), n, x)) return v; };
  const want = p.roots.flatMap((d) => CASES.map(([n, x]) => ev(d, n, x)));
  // Some budgets run out and some don't.
  const w0 = CASES.map(([n, x]) => ev(p.roots[0], n, x));
  assert.ok(w0.includes(-1) && w0.some((v) => v !== -1));
  const core = lowerCore(p.code, p.info, p.names, p.roots);
  assert.deepEqual([...core.refused.entries()], []);
  const fs = loadCoreJs(core), at = (fns: { def: string; inner?: boolean }[], d: string) => fns.findIndex((g) => g.def === d && !g.inner);
  assert.deepEqual(p.roots.flatMap((d) => CASES.map(([n, x]) => fs[at(core.funcs, d)](n, x))), want, "core IR's JavaScript");
  const lowered = lowerScalar(p.code, p.info, p.names, p.roots, { data: true });
  assert.deepEqual([...lowered.refused.entries()], []);
  const w = await instantiate(emitWasm(lowered)) as unknown as Record<string, (n: number, x: number) => unknown>;
  assert.deepEqual(p.roots.flatMap((d) => CASES.map(([n, x]) => w[lowered.funcs[at(lowered.funcs, d)].name](n, x))), want, "WebAssembly");
  if (!skip) {
    const got = build(lowered)(p.roots.flatMap((d) => CASES.map(([n, x]): [number, number[]] => [at(lowered.funcs, d), [n, x]])));
    assert.deepEqual(got.map((g) => g.value), want, "C");
    assert.ok(got.every((g) => g.live === 0));
  }
});

// A shader's budget is still a number written down: its bound is fixed when
// it's built.
test("a shader's budget is still a number written down", () => {
  const p = program();
  const lowered = lowerScalar(p.code, p.info, p.names, [p.roots[0]], {});
  assert.match([...lowered.refused.values()].join("\n"), /budget that isn't a number written down/);
});
