// Countdown (projectional/examples/countdown), the program of GAPS.md
// round 2, written in the editor by clicks: the evaluator, the compiled code
// and the hand-written ideal must find the same solutions in the same order.

import { test } from "node:test";
import assert from "node:assert/strict";
import { ways } from "../gaps/countdown.ts";

const w = await ways();

test("countdown: three ways agree on a small instance", () => {
  const want = w.ideal([2, 3, 5, 7, 11], 100);
  assert.equal(want.length, 30);
  assert.deepEqual(w.compiled([2, 3, 5, 7, 11], 100), want);
  assert.deepEqual(w.evaluator([2, 3, 5, 7, 11], 100), want);
});

test("countdown: Hutton's example has his 49 solutions, compiled and ideal", () => {
  // "The countdown problem" (Hutton, 2002): 49 solutions for 765 from
  // 1, 3, 7, 10, 25 and 50 once commutativity and identities are skipped.
  const want = w.ideal([1, 3, 7, 10, 25, 50], 765);
  assert.equal(want.length, 49);
  assert.equal(want[0], "(((3 − 1) + 7) × (10 + (25 + 50)))");
  assert.deepEqual(w.compiled([1, 3, 7, 10, 25, 50], 765), want);
});
