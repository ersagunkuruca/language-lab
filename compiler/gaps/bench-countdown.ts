// Countdown: evaluator, compiled and ideal, on the same instances. The
// numbers in GAPS.md, round 2, come from this.
// Run: node gaps/bench-countdown.ts   (or npm run gaps)

import assert from "node:assert/strict";
import { instances, ways } from "./countdown.ts";

const w = await ways();
const time = (f: () => unknown, runs: number) => {
  f();
  const t = performance.now();
  for (let i = 0; i < runs; i++) f();
  return (performance.now() - t) / runs;
};
const ms = (x: number) => `${x < 10 ? x.toFixed(2) : x.toFixed(0)} ms`.padStart(10);

console.log(`countdown: every solution (in one process)\n`);
console.log(`${"instance".padEnd(28)} ${"answers".padStart(7)} ${"evaluator".padStart(10)} ${"compiled".padStart(10)} ${"ideal".padStart(10)}  compiled/ideal`);
for (const [numbers, target] of instances) {
  const want = w.ideal(numbers, target);
  assert.deepEqual(w.compiled(numbers, target), want);
  const small = numbers.length <= 5;
  if (small) assert.deepEqual(w.evaluator(numbers, target), want);
  const ev = small ? time(() => w.evaluator(numbers, target), 1) : NaN;
  const c = time(() => w.compiled(numbers, target), 5), i = time(() => w.ideal(numbers, target), 5);
  console.log(`${`${numbers.join(" ")} → ${target}`.padEnd(28)} ${String(want.length).padStart(7)} ${Number.isNaN(ev) ? "(skipped)".padStart(10) : ms(ev)} ${ms(c)} ${ms(i)}  ${(c / i).toFixed(1)}×`);
}
