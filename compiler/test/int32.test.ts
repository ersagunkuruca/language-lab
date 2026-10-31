// Int in shaders (C66c): held in 32 bits, as WGSL's i32, with JavaScript
// the CPU's way to run the same functions. Within 32 bits the answers are
// the evaluator's; past them a shader gives up as a budget running out
// does, so a budget around it gives its fallback.

import { test } from "node:test";
import assert from "node:assert/strict";
import { Lang } from "../../projectional/src/lang/dsl.ts";
import { infer } from "../../projectional/src/lang/infer.ts";
import { makeRunner } from "../../projectional/src/lang/run.ts";
import { base, baseNames } from "../../projectional/src/lang/load.ts";
import { INT_OPS } from "../../projectional/src/lang/std.ts";
import { lowerScalar } from "../src/scalar.ts";
import { emitWgsl } from "../src/wgsl.ts";
import { loadJs } from "../src/js-scalar.ts";
import { ints } from "../src/fixtures.ts";


const first = <T>(xs: Iterable<T>) => { for (const x of xs) return x; };

test("Int in a shader is an i32, with + − × negate and abs checked for overflow", () => {
  const p = ints();
  const roots = [p.poly, p.smaller, p.same, p.sumTo, p.cube, p.lowest];
  const lowered = lowerScalar(p.code, p.info, p.names, roots, { records: true, int32: true });
  assert.deepEqual([...lowered.refused.values()], []);
  const s = emitWgsl(lowered);
  assert.deepEqual([...s.refused.values()], []);
  assert.deepEqual(s.funcs.find((f) => f.name === "poly")?.params, ["int32", "int32"]);
  assert.match(s.wgsl, /fn poly_\d+\(p0: i32, p1: i32\) -> i32 \{\n {2}return lab_iadd\(lab_isub\(lab_imul\(p0, p1\), p0\), lab_ineg\(lab_iabs\(p1\)\)\);/);
  assert.match(s.wgsl, /fn lab_imul\(a: i32, b: i32\) -> i32/);
  assert.match(s.wgsl, /var<private> lab_fuel: f32;/);
  assert.match(s.wgsl, /return -2147483647i - 1i;/);
  assert.match(s.wgsl, /f32\(p0\)/);
  // Without int32 (WebAssembly and C have Int with `data`), it's refused as before.
  assert.match(lowerScalar(p.code, p.info, p.names, [p.poly]).refused.get(p.poly) ?? "", /Float64/);
});

test("Int in 32 bits on the CPU: the evaluator's answers, and past 32 bits the budget's fallback", () => {
  const p = ints();
  const lowered = lowerScalar(p.code, p.info, p.names, [p.poly, p.smaller, p.same, p.sumTo, p.cube, p.lowest], { records: true, int32: true });
  const js = loadJs(lowered);
  const r = makeRunner(p.code, p.info, { print: () => {} });
  const ev = (d: string, ...xs: unknown[]) => first(r.call(r.value(d), ...(xs as never[])));
  const num = (v: unknown) => (typeof v === "bigint" ? Number(v) : v);
  for (const [a, b] of [[3, 4], [-7, 2], [0, -5], [46340, 46340], [-2147483647, 1]]) {
    assert.equal(js.get(p.poly)!(a, b), num(ev(p.poly, a, b)), `poly ${a} ${b}`);
    assert.equal(js.get(p.smaller)!(a, b), ev(p.smaller, a, b), `smaller ${a} ${b}`);
    assert.equal(js.get(p.same)!(a, b), (ev(p.same, a, b) as { tag: string }).tag === "std.bool.true", `same ${a} ${b}`);
  }
  for (const n of [0, 1, 10, 500]) assert.equal(js.get(p.sumTo)!(n), num(ev(p.sumTo, n)), `sum to ${n}`);
  // Out of fuel: the fallback, as in the evaluator.
  assert.equal(js.get(p.sumTo)!(5000), -1);
  assert.equal(num(ev(p.sumTo, 5000)), -1);
  assert.equal(js.get(p.cube)!(1290), 1290 ** 3);
  // 1291³ is past 2³¹: the evaluator's Int holds it; a shader gives up.
  assert.equal(num(ev(p.cube, 1291)), 1291 ** 3);
  assert.equal(js.get(p.cube)!(1291), -1);
  assert.equal(js.get(p.cube)!(-1291), -1);
  assert.equal(js.get(p.lowest)!(), -2147483648);
});

test("an Int literal past 32 bits is refused in a shader, with the reason", () => {
  const k = new Lang();
  const d = k.def("huge");
  k.define(d, k.fn(["a"], (a) => k.call(INT_OPS.add, a, k.int(3_000_000_000))));
  const code = base(k.code), names = { ...baseNames(), ...k.names }, info = infer(code, names);
  const lowered = lowerScalar(code, info, names, [d], { int32: true });
  assert.match(lowered.refused.get(d) ?? "", /past 32 bits/);
});
