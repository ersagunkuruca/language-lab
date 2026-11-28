// The table in GAPS.md game round 5 (G20): `node compiler/gaps/bench-hail.ts [ticks] [discs…]`
// (100 ticks of 1000 and 5000 discs by default). Every way runs as a
// process, start-up included, the median of RUNS (default 3): the
// hand-written C (hail.ideal.c), the hand-written JavaScript (hail.ideal.js), and `ters compile` (Node, its workers on and off),
// `ters native` (its threads on and off) and `ters wasi` (Node's WASI).
// Each way's lines are checked against the ideal's.
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { wasiImportsSource } from "../src/wasi-imports.ts";


const folder = join(import.meta.dirname, "hail");
const [ticks = "100", ...given] = process.argv.slice(2);
const sizes = given.length ? given : ["1000", "5000"];
const runs = Number(process.env.RUNS ?? 3);
const dir = mkdtempSync(join(tmpdir(), "bench-hail-")), lab = join(import.meta.dirname, "../../ters/cli/ters.ts");
const ok = (r: ReturnType<typeof spawnSync>) => { if (r.status !== 0) throw new Error(String(r.stderr)); };
const c = join(import.meta.dirname, "hail.ideal.c");
ok(spawnSync("cc", ["-O2", "-ffp-contract=off", c, "-o", join(dir, "c"), "-lm"]));
ok(spawnSync(process.execPath, [lab, "compile", folder, "-o", join(dir, "g.mjs")]));
ok(spawnSync(process.execPath, [lab, "native", folder, "-o", join(dir, "g")]));
ok(spawnSync(process.execPath, [lab, "wasi", folder, "-o", join(dir, "g.wasm")]));
writeFileSync(join(dir, "wasi.mjs"), `import { readFileSync } from "node:fs"; import { WASI } from "node:wasi"; ${wasiImportsSource}
const w = new WASI({ version: "preview1", args: ["hail", ...process.argv.slice(2)], returnOnExit: true });
w.start(new WebAssembly.Instance(await WebAssembly.compile(readFileSync(${JSON.stringify(join(dir, "g.wasm"))})), wasiImports(w)));`);
const node = process.execPath;
const ways: [string, string, string[], Record<string, string>][] = [
  ["C", join(dir, "c"), [], {}],
  ["JS by hand", node, [join(import.meta.dirname, "hail.ideal.js")], {}],
  ["ters native, one thread", join(dir, "g"), [], { TERS_WORKERS: "0" }],
  ["ters native", join(dir, "g"), [], {}],
  ["ters wasi", node, ["--no-warnings", join(dir, "wasi.mjs")], {}],
  ["ters compile, one thread", node, [join(dir, "g.mjs")], { TERS_WORKERS: "0" }],
  ["ters compile", node, [join(dir, "g.mjs")], {}],
];
for (const n of sizes) {
  console.log(`\n${ticks} ticks, ${n} discs`);
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
