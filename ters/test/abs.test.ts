// One abs for every number type with < (I342, std.ts ARITH.abs): Float64's
// and Int's own, a definition using it generic over both, and on a type
// with + − · and < of its own, `if x < −x then −x else x` by those
// (arith.ts). Evaluated and compiled the same.

import { test } from "node:test";
import assert from "node:assert/strict";
import { Lang } from "../src/lang/dsl.ts";
import { infer } from "../src/lang/infer.ts";
import { makeRunner, type Value } from "../src/lang/run.ts";
import { base, baseNames, checkOptions } from "../src/lang/load.ts";
import { LIBRARY } from "../src/lang/library.ts";
import { ARITH, ARITHMETIC_V, INT_OPS, ORDERED_V, SHOW_ANY } from "../src/lang/std.ts";
import { INT } from "../src/lang/types.ts";
import { showIn } from "../src/lang/types.ts";
import type { Id } from "../src/model.ts";
import { compiledDefs } from "../../compiler/src/core-js.ts";

const lib = (name: string) => LIBRARY.modules.flatMap((m) => m.exports).find((d) => LIBRARY.names[d] === name)!;

function program() {
  const k = new Lang(LIBRARY.code);
  const def = (name: string, body: () => Id) => { const d = k.def(name); k.define(d, body()); return d; };
  const show = (x: Id) => k.call(SHOW_ANY, x);
  const sizes = def("sizes", () => k.fn(["xs"], (xs) => k.call(lib("map"), xs, k.fn(["x"], (x) => k.call(ARITH.abs, x)))));
  def("an Int's", () => show(k.call(ARITH.abs, k.call(INT_OPS.neg, k.int(3)))));
  def("a Float64's", () => show(k.call(ARITH.abs, k.lit(-2.5))));
  def("Ints' sizes", () => show(k.call(sizes, k.list(k.int(1), k.call(INT_OPS.neg, k.int(2))))));
  def("Float64s' sizes", () => show(k.call(sizes, k.list(k.lit(1.5), k.lit(-2.5)))));
  // Cents, with + − · and < of their own.
  const C = k.type("Cents", [], [["cents", [["n", () => k.tref(INT)]]]]);
  const c = (n: number) => k.call(C.v.cents, n < 0 ? k.call(INT_OPS.neg, k.int(-n)) : k.int(n));
  const of = (v: Id, f: (n: Id) => Id) => k.match(v, [{ variant: C.v.cents, names: ["n"], body: ([n]) => f(n) }]);
  const two = (op: Id) => k.fn(["a", "b"], (a, b) => of(a, (x) => of(b, (y) => k.call(C.v.cents, k.call(op, x, y)))));
  def("arithmetic at cents", () => k.call(ARITHMETIC_V, two(INT_OPS.add), two(INT_OPS.sub), two(INT_OPS.mul), k.fn(["a"], (a) => of(a, (x) => k.call(C.v.cents, k.call(INT_OPS.neg, x))))));
  def("ordered at cents", () => k.call(ORDERED_V, k.fn(["a", "b"], (a, b) => of(a, (x) => of(b, (y) => k.call(INT_OPS.less, x, y))))));
  def("Cents' size", () => of(k.call(ARITH.abs, c(-5)), (n) => show(n)));
  def("Cents' size, kept", () => of(k.call(ARITH.abs, c(7)), (n) => show(n)));
  const code = base(k.code), names = baseNames(k.names);
  return { code, names, info: infer(code, names, undefined, checkOptions), sizes };
}
const NAMES = ["an Int's", "a Float64's", "Ints' sizes", "Float64s' sizes", "Cents' size", "Cents' size, kept"];

test("abs at Int, at Float64, generic over both, and on a type's own + − · and <, evaluated and compiled", () => {
  const p = program();
  assert.deepEqual(p.info.errors.map((e) => e.message), []);
  const sc = p.info.schemes.get(p.sizes)!;
  assert.match(showIn(sc.type, p.names, p.info.subst), /^\(List (\w+)\) -> List \1 where \1 is a Number with <$/);
  const r = makeRunner(p.code, p.info, { print: () => {}, names: p.names });
  const at = (n: string) => p.code.defs.find((d) => p.names[d] === n)!;
  const evaluated = NAMES.map((n) => r.value(at(n)));
  assert.deepEqual(evaluated, ["3", "2.5", "[1, 2]", "[1.5, 2.5]", "5", "7"]);
  const defs = compiledDefs(p.code, p.info, p.names, NAMES) as unknown as Record<string, unknown>;
  assert.deepEqual(NAMES.map((n) => (typeof defs[n] === "function" ? (defs[n] as () => Value)() : defs[n])), evaluated);
});

test("abs on Text, which has < but no + − ·, is refused where it is used", () => {
  const k = new Lang(LIBRARY.code);
  const d = k.def("a text's size");
  k.define(d, k.call(ARITH.abs, k.lit("x")));
  const code = base(k.code), names = baseNames(k.names);
  const info = infer(code, names, undefined, checkOptions);
  assert.ok(info.errors.length > 0);
});
