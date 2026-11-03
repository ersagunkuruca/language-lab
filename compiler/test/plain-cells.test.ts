// L99f: compiled JS keeps a program's cells plainly when nothing reads them
// reactively (no formula, each or page), as the evaluator does (L99e).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { Lang } from "../../ters/src/lang/dsl.ts";
import { infer } from "../../ters/src/lang/infer.ts";
import { base, baseNames, checkOptions } from "../../ters/src/lang/load.ts";
import { outlineProgram } from "../../ters/src/lang/cells-programs.ts";
import { CELL_OPS } from "../../ters/src/lang/std.ts";
import { compile } from "../src/compile.ts";

const runtime = pathToFileURL(join(import.meta.dirname, "../src/runtime.js")).href;

test("a program with cells and no formula, each or page compiles to plain cells, and runs", async () => {
  const k = new Lang();
  const main = k.def("main");
  k.define(main, k.thunk(() => k.let("c", k.call(CELL_OPS.cell, k.lit(1)), (c) => k.seq(k.call(CELL_OPS.write, k.x(c), k.lit(2)), k.call(CELL_OPS.read, k.x(c))))));
  const code = base(k.code), names = baseNames(k.names);
  const info = infer(code, names, undefined, checkOptions);
  assert.deepEqual(info.errors.map((e) => e.message), []);
  const js = compile(code, info, names, { runtime, exports: ["main"] });
  assert.match(js, /\$useCells\(true\);/);
  const path = join(mkdtempSync(join(tmpdir(), "plain-cells-")), "main.js");
  writeFileSync(path, js);
  const out = (await import(pathToFileURL(path).href)).defs as Record<string, () => unknown>;
  assert.equal(out.main(), 2);
});

test("a page's program keeps its cells tracked", () => {
  const p = outlineProgram();
  const code = base(p.code), names = baseNames(p.names);
  const info = infer(code, names, undefined, checkOptions);
  const js = compile(code, info, names, { runtime, exports: [names[p.main]] });
  assert.match(js, /\$useCells\(false\);/);
});
