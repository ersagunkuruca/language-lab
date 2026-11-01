// Tuples of ports (PORTS-2026-11-01.md §1, BACKLOG L128a): a function's
// inputs are one tuple, so f(p) is f(x, y) when p is an (x, y); a function
// gives several results as a tuple. Checked, evaluated and compiled the
// same (spread.ts takes the tuple apart before anything runs).

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { Id } from "../../ters/src/model.ts";
import { Lang } from "../../ters/src/lang/dsl.ts";
import { base, baseNames, checkOptions } from "../../ters/src/lang/load.ts";
import { infer } from "../../ters/src/lang/infer.ts";
import { makeRunner } from "../../ters/src/lang/run.ts";
import { ARITH, tuplePart, tupleType, tupleVariant } from "../../ters/src/lang/std.ts";
import { LIBRARY } from "../../ters/src/lang/library.ts";
import { INT } from "../../ters/src/lang/types.ts";
import { showType } from "../../ters/src/lang/types.ts";
import { compile } from "../src/compile.ts";

const runtime = pathToFileURL(join(import.meta.dirname, "../src/runtime.js")).href;

function program() {
  const k = new Lang();
  const def = (name: string, body: () => Id) => { const d = k.def(name); k.define(d, body()); return d; };
  // Two results: a tuple.
  const sd = def("sum and difference", () => k.fn(["x", "y"], (x, y) => k.call(tupleVariant(2), k.call(ARITH.add, x, y), k.call(ARITH.sub, x, y))));
  const scaled = def("scaled", () => k.fn(["x", "y", "by"], (x, y, by) => k.call(ARITH.add, k.call(ARITH.mul, x, by), k.call(ARITH.mul, y, by))));
  const mul = def("times", () => k.fn(["a", "b"], (a, b) => k.call(ARITH.mul, a, b)));
  // Its results given whole to a function of two inputs: a name, then a call.
  def("product of sum and difference", () => k.fn(["x", "y"], (x, y) => k.let("p", k.call(sd, x, y), (p) => k.call(mul, p))));
  def("straight through", () => k.fn(["x", "y"], (x, y) => k.call(mul, k.call(sd, x, y))));
  def("three", () => k.fn(["x"], (x) => k.call(scaled, k.call(tupleVariant(3), x, k.lit(1), k.lit(2)))));
  def("second part", () => k.fn(["x", "y"], (x, y) => k.call(tuplePart(2, 1), k.call(sd, x, y))));
  return { k, code: base(k.code), names: baseNames(k.names), sd };
}

test("a tuple given for several inputs: checked, evaluated and compiled the same", async () => {
  const { code, names, sd } = program();
  const info = infer(code, names, undefined, checkOptions);
  assert.deepEqual(info.errors.map((e) => e.message), []);
  assert.equal(showType(info.typeOf.get(sd)!, names, info.subst.arith), "(a, a) -> (a, a) where a is a Number");
  const exports = ["product of sum and difference", "straight through", "three", "second part"];
  const js = compile(code, info, names, { runtime, exports });
  const path = join(mkdtempSync(join(tmpdir(), "tuples-")), "tuples.js");
  writeFileSync(path, js);
  const out = (await import(pathToFileURL(path).href)).defs as Record<string, (...x: number[]) => unknown>;
  const r = makeRunner(code, info, { print: () => {}, names });
  const at = (n: string) => code.defs.find((d) => names[d] === n)!;
  const first = (v: unknown) => (v && typeof v === "object" && Symbol.iterator in (v as object) ? [...(v as Iterable<unknown>)][0] : v);
  // (5 + 2)(5 − 2) = 21; scaled(2, 1, 2) = 2·2 + 1·2 = 6; 5 − 2 = 3.
  const want: Record<string, number> = { "product of sum and difference": 21, "straight through": 21, "three": 6, "second part": 3 };
  for (const n of exports) {
    const args = n === "three" ? [2] : [5, 2];
    assert.equal(first(r.call(r.value(at(n)), ...(args as never[]))), want[n], `evaluated ${n}`);
    assert.equal(out[n](...args), want[n], `compiled ${n}`);
  }
});

test("a tuple of the wrong shape, or a value that isn't one, says what the inputs need", () => {
  const k = new Lang();
  const mul = k.def("times");
  k.define(mul, k.fn(["a", "b"], (a, b) => k.call(ARITH.mul, a, b)));
  const bad = k.def("bad");
  k.define(bad, k.fn(["x"], (x) => k.call(mul, k.call(tupleVariant(3), x, x, x))));
  const text = k.def("text");
  k.define(text, k.fn(["x"], () => k.call(mul, k.lit("no"))));
  const info = infer(base(k.code), baseNames(k.names), undefined, checkOptions);
  const msgs = info.errors.map((e) => e.message);
  assert.equal(msgs.length, 2, msgs.join("\n"));
  assert.match(msgs[0], /takes 2 inputs: given one, it needs \(a, a\) here, got \(.*, .*, .*\)/);
  assert.match(msgs[1], /takes 2 inputs: given one, it needs \(a, a\) here, got Text/);
});

// L137 (REVIEW-2026-11-01b §1): a function of two inputs given where a
// function of one pair goes, and the other way round, wherever the callee
// isn't known yet: apply, map, keep, a record's field.
test("a function of two inputs and a function of one pair meet anywhere a function is given (L137)", async () => {
  const k = new Lang(LIBRARY.code);
  const def = (name: string, body: () => Id) => { const d = k.def(name); k.define(d, body()); return d; };
  const lib = (name: string) => LIBRARY.modules.flatMap((m) => m.exports).find((d) => LIBRARY.names[d] === name)!;
  const pair = (a: Id, b: Id) => k.call(tupleVariant(2), a, b);
  const mul = def("times", () => k.fn(["a", "b"], (a, b) => k.call(ARITH.mul, a, b)));
  const onPair = def("on pair", () => k.fn(["p"], (p) => k.call(ARITH.sub, k.call(tuplePart(2, 0), p), k.call(tuplePart(2, 1), p))));
  const apply = def("apply", () => k.fn(["f", "p"], (f, p) => k.call(f, p)));
  const both = def("both", () => k.fn(["f", "x", "y"], (f, x, y) => k.call(f, x, y)));
  const Holder = k.type("Holder", [], [["holder", [["run", () => k.tfun([k.tref(tupleType(2), k.tref(INT), k.tref(INT))], k.tref(INT))]]]]);
  def("use apply", () => k.fn(["x"], (x) => k.call(apply, mul, pair(x, k.int(3)))));
  def("use map", () => k.thunk(() => k.call(lib("sum"), k.call(lib("map"), k.list(pair(k.int(2), k.int(3)), pair(k.int(4), k.int(5))), mul))));
  def("use keep", () => k.thunk(() => k.call(lib("length"), k.call(lib("keep"), k.list(pair(k.int(2), k.int(3)), pair(k.int(5), k.int(4))), def("smaller first", () => k.fn(["a", "b"], (a, b) => k.call(ARITH.less, a, b)))))));
  def("use record", () => k.fn(["x"], (x) => k.call(k.call(Holder.f["holder.run"], k.call(Holder.v.holder, mul)), pair(x, k.int(2)))));
  def("other way", () => k.fn(["x"], (x) => k.call(both, onPair, x, k.int(1))));
  const code = base(k.code), names = baseNames(k.names);
  const info = infer(code, names, undefined, checkOptions);
  assert.deepEqual(info.errors.map((e) => e.message), []);
  const exports = ["use apply", "use map", "use keep", "use record", "other way"];
  const js = compile(code, info, names, { runtime, exports });
  const path = join(mkdtempSync(join(tmpdir(), "reshape-")), "reshape.js");
  writeFileSync(path, js);
  const out = (await import(pathToFileURL(path).href)).defs as Record<string, unknown>;
  const r = makeRunner(code, info, { print: () => {}, names });
  const at = (n: string) => code.defs.find((d) => names[d] === n)!;
  const first = (v: unknown) => (v && typeof v === "object" && Symbol.iterator in (v as object) ? [...(v as Iterable<unknown>)][0] : v);
  const want: Record<string, [unknown[], unknown]> = { "use apply": [[4n], 12n], "use map": [[], 26n], "use keep": [[], 1n], "use record": [[7n], 14n], "other way": [[9n], 8n] };
  for (const n of exports) {
    const [args, w] = want[n];
    const ev = first(r.call(r.value(at(n)), ...(args as never[])));
    const co = typeof out[n] === "function" ? (out[n] as (...a: unknown[]) => unknown)(...args) : out[n];
    assert.equal(String(ev), String(w), `evaluated ${n}`);
    assert.equal(String(co), String(w), `compiled ${n}`);
  }
});
