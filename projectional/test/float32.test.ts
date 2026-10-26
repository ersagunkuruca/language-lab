// Float32 (src/lang/float32.ts): Float64 with every job rounded to binary32,
// an approximate representation, so its laws hold to within the rounding.

import { test } from "node:test";
import assert from "node:assert/strict";
import type { Id } from "../src/model.ts";
import { Lang } from "../src/lang/dsl.ts";
import { infer } from "../src/lang/infer.ts";
import { base, baseNames } from "../src/lang/load.ts";
import { choose, represent, type Representation } from "../src/lang/represent.ts";
import { makeRunner, type Value } from "../src/lang/run.ts";
import { withFloat32, ROUNDED } from "../src/lang/float32.ts";
import { S, STD_IMPL } from "../src/lang/std.ts";
import { B } from "../src/prelude.ts";
import { NUMBER } from "../src/lang/types.ts";

const fr = Math.fround;
const first = (xs: Iterable<Value>) => { for (const x of xs) return x as number; throw new Error("no answer"); };

test("every Float32 job is its Float64 builtin rounded: equal to within half a step of binary32", () => {
  const k = new Lang();
  const code = base(k.code), names = baseNames(k.names);
  const f = withFloat32(code, names);
  const info = infer(f.code, f.names);
  assert.deepEqual(info.errors, []);
  const r = makeRunner(f.code, info, { print: () => {} });
  const plain = makeRunner(code, infer(code, names), { print: () => {} });
  const inputs = [0.1, 0.7, 1.5, 2, 3.25, 10.1].map(fr);
  for (const [op, n] of ROUNDED) {
    for (const a of inputs) for (const b of inputs) {
      const xs = [a, b].slice(0, n);
      const want = first(plain.call(plain.value(op), ...xs));
      const got = first(r.call(r.value(f.rep.impl[op]), ...xs));
      assert.equal(got, fr(got), `${op}(${xs}) isn't an f32`);
      // Round to nearest: within half a step, 2⁻²⁴ of the answer.
      assert.ok(Math.abs(got - want) <= Math.abs(want) * 2 ** -24 + 1e-45, `${op}(${xs}): ${got} vs ${want}`);
    }
  }
  assert.equal(STD_IMPL[S.float32], Math.fround);
});

test("a program on Float64 runs in Float32 when asked, and the chooser never asks on its own", () => {
  const k = new Lang();
  // A tenth of x, plus a third, plus sin x: none of them exact in binary.
  const f = k.def("f");
  k.define(f, k.fn(["x"], (x) => k.call(B.add, k.call(B.add, k.call(B.mul, x, k.lit(0.1)), k.call(B.div, k.lit(1), k.lit(3))), k.call(B.sin, x))));
  const code = base(k.code), names = baseNames(k.names);
  const w = withFloat32(code, names);
  const spec: Representation = { name: "Float64", of: NUMBER, type: NUMBER, meaning: null, canonical: true, impl: {}, cost: {} };
  assert.equal(choose(w.code, f, [w.rep, spec]).rep.name, "Float64");
  const out = represent(w.code, [f], w.rep);
  const info = infer(out, w.names);
  assert.deepEqual(info.errors, []);
  const r = makeRunner(out, info, { print: () => {} });
  const plain = makeRunner(code, infer(code, names), { print: () => {} });
  for (const x of [0.7, 3, 12.345].map(fr)) {
    const want = fr(fr(fr(x * fr(0.1)) + fr(1 / 3)) + fr(Math.sin(x)));
    assert.equal(first(r.call(r.value(f), x)), want);
    assert.notEqual(first(plain.call(plain.value(f), x)), want);
  }
});

test("Float32 rewrites Float64 functions passed as values too (vectors' zip parts of add)", () => {
  const k = new Lang();
  const twice = k.def("twice");
  k.define(twice, k.fn(["x"], (x) => k.call(k.fn(["g"], (g) => k.call(g, x, k.lit(0.1))), k.x(B.add as Id))));
  const code = base(k.code), names = baseNames(k.names);
  const w = withFloat32(code, names);
  const out = represent(w.code, [twice], w.rep);
  const r = makeRunner(out, infer(out, w.names), { print: () => {} });
  assert.equal(first(r.call(r.value(twice), fr(0.2))), fr(fr(0.2) + fr(0.1)));
});
