// C359: an Int's sum, difference or product whose range isn't known is
// written out for the small case in the core IR's JavaScript, and goes to
// int.ts past 2^28: the answers are the evaluator's, BigInts and -0 too.
import { test } from "node:test";
import assert from "node:assert/strict";
import { infer } from "../../ters/src/lang/infer.ts";
import { Lang } from "../../ters/src/lang/dsl.ts";
import { base, baseNames, checkOptions } from "../../ters/src/lang/load.ts";
import { makeRunner } from "../../ters/src/lang/run.ts";
import { INT_OPS } from "../../ters/src/lang/std.ts";
import { compiledDefs, emitCoreJs, lowerCore } from "../src/core-js.ts";

function program() {
  const k = new Lang();
  const ops = { add: INT_OPS.add, sub: INT_OPS.sub, mul: INT_OPS.mul };
  const defs = Object.entries(ops).map(([n, op]) => { const d = k.def(n); k.define(d, k.fn(["a", "b"], (a, b) => k.call(op, a, b))); return [n, d] as const; });
  const code = base(k.code), names = { ...baseNames(), ...k.names }, info = infer(code, names, undefined, checkOptions);
  assert.deepEqual(info.errors.map((e) => e.message), []);
  return { code, names, info, defs };
}

const INPUTS: [number | bigint, number | bigint][] = [[1, 2], [2 ** 27, 2 ** 27], [2 ** 20, 2 ** 20], [-(2 ** 27), -(2 ** 27)], [0, -5], [-3, 0], [2n ** 70n, 1], [1, 2n ** 70n], [2n ** 40n, -(2n ** 40n)], [2 ** 14, 2 ** 14]];

test("an Int's +, - and * of unknown range give the evaluator's answers, past 2^28 too", () => {
  const { code, names, info, defs } = program();
  const fs = compiledDefs(code, info, names, defs.map(([n]) => n));
  const r = makeRunner(code, info, { print: () => {}, names });
  for (const [n, d] of defs) for (const [a, b] of INPUTS) {
    let want: unknown;
    for (const v of r.call(r.value(d), a, b)) { want = v; break; }
    const got = fs[n](a, b);
    assert.ok(Object.is(got, want), `${n}(${a}, ${b}): ${String(got)} (${typeof got}), want ${String(want)} (${typeof want})`);
  }
});

test("the small case is written out", () => {
  const { code, names, info, defs } = program();
  const ir = lowerCore(code, info, names, defs.map(([, d]) => d));
  assert.match(emitCoreJs(ir).js, /typeof l\d+ === "number" && typeof l\d+ === "number" && \(t\d+ = l\d+ \* l\d+\) > -268435456/);
});
