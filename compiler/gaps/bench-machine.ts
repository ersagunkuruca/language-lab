// Bigger-program round 9 (docs/reports/GAPS.md): machine in each way on
// its programs at growing sizes. Checks that every way prints and exits
// the same, then times each (median of three; the evaluator once, on the
// small sizes only). The C way is `lab native`'s program, run as a process
// on files in a temporary folder, when it builds.
//   node gaps/bench-machine.ts [--profile]

import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { sized, source, ways, type Name } from "./machine.ts";

const flags = process.argv.slice(2);
const w = await ways();
console.log(`chosen: ${w.chosen.join(", ") || "nothing"}`);
if (w.wasmProblem) console.log(`wasm: ${w.wasmProblem}`);

// The C way: lab native, once.
const dir = mkdtempSync(join(tmpdir(), "machine-bench-"));
// MACHINE_NATIVE: a binary built by hand while lab native's own doesn't build.
let native: string | undefined = process.env.MACHINE_NATIVE;
if (!native) try {
  execFileSync("node", [join(import.meta.dirname, "../../ters/cli/lab.ts"), "native", join(import.meta.dirname, "machine"), "-o", join(dir, "machine")], { stdio: "pipe" });
  native = join(dir, "machine");
} catch (e) { console.log(`native: ${String((e as { stderr?: Buffer }).stderr ?? e).split("\n").find((l) => l.includes("error")) ?? "doesn't build"}`); }

const median = (xs: number[]) => xs.sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const cases: [string, string][] = [
  ["fib 15", sized("fib", 15)], ["fib 20", sized("fib", 20)], ["fib 24", sized("fib", 24)],
  ["collatz 300", sized("collatz", 300)], ["collatz 3000", sized("collatz", 3000)],
  ["primes 500", sized("primes", 500)], ["primes 5000", sized("primes", 5000)], ["primes 20000", sized("primes", 20000)],
  ["sort 100", sized("sort", 100)], ["sort 400", sized("sort", 400)], ["sort 1000", sized("sort", 1000)],
  ["hello", source("hello")],
];
const names: (Name | "native")[] = ["evaluator", "compiled", "core", "wasm", "native", "ideal"];
console.log(["program", "steps", ...names, "compiled/ideal", "core/ideal"].join("\t"));
for (const [label, text] of cases) {
  const files = { "p.asm": text }, args = [...flags, "p.asm"];
  const ideal = w.ideal(args, files);
  const steps = ideal.out.find((l) => l.startsWith("steps: "))?.split(" ")[1] ?? "?";
  const row: string[] = [label, steps];
  const ms: Record<string, number> = {};
  for (const name of names) {
    const small = Number(steps) < 20000;
    if (name === "evaluator" && !small) { row.push("(skipped)"); continue; }
    if (name === "wasm" && w.wasmProblem) { row.push("(doesn't load)"); continue; }
    if (name === "native" && !native) { row.push("(doesn't build)"); continue; }
    const times: number[] = [];
    for (let i = 0; i < (name === "evaluator" ? 1 : 3); i++) {
      const t0 = performance.now();
      let got;
      if (name === "native") {
        writeFileSync(join(dir, "p.asm"), text);
        const r = spawnSync(native!, args, { cwd: dir, encoding: "utf8" });
        got = { out: r.stdout.split("\n").filter((l, j, all) => l !== "" || j < all.length - 1), code: r.status };
      } else { const r = w[name](args, files); got = { out: r.out, code: r.code }; }
      times.push(performance.now() - t0);
      if (JSON.stringify(got) !== JSON.stringify({ out: ideal.out, code: ideal.code })) throw new Error(`${name} differs on ${label}: ${JSON.stringify(got).slice(0, 300)}`);
    }
    ms[name] = median(times);
    row.push(`${ms[name].toFixed(ms[name] < 10 ? 1 : 0)} ms`);
  }
  row.push(`${(ms.compiled / ms.ideal).toFixed(0)}×`, `${(ms.core / ms.ideal).toFixed(0)}×`);
  console.log(row.join("\t"));
}
