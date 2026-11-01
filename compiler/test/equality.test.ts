// equal's one meaning (ters run.ts sameNumber), compiled: JavaScript
// for a Float64, a type variable and a list, and the scalar profile in
// WebAssembly, against the evaluator's rule on the boundary values in
// ters/test/equality.test.ts.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { sameNumber } from "../../ters/src/lang/run.ts";
import { infer } from "../../ters/src/lang/infer.ts";
import { Lang } from "../../ters/src/lang/dsl.ts";
import { base, baseNames } from "../../ters/src/lang/load.ts";
import { TRUE } from "../../ters/src/lang/std.ts";
import { B } from "../../ters/src/prelude.ts";
import { PAIRS } from "../../ters/test/helpers.ts";
import { compile } from "../src/compile.ts";
import { lowerScalar } from "../src/scalar.ts";
import { emitWasm, instantiate } from "../src/wasm.ts";

test("compiled equal gives the evaluator's answer on every boundary pair, at every type", async () => {
  const k = new Lang();
  const num = k.def("numbers"), same = k.def("same"), generic = k.def("generic"), lists = k.def("lists");
  // add(a, 0) makes a a Float64.
  k.define(num, k.fn(["a", "b"], (a, b) => k.equal(k.call(B.add, a, k.lit(0)), b)));
  k.define(same, k.fn(["x", "y"], (x, y) => k.equal(x, y)));
  k.define(generic, k.fn(["a", "b"], (a, b) => k.call(same, k.call(B.add, a, k.lit(0)), b)));
  k.define(lists, k.fn(["a", "b"], (a, b) => k.equal(k.list(k.call(B.add, a, k.lit(0))), k.list(b))));
  const code = base(k.code), names = { ...baseNames(), ...k.names };
  const info = infer(code, names);
  assert.deepEqual(info.errors, []);
  const path = join(mkdtempSync(join(tmpdir(), "equality-")), "equality.js");
  writeFileSync(path, compile(code, info, names, { runtime: pathToFileURL(join(import.meta.dirname, "../src/runtime.js")).href, exports: ["numbers", "generic", "lists"] }));
  const defs = (await import(pathToFileURL(path).href)).defs as Record<string, (...a: number[]) => unknown>;
  const wasm = await instantiate(emitWasm(lowerScalar(code, info, names, [num])));
  const yes = (v: unknown) => v === true || (v as { tag?: string })?.tag === TRUE;
  for (const [a, b] of PAIRS) {
    const want = sameNumber(a, b);
    for (const f of ["numbers", "generic", "lists"]) assert.equal(yes(defs[f](a, b)), want, `${f}(${a}, ${b}) compiled`);
    assert.equal(wasm.numbers(a, b) === 1, want, `numbers(${a}, ${b}) in WebAssembly`);
  }
});
