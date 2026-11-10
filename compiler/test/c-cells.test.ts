// Cells in C and WebAssembly (C199a, NATIVE-APPS.md): a cell is a box
// holding a closure of nothing, one giving what was written or the
// formula, run at each read; the reads give the evaluator's.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { WASI } from "node:wasi";
import { closeSync, mkdtempSync, openSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Lang } from "../../ters/src/lang/dsl.ts";
import { infer } from "../../ters/src/lang/infer.ts";
import { base, baseNames, checkOptions } from "../../ters/src/lang/load.ts";
import { runMain } from "../../ters/src/lang/run.ts";
import { CELL_OPS, INT_OPS, S, SHOW_ANY } from "../../ters/src/lang/std.ts";
import type { Id } from "../../ters/src/model.ts";
import { lowerScalar } from "../src/scalar.ts";
import { emitC } from "../src/c.ts";
import { emitWasm } from "../src/wasm.ts";
import { compile, skip } from "./c-harness.ts";

// main's printed lines from the evaluator, C and WebAssembly.
function run(body: (k: Lang, show: (x: Id) => Id) => Id) {
  const k = new Lang(), main = k.def("main");
  k.define(main, k.thunk(() => body(k, (x) => k.call(S.print, k.call(SHOW_ANY, x)))));
  const code = base(k.code), names = baseNames(k.names), info = infer(code, names, undefined, checkOptions);
  assert.deepEqual(info.errors.map((e) => e.message), []);
  let evaluator = "";
  runMain(code, info, main, { print: (l) => { evaluator += `${l}\n`; }, names });
  const opts = { data: true, releases: true, handlers: true, cells: true };
  const l = lowerScalar(code, info, names, [main], { ...opts, threads: true });
  assert.deepEqual([...l.refused.values()], []);
  const r = spawnSync(compile(emitC(l, { main }).c), []);
  assert.equal(r.status, 0, r.stderr.toString());
  const io = mkdtempSync(join(tmpdir(), "cells-")), out = openSync(join(io, "out"), "w");
  const wasi = new WASI({ version: "preview1", args: ["main"], stdout: out, returnOnExit: true });
  wasi.start(new WebAssembly.Instance(new WebAssembly.Module(emitWasm(lowerScalar(code, info, names, [main], opts), { wasi: true, main }).bytes), wasi.getImportObject() as WebAssembly.Imports));
  closeSync(out);
  return { evaluator, c: r.stdout.toString(), wasm: readFileSync(join(io, "out"), "utf8") };
}

test("a counter written three times, and a formula over it, read as the evaluator reads them (C199a)", { skip }, () => {
  const p = run((k, show) => k.let("c", k.call(CELL_OPS.cell, k.int(1)), (c) =>
    k.let("d", k.call(CELL_OPS.formula, k.thunk(() => k.call(INT_OPS.mul, k.call(CELL_OPS.read, c), k.int(2)))), (d) =>
      k.seq(show(k.call(CELL_OPS.read, d)),
        k.call(CELL_OPS.write, c, k.int(5)), show(k.call(CELL_OPS.read, d)),
        k.call(CELL_OPS.write, c, k.call(INT_OPS.add, k.call(CELL_OPS.read, c), k.int(1))), show(k.call(CELL_OPS.read, c)),
        k.call(CELL_OPS.write, c, k.int(-3)), show(k.call(CELL_OPS.read, d))))));
  assert.equal(p.evaluator, "2\n10\n6\n-6\n");
  assert.equal(p.c, p.evaluator);
  assert.equal(p.wasm, p.evaluator);
});

// Counted values in a cell: what a write replaces is dropped (ASan sees a
// leak or a double drop), and a cell of a cell reads through.
test("a cell of texts written over, and a cell holding a cell, read as the evaluator reads them (C199a)", { skip }, () => {
  const p = run((k, show) => k.let("t", k.call(CELL_OPS.cell, k.lit("a")), (t) =>
    k.let("o", k.call(CELL_OPS.cell, t), (o) =>
      k.let("n", k.call(CELL_OPS.formula, k.thunk(() => k.call(S.concat, k.call(CELL_OPS.read, k.call(CELL_OPS.read, o)), k.lit("!")))), (n) =>
        k.seq(k.call(CELL_OPS.write, t, k.call(S.concat, k.call(CELL_OPS.read, t), k.lit("b"))),
          k.call(CELL_OPS.write, t, k.call(S.concat, k.call(CELL_OPS.read, t), k.lit("c"))),
          show(k.call(CELL_OPS.read, n)),
          k.call(CELL_OPS.write, o, k.call(CELL_OPS.cell, k.lit("other"))),
          show(k.call(CELL_OPS.read, n)), show(k.call(CELL_OPS.read, t)))))));
  assert.equal(p.evaluator, "\"abc!\"\n\"other!\"\n\"abc\"\n");
  assert.equal(p.c, p.evaluator);
  assert.equal(p.wasm, p.evaluator);
});
