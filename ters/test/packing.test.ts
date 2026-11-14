// A value packed with what it has (L256, packing.ts, packs.ts): a data
// type whose case packs a value of any type with an interface, so a list
// holds lamps and heaters alike, and the type has the interface itself.
// Run as a record of closures, the same evaluated and compiled.

import { test } from "node:test";
import assert from "node:assert/strict";
import { Lang } from "../src/lang/dsl.ts";
import { infer } from "../src/lang/infer.ts";
import { resolveArithmetic } from "../src/lang/arith.ts";
import { makeRunner, type Value } from "../src/lang/run.ts";
import { base, baseNames, checkOptions } from "../src/lang/load.ts";
import { LIBRARY } from "../src/lang/library.ts";
import { SHOW_ANY } from "../src/lang/std.ts";
import { B } from "../src/prelude.ts";
import { NUMBER, INT } from "../src/lang/types.ts";
import type { Id } from "../src/model.ts";
import { compiledDefs } from "../../compiler/src/core-js.ts";

const lib = (n: string) => LIBRARY.code.defs.find((d) => LIBRARY.names[d] === n)!;

// Gauge a = gauge(reading: (a) -> Float64, later: (a, Int) -> a); a Tank
// fills by its rate each step, a Dial turns; Meter packs either.
function program(extra?: (k: Lang, g: { def: Id; v: Id; op: Record<string, Id> }, m: { def: Id; v: Id; f: Id }) => void) {
  const k = new Lang(LIBRARY.code);
  const def = (name: string, body: () => Id) => { const d = k.def(name); k.define(d, body()); return d; };
  const num = () => k.tref(NUMBER);
  const g = k.interface("Gauge", "a", [["reading", (a) => k.tfun([k.tref(a)], k.tref(NUMBER))], ["later", (a) => k.tfun([k.tref(a), k.tref(INT)], k.tref(a))]]);
  const Tank = k.type("Tank", [], [["tank", [["level", num], ["rate", num]]]]);
  const Dial = k.type("Dial", [], [["dial", [["angle", num]]]]);
  const tankReading = def("tank reading", () => k.fn(["t"], (t) => k.call(Tank.f["tank.level"], t)));
  const tankLater = def("tank later", () => k.fn(["t", "n"], (t) => k.call(Tank.v.tank, k.call(B.add, k.call(Tank.f["tank.level"], t), k.call(Tank.f["tank.rate"], t)), k.call(Tank.f["tank.rate"], t))));
  def("gauge at tank", () => k.call(g.v, k.x(tankReading), k.x(tankLater)));
  const dialReading = def("dial reading", () => k.fn(["d"], (d) => k.call(B.mul, k.call(Dial.f["dial.angle"], d), k.lit(10))));
  const dialLater = def("dial later", () => k.fn(["d", "n"], (d) => k.call(Dial.v.dial, k.call(B.add, k.call(Dial.f["dial.angle"], d), k.lit(1)))));
  def("gauge at dial", () => k.call(g.v, k.x(dialReading), k.x(dialLater)));
  const m = k.packing("Meter", "meter", "it", [g.def]);
  const meters = def("meters", () => k.list(k.call(m.v, k.call(Tank.v.tank, k.lit(1), k.lit(2))), k.call(m.v, k.call(Dial.v.dial, k.lit(3)))));
  const map = lib("map");
  const stepped = def("stepped", () => k.fn(["ms"], (ms) => k.call(map, ms, k.fn(["x"], (x) => k.call(g.op.later, x, k.int(1))))));
  const show = (x: Id) => k.call(SHOW_ANY, x);
  def("readings", () => show(k.call(map, k.call(stepped, k.call(stepped, k.x(meters))), k.x(g.op.reading))));
  // Taken apart: the packed value is used through what it has, and packed
  // again; and its field read.
  def("by a match", () => show(k.call(map, k.x(meters), k.fn(["x"], (x) => k.match(x, [{ variant: m.v, names: ["v"], body: ([v]) => k.call(g.op.reading, k.call(m.v, k.call(g.op.later, v, k.int(1)))) }])))));
  def("by its field", () => show(k.call(map, k.x(meters), k.fn(["x"], (x) => k.call(g.op.reading, k.call(m.f, x))))));
  extra?.(k, g, m);
  const code = base(k.code), names = baseNames(k.names);
  return { code, names, info: infer(code, names, undefined, checkOptions) };
}
const NAMES = ["readings", "by a match", "by its field"];
const at = (p: { code: { defs: Id[] }; names: Record<Id, string> }, n: string) => p.code.defs.find((d) => p.names[d] === n)!;

test("a list of two types packed with their Gauge, evaluated and compiled", () => {
  const p = program();
  assert.deepEqual(p.info.errors.map((e) => e.message), []);
  const r = makeRunner(p.code, p.info, { print: () => {}, names: p.names });
  const evaluated = NAMES.map((n) => r.value(at(p, n)));
  assert.deepEqual(evaluated, ["[5, 50]", "[3, 40]", "[1, 30]"]);
  const defs = compiledDefs(p.code, p.info, p.names, NAMES) as unknown as Record<string, unknown>;
  assert.deepEqual(NAMES.map((n) => (typeof defs[n] === "function" ? (defs[n] as () => Value)() : defs[n])), evaluated);
});

test("resolved, a packing type is a record of closures and nothing is left packed", () => {
  const p = program();
  const r = resolveArithmetic(p.code, p.info, p.names);
  assert.deepEqual(r.info.errors.map((e) => e.message), []);
  const meter = r.code.nodes[(r.code.nodes[at(p, "Meter")] as { body: Id }).body] as { variants: Id[] };
  const v = r.code.nodes[meter.variants[0]] as { fields: Id[]; params?: Id[] };
  assert.equal(v.params, undefined);
  assert.deepEqual(v.fields.map((f) => r.names[f]), ["reading", "later"]);
});

test("a packed value needs what its case says, and an operation it can't run is refused", () => {
  const p = program((k, g, m) => {
    const d = k.def("a number packed"); k.define(d, k.call(m.v, k.lit("text")));
  });
  assert.ok(p.info.errors.some((e) => /Text has no Gauge/.test(e.message)), p.info.errors.map((e) => e.message).join("\n"));
  const q = program((k) => {
    const two = k.interface("Merging", "a", [["merged", (a) => k.tfun([k.tref(a), k.tref(a)], k.tref(a))]]);
    k.packing("Mixed", "mixed", "it", [two.def]);
  });
  assert.ok(q.info.errors.some((e) => /Merging's merged can't be run on a packed value/.test(e.message)), q.info.errors.map((e) => e.message).join("\n"));
  const own = program((k, g, m) => {
    const d = k.def("gauge at meter"); k.define(d, k.call(g.v, k.fn(["x"], (x) => k.call(g.op.reading, k.call(m.f, x))), k.fn(["x", "n"], (x) => x)));
  });
  assert.ok(own.info.errors.some((e) => /Meter has Gauge already/.test(e.message)), own.info.errors.map((e) => e.message).join("\n"));
});
