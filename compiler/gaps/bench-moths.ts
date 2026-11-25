// The table in GAPS.md game round 1: `node compiler/gaps/bench-moths.ts [ticks] [moths…]`
// (100 ticks; 3000 and 10000 moths by default). Every way runs as a process,
// start-up included, the median of RUNS (default 3): the hand-written C
// (moths.ideal.c, one thread and with OpenMP), the hand-written JavaScript
// (moths.ideal.js), and `ters compile` (Node, its workers on and off),
// `ters native` (its threads on and off) and `ters wasi` (Node's WASI).
// Each way's lines are checked against the ideal's.
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { folder } from "./moths.ts";
import { wasiImportsSource } from "../src/wasi-imports.ts";

const [ticks = "100", ...given] = process.argv.slice(2);
const sizes = given.length ? given : ["3000", "10000"];
const runs = Number(process.env.RUNS ?? 3);
const dir = mkdtempSync(join(tmpdir(), "bench-moths-")), lab = join(import.meta.dirname, "../../ters/cli/ters.ts");
const ok = (r: ReturnType<typeof spawnSync>) => { if (r.status !== 0) throw new Error(String(r.stderr)); };
const c = join(import.meta.dirname, "moths.ideal.c");
ok(spawnSync("cc", ["-O2", "-ffp-contract=off", c, "-o", join(dir, "c"), "-lm"]));
ok(spawnSync("cc", ["-O2", "-ffp-contract=off", "-fopenmp", c, "-o", join(dir, "ct"), "-lm"]));
ok(spawnSync(process.execPath, [lab, "compile", folder, "-o", join(dir, "moths.mjs")]));
ok(spawnSync(process.execPath, [lab, "native", folder, "-o", join(dir, "moths")]));
ok(spawnSync(process.execPath, [lab, "wasi", folder, "-o", join(dir, "moths.wasm")]));
writeFileSync(join(dir, "wasi.mjs"), `import { readFileSync } from "node:fs"; import { WASI } from "node:wasi"; ${wasiImportsSource}
const w = new WASI({ version: "preview1", args: ["moths", ...process.argv.slice(2)], returnOnExit: true });
w.start(new WebAssembly.Instance(await WebAssembly.compile(readFileSync(${JSON.stringify(join(dir, "moths.wasm"))})), wasiImports(w)));`);
const node = process.execPath;
const ways: [string, string, string[], Record<string, string>][] = [
  ["C, one thread", join(dir, "c"), [], {}],
  ["C, OpenMP", join(dir, "ct"), [], {}],
  ["JS by hand", node, [join(import.meta.dirname, "moths.ideal.js")], {}],
  ["ters native, one thread", join(dir, "moths"), [], { TERS_WORKERS: "0" }],
  ["ters native", join(dir, "moths"), [], {}],
  ["ters wasi", node, ["--no-warnings", join(dir, "wasi.mjs")], {}],
  ["ters compile, one thread", node, [join(dir, "moths.mjs")], { TERS_WORKERS: "0" }],
  ["ters compile", node, [join(dir, "moths.mjs")], {}],
];
for (const n of sizes) {
  console.log(`\n${ticks} ticks, ${n} moths`);
  let want = "", base = 0;
  for (const [name, cmd, pre, env] of ways) {
    const ms: number[] = [];
    let out = "";
    for (let i = 0; i < runs; i++) {
      const t = performance.now();
      const r = spawnSync(cmd, [...pre, ticks, n], { encoding: "utf8", env: { ...process.env, ...env }, maxBuffer: 1 << 26 });
      ms.push(performance.now() - t);
      ok(r); out = r.stdout;
    }
    ms.sort((a, b) => a - b);
    const m = ms[Math.floor(ms.length / 2)];
    if (!want) { want = out; base = m; }
    console.log(`${name.padEnd(26)} ${(m / 1000).toFixed(2).padStart(7)} s ${(m / base).toFixed(1).padStart(6)}x${out === want ? "" : "  DIFFERS"}`);
  }
}
