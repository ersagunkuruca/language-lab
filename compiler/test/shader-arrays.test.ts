// std's Array in a shader (C66c): WGSL's array<T, N>, its size fixed where
// each array is made (written out, empty, pushed onto); item at past the
// end is no answer, which `first` turns into its fallback. The shader's
// JavaScript fallback gives the evaluator's answers.

import { test } from "node:test";
import assert from "node:assert/strict";
import { makeRunner } from "../../ters/src/lang/run.ts";
import { lowerScalar } from "../src/scalar.ts";
import { emitWgsl } from "../src/wgsl.ts";
import { loadJs } from "../src/js-scalar.ts";
import { shaderArrays } from "../src/fixtures.ts";

const first = <T>(xs: Iterable<T>) => { for (const x of xs) return x; };

test("arrays in a shader: array<T, N> where the size is known, the evaluator's answers on the CPU", () => {
  const p = shaderArrays();
  const roots = [p.palette, p.grow, p.pick, p.nothing, p.uneven, p.listed];
  const lowered = lowerScalar(p.code, p.info, p.names, roots, { records: true, shader: true });
  assert.match(lowered.refused.get(p.listed) ?? "", /isn.t written out/);
  const s = emitWgsl(lowered);
  assert.match(s.refused.get(p.uneven) ?? "", /one way and of 2 another/);
  assert.deepEqual(s.funcs.map((f) => f.name).sort(), ["grow", "nothing at", "palette", "pick"]);
  assert.match(s.wgsl, /array<f32, 3>\(0\.1, 0\.5, 0\.9\)/);
  assert.match(s.wgsl, /fn table_\d+\(\) -> array<i32, 5>/);
  assert.match(s.wgsl, /array<f32, 2>\(t\d+\[0\], /);
  const js = loadJs(lowered);
  const r = makeRunner(p.code, p.info, { print: () => {} });
  const ev = (d: string, ...xs: unknown[]) => { const v = first(r.call(r.value(d), ...(xs as never[]))); return typeof v === "bigint" ? Number(v) : v; };
  for (const i of [-1, 0, 1, 2, 3, 4, 5]) {
    assert.equal(js.get(p.palette)!(i), ev(p.palette, i), `palette ${i}`);
    assert.equal(js.get(p.pick)!(i), ev(p.pick, i), `pick ${i}`);
    assert.equal(js.get(p.nothing)!(i), ev(p.nothing, i), `nothing at ${i}`);
  }
  for (const x of [0, 1.5, -3]) assert.equal(js.get(p.grow)!(x), ev(p.grow, x), `grow ${x}`);
});

test("an array as a shader function's input: a copy per size it is called with (C66d)", () => {
  const p = shaderArrays();
  const lowered = lowerScalar(p.code, p.info, p.names, [p.twoSizes, p.loose], { records: true, shader: true });
  const s = emitWgsl(lowered);
  // An entry point's inputs come from the CPU, so it can't take an array.
  assert.match(s.refused.get(p.loose) ?? "", /Array/);
  assert.deepEqual(s.funcs.map((f) => f.name), ["two sizes"]);
  assert.match(s.wgsl, /fn head_and_size_\d+_n1\(p0: array<f32, 1>\) -> f32/);
  assert.match(s.wgsl, /fn head_and_size_\d+_n3\(p0: array<f32, 3>\) -> f32/);
  const js = loadJs(lowered);
  const r = makeRunner(p.code, p.info, { print: () => {} });
  for (const x of [0, 1.5, -3]) assert.equal(js.get(p.twoSizes)!(x), first(r.call(r.value(p.twoSizes), x as never)), `two sizes ${x}`);
});
