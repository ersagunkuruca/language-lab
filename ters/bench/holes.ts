// How long a hole's offers take (BACKLOG E103): each input of physics
// `fall`'s calls made a hole in turn, on the library's layer as the editor
// has it, and its fillings timed. Run: node bench/holes.ts
// HOLE=<id> times one hole (REP=<n> times, the later ones warm),
// NOLAYER=1 off the library's layer, DUMP=<file> appends each hole's
// offers (to check a change keeps them).
import { appendFileSync } from "node:fs";
import { join } from "node:path";
import { fillings, infer } from "../src/lang/infer.ts";
import { LIBRARY } from "../src/lang/library.ts";
import { checkOptions, loadProgram } from "../src/lang/load.ts";
import { isCall, onLayer, replace, subtree } from "../src/model.ts";

const p = loadProgram(join(import.meta.dirname, "../examples/physics"));
const fall = p.named("fall");
const args = [...new Set(subtree(p.code, fall).flatMap((id) => { const n = p.code.nodes[id]; return isCall(n) ? n.args : []; }))];
const holes = process.env.HOLE ? Array<string>(+(process.env.REP ?? 1)).fill(process.env.HOLE) : args;
let total = 0, worst = 0, wid = "";
for (const hole of holes) {
  const code = replace(p.code, hole, () => ({ kind: "hole" }));
  if (!process.env.NOLAYER) onLayer(code, LIBRARY.code);
  const info = infer(code, p.pres.names, undefined, checkOptions);
  const t = performance.now();
  const fs = fillings(code, info, hole);
  const dt = performance.now() - t;
  total += dt;
  if (dt > worst) { worst = dt; wid = hole; }
  if (process.env.DUMP) appendFileSync(process.env.DUMP, `${hole} ${fs.map((x) => `${x.kind}:${"target" in x ? x.target : ""}:${"arity" in x ? x.arity : ""}`).sort().join(",")}\n`);
  console.log(hole, p.code.nodes[hole].kind, fs.length, Math.round(dt));
}
console.log(`${holes.length} holes ${(total / 1000).toFixed(1)} s, worst ${wid} ${(worst / 1000).toFixed(2)} s`);
