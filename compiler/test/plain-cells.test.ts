// L99f: compiled JS keeps a program's cells plainly when nothing reads them
// reactively (no formula, each or page), as the evaluator does (L99e).
import { test } from "node:test";
import assert from "node:assert/strict";
import { Lang } from "../../ters/src/lang/dsl.ts";
import { infer } from "../../ters/src/lang/infer.ts";
import { base, baseNames, checkOptions } from "../../ters/src/lang/load.ts";
import { CELL_OPS } from "../../ters/src/lang/std.ts";
import { compiledDefs } from "../src/core-js.ts";


test("a program with cells and no formula, each or page compiles to plain cells, and runs", async () => {
  const k = new Lang();
  const main = k.def("main");
  k.define(main, k.thunk(() => k.let("c", k.call(CELL_OPS.cell, k.lit(1)), (c) => k.seq(k.call(CELL_OPS.write, k.x(c), k.lit(2)), k.call(CELL_OPS.read, k.x(c))))));
  const code = base(k.code), names = baseNames(k.names);
  const info = infer(code, names, undefined, checkOptions);
  assert.deepEqual(info.errors.map((e) => e.message), []);
  assert.equal(compiledDefs(code, info, names, ["main"]).main(), 2);
});
