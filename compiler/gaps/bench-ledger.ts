// ledger: evaluator, compiled and ideal, on files of growing size. The
// numbers in GAPS.md, round 3, come from this.
// Run: node gaps/bench-ledger.ts   (or npm run gaps)

import assert from "node:assert/strict";
import { book, ways } from "./ledger.ts";

const w = await ways();
const time = (f: () => unknown, runs: number) => {
  f();
  const ts: number[] = [];
  for (let i = 0; i < runs; i++) { const t = performance.now(); f(); ts.push(performance.now() - t); }
  return ts.sort((a, b) => a - b)[runs >> 1];
};
const ms = (x: number) => `${x < 10 ? x.toFixed(2) : x.toFixed(0)} ms`.padStart(10);

console.log(`ledger: totals by account and by month of a file kept in memory (in one process, median)\n`);
console.log(`${"file".padEnd(26)} ${"evaluator".padStart(10)} ${"compiled".padStart(10)} ${"ideal".padStart(10)}  compiled/ideal`);
// Past about 5000 lines the compiled `entries` runs out of JS stack in a
// process with the default stack (GAPS.md G22), so the sizes stop there.
for (const n of [100, 1000, 3000, 4000]) {
  const files = { "l.csv": book(n) }, args = ["l.csv"];
  const want = w.ideal(args, files);
  assert.deepEqual(w.compiled(args, files), want);
  const small = n <= 3000;
  if (small) assert.deepEqual(w.evaluator(args, files), want);
  const ev = small ? time(() => w.evaluator(args, files), 3) : NaN;
  const runs = n >= 3000 ? 11 : 31;
  const c = time(() => w.compiled(args, files), runs), i = time(() => w.ideal(args, files), runs);
  const label = `${n} entries, ${(files["l.csv"].length / 1024).toFixed(0)} KB`;
  console.log(`${label.padEnd(26)} ${Number.isNaN(ev) ? "(skipped)".padStart(10) : ms(ev)} ${ms(c)} ${ms(i)}  ${(c / i).toFixed(1)}×`);
}
