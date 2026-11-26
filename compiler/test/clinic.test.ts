// clinic (compiler/gaps/clinic), GAPS.md round 10's program: a walk-in
// clinic simulated a minute at a time from an event heap. The evaluator,
// the module printed from the core IR and the hand-written ideal must print the same report.

import { test } from "node:test";
import assert from "node:assert/strict";
import { ways } from "../gaps/clinic.ts";
import { skip } from "./c-harness.ts";

test("clinic: a day of 8 hours prints the same report three ways, and the csv has a row per patient", () => {
  const want = ways.ideal(8);
  assert.equal(want.out[0], "4 desks, urgency first, least busy, seed 7");
  for (const way of ["evaluator", "core"] as const) {
    const r = ways[way](8);
    assert.deepEqual(r.out, want.out, way);
    assert.equal(r.csv?.split("\n").length, 1 + Number(/Patients (\d+)/.exec(want.out[1])![1]), way);
  }
});

test("clinic: 40 hours, from the core IR and by hand", () => {
  const want = ways.ideal(40).out;
  assert.deepEqual(ways.core(40).out, want);
});

// The seeds' days run on the pool's threads, each seeded on its own:
// their generator was one state for every thread, so the table of
// strategies changed from run to run (C357).
test("clinic: 40 hours from ters native, on its threads, the same each run", { skip }, () => {
  const want = ways.core(40).out;
  for (let k = 0; k < 3; k++) assert.deepEqual(ways.native(40).out, want);
});
