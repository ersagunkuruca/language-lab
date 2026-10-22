// How much the compiler buys: the same programs, evaluated and compiled.
// Run: node bench.ts   (or npm run bench)

import { makeRunner, runMain, type Value } from "../projectional/src/lang/run.ts";
import { load } from "./src/program.ts";
import { $setPrint } from "./src/runtime.js";

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

for (const name of ["queens", "algebra", "relations"]) {
  const p = load(name);
  const c = (await import(`./out/${name}.js`)).defs;
  $setPrint(() => {});
  row(`${name}: main`, time(() => runMain(p.code, p.info, p.named("main"), { print: () => {} }), 1), time(() => c.main()));
}
