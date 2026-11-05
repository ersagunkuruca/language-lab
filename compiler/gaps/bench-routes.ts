// routes: the evaluator and the compiled program, each on maps and sets as
// defined (sorted lists) and as trees, compiled with Map as a hash table
// (C63b), against the ideal, on countries of
// growing size. The numbers in GAPS.md, round 5, come from this.
// Run: node gaps/bench-routes.ts   (or npm run gaps)

import assert from "node:assert/strict";
import { country, ways, type Name } from "./routes.ts";

const w = await ways();
const time = (f: () => unknown, runs: number) => {
  f();
  const ts: number[] = [];
  for (let i = 0; i < runs; i++) { const t = performance.now(); f(); ts.push(performance.now() - t); }
  return ts.sort((a, b) => a - b)[runs >> 1];
};
const ms = (x: number) => (Number.isNaN(x) ? "(skipped)" : `${x < 10 ? x.toFixed(2) : x.toFixed(0)} ms`).padStart(11);
const cols: Name[] = ["evaluator", "evaluator, trees", "core", "core, trees", "core, table", "ideal"];

console.log(`routes: summary, cheapest network and 10 trips and nears over a country kept in memory (in one process, median)\n`);
console.log(`${"country".padEnd(22)}${cols.map((c) => c.padStart(17)).join("")}  core/ideal  trees/ideal  table/ideal`);
for (const n of [100, 300, 1000, 3000]) {
  const files = { "c.txt": country(n) }, args = ["c.txt"];
  const want = w.ideal(args, files);
  // The evaluator and the program as defined are quadratic or worse: they
  // run fewer times, and not at all where they'd take minutes (as defined,
  // 3000 towns took 93 s compiled on 2026-10-29).
  const runs = (c: Name) => (c.startsWith("evaluator") ? (n <= 100 ? 3 : n <= 300 ? 1 : 0) : c === "core" ? (n <= 300 ? 3 : n <= 1000 ? 1 : 0) : 11);
  const t = Object.fromEntries(cols.map((c) => {
    const k = runs(c);
    if (!k) return [c, NaN];
    assert.deepEqual(w[c](args, files), want, `${c} on ${n} towns`);
    return [c, time(() => w[c](args, files), k)];
  })) as Record<Name, number>;
  const label = `${n} towns, ${(files["c.txt"].length / 1024).toFixed(0)} KB`;
  console.log(`${label.padEnd(22)}${cols.map((c) => ms(t[c]).padStart(17)).join("")}  ${Number.isNaN(t.core) ? "".padStart(14) : `${(t.core / t.ideal).toFixed(0).padStart(13)}×`}  ${(t["core, trees"] / t.ideal).toFixed(1).padStart(10)}×  ${(t["core, table"] / t.ideal).toFixed(1).padStart(10)}×`);
}
