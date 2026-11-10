// A record rebuilt from its own fields, written in place where every value
// of its type has one holder (owned-records.ts, C93 s5): one-holder.ts
// decides from the program, a constructor given one value's fields
// counting as a change of it. Each program prints what the evaluator
// prints, in place or not, in compiled JavaScript and as a WASI command
// (C56: WebAssembly writes the changed fields with `set`).

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
import { INT_OPS, PAIR_V, S, SHOW_ANY } from "../../ters/src/lang/std.ts";
import { INT } from "../../ters/src/lang/types.ts";
import type { Id } from "../../ters/src/model.ts";
import { lowerCore, printed, runCoreMain } from "../src/core-js.ts";
import { intoAsSets, ownedRecords } from "../src/owned-records.ts";
import { kids, lowerScalar } from "../src/scalar.ts";
import { load } from "../src/program.ts";
import { emitWasm } from "../src/wasm.ts";

// A record P(x, y) of Ints; `moved(p)` is P(p.x + 1, p.y) and `x of(p)`
// reads p.x in a function of its own. main prints what `body` makes of
// p = P(1, 2).
interface P { k: Lang; make: (x: Id, y: Id) => Id; x: (p: Id) => Id; moved: (p: Id) => Id; xOf: (p: Id) => Id }
function both(body: (q: P, p: Id) => Id): { evaluator: string[]; compiled: string[]; wasm: string[]; owned: boolean } {
  const k = new Lang(LIBRARY.code);
  const t = k.type("P", [], [["p", [["x", () => k.tref(INT)], ["y", () => k.tref(INT)]]]]);
  const x = (p: Id) => k.call(t.f["p.x"], p), y = (p: Id) => k.call(t.f["p.y"], p);
  const make = (a: Id, b: Id) => k.call(t.v.p, a, b);
  const moved = k.def("moved"), xOf = k.def("x of");
  k.define(moved, k.fn(["p"], (p) => make(k.call(INT_OPS.add, x(p), k.int(1)), y(p))));
  k.define(xOf, k.fn(["p"], (p) => x(p)));
  const q: P = { k, make, x, moved: (p) => k.call(moved, p), xOf: (p) => k.call(xOf, p) };
  const main = k.def("main");
  k.define(main, k.thunk(() => k.let("p", make(k.int(1), k.int(2)), (p) => k.call(S.print, k.call(SHOW_ANY, body(q, p))))));
  const code = base(k.code), names = baseNames(k.names), info = infer(code, names, undefined, checkOptions);
  assert.deepEqual(info.errors.map((e) => e.message), []);
  const evaluator: string[] = [], compiled: string[] = [];
  runProgram(code, info, main, [], { print: (s) => evaluator.push(s), names });
  const ir = lowerCore(code, info, names, [main]);
  runCoreMain(ir, "main", [], { print: (s) => compiled.push(s) });
  const lowered = lowerScalar(code, info, names, [main], { data: true });
  ownedRecords(lowered, code, info, names, main);
  const sets = intoAsSets(lowered);
  const io = mkdtempSync(join(tmpdir(), "owned-")), out = openSync(join(io, "out"), "w");
  const wasi = new WASI({ version: "preview1", args: ["main"], stdout: out, returnOnExit: true });
  wasi.start(new WebAssembly.Instance(new WebAssembly.Module(emitWasm(lowered, { wasi: true, main }).bytes), wasi.getImportObject() as WebAssembly.Imports));
  closeSync(out);
  const owned = printed(ir).js.includes("instanceof");
  assert.equal(sets > 0, owned);
  return { evaluator, compiled, wasm: readFileSync(join(io, "out"), "utf8").split("\n").filter((l) => l), owned };
}

test("a record rebuilt and passed on is written in place", () => {
  const r = both((q, p) => q.moved(q.moved(p)));
  assert.equal(r.owned, true);
  assert.deepEqual(r.compiled, r.evaluator);
  assert.deepEqual(r.wasm, r.evaluator);
});

test("a field read where the record was named, after it was rebuilt, says what it said then", () => {
  const r = both((q, p) => q.k.let("m", q.moved(p), (m) => q.k.call(PAIR_V, q.x(p), m)));
  assert.equal(r.owned, true);
  assert.deepEqual(r.compiled, r.evaluator);
  assert.deepEqual(r.wasm, r.evaluator);
});

test("a record a helper reads after it was rebuilt, or kept whole, is copied", () => {
  const helper = both((q, p) => q.k.let("m", q.moved(p), (m) => q.k.call(PAIR_V, q.xOf(p), m)));
  assert.equal(helper.owned, false);
  assert.deepEqual(helper.compiled, helper.evaluator);
  assert.deepEqual(helper.wasm, helper.evaluator);
  const kept = both((q, p) => q.k.let("m", q.moved(p), (m) => q.k.call(PAIR_V, p, m)));
  assert.equal(kept.owned, false);
  assert.deepEqual(kept.compiled, kept.evaluator);
  assert.deepEqual(kept.wasm, kept.evaluator);
});

test("a closure capturing the record reads it as it was", () => {
  const r = both((q, p) => q.k.let("later", q.k.thunk(() => q.x(p)), (later) => q.k.let("m", q.moved(p), (m) => q.k.call(PAIR_V, q.k.call(later), m))));
  assert.deepEqual(r.compiled, r.evaluator);
  assert.deepEqual(r.wasm, r.evaluator);
});

// drift's `moved`, put in the closure code a map calls (zero-parts.ts puts
// small functions in place), keeps the binder its input had, so the mote
// it makes is written into the one the map was given (C60): every step
// changed x and y in place, the other seven fields untouched.
test("a record rebuilt in a map's closure code is written in place", () => {
  const p = load("drift");
  const main = p.code.defs.find((d) => p.pres.names[d] === "main")!;
  const ir = lowerCore(p.code, p.info, p.pres.names, [main]);
  const value = ir.funcs.find((f) => f.name === "moved.value")!;
  const into = (e: { k: string; into?: number }): boolean => (e.k === "make" && e.into !== undefined) || kids(e as never).some((k) => into(k));
  assert.ok(into(value.body), "moved.value writes the mote it was given");
  const out: string[] = [];
  runCoreMain(ir, "main", ["50"], { print: (s) => out.push(s) });
  const evaluator: string[] = [];
  runProgram(p.code, p.info, main, ["50"], { print: (s) => evaluator.push(s), names: p.pres.names });
  assert.deepEqual(out, evaluator);
});
