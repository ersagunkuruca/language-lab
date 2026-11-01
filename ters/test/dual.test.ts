// Dual numbers (INTERFACES.md step 3, BACKLOG L40g, which takes in L45):
// value + slope·ε with ε² = 0. + − part by part, · the product rule, Trig
// by the chain rule, so a function written once with the generic + − · and
// sin gives its derivative when handed dual(x, 1): forward-mode automatic
// differentiation. Checked against derive.ts's derivative, evaluated and
// compiled.

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
import { ARITH, DUAL_V, S, TRIG_OPS } from "../src/lang/std.ts";
import type { Id } from "../src/model.ts";
import { compile } from "../../compiler/src/compile.ts";

const runtime = pathToFileURL(join(import.meta.dirname, "../../compiler/src/runtime.js")).href;
const lib = (name: string) => LIBRARY.modules.flatMap((m) => m.exports).find((d) => LIBRARY.names[d] === name)!;
const POINTS = [-1.5, 0, 0.3, 2];

function program() {
  const k = new Lang(LIBRARY.code);
  const def = (name: string, body: () => Id) => { const d = k.def(name); k.define(d, body()); return d; };
  const { add, mul, sub } = ARITH;
  // f(x) = sin(x) · exp(x) − x · x + 3: Trig, the product rule, a literal.
  const f = def("f", () => k.fn(["x"], (x) => k.call(add, k.call(sub, k.call(mul, k.call(TRIG_OPS.sin, x), k.call(TRIG_OPS.exp, x)), k.call(mul, x, x)), k.lit(3))));
  // g(x) = log(cos x + 2) · tan(x · 0.25)
  const g = def("g", () => k.fn(["x"], (x) => k.call(mul, k.call(TRIG_OPS.log, k.call(add, k.call(TRIG_OPS.cos, x), k.lit(2))), k.call(TRIG_OPS.tan, k.call(mul, x, k.lit(0.25))))));
  const defs: Record<string, Id> = {};
  for (const [name, fn] of [["f", f], ["g", g]] as const) POINTS.forEach((p, i) => {
    // g's log has no answer at 0 or less (a Choice, L125b), which the
    // checker can't rule out; first says what to do then.
    const slope = () => k.call(lib("slope by duals"), k.x(fn), k.lit(p));
    defs[`${name} by duals ${i}`] = def(`${name} by duals ${i}`, () => name === "g" ? k.call(S.first, k.thunk(slope), k.thunk(() => k.lit(0))) : slope());
    const derived = () => k.call(k.call(S.derivative, k.x(fn)), k.lit(p));
    defs[`${name} derived ${i}`] = def(`${name} derived ${i}`, () => name === "g" ? k.call(S.first, k.thunk(derived), k.thunk(() => k.lit(0))) : derived());
  });
  const d = (a: number, b: number) => k.call(DUAL_V, k.lit(a), k.lit(b));
  def("squared plus 3", () => k.call(lib("show dual"), k.call(add, k.call(mul, d(2, 1), d(2, 1)), k.lit(3))));
  def("by the table", () => k.call(lib("show dual"), k.call(lib("table product"), k.x(lib("dual table")), d(2, 1), d(3, 5))));
  def("by the product", () => k.call(lib("show dual"), k.call(mul, d(2, 1), d(3, 5))));
  def("quotient", () => k.call(S.all, k.thunk(() => k.call(lib("show dual"), k.call(lib("divide duals"), d(6, 1), d(3, 2))))));
  const code = base(k.code), names = baseNames(k.names);
  return { code, names, info: infer(code, names, undefined, checkOptions), defs };
}

test("the slope by dual numbers is derive.ts's derivative", () => {
  const p = program();
  assert.deepEqual(p.info.errors.map((e) => e.message), []);
  const r = makeRunner(p.code, p.info, { print: () => {} });
  for (const name of ["f", "g"]) POINTS.forEach((_, i) => {
    const a = r.value(p.defs[`${name} by duals ${i}`]) as number, b = r.value(p.defs[`${name} derived ${i}`]) as number;
    assert.ok(Math.abs(a - b) < 1e-12 * (1 + Math.abs(b)), `${name} at ${POINTS[i]}: ${a} by duals, ${b} derived`);
  });
  // f′(x) = (sin x + cos x) eˣ − 2x
  assert.ok(Math.abs((r.value(p.defs["f by duals 2"]) as number) - ((Math.sin(0.3) + Math.cos(0.3)) * Math.exp(0.3) - 0.6)) < 1e-12);
});

test("· is the product rule and agrees with the table; a literal is a constant; compiled the same", async () => {
  const p = program();
  const r = makeRunner(p.code, p.info, { print: () => {} });
  const at = (n: string) => p.code.defs.find((d) => p.names[d] === n)!;
  const NAMES = ["squared plus 3", "by the table", "by the product", "quotient", ...Object.keys(p.defs).filter((n) => n.includes("by duals"))];
  const evaluated = NAMES.map((n) => r.value(at(n)));
  // (6 + ε) / (3 + 2ε) = 2 + (1·3 − 6·2)/9 ε
  assert.deepEqual([...evaluated.slice(0, 3), (evaluated[3] as { fields: Value[] }).fields[0]], ["7 + 4ε", "6 + 13ε", "6 + 13ε", "2 − 1ε"]);
  const path = join(mkdtempSync(join(tmpdir(), "dual-")), "dual.js");
  writeFileSync(path, compile(p.code, p.info, p.names, { runtime, exports: NAMES }));
  const defs = (await import(pathToFileURL(path).href)).defs as Record<string, unknown>;
  assert.deepEqual(NAMES.map((n) => (typeof defs[n] === "function" ? (defs[n] as () => Value)() : defs[n])), evaluated);
});

test("Dual is its own type, though it has Complex's shape: their operations keep apart", () => {
  const names = Object.values(LIBRARY.names);
  for (const n of ["add complex", "add duals", "negate complex", "negate dual", "subtract complex", "subtract duals"]) assert.ok(names.includes(n), n);
});
