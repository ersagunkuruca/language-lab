// within reach (G15b, docs/design/targets/LIGHTS.md): the items whose
// place is within their own reach of here, in the list's order, counted
// with ≤ as neighbours counts; places any record of Float64s. Evaluated
// and compiled the same.

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
import { compiledDefs } from "../../compiler/src/core-js.ts";

const lib = (name: string) => LIBRARY.modules.flatMap((m) => m.exports).find((d) => LIBRARY.names[d] === name)!;

test("within reach: the lights that reach a place, in order, each by its own reach, evaluated and compiled the same", () => {
  const k = new Lang(LIBRARY.code);
  const def = (name: string, body: () => Id) => { const d = k.def(name); k.define(d, body()); return d; };
  const L = k.type("Light", [], [["light", [["x", () => k.tref(NUMBER)], ["y", () => k.tref(NUMBER)], ["reach", () => k.tref(NUMBER)]]]]);
  const P = k.type("Spot", [], [["spot", [["x", () => k.tref(NUMBER)], ["y", () => k.tref(NUMBER)]]]]);
  const light = (x: number, y: number, r: number) => k.call(L.v.light, k.lit(x), k.lit(y), k.lit(r));
  const at = (l: Id) => k.match(l, [{ variant: L.v.light, names: ["x", "y", "reach"], body: ([x, y]) => k.call(P.v.spot, x, y) }]);
  const reach = (l: Id) => k.match(l, [{ variant: L.v.light, names: ["x", "y", "reach"], body: ([, , r]) => r }]);
  const lights = () => k.list(light(0, 0, 5), light(3, 4, 1), light(10, 0, 2), light(0, 1, 1));
  const within = (here: Id) => k.call(SHOW_ANY, k.call(lib("within reach"), lights(), k.fn(["l"], at), k.fn(["l"], reach), here));
  // From (0, 0): the first (5 apart is within 5, ≤) and the last; the
  // second is 5 away with a reach of 1, the third 10 away.
  def("at the middle", () => within(k.call(P.v.spot, k.lit(0), k.lit(0))));
  def("at the second", () => within(k.call(P.v.spot, k.lit(3), k.lit(4))));
  def("far off", () => within(k.call(P.v.spot, k.lit(50), k.lit(50))));
  // On a line, places are Float64s.
  def("on a line", () => k.call(SHOW_ANY, k.call(lib("within reach"), k.list(k.lit(0), k.lit(2), k.lit(5)), k.fn(["x"], (x) => x), k.fn(["x"], () => k.lit(2)), k.lit(3))));
  const code = base(k.code), names = baseNames(k.names);
  const info = infer(code, names, undefined, checkOptions);
  assert.deepEqual(info.errors.map((e) => e.message), []);
  const NAMES = ["at the middle", "at the second", "far off", "on a line"];
  const r = makeRunner(code, info, { print: () => {}, names });
  const evaluated = NAMES.map((n) => r.value(code.defs.find((d) => names[d] === n)!));
  assert.deepEqual(evaluated, [
    "[light(0, 0, 5), light(0, 1, 1)]",
    "[light(0, 0, 5), light(3, 4, 1)]",
    "[]",
    "[2, 5]",
  ]);
  const defs = compiledDefs(code, info, names, NAMES) as unknown as Record<string, unknown>;
  assert.deepEqual(NAMES.map((n) => (typeof defs[n] === "function" ? (defs[n] as () => Value)() : defs[n])), evaluated);
});
