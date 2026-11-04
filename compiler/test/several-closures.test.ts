// Function values with several answers on the core IR (C137c22,
// docs/design/targets/SEVERAL-ANSWER-FUNCTIONS-2026-11-03.md): a function
// type with Choice whose closures choose takes the rest of the search as
// one more input, as a definition with several answers does, so a lambda
// that chooses, a definition used as a value that chooses, and a plain
// lambda kept beside them at the same type all run on the core IR's
// JavaScript, WebAssembly and C with the evaluator's answers.

import { test } from "node:test";
import assert from "node:assert/strict";
import { Lang } from "../../ters/src/lang/dsl.ts";
import { infer } from "../../ters/src/lang/infer.ts";
import { base, baseNames } from "../../ters/src/lang/load.ts";
import { makeRunner } from "../../ters/src/lang/run.ts";
import { CONS, NIL, S } from "../../ters/src/lang/std.ts";
import { B } from "../../ters/src/prelude.ts";
import { loadCoreJs, lowerCore } from "../src/core-js.ts";
import { lowerScalar } from "../src/scalar.ts";
import { emitWasm, instantiate } from "../src/wasm.ts";
import { build, skip } from "./c-harness.ts";

// twice(f, x) = f(f(x)); branch(y) = one of [y + 1, y × 10]. Each score
// folds every answer of a search into one number, in order.
function program() {
  const k = new Lang();
  const lit = (v: number) => k.lit(v);
  const digits = k.def("digits");
  k.define(digits, k.fn(["l"], (l) => k.match(l, [
    { variant: NIL, names: [], body: () => lit(0) },
    { variant: CONS, names: ["h", "t"], body: ([h, t]) => k.call(B.add, h, k.call(B.mul, lit(1000), k.call(digits, t))) },
  ])));
  const twice = k.def("twice");
  k.define(twice, k.fn(["f", "x"], (f, x) => k.call(f, k.call(f, x))));
  const branch = k.def("branch");
  k.define(branch, k.fn(["y"], (y) => k.call(S.oneOf, k.listOf(k.call(B.add, y, lit(1)), k.call(B.mul, y, lit(10))))));
  // A lambda that chooses, given to twice.
  const lambdas = k.def("lambdas");
  k.define(lambdas, k.fn(["x"], (x) => k.call(digits, k.call(S.all, k.thunk(() => k.call(twice, k.fn(["y"], (y) => k.call(S.oneOf, k.listOf(k.call(B.add, y, lit(1)), k.call(B.mul, y, lit(10))))), x))))));
  // A definition used as a value.
  const named = k.def("named");
  k.define(named, k.fn(["x"], (x) => k.call(digits, k.call(S.all, k.thunk(() => k.call(twice, branch, x))))));
  // One that chooses and one that doesn't, in one list, so at one type.
  const mixed = k.def("mixed");
  k.define(mixed, k.fn(["x"], (x) => k.call(digits, k.call(S.all, k.thunk(() =>
    k.call(k.call(S.oneOf, k.listOf(k.fn(["y"], (y) => k.call(B.add, y, lit(2))), k.x(branch))), x))))));
  // The first answer only, past one that has none.
  const first = k.def("first answer");
  k.define(first, k.fn(["x"], (x) => k.call(S.first, k.thunk(() => k.call(twice, k.fn(["y"], (y) => k.if(k.call(S.less, y, lit(5)), k.call(S.fail), k.call(S.oneOf, k.listOf(y, k.call(B.add, y, lit(1)))))), x)), k.thunk(() => lit(-1)))));
  const code = base(k.code), names = baseNames(k.names), info = infer(code, names);
  assert.deepEqual(info.errors.map((e) => e.message), []);
  return { code, names, info, defs: [lambdas, named, mixed, first] };
}
const XS = [1, 2, 7];

test("closures with several answers give the evaluator's answers on the core IR's JavaScript, WebAssembly and C", async () => {
  const p = program();
  const r = makeRunner(p.code, p.info, { print: () => {}, names: p.names });
  const ev = (d: string, x: number) => { for (const v of r.call(r.value(d), x)) return v; };
  const want = p.defs.flatMap((d) => XS.map((x) => ev(d, x)));
  // twice(branch, 1): 3, 20, 11, 100.
  assert.equal(want[0], 3 + 20 * 1000 + 11 * 1e6 + 100 * 1e9);
  const core = lowerCore(p.code, p.info, p.names, p.defs);
  assert.deepEqual([...core.refused.entries()], []);
  const fs = loadCoreJs(core), at = (fns: { def: string; inner?: boolean }[], d: string) => fns.findIndex((g) => g.def === d && !g.inner);
  assert.deepEqual(p.defs.flatMap((d) => XS.map((x) => fs[at(core.funcs, d)](x))), want, "core IR's JavaScript");
  const lowered = lowerScalar(p.code, p.info, p.names, p.defs, { data: true });
  assert.deepEqual([...lowered.refused.entries()], []);
  const w = await instantiate(emitWasm(lowered)) as unknown as Record<string, (x: number) => unknown>;
  assert.deepEqual(p.defs.flatMap((d) => XS.map((x) => w[lowered.funcs[at(lowered.funcs, d)].name](x))), want, "WebAssembly");
  if (!skip) {
    const got = build(lowered)(p.defs.flatMap((d) => XS.map((x): [number, number[]] => [at(lowered.funcs, d), [x]])));
    assert.deepEqual(got.map((g) => g.value), want, "C");
    assert.ok(got.every((g) => g.live === 0), "every cell freed");
  }
});
