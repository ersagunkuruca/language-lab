// How much the compiler buys: the same programs, evaluated and compiled.
// Run: node bench.ts   (or npm run bench)

import { makeRunner, runMain, type Value } from "../ters/src/lang/run.ts";
import { load } from "./src/program.ts";
import { $setPrint } from "./src/runtime.js";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { compile } from "./src/compile.ts";
import { lowerScalar } from "./src/scalar.ts";
import { emitWasm, instantiate } from "./src/wasm.ts";
import { area } from "./src/fixtures.ts";

const time = (f: () => unknown, runs = 3) => {
  f();
  const t = performance.now();
  for (let i = 0; i < runs; i++) f();
  return (performance.now() - t) / runs;
};
const row = (what: string, ev: number, js: number) =>
  console.log(`${what.padEnd(34)} ${ev.toFixed(1).padStart(9)} ms ${js.toFixed(2).padStart(9)} ms ${(ev / js).toFixed(0).padStart(6)}×`);

console.log(`${"".padEnd(34)} ${"evaluator".padStart(12)} ${"compiled".padStart(12)} ${"speedup".padStart(7)}`);

const queens = load("queens");
const qc = (await import("./out/queens.js")).defs;
const qr = makeRunner(queens.code, queens.info, { print: () => {} });
const count = (it: Iterable<Value>) => { let n = 0; for (const _ of it) n++; return n; };
row("count every 8-queens board", time(() => count(qr.call(qr.value(queens.named("queens")), 8)), 1), time(() => count(qc.queens(8))));

for (const name of ["queens", "algebra", "relations", "backwards", "calculus"]) {
  const p = load(name);
  const c = (await import(`./out/${name}.js`)).defs;
  $setPrint(() => {});
  row(`${name}: main`, time(() => runMain(p.code, p.info, p.named("main"), { print: () => {} }), 1), time(() => c.main()));
}

// A numeric loop (tail recursion), three ways: evaluated, compiled to JS,
// and compiled to WebAssembly (scalar profile).
const a = area();
const ar = makeRunner(a.code, a.info, { print: () => {} });
const tmp = mkdtempSync(join(tmpdir(), "bench-"));
writeFileSync(join(tmp, "area.js"), compile(a.code, a.info, a.names, { runtime: pathToFileURL(join(import.meta.dirname, "src/runtime.js")).href, exports: ["area"] }));
const aj = (await import(pathToFileURL(join(tmp, "area.js")).href)).defs.area as (...x: number[]) => number;
const aw = (await instantiate(emitWasm(lowerScalar(a.code, a.info, a.names, [a.area])))).area;
const steps = (n: number) => [0, 2 / n, n, 0];
console.log(`\narea under a cubic, by tail recursion   evaluator         JS       WASM`);
for (const n of [1e3, 1e4, 1e6]) {
  const tryJs = () => { try { return time(() => aj(...steps(n))).toFixed(2).padStart(7) + " ms"; } catch { return "stack overflow"; } };
  const ev = n <= 1e4 ? time(() => [...ar.call(ar.value(a.area), ...steps(n))], 1).toFixed(1).padStart(7) + " ms" : "(skipped)";
  console.log(`${String(n).padStart(9)} steps ${ev.padStart(26)} ${tryJs().padStart(14)} ${time(() => aw(...steps(n))).toFixed(2).padStart(7)} ms`);
}
