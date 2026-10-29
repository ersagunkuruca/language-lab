// Trig's polar (POLAR.md step 3, BACKLOG L97c): an interface field with
// results, (length, angle) → x, y. A use is a solve of the field, resolved
// to what the type gives; a type that gives polar gets sin and cos from it,
// and one that gives sin and cos gets polar. Evaluated and compiled the same.

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
import { pickWays, waysIn } from "../src/lang/ways.ts";
import { S, SHOW_ANY, TRIG_OPS, TRIG_POLAR, TRIG_V } from "../src/lang/std.ts";
import { showType, NUMBER } from "../src/lang/types.ts";
import { B } from "../src/prelude.ts";
import type { Id } from "../src/model.ts";
import { compile } from "../../compiler/src/compile.ts";

const runtime = pathToFileURL(join(import.meta.dirname, "../../compiler/src/runtime.js")).href;

async function both(code: Parameters<typeof compile>[0], info: Parameters<typeof compile>[1], names: Record<Id, string>, defs: string[]) {
  const at = (n: string) => code.defs.find((d) => names[d] === n)!;
  const r = makeRunner(code, info, { print: () => {}, names });
  const evaluated = defs.map((n) => r.value(at(n)));
  const path = join(mkdtempSync(join(tmpdir(), "polar-")), "polar.js");
  writeFileSync(path, compile(code, info, names, { runtime, exports: defs }));
  const out = (await import(pathToFileURL(path).href)).defs as Record<string, unknown>;
  return { evaluated, compiled: defs.map((n) => (typeof out[n] === "function" ? (out[n] as () => Value)() : out[n])) };
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

test("a polar asked another way is an error that says the direction", () => {
  const k = new Lang(LIBRARY.code);
  const main = k.def("main");
  k.define(main, k.thunk(() => k.solve(TRIG_POLAR, { 2: k.lit(0), 3: k.lit(1), out: k.true }, { 0: "length", 1: "angle" }, ({ 0: r }) => r)));
  const code = base(k.code), names = baseNames(k.names), info = infer(code, names, undefined, checkOptions);
  assert.ok(info.errors.some((e) => e.message === "polar gives x, y from length, angle"), String(info.errors.map((e) => e.message)));
});

function angle(declare: boolean) {
  const k = new Lang(LIBRARY.code);
  const def = (name: string, body: () => Id) => { const d = k.def(name); k.define(d, body()); return d; };
  const A = k.type("Angle", [], [["angle", [["radians", () => k.tref(NUMBER)]]]]);
  const un = (a: Id, body: (r: Id) => Id) => k.match(a, [{ variant: A.v.angle, names: ["r"], body: ([r]) => body(r) }]);
  const lift = (name: string, f: Id) => def(name, () => k.fn(["a"], (a) => un(a, (r) => k.call(A.v.angle, k.call(f, r)))));
  const [tan, exp, log] = (["tan", "exp", "log"] as const).map((op) => lift(`angle ${op}`, B[op]));
  const rad = (a: Id) => k.call(A.f["angle.radians"], a);
  const polar = def("angle polar", () => k.fn(["length", "angle", "x", "y"], (l, t, x, y) =>
    k.and(k.equal(x, k.call(A.v.angle, k.call(B.mul, rad(l), k.call(B.cos, rad(t))))), k.equal(y, k.call(A.v.angle, k.call(B.mul, rad(l), k.call(B.sin, rad(t))))))));
  if (declare) k.results(polar, "x", "y");
  def("trig at angle", () => k.call(TRIG_V, k.x(S.byItsWays), k.x(S.byItsWays), k.x(tan), k.x(exp), k.x(log), k.x(polar)));
  const at = (x: number) => k.call(A.v.angle, k.lit(x));
  def("the cosine", () => k.call(SHOW_ANY, k.call(TRIG_OPS.cos, at(0.3))));
  def("the sine", () => k.call(SHOW_ANY, k.call(TRIG_OPS.sin, at(0.3))));
  const code = base(k.code), names = baseNames(k.names);
  return { code, names, info: infer(code, names, undefined, checkOptions) };
}

test("a type that gives only polar gets sin and cos from it", async () => {
  const { code, names, info } = angle(true);
  assert.deepEqual(info.errors.map((e) => e.message), []);
  const { evaluated, compiled } = await both(code, info, names, ["the cosine", "the sine"]);
  const num = (v: Value) => Number(/angle\((.*)\)/.exec(String(v))![1]);
  assert.ok(Math.abs(num(evaluated[0]) - Math.cos(0.3)) < 1e-9 && Math.abs(num(evaluated[1]) - Math.sin(0.3)) < 1e-9, String(evaluated));
  assert.deepEqual(compiled, evaluated);
});

test("polar is given by a definition with the same results", () => {
  const { info } = angle(false);
  assert.ok(info.errors.some((e) => e.message === "trig at angle gives polar as angle polar, which must name its results the way polar does: x, y from length, angle"), String(info.errors.map((e) => e.message)));
});

test("Dual and Fixed give sin and cos and get polar by them; Float64 gives all three", () => {
  const code = base(new Lang(LIBRARY.code).code), ways = waysIn(code);
  const pick = (impl: string) => {
    const d = code.defs.find((x) => LIBRARY.names[x] === impl)!;
    const body = code.nodes[(code.nodes[d] as { body: Id }).body] as { fn: Id; args: Id[] };
    const variant = code.nodes[(code.nodes[body.fn] as { target: Id }).target] as never as Parameters<typeof pickWays>[2];
    const w = pickWays(code, ways, variant, body.args).get(TRIG_POLAR);
    return w ? LIBRARY.names[w] : w;
  };
  assert.equal(pick("trig at dual"), "polar by sincos");
  assert.equal(pick("trig at fixed"), "polar by sincos");
  assert.equal(pick("trig at float64"), null);
});
