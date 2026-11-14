import { test } from "node:test";
import assert from "node:assert/strict";
import { Lang } from "../src/lang/dsl.ts";
import { base, baseNames, checkOptions } from "../src/lang/load.ts";
import { infer } from "../src/lang/infer.ts";
import { ARITH } from "../src/lang/std.ts";

// A rewrite of a checked program changes no units, so its re-check skips
// them (I261: trek's 400-fix file spent 5.9 s re-checking units). With
// `units: false` the check reports every other problem and no unit
// conflict; without it a unit conflict is a type error as before.
test("units: false skips only the unit check", () => {
  const k = new Lang();
  const lit = (value: number, unit: Record<string, number>) => { const l = k.lit(value); (k.code.nodes[l] as { unit?: object }).unit = unit; return l; };
  const mixed = k.def("mixed");
  k.define(mixed, k.fn(["x"], () => k.call(ARITH.add, lit(3, { m: 1 }), lit(2, { s: 1 }))));
  const wrong = k.def("wrong");
  k.define(wrong, k.fn(["x"], () => k.call(ARITH.add, k.lit(1.5), k.lit("one"))));
  const code = base(k.code), names = baseNames(k.names);
  const checked = infer(code, names, undefined, checkOptions).errors.map((e) => e.message);
  const skipped = infer(code, names, undefined, { ...checkOptions, units: false }).errors.map((e) => e.message);
  const units = checked.filter((m) => /units don't agree/.test(m));
  assert.equal(units.length, 1, checked.join("\n"));
  assert.ok(skipped.length > 0, "the type error is still reported");
  assert.deepEqual(skipped, checked.filter((m) => !units.includes(m)));
});
