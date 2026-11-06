// break (GAPS.md round 12): the core IR's module prints what the hand-written
// ideal prints, line for line, for main's three breaks. (The evaluator
// prints the same too, but takes about 40 s: bench-break.ts --evaluator.)
import { test } from "node:test";
import assert from "node:assert/strict";
import { ways } from "../gaps/break.ts";

test("break: the core IR's main prints what the ideal prints", () => {
  const w = ways();
  const ideal = w.ideal(), core = w.core();
  assert.ok(ideal.length > 150, `${ideal.length} lines`);
  assert.deepEqual(core, ideal);
});
