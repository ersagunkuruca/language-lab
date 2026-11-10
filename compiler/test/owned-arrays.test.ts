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
import { LIBRARY, TREES } from "../../ters/src/lang/library.ts";
import { merge } from "../../ters/src/model.ts";
import { runProgram } from "../../ters/src/lang/run.ts";
import { ARRAY_OPS, INT_OPS, PAIR_V, S, SHOW_ANY } from "../../ters/src/lang/std.ts";
import { preludeDef } from "../../ters/src/lang/arith.ts";
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

// An `array map` keeping its items' type, of an array nobody else holds,
// writes each answer into the slot it came from (C60, JavaScript only):
// printed, what the evaluator prints, and whether it was written so.
function mapped(body: (k: Lang, a: Id, map: (a: Id, by: (x: Id) => Id) => Id) => Id): { evaluator: string[]; compiled: string[]; inPlace: boolean } {
  const k = new Lang(merge(LIBRARY.code, TREES.code));
  const map = (a: Id, by: (x: Id) => Id) => k.call(preludeDef("array map")!, a, k.fn(["x"], (x) => by(x)));
  const main = k.def("main");
  k.define(main, k.thunk(() => k.let("a", k.call(ARRAY_OPS.of, k.listOf(k.int(1), k.int(2), k.int(3))), (a) => k.call(S.print, k.call(SHOW_ANY, body(k, a, map))))));
  const code = merge(base(TREES.code), k.code), names = { ...baseNames(k.names), ...TREES.names }, info = infer(code, names, undefined, checkOptions);
  assert.deepEqual(info.errors.map((e) => e.message), []);
  const evaluator: string[] = [], compiled: string[] = [];
  runProgram(code, info, main, [], { print: (s) => evaluator.push(s), names });
  const ir = lowerCore(code, info, names, [main]);
  runCoreMain(ir, "main", [], { print: (s) => compiled.push(s) });
  return { evaluator, compiled, inPlace: printed(ir).js.includes("array.replaceOwned") };
}
const plus = (k: Lang, x: Id, n: number) => k.call(INT_OPS.add, x, k.int(n));

test("a map of an array nobody else holds writes into it", () => {
  const r = mapped((k, a, map) => map(map(a, (x) => plus(k, x, 1)), (x) => plus(k, x, 10)));
  assert.equal(r.inPlace, true);
  assert.deepEqual(r.compiled, r.evaluator);
});

test("a map of an array read after it makes a new one", () => {
  const r = mapped((k, a, map) => k.call(PAIR_V, map(a, (x) => plus(k, x, 1)), a));
  assert.equal(r.inPlace, false);
  assert.deepEqual(r.compiled, r.evaluator);
});

test("a map whose function reads the array it maps makes a new one", () => {
  // The last item, read for each: written first, were it in place.
  const last = (k: Lang, a: Id) => k.call(S.first, k.thunk(() => k.call(ARRAY_OPS.at, a, k.int(2))), k.thunk(() => k.int(0)));
  const r = mapped((k, a, map) => map(a, (x) => k.call(INT_OPS.add, x, last(k, a))));
  assert.equal(r.inPlace, false);
  assert.deepEqual(r.compiled, r.evaluator);
});
