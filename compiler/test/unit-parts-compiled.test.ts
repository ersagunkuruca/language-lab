// A record of Float64s' unit parts in compiled code (C292 step 1): where
// a generic definition takes a point apart by its unit parts, C and
// WebAssembly write the list out at the type it is called at, as the
// evaluator gives it.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { closeSync, mkdtempSync, openSync, readFileSync } from "node:fs";
import { WASI } from "node:wasi";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Lang } from "../../ters/src/lang/dsl.ts";
import { base, baseNames, checkOptions } from "../../ters/src/lang/load.ts";
import { infer } from "../../ters/src/lang/infer.ts";
import { runMain } from "../../ters/src/lang/run.ts";
import { ARITH, S, SHOW_ANY } from "../../ters/src/lang/std.ts";
import { NUMBER } from "../../ters/src/lang/types.ts";
import { LIBRARY } from "../../ters/src/lang/library.ts";
import { lowerScalar } from "../src/scalar.ts";
import { emitC } from "../src/c.ts";
import { emitWasm } from "../src/wasm.ts";
import { compile, skip } from "./c-harness.ts";

function program() {
  const k = new Lang(LIBRARY.code);
  const Trio = k.type("Trio", [], [["trio", [["x", () => k.tref(NUMBER)], ["y", () => k.tref(NUMBER)], ["z", () => k.tref(NUMBER)]]]]);
  const map = LIBRARY.code.defs.find((d) => LIBRARY.names[d] === "map")!;
  // A point's parts as a list, each read by its unit part: generic, so
  // unit parts' type is known only where it is called.
  const partsOf = k.def("parts of");
  k.define(partsOf, k.fn(["p"], (p) => k.call(map, k.call(S.unitParts, p), k.fn(["u"], (u) => k.call(S.total, k.call(S.zipParts, ARITH.mul, u, p))))));
  const main = k.def("main");
  k.define(main, k.thunk(() => k.seq(
    k.call(S.print, k.call(SHOW_ANY, k.call(partsOf, k.call(Trio.v.trio, k.lit(1.5), k.lit(-2), k.lit(3.25))))),
    k.call(S.print, k.call(SHOW_ANY, k.call(partsOf, k.lit(7)))),
    k.call(S.print, k.call(SHOW_ANY, k.call(S.unitParts, k.call(Trio.v.trio, k.lit(0), k.lit(0), k.lit(0))))))));
  const code = base(k.code), names = baseNames(k.names), info = infer(code, names, undefined, checkOptions);
  assert.deepEqual(info.errors.map((e) => e.message), []);
  const want: string[] = [];
  runMain(code, info, main, { print: (l) => want.push(l), names });
  assert.equal(want.length, 3);
  assert.equal(want[0], "[1.5, -2, 3.25]");
  return { code, info, names, main, want };
}

test("unit parts in C, written out at the type a generic definition is called at", { skip }, () => {
  const { code, info, names, main, want } = program();
  const l = lowerScalar(code, info, names, [main], { data: true, handlers: true, threads: true });
  assert.deepEqual([...l.refused.values()], []);
  const r = spawnSync(compile(emitC(l, { main }).c), []);
  assert.deepEqual(r.stdout.toString().split("\n").filter((x) => x), want);
});

test("unit parts in a WASI command, likewise", () => {
  const { code, info, names, main, want } = program();
  const l = lowerScalar(code, info, names, [main], { data: true, handlers: true });
  assert.deepEqual([...l.refused.values()], []);
  const dir = mkdtempSync(join(tmpdir(), "unit-parts-")), out = join(dir, "out.txt"), fd = openSync(out, "w");
  const w = new WASI({ version: "preview1", args: ["p"], stdout: fd, stderr: fd, returnOnExit: true });
  const status = w.start(new WebAssembly.Instance(new WebAssembly.Module(emitWasm(l, { wasi: true, main }).bytes), w.getImportObject() as WebAssembly.Imports));
  closeSync(fd);
  assert.equal(status, 0);
  assert.deepEqual(readFileSync(out, "utf8").split("\n").filter((x) => x), want);
});
