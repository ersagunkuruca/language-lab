// C361: an Int's +, - or * whose inputs are themselves sums or products
// gets them as locals first, so the small case written out (C359)
// reaches it: the answers stay the evaluator's, past 2^28 too.
import { test } from "node:test";
import assert from "node:assert/strict";
import { infer } from "../../ters/src/lang/infer.ts";
import { Lang } from "../../ters/src/lang/dsl.ts";
import { base, baseNames, checkOptions } from "../../ters/src/lang/load.ts";
import { makeRunner } from "../../ters/src/lang/run.ts";
import { INT_OPS } from "../../ters/src/lang/std.ts";
import { compiledDefs, emitCoreJs, lowerCore } from "../src/core-js.ts";
import { intArgs } from "../src/int-args.ts";

// f(a, b, c) = a * b + (c - a)
function program() {
  const k = new Lang();
  const d = k.def("f");
  k.define(d, k.fn(["a", "b", "c"], (a, b, c) => k.call(INT_OPS.add, k.call(INT_OPS.mul, a, b), k.call(INT_OPS.sub, c, a))));
  const code = base(k.code), names = { ...baseNames(), ...k.names }, info = infer(code, names, undefined, checkOptions);
  assert.deepEqual(info.errors.map((e) => e.message), []);
  return { code, names, info, d };
}

const INPUTS: [number | bigint, number | bigint, number | bigint][] = [[1, 2, 3], [2 ** 14, 2 ** 14, 0], [2 ** 27, 2, -(2 ** 27)], [-3, 0, 5], [2n ** 70n, 1, 2], [1, 2 ** 20, 2n ** 40n]];

test("an Int's sum of a product and a difference gives the evaluator's answers", () => {
  const { code, names, info, d } = program();
  const f = compiledDefs(code, info, names, ["f"]).f;
  const r = makeRunner(code, info, { print: () => {}, names });
  for (const [a, b, c] of INPUTS) {
    let want: unknown;
    for (const v of r.call(r.value(d), a, b, c)) { want = v; break; }
    const got = f(a, b, c);
    assert.ok(Object.is(got, want), `f(${a}, ${b}, ${c}): ${String(got)}, want ${String(want)}`);
  }
});

test("the outer sum's inputs become locals, and its small case is written out", () => {
  const { code, names, info, d } = program();
  const ir = lowerCore(code, info, names, [d]);
  assert.equal(intArgs(ir), 0, "core-js already ran it");
  assert.match(emitCoreJs(ir).js, /typeof l\d+ === "number" && typeof l\d+ === "number" && \(t\d+ = l\d+ \+ l\d+\)/);
});
