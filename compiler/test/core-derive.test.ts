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
import { emitCoreJs, loadCoreJs, loadPrinted, lowerCore, printed } from "../src/core-js.ts";

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
  // A derivative's result asked for its derivative again (bend): the
  // evaluator's, looking inside the closure, which carries its lambda.
  const js = emitCoreJs(core).js;
  assert.match(js, /R\.rt\("derive:builtin\.derivative"/, "the evaluator's derivative, not one written in place");
  assert.match(js, /"lambda":/);
  const f = loadCoreJs(core)[core.funcs.findIndex((g) => g.def === at2 && !g.inner)];
  // x³ + x²: 3x² + 2x, then 6x + 2, then 3x² + 2x again.
  for (const x of [0, 1, 2, -1.5]) assert.equal(f(x), ev(x), `at ${x}`);
  assert.equal(f(2), 16 + 14 + 16);
  // Printed, it is given only the nodes the closures it looks inside
  // reach (C167d), and says the same.
  const shown = printed(core), n = Object.keys(shown.code!.nodes).length;
  assert.ok(n > 0 && n < Object.keys(core.code.nodes).length / 2, `${n} nodes`);
  const g = loadPrinted(shown, { print: () => {} }, shown.code)[core.funcs.findIndex((h) => h.def === at2 && !h.inner)];
  for (const x of [0, 1, 2, -1.5]) assert.equal(g(x), ev(x), `printed, at ${x}`);
});

// A first derivative of a function chosen at run time (I245): the
// function carries it, made ahead, so the printed program has no
// evaluator and no nodes, and newton's slope, handed on to newton again,
// is still only applied.
test("a function chosen at run time carries its derivative (I245)", () => {
  const k = new Lang();
  const cube = k.def("cube"), wave = k.def("wave"), pick = k.def("pick"), newton = k.def("newton"), root = k.def("root"), at = k.def("at");
  k.define(cube, k.fn(["x"], (x) => k.call(B.sub, k.call(B.mul, x, k.call(B.mul, x, x)), k.lit(2))));
  k.define(wave, k.fn(["x"], (x) => k.call(B.sub, k.call(B.mul, x, x), k.lit(3))));
  k.define(pick, k.fn(["n"], (n) => k.if(k.call(S.less, n, k.lit(1)), cube, wave)));
  k.define(newton, k.fn(["f", "slope", "x", "n"], (f, slope, x, n) => k.if(k.call(S.less, n, k.lit(1)), x,
    k.call(newton, f, slope, k.call(B.sub, x, k.call(B.div, k.call(f, x), k.call(slope, x))), k.call(B.sub, n, k.lit(1))))));
  k.define(root, k.fn(["n"], (n) => k.let("f", k.call(pick, n), (f) => k.call(newton, f, k.call(S.derivative, f), k.lit(1), k.lit(30)))));
  k.define(at, k.fn(["n", "x"], (n, x) => k.call(B.add, k.call(root, n), k.call(k.call(S.derivative, k.call(pick, n)), x))));
  const code = base(k.code), names = baseNames(k.names), info = infer(code, names);
  assert.deepEqual(info.errors.map((e) => e.message), []);
  const r = makeRunner(code, info, { print: () => {}, names });
  const ev = (n: number, x: number) => { for (const v of r.call(r.value(at), n, x)) return v; };
  const core = lowerCore(code, info, names, [at]);
  assert.deepEqual([...core.refused.entries()], []);
  const js = emitCoreJs(core).js;
  assert.doesNotMatch(js, /R\.rt\("derive:/);
  assert.doesNotMatch(js, /"lambda":/);
  const f = loadCoreJs(core)[core.funcs.findIndex((g) => g.def === at && !g.inner)];
  for (const [n, x] of [[0, 2], [1, 2], [0, -1.5], [1, 0.5]]) assert.equal(f(n, x), ev(n, x), `at ${n}, ${x}`);
});

test("a lambda that captures, chosen at run time, carries its derivative over its captures (I245)", () => {
  const k = new Lang();
  const scaled = k.def("scaled"), at = k.def("at");
  k.define(scaled, k.fn(["a"], (a) => k.fn(["y"], (y) => k.call(B.mul, a, k.call(B.mul, y, k.call(B.sin, y))))));
  k.define(at, k.fn(["a", "x"], (a, x) => k.call(k.call(S.derivative, k.call(scaled, a)), x)));
  const code = base(k.code), names = baseNames(k.names), info = infer(code, names);
  assert.deepEqual(info.errors.map((e) => e.message), []);
  const r = makeRunner(code, info, { print: () => {}, names });
  const core = lowerCore(code, info, names, [at]);
  const js = emitCoreJs(core).js;
  assert.doesNotMatch(js, /R\.rt\("derive:/);
  assert.doesNotMatch(js, /"lambda":/);
  const f = loadCoreJs(core)[core.funcs.findIndex((g) => g.def === at && !g.inner)];
  for (const [a, x] of [[2, 3], [-1, 0.5], [0.25, -2]]) { let want; for (const v of r.call(r.value(at), a, x)) { want = v; break; } assert.equal(f(a, x), want, `at ${a}, ${x}`); }
});

// A lambda whose derivative asks for another's (of the function it
// captured) would need that carried at its order too: the evaluator's
// derivative stays, with the closures saying what they are.
test("a derivative that asks for another: the evaluator's derivative still (I245)", () => {
  const k = new Lang();
  const cube = k.def("cube"), twice = k.def("twice"), at = k.def("at");
  k.define(cube, k.fn(["x"], (x) => k.call(B.mul, x, k.call(B.mul, x, x))));
  k.define(twice, k.fn(["h"], (h) => k.fn(["y"], (y) => k.call(B.mul, k.lit(2), k.call(h, y)))));
  k.define(at, k.fn(["x"], (x) => k.call(k.call(S.derivative, k.call(twice, cube)), x)));
  const code = base(k.code), names = baseNames(k.names), info = infer(code, names);
  assert.deepEqual(info.errors.map((e) => e.message), []);
  const r = makeRunner(code, info, { print: () => {}, names });
  const core = lowerCore(code, info, names, [at]);
  assert.deepEqual([...core.refused.entries()], []);
  assert.match(emitCoreJs(core).js, /R\.rt\("derive:/);
  const f = loadCoreJs(core)[core.funcs.findIndex((g) => g.def === at && !g.inner)];
  for (const x of [2, 0.5, -1]) { let want; for (const v of r.call(r.value(at), x)) { want = v; break; } assert.equal(f(x), want, `at ${x}`); }
});
