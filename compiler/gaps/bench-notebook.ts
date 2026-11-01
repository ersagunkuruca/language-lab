// notebook: the evaluator and the compiled program, on maps as defined
// (sorted lists) and as the chooser stores them, against the hand-written
// ideal, on notebooks of growing size. The numbers in GAPS.md, round 6,
// come from this.
// Run: node gaps/bench-notebook.ts [sizes…]   (from compiler/)

import assert from "node:assert/strict";
import { notes, ways, type Name } from "./notebook.ts";

const w = await ways();
const time = (f: () => unknown, runs: number) => {
  f();
  const ts: number[] = [];
  for (let i = 0; i < runs; i++) { const t = performance.now(); f(); ts.push(performance.now() - t); }
  return ts.sort((a, b) => a - b)[runs >> 1];
};
const ms = (x: number) => (Number.isNaN(x) ? "(skipped)" : `${x < 10 ? x.toFixed(2) : x.toFixed(0)} ms`).padStart(11);
const cols: Name[] = ["evaluator", "evaluator, trees", "compiled", "compiled, trees", "compiled, table", "ideal"];
const sizes = process.argv.slice(2).map(Number);

console.log(`notebook: index the notes, then a summary and 100 questions (in one process, median)`);
console.log(`chosen: trees ${w.chosen.trees.join(", ") || "none"}; table ${w.chosen.table.join(", ") || "none"}\n`);
console.log(`${"notebook".padEnd(22)}${cols.map((c) => c.padStart(17)).join("")}  compiled/ideal  trees/ideal  table/ideal`);
for (const n of sizes.length ? sizes : [100, 300, 1000, 3000]) {
  const files = { "n.txt": notes(n) }, args = ["n.txt"];
  const want = w.ideal(args, files);
  const runs = (c: Name) => (c.startsWith("evaluator") ? (n <= 100 ? 1 : 0) : c === "ideal" ? 11 : n <= 300 ? 5 : n <= 1000 ? 3 : 1);
  const t = Object.fromEntries(cols.map((c) => {
    const k = runs(c);
    if (!k) return [c, NaN];
    assert.deepEqual(w[c](args, files), want, `${c} on ${n} notes`);
    return [c, time(() => w[c](args, files), k)];
  })) as Record<Name, number>;
  const ratio = (x: number) => (Number.isNaN(x) ? "".padStart(11) : `${(x / t.ideal).toFixed(0).padStart(10)}×`);
  const label = `${n} notes, ${(files["n.txt"].length / 1024).toFixed(0)} KB`;
  console.log(`${label.padEnd(22)}${cols.map((c) => ms(t[c]).padStart(17)).join("")}  ${ratio(t.compiled).padStart(14)}  ${ratio(t["compiled, trees"])}  ${ratio(t["compiled, table"])}`);
}
