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
import { DIVERGE, type Type } from "../../ters/src/lang/types.ts";
import type { Names } from "../../ters/src/presentation.ts";
import { lowerScalar, type CoreIR } from "./scalar.ts";
import { emitWgsl } from "./wgsl.ts";

// caps: what the function captured, in the closure's order, each an Int
// or a Bool, which the kernel is given after the item.
// A fold's (C42f) is its item's arm, given the rest's Int first among the
// captures: the join's identity, so the arm gives the item's own Int.
// A record of Ints's fold (C42g, how "with") is given each field's
// identity (hows: each field's join), and writes its fields one after
// another for each item.
export interface GpuMap { how: "map" | "keep" | "add" | "max" | "min" | "with"; result: "int" | "bool"; wgsl: string; caps: ("int" | "bool")[]; hows?: ("add" | "max" | "min")[] }

// The kernel's own part: the items in, the answers and the steps out, and
// the budget and the count of items.
const kernel = (entry: string, bool: boolean, fuel: boolean, none: boolean, caps: ("int" | "bool")[], rec?: { name: string; fields: string[] }) => `${fuel ? "" : "var<private> lab_fuel: f32;\n"}${none ? "" : "var<private> lab_none: bool;\n"}
struct LabJob { budget: f32, n: u32 }
@group(0) @binding(0) var<storage, read> lab_xs: array<i32>;
@group(0) @binding(1) var<storage, read_write> lab_out: array<i32>;
@group(0) @binding(2) var<storage, read_write> lab_spent: array<f32>;
@group(0) @binding(3) var<uniform> lab_job: LabJob;${caps.length ? "\n@group(0) @binding(4) var<storage, read> lab_caps: array<i32>;" : ""}
@compute @workgroup_size(64) fn lab_main(@builtin(global_invocation_id) g: vec3u) {
  let i = g.x + g.y * 65535u * 64u;
  if (i >= lab_job.n) { return; }
  lab_fuel = lab_job.budget;
  lab_none = false;
  let r = ${entry}(${["lab_xs[i]", ...(rec ? [`${rec.name}(${rec.fields.map((_, j) => `lab_caps[${j}]`).join(", ")})`] : []), ...caps.slice(rec ? rec.fields.length : 0).map((c, j) => { const at = j + (rec ? rec.fields.length : 0); return c === "bool" ? `lab_caps[${at}] != 0i` : `lab_caps[${at}]`; })].join(", ")});
  if (lab_fuel < 0.0 || lab_none) { lab_spent[i] = -1.0; return; }
${rec ? rec.fields.map((x, j) => `  lab_out[i * ${rec.fields.length}u + ${j}u] = r.${x};`).join("\n") : `  lab_out[i] = ${bool ? "select(0i, 1i, r)" : "r"};`}
  lab_spent[i] = lab_job.budget - lab_fuel;
}
`;

// The kernels by site, for the sites whose function the shader lowering
// takes, with what it captured (Ints and Bools) given after the item.
export function gpuMaps(ir: CoreIR): Record<number, GpuMap> {
  const out: Record<number, GpuMap> = {};
  for (const m of ir.awayMaps ?? []) {
    const node = ir.code.nodes[m.fn];
    const zonk = (x: Id) => { const y = ir.info.typeOf.get(x); return y && ir.info.subst.zonk(y); };
    // A map's function, or a fold's item arm as a function of the item and
    // the rest's Int, run by steps under the handler's budget as a function
    // that may not finish is (Diverge).
    const arm = node?.kind === "arm" && m.params?.length === 2 ? node : null;
    const lam = arm ? { id: m.fn, kind: "lambda" as const, params: m.params!, body: arm.body } : node;
    const it = arm && zonk(m.params![0]), rt = arm && zonk(m.params![1]);
    const t = arm ? (it && rt ? { t: "fn" as const, params: [it, rt], ret: rt, eff: { effs: [DIVERGE], tail: null } } : undefined) : zonk(m.fn);
    if (lam?.kind !== "lambda" || lam.params.length !== (arm ? 2 : 1) || t?.t !== "fn") continue;
    try {
      // The function lifted to a definition taking what it captured after
      // the item, as parameters of the same binders.
      const id = `gpu.${m.site}` as Id, lifted = `gpu.${m.site}.λ` as Id;
      const capTypes = m.caps.map((b) => { const ct = ir.info.typeOf.get(b); return ct && ir.info.subst.zonk(ct); });
      if (capTypes.some((ct) => !ct)) continue;
      const code: Code = { ...ir.code, defs: [...ir.code.defs, id], nodes: { ...ir.code.nodes, [lifted]: { ...lam, id: lifted, params: [...lam.params, ...m.caps] }, [id]: { id, kind: "def", body: lifted } } };
      const ft: Type = { ...t, params: [...t.params, ...(capTypes as Type[])] };
      const info: Info = { ...ir.info, typeOf: new Map(ir.info.typeOf).set(id, ft).set(lifted, ft) };
      const names = { ...(ir as { names?: Names }).names, [id]: `map ${m.site}` } as Names;
      const l = lowerScalar(code, info, names, [id], { records: true, shader: true, stepped: true });
      if (l.refused.has(id)) continue;
      const fi = l.funcs.findIndex((g) => g.def === id && !g.inner);
      const f = l.funcs[fi];
      const before = arm ? 2 : 1;
      // A record of Ints's fold (C42g): the rest and the answer that
      // record, its fields all i32.
      const rec = m.how === "with" && f && typeof f.result === "object" && "fields" in f.result && f.result.fields.length === m.hows?.length && f.result.fields.every((x) => x.t === "int32") && typeof f.params[1] === "object" && "key" in f.params[1] && f.params[1].key === f.result.key ? f.result : null;
      if (m.how === "with" && !rec) continue;
      const flat = f && (rec ? [f.params[0], ...rec.fields.map((x) => x.t), ...f.params.slice(2)] : f.params);
      if (!f || !flat || f.params.length !== before + m.caps.length || flat.some((p) => p !== "int32" && p !== "i32") || flat[0] !== "int32" || (arm && !rec && f.params[1] !== "int32") || (!rec && f.result !== "int32" && f.result !== "i32") || (arm && !rec && f.result !== "int32")) continue;
      const caps = flat.slice(1).map((p) => (p === "i32" ? "bool" : "int") as "int" | "bool");
      if (m.how === "keep" && f.result !== "i32") continue;
      const sh = emitWgsl(l);
      const entry = sh.entries.get(fi), struct = rec && sh.structs.get(rec.key);
      if (!entry || (rec && !struct)) continue;
      out[m.site] = { how: m.how as GpuMap["how"], result: f.result === "i32" ? "bool" : "int", caps, ...(rec ? { hows: m.hows as ("add" | "max" | "min")[] } : {}), wgsl: sh.wgsl + kernel(entry, f.result === "i32", sh.wgsl.includes("var<private> lab_fuel"), sh.wgsl.includes("var<private> lab_none"), caps, struct || undefined) };
    } catch { /* not one the GPU takes */ }
  }
  return out;
}
