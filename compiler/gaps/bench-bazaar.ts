// The table in GAPS.md round 23: `node compiler/gaps/bench-bazaar.ts
// 10000 200000`, each size how many orders. The core IR's module and the
// ideal run in this process, the median of `RUNS` (default 3) after a
// warm-up, the evaluator once up to `EVALUATOR` orders (200000).
// `ters compile` (its module as a process, worker threads and all),
// `ters native` and `ters wasi` (Node's WASI) are built once and timed as
// processes, start-up included. SKIP=compile,native,wasi leaves ways out.
// Each line says whether that way printed what the ideal printed.
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { folder, ways } from "./bazaar.ts";
import { wasiImportsSource } from "../src/wasi-imports.ts";

const w = await ways();
const sizes = (process.argv.slice(2).length ? process.argv.slice(2) : ["10000", "200000"]).map(Number);
const runs = Number(process.env.RUNS ?? 3), skip = new Set((process.env.SKIP ?? "").split(",").filter(Boolean));
const median = (f: () => unknown) => {
  const ms: number[] = []; let r: unknown;
  for (let i = 0; i < runs; i++) { const t = performance.now(); r = f(); ms.push(performance.now() - t); }
  ms.sort((a, b) => a - b);
  return { r, ms: ms[Math.floor(ms.length / 2)] };
};
const dir = mkdtempSync(join(tmpdir(), "bench-bazaar-")), lab = join(import.meta.dirname, "../../ters/cli/ters.ts");
if (!skip.has("compile")) spawnSync(process.execPath, [lab, "compile", folder, "-o", join(dir, "bazaar.mjs")]);
if (!skip.has("native")) spawnSync(process.execPath, [lab, "native", folder, "-o", join(dir, "bazaar")]);
if (!skip.has("wasi")) {
  spawnSync(process.execPath, [lab, "wasi", folder, "-o", join(dir, "bazaar.wasm")]);
  writeFileSync(join(dir, "run-wasi.mjs"), `import { readFileSync } from "node:fs"; import { WASI } from "node:wasi"; ${wasiImportsSource}
const w = new WASI({ version: "preview1", args: ["bazaar", ...process.argv.slice(2)], returnOnExit: true });
process.exitCode = w.start(new WebAssembly.Instance(await WebAssembly.compile(readFileSync(${JSON.stringify(join(dir, "bazaar.wasm"))})), wasiImports(w)));`);
}
for (const n of sizes) {
  const args = [String(n)];
  w.ideal(args);
  const ideal = median(() => w.ideal(args)), want = (ideal.r as { out: string[] }).out.join("\n") + "\n";
  const line = (way: string, ms: number, same: boolean) => console.log(`${String(n).padStart(7)}  ${way.padEnd(14)} ${ms.toFixed(0).padStart(7)} ms  ${(ms / ideal.ms).toFixed(1).padStart(6)}x${same ? "" : "  (prints differently)"}`);
  line("ideal (JS)", ideal.ms, true);
  w.core(args);
  const core = median(() => w.core(args));
  line("core IR", core.ms, JSON.stringify(core.r) === JSON.stringify(ideal.r));
  if (n <= Number(process.env.EVALUATOR ?? 200000)) { const t = performance.now(); const r = w.evaluator(args); line("evaluator", performance.now() - t, JSON.stringify(r) === JSON.stringify(ideal.r)); }
  const proc = (way: string, cmd: string, as: string[]) => {
    if (skip.has(way.split(" ")[0])) return;
    const t = performance.now(), r = spawnSync(cmd, as, { cwd: dir, encoding: "utf8", maxBuffer: 1 << 26 });
    line(way, performance.now() - t, r.stdout === want);
  };
  proc("compile (proc)", process.execPath, [join(dir, "bazaar.mjs"), ...args]);
  proc("native", join(dir, "bazaar"), args);
  proc("wasi", process.execPath, ["--no-warnings", "--stack-size=8000", join(dir, "run-wasi.mjs"), ...args]);
}
