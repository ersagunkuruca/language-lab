// chapters: evaluator, compiled and ideal, on books of growing size. The
// numbers in GAPS.md, round 2's second program, come from this.
// Run: node gaps/bench-chapters.ts   (or npm run gaps)

import assert from "node:assert/strict";
import { book, ways } from "./chapters.ts";

const w = await ways();
const time = (f: () => unknown, runs: number) => {
  f();
  const t = performance.now();
  for (let i = 0; i < runs; i++) f();
  return (performance.now() - t) / runs;
};
const ms = (x: number) => `${x < 10 ? x.toFixed(2) : x.toFixed(0)} ms`.padStart(10);

console.log(`chapters: split a book into files kept in memory (in one process)\n`);
console.log(`${"book".padEnd(26)} ${"evaluator".padStart(10)} ${"compiled".padStart(10)} ${"ideal".padStart(10)}  compiled/ideal`);
for (const n of [10, 100, 1000, 3000]) {
  const files = { "book.md": book(n) }, args = ["book.md", "out"];
  const want = w.ideal(args, files);
  assert.deepEqual(w.compiled(args, files), want);
  const small = n <= 1000;
  if (small) assert.deepEqual(w.evaluator(args, files), want);
  const ev = small ? time(() => w.evaluator(args, files), 1) : NaN;
  const runs = n >= 1000 ? 3 : 20;
  const c = time(() => w.compiled(args, files), runs), i = time(() => w.ideal(args, files), runs);
  const label = `${n} chapters, ${(files["book.md"].length / 1024).toFixed(0)} KB`;
  console.log(`${label.padEnd(26)} ${Number.isNaN(ev) ? "(skipped)".padStart(10) : ms(ev)} ${ms(c)} ${ms(i)}  ${(c / i).toFixed(1)}×`);
}
