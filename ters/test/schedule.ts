// When a test runs again although nothing it ran changed (T16c): a review
// on a schedule, like spaced repetition's Leitner boxes. Each clean run
// moves a test to a longer interval (1, 2, 4, then 7 days); a failure, or
// an edit to the test file itself, puts it back to a day. So a test that
// keeps passing costs one run a week, and one that broke lately runs
// daily. Spaced repetition is prior art for scheduling reviews (Leitner,
// 1972; Ebbinghaus's forgetting curve); applied to tests here.
//
// The interval is a safety net for what selection by the map can miss: a
// sweep's slice that didn't run a line (Check main runs an eighth), a
// test whose behaviour depends on something the map doesn't record (the
// clock, the network, Node's version), and the editor's bundled tests.

import type { Entry } from "./test-map.ts";

export const INTERVALS = [1, 1, 2, 4, 7];

// Days until a test with this many clean runs in a row is due again.
export const intervalDays = (streak: number) => INTERVALS[Math.min(Math.max(streak, 0), INTERVALS.length - 1)];

// The streak after a run: one more for a pass, unless the test file itself
// changed since the last run; none after a failure.
export function streakAfter(prev: Entry | undefined, passed: boolean, testEdited: boolean): number {
  if (!passed) return 0;
  if (!prev || !prev.passed || testEdited) return 1;
  return (prev.streak ?? 1) + 1;
}

// Due for review at `now`: its interval has gone by since it last ran. An
// hour's slack, so a test that ran at last night's run is due tonight.
export function isDue(entry: Entry, now: Date): boolean {
  if (!entry.passed) return true;
  const since = (now.getTime() - Date.parse(entry.ran)) / 86_400_000;
  return since >= intervalDays(entry.streak ?? 0) - 1 / 24;
}
