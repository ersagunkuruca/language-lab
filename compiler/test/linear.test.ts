// Linear functions composed (MATRICES.md layer 1, C30b): a call of a
// linear definition on a call of another is one matrix product in the
// compiled JS, folded at compile time. The evaluator is the oracle; the
// folded constants round once instead of at each step, so the answers
// agree to the last few bits rather than exactly.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { makeRunner } from "../../projectional/src/lang/run.ts";
import type { Id } from "../../projectional/src/model.ts";
import { infer } from "../../projectional/src/lang/infer.ts";
import { Lang } from "../../projectional/src/lang/dsl.ts";
import { base, baseNames } from "../../projectional/src/lang/load.ts";
import { ARITH } from "../../projectional/src/lang/std.ts";
import { INT, NUMBER } from "../../projectional/src/lang/types.ts";
import { B } from "../../projectional/src/prelude.ts";
import { compile } from "../src/compile.ts";

const runtime = pathToFileURL(join(import.meta.dirname, "../src/runtime.js")).href;

test("linear functions composed: one product, the evaluator's answers; Ints and bottlenecks stay calls", async () => {
  const k = new Lang();
  const num = () => k.tref(NUMBER);
  const V = k.type("Vec3", [], [["vec3", ["x", "y", "z"].map((p) => [p, num] as [string, () => Id])]]);
  const vec = V.v.vec3;
  const [X, Y, Z] = ["x", "y", "z"].map((p) => V.f[`vec3.${p}`]);
  const def = (name: string, body: () => Id) => { const d = k.def(name); k.define(d, body()); return d; };
  const lit = (x: number) => k.lit(x);
  const add = (a: Id, b: Id) => k.call(ARITH.add, a, b), mul = (a: Id, b: Id) => k.call(ARITH.mul, a, b);
  const shear = def("shear", () => k.fn(["v"], (v) => k.call(vec, add(k.call(X, v), mul(lit(0.5), k.call(Y, v))), k.call(Y, v), k.call(Z, v))));
  const turn = def("turn", () => k.fn(["v"], (v) => k.match(v, [{ variant: vec, names: ["x", "y", "z"], body: ([x, y, z]) =>
    k.let("c", k.call(B.cos, k.call(B.div, lit(Math.PI), lit(6))), (c) => k.let("s", k.call(B.sin, k.call(B.div, lit(Math.PI), lit(6))), (s) =>
      k.call(vec, k.call(ARITH.sub, mul(c, x), mul(s, y)), add(mul(s, x), mul(c, y)), z))) }])));
  const lift = def("lift", () => k.fn(["v"], (v) => k.call(vec, k.call(X, v), k.call(Y, v), add(k.call(Z, v), lit(2)))));
  const dot = def("weigh", () => k.fn(["v"], (v) => add(add(k.call(X, v), mul(lit(2), k.call(Y, v))), mul(lit(3), k.call(Z, v)))));
  const spread = def("spread", () => k.fn(["a"], (a) => k.call(vec, a, mul(lit(-1), a), mul(lit(4), a))));
  const twice = def("twice", () => k.fn(["a"], (a) => add(a, a)));
  const thrice = def("thrice", () => k.fn(["a"], (a) => add(a, k.call(twice, a))));
  const P = [0.1, -2.5, 7];
  const at = () => k.call(vec, ...P.map(lit));
  def("two", () => k.thunk(() => k.call(turn, k.call(shear, at()))));
  def("three", () => k.thunk(() => k.call(lift, k.call(turn, k.call(shear, at())))));
  def("through a number", () => k.thunk(() => k.call(spread, k.call(dot, at()))));
  def("numbers", () => k.thunk(() => k.call(thrice, k.call(twice, k.lit(0.1, NUMBER)))));
  def("ints", () => k.thunk(() => k.call(thrice, k.call(twice, k.lit(3, INT)))));
  const exports = ["two", "three", "through a number", "numbers", "ints"];

  const code = base(k.code), names = { ...baseNames(), ...k.names };
  const info = infer(code, names);
  assert.deepEqual(info.errors, []);

  const source = compile(code, info, names, { runtime, exports });
  const file = join(mkdtempSync(join(tmpdir(), "linear-")), "linear.js");
  writeFileSync(file, source);
  const defs = (await import(pathToFileURL(file).href)).defs as Record<string, () => unknown>;
  const r = makeRunner(code, info, { print: () => {} });
  const want = (n: string) => [...r.call(r.value(code.defs.find((d) => names[d] === n)!))][0];
  const flat = (v: unknown) => (typeof v === "object" && v && "fields" in v ? (v as { fields: unknown[] }).fields : [v]);
  for (const n of exports) {
    const got = flat(defs[n]()), w = flat(want(n));
    assert.equal(got.length, w.length, n);
    got.forEach((g, i) => assert.ok(typeof g === "number" ? Math.abs(g - (w[i] as number)) <= 1e-12 * Math.max(1, Math.abs(w[i] as number)) : g === w[i], `${n}: ${got} vs ${w}`));
  }
  const fn = (n: string) => source.match(new RegExp(`^function ${n}\\(\\) \\{\\n([^\\n]*)`, "m"))![1];
  assert.doesNotMatch(fn("two"), /\b(shear|turn)\(/, "turn after shear is one product");
  assert.doesNotMatch(fn("three"), /\b(shear|turn|lift)\(/, "a chain of three folds all the way");
  assert.match(fn("numbers"), /^\s*return \(?6 \* 0\.1\)?;$/, "twice then thrice is six times");
  // Vec3 → Float64 → Vec3 is 3 + 3 multiplies; its product would be 9.
  assert.match(fn("through_a_number"), /spread\(weigh\(/);
  // A generic `a + a` on Ints keeps its Int arithmetic.
  assert.match(fn("ints"), /thrice_at_Int\(twice_at_Int\(3\)\)/);
});
