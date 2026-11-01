// The scalar profile printed as JavaScript: the CPU's way to draw a picture
// whose colour is a record. Float64s are f64 there too, so it must give the
// evaluator's numbers exactly.

import { test } from "node:test";
import assert from "node:assert/strict";
import { lowerScalar } from "../src/scalar.ts";
import { loadJs } from "../src/js-scalar.ts";
import { load } from "../src/program.ts";
import { makeRunner } from "../../ters/src/lang/run.ts";

const first = <T>(xs: Iterable<T>) => { for (const x of xs) return x; };

test("examples/raymarch: colour as JavaScript gives exactly the evaluator's colour", () => {
  const p = load("raymarch");
  const colour = p.named("colour");
  const lowered = lowerScalar(p.code, p.info, p.pres.names, [colour], { records: true });
  assert.deepEqual([...lowered.refused.keys()], []);
  const js = loadJs(lowered).get(colour)!;
  const r = makeRunner(p.code, p.info, { print: () => {} });
  for (const t of [0, 1.5, 4]) for (const x of [-0.9, -0.3, 0.2, 0.8]) for (const y of [-0.7, 0, 0.6]) {
    const want = (first(r.call(r.value(colour), x, y, t)) as { fields: number[] }).fields;
    assert.deepEqual(js(x, y, t), want, `at ${x}, ${y}, ${t}`);
  }
});

test("examples/shaders: red, green and blue as JavaScript", () => {
  const p = load("shaders");
  const lowered = lowerScalar(p.code, p.info, p.pres.names, p.own.defs);
  const js = loadJs(lowered);
  const r = makeRunner(p.code, p.info, { print: () => {} });
  for (const c of ["red", "green", "blue"]) {
    const f = js.get(p.named(c))!;
    for (const [x, y, t] of [[0.1, 0.2, 0], [-0.5, 0.7, 2.5]]) assert.equal(f(x, y, t), first(r.call(r.value(p.named(c)), x, y, t)), c);
  }
});

test("examples/raymarch in Float32: the JavaScript rounds as the GPU does, and agrees with the evaluator exactly", async () => {
  const { withFloat32 } = await import("../../ters/src/lang/float32.ts");
  const { represent } = await import("../../ters/src/lang/represent.ts");
  const { infer } = await import("../../ters/src/lang/infer.ts");
  const p = load("raymarch");
  const colour = p.named("colour");
  const w = withFloat32(p.code, p.pres.names);
  const code = represent(w.code, [colour], w.rep), info = infer(code, w.names);
  assert.deepEqual(info.errors, []);
  const lowered = lowerScalar(code, info, w.names, [colour], { records: true });
  assert.deepEqual([...lowered.refused.keys()], []);
  const js = loadJs(lowered).get(colour)!;
  const r = makeRunner(code, info, { print: () => {} });
  const plain = makeRunner(p.code, p.info, { print: () => {} });
  let differs = 0;
  for (const x of [-0.9, -0.3, 0.2, 0.8]) for (const y of [-0.7, 0, 0.6]) {
    const [fx, fy] = [Math.fround(x), Math.fround(y)];
    const want = (first(r.call(r.value(colour), fx, fy, 1.5)) as { fields: number[] }).fields;
    const got = js(fx, fy, 1.5) as number[];
    assert.deepEqual(got, want, `at ${x}, ${y}`);
    assert.ok(got.every((v) => v === Math.fround(v)), "every channel is an f32");
    if (got.some((v, i) => v !== (first(plain.call(plain.value(colour), fx, fy, 1.5)) as { fields: number[] }).fields[i])) differs++;
  }
  // and it isn't float64's picture
  assert.ok(differs > 0);
});

// C54: the editor's "Make it a function" names a function with a let,
// `part = (a, b) ↦ a · s + b; part(h, i) + part(i, h)`, using `s` from
// around it. There are no closures here, so it becomes a definition of
// its own given `s`; the GPU takes it too.
test("a function named by a let, using a name from around it, is a definition of its own", async () => {
  const { Lang } = await import("../../ters/src/lang/dsl.ts");
  const { base, baseNames } = await import("../../ters/src/lang/load.ts");
  const { infer } = await import("../../ters/src/lang/infer.ts");
  const { B } = await import("../../ters/src/prelude.ts");
  const { emitWgsl } = await import("../src/wgsl.ts");
  const k = new Lang();
  const hsi = k.def("hsi");
  k.define(hsi, k.fn(["h", "s", "i"], (h, s, i) => k.let("part", k.fn(["a", "b"], (a, b) => k.call(B.add, k.call(B.mul, a, s), b)), (part) =>
    k.call(B.add, k.call(part, h, i), k.call(part, i, h)))));
  const code = base(k.code), names = baseNames(k.names);
  const info = infer(code, names);
  const lowered = lowerScalar(code, info, names, [hsi]);
  assert.deepEqual([...lowered.refused.values()], []);
  assert.deepEqual(lowered.funcs.map((f) => f.name).sort(), ["hsi", "part"]);
  assert.deepEqual([...emitWgsl(lowered).refused.values()], []);
  const js = loadJs(lowered).get(hsi)!;
  const r = makeRunner(code, info, { print: () => {} });
  for (const [h, s, i] of [[0.1, 0.5, 0.9], [2, -3, 0.25]]) assert.equal(js(h, s, i), first(r.call(r.value(hsi), h, s, i)));
});
