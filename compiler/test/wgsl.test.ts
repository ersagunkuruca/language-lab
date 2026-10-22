// The scalar profile printed as WGSL: what it looks like and what it
// refuses. Whether it gives the evaluator's numbers needs a GPU, so that's
// checked by gpu.ts in a browser (npm run gpu, run in CI).

import { test } from "node:test";
import assert from "node:assert/strict";
import { lowerScalar } from "../src/scalar.ts";
import { emitWgsl } from "../src/wgsl.ts";
import { load } from "../src/program.ts";
import { makeRunner } from "../../projectional/src/lang/run.ts";
import { area, corners, vectors } from "../src/fixtures.ts";

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
  const s = emitWgsl(lowerScalar(p.code, p.info, p.pres.names, [p.named("colour")], { records: true }));
  assert.deepEqual([...s.refused.keys()], []);
  const names = s.funcs.map((f) => f.name);
  // The normals are the generated partial derivatives, not finite differences.
  for (const d of ["∂scene/∂x", "∂scene/∂y", "∂scene/∂z", "march", "shadow", "shade"]) assert.ok(names.includes(d), d);
  // march and shadow call themselves last: loops.
  for (const f of s.funcs.filter((f) => f.name === "march" || f.name === "shadow")) {
    const body = s.wgsl.slice(s.wgsl.indexOf(`fn ${f.wgsl}(`));
    assert.match(body.slice(0, body.indexOf("\n}\n")), /loop \{[\s\S]*continue;/);
  }
  assert.match(s.wgsl, /struct Colour_\d+ \{\n {2}red: f32,\n {2}green: f32,\n {2}blue: f32,\n\}/);
  // And they are the gradient: close to central differences, away from the
  // blend's seams.
  const r = makeRunner(p.code, p.info, { print: () => {} });
  const at = (name: string, ...xs: number[]) => { for (const v of r.call(r.value(p.named(name)), ...xs)) return v as number; return NaN; };
  const h = 1e-5;
  for (const [x, y, z, t] of [[0.3, 0.1, -0.2, 1], [1.2, 0.4, 0.5, 2], [-0.5, -0.3, 0.9, 0], [0.1, 1.5, -1, 3]]) {
    const pt = [x, y, z];
    ["x", "y", "z"].forEach((axis, i) => {
      const plus = pt.map((v, j) => (j === i ? v + h : v)), minus = pt.map((v, j) => (j === i ? v - h : v));
      const numeric = (at("scene", ...plus, t) - at("scene", ...minus, t)) / (2 * h);
      assert.ok(Math.abs(at(`∂scene/∂${axis}`, x, y, z, t) - numeric) < 1e-5, `∂scene/∂${axis} at ${pt}`);
    });
  }
});

test("a call to itself as the last step is a loop; the GPU never sees recursion", () => {
  const a = area();
  const s = emitWgsl(lowerScalar(a.code, a.info, a.names, [a.area]));
  const body = s.wgsl.slice(s.wgsl.indexOf("fn area_0"));
  const fn = body.slice(0, body.indexOf("\n}\n"));
  assert.match(fn, /var p0 = a0;[\s\S]*loop \{[\s\S]*continue;/);
  assert.equal(fn.split("area_0(").length, 2, "area_0 is named once, in its signature");
  // Every new value is computed before any parameter changes.
  assert.match(fn, /let t0 = p0 \+ p1;\n\s*let t1 = p2 - 1\.0;\n\s*let t2 = p3 \+ \(f_1\(p0\) \* p1\);\n\s*p0 = t0;/);
  assert.equal(s.refused.size, 0);
});

test("recursion that isn't a loop is refused with the reason, and so is what calls it", () => {
  const c = corners();
  const s = emitWgsl(lowerScalar(c.code, c.info, c.names, Object.values(c.defs)));
  const { fact, even, odd, twice, gcd } = c.defs;
  assert.match(why(s.refused, fact), /recursive in a way that isn't a loop/);
  assert.match(why(s.refused, even), /recursive/);
  assert.match(why(s.refused, odd), /recursive/);
  assert.match(why(s.refused, twice), /^calls fact, which is recursive/);
  assert.ok(!s.refused.has(gcd));
  assert.ok(!/fact|even|odd/.test(s.wgsl), "nothing refused is printed");
});

test("an if inside an expression is a var set by an if statement; pow of a negative base is JavaScript's", () => {
  const c = corners();
  const s = emitWgsl(lowerScalar(c.code, c.info, c.names, Object.values(c.defs)));
  assert.match(s.wgsl, /var t0: f32;\n {2}if \(p0 < 0\.0\) \{\n {4}t0 = 0\.0;\n {2}\} else \{\n {4}let l1 = p0 \* p0;\n {4}t0 = l1 - p0;\n {2}\}\n {2}return 1\.0 \+ t0;/);
  assert.match(s.wgsl, /fn pick_\d+\(p0: bool, p1: f32\) -> f32/);
  assert.match(s.wgsl, /-> bool \{\n {2}return \(p0 == p1\) \|\| \(abs\(p0 - p1\) < 0\.5\);/);
  // x³ of a variable is a product; of anything else, lab_pow.
  assert.match(s.wgsl, /return \(p0 \* p0 \* p0\) \+ lab_pow\(p0 - 2\.0, 3\.0\);/);
  assert.match(s.wgsl, /fn lab_pow/);
});

test("records are structs: built by their case, read by fields or a one-arm match, carried by loops", () => {
  const v = vectors();
  const roots = Object.values(v.defs);
  const s = emitWgsl(lowerScalar(v.code, v.info, v.names, roots, { records: true }));
  assert.match(s.wgsl, /struct Vec_0 \{\n {2}x: f32,\n {2}y: f32,\n {2}z: f32,\n\}/);
  assert.match(s.wgsl, /struct Ray_1 \{\n {2}origin: Vec_0,\n {2}direction: Vec_0,\n\}/);
  // The standard library's Pair, at Number and Number.
  assert.match(s.wgsl, /struct Pair_2 \{\n {2}fst: f32,\n {2}snd: f32,\n\}/);
  assert.match(s.wgsl, /let l3 = l2\.origin;\n {2}let l4 = l2\.direction;\n {2}return Vec_0\(l3\.x \+ \(p1 \* l4\.x\)/);
  assert.match(s.wgsl, /fn walk_3\(a0: Vec_0, a1: f32, a2: f32\) -> Pair_2 \{\n {2}var p0 = a0;[\s\S]*let t0 = Vec_0\(p0\.x \+ p1, p0\.y, p0\.z \+ \(0\.5 \* p1\)\);/);
  assert.match(s.wgsl, /return walk_3\(Vec_0\(p0, 1\.0, 0\.0\), p1, 0\.0\)\.snd;/);
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

function why(refused: Map<string, string>, def: string): string {
  assert.ok(refused.has(def), `${def} is refused`);
  return refused.get(def)!;
}
