// The table in GAPS.md round 8: board's scripted session (board.ts) at a
// few sizes, the evaluator, the compiled page and the hand-written ideal,
// best of three. "add" is per card added through the quick-add field;
// "frame" is one frame of the focus timer running (the card's time and the
// timer's line change), "idle frame" one with no timer.
//
//   node compiler/gaps/bench-board.ts [sizes…]

import { ways, run, session, type Name } from "./board.ts";

const w = await ways();
const sizes = process.argv.slice(2).map(Number);
const phases = ["start", ...session(1).map(([n]) => n)];
const at = (name: string) => phases.indexOf(name);
const best = (way: Name, n: number) => {
  let r: number[] | null = null;
  for (let k = 0; k < 3; k++) { const ms = run(w[way], n).ms; r = r ? r.map((x, i) => Math.min(x, ms[i])) : ms; }
  return r!;
};
const f = (x: number) => (x < 10 ? x.toFixed(2) : x.toFixed(0));
console.log("cards  way        whole session  add, per card  frame   idle frame");
for (const n of sizes.length ? sizes : [50, 200, 1000, 2000]) for (const way of ["evaluator", "compiled", "ideal"] as Name[]) {
  if (way === "evaluator" && n > 200) { console.log(`${String(n).padStart(5)}  ${way.padEnd(10)} (skipped)`); continue; }
  const ms = best(way, n), total = ms.reduce((a, b) => a + b, 0);
  console.log(`${String(n).padStart(5)}  ${way.padEnd(10)} ${f(total).padStart(9)} ms  ${f(ms[at("add")] / Math.max(1, n)).padStart(9)} ms  ${f(ms[at("focus")] / 120).padStart(5)} ms  ${f(ms[at("idle frames")] / 120).padStart(5)} ms`);
}
