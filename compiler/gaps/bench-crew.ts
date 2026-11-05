// The table in GAPS.md round 11: `node compiler/gaps/bench-crew.ts 50 200 1000 5000`.
// Each way runs the whole report on a made-up plan of that many tasks with
// 4 workers: the plan, the critical path, a run with its log, and the
// table of crews 1 to 6, both ways of ranking (13 runs of the crew). The
// evaluator is skipped past 200 tasks. All four run in this process.
import { ways, plan } from "./crew.ts";
const w = await ways();
const sizes = process.argv.slice(2).map(Number);
const time = (f: () => unknown) => { const t = performance.now(); const r = f(); return { r, ms: performance.now() - t }; };
for (const n of sizes.length ? sizes : [50, 200, 1000]) {
  const files = { "plan.txt": plan(n) };
  const args = ["plan.txt"];
  w.ideal(args, files); // warm
  const ideal = time(() => w.ideal(args, files));
  for (const way of ["evaluator", "compiled", "core", "ideal"] as const) {
    if (way === "evaluator" && n > 200) continue;
    if (way !== "ideal") w[way](args, files); // warm
    const r = way === "ideal" ? ideal : time(() => w[way](args, files));
    const same = JSON.stringify(r.r) === JSON.stringify(ideal.r);
    console.log(`${String(n).padStart(6)} tasks  ${way.padEnd(9)} ${r.ms.toFixed(1).padStart(9)} ms  ${(r.ms / ideal.ms).toFixed(1).padStart(7)}x${same ? "" : "  (prints differently)"}`);
  }
}
