// Linear maps read from functions (MATRICES.md layer 1, BACKLOG L44c):
// linearMap reads a function's matrix and offset from its graph, or says
// it isn't affine. Each matrix is checked against the evaluator running
// the function itself on sample points.

import { test } from "node:test";
import assert from "node:assert/strict";
import { Lang } from "../src/lang/dsl.ts";
import { infer } from "../src/lang/infer.ts";
import { makeRunner, type Value } from "../src/lang/run.ts";
import { base, baseNames, checkOptions } from "../src/lang/load.ts";
import { LIBRARY } from "../src/lang/library.ts";
import { ARITH, S, SHOW_ANY } from "../src/lang/std.ts";
import { B } from "../src/prelude.ts";
import { NUMBER } from "../src/lang/types.ts";
import type { Id } from "../src/model.ts";
import { applyLinear, composeLinear, linearMap } from "../src/lang/linear.ts";

test("linearMap: shears, turns, affine moves and helpers read as matrices; products, ifs and sines don't", () => {
  const k = new Lang(LIBRARY.code);
  const num = () => k.tref(NUMBER);
  const V = k.type("Vec3", [], [["vec3", ["x", "y", "z"].map((p) => [p, num] as [string, () => Id])]]);
  const vec = V.v.vec3;
  const [X, Y, Z] = ["x", "y", "z"].map((p) => V.f[`vec3.${p}`]);
  const def = (name: string, body: () => Id) => { const d = k.def(name); k.define(d, body()); return d; };
  const lit = (x: number) => k.lit(x);
  const add = (a: Id, b: Id) => k.call(ARITH.add, a, b), mul = (a: Id, b: Id) => k.call(ARITH.mul, a, b);
  const shear = def("shear", () => k.fn(["v"], (v) => k.call(vec, add(k.call(X, v), mul(lit(0.5), k.call(Y, v))), k.call(Y, v), k.call(Z, v))));
  // A turn about z by 30°, taking the vector apart and naming cos and sin.
  const turn = def("turn", () => k.fn(["v"], (v) => k.match(v, [{ variant: vec, names: ["x", "y", "z"], body: ([x, y, z]) =>
    k.let("c", k.call(B.cos, k.call(B.div, lit(Math.PI), lit(6))), (c) => k.let("s", k.call(B.sin, k.call(B.div, lit(Math.PI), lit(6))), (s) =>
      k.call(vec, k.call(ARITH.sub, mul(c, x), mul(s, y)), add(mul(s, x), mul(c, y)), z))) }])));
  const twice = def("twice", () => k.fn(["a"], (a) => add(a, a)));
  const moved = def("moved", () => k.fn(["v"], (v) => k.call(vec, add(k.call(twice, k.call(X, v)), lit(1)), k.call(ARITH.neg, k.call(Z, v)), k.call(B.div, k.call(Y, v), lit(4)))));
  const mix = def("mix", () => k.fn(["a", "b"], (a, b) => k.call(ARITH.sub, mul(lit(3), a), k.call(B.div, b, lit(2)))));
  const square = def("square parts", () => k.fn(["v"], (v) => k.call(vec, mul(k.call(X, v), k.call(Y, v)), k.call(Y, v), k.call(Z, v))));
  const clamp = def("clamp x", () => k.fn(["v"], (v) => k.call(vec, k.if(k.call(S.less, k.call(X, v), lit(0)), lit(0), k.call(X, v)), k.call(Y, v), k.call(Z, v))));
  const wave = def("wave", () => k.fn(["v"], (v) => k.call(vec, k.call(B.sin, k.call(X, v)), k.call(Y, v), k.call(Z, v))));
  const POINTS = [[1, 2, 3], [-0.5, 4, 0], [2.5, -1, 7]];
  const names: string[] = [];
  const at = (f: Id, p: number[]) => { const n = `${k.names[f]} at ${p}`; names.push(n); def(n, () => k.call(SHOW_ANY, k.call(f, k.call(vec, ...p.map(lit))))); return n; };
  const both = POINTS.map((p) => { const n = `turn after shear at ${p}`; names.push(n); def(n, () => k.call(SHOW_ANY, k.call(turn, k.call(shear, k.call(vec, ...p.map(lit)))))); return n; });
  const cases = [shear, turn, moved].map((f) => ({ f, at: POINTS.map((p) => at(f, p)) }));
  const mixAt = [[1, 2], [4, -6]].map(([a, b]) => { const n = `mix at ${a}, ${b}`; names.push(n); def(n, () => k.call(SHOW_ANY, k.call(mix, lit(a), lit(b)))); return n; });
  const code = base(k.code), info = infer(code, baseNames(k.names), undefined, checkOptions);
  const nm = baseNames(k.names);
  assert.deepEqual(info.errors.map((e) => e.message), []);
  const r = makeRunner(code, info, { print: () => {}, names: nm });
  const value = (n: string) => r.value(code.defs.find((d) => nm[d] === n)!);
  const parts = (v: Value) => { const s = String(v); return s.includes("(") ? s.slice(s.indexOf("(") + 1, -1).split(", ").map(Number) : [Number(s)]; };
  const near = (got: number[], want: number[], what: string) => want.forEach((w, i) => assert.ok(Math.abs(got[i] - w) < 1e-9, `${what}: ${got} ≠ ${want}`));

  const sh = linearMap(code, shear)!;
  assert.deepEqual(sh.params, [vec]);
  assert.deepEqual(sh.inputs, [X, Y, Z].map((field) => ({ param: 0, field })));
  assert.equal(sh.output, vec);
  assert.deepEqual(sh.matrix, [[1, 0.5, 0], [0, 1, 0], [0, 0, 1]]);
  assert.deepEqual(sh.offset, [0, 0, 0]);
  for (const { f, at: ns } of cases) {
    const m = linearMap(code, f);
    assert.ok(m, `${k.names[f]} reads as linear`);
    POINTS.forEach((p, i) => near(applyLinear(m, p), parts(value(ns[i])), ns[i]));
  }
  assert.deepEqual(linearMap(code, moved)!.offset, [1, 0, 0]);
  const both2 = composeLinear(linearMap(code, turn)!, sh)!;
  POINTS.forEach((p, i) => near(applyLinear(both2, p), parts(value(both[i])), both[i]));
  const mx = linearMap(code, mix)!;
  assert.deepEqual(mx.params, ["number", "number"]);
  assert.equal(mx.output, null);
  assert.deepEqual(mx.matrix, [[3, -0.5]]);
  [[1, 2], [4, -6]].forEach((p, i) => near(applyLinear(mx, p), parts(value(mixAt[i])), mixAt[i]));
  for (const f of [square, clamp, wave]) assert.equal(linearMap(code, f), null, `${k.names[f]} is not linear`);
});
