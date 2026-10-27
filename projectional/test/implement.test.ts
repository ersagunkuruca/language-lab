import { test } from "node:test";
import assert from "node:assert/strict";
import { Lang } from "../src/lang/dsl.ts";
import { LIBRARY } from "../src/lang/library.ts";
import { base, baseNames } from "../src/lang/load.ts";
import { TRIG, TRIG_OPS } from "../src/lang/std.ts";
import { NUMBER, showIn } from "../src/lang/types.ts";
import type { NodeOf } from "../src/model.ts";
import { implement, implementable, infer, setProgramPins } from "../editor/typed.ts";

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
