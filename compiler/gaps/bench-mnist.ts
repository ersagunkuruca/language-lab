// The tables in GAPS.md round 22: `node compiler/gaps/bench-mnist.ts
// [adam:1000:1 newton:1000:3 …]`, each run a mode, how many training
// digits and how many passes (default: Adam over 1000, 10000 and 60000
// digits once, Adam with the gradient from `gradient` (reverse, L285 R4)
// over 1000 and 10000, Newton over 1000 digits three times and 10000
// once). For reverse the ideal is the hand-written pass, and NumPy and
// PyTorch aren't run.
// The core IR's module and the hand-written ideal run in this process,
// timed once after the files are read; `ters native`, `ters wasi`, NumPy
// and PyTorch (Float64 and Float32, on the CPU) run as processes, with
// the Python versions' own time after their imports beside the process's.
// SKIP=core,wasi,… leaves ways out. Each line says whether that way
// printed what the ideal printed.
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cut, folder, ways } from "./mnist.ts";

const runs = (process.argv.slice(2).length ? process.argv.slice(2) : ["adam:1000:1", "adam:10000:1", "adam:60000:1", "reverse:1000:1", "reverse:10000:1", "newton:1000:3", "newton:10000:1"]).map((s) => s.split(":"));
const skip = new Set((process.env.SKIP ?? "").split(",").filter(Boolean));
const w = await ways();
const dir = mkdtempSync(join(tmpdir(), "bench-mnist-")), lab = join(import.meta.dirname, "../../ters/cli/ters.ts"), py = join(import.meta.dirname, "mnist-python");
if (!skip.has("native")) spawnSync(process.execPath, [lab, "native", folder, "-o", join(dir, "mnist")]);
if (!skip.has("wasi")) {
  spawnSync(process.execPath, [lab, "wasi", folder, "-o", join(dir, "mnist.wasm")]);
  writeFileSync(join(dir, "run-wasi.mjs"), `import { readFileSync } from "node:fs"; import { WASI } from "node:wasi";
const w = new WASI({ version: "preview1", args: ["mnist", ...process.argv.slice(2)], preopens: { ".": process.argv[2] }, returnOnExit: true });
process.exitCode = w.start(new WebAssembly.Instance(await WebAssembly.compile(readFileSync(${JSON.stringify(join(dir, "mnist.wasm"))})), w.getImportObject()));`);
}
const line = (what: string, way: string, ms: number, idealMs: number, same: boolean, note = "") =>
  console.log(`${what.padEnd(16)} ${way.padEnd(13)} ${ms.toFixed(0).padStart(9)} ms ${(ms / idealMs).toFixed(1).padStart(7)}x${same ? "" : "  (prints differently)"}${note}`);
for (const [mode, n, of] of runs) {
  const what = `${mode} ${n}×${of}`, data = cut(Number(n)), args = ["d", mode, n, of];
  let t = performance.now();
  const want = w.ideal(args, data.files);
  const idealMs = performance.now() - t, wantText = want.out.join("\n") + "\n";
  line(what, "ideal (JS)", idealMs, idealMs, true);
  if (!skip.has("core")) {
    t = performance.now();
    const r = w.core(args, data.files);
    line(what, "core IR", performance.now() - t, idealMs, JSON.stringify(r) === JSON.stringify(want));
  }
  const proc = (way: string, cmd: string, as: string[], cwd = data.dir) => {
    if (skip.has(way.split(" ")[0]) || (mode === "reverse" && cmd === "python3")) return;
    const t = performance.now(), r = spawnSync(cmd, as, { cwd, encoding: "utf8", maxBuffer: 1 << 24 });
    const ms = performance.now() - t, own = /(\d+) ms\s*$/.exec(r.stderr ?? "");
    line(what, way, ms, idealMs, r.stdout === wantText, own ? `  (${own[1]} ms after imports)` : r.status ? `  (exit ${r.status}: ${(r.stderr ?? "").trim().split("\n")[0].slice(0, 80)})` : "");
  };
  proc("native", join(dir, "mnist"), [".", mode, n, of]);
  proc("wasi", process.execPath, ["--no-warnings", "--stack-size=8000", join(dir, "run-wasi.mjs"), ".", mode, n, of]);
  proc("numpy", "python3", ["-I", join(py, "mnist_numpy.py"), ".", mode, n, of]);
  proc("torch f64", "python3", ["-I", join(py, "mnist_torch.py"), ".", mode, n, of]);
  proc("torch f32", "python3", ["-I", join(py, "mnist_torch.py"), ".", mode, n, of, "--float32"]);
}
