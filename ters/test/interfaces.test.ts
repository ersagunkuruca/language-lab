// Interfaces and implementations (INTERFACES.md, BACKLOG L40e): an
// interface is a record of functions over one type, its fields are its
// operations, and an implementation is a definition of the record at one
// type. Each use is resolved before running, so the resolved program calls
// the implementation directly: nothing is looked up while it runs. The
// same in the evaluator and compiled JS.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { Lang } from "../src/lang/dsl.ts";
import { infer } from "../src/lang/infer.ts";
import { resolveArithmetic } from "../src/lang/arith.ts";
import { makeRunner, type Value } from "../src/lang/run.ts";
import { base, baseNames, checkOptions } from "../src/lang/load.ts";
import { LIBRARY } from "../src/lang/library.ts";
import { SHOW_ANY } from "../src/lang/std.ts";
import { B } from "../src/prelude.ts";
import { NUMBER } from "../src/lang/types.ts";
import { subtree, type Id } from "../src/model.ts";
import { compile } from "../../compiler/src/compile.ts";

const runtime = pathToFileURL(join(import.meta.dirname, "../../compiler/src/runtime.js")).href;

// Halving a = halving(half: (a) -> a, twice: (a) -> a), at Float64 (written
// with functions in place, so arith.ts makes definitions of them) and at a
// pair of Float64s (written with definitions, so uses go straight to them).
function program(extra?: (k: Lang, h: ReturnType<typeof halving>, pair: Id) => void) {
  const k = new Lang(LIBRARY.code);
  const def = (name: string, body: () => Id) => { const d = k.def(name); k.define(d, body()); return d; };
  const h = halving(k);
  const num = () => k.tref(NUMBER);
  const P = k.type("Pair", [], [["pair", [["left", num], ["right", num]]]]);
  const pair = (a: Id, b: Id) => k.call(P.v.pair, a, b);
  const parts = (p: Id, f: (a: Id, b: Id) => Id) => k.match(p, [{ variant: P.v.pair, names: ["a", "b"], body: ([a, b]) => f(a, b) }]);
  const halfPair = def("half pair", () => k.fn(["p"], (p) => parts(p, (a, b) => pair(k.call(B.div, a, k.lit(2)), k.call(B.div, b, k.lit(2))))));
  const twicePair = def("twice pair", () => k.fn(["p"], (p) => parts(p, (a, b) => pair(k.call(B.mul, a, k.lit(2)), k.call(B.mul, b, k.lit(2))))));
  def("halving at pair", () => k.call(h.v, k.x(halfPair), k.x(twicePair)));
  def("halving at float64", () => k.call(h.v, k.fn(["x"], (x) => k.call(B.div, x, k.lit(2))), k.fn(["x"], (x) => k.call(B.mul, x, k.lit(2)))));
  // Written once, for any type with Halving.
  const quarter = def("quarter", () => k.fn(["x"], (x) => k.call(h.op.half, k.call(h.op.half, x))));
  const show = (x: Id) => k.call(SHOW_ANY, x);
  def("a quarter of 10", () => show(k.call(quarter, k.lit(10))));
  def("a quarter of a pair", () => show(k.call(quarter, pair(k.lit(8), k.lit(-4)))));
  def("back again", () => show(k.call(h.op.twice, k.call(h.op.twice, k.call(quarter, pair(k.lit(8), k.lit(-4)))))));
  // Used as a value, not called.
  def("halves", () => show(k.call(k.x(LIBRARY.code.defs.find((d) => LIBRARY.names[d] === "map")!), k.list(k.lit(1), k.lit(3)), k.x(h.op.half))));
  // Dynamic dispatch, asked for: the implementation passed as a value and
  // taken apart where it is used.
  const through = def("half through", () => k.fn(["how", "x"], (how, x) => k.match(how, [{ variant: h.v, names: ["half", "twice"], body: ([half]) => k.call(half, x) }])));
  def("passed along", () => show(k.call(through, k.x(at({ code: k.code, names: k.names }, "halving at float64")), k.lit(9))));
  extra?.(k, h, P.def);
  const code = base(k.code), names = baseNames(k.names);
  return { code, names, info: infer(code, names, undefined, checkOptions), quarter };
}
function halving(k: Lang) {
  return k.interface("Halving", "a", [["half", (a) => k.tfun([k.tref(a)], k.tref(a))], ["twice", (a) => k.tfun([k.tref(a)], k.tref(a))]]);
}
const NAMES = ["a quarter of 10", "a quarter of a pair", "back again", "halves", "passed along"];
const at = (p: { code: { defs: Id[] }; names: Record<Id, string> }, n: string) => p.code.defs.find((d) => p.names[d] === n)!;

test("one definition at two types, through their implementations, evaluated and compiled", async () => {
  const p = program();
  assert.deepEqual(p.info.errors.map((e) => e.message), []);
  const r = makeRunner(p.code, p.info, { print: () => {}, names: p.names });
  const evaluated = NAMES.map((n) => r.value(at(p, n)));
  assert.deepEqual(evaluated, ["2.5", "pair(2, -1)", "pair(8, -4)", "[0.5, 1.5]", "4.5"]);
  const path = join(mkdtempSync(join(tmpdir(), "interfaces-")), "interfaces.js");
  writeFileSync(path, compile(p.code, p.info, p.names, { runtime, exports: NAMES }));
  const defs = (await import(pathToFileURL(path).href)).defs as Record<string, unknown>;
  assert.deepEqual(NAMES.map((n) => (typeof defs[n] === "function" ? (defs[n] as () => Value)() : defs[n])), evaluated);
});

test("resolved, an operation is a direct call: no interface is left and no record is built", () => {
  const p = program();
  const r = resolveArithmetic(p.code, p.info, p.names);
  const ops = new Set(Object.values(p.code.nodes).filter((n) => n.kind === "field" && /^(half|twice)$/.test(p.names[n.id] ?? "")).map((n) => n.id));
  const variant = Object.values(p.code.nodes).find((n) => n.kind === "variant" && p.names[n.id] === "halving")!.id;
  // In what runs (everything but the implementations themselves), nothing
  // refers to the interface's operations or builds its record.
  const impls = new Set([at(p, "halving at pair"), at(p, "halving at float64")]);
  for (const d of r.code.defs) {
    if (impls.has(d)) continue;
    for (const id of subtree(r.code, d)) {
      const n = r.code.nodes[id];
      if (n?.kind === "ref") assert.ok(!ops.has(n.target) && n.target !== variant, `${r.names[d]} still goes through the interface`);
    }
  }
  // quarter at a pair calls `half pair` itself.
  const copy = r.code.defs.find((d) => r.names[d] === "quarter at Pair")!;
  assert.ok(copy, Object.values(r.names).filter((n) => n.startsWith("quarter")).join(", "));
  assert.ok(subtree(r.code, copy).some((id) => { const n = r.code.nodes[id]; return n.kind === "ref" && n.target === at(p, "half pair"); }));
});

test("a type with no implementation is an error at the use, and so is a second one", () => {
  const missing = program((k, h) => { const d = k.def("int quarter"); k.define(d, k.call(h.op.half, k.int(4))); });
  const use = at(missing, "int quarter");
  assert.deepEqual(missing.info.errors.filter((e) => subtree(missing.code, use).includes(e.id)).map((e) => e.message), ["Int has no Halving: give it one, a definition of type Halving Int"]);
  // Through a generic definition too: the use of quarter is where Int came in.
  const through = program((k) => { const d = k.def("int quarter"); k.define(d, k.call(at({ code: k.code, names: k.names }, "quarter"), k.int(4))); });
  assert.match(through.info.errors.map((e) => e.message).join("; "), /Int has no Halving/);
  const twice = program((k, h) => {
    const d = k.def("halving again");
    // Float64's · makes it Halving Float64: a second one.
    k.define(d, k.call(h.v, k.fn(["x"], (x) => k.call(B.add, x, k.lit(0))), k.fn(["x"], (x) => x)));
  });
  assert.deepEqual(twice.info.errors.map((e) => e.message), ["halving at float64 and halving again are both Halving Float64: a type has one implementation of an interface, so keep one"]);
});

test("a type says which interfaces it needs, and a pin keeps them", async () => {
  const { showIn } = await import("../src/lang/types.ts");
  const { pinsOf, showPin } = await import("../src/lang/signatures.ts");
  const p = program();
  assert.equal(showIn(p.info.schemes.get(p.quarter)!.type, p.names, p.info.subst), "(a) -> a where a has Halving");
  const pins = pinsOf(p.info, [p.quarter]);
  assert.equal(showPin(pins[p.quarter], p.names), "(a) -> a where a has Halving");
  const again = infer(p.code, p.names, undefined, { ...checkOptions, pins });
  assert.deepEqual(again.errors.map((e) => e.message), []);
  // A pin that doesn't say Halving doesn't fit a body that needs it.
  const { needs: _, ...without } = pins[p.quarter];
  const wrong = infer(p.code, p.names, undefined, { ...checkOptions, pins: { [p.quarter]: without } });
  assert.match(wrong.errors.map((e) => e.message).join("; "), /quarter is pinned to/);
});
