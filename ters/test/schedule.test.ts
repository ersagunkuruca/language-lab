// The review schedule (schedule.ts, T16c): a test that keeps passing waits
// longer each time, up to a week; a failure or an edit to the test brings
// it back to a day; a test that failed is always due.

import { test } from "node:test";
import assert from "node:assert/strict";
import { intervalDays, isDue, streakAfter } from "./schedule.ts";
import type { Entry } from "./test-map.ts";

const ran = (daysAgo: number, streak: number, passed = true): Entry => ({ at: "x", ran: new Date(Date.parse("2026-11-14T03:00:00Z") - daysAgo * 86_400_000).toISOString(), passed, streak, seconds: 1, code: {}, files: [], dirs: [], trees: [] });
const now = new Date("2026-11-14T03:00:00Z");

test("the interval doubles with each clean run, up to a week", () => {
  assert.deepEqual([0, 1, 2, 3, 4, 9].map(intervalDays), [1, 1, 2, 4, 7, 7]);
});

test("the streak grows on a pass and starts again on a failure or an edit", () => {
  assert.equal(streakAfter(undefined, true, false), 1);
  assert.equal(streakAfter(ran(1, 3), true, false), 4);
  assert.equal(streakAfter(ran(1, 3), true, true), 1);
  assert.equal(streakAfter(ran(1, 3), false, false), 0);
  assert.equal(streakAfter(ran(1, 0, false), true, false), 1);
});

test("due once its interval has gone by, and always after a failure", () => {
  assert.equal(isDue(ran(1, 1), now), true);
  assert.equal(isDue(ran(0.5, 1), now), false);
  assert.equal(isDue(ran(3, 3), now), false);
  assert.equal(isDue(ran(4, 3), now), true);
  // Last night's run, a few minutes later than tonight's.
  assert.equal(isDue(ran(1 - 0.01, 1), now), true);
  assert.equal(isDue(ran(0.1, 5, false), now), true);
});
