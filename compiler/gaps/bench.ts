// calc: evaluator, compiled and ideal, on the same sessions. The numbers in
// GAPS.md come from this. Run: node gaps/bench.ts   (or npm run gaps)

import assert from "node:assert/strict";
import { deep, long, session, ways, type Way } from "./calc.ts";

const w = await ways();

const time = (f: () => unknown, runs: number) => {
  f();
  const t = performance.now();
  for (let i = 0; i < runs; i++) f();
  return (performance.now() - t) / runs;
};
const ms = (x: number) => `${x < 10 ? x.toFixed(2) : x.toFixed(0)} ms`.padStart(10);

console.log(`calc on a session of random lines (in one process, output collected)\n`);
console.log(`${"lines".padStart(6)} ${"evaluator".padStart(10)} ${"compiled".padStart(10)} ${"ideal".padStart(10)}  compiled/ideal`);
for (const n of [500, 2000, 4000]) {
  const input = session(n);
  const want = w.evaluator(input);
  assert.deepEqual(w.compiled(input), want);
  assert.deepEqual(w.ideal(input), want);
  const ev = n <= 2000 ? time(() => w.evaluator(input), 1) : NaN;
  const c = time(() => w.compiled(input), 10), i = time(() => w.ideal(input), 10);
  console.log(`${String(n).padStart(6)} ${Number.isNaN(ev) ? "(skipped)".padStart(10) : ms(ev)} ${ms(c)} ${ms(i)}  ${(c / i).toFixed(1)}×`);
}

// Where each way runs out of stack. The evaluator keeps its continuations
// on the heap, so it has no limit but memory.
const works = (way: Way, input: string, want: string) => {
  try { return way(input).out.at(-1) === want; } catch (e) { if (e instanceof RangeError) return false; throw e; }
};
const limit = (way: Way, make: (n: number) => string, want: (n: number) => string, sizes: number[]) => {
  let ok = 0;
  for (const n of sizes) { if (!works(way, make(n), want(n))) return `fails at ${n}`; ok = n; }
  return `${ok} works`;
};
console.log(`\nlimits`);
const probes: [string, (n: number) => string, (n: number) => string, number[]][] = [
  ["lines in a session", (n) => "1\n".repeat(n), () => "1", [1000, 2000, 5000, 10000, 100000]],
  ["nested parentheses", deep, () => "1", [500, 1000, 2000, 5000, 20000]],
  ["terms in one sum", long, (n) => String(n), [1000, 5000, 10000, 50000, 200000]],
];
for (const [what, make, want, sizes] of probes) {
  const row = (Object.keys(w) as (keyof typeof w)[]).map((k) => `${k}: ${limit(w[k], make, want, k === "evaluator" ? sizes.filter((s) => s <= 20000) : sizes)}`);
  console.log(`  ${what.padEnd(20)} ${row.join("   ")}`);
}
