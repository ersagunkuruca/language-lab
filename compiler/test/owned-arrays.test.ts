// Arrays replaced in place where every array of their item type has one
// holder (owned-arrays.ts, C93 s4): one-holder.ts decides from the program,
// and the runtime still keeps versions where another view shares the
// buffer. Each program prints what the evaluator prints, in compiled
// JavaScript and as a WASI command (C56: WebAssembly writes the slot in
// place where no other view was made on the buffer).

import { closeSync, mkdtempSync, openSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { WASI } from "node:wasi";
import assert from "node:assert/strict";
import { Lang } from "../../ters/src/lang/dsl.ts";
import { infer } from "../../ters/src/lang/infer.ts";
import { base, baseNames, checkOptions } from "../../ters/src/lang/load.ts";
import { LIBRARY } from "../../ters/src/lang/library.ts";
import { runProgram } from "../../ters/src/lang/run.ts";
import { ARRAY_OPS, PAIR_V, S, SHOW_ANY } from "../../ters/src/lang/std.ts";
import type { Id } from "../../ters/src/model.ts";
import { lowerCore, printed, runCoreMain } from "../src/core-js.ts";
import { ownedArrays } from "../src/owned-arrays.ts";
import { lowerScalar } from "../src/scalar.ts";
import { emitWasm } from "../src/wasm.ts";

// main prints what `body` makes of a = array of [1, 2, 3]; each way, and
// whether a replace was written in place.
function both(body: (k: Lang, a: Id) => Id): { evaluator: string[]; compiled: string[]; wasm: string[]; owned: boolean } {
  const k = new Lang(LIBRARY.code);
  const main = k.def("main");
  k.define(main, k.thunk(() => k.let("a", k.call(ARRAY_OPS.of, k.listOf(k.int(1), k.int(2), k.int(3))), (a) => k.call(S.print, k.call(SHOW_ANY, body(k, a))))));
  const code = base(k.code), names = baseNames(k.names), info = infer(code, names, undefined, checkOptions);
  assert.deepEqual(info.errors.map((e) => e.message), []);
  const evaluator: string[] = [], compiled: string[] = [];
  runProgram(code, info, main, [], { print: (s) => evaluator.push(s), names });
  const ir = lowerCore(code, info, names, [main]);
  runCoreMain(ir, "main", [], { print: (s) => compiled.push(s) });
  const lowered = lowerScalar(code, info, names, [main], { data: true });
  const ownedInWasm = ownedArrays(lowered, code, info, names, main) > 0;
  const io = mkdtempSync(join(tmpdir(), "owned-")), out = openSync(join(io, "out"), "w");
  const wasi = new WASI({ version: "preview1", args: ["main"], stdout: out, returnOnExit: true });
  wasi.start(new WebAssembly.Instance(new WebAssembly.Module(emitWasm(lowered, { wasi: true, main }).bytes), wasi.getImportObject() as WebAssembly.Imports));
  closeSync(out);
  const owned = printed(ir).js.includes("array.replaceOwned");
  assert.equal(ownedInWasm, owned);
  return { evaluator, compiled, wasm: readFileSync(join(io, "out"), "utf8").split("\n").filter((l) => l), owned };
}
const at = (k: Lang, a: Id, i: number, v: number) => k.call(ARRAY_OPS.replaceAt, a, k.int(i), k.int(v));

test("an array changed and passed on is replaced in place", () => {
  const r = both((k, a) => at(k, at(k, a, 0, 10), 2, 30));
  assert.equal(r.owned, true);
  assert.deepEqual(r.compiled, r.evaluator);
  assert.deepEqual(r.wasm, r.evaluator);
});

test("an array read after it was changed keeps its versions", () => {
  const r = both((k, a) => k.let("b", at(k, a, 0, 10), (b) => k.call(PAIR_V, b, a)));
  assert.equal(r.owned, false);
  assert.deepEqual(r.compiled, r.evaluator);
  assert.deepEqual(r.wasm, r.evaluator);
});

test("a rest taken before the change shares the buffer, so the change keeps a version", () => {
  const r = both((k, a) => k.let("r", k.call(ARRAY_OPS.rest, a), (rest) => k.let("b", at(k, a, 1, 20), (b) => k.call(PAIR_V, b, rest))));
  assert.equal(r.owned, true);
  assert.deepEqual(r.compiled, r.evaluator);
  assert.deepEqual(r.wasm, r.evaluator);
});
