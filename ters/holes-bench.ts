import { appendFileSync } from "node:fs";
import { join } from "node:path";
import { replace, subtree, isCall } from "./src/model.ts";
import { fillings, infer } from "./src/lang/infer.ts";
import { checkOptions, loadProgram } from "./src/lang/load.ts";
const p = loadProgram(join(import.meta.dirname, "examples/physics"));
const fall = p.named("fall");
const args = [...new Set(subtree(p.code, fall).flatMap((id) => { const n = p.code.nodes[id]; return isCall(n) ? n.args : []; }))];
let total = 0, worst = 0, wid = "";
for (const hole of process.env.HOLE ? [process.env.HOLE] : args) {
  const code = replace(p.code, hole, () => ({ kind: "hole" }));
  const info = infer(code, p.pres.names, undefined, checkOptions);
  const t = performance.now();
  (globalThis as any).__T = {};
  const fs = fillings(code, info, hole);
  const dt = performance.now() - t;
  total += dt; if (dt > worst) { worst = dt; wid = hole; }
  if (process.env.DUMP) appendFileSync(process.env.DUMP, hole + " " + fs.map((x: any) => `${x.kind}:${x.target ?? x.value ?? ""}:${x.arity ?? ""}`).sort().join(",") + "\n");
  console.log(hole, p.code.nodes[hole].kind, fs.length, Math.round(dt), JSON.stringify(Object.fromEntries(Object.entries((globalThis as any).__T).map(([k, v]) => [k, Array.isArray(v) ? v.join(",") : Math.round(v as number)]))));
}
console.log(`${args.length} holes ${(total / 1000).toFixed(1)} s, worst ${wid} ${(worst / 1000).toFixed(2)} s`);
