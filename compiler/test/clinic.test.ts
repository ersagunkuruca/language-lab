// clinic (compiler/gaps/clinic), GAPS.md round 10's program: a walk-in
// clinic simulated a minute at a time from an event heap. The evaluator,
// the compiled module and the hand-written ideal must print the same report.

import { test } from "node:test";
import assert from "node:assert/strict";
import { ways } from "../gaps/clinic.ts";

test("clinic: a day of 8 hours prints the same report three ways, and the csv has a row per patient", () => {
  const want = ways.ideal(8);
  assert.equal(want.out[0], "4 desks, urgency first, least busy, seed 7");
  for (const way of ["evaluator", "compiled"] as const) {
    const r = ways[way](8);
    assert.deepEqual(r.out, want.out, way);
    assert.equal(r.csv?.split("\n").length, 1 + Number(/Patients (\d+)/.exec(want.out[1])![1]), way);
  }
});

test("clinic: 40 hours, compiled and by hand", () => {
  assert.deepEqual(ways.compiled(40).out, ways.ideal(40).out);
});
