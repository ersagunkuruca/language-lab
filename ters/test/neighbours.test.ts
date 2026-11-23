// neighbours (L280g, docs/design/data/NEARBY-2026-11-22.md): each item's
// neighbours, the positions of the others within reach of its place,
// smallest first, every pair compared; places any record of Float64s.
// Evaluated and compiled the same, each on its grid and every pair.

import { test } from "node:test";
import assert from "node:assert/strict";
import { Lang } from "../src/lang/dsl.ts";
import { infer } from "../src/lang/infer.ts";
import { makeRunner, type Value } from "../src/lang/run.ts";
import { base, baseNames, checkOptions } from "../src/lang/load.ts";
import { LIBRARY } from "../src/lang/library.ts";
import { SHOW_ANY } from "../src/lang/std.ts";
import { NUMBER } from "../src/lang/types.ts";
import type { Id } from "../src/model.ts";
import { compiledDefs, emitCoreJs, lowerCore } from "../../compiler/src/core-js.ts";

const lib = (name: string) => LIBRARY.modules.flatMap((m) => m.exports).find((d) => LIBRARY.names[d] === name)!;

function program() {
  const k = new Lang(LIBRARY.code);
  const def = (name: string, body: () => Id) => { const d = k.def(name); k.define(d, body()); return d; };
  const show = (x: Id) => k.call(SHOW_ANY, x);
  const P = k.type("Spot", [], [["spot", [["x", () => k.tref(NUMBER)], ["y", () => k.tref(NUMBER)]]]]);
  const spot = (x: number, y: number) => k.call(P.v.spot, k.lit(x), k.lit(y));
  // On a line: 3 apart is within 3 (≤), 6 isn't.
  def("on a line", () => show(k.call(lib("neighbours"), k.list(k.lit(0), k.lit(3), k.lit(4), k.lit(10)), k.fn(["x"], (x) => x), k.lit(3))));
  // In the plane, by the spot itself: (0, 0) and (3, 4) are 5 apart.
  def("in the plane", () => show(k.call(lib("neighbours"), k.list(spot(0, 0), spot(3, 4), spot(9, 9), spot(0, 5)), k.fn(["s"], (s) => s), k.lit(5))));
  def("none", () => show(k.call(lib("neighbours"), k.list(), k.fn(["x"], (x) => x), k.lit(1))));
  // Many, on a lattice so that many pairs are exactly reach apart: the
  // evaluator's grid (library/hosts.ts) and the compiled one (core-rt.ts)
  // against each other, and both against the definition's every pair.
  let seed = 5;
  const rand = (n: number) => (seed = (seed * 16807) % 2147483647) % n;
  def("many", () => show(k.call(lib("neighbours"), k.list(...Array.from({ length: 400 }, () => spot(rand(60) / 2, rand(60) / 2))), k.fn(["s"], (s) => s), k.lit(2.5))));
  const code = base(k.code), names = baseNames(k.names);
  return { code, names, info: infer(code, names, undefined, checkOptions) };
}
const NAMES = ["on a line", "in the plane", "none", "many"];

test("neighbours on a line and in the plane, within reach counted with ≤, evaluated and compiled the same, on grids and every pair", () => {
  const p = program();
  assert.deepEqual(p.info.errors.map((e) => e.message), []);
  const r = makeRunner(p.code, p.info, { print: () => {}, names: p.names });
  const at = (n: string) => p.code.defs.find((d) => p.names[d] === n)!;
  const evaluated = NAMES.map((n) => r.value(at(n)));
  assert.deepEqual(evaluated.slice(0, 3), ["[[1], [0, 2], [1], []]", "[[1, 3], [0, 3], [], [0, 1]]", "[]"]);
  const pairs = makeRunner(p.code, p.info, { print: () => {}, names: p.names, libraryHosts: false });
  assert.equal(evaluated[3], pairs.value(at("many")));
  // The compiled program finds them on a grid in its runtime.
  assert.match(emitCoreJs(lowerCore(p.code, p.info, p.names, [at("many")])).js, /R\.rt\("neighbours\.grid"\)/);
  const defs = compiledDefs(p.code, p.info, p.names, NAMES) as unknown as Record<string, unknown>;
  assert.deepEqual(NAMES.map((n) => (typeof defs[n] === "function" ? (defs[n] as () => Value)() : defs[n])), evaluated);
});
