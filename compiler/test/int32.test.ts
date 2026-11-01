// Int in shaders (C66c): held in 32 bits, as WGSL's i32, with JavaScript
// the CPU's way to run the same functions. Within 32 bits the answers are
// the evaluator's; past them a shader gives up as a budget running out
// does, so a budget around it gives its fallback.

import { test } from "node:test";
import assert from "node:assert/strict";
import { Lang } from "../../ters/src/lang/dsl.ts";
import { infer } from "../../ters/src/lang/infer.ts";
import { makeRunner } from "../../ters/src/lang/run.ts";
import { base, baseNames } from "../../ters/src/lang/load.ts";
import { INT_OPS } from "../../ters/src/lang/std.ts";
import { lowerScalar } from "../src/scalar.ts";
import { emitWgsl } from "../src/wgsl.ts";
import { loadJs } from "../src/js-scalar.ts";
import { ints, shaderArrays } from "../src/fixtures.ts";
import { emitWasm, instantiate } from "../src/wasm.ts";


const first = <T>(xs: Iterable<T>) => { for (const x of xs) return x; };

test("Int in a shader is an i32, with + − × negate and abs checked for overflow", () => {
  const p = ints();
  const roots = [p.poly, p.smaller, p.same, p.sumTo, p.cube, p.lowest];
  const lowered = lowerScalar(p.code, p.info, p.names, roots, { records: true, shader: true });
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
  const lowered = lowerScalar(p.code, p.info, p.names, [p.poly, p.smaller, p.same, p.sumTo, p.cube, p.lowest], { records: true, shader: true });
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
  const lowered = lowerScalar(code, info, names, [d], { shader: true });
  assert.match(lowered.refused.get(d) ?? "", /past 32 bits/);
});

test("first with a fallback and count in a shader: a flag, the evaluator's answers (C66c2)", () => {
  const p = ints();
  const roots = [p.quot, p.rem, p.pow, p.whole, p.counted, p.quarter];
  const lowered = lowerScalar(p.code, p.info, p.names, roots, { records: true, shader: true });
  assert.deepEqual([...lowered.refused.values()], []);
  const s = emitWgsl(lowered);
  assert.deepEqual([...s.refused.values()], []);
  assert.match(s.wgsl, /var<private> lab_none: bool;/);
  assert.match(s.wgsl, /fn lab_iquot\(a: i32, b: i32\) -> i32/);
  // half has no answer for an odd number: not a place to start, only inside a first.
  assert.deepEqual(s.funcs.map((f) => f.name).sort(), ["count quotients", "power or", "quarter or", "quotient or", "remainder or", "whole or"]);
  const js = loadJs(lowered);
  const r = makeRunner(p.code, p.info, { print: () => {} });
  const ev = (d: string, ...xs: unknown[]) => { const v = first(r.call(r.value(d), ...(xs as never[]))); return typeof v === "bigint" ? Number(v) : v; };
  const pairs = [[7, 2], [-7, 2], [7, -2], [-7, -2], [6, 3], [5, 0], [0, 0], [-2147483648, 1], [2, 10], [3, -1], [-3, 3], [1, 31], [2, 31], [12, 4], [8, 5]];
  for (const d of [p.quot, p.rem, p.pow, p.counted, p.quarter]) for (const [a, b] of pairs) {
    if (d === p.pow && a === 2 && b === 31) continue; // 2³¹ is past 32 bits: fuel, outside any budget
    assert.equal(js.get(d)!(a, b), ev(d, a, b), `${p.names[d]} ${a} ${b}`);
  }
  for (const x of [2.5, -2.5, 0, -0.5, 1e6, NaN, Infinity, -Infinity]) assert.equal(js.get(p.whole)!(x), ev(p.whole, x), `whole ${x}`);
});

// C66e: the same lowering in WebAssembly, the faster way to draw a
// shader's picture on the CPU (editor/picture.ts): Int as an i32, the
// flag a global, so its answers are js-scalar.ts's and the evaluator's.
test("Int in 32 bits and the flag in WebAssembly: js-scalar.ts's answers", async () => {
  const p = ints();
  const roots = [p.poly, p.smaller, p.same, p.sumTo, p.cube, p.lowest, p.quot, p.rem, p.pow, p.whole, p.counted, p.quarter];
  const lowered = lowerScalar(p.code, p.info, p.names, roots, { records: true, shader: true });
  const m = emitWasm(lowered);
  assert.match(m.wat, /\(global \$none \(mut i32\)/);
  assert.match(m.wat, /call \$int32\.imul/);
  const w = await instantiate(m) as unknown as Record<string, (...xs: number[]) => number>;
  const js = loadJs(lowered);
  const at = (d: string) => w[p.names[d]];
  const same = (d: string, ...xs: number[]) => assert.equal(at(d)(...xs), Number(js.get(d)!(...xs)), `${p.names[d]} ${xs.join(" ")}`);
  for (const [a, b] of [[3, 4], [-7, 2], [0, -5], [46340, 46340], [-2147483647, 1]]) for (const d of [p.poly, p.smaller, p.same]) same(d, a, b);
  for (const n of [0, 1, 10, 500, 5000]) same(p.sumTo, n);
  for (const n of [1290, 1291, -1291]) same(p.cube, n);
  same(p.lowest);
  const pairs = [[7, 2], [-7, 2], [7, -2], [-7, -2], [6, 3], [5, 0], [0, 0], [-2147483648, 1], [-2147483648, -1], [2, 10], [3, -1], [-3, 3], [1, 31], [12, 4], [8, 5]];
  for (const d of [p.quot, p.rem, p.pow, p.counted, p.quarter]) for (const [a, b] of pairs) same(d, a, b);
  for (const x of [2.5, -2.5, 0, -0.5, 1e6, 3e9, NaN, Infinity, -Infinity]) same(p.whole, x);
});

// A shader's arrays (C66c) in WebAssembly: the same Array the data
// lowering has (C66a), with an i32 length and index, and `at` past the
// end raising the flag, so the editor's picture uses WebAssembly for them.
test("a shader's arrays in WebAssembly: js-scalar.ts's answers", async () => {
  const p = shaderArrays();
  const roots = [p.palette, p.grow, p.pick, p.nothing, p.twoSizes];
  const lowered = lowerScalar(p.code, p.info, p.names, roots, { records: true, shader: true });
  const m = emitWasm(lowered);
  assert.match(m.wat, /array\.new_fixed \$items\d* 3/);
  assert.match(m.wat, /call \$array\.at32\.a\d+/);
  const w = await instantiate(m) as unknown as Record<string, (x: number) => number>;
  const js = loadJs(lowered);
  const same = (d: string, x: number) => assert.equal(w[p.names[d]](x), Number(js.get(d)!(x)), `${p.names[d]} ${x}`);
  for (const i of [-1, 0, 1, 2, 3, 4, 5]) for (const d of [p.palette, p.pick, p.nothing]) same(d, i);
  for (const x of [0, 1.5, -3]) for (const d of [p.grow, p.twoSizes]) same(d, x);
});
