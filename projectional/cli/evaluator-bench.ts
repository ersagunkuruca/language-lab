// The evaluator's benchmarks (EVALUATOR-SPEED-2026-10-31.md, BACKLOG L118):
//   node cli/evaluator-bench.ts [--no-jets]
// Add --cpu-prof to node to profile. Spacetime's charge path is what its
// page draws; Bounce's step goes through a definition so its generic
// arithmetic resolves as on the page.

import { infer } from "../src/lang/infer.ts";
import { loadProgram } from "../src/lang/load.ts";
import { makeRunner, type Value } from "../src/lang/run.ts";
import { Lang } from "../src/lang/dsl.ts";
import { merge } from "../src/model.ts";

const jets = !process.argv.includes("--no-jets");
const first = (xs: Iterable<Value>) => { for (const x of xs) return x; };
const time = (what: string, n: number, f: () => unknown) => {
  const t0 = performance.now();
  f();
  const ms = performance.now() - t0;
  console.log(`${what}: ${Math.round(ms)} ms${n > 1 ? `, ${(ms / n).toFixed(1)} ms each` : ""}`);
};

{
  const p = loadProgram("examples/spacetime");
  const info = infer(p.code, p.pres.names);
  const id = (n: string) => p.code.defs.find((d) => p.pres.names[d] === n)!;
  const r = makeRunner(p.code, info, { print: () => {}, names: p.pres.names, jets });
  const F = first(r.call(r.value(id("field")), 0, 0.5, 0, 0, 0, 1) as Iterable<Value>)!;
  time("Spacetime's charge path, 400 steps", 1, () => first(r.call(r.value(id("motion")), F, 400, 0.06) as Iterable<Value>));
}
{
  const p = loadProgram("examples/bounce");
  const id = (n: string) => p.code.defs.find((d) => p.pres.names[d] === n)!;
  const solid = p.code.defs.filter((d) => p.pres.names[d] === "solid").find((d) => p.code.nodes[(p.code.nodes[d] as { body: string }).body]?.kind !== "typedef")!;
  const k = new Lang(p.code);
  const N = 20, bench = k.def("bench");
  let e = k.x(id("solid bodies"));
  for (let i = 0; i < N; i++) e = k.call(id("step"), k.x(solid), e);
  k.define(bench, e);
  const code = merge(p.code, k.code), names = { ...p.pres.names, ...k.names };
  const r = makeRunner(code, infer(code, names), { print: () => {}, names, jets });
  time(`Bounce, ${N} solid steps`, N, () => r.value(bench));
}
