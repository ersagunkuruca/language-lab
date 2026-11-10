// Trig's polar (POLAR.md step 3, BACKLOG L97c): an interface field with
// results, (length, angle) → x, y. A use is a solve of the field, resolved
// to what the type gives; a type that gives polar gets sin and cos from it,
// and one that gives sin and cos gets polar. Evaluated and compiled the same.

import { test } from "node:test";
import assert from "node:assert/strict";
import { Lang } from "../src/lang/dsl.ts";
import { infer } from "../src/lang/infer.ts";
import { makeRunner, type Value } from "../src/lang/run.ts";
import { base, baseNames, checkOptions } from "../src/lang/load.ts";
import { DUAL_V, LIBRARY, FIXED_V } from "../src/lang/library.ts";
import { pickWays, waysIn } from "../src/lang/ways.ts";
import { S, SHOW_ANY, TRIG_OPS, TRIG_ACOS, TRIG_ASIN, TRIG_POLAR, TRIG_UNPOLAR, TRIG_V, tupleVariant } from "../src/lang/std.ts";
import { showType, NUMBER, CHOICE } from "../src/lang/types.ts";
import { B } from "../src/prelude.ts";
import type { Id } from "../src/model.ts";
import { compiledDefs, plainValue } from "../../compiler/src/core-js.ts";
import type { Code } from "../src/model.ts";
import type { Info } from "../src/lang/infer.ts";


async function both(code: Code, info: Info, names: Record<Id, string>, defs: string[]) {
  const at = (n: string) => code.defs.find((d) => names[d] === n)!;
  const r = makeRunner(code, info, { print: () => {}, names });
  const evaluated = defs.map((n) => r.value(at(n)));
  // Why they aren't compiled through the core IR, where they aren't yet.
  let out: Record<string, () => unknown>;
  try { out = compiledDefs(code, info, names, defs); } catch (e) { return { evaluated, compiled: (e as Error).message }; }
  return { evaluated, compiled: defs.map((n) => plainValue(out[n]())) };
}

test("x, y = polar(2, 0.5) at Float64: one answer, no Choice, evaluated and compiled", async () => {
  const k = new Lang(LIBRARY.code);
  const main = k.def("main");
  k.define(main, k.solve(TRIG_POLAR, { 0: k.lit(2), 1: k.lit(0.5), out: k.true }, { 2: "x", 3: "y" }, ({ 2: x, 3: y }) =>
    k.text(k.call(SHOW_ANY, x), k.lit(" "), k.call(SHOW_ANY, y))));
  const code = base(k.code), names = baseNames(k.names), info = infer(code, names, undefined, checkOptions);
  assert.deepEqual(info.errors.map((e) => e.message), []);
  assert.equal(showType(info.typeOf.get(main)!, names), "Text");
  const { evaluated, compiled } = await both(code, info, names, ["main"]);
  const [x, y] = String(evaluated[0]).split(" ").map(Number);
  assert.ok(Math.abs(x - 2 * Math.cos(0.5)) < 1e-9 && Math.abs(y - 2 * Math.sin(0.5)) < 1e-9, String(evaluated));
  assert.deepEqual(compiled, evaluated);
});

test("length, angle = polar(x = 3, y = 4) is answered by the type's unpolar, evaluated and compiled", async () => {
  const k = new Lang(LIBRARY.code);
  const main = k.def("main");
  k.define(main, k.solve(TRIG_POLAR, { 2: k.lit(3), 3: k.lit(4), out: k.true }, { 0: "length", 1: "angle" }, ({ 0: r, 1: t }) =>
    k.text(k.call(SHOW_ANY, r), k.lit(" "), k.call(SHOW_ANY, t))));
  const code = base(k.code), names = baseNames(k.names), info = infer(code, names, undefined, checkOptions);
  assert.deepEqual(info.errors.map((e) => e.message), []);
  assert.equal(showType(info.typeOf.get(main)!, names), "Text");
  const { evaluated, compiled } = await both(code, info, names, ["main"]);
  const [r, t] = String(evaluated[0]).split(" ").map(Number);
  assert.ok(Math.abs(r - 5) < 1e-9 && Math.abs(t - Math.atan2(4, 3)) < 1e-9, String(evaluated));
  assert.deepEqual(compiled, evaluated);
});

test("a polar asked a way neither direction reads is an error that says the direction", () => {
  const k = new Lang(LIBRARY.code);
  const main = k.def("main");
  k.define(main, k.thunk(() => k.solve(TRIG_POLAR, { 0: k.lit(1), 2: k.lit(1), out: k.true }, { 1: "angle", 3: "y" }, ({ 1: t }) => t)));
  const code = base(k.code), names = baseNames(k.names), info = infer(code, names, undefined, checkOptions);
  assert.ok(info.errors.some((e) => e.message === "polar gives x, y from length, angle"), String(info.errors.map((e) => e.message)));
});

function angle(declare: boolean | "function", more?: (k: Lang, ctor: Id) => void) {
  const k = new Lang(LIBRARY.code);
  const def = (name: string, body: () => Id) => { const d = k.def(name); k.define(d, body()); return d; };
  const A = k.type("Angle", [], [["angle", [["radians", () => k.tref(NUMBER)]]]]);
  const un = (a: Id, body: (r: Id) => Id) => k.match(a, [{ variant: A.v.angle, names: ["r"], body: ([r]) => body(r) }]);
  const lift = (name: string, f: Id) => def(name, () => k.fn(["a"], (a) => un(a, (r) => k.call(A.v.angle, k.call(f, r)))));
  const [tan, exp, log] = (["tan", "exp", "log"] as const).map((op) => lift(`angle ${op}`, B[op]));
  const rad = (a: Id) => k.call(A.f["angle.radians"], a);
  const polar = declare === "function"
    // A plain function of polar's type (L128d4): (length, angle) → (x, y).
    ? def("angle polar", () => k.fn(["length", "angle"], (l, t) =>
      k.call(tupleVariant(2), k.call(A.v.angle, k.call(B.mul, rad(l), k.call(B.cos, rad(t)))), k.call(A.v.angle, k.call(B.mul, rad(l), k.call(B.sin, rad(t)))))))
    : def("angle polar", () => k.fn(["length", "angle", "x", "y"], (l, t, x, y) =>
      k.and(k.equal(x, k.call(A.v.angle, k.call(B.mul, rad(l), k.call(B.cos, rad(t))))), k.equal(y, k.call(A.v.angle, k.call(B.mul, rad(l), k.call(B.sin, rad(t))))))));
  if (declare === true) k.results(polar, "x", "y");
  const unpolar = def("angle unpolar", () => k.fn(["length", "angle", "x", "y"], (l, t, x, y) => k.and(
    k.equal(l, k.call(A.v.angle, k.call(B.sqrt, k.call(B.add, k.call(B.mul, rad(x), rad(x)), k.call(B.mul, rad(y), rad(y)))))),
    k.equal(t, k.call(A.v.angle, k.call(B.atan2, rad(y), rad(x)))))));
  k.results(unpolar, "length", "angle");
  def("trig at angle", () => k.call(TRIG_V, k.x(S.byItsWays), k.x(S.byItsWays), k.x(tan), k.x(exp), k.x(log), k.x(polar), k.x(unpolar), k.x(S.byItsWays), k.x(S.byItsWays)));
  const at = (x: number) => k.call(A.v.angle, k.lit(x));
  def("the cosine", () => k.call(SHOW_ANY, k.call(TRIG_OPS.cos, at(0.3))));
  def("the sine", () => k.call(SHOW_ANY, k.call(TRIG_OPS.sin, at(0.3))));
  more?.(k, A.v.angle);
  const code = base(k.code), names = baseNames(k.names);
  return { code, names, info: infer(code, names, undefined, checkOptions) };
}

test("a type that gives only polar gets sin and cos from it", async () => {
  const { code, names, info } = angle(true);
  assert.deepEqual(info.errors.map((e) => e.message), []);
  const { evaluated, compiled } = await both(code, info, names, ["the cosine", "the sine"]);
  const num = (v: Value) => Number(/angle\((.*)\)/.exec(String(v))![1]);
  assert.ok(Math.abs(num(evaluated[0]) - Math.cos(0.3)) < 1e-9 && Math.abs(num(evaluated[1]) - Math.sin(0.3)) < 1e-9, String(evaluated));
  // Compiled through the core IR, ways included (L120c): the same.
  assert.deepEqual(compiled, evaluated);
});

test("polar is given by any function of its type, (length, angle) → x, y: sin and cos come from it, evaluated and compiled (L128d4)", async () => {
  const { code, names, info } = angle("function");
  assert.deepEqual(info.errors.map((e) => e.message), []);
  const { evaluated, compiled } = await both(code, info, names, ["the cosine", "the sine"]);
  const num = (v: Value) => Number(/angle\((.*)\)/.exec(String(v))![1]);
  assert.ok(Math.abs(num(evaluated[0]) - Math.cos(0.3)) < 1e-9 && Math.abs(num(evaluated[1]) - Math.sin(0.3)) < 1e-9, String(evaluated));
  // Compiled through the core IR, ways included (L120c): the same.
  assert.deepEqual(compiled, evaluated);
});

test("polar is given by a definition with the same results", () => {
  const { info } = angle(false);
  // polar is the function (length, angle) → x, y (L128d3); a predicate
  // over the four ports that names no results isn't one.
  assert.ok(info.errors.some((e) => e.message === "trig needs (Angle, Angle) -> (Angle, Angle) here, got (Angle, Angle, Angle, Angle) -> Bool"), String(info.errors.map((e) => e.message)));
});

test("Dual gives sin and cos and gets polar by them; Fixed and Float64 give polar", () => {
  const code = base(new Lang(LIBRARY.code).code), ways = waysIn(code);
  const pick = (impl: string) => {
    const d = code.defs.find((x) => LIBRARY.names[x] === impl)!;
    const body = code.nodes[(code.nodes[d] as { body: Id }).body] as { fn: Id; args: Id[] };
    const variant = code.nodes[(code.nodes[body.fn] as { target: Id }).target] as never as Parameters<typeof pickWays>[2];
    const w = pickWays(code, ways, variant, body.args).get(TRIG_POLAR);
    return w ? LIBRARY.names[w] : w;
  };
  assert.equal(pick("trig at dual"), "polar by sincos");
  // Fixed gives polar by CORDIC's rotation (L97d), and its sin and cos come from it.
  assert.equal(pick("trig at fixed"), null);
  assert.equal(pick("trig at float64"), null);
});

// Unpolar (L97c2): the same ports, (x, y) → length, angle, given by each
// type: Float64 by atan2, Dual by the chain rule, Fixed by CORDIC's
// vectoring mode, all in Ints.
test("length, angle = unpolar(x, y) at Float64, Dual and Fixed, evaluated and compiled", async () => {
  const k = new Lang(LIBRARY.code);
  const def = (name: string, body: () => Id) => { const d = k.def(name); k.define(d, body()); return d; };
  const un = (x: Id, y: Id, f: (r: Id, t: Id) => Id) => k.solve(TRIG_UNPOLAR, { 0: x, 1: y, out: k.true }, { 2: "length", 3: "angle" }, ({ 2: r, 3: t }) => f(r, t));
  const both2 = (a: Id, b: Id) => k.text(k.call(SHOW_ANY, a), k.lit(" "), k.call(SHOW_ANY, b));
  def("at float64", () => un(k.lit(3), k.lit(4), both2));
  const D = (a: number, b: number) => k.call(DUAL_V, k.lit(a), k.lit(b));
  def("at dual", () => un(D(3, 1), D(4, 0), both2));
  const X = (v: number) => k.call(FIXED_V, k.int(Math.round(v * 2 ** 32)));
  const steps = (v: Id) => k.match(v, [{ variant: FIXED_V, names: ["steps"], body: ([st]) => k.call(SHOW_ANY, st) }]);
  def("at fixed", () => un(X(-3), X(4), (r, t) => k.text(steps(r), k.lit(" "), steps(t))));
  def("at fixed below", () => un(X(-3), X(-4), (r, t) => k.text(steps(r), k.lit(" "), steps(t))));
  const code = base(k.code), names = baseNames(k.names), info = infer(code, names, undefined, checkOptions);
  assert.deepEqual(info.errors.map((e) => e.message), []);
  const NAMES = ["at float64", "at dual", "at fixed", "at fixed below"];
  const { evaluated, compiled } = await both(code, info, names, NAMES);
  assert.deepEqual(compiled, evaluated);
  const near = (a: number, b: number, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} is not ${b}`);
  const [r, t] = String(evaluated[0]).split(" ").map(Number);
  near(r, 5); near(t, Math.atan2(4, 3));
  // dual(5, 3/5) and dual(atan2(4, 3), −4/25).
  const nums = String(evaluated[1]).match(/-?[\d.]+(e-?\d+)?/g)!.map(Number);
  near(nums[0], 5); near(nums[1], 0.6); near(nums[2], Math.atan2(4, 3)); near(nums[3], -0.16);
  for (const [i, y] of [[2, 4], [3, -4]] as const) {
    const [rs, ts] = String(evaluated[i]).split(" ").map((v) => Number(v) / 2 ** 32);
    near(rs, 5, 1e-6); near(ts, Math.atan2(y, -3), 1e-6);
  }
});

// asin and acos (L97c3): the angle off unpolar. Float64 and Fixed give
// them with their own square roots; Dual, and a type of the program's own,
// get them by their ways, √ as e^(½ log).
test("asin and acos through unpolar: Float64, Dual, Fixed and a type of the program's own, evaluated and compiled", async () => {
  const { code, names, info } = angle(true, (k, ctor) => {
  // asin and acos have no answer outside −1 to 1 (a Choice, L125b): first
  // says what to show then.
  const def = (name: string, body: () => Id) => { const d = k.def(name); k.define(d, k.call(S.first, k.thunk(body), k.thunk(() => k.lit("none")))); return d; };
  const show = (v: Id) => k.call(SHOW_ANY, v);
  def("at float64 asin", () => show(k.call(TRIG_ASIN, k.lit(0.5))));
  def("at float64 acos", () => show(k.call(TRIG_ACOS, k.lit(-0.25))));
  def("at dual asin", () => show(k.call(TRIG_ASIN, k.call(DUAL_V, k.lit(0.6), k.lit(1)))));
  const X = (v: number) => k.call(FIXED_V, k.int(Math.round(v * 2 ** 32)));
  const steps = (v: Id) => k.match(v, [{ variant: FIXED_V, names: ["steps"], body: ([st]) => k.call(SHOW_ANY, st) }]);
  def("at fixed asin one", () => steps(k.call(TRIG_ASIN, X(1))));
  def("at fixed acos", () => steps(k.call(TRIG_ACOS, X(0.5))));
  def("at angle asin", () => show(k.call(TRIG_ASIN, k.call(ctor, k.lit(0.5)))));
  });
  assert.deepEqual(info.errors.map((e) => e.message), []);
  const NAMES = ["at float64 asin", "at float64 acos", "at dual asin", "at fixed asin one", "at fixed acos", "at angle asin"];
  const { evaluated, compiled } = await both(code, info, names, NAMES);
  // Compiled through the core IR, ways included (L120c): the same.
  assert.deepEqual(compiled, evaluated);
  const near = (a: number, b: number, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} is not ${b}`);
  const nums = (v: Value) => String(v).match(/-?[\d.]+(e-?\d+)?/g)!.map(Number);
  near(Number(evaluated[0]), Math.asin(0.5));
  near(Number(evaluated[1]), Math.acos(-0.25));
  // asin′(s) = 1/√(1 − s²): 1.25 at 0.6.
  const [v, slope] = nums(evaluated[2]);
  near(v, Math.asin(0.6)); near(slope, 1.25, 1e-6);
  near(Number(evaluated[3]) / 2 ** 32, Math.PI / 2, 1e-8);
  near(Number(evaluated[4]) / 2 ** 32, Math.acos(0.5), 1e-6);
  near(nums(evaluated[5])[0], Math.asin(0.5), 1e-9);
});

// A program's own interface whose fields with results have ports of other
// types than its parameter (I180, examples/impact's Collider): gap is
// (body, at) → gap, touch the other way (body, gap) → at. The implementation
// answers with a literal, so its scheme is open; resolving it took every
// port at the interface's parameter, Ball, and 0.5 became a Ball.
test("a field with results over ports of several types, given by a definition answering a literal", async () => {
  const k = new Lang(LIBRARY.code);
  const num = () => k.tref(NUMBER);
  const Ball = k.type("Ball", [], [["ball", [["r", num]]]]);
  const I = k.interface("Toucher", "a", [
    ["gap", (a) => k.tfun([k.tref(a), k.tref(NUMBER)], k.tref(NUMBER))],
    ["touch", (a) => k.tfun([k.tref(a), k.tref(NUMBER)], k.tref(NUMBER), [CHOICE])],
  ]);
  // The port names are the field's function type's (L182c3).
  const typeOf = (f: Id) => k.code.nodes[(k.code.nodes[f] as { type: Id }).type] as { ports?: string[] };
  typeOf(I.op.gap).ports = ["body", "at", "gap"];
  typeOf(I.op.touch).ports = ["body", "gap", "at"];
  const def = (name: string, body: () => Id) => { const d = k.def(name); k.define(d, body()); return d; };
  const r = (b: Id) => k.call(Ball.f["ball.r"], b);
  const gap = def("ball gap", () => k.fn(["b", "s"], (b, s) => k.call(B.sub, r(b), s)));
  const touch = def("ball touch", () => k.fn(["b", "g"], (b, g) => k.if(k.call(S.less, g, r(b)), k.lit(0.5), k.call(S.fail))));
  def("ball toucher", () => k.call(I.v, k.x(gap), k.x(touch)));
  const ball = () => k.call(Ball.v.ball, k.lit(3));
  def("touch called", () => k.call(S.first, k.thunk(() => k.call(I.op.touch, ball(), k.lit(1))), k.thunk(() => k.lit(9))));
  def("touch solved", () => k.call(S.first, k.thunk(() => k.solve(I.op.gap, { 0: ball(), 2: k.lit(1), out: k.true }, { 1: "at" }, ({ 1: s }) => k.call(B.mul, s, k.lit(2)))), k.thunk(() => k.lit(9))));
  def("no touch", () => k.call(S.first, k.thunk(() => k.solve(I.op.gap, { 0: ball(), 2: k.lit(4), out: k.true }, { 1: "at" }, ({ 1: s }) => k.call(B.mul, s, k.lit(2)))), k.thunk(() => k.lit(9))));
  const code = base(k.code), names = baseNames(k.names), info = infer(code, names, undefined, checkOptions);
  assert.deepEqual(info.errors.map((e) => e.message), []);
  const { evaluated, compiled } = await both(code, info, names, ["touch called", "touch solved", "no touch"]);
  assert.deepEqual(evaluated, [0.5, 1, 9]);
  assert.deepEqual(compiled, evaluated);
});
