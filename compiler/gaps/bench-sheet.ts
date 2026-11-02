// Bigger-program round 7 (docs/reports/GAPS.md): sheet in five ways on
// made-up sheets of growing size. Checks that every way prints, writes and
// exits the same, then times each (median of a few runs).
//   node gaps/bench-sheet.ts [rows…]

import { ways, sheetText, type Name } from "./sheet.ts";

const w = await ways();
console.log(`chosen: ${w.chosen.join(", ")}`);
const sizes = process.argv.slice(2).map(Number);
const names: Name[] = ["evaluator", "evaluator, chosen", "compiled", "compiled, chosen", "ideal"];
const median = (xs: number[]) => xs.sort((a, b) => a - b)[Math.floor(xs.length / 2)];
console.log(["sheet", ...names, "chosen/ideal"].join("\t"));
for (const rows of sizes.length ? sizes : [50, 200, 1000, 3000]) {
  const files = { "s.txt": sheetText(rows) };
  const row: string[] = [`${rows} rows, ${rows * 6} cells`];
  let want = "", ms: Record<string, number> = {};
  for (const name of names) {
    // The evaluator is slow: only on the small sheets.
    if (name.startsWith("evaluator") && rows > 200) { row.push("(skipped)"); continue; }
    const times: number[] = [];
    for (let i = 0; i < (name.startsWith("evaluator") ? 1 : 5); i++) {
      const t0 = performance.now();
      let r;
      try { r = w[name](["s.txt"], files); } catch (e) { times.push(NaN); break; }
      times.push(performance.now() - t0);
      const got = JSON.stringify([r.out, r.code, r.wrote]);
      if (!want) want = got;
      else if (got !== want) throw new Error(`${name} differs at ${rows} rows`);
    }
    ms[name] = median(times);
    row.push(Number.isNaN(times[0]) ? "stack overflow" : `${ms[name].toFixed(ms[name] < 10 ? 1 : 0)} ms`);
  }
  row.push(`${(ms["compiled, chosen"] / ms.ideal).toFixed(0)}×`);
  console.log(row.join("\t"));
}
