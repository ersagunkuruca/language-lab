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
import { makeRunner, runMain, type Value } from "../src/lang/run.ts";
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
  def("trig at angle", () => k.call(TRIG_V, gives === "sin" ? k.x(sin) : left(), gives === "cos" ? k.x(cos) : left(), k.x(tan), k.x(exp), k.x(log), left()));
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
    ["trig at angle leaves sin, cos and polar to their ways, and none of them ends in a field it gives: give one of them, or a field their ways use"]);
  // Run anyway, it still stops where the use is resolved.
  assert.throws(() => makeRunner(p.code, p.info, { print: () => {}, names: p.names }).value(p.code.defs.find((d) => p.names[d] === "the cosine")!), /leaves cos to its ways, and none of them ends in a field it gives/);
});

// Costs (WAYS.md step 2): a way's declared cost, a builtin's cost on a
// target, and a written field competing as one more way.
test("a written field is a way like any other: a target where cos costs more, or lacks it, takes cos by sin, and agrees", async () => {
  const { pickWays, waysIn } = await import("../src/lang/ways.ts");
  const { resolveArithmetic } = await import("../src/lang/arith.ts");
  const code = base(new Lang(LIBRARY.code).code);
  const trigF = code.defs.find((d) => LIBRARY.names[d] === "trig at float64")!;
  const body = code.nodes[(code.nodes[trigF] as { body: Id }).body] as { fn: Id; args: Id[] };
  const variant = code.nodes[(code.nodes[body.fn] as { target: Id }).target] as never as Parameters<typeof pickWays>[2];
  const ways = waysIn(code);
  const cosField = TRIG_OPS.cos, wayName = (w: Id | null | undefined) => (w ? LIBRARY.names[w] : w);
  // Target-neutral, every builtin costs 1 and a way at least 2: the written cos.
  assert.equal(wayName(pickWays(code, ways, variant, body.args).get(cosField)), null);
  // A target whose cos costs 5: the way (1, plus sin's 1) is cheaper.
  assert.equal(wayName(pickWays(code, ways, variant, body.args, (b) => (b === B.cos ? 5 : 1)).get(cosField)), "cos by sin");
  // A target without cos: the same way, and it's not an error.
  assert.equal(wayName(pickWays(code, ways, variant, body.args, (b) => (b === B.cos ? Infinity : 1)).get(cosField)), "cos by sin");
  // A program run both ways agrees: cos(0.3) and sin(0.3 + π/2).
  const k = new Lang(LIBRARY.code);
  const main = k.def("main");
  k.define(main, k.thunk(() => k.call(TRIG_OPS.cos, k.lit(0.3))));
  const pc = base(k.code), pn = baseNames(k.names), info = infer(pc, pn, undefined, checkOptions);
  const run = (costOf?: (b: Id) => number) => {
    const r = resolveArithmetic(pc, info, pn, costOf);
    return Number(runMain(r.code, r.info, main, { print: () => {}, names: r.names }));
  };
  const plain = run(), viaSin = run((b) => (b === B.cos ? 5 : 1));
  assert.ok(Math.abs(plain - Math.cos(0.3)) < 1e-12 && Math.abs(viaSin - plain) < 1e-12, `${plain} and ${viaSin}`);
});

test("a way's declared cost counts: a way costing 10 loses to the written field even where that builtin costs 5", async () => {
  const { pickWays, waysIn } = await import("../src/lang/ways.ts");
  const code = base(new Lang(LIBRARY.code).code);
  for (const n of Object.values(code.nodes)) if (n.kind === "def" && n.way) code.nodes[n.id] = { ...n, cost: 10 };
  const trigF = code.defs.find((d) => LIBRARY.names[d] === "trig at float64")!;
  const body = code.nodes[(code.nodes[trigF] as { body: Id }).body] as { fn: Id; args: Id[] };
  const variant = code.nodes[(code.nodes[body.fn] as { target: Id }).target] as never as Parameters<typeof pickWays>[2];
  assert.equal(pickWays(code, waysIn(code), variant, body.args, (b) => (b === B.cos ? 5 : 1)).get(TRIG_OPS.cos), null);
});
