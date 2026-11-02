// The table in GAPS.md round 10: `node compiler/gaps/bench-clinic.ts 8 40 200 1000`.
// Each way runs the whole report (a day, the six ways, the desk sweep, ten
// seeds and the search for enough desks) with the clinic open that many
// hours. The evaluator is skipped past 40 hours. Times for the evaluator and
// the compiled module include starting node (about 40 ms).
import { ways } from "./clinic.ts";
const sizes = process.argv.slice(2).map(Number);
for (const hours of sizes.length ? sizes : [8, 40, 200]) {
  const ideal = ways.ideal(hours);
  for (const way of ["evaluator", "compiled", "ideal"] as const) {
    if (way === "evaluator" && hours > 40) continue;
    const r = way === "ideal" ? ideal : ways[way](hours);
    const same = r.out.join("\n") === ideal.out.join("\n");
    console.log(`${String(hours).padStart(5)} h  ${way.padEnd(9)} ${r.ms.toFixed(0).padStart(7)} ms  ${(r.ms / ideal.ms).toFixed(1).padStart(6)}x${same ? "" : "  (prints differently)"}`);
  }
}
