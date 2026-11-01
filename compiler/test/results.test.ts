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
import { DUAL_V, SHOW_ANY, TRIG_UNPOLAR } from "../../ters/src/lang/std.ts";
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
  assert.match(js, /dual_unpolar_s_length\(/);
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
