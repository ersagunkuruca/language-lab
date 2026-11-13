// The table in GAPS.md round 15: `node compiler/gaps/bench-fit.ts 20 500 5000`.
// Each way fits all four models to that many made-up measurements
// (fit.ts `measurements`). The evaluator, the core IR's module and the
// ideal run in this process, the median of `RUNS` (default 3) after a
// warm-up, the evaluator once and only up to 500 points. `ters native`
// and `ters wasi` (Node's WASI) are built once and timed as processes,
// start-up included, when BUILT=1.
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { folder, measurements, ways } from "./fit.ts";
const w = await ways();
const sizes = (process.argv.slice(2).length ? process.argv.slice(2) : ["20", "500", "5000"]).map(Number);
const runs = Number(process.env.RUNS ?? 3);
const median = (f: () => unknown) => {
  const ms: number[] = []; let r: unknown;
  for (let i = 0; i < runs; i++) { const t = performance.now(); r = f(); ms.push(performance.now() - t); }
  ms.sort((a, b) => a - b);
  return { r, ms: ms[Math.floor(ms.length / 2)] };
};
const dir = mkdtempSync(join(tmpdir(), "bench-fit-")), lab = join(import.meta.dirname, "../../ters/cli/ters.ts");
const built = process.env.BUILT === "1";
if (built) {
  spawnSync(process.execPath, [lab, "native", folder, "-o", join(dir, "fit")]);
  spawnSync(process.execPath, [lab, "wasi", folder, "-o", join(dir, "fit.wasm")]);
  writeFileSync(join(dir, "run-wasi.mjs"), `import { readFileSync } from "node:fs"; import { WASI } from "node:wasi";
const w = new WASI({ version: "preview1", args: ["fit", "d.txt"], preopens: { ".": "." }, returnOnExit: true });
w.start(new WebAssembly.Instance(await WebAssembly.compile(readFileSync("fit.wasm")), w.getImportObject()));`);
}
for (const n of sizes) {
  const files = { "d.txt": measurements(n) }, args = ["d.txt"];
  w.ideal(args, files);
  const ideal = median(() => w.ideal(args, files));
  const print = (way: string, r: { r: unknown; ms: number }) => {
    const same = JSON.stringify(r.r) === JSON.stringify(ideal.r);
    console.log(`${String(n).padStart(6)}  ${way.padEnd(9)} ${r.ms.toFixed(1).padStart(9)} ms  ${(r.ms / ideal.ms).toFixed(1).padStart(7)}x${same ? "" : "  (prints differently)"}`);
  };
  if (n <= 500) { const t = performance.now(); const r = w.evaluator(args, files); print("evaluator", { r, ms: performance.now() - t }); }
  w.core(args, files);
  print("core", median(() => w.core(args, files)));
  print("ideal", ideal);
  if (built) {
    writeFileSync(join(dir, "d.txt"), files["d.txt"]);
    const want = (ideal.r as { out: string[] }).out.join("\n") + "\n";
    for (const [way, cmd, as] of [["native", join(dir, "fit"), ["d.txt"]], ["wasi", process.execPath, ["--no-warnings", "run-wasi.mjs"]]] as const) {
      const ms = median(() => spawnSync(cmd, as, { cwd: dir, encoding: "utf8" }).stdout);
      console.log(`${String(n).padStart(6)}  ${way.padEnd(9)} ${ms.ms.toFixed(1).padStart(9)} ms  ${(ms.ms / ideal.ms).toFixed(1).padStart(7)}x${ms.r === want ? "" : "  (prints differently)"}  (a process)`);
    }
  }
}
