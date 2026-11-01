// Trig, the first interface in std (INTERFACES.md, BACKLOG L40f): sin, cos,
// tan, exp and log at any type with an implementation. At Float64 they are
// the builtins (the prelude's `trig at float64`), reached directly once
// resolved: evaluated, compiled to JavaScript, and on the GPU.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { Lang } from "../src/lang/dsl.ts";
import { fillings, infer } from "../src/lang/infer.ts";
import { makeRunner, type Value } from "../src/lang/run.ts";
import { base, baseNames, checkOptions } from "../src/lang/load.ts";
import { LIBRARY } from "../src/lang/library.ts";
import { ARITH, S, TRIG_OPS } from "../src/lang/std.ts";
import { B } from "../src/prelude.ts";
import { showIn } from "../src/lang/types.ts";
import type { Id } from "../src/model.ts";
import { compile } from "../../compiler/src/compile.ts";

const runtime = pathToFileURL(join(import.meta.dirname, "../../compiler/src/runtime.js")).href;

function program() {
  const k = new Lang(LIBRARY.code);
  const def = (name: string, body: () => Id) => { const d = k.def(name); k.define(d, body()); return d; };
  const wave = def("wave", () => k.fn(["x"], (x) => k.call(ARITH.mul, k.call(TRIG_OPS.sin, x), k.call(TRIG_OPS.cos, x))));
  def("a wave", () => k.call(wave, k.lit(0.5)));
  def("back to 2", () => k.call(TRIG_OPS.exp, k.call(TRIG_OPS.log, k.lit(2))));
  def("tan of 1", () => k.call(TRIG_OPS.tan, k.lit(1)));
  // d/dx sin(x) · cos(x) = cos 2x, so 1 at 0.
  def("slope of the wave", () => k.call(k.call(S.derivative, k.x(wave)), k.lit(0)));
  const hole = k.hole();
  def("to fill", () => k.call(hole, k.lit(1)));
  const code = base(k.code), names = baseNames(k.names);
  return { code, names, info: infer(code, names, undefined, checkOptions), wave, hole };
}
const NAMES = ["a wave", "back to 2", "tan of 1", "slope of the wave"];

test("sin, cos, tan, exp and log at Float64 are the builtins, evaluated and compiled", async () => {
  const p = program();
  assert.deepEqual(p.info.errors.filter((e) => e.id !== p.hole).map((e) => e.message), []);
  assert.equal(showIn(p.info.schemes.get(p.wave)!.type, p.names, p.info.subst), "(a) -> a where a is a Number, and a has Trig");
  const r = makeRunner(p.code, p.info, { print: () => {} });
  const at = (n: string) => p.code.defs.find((d) => p.names[d] === n)!;
  const evaluated = NAMES.map((n) => r.value(at(n)));
  const compiledNames = NAMES.filter((n) => n !== "slope of the wave"); // derivatives are the evaluator's (derive.ts)
  assert.deepEqual(evaluated, [Math.sin(0.5) * Math.cos(0.5), Math.exp(Math.log(2)), Math.tan(1), 1]);
  const clean = { ...p.info, errors: [] };
  const path = join(mkdtempSync(join(tmpdir(), "trig-")), "trig.js");
  writeFileSync(path, compile(p.code, clean, p.names, { runtime, exports: compiledNames }));
  const defs = (await import(pathToFileURL(path).href)).defs as Record<string, unknown>;
  assert.deepEqual(compiledNames.map((n) => (typeof defs[n] === "function" ? (defs[n] as () => Value)() : defs[n])), evaluated.slice(0, compiledNames.length));
});

test("the palette offers Trig's sin, not Float64's own", () => {
  const p = program();
  const offered = fillings(p.code, p.info, p.hole).flatMap((f) => (f.kind === "ref" ? [f.target] : []));
  assert.ok(offered.includes(TRIG_OPS.sin));
  assert.ok(!offered.includes(B.sin));
});

test("on the GPU, sin of a generic definition is WGSL's sin", async () => {
  const { lowerScalar } = await import("../../compiler/src/scalar.ts");
  const { emitWgsl } = await import("../../compiler/src/wgsl.ts");
  const p = program();
  const low = lowerScalar(p.code, p.info, p.names, [p.wave], { records: true });
  assert.deepEqual([...low.refused.keys()], []);
  assert.match(emitWgsl(low).wgsl, /sin\(p0\) \* cos\(p0\)/);
});

test("sin(x) reads as a call, not as a field read x.sin", async () => {
  const { renderBlocks } = await import("../src/lang/render.ts");
  const { readFileSync } = await import("node:fs");
  const { root } = await import("../src/io.ts");
  const p = program();
  const pres = { names: p.names, comments: {}, hints: {}, style: JSON.parse(readFileSync(join(root, "styles", "blocks.json"), "utf8")) };
  const text = renderBlocks(p.code, pres, p.info, p.wave);
  assert.match(text, /sin\(x\)/, text);
  assert.doesNotMatch(text, /x\.sin/, text);
});
