// The table in GAPS.md round 20: `node compiler/gaps/bench-larder.ts 4x3 16x3 16x4 64x4`.
// Each way runs the whole report on a made-up book of that many recipes
// and pack sizes per food (larder.ts `book`): every line read, every dish
// scaled and spelled, the packs to buy searched for, and the portions the
// larder makes. The evaluator runs only on the first size. All run in this
// process, the median of `RUNS` (default 3) after a warm-up.
import { ways, book } from "./larder.ts";
const w = await ways();
const sizes = process.argv.slice(2).length ? process.argv.slice(2) : ["4x3", "16x3", "16x4", "64x4"];
const runs = Number(process.env.RUNS ?? 3);
const median = (f: () => unknown) => {
  const ms: number[] = []; let r: unknown;
  for (let i = 0; i < runs; i++) { const t = performance.now(); r = f(); ms.push(performance.now() - t); }
  ms.sort((a, b) => a - b);
  return { r, ms: ms[Math.floor(ms.length / 2)] };
};
for (const [i, size] of sizes.entries()) {
  const [recipes, packs] = size.split("x").map(Number);
  const files = { "book.txt": book(recipes, packs) };
  const args = ["book.txt"];
  w.ideal(args, files);
  const ideal = median(() => w.ideal(args, files));
  for (const way of ["evaluator", "core", "ideal"] as const) {
    if (way === "evaluator" && i > 0) continue;
    if (way === "evaluator") { const t = performance.now(); const r = w.evaluator(args, files); const ms = performance.now() - t; print(size, way, { r, ms }); continue; }
    if (way !== "ideal") w[way](args, files);
    print(size, way, way === "ideal" ? ideal : median(() => w[way](args, files)));
  }
  function print(size: string, way: string, r: { r: unknown; ms: number }) {
    const same = JSON.stringify(r.r) === JSON.stringify(ideal.r);
    console.log(`${size.padStart(6)}  ${way.padEnd(9)} ${r.ms.toFixed(1).padStart(9)} ms  ${(r.ms / ideal.ms).toFixed(1).padStart(7)}x${same ? "" : "  (prints differently)"}`);
  }
}
