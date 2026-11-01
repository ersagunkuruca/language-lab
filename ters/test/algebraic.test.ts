// Algebraic numbers (EXACT-REALS.md, BACKLOG L88 step 2): √2 held as the
// root of x² − 2 between 1 and 2, so √2 · √2 is exactly 2, comparisons
// always answer, and digits come out as many as asked for.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { Lang } from "../src/lang/dsl.ts";
import { infer } from "../src/lang/infer.ts";
import { makeRunner, type Value } from "../src/lang/run.ts";
import { base, baseNames, checkOptions } from "../src/lang/load.ts";
import { LIBRARY } from "../src/lang/library.ts";
import { ALGEBRAIC_OPS as AL, ARITH, COMPARE, ofAlg, S, SHOW_ANY, toAlg } from "../src/lang/std.ts";
import { relate, toValue } from "../src/lang/relate.ts";
import { showType } from "../src/lang/types.ts";
import type { Id } from "../src/model.ts";
import { compile } from "../../compiler/src/compile.ts";
import * as A from "../src/lang/algebraic.ts";

const runtime = pathToFileURL(join(import.meta.dirname, "../../compiler/src/runtime.js")).href;

function program() {
  const k = new Lang(LIBRARY.code);
  const def = (name: string, body: () => Id) => { const d = k.def(name); k.define(d, body()); return d; };
  const show = (x: Id) => k.call(SHOW_ANY, x);
  // square root has no answer for a negative number, so it is a Choice;
  // first(…, 0) gives a value.
  const root = (n: number) => k.call(S.first, k.thunk(() => k.call(AL.sqrt, k.lit(n))), k.thunk(() => k.lit(0)));
  const times = (a: Id, b: Id) => k.call(ARITH.mul, a, b), plus = (a: Id, b: Id) => k.call(ARITH.add, a, b);
  const r2 = def("root two", () => root(2));
  def("squared", () => show(times(r2, r2)));
  def("fourth power", () => show(times(times(r2, r2), times(r2, r2))));
  def("two roots", () => show(plus(r2, root(3))));
  def("is two", () => k.equal(times(r2, r2), k.lit(2)));
  def("below", () => k.call(ARITH.less, r2, k.lit(1.415)));
  def("digits", () => k.call(AL.digits, r2, k.int(30)));
  def("ordered", () => k.call(COMPARE, root(3), plus(r2, k.lit(0.25))));
  def("as float", () => k.call(AL.toNumber, plus(r2, k.lit(1))));
  def("halved", () => show(k.call(S.first, k.thunk(() => k.call(AL.divide, r2, k.lit(2))), k.thunk(() => k.lit(0)))));
  const code = base(k.code), names = baseNames(k.names);
  return { code, names, info: infer(code, names, undefined, checkOptions) };
}
const NAMES = ["squared", "fourth power", "two roots", "is two", "below", "digits", "ordered", "as float", "halved"];
const WANT: Value[] = ["2", "4", "3.1462643699…", { tag: "std.bool.true", fields: [] }, { tag: "std.bool.true", fields: [] }, "1.414213562373095048801688724209", { tag: "std.order.after", fields: [] }, 1 + Math.SQRT2, "0.7071067811…"];

test("√2 · √2 is 2, (√2)⁴ is 4, and √2 + √3 has digits to spare: evaluated and compiled", async () => {
  const p = program();
  assert.deepEqual(p.info.errors.map((e) => e.message), []);
  const at = (n: string) => p.code.defs.find((d) => p.names[d] === n)!;
  assert.equal(showType(p.info.schemes.get(at("root two"))!.type, p.names), "Algebraic");
  const r = makeRunner(p.code, p.info, { print: () => {}, names: p.names });
  assert.deepEqual(NAMES.map((n) => r.value(at(n))), WANT);
  const path = join(mkdtempSync(join(tmpdir(), "algebraic-")), "algebraic.js");
  writeFileSync(path, compile(p.code, p.info, p.names, { runtime, exports: NAMES }));
  const defs = (await import(pathToFileURL(path).href)).defs as Record<string, unknown>;
  for (const n of NAMES) {
    const c = typeof defs[n] === "function" ? (defs[n] as () => Value)() : defs[n];
    assert.deepEqual(c, r.value(at(n)), n);
  }
});

test("one spelling per number: the same number reached two ways is the same value", () => {
  const two = A.fraction(2n, 1n), three = A.fraction(3n, 1n);
  const r2 = A.root(two, 2)!, r3 = A.root(three, 2)!;
  assert.deepEqual(A.subtract(A.add(r2, r3), r3), r2);
  assert.deepEqual(A.divide(A.root(A.fraction(8n, 1n), 2)!, r2), two);
  assert.deepEqual(A.multiply(A.root(A.fraction(6n, 1n), 2)!, A.inverse(r3)!), r2);
  assert.equal(A.show(A.root(A.fraction(-8n, 1n), 3)!), "-2");
  assert.equal(A.root(A.fraction(-2n, 1n), 2), null);
  assert.equal(A.show(A.negate(r2)), "−√2");
  assert.ok(A.less(A.negate(r3), A.negate(r2)));
});

// EXACT-REALS.md step 3: a polynomial equation at Algebraic runs backwards
// to its real roots, exactly, smallest first: x · x = 2 gives −√2 and √2,
// x · x + x = 12 gives −4 and 3, and x · x = −1 none.
test("polynomial equations run backwards at Algebraic: x · x = 2 gives −√2 and √2", () => {
  const k = new Lang();
  const one = (name: string, body: (x: Id) => Id) => { const d = k.def(name); let p = ""; k.define(d, k.fn(["x"], (x) => ((p = x), body(x)))); return () => ({ d, p }); };
  const zero = () => k.at("std.algebraic", 0);
  const square = one("square", (x) => k.call(ARITH.add, k.call(ARITH.mul, x, x), zero()));
  const poly = one("poly", (x) => k.call(ARITH.add, k.call(ARITH.add, k.call(ARITH.mul, x, x), x), zero()));
  const quartic = one("quartic", (x) => k.call(ARITH.sub, k.call(ARITH.mul, k.call(ARITH.mul, x, x), k.call(ARITH.mul, x, x)), k.call(ARITH.mul, k.at("std.algebraic", 10), k.call(ARITH.mul, x, x))));
  const code = base(k.code), names = baseNames(k.names);
  const solve = (f: () => { d: Id; p: Id }, out: number) => {
    const { d, p } = f();
    return [...relate(code, d, { out: ofAlg(A.fraction(BigInt(out), 1n)) }, { names, spend: () => true })].map((a) => A.show(toAlg(toValue(a.values[p]) as never)));
  };
  assert.deepEqual(solve(square, 2), ["−√2", "√2"]);
  assert.deepEqual(solve(square, 9), ["-3", "3"]);
  assert.deepEqual(solve(square, -1), []);
  assert.deepEqual(solve(poly, 12), ["-4", "3"]);
  // x⁴ − 10x² = −1: ±√2 ± √3, the four of them, smallest first.
  assert.deepEqual(solve(quartic, -1).map((s) => s.slice(0, 8)), ["−3.14626", "−0.31783", "0.317837", "3.146264"]);
});
