// derivative(f) of a function value on the core IR's JavaScript (C137c20):
// the evaluator's derivative, looking inside the printed closure (which
// carries its lambda), and what it gives called as a function, a second
// time too.

import { test } from "node:test";
import assert from "node:assert/strict";
import { Lang } from "../../ters/src/lang/dsl.ts";
import { infer } from "../../ters/src/lang/infer.ts";
import { base, baseNames } from "../../ters/src/lang/load.ts";
import { makeRunner } from "../../ters/src/lang/run.ts";
import { S } from "../../ters/src/lang/std.ts";
import { B } from "../../ters/src/prelude.ts";
import { emitCoreJs, loadCoreJs, lowerCore } from "../src/core-js.ts";

test("derivative and gradient of a function value, and a second derivative, as the evaluator gives them", () => {
  const k = new Lang();
  const cube = k.def("cube"), slope = k.def("slope"), bend = k.def("bend"), steep = k.def("steep"), at2 = k.def("at 2");
  k.define(cube, k.fn(["x"], (x) => k.call(B.mul, x, k.call(B.mul, x, k.call(B.add, x, k.lit(1))))));
  k.define(slope, k.fn(["f", "x"], (f, x) => k.call(k.call(S.derivative, f), x)));
  k.define(bend, k.fn(["f", "x"], (f, x) => k.call(k.call(S.derivative, k.call(S.derivative, f)), x)));
  k.define(steep, k.fn(["f", "x"], (f, x) => k.call(k.call(S.gradient, f), x)));
  k.define(at2, k.fn(["x"], (x) => k.call(B.add, k.call(slope, cube, x), k.call(B.add, k.call(bend, cube, x), k.call(steep, cube, x)))));
  const code = base(k.code), names = baseNames(k.names), info = infer(code, names);
  assert.deepEqual(info.errors.map((e) => e.message), []);
  const r = makeRunner(code, info, { print: () => {}, names });
  const ev = (x: number) => { for (const v of r.call(r.value(at2), x)) return v; };
  const core = lowerCore(code, info, names, [at2]);
  assert.deepEqual([...core.refused.entries()], []);
  assert.match(emitCoreJs(core).js, /R\.rt\("derive:builtin\.derivative"/, "the evaluator's derivative, not one written in place");
  const f = loadCoreJs(core)[core.funcs.findIndex((g) => g.def === at2 && !g.inner)];
  // x³ + x²: 3x² + 2x, then 6x + 2, then 3x² + 2x again.
  for (const x of [0, 1, 2, -1.5]) assert.equal(f(x), ev(x), `at ${x}`);
  assert.equal(f(2), 16 + 14 + 16);
});
