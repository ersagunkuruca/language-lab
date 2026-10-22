// "The printer is a parser": `show numbers` run backwards reads a list of
// numbers back from its text. How long it takes, by length.
// Run: node bench/parse.ts [max]
import { relate, toValue } from "../src/lang/relate.ts";
import { fromList } from "../src/lang/run.ts";
import { Lang } from "../src/lang/dsl.ts";
import { base } from "../src/lang/load.ts";
import { library } from "../src/lang/programs.ts";

const k = new Lang();
const lib = library(k);
const code = base(k.code);
const max = Number(process.argv[2] ?? 400);
for (let n = Number(process.argv[3] ?? 50); n <= max; n = Math.round(n * (Number(process.argv[4]) || 2))) {
  const text = Array.from({ length: n }, (_, i) => String(i * 7)).join(" ");
  const t = performance.now();
  // Every answer, so the search has to rule out all the other readings too.
  const answers = [...relate(code, lib.showNumbers, { out: text })];
  const xs = answers.map((a) => Object.values(a.values).map((v) => toValue(v)).find((v) => v !== undefined && typeof v === "object"));
  const ok = answers.length === 1 && fromList(xs[0] as never).join(" ") === text;
  console.log(`read ${String(n).padStart(5)} numbers: ${(performance.now() - t).toFixed(0).padStart(7)} ms ${ok ? "" : "WRONG"}`);
}
