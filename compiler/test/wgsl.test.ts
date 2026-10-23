// The scalar profile printed as WGSL: what it looks like and what it
// refuses. Whether it gives the evaluator's numbers needs a GPU, so that's
// checked by gpu.ts in a browser (npm run gpu, run in CI).

import { test } from "node:test";
import assert from "node:assert/strict";
import { lowerScalar } from "../src/scalar.ts";
import { emitWgsl } from "../src/wgsl.ts";
import { examples, load } from "../src/program.ts";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { DIVERGE } from "../../projectional/src/lang/types.ts";
import { makeRunner } from "../../projectional/src/lang/run.ts";
import { area, corners, vectors, within } from "../src/fixtures.ts";
import { Lang } from "../../projectional/src/lang/dsl.ts";
import { base, baseNames } from "../../projectional/src/lang/load.ts";
import { infer } from "../../projectional/src/lang/infer.ts";
import { B } from "../../projectional/src/prelude.ts";
import { S } from "../../projectional/src/lang/std.ts";
import { expandDerivatives } from "../../projectional/src/lang/derive.ts";
import type { Id } from "../../projectional/src/model.ts";

test("calculus: the same definitions the WASM printer takes, as f32 functions", () => {
  const p = load("calculus");
  const lowered = lowerScalar(p.code, p.info, p.pres.names, p.own.defs);
  const s = emitWgsl(lowered);
  assert.deepEqual(s.funcs.map((f) => f.name), lowered.funcs.map((f) => f.name));
  assert.match(s.wgsl, /fn cubic_0\(p0: f32\) -> f32 \{\n {2}return \(\(\(p0 \* p0\) \* p0\) - p0\) - 1\.0;\n\}/);
  assert.match(s.wgsl, /fn kink_\d+\(p0: f32\) -> f32 \{\n {2}if \(p0 < 0\.0\) \{\n {4}return -p0;/);
  // Names are WGSL identifiers: cubic′ is cubic_5.
  for (const f of s.funcs) assert.match(f.wgsl, /^[A-Za-z][A-Za-z0-9_]*$/);
  assert.match(why(s.refused, p.named("sinc")), /Choice/);
});

test("examples/shaders: red, green and blue, and everything they call, go to the GPU", () => {
  const p = load("shaders");
  const s = emitWgsl(lowerScalar(p.code, p.info, p.pres.names, p.own.defs));
  assert.deepEqual([...s.refused.keys()], []);
  for (const c of ["red", "green", "blue"]) assert.deepEqual(s.funcs.find((f) => f.name === c)?.params, ["f64", "f64", "f64"]);
});

test("examples/raymarch: the ray marcher goes to the GPU whole, normals and all", () => {
  const p = load("raymarch");
  // The source has no derivative code: shade asks derivative((x) ↦ scene(x, y, z, time)) and so on.
  assert.ok(!Object.values(p.pres.names).some((n) => n.includes("∂")), "no ∂ definitions in the source");
  const lowered = lowerScalar(p.code, p.info, p.pres.names, [p.named("colour")], { records: true });
  const s = emitWgsl(lowered);
  assert.deepEqual([...s.refused.keys()], []);
  const names = lowered.funcs.map((f) => f.name);
  // The normals are partial derivatives generated from scene for the shader, not finite differences.
  for (const d of ["∂scene/∂x", "∂scene/∂y", "∂scene/∂z", "∂ring/∂x", "march", "shadow", "shade", "trace"]) assert.ok(names.includes(d), d);
  // Only colour is a place to start: the rest may not finish, so they run
  // under its budget.
  assert.deepEqual(s.funcs.map((f) => f.name).filter((n) => ["colour", "trace", "march", "shadow", "shade"].includes(n)), ["colour"]);
  assert.match(s.wgsl, /lab_fuel = 1000\.0;/);
  // march and shadow call themselves last: loops, each round spending one.
  for (const name of ["march", "shadow"]) {
    const body = s.wgsl.slice(s.wgsl.indexOf(`// ${name}\nfn `));
    assert.match(body.slice(0, body.indexOf("\n}\n")), /loop \{\n {4}lab_fuel = lab_fuel - 1\.0;[\s\S]*continue;/);
  }
  // Colours and points are vectors, and arithmetic written field by field
  // is vector arithmetic.
  assert.match(s.wgsl, /\/\/ Colour is a vec3f: red is \.x, green is \.y, blue is \.z\./);
  assert.match(s.wgsl, /fn mix_\d+\(p0: vec3f, p1: vec3f, p2: f32\) -> vec3f \{\n {2}return mix\(p0, p1, p2\);/);
  assert.match(s.wgsl, /fn dot_\d+\(p0: vec3f, p1: vec3f\) -> f32 \{\n {2}return dot\(p0, p1\);/);
  assert.match(s.wgsl, /return vec3f\(0\.55, 0\.68, 0\.85\) \+ \(vec3f\(0\.2, 0\.2, 0\.1\) \* p0\);/);
  assert.match(s.wgsl, /return clamp\(l\d+ \* l\d+, vec3f\(0\.0\), vec3f\(1\.0\)\);/);
  assert.match(s.wgsl, /fn smaller_\d+\(p0: f32, p1: f32\) -> f32 \{\n {2}return min\(p0, p1\);/);
  // And they are the gradient: close to central differences, away from the
  // blend's seams. Both the definitions the shader gets and the evaluator's
  // own derivative, taken at run time.
  const x = expandDerivatives(p.code, p.pres.names);
  const xi = infer(x.code, x.names);
  assert.deepEqual(xi.errors, []);
  const generated = (n: string) => x.code.defs.find((d) => x.names[d] === n)!;
  const r = makeRunner(x.code, xi, { print: () => {} });
  const at = (def: Id, ...xs: number[]) => { for (const v of r.call(r.value(def), ...xs)) return v as number; return NaN; };
  const scene = p.named("scene");
  // The evaluator, given the source, differentiates at run time with the
  // same deriver: it shades every point the same as the expanded program.
  const src = makeRunner(p.code, p.info, { print: () => {} });
  const shade = (run: typeof r, ...xs: number[]) => { for (const v of run.call(run.value(p.named("shade")), ...xs)) return JSON.stringify(v); return "none"; };
  for (const pt of [[0.3, -0.75, -0.2, 1], [0.6, 0.2, 0.3, 2]]) assert.equal(shade(src, ...pt), shade(r, ...pt));
  const h = 1e-5;
  for (const [px, py, pz, t] of [[0.3, 0.1, -0.2, 1], [1.2, 0.4, 0.5, 2], [-0.5, -0.3, 0.9, 0], [0.1, 1.5, -1, 3]]) {
    const pt = [px, py, pz];
    ["x", "y", "z"].forEach((axis, i) => {
      const plus = pt.map((v, j) => (j === i ? v + h : v)), minus = pt.map((v, j) => (j === i ? v - h : v));
      const numeric = (at(scene, ...plus, t) - at(scene, ...minus, t)) / (2 * h);
      assert.ok(Math.abs(at(generated(`∂scene/∂${axis}`), px, py, pz, t) - numeric) < 1e-5, `∂scene/∂${axis} at ${pt}`);
    });
  }
});

test("a call to itself as the last step is a loop; the GPU never sees recursion", () => {
  const a = area();
  const s = emitWgsl(lowerScalar(a.code, a.info, a.names, [a.integral]));
  const body = s.wgsl.slice(s.wgsl.indexOf("fn area_1"));
  const fn = body.slice(0, body.indexOf("\n}\n"));
  assert.match(fn, /var p0 = a0;[\s\S]*loop \{[\s\S]*continue;/);
  assert.equal(fn.split("area_1(").length, 2, "area_1 is named once, in its signature");
  // Every new value is computed before any parameter changes.
  assert.match(fn, /let t0 = p0 \+ p1;\n\s*let t1 = p2 - 1\.0;\n\s*let t2 = p3 \+ \(f_2\(p0\) \* p1\);\n\s*p0 = t0;/);
  assert.equal(s.refused.size, 0);
});

test("Diverge is refused outside a budget; under one, each round of the loop spends from it", () => {
  const a = area();
  const s = emitWgsl(lowerScalar(a.code, a.info, a.names, [a.area, a.integral]));
  assert.match(why(s.refused, a.area), /^may not finish \(its type has Diverge\): on a GPU that hangs the page, so run it under a budget/);
  // The loop is printed, for integral, but isn't a place to start.
  assert.deepEqual(s.funcs.map((f) => f.name), ["integral", "f"]);
  assert.match(s.wgsl, /var<private> lab_fuel: f32;/);
  const loop = s.wgsl.slice(s.wgsl.indexOf("fn area_1"));
  assert.match(loop, /loop \{\n {4}lab_fuel = lab_fuel - 1\.0;\n {4}if \(lab_fuel < 0\.0\) \{ return f32\(\); \}/);
  // The budget: the old count kept, a new one set, and the fallback if it ran out.
  assert.match(s.wgsl, /let t0 = lab_fuel;\n {2}lab_fuel = 2000000\.0;\n {2}var t1: f32;\n {2}t1 = area_1\(p0, p1, p2, 0\.0\);\n {2}if \(lab_fuel < 0\.0\) \{\n {4}t1 = -1\.0;\n {2}\}\n {2}lab_fuel = t0;\n {2}return t1;/);
});

test("a budget is first(() => with fuel(n, …), …) with n written down; nothing else made of them", () => {
  const k = new Lang();
  const spin = k.def("spin");
  k.define(spin, k.fn(["x"], (x) => k.if(k.call(S.less, x, k.lit(0)), x, k.call(spin, k.call(B.add, x, k.lit(1))))));
  const computed = k.def("computed budget");
  k.define(computed, k.fn(["x"], (x) => k.call(S.first, k.thunk(() => k.call(S.fuel, x, k.thunk(() => k.call(spin, x)))), k.thunk(() => x))));
  const huge = k.def("huge budget");
  k.define(huge, k.fn(["x"], (x) => within(k, 1e9, () => k.call(spin, x), () => x)));
  const bare = k.def("first alone");
  k.define(bare, k.fn(["x"], (x) => k.call(S.first, k.thunk(() => k.call(spin, x)), k.thunk(() => x))));
  const ok = k.def("fine");
  k.define(ok, k.fn(["x"], (x) => within(k, 0, () => k.call(spin, x), () => x)));
  const code = base(k.code), names = { ...baseNames(), ...k.names };
  const s = emitWgsl(lowerScalar(code, infer(code, names), names, [computed, huge, bare, ok]));
  assert.match(why(s.refused, computed), /a budget that isn't a number written down/);
  assert.match(why(s.refused, huge), /a budget of 1000000000/);
  // first alone doesn't handle Diverge, so spin's reaches the caller.
  assert.match(why(s.refused, bare), /^may not finish/);
  assert.deepEqual(s.funcs.map((f) => f.name), ["fine"]);
});

test("recursion that isn't a loop is refused with the reason, and so is what calls it", () => {
  const c = corners();
  const s = emitWgsl(lowerScalar(c.code, c.info, c.names, Object.values(c.defs)));
  const { fact, even, odd, twice, gcd, gcdOf, factOf, isEven } = c.defs;
  assert.match(why(s.refused, fact), /recursive in a way that isn't a loop/);
  assert.match(why(s.refused, even), /recursive/);
  assert.match(why(s.refused, odd), /recursive/);
  assert.match(why(s.refused, factOf), /^calls fact, which is recursive/);
  assert.match(why(s.refused, isEven), /^calls even, which is recursive/);
  // Outside a budget, the first reason is that it may not finish.
  assert.match(why(s.refused, twice), /^may not finish/);
  assert.match(why(s.refused, gcd), /^may not finish/);
  assert.ok(!s.refused.has(gcdOf));
  assert.ok(!/fact|even|odd/.test(s.wgsl), "nothing refused is printed");
});

test("an if inside an expression is a var set by an if statement; pow of a negative base is JavaScript's", () => {
  const c = corners();
  const s = emitWgsl(lowerScalar(c.code, c.info, c.names, Object.values(c.defs)));
  assert.match(s.wgsl, /var t0: f32;\n {2}if \(p0 < 0\.0\) \{\n {4}t0 = 0\.0;\n {2}\} else \{\n {4}let l1 = p0 \* p0;\n {4}t0 = l1 - p0;\n {2}\}\n {2}return 1\.0 \+ t0;/);
  assert.match(s.wgsl, /fn pick_\d+\(p0: bool, p1: f32\) -> f32/);
  // equal on Numbers is the evaluator's: whole numbers exactly, others within 1e-9.
  assert.match(s.wgsl, /-> bool \{\n {2}return \(\(p0 == p1\) \|\| \(\(!\(\(floor\(p0\) == p0\) && \(floor\(p1\) == p1\)\)\) && \(\(abs\(p0 - p1\) < \(1e-9 \* \(\(1\.0 \+ abs\(p0\)\) \+ abs\(p1\)\)\)\) \|\| \(abs\(p0 - p1\) == \(1e-9 \* \(\(1\.0 \+ abs\(p0\)\) \+ abs\(p1\)\)\)\)\)\)\) \|\| \(abs\(p0 - p1\) < 0\.5\);/);
  // x³ of a variable is a product; of anything else, lab_pow.
  assert.match(s.wgsl, /return \(p0 \* p0 \* p0\) \+ lab_pow\(p0 - 2\.0, 3\.0\);/);
  assert.match(s.wgsl, /fn lab_pow/);
});

test("records are structs (or vectors): built by their case, read by fields or a one-arm match, carried by loops", () => {
  const v = vectors();
  const roots = Object.values(v.defs);
  const s = emitWgsl(lowerScalar(v.code, v.info, v.names, roots, { records: true }));
  // Two to four Numbers are a vector; anything else is a struct.
  assert.match(s.wgsl, /\/\/ Vec is a vec3f: x is \.x, y is \.y, z is \.z\./);
  assert.match(s.wgsl, /struct Ray_1 \{\n {2}origin: vec3f,\n {2}direction: vec3f,\n\}/);
  // The standard library's Pair, at Number and Number.
  assert.match(s.wgsl, /\/\/ Pair is a vec2f: fst is \.x, snd is \.y\./);
  // origin + t · direction, written field by field, is one vector expression.
  assert.match(s.wgsl, /let l3 = l2\.origin;\n {2}let l4 = l2\.direction;\n {2}return l3 \+ \(p1 \* l4\);/);
  assert.match(s.wgsl, /fn length_\d+\(p0: vec3f\) -> f32 \{\n {2}return length\(p0\);/);
  assert.match(s.wgsl, /fn unit_\d+\(p0: vec3f\) -> vec3f \{\n {2}return normalize\(p0\);/);
  assert.match(s.wgsl, /fn diagonal_\d+\(p0: f32\) -> vec3f \{\n {2}return vec3f\(p0\);/);
  // Parts that don't do the same thing stay parts.
  assert.match(s.wgsl, /fn walk_(\d+)\(a0: vec3f, a1: f32, a2: f32\) -> vec2f \{\n {2}var p0 = a0;[\s\S]*let t0 = vec3f\(p0\.x \+ p1, p0\.y, p0\.z \+ \(0\.5 \* p1\)\);/);
  // Under a budget whose fallback is a record too.
  assert.match(s.wgsl, /t\d+ = walk_\d+\(vec3f\(p0, 1\.0, 0\.0\), p1, 0\.0\);\n {2}if \(lab_fuel < 0\.0\) \{\n {4}t\d+ = vec2f\(0\.0, -1\.0\);\n {2}\}\n {2}lab_fuel = t\d+;\n {2}return t\d+\.y;/);
  assert.match(why(s.refused, v.defs.sum), /List, which has 2 cases/);
  assert.match(why(s.refused, v.defs.orZero), /Optional, which has 2 cases/);
  // An input that's never used is a Number, and only a Number may be passed.
  assert.match(s.wgsl, /fn twice_ignoring_\d+\(p0: f32, p1: f32\) -> f32/);
  assert.ok(!s.refused.has(v.defs.numbers));
  assert.match(why(s.refused, v.defs.vecs), /^passes twice ignoring something other than/);
  // Without records (what WebAssembly takes), they're refused as before.
  const plain = lowerScalar(v.code, v.info, v.names, roots);
  assert.match(why(plain.refused, v.defs.length), /other than Number or Bool/);
});

test("every example: what a shader can start from has no Diverge, and every loop under a budget spends from it", () => {
  // compose has externs (no bodies), so it isn't a whole program to check.
  for (const name of readdirSync(examples).filter((n) => existsSync(join(examples, n, "code.json")) && n !== "compose")) {
    const p = load(name);
    const lowered = lowerScalar(p.code, p.info, p.pres.names, p.own.defs, { records: true });
    const s = emitWgsl(lowered);
    // The lowered program: generated derivatives are in it.
    const info = lowered.info;
    for (const f of s.funcs) {
      const t = info.subst.zonk(info.typeOf.get(f.def)!);
      assert.ok(t.t === "fn" && !info.subst.resolveRow(t.eff).effs.includes(DIVERGE), `${name}: ${f.name} starts a shader and may not finish`);
    }
    for (const f of lowered.funcs) {
      // Something the checker couldn't see end may only be called under a budget,
      // and its WGSL takes one from it before anything else.
      if (info.divergent.has(f.def)) assert.ok(f.spends && f.budgeted, `${name}: ${f.name}`);
      if (!f.spends) continue;
      const at = s.wgsl.indexOf(`// ${f.name}\nfn `);
      if (at < 0) continue; // refused by the printer, with its reason
      const body = s.wgsl.slice(at, s.wgsl.indexOf("\n}\n", at));
      assert.match(body, /\{\n(?: {2}var p\d+ = a\d+;\n)*(?: {2}loop \{\n)? +lab_fuel = lab_fuel - 1\.0;/, `${name}: ${f.name} spends first`);
    }
  }
});

function why(refused: Map<string, string>, def: string): string {
  assert.ok(refused.has(def), `${def} is refused`);
  return refused.get(def)!;
}
