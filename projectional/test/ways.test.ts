// Ways (WAYS.md step 1, BACKLOG L96): an implementation may leave a field
// `by its ways`, and the compiler puts in the cheapest way that ends in a
// field it gives. The prelude's sin and cos ways are a cycle (cos by sin,
// sin by cos), so giving either is enough, and giving neither is an error
// that says so. Evaluated and compiled the same.

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
import { S, SHOW_ANY, TRIG_OPS, TRIG_V } from "../src/lang/std.ts";
import { B } from "../src/prelude.ts";
import { NUMBER } from "../src/lang/types.ts";
import type { Id } from "../src/model.ts";
import { compile } from "../../compiler/src/compile.ts";

const runtime = pathToFileURL(join(import.meta.dirname, "../../compiler/src/runtime.js")).href;

// An angle of the program's own, a record of one Float64: + − part by
// part, and Trig that gives only one of sin and cos.
function program(gives: "sin" | "cos" | "neither") {
  const k = new Lang(LIBRARY.code);
  const def = (name: string, body: () => Id) => { const d = k.def(name); k.define(d, body()); return d; };
  const A = k.type("Angle", [], [["angle", [["radians", () => k.tref(NUMBER)]]]]);
  const lift = (name: string, f: Id) => def(name, () => k.fn(["a"], (a) => k.match(a, [{ variant: A.v.angle, names: ["r"], body: ([r]) => k.call(A.v.angle, k.call(f, r)) }])));
  const [sin, cos, tan, exp, log] = (["sin", "cos", "tan", "exp", "log"] as const).map((op) => lift(`angle ${op}`, B[op]));
  const left = () => k.x(S.byItsWays);
  def("trig at angle", () => k.call(TRIG_V, gives === "sin" ? k.x(sin) : left(), gives === "cos" ? k.x(cos) : left(), k.x(tan), k.x(exp), k.x(log)));
  const at = (x: number) => k.call(A.v.angle, k.lit(x));
  def("the cosine", () => k.call(SHOW_ANY, k.call(TRIG_OPS.cos, at(0.3))));
  def("the sine", () => k.call(SHOW_ANY, k.call(TRIG_OPS.sin, at(0.3))));
  const code = base(k.code), names = baseNames(k.names);
  return { code, names, info: infer(code, names, undefined, checkOptions) };
}
const NAMES = ["the cosine", "the sine"];
const near = (shown: Value, want: number) => assert.ok(Math.abs(Number(/angle\((.*)\)/.exec(String(shown))![1]) - want) < 1e-8, `${shown} is not angle(${want})`);

for (const gives of ["sin", "cos"] as const) test(`Trig giving only ${gives}: the other comes from its way, evaluated and compiled`, async () => {
  const p = program(gives);
  assert.deepEqual(p.info.errors.map((e) => e.message), []);
  const at = (n: string) => p.code.defs.find((d) => p.names[d] === n)!;
  const r = makeRunner(p.code, p.info, { print: () => {}, names: p.names });
  const evaluated = NAMES.map((n) => r.value(at(n)));
  near(evaluated[0], Math.cos(0.3));
  near(evaluated[1], Math.sin(0.3));
  const path = join(mkdtempSync(join(tmpdir(), "ways-")), "ways.js");
  writeFileSync(path, compile(p.code, p.info, p.names, { runtime, exports: NAMES }));
  const defs = (await import(pathToFileURL(path).href)).defs as Record<string, unknown>;
  assert.deepEqual(NAMES.map((n) => (typeof defs[n] === "function" ? (defs[n] as () => Value)() : defs[n])), evaluated);
});

test("Trig leaving both sin and cos to their ways: nothing ends in given code, and the checker says so at the implementation (L96b)", () => {
  const p = program("neither");
  const impl = p.code.defs.find((d) => p.names[d] === "trig at angle")!;
  assert.deepEqual(p.info.errors.filter((e) => e.id === impl).map((e) => e.message),
    ["trig at angle leaves sin and cos to their ways, and none of them ends in a field it gives: give one of them, or a field their ways use"]);
  // Run anyway, it still stops where the use is resolved.
  assert.throws(() => makeRunner(p.code, p.info, { print: () => {}, names: p.names }).value(p.code.defs.find((d) => p.names[d] === "the cosine")!), /leaves cos to its ways, and none of them ends in a field it gives/);
});
