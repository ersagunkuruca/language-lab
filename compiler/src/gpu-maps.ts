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
import { withNodes } from "../../ters/src/model.ts";
import { leavesOf, type Leaf } from "./gpu-draws.ts";
import { isFloat32, isRecord, kids, type LType, type RType, type SExpr } from "./scalar.ts";
import { vectorWidth } from "./wgsl.ts";

// caps: what the function captured, in the closure's order, each an Int
// or a Bool, which the kernel is given after the item.
// A fold's (C42f) is its item's arm, given the rest's Int first among the
// captures: the join's identity, so the arm gives the item's own Int.
// A record of Ints's fold (C42g, how "with") is given each field's
// identity (hows: each field's join), and writes its fields one after
// another for each item.
// `words` (G12): a map or keep of records (rain-page's drops), the item,
// each capture and the answer crossing as 4-byte words, a leaf each, as a
// draw's do (gpu-draws.ts): a Float32 an f32, an Int an i32, a Bool 0 or 1.
// `close` (G12): why its arithmetic is only close to the CPU's, a kernel
// made only where the program's decisions hold its map on the GPU so.
export interface GpuMap { how: "map" | "keep" | "add" | "max" | "min" | "with"; result: "int" | "bool" | "words"; wgsl: string; caps: ("int" | "bool")[]; hows?: ("add" | "max" | "min")[]; words?: { item: Leaf[]; caps: Leaf[][]; out: Leaf[] }; close?: string }

// The maps a person held on the GPU though its arithmetic is only close
// (the program's decisions, `GPU close`, G12), by the function's id: their
// answers may differ from the CPU's in the last bits.
let closeHeld: ReadonlySet<Id> = new Set();
export function allowClose(fns: Iterable<Id>) { closeHeld = new Set(fns); }

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

// A kernel of records (G12): the item and the captures read from words,
// the answer's leaves written as words, `size` of them an item.
type Structs = Map<string, { name: string; fields: string[] }>;
function rebuilt(t: LType, structs: Structs, word: (k: number) => string, at = { k: 0 }): string {
  if (t === "f64") return `bitcast<f32>(${word(at.k++)})`;
  if (t === "int32") return `bitcast<i32>(${word(at.k++)})`;
  if (t === "i32") return `(${word(at.k++)} != 0u)`;
  const r = t as RType, st = structs.get(r.key);
  if (!st) throw new Error(`no WGSL type for ${r.name}`);
  return `${st.name}(${r.fields.map((x) => rebuilt(x.t, structs, word, at)).join(", ")})`;
}
function leafAt(e: string, t: LType, path: number[], structs: Structs): string {
  let x = e, ty = t;
  for (const j of path) { const r = ty as RType; x = `${x}.${structs.get(r.key)!.fields[j]}`; ty = r.fields[j].t; }
  return x;
}
const recordKernel = (entry: string, fuel: boolean, none: boolean, item: LType, caps: LType[], result: LType, out: Leaf[], structs: Structs) => {
  const size = (leavesOf(item) ?? []).length;
  let at = 0;
  const capArgs = caps.map((c) => { const k = { k: at }; const e = rebuilt(c, structs, (j) => `lab_caps[${j}]`, k); at = k.k; return e; });
  const word = (l: Leaf) => { const x = result === "i32" ? "r" : leafAt("r", result, l.path, structs); return l.kind === "bool" ? `select(0u, 1u, ${x})` : `bitcast<u32>(${x})`; };
  return `${fuel ? "" : "var<private> lab_fuel: f32;\n"}${none ? "" : "var<private> lab_none: bool;\n"}
struct LabJob { budget: f32, n: u32 }
@group(0) @binding(0) var<storage, read> lab_xs: array<u32>;
@group(0) @binding(1) var<storage, read_write> lab_out: array<u32>;
@group(0) @binding(2) var<storage, read_write> lab_spent: array<f32>;
@group(0) @binding(3) var<uniform> lab_job: LabJob;${at ? "\n@group(0) @binding(4) var<storage, read> lab_caps: array<u32>;" : ""}
@compute @workgroup_size(64) fn lab_main(@builtin(global_invocation_id) g: vec3u) {
  let i = g.x + g.y * 65535u * 64u;
  if (i >= lab_job.n) { return; }
  lab_fuel = lab_job.budget;
  lab_none = false;
  let r = ${entry}(${[rebuilt(item, structs, (j) => `lab_xs[i * ${size}u + ${j}u]`), ...capArgs].join(", ")});
  if (lab_fuel < 0.0 || lab_none) { lab_spent[i] = -1.0; return; }
${out.map((l, k) => `  lab_out[i * ${out.length}u + ${k}u] = ${word(l)};`).join("\n")}
  lab_spent[i] = lab_job.budget - lab_fuel;
}
`;
};

// Whether a value's every Float64 is a Float32's (L286): one rounded at
// every step on the CPU, as an f32 is on the GPU. A Float64 of its own is
// rounded only on the GPU, so its answers wouldn't be the CPU's.
function float32sOnly(t: LType): boolean {
  if (t === "f64") return false;
  if (!isRecord(t)) return true;
  return isFloat32(t) || t.fields.every((x) => float32sOnly(x.t));
}
// Why the GPU's arithmetic wouldn't be the CPU's, or null when it is
// (G12). Addition, subtraction and multiplication are correctly rounded in
// WGSL, as on the CPU, but division, square roots and the rest are only
// close; a step not rounded to a Float32 on the CPU is a Float64's, which
// the GPU rounds; and a GPU may fuse a·b + c into one rounding, so a
// product is only taken where it is exact: by a power of two.
const CLOSE = new Set(["div", "sqrt", "sin", "cos", "tan", "exp", "log", "pow", "atan2", "mod"]);
// An Int made a number is exact: the kernel gives up past 2²⁴ (wgsl.ts).
const ROUNDED = new Set(["add", "sub", "mul"]);
// What is known of a value: true where it is a power of two (a number, or
// a Float32 holding one), a record's fields each, false where not known,
// undefined not known yet.
type Known = boolean | Known[] | undefined;
const both = (a: Known, b: Known): Known => (a === undefined ? b : b === undefined ? a : Array.isArray(a) && Array.isArray(b) && a.length === b.length ? a.map((x, j) => both(x, b[j])) : a === true && b === true);
const twoPower = (v: number) => v !== 0 && Number.isFinite(v) && Math.log2(Math.abs(v)) % 1 === 0;
export function inexact(ir: CoreIR, entry: number): string | null {
  if (ir.records.some((r) => vectorWidth(r))) return "a record of Float64s the GPU holds as a vector";
  // Each call followed with what it is given: a Float32 constant (rain-
  // page's pull, 2⁻⁷) reaches the library's multiply as its input, where
  // the same multiply given other numbers elsewhere is another call.
  let why: string | null = null;
  const done = new Map<string, Known>(), going = new Set<string>();
  const called = (fn: number, xs: Known[]): Known => {
    const key = `${fn}:${JSON.stringify(xs)}`;
    if (done.has(key)) return done.get(key);
    // Round again (a loop): nothing known of it.
    if (going.has(key)) return false;
    going.add(key);
    const env = [...xs];
    const r = value(ir.funcs[fn].body, env);
    if (why && !why.includes(": ")) why = `${ir.funcs[fn].name}: ${why}`;
    going.delete(key);
    done.set(key, r);
    return r;
  };
  const value = (e: SExpr, env: Known[], rounded = false): Known => {
    switch (e.k) {
      case "num":
        if (Number.isFinite(e.v) && Math.fround(e.v) !== e.v) why ??= `${e.v} isn't a Float32`;
        return twoPower(e.v);
      case "local": return env[e.i] ?? false;
      case "let": env[e.i] = value(e.value, env); return value(e.body, env);
      case "if": value(e.cond, env); return both(value(e.then, env), value(e.else, env));
      case "make": return e.args.map((a) => value(a, env));
      case "get": { const r = value(e.rec, env); return Array.isArray(r) ? r[e.i] : false; }
      case "call": return called(e.fn, e.args.map((a) => value(a, env)));
      case "op": {
        if (CLOSE.has(e.op)) why ??= `${e.op} isn't correctly rounded on the GPU`;
        if (ROUNDED.has(e.op) && !rounded) why ??= `a Float64's ${e.op}`;
        const xs = e.args.map((a) => value(a, env, e.op === "float32"));
        if (e.op === "mul" && !xs.some((x) => x === true)) why ??= "a product the GPU may fuse with a sum";
        return e.op === "float32" || e.op === "neg" ? xs[0] : false;
      }
      default: for (const k of kids(e)) value(k, env); return false;
    }
  };
  called(entry, ir.funcs[entry].params.map(() => false));
  return why;
}

// The kernels by site, for the sites whose function the shader lowering
// takes, with what it captured (Ints and Bools) given after the item.
// A map whose arithmetic is only close has one where `close` has its
// function (those held, or "all" for the placements the compiler offers).
export function gpuMaps(ir: CoreIR, close: "all" | ReadonlySet<Id> = closeHeld): Record<number, GpuMap> {
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
      const code: Code = { ...ir.code, defs: [...ir.code.defs, id], nodes: withNodes(ir.code.nodes, { [lifted]: { ...lam, id: lifted, params: [...lam.params, ...m.caps] }, [id]: { id, kind: "def", body: lifted } }) };
      const ft: Type = { ...t, params: [...t.params, ...(capTypes as Type[])] };
      const info: Info = { ...ir.info, typeOf: new Map(ir.info.typeOf).set(id, ft).set(lifted, ft) };
      const names = { ...(ir as { names?: Names }).names, [id]: `map ${m.site}` } as Names;
      const l = lowerScalar(code, info, names, [id], { records: true, shader: true, stepped: true, reached: true });
      if (l.refused.has(id)) continue;
      const fi = l.funcs.findIndex((g) => g.def === id && !g.inner);
      const f = l.funcs[fi];
      const before = arm ? 2 : 1;
      // A map or keep of records (G12), where every leaf crosses as a word
      // and the GPU's arithmetic is the CPU's.
      if (f && !arm && (m.how === "map" || m.how === "keep") && [...f.params, f.result].some((t) => typeof t === "object")) {
        const item = f.params[0], caps = f.params.slice(1), result = f.result;
        const leaves = [item, ...caps].map((t) => leavesOf(t)), outs = m.how === "keep" ? (result === "i32" ? [{ path: [], kind: "bool" as const }] : null) : leavesOf(result);
        // A map's answer is made like its item (the runtime has only the
        // item's class to make one with), or is a single leaf.
        const like = m.how === "keep" || typeof result !== "object" || (isRecord(result) && isRecord(item) && result.key === item.key);
        if (leaves.some((x) => !x) || !outs || !like || ![item, ...caps, result].every(float32sOnly)) continue;
        const why = inexact(l, fi);
        if (why && close !== "all" && !close.has(m.fn)) continue;
        const sh = emitWgsl(l, { kernel: true }), entry = sh.entries.get(fi);
        if (!entry || sh.matrices.size) continue;
        out[m.site] = { how: m.how, result: "words", caps: [], words: { item: leaves[0]!, caps: leaves.slice(1) as Leaf[][], out: outs }, wgsl: sh.wgsl + recordKernel(entry, sh.wgsl.includes("var<private> lab_fuel"), sh.wgsl.includes("var<private> lab_none"), item, caps, result, outs, sh.structs), ...(why ? { close: why } : {}) };
        continue;
      }
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
