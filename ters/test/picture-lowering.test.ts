// The editor's pictures are lowered as shaders are (C66c): an Int is an
// i32 and std's Array an array<T, N>, so a picture that counts or looks
// something up in a written-out array draws on the GPU, and on the CPU in
// WebAssembly (Ints, C66e; arrays, C66f) or JavaScript.

import { test } from "node:test";
import assert from "node:assert/strict";
import { Lang } from "../src/lang/dsl.ts";
import { base, baseNames, checkOptions } from "../src/lang/load.ts";
import { infer } from "../src/lang/infer.ts";
import { makeRunner } from "../src/lang/run.ts";
import { B } from "../src/prelude.ts";
import { ARRAY_OPS, INT_OPS, S } from "../src/lang/std.ts";
import { LIBRARY } from "../src/lang/library.ts";
import { emitWgsl } from "../../compiler/src/wgsl.ts";
import { emitWasm, instantiate } from "../../compiler/src/wasm.ts";
import { loadJs } from "../../compiler/src/js-scalar.ts";
import { lowerPicture } from "../../editor/picture.ts";

const first = <T>(xs: Iterable<T>) => { for (const x of xs) return x; };

function picture() {
  const k = new Lang(LIBRARY.code);
  const def = (name: string, body: (x: string, y: string, t: string) => string) => { const d = k.def(name); k.define(d, k.fn(["x", "y", "t"], body)); return d; };
  const A = ARRAY_OPS;
  // red: a shade picked from a written-out array by a band number (an Int).
  const red = def("red", (x) => k.call(S.first,
    k.thunk(() => k.call(A.at, k.call(A.of, k.list(k.lit(0.1), k.lit(0.5), k.lit(0.9))), k.call(INT_OPS.remainder, k.call(INT_OPS.add, k.int(3), k.int(1)), k.int(3)))),
    k.thunk(() => k.call(B.mul, x, k.lit(0)))));
  const green = def("green", (x) => k.call(B.mul, x, k.lit(0.5)));
  const blue = def("blue", (_x, y, t) => k.call(B.add, y, t));
  const code = base(k.code), names = { ...baseNames(k.names) }, info = infer(code, names, undefined, checkOptions);
  if (info.errors.length) throw new Error(info.errors.map((e) => e.message).join("; "));
  return { code, names, info, entries: { red, green, blue } };
}

test("a picture with an Int and an array is lowered for the GPU and draws the evaluator's colour on the CPU", async () => {
  const p = picture();
  const lowered = lowerPicture(p.code, p.info, p.names, p.entries);
  const s = emitWgsl(lowered);
  assert.deepEqual([...s.refused.values()], []);
  assert.deepEqual(s.funcs.map((f) => f.name).sort(), ["blue", "green", "red"]);
  assert.match(s.wgsl, /array<f32, 3>/);
  // WebAssembly (C66f) and JavaScript both draw them.
  const w = await instantiate(emitWasm(lowered)) as unknown as Record<string, (...xs: number[]) => number>;
  const js = loadJs(lowered), r = makeRunner(p.code, p.info, { print: () => {} });
  for (const [x, y] of [[0, 0], [0.5, -0.25]]) {
    for (const d of Object.values(p.entries)) {
      const want = first(r.call(r.value(d), x as never, y as never, 1 as never));
      assert.equal(js.get(d)!(x, y, 1), want);
      assert.equal(w[p.names[d]](x, y, 1), want);
    }
  }
});
