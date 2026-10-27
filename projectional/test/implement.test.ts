import { test } from "node:test";
import assert from "node:assert/strict";
import { Lang } from "../src/lang/dsl.ts";
import { LIBRARY } from "../src/lang/library.ts";
import { base, baseNames } from "../src/lang/load.ts";
import { TRIG, TRIG_OPS } from "../src/lang/std.ts";
import { NUMBER, showIn } from "../src/lang/types.ts";
import type { Id, NodeOf } from "../src/model.ts";
import { fillValue, implement, implementable, infer, interfaces, setProgramPins } from "../editor/typed.ts";
import { B } from "../src/prelude.ts";
import { addOperation, newDefinition } from "../src/lang/toplevel.ts";

// Writing an implementation in the editor (BACKLOG E137, INTERFACES.md step
// 5): a type that has no Trig gets one, a definition of Trig's record at it
// with a hole for each operation, pinned so each hole wants that operation
// at that type.
test("implement for a type makes the record with a hole per operation, typed at that type", () => {
  const k = new Lang(LIBRARY.code);
  const num = () => k.tref(NUMBER);
  const W = k.type("Wave", [], [["wave", [["height", num]]]]);
  const d = k.def("ripple");
  k.define(d, k.call(TRIG_OPS.sin, k.call(W.v.wave, k.lit(1))));
  const code = base(k.code), names = baseNames(k.names);
  const before = infer(code, names);
  const missing = before.errors.find((e) => e.missing)?.missing;
  assert.deepEqual(missing && { iface: missing.iface, type: showIn(missing.type, names, before.subst) }, { iface: TRIG, type: "Wave" });
  assert.ok(implementable(code, before, TRIG).includes(W.def));
  assert.ok(!implementable(code, before, TRIG).includes(NUMBER), "Float64 has Trig already");
  const r = implement(code, names, before, TRIG, missing!.type);
  assert.ok(r.ok, !r.ok ? r.reason : "");
  if (!r.ok) return;
  const def = r.code.defs.at(-1)!;
  assert.equal(r.names[def], "trig at wave");
  setProgramPins(r.pin!);
  const after = infer(r.code, { ...names, ...r.names });
  setProgramPins({});
  const body = r.code.nodes[(r.code.nodes[def] as NodeOf<"def">).body!] as NodeOf<"call">;
  assert.equal(body.args.length, 5);
  for (const hole of body.args) assert.equal(showIn(after.holes.get(hole)!.expected, names, after.subst), "(Wave) -> Wave");
  // Nothing is missing now, the holes are what's left, and a second one is
  // refused (one implementation per interface and type).
  assert.equal(after.errors.filter((e) => e.missing).length, 0);
  assert.ok(!implementable(r.code, after, TRIG).includes(W.def));
  assert.equal(implement(r.code, r.names, after, TRIG, missing!.type).ok, false);
});

// A new interface (BACKLOG E138): one operation from a to a; another added
// with two inputs gives every implementation a hole for it.
test("a new interface, an operation added, and its implementation's new hole", () => {
  const k = new Lang(LIBRARY.code);
  k.type("Wave", [], [["wave", [["height", () => k.tref(NUMBER)]]]]);
  const code = base(k.code), names = baseNames(k.names);
  const made = newDefinition(code, names, "Halving", { kind: "interface", firstOperation: "half" });
  assert.ok(made.ok, !made.ok ? made.reason : "");
  if (!made.ok) return;
  const iface = made.code.defs.at(-1)!;
  assert.ok(interfaces(made.code).includes(iface));
  const info = infer(made.code, made.names);
  assert.deepEqual(info.errors, []);
  const wave = made.code.defs.find((d) => made.names[d] === "Wave")!;
  const r = implement(made.code, made.names, info, iface, { t: "con", id: wave, args: [] });
  assert.ok(r.ok);
  if (!r.ok) return;
  const more = addOperation(r.code, r.names, iface, "same", 2, null);
  assert.ok(more.ok, !more.ok ? more.reason : "");
  if (!more.ok) return;
  assert.match(more.note, /1 implementation got a hole for it/);
  setProgramPins(r.pin!);
  const after = infer(more.code, more.names);
  setProgramPins({});
  const holes = [...after.holes.values()].map((h) => showIn(h.expected, more.names, after.subst));
  assert.deepEqual(holes, ["(Wave) -> Wave", "(Wave, Wave) -> Wave"]);
});

// Typing a call of an interface's operation (BACKLOG E139): double(x) is
// Doubling's double, and twice(x) is Twice's operation, not its record's
// constructor of the same name.
test("typed text calls an interface's operation", () => {
  const k = new Lang(LIBRARY.code);
  const fn1 = (a: Id) => k.tfun([k.tref(a)], k.tref(a));
  const D = k.interface("Doubling", "a", [["double", fn1]]);
  const T2 = k.interface("Twice", "a", [["twice", fn1]]);
  const at = (name: string, v: Id) => { const d = k.def(name); k.define(d, k.call(v, k.fn(["x"], (x) => k.call(B.add, x, x)))); };
  at("doubling at float64", D.v);
  at("twice at float64", T2.v);
  const four = k.def("four times");
  let hole = "";
  k.define(four, k.fn(["x"], () => (hole = k.hole())));
  const code = base(k.code), names = baseNames(k.names);
  const info = infer(code, names);
  assert.deepEqual(info.errors, []);
  for (const [text, op] of [["double(double(x))", D.op.double], ["twice(x)", T2.op.twice]] as const) {
    const r = fillValue(code, names, info, hole, text, four);
    assert.ok(r.ok, !r.ok ? r.reason : "");
    if (!r.ok) return;
    const call = r.code.nodes[hole] as NodeOf<"call">;
    assert.equal((r.code.nodes[call.fn] as NodeOf<"ref">).target, op, text);
  }
});
