// A page's draws on the GPU (BACKLOG G9c, docs/design/targets/FRAMES.md):
// for each `draw(mesh, instances, vertex, fragment)` the lowering met
// (scalar.ts `drawSites`), its two functions printed as one WGSL module, a
// vertex stage and a fragment stage, where the shader lowering takes them.
// The page's runtime (gpu-frame.ts) keeps a pipeline per site and draws
// the mesh once per instance; a site not here is drawn on the CPU
// (raster.ts), as is any draw where there is no WebGPU.
//
// Each function is lifted to a definition taking what it read of the
// place it was written after its own inputs, as gpu-maps.ts lifts a map's,
// so `bird corner(view)` and a lambda reading `view` are both a function
// of (instance, corner, view). The compiled draw is given the same values
// in the same order after its site (scalar.ts), and they go into one
// uniform. Every value crosses as 4-byte words, a leaf each: a Float64 as
// an f32, an Int as an i32, a Bool as 0 or 1, a record as its fields'
// leaves in order. The instances and the mesh's corners each go to one
// storage buffer of such words, an instance or a corner after another;
// the vertex stage takes its instance at `instance_index` and its corner
// at `vertex_index`, the mesh's triangles being the index buffer.
//
// What the vertex function carries goes to the fragment stage as one
// varying per leaf: a Float64 put between the corners in perspective, as
// raster.ts does, anything else the first corner's (`flat`). A fragment
// with no answer is `discard`; a corner with no answer is placed at NaN,
// which GPUs drop (raster.ts drops its triangles).

import type { Code, Id } from "../../ters/src/model.ts";
import { withNodes } from "../../ters/src/model.ts";
import type { Info } from "../../ters/src/lang/infer.ts";
import { NUMBER, type Type } from "../../ters/src/lang/types.ts";
import type { Names } from "../../ters/src/presentation.ts";
import { isRecord, lowerScalar, type CoreIR, type LType, type RType } from "./scalar.ts";
import { emitWgsl, vectorWidth } from "./wgsl.ts";

// The leaves and the site, as the runtime reads them (gpu-frame.ts).
import type { Leaf, Site as DrawSite, Word } from "../../ters/src/lang/gpu-frame.ts";
export type { DrawSite, Leaf, Word };

// A value's leaves, or null when it isn't made of Float64s, Ints, Bools
// and records of them.
export function leavesOf(t: LType, path: number[] = []): Leaf[] | null {
  if (t === "f64") return [{ path, kind: "f32" }];
  if (t === "int32") return [{ path, kind: "i32" }];
  if (t === "i32") return [{ path, kind: "bool" }];
  if (!isRecord(t) || t.mutable) return null;
  const out: Leaf[] = [];
  for (let j = 0; j < t.fields.length; j++) {
    const l = leavesOf(t.fields[j].t, [...path, j]);
    if (!l) return null;
    out.push(...l);
  }
  return out;
}

type Structs = Map<string, { name: string; fields: string[] }>;
// WGSL for a value of type t made from its leaves, `leaf(k, kind)` the
// k-th as a value of its own WGSL type.
function rebuilt(t: LType, structs: Structs, leaf: (k: number, kind: Word) => string, at: { k: number } = { k: 0 }): string {
  if (t === "f64") return leaf(at.k++, "f32");
  if (t === "int32") return leaf(at.k++, "i32");
  if (t === "i32") return leaf(at.k++, "bool");
  const r = t as RType, s = structs.get(r.key);
  if (!s) throw new Error(`no WGSL type for ${r.name}`);
  return `${s.name}(${r.fields.map((f) => rebuilt(f.t, structs, leaf, at)).join(", ")})`;
}
// A leaf from the k-th u32 of a buffer.
const fromWord = (word: (k: number) => string) => (k: number, kind: Word) => (kind === "f32" ? `bitcast<f32>(${word(k)})` : kind === "i32" ? `bitcast<i32>(${word(k)})` : `(${word(k)} != 0u)`);
// WGSL reading field j of e, a value of record type t.
const field = (e: string, t: RType, j: number, structs: Structs) => `${e}.${structs.get(t.key)!.fields[j]}`;
// WGSL reading a leaf of e, of type t.
function leafAt(e: string, t: LType, path: number[], structs: Structs): string {
  let x = e, ty = t;
  for (const j of path) { x = field(x, ty as RType, j, structs); ty = (ty as RType).fields[j].t; }
  return x;
}

// Whether e reads binder b.
const reads = (nodes: Code["nodes"], e: Id, b: Id): boolean => {
  const n = nodes[e];
  if (!n) return false;
  if (n.kind === "ref") return n.target === b;
  return Object.values(n).some((v) => (typeof v === "string" && v !== e && v !== n.kind && nodes[v] && nodes[v].kind !== "def" && reads(nodes, v, b)) || (Array.isArray(v) && v.some((x) => typeof x === "string" && nodes[x] && reads(nodes, x, b))) || (v && typeof v === "object" && !Array.isArray(v) && Object.values(v).some((x) => typeof x === "string" && nodes[x] && reads(nodes, x, b))));
};
const NUMBER_T: Type = { t: "con", id: NUMBER, args: [] };

export function gpuDraws(ir: CoreIR): { sites: Record<number, DrawSite>; refused: Map<number, string> } {
  const sites: Record<number, DrawSite> = {}, refused = new Map<number, string>();
  for (const d of ir.drawSites ?? []) {
    try { sites[d.site] = drawSite(ir, d.site, d.vertex, d.fragment, d.caps); }
    catch (e) { refused.set(d.site, e instanceof Error ? e.message : String(e)); }
  }
  return { sites, refused };
}

function drawSite(ir: CoreIR, site: number, vertex: Id, fragment: Id, caps: Id[]): DrawSite {
  const zonk = (x: Id) => { const y = ir.info.typeOf.get(x); return y && ir.info.subst.zonk(y); };
  const capTypes = caps.map(zonk);
  if (capTypes.some((t) => !t)) throw new Error("reads a value whose type isn't known");
  let nodes = ir.code.nodes;
  const typeOf = new Map(ir.info.typeOf);
  const defs: Id[] = [];
  // Each function lifted: (its inputs…, what it read…) ↦ it applied to its
  // inputs. A lambda written there keeps its body; anything else (a call
  // giving a function, a definition) is called with the inputs.
  let unread = false;
  const lift = (e: Id, which: string, arity: number): Id => {
    const t = zonk(e);
    if (t?.t !== "fn" || t.params.length !== arity) throw new Error(`its ${which} function isn't a function of ${arity} inputs`);
    const lam = nodes[e], id = `draw.${site}.${which}` as Id, lifted = `${id}.λ` as Id;
    let params: Id[], body: Id;
    let given = t.params;
    if (lam?.kind === "lambda" && lam.params.length === arity) {
      ({ params, body } = lam);
      // An instance the vertex function doesn't read (the floor drawn
      // once for the whole state) crosses as nothing: a Float64 stands in.
      if (which === "vertex" && !reads(nodes, body, params[0])) { given = [NUMBER_T, ...t.params.slice(1)]; unread = true; }
    }
    else {
      params = t.params.map((_, j) => `${id}.in${j}` as Id);
      const refs = params.map((p) => `${p}.ref` as Id), call = `${id}.call` as Id;
      nodes = withNodes(nodes, { ...Object.fromEntries(params.map((p) => [p, { id: p, kind: "binder" as const }])), ...Object.fromEntries(refs.map((r, j) => [r, { id: r, kind: "ref" as const, target: params[j] }])), [call]: { id: call, kind: "call", fn: e, args: refs } });
      params.forEach((p, j) => { typeOf.set(p, t.params[j]); typeOf.set(refs[j], t.params[j]); });
      typeOf.set(call, t.ret);
      body = call;
    }
    nodes = withNodes(nodes, { [lifted]: { id: lifted, kind: "lambda", params: [...params, ...caps], body }, [id]: { id, kind: "def", body: lifted } });
    const ft: Type = { t: "fn", params: [...given, ...(capTypes as Type[])], ret: t.ret, eff: { effs: [], tail: null } };
    typeOf.set(id, ft).set(lifted, ft);
    defs.push(id);
    return id;
  };
  const vId = lift(vertex, "vertex", 2), fId = lift(fragment, "fragment", 1);
  const code: Code = { ...ir.code, defs: [...ir.code.defs, ...defs], nodes };
  const info: Info = { ...ir.info, typeOf };
  const names = { ...(ir as { names?: Names }).names, [vId]: `draw ${site} vertex`, [fId]: `draw ${site} fragment` } as Names;
  const l = lowerScalar(code, info, names, defs, { records: true, shader: true, reached: true });
  for (const [id, which] of [[vId, "vertex"], [fId, "fragment"]] as const) if (l.refused.has(id)) throw new Error(`its ${which} function ${l.refused.get(id)}`);
  const vi = l.funcs.findIndex((g) => g.def === vId && !g.inner), fi = l.funcs.findIndex((g) => g.def === fId && !g.inner);
  const vf = l.funcs[vi], ff = l.funcs[fi];
  const sh = emitWgsl(l);
  const vEntry = sh.entries.get(vi), fEntry = sh.entries.get(fi);
  if (!vEntry) throw new Error(`its vertex function ${sh.refused.get(vId) ?? "can't run on the GPU"}`);
  if (!fEntry) throw new Error(`its fragment function ${sh.refused.get(fId) ?? "can't run on the GPU"}`);
  const structs = sh.structs;
  // The inputs' leaves: the instance, the corner, then each value read.
  const [it, ct] = vf.params, capLs = vf.params.slice(2);
  const instance = unread ? [] : leavesOf(it), corner = leavesOf(ct), capLeaves = capLs.map((t) => leavesOf(t));
  if (!instance) throw new Error("its instances aren't records of Float64s, Ints and Bools");
  if (!corner) throw new Error("its mesh's corners aren't records of Float64s, Ints and Bools");
  if (capLeaves.some((x) => !x)) throw new Error("reads a value that isn't Float64s, Ints, Bools or records of them");
  // The placed corner: its position (2 to 4 Float64s, or one record of
  // them) and what it carries.
  const placed = vf.result;
  if (!isRecord(placed) || placed.fields.length !== 2) throw new Error("its vertex function doesn't give a placed corner");
  const pos = placed.fields[0].t, carriedT = placed.fields[1].t;
  const width = vectorWidth(pos) || (isRecord(pos) && pos.fields.length >= 2 && pos.fields.length <= 4 && pos.fields.every((x) => x.t === "f64") ? pos.fields.length : 0);
  if (!width) throw new Error("its corners' positions aren't 2 to 4 Float64s");
  const carried = leavesOf(carriedT);
  if (!carried) throw new Error("what its vertex function carries isn't Float64s, Ints, Bools or records of them");
  // The fragment takes what the vertex carries, leaf for leaf; a number
  // nothing fixed (`placed(p, 0)`) may be an Int on one side and a Float64
  // on the other, and is converted.
  const taken = leavesOf(ff.params[0]);
  if (!taken || taken.length !== carried.length || taken.some((x, k) => x.path.join() !== carried[k].path.join() || (x.kind === "bool") !== (carried[k].kind === "bool"))) throw new Error("its fragment function takes something other than what the vertex carries");
  const colourT = ff.result;
  const colour = isRecord(colourT) && (colourT.fields.length === 3 || colourT.fields.length === 4) && colourT.fields.every((x) => x.t === "f64") ? colourT.fields.length as 3 | 4 : null;
  if (!colour) throw new Error("its fragment function doesn't give a colour of 3 or 4 Float64s");

  const words = capLeaves.reduce((n, x) => n + x!.length, 0);
  const capWord = (k: number) => `lab_caps[${k >> 2}].${"xyzw"[k & 3]}`;
  const at = { k: 0 };
  const capsWgsl = capLs.map((t) => rebuilt(t, structs, fromWord(capWord), at));
  const nI = instance.length, nC = corner.length;
  const fuel = sh.wgsl.includes("var<private> lab_fuel"), none = sh.wgsl.includes("var<private> lab_none");
  const start = `${fuel ? "  lab_fuel = 1.0e30;\n" : ""}${none ? "  lab_none = false;\n" : ""}`;
  // One varying per carried leaf.
  const vary = carried.map((x, j) => `  ${x.kind === "f32" ? "" : "@interpolate(flat) "}@location(${j}) c${j}: ${x.kind === "f32" ? "f32" : x.kind === "i32" ? "i32" : "u32"},`);
  const posPart = (j: number) => `${leafAt("p", placed, [0], structs)}.${structs.get((pos as RType).key)!.fields[j]}`;
  const clip = `vec4f(${posPart(0)}, ${posPart(1)}, ${width > 2 ? posPart(2) : "0.0"}, ${width > 3 ? posPart(3) : "1.0"})`;
  const carry = carried.map((x, j) => {
    const e = leafAt(`${leafAt("p", placed, [1], structs)}`, carriedT, x.path, structs);
    return `  o.c${j} = ${x.kind === "bool" ? `select(0u, 1u, ${e})` : e};`;
  });
  const v = rebuilt(ff.params[0], structs, (j, kind) => (kind === "bool" ? `(o.c${j} != 0u)` : kind === carried[j].kind ? `o.c${j}` : `${kind}(o.c${j})`));
  const k = ["x", "y", "z", "w"].slice(0, colour).map((_, j) => leafAt("k", colourT, [j], structs));
  const wgsl = `${sh.wgsl}
@group(0) @binding(0) var<uniform> lab_caps: array<vec4u, ${Math.max(1, Math.ceil(words / 4))}>;
@group(0) @binding(1) var<storage, read> lab_inst: array<u32>;
@group(0) @binding(2) var<storage, read> lab_corner: array<u32>;
struct LabPlaced {
  @builtin(position) position: vec4f,
${vary.join("\n")}
}
@vertex fn lab_vs(@builtin(vertex_index) lab_vi: u32, @builtin(instance_index) lab_ii: u32) -> LabPlaced {
  // Every binding read, so the layout made from the module has all three.
  _ = lab_caps[0]; _ = lab_inst[0]; _ = lab_corner[0];
${start}  let p = ${vEntry}(${[unread ? "0.0" : rebuilt(it, structs, fromWord((j) => `lab_inst[lab_ii * ${nI}u + ${j}u]`)), rebuilt(ct, structs, fromWord((j) => `lab_corner[lab_vi * ${nC}u + ${j}u]`)), ...capsWgsl].join(", ")});
  var o: LabPlaced;
  o.position = ${clip};
${carry.join("\n")}
${fuel || none ? `  if (${[fuel ? "lab_fuel < 0.0" : "", none ? "lab_none" : ""].filter(Boolean).join(" || ")}) { o.position = vec4f(bitcast<f32>(0x7fc00000u)); }\n` : ""}  return o;
}
@fragment fn lab_fs(o: LabPlaced) -> @location(0) vec4f {
${start}  let k = ${fEntry}(${[v, ...capsWgsl].join(", ")});
${fuel || none ? `  if (${[fuel ? "lab_fuel < 0.0" : "", none ? "lab_none" : ""].filter(Boolean).join(" || ")}) { discard; }\n` : ""}  return vec4f(${k[0]}, ${k[1]}, ${k[2]}, ${colour === 4 ? k[3] : "1.0"});
}
`;
  return { wgsl, caps: capLeaves as Leaf[][], instance, corner, colour };
}
