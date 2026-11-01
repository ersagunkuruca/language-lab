// A solve of a definition with results, in the direction it declares,
// compiles to a call per result it binds (C55, results.ts): a Dual's
// unpolar is two plain functions instead of the relational interpreter,
// and binding only the angle computes no length.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { Id } from "../../ters/src/model.ts";
import { Lang } from "../../ters/src/lang/dsl.ts";
import { LIBRARY } from "../../ters/src/lang/library.ts";
import { base, baseNames, checkOptions } from "../../ters/src/lang/load.ts";
import { infer } from "../../ters/src/lang/infer.ts";
import { makeRunner } from "../../ters/src/lang/run.ts";
import { DUAL_V, FIXED_V, SHOW_ANY, TRIG_UNPOLAR } from "../../ters/src/lang/std.ts";
import { compile } from "../src/compile.ts";

const runtime = pathToFileURL(join(import.meta.dirname, "../src/runtime.js")).href;

test("a direction the relational interpreter ran is a call per bound result, evaluated and compiled the same", async () => {
  const k = new Lang(LIBRARY.code);
  const def = (name: string, body: () => Id) => { const d = k.def(name); k.define(d, body()); return d; };
  const D = (a: Id, b: number) => k.call(DUAL_V, a, k.lit(b));
  // Both results, and the angle alone, of a Dual's unpolar.
  def("both", () => k.fn(["a"], (a) => k.solve(TRIG_UNPOLAR, { 2: D(a, 1), 3: D(k.lit(4), 0), out: k.true }, { 0: "length", 1: "angle" }, ({ 0: r, 1: t }) =>
    k.text(k.call(SHOW_ANY, r), k.lit(" "), k.call(SHOW_ANY, t)))));
  def("angle alone", () => k.fn(["a"], (a) => k.solve(TRIG_UNPOLAR, { 2: D(a, 1), 3: D(k.lit(4), 0), out: k.true }, { 1: "angle" }, ({ 1: t }) => k.call(SHOW_ANY, t))));
  const code = base(k.code), names = baseNames(k.names), info = infer(code, names, undefined, checkOptions);
  assert.deepEqual(info.errors.map((e) => e.message), []);
  const js = compile(code, info, names, { runtime, exports: ["both", "angle alone"] });
  assert.doesNotMatch(js, /relational interpreter/);
  assert.match(js, /dual_unpolar_s_length_and_angle\(/);
  // The angle alone calls only the angle's function.
  const alone = /function angle_alone\([^)]*\) \{[\s\S]*?\n\}/.exec(js)![0];
  assert.match(alone, /dual_unpolar_s_angle\(/);
  assert.doesNotMatch(alone, /dual_unpolar_s_length/);
  const path = join(mkdtempSync(join(tmpdir(), "results-")), "results.js");
  writeFileSync(path, js);
  const out = (await import(pathToFileURL(path).href)).defs as Record<string, (x: number) => unknown>;
  const r = makeRunner(code, info, { print: () => {}, names });
  const at = (n: string) => code.defs.find((d) => names[d] === n)!;
  for (const a of [3, -2, 0.5]) for (const n of ["both", "angle alone"]) {
    const ev = r.call(r.value(at(n)), a as never);
    assert.deepEqual(out[n](a), [...(ev as Iterable<unknown>)][0] ?? ev, `${n}(${a})`);
  }
});

// C55b: both results bound are given by one function that does their
// shared work once. A Fixed's unpolar runs CORDIC's vectoring once, not
// once for the length and again for the angle; a Dual's takes its inputs
// apart once.
test("results bound together share their work, and give what the evaluator gives", async () => {
  const k = new Lang(LIBRARY.code);
  const def = (name: string, body: () => Id) => { const d = k.def(name); k.define(d, body()); return d; };
  const X = (a: Id) => k.call(FIXED_V, a);
  def("fixed both", () => k.fn(["a", "b"], (a, b) => k.solve(TRIG_UNPOLAR, { 2: X(a), 3: X(b), out: k.true }, { 0: "length", 1: "angle" }, ({ 0: r, 1: t }) =>
    k.text(k.call(SHOW_ANY, r), k.lit(" "), k.call(SHOW_ANY, t)))));
  const D = (a: Id, b: number) => k.call(DUAL_V, a, k.lit(b));
  def("dual both", () => k.fn(["a", "b"], (a, b) => k.solve(TRIG_UNPOLAR, { 2: D(a, 1), 3: D(b, 0), out: k.true }, { 0: "length", 1: "angle" }, ({ 0: r, 1: t }) =>
    k.text(k.call(SHOW_ANY, r), k.lit(" "), k.call(SHOW_ANY, t)))));
  const code = base(k.code), names = baseNames(k.names), info = infer(code, names, undefined, checkOptions);
  assert.deepEqual(info.errors.map((e) => e.message), []);
  const js = compile(code, info, names, { runtime, exports: ["fixed both", "dual both"] });
  for (const [n, f] of [["fixed both", "fixed_unpolar_s_length_and_angle"], ["dual both", "dual_unpolar_s_length_and_angle"]]) {
    const body = new RegExp(`function ${n.replace(" ", "_")}\\([^)]*\\) \\{[\\s\\S]*?\\n\\}`).exec(js)![0];
    assert.match(body, new RegExp(`${f}\\(`), n);
    assert.doesNotMatch(body, /unpolar_s_(length|angle)\(/, n);
  }
  // CORDIC's vectoring is called from one place per half-plane case only.
  const fused = new RegExp(`function fixed_unpolar_s_length_and_angle\\([^)]*\\) \\{[\\s\\S]*?\\n\\}`).exec(js)![0];
  assert.equal(fused.match(/cordic_vector\(/g)?.length, 3);
  const path = join(mkdtempSync(join(tmpdir(), "results-")), "both.js");
  writeFileSync(path, js);
  const out = (await import(pathToFileURL(path).href)).defs as Record<string, (x: number, y: number) => unknown>;
  const r = makeRunner(code, info, { print: () => {}, names });
  const at = (n: string) => code.defs.find((d) => names[d] === n)!;
  for (const n of ["fixed both", "dual both"]) for (const [a, b] of [[3, 4], [-2, 1], [-1, -1], [0, 0], [1, -3]]) {
    const ev = r.call(r.value(at(n)), (n === "fixed both" ? Math.round(a * 2 ** 32) : a) as never, (n === "fixed both" ? Math.round(b * 2 ** 32) : b) as never);
    const want = [...(ev as Iterable<unknown>)][0] ?? ev;
    assert.deepEqual(out[n](n === "fixed both" ? Math.round(a * 2 ** 32) : a, n === "fixed both" ? Math.round(b * 2 ** 32) : b), want, `${n}(${a}, ${b})`);
  }
});
