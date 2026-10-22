// The scalar profile printed as WGSL: what it looks like and what it
// refuses. Whether it gives the evaluator's numbers needs a GPU, so that's
// checked by gpu.ts in a browser (npm run gpu, run in CI).

import { test } from "node:test";
import assert from "node:assert/strict";
import { lowerScalar } from "../src/scalar.ts";
import { emitWgsl } from "../src/wgsl.ts";
import { load } from "../src/program.ts";
import { area, corners } from "../src/fixtures.ts";

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

function why(refused: Map<string, string>, def: string): string {
  assert.ok(refused.has(def), `${def} is refused`);
  return refused.get(def)!;
}
