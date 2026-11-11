// A page's map or keep on the GPU (C61 d′, docs/design/targets/
// WHERE-IT-RUNS.md): for each map or keep a page's handler sends to its
// workers (scalar.ts `awayMaps`), its function printed as a WebGPU compute
// kernel where the shader lowering takes it: an Int to an Int, or an Int
// to a Bool, Ints as i32 (wgsl.ts). The page's runtime may then run the
// map there (branches-rt.ts `gpuMap`) instead.
//
// The kernel runs the function under the budget it is given (scalar.ts
// `stepped`), one step per round of a loop or call the checker couldn't
// see end, as a page counts its steps. For each item it writes the
// answer and the steps it took, or −1 where the item must be worked out
// again on the CPU: it ran out of its budget, an Int went past 32 bits,
// or a search in it had no answer.

import type { Code, Id } from "../../ters/src/model.ts";
import type { Info } from "../../ters/src/lang/infer.ts";
import type { Names } from "../../ters/src/presentation.ts";
import { lowerScalar, type CoreIR } from "./scalar.ts";
import { emitWgsl } from "./wgsl.ts";

export interface GpuMap { how: "map" | "keep"; result: "int" | "bool"; wgsl: string }

// The kernel's own part: the items in, the answers and the steps out, and
// the budget and the count of items.
const kernel = (entry: string, bool: boolean, fuel: boolean, none: boolean) => `${fuel ? "" : "var<private> lab_fuel: f32;\n"}${none ? "" : "var<private> lab_none: bool;\n"}
struct LabJob { budget: f32, n: u32 }
@group(0) @binding(0) var<storage, read> lab_xs: array<i32>;
@group(0) @binding(1) var<storage, read_write> lab_out: array<i32>;
@group(0) @binding(2) var<storage, read_write> lab_spent: array<f32>;
@group(0) @binding(3) var<uniform> lab_job: LabJob;
@compute @workgroup_size(64) fn lab_main(@builtin(global_invocation_id) g: vec3u) {
  let i = g.x + g.y * 65535u * 64u;
  if (i >= lab_job.n) { return; }
  lab_fuel = lab_job.budget;
  lab_none = false;
  let r = ${entry}(lab_xs[i]);
  if (lab_fuel < 0.0 || lab_none) { lab_spent[i] = -1.0; return; }
  lab_out[i] = ${bool ? "select(0i, 1i, r)" : "r"};
  lab_spent[i] = lab_job.budget - lab_fuel;
}
`;

// The kernels by site, for the sites whose function the shader lowering
// takes. A function that closes over the handler's values isn't one yet.
export function gpuMaps(ir: CoreIR): Record<number, GpuMap> {
  const out: Record<number, GpuMap> = {};
  for (const m of ir.awayMaps ?? []) {
    const lam = ir.code.nodes[m.fn];
    const t = ir.info.typeOf.get(m.fn);
    if (lam?.kind !== "lambda" || lam.params.length !== 1 || !t) continue;
    try {
      const id = `gpu.${m.site}` as Id;
      const code: Code = { ...ir.code, defs: [...ir.code.defs, id], nodes: { ...ir.code.nodes, [id]: { id, kind: "def", body: m.fn } } };
      const info: Info = { ...ir.info, typeOf: new Map(ir.info.typeOf).set(id, t) };
      const names = { ...(ir as { names?: Names }).names, [id]: `map ${m.site}` } as Names;
      const l = lowerScalar(code, info, names, [id], { records: true, shader: true, stepped: true });
      if (l.refused.has(id)) continue;
      const fi = l.funcs.findIndex((g) => g.def === id && !g.inner);
      const f = l.funcs[fi];
      if (!f || f.params.length !== 1 || f.params[0] !== "int32" || (f.result !== "int32" && f.result !== "i32")) continue;
      if (m.how === "keep" && f.result !== "i32") continue;
      const sh = emitWgsl(l);
      const entry = sh.entries.get(fi);
      if (!entry) continue;
      out[m.site] = { how: m.how as "map" | "keep", result: f.result === "i32" ? "bool" : "int", wgsl: sh.wgsl + kernel(entry, f.result === "i32", sh.wgsl.includes("var<private> lab_fuel"), sh.wgsl.includes("var<private> lab_none")) };
    } catch { /* not one the GPU takes */ }
  }
  return out;
}
