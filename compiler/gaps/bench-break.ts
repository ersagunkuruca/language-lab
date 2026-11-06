// break (GAPS.md round 12): main's three breaks, each way, after a warm-up,
// the median of `runs` runs. Run: node gaps/bench-break.ts [runs] [--evaluator]
import { ways } from "./break.ts";

const runs = Number(process.argv[2] ?? 9);
const w = ways();
const median = (f: () => unknown, n: number) => { f(); const ts: number[] = []; for (let i = 0; i < n; i++) { const t = performance.now(); f(); ts.push(performance.now() - t); } ts.sort((a, b) => a - b); return ts[ts.length >> 1]; };
const ideal = median(w.ideal, runs);
const row = (name: string, ms: number) => console.log(`${name.padEnd(10)} ${ms.toFixed(1).padStart(9)} ms ${(ms / ideal).toFixed(1).padStart(8)}x`);
row("ideal", ideal);
row("core", median(w.core, runs));
if (process.argv.includes("--evaluator")) row("evaluator", median(w.evaluator, 1));
