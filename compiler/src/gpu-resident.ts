// Lists that can stay on the GPU between a page's ticks (G13a,
// docs/design/targets/GPU-DATA.md). rain-page keeps its drops in a record
// field, `Pane.drops`; each tick a map with a kernel (gpu-maps.ts) slides
// them and the frame draws them. Nothing on the CPU looks at a drop, so
// the drops need never come back from the GPU.
//
// A record's list field stays when every read of it goes only to:
//   - the items of a page's map away whose site has a kernel of words
//     (G12b), and the count that map's worth takes (`map.worth`), its
//     items on the CPU taken only where the map isn't worth sending;
//   - a draw's instances (`frame.draw`, gpu-draws.ts);
//   - the same field of a record of the same type (a copy);
// through lets and the definitions it is given to. And the map's answers
// from its kernel go only into that field again (through its rest, `k`,
// and what that calls), so they can stay there too: those sites are
// `sites`. No value holding the record goes to anything but the page's
// cells (which hold it, and compare a list on the GPU as itself) or the
// definitions it is given to; and no function sent away captures one.
//
// Walked in the lowered core IR, where the maps' and draws' sites are.

import type { Id } from "../../ters/src/model.ts";
import type { CoreIR, LType, RType, SExpr } from "./scalar.ts";
import { kids } from "./scalar.ts";
import type { GpuMap } from "./gpu-maps.ts";
import { gpuDraws, type DrawSite } from "./gpu-draws.ts";

// A list field kept on the GPU, by its record type's key and its place,
// with the field's node (`at`, its id in the program) and names.
export interface ResidentField { key: string; i: number; at: Id; type: string; field: string }
// `sites`: the maps' sites whose answers stay; `draws`: the draws' sites
// given the field's lists as their instances.
export interface Resident { fields: ResidentField[]; sites: number[]; draws: number[] }

// Where an expression is: its parent, and which of the parent's kids it is.
interface At { e: SExpr; up: At | null; kid: number; fn: number }

const contains = (t: LType, key: string, seen = new Set<object>()): boolean => {
  if (typeof t !== "object" || seen.has(t)) return false;
  seen.add(t);
  if ("fields" in t && "variant" in t) return t.key === key || t.fields.some((f) => contains(f.t, key, seen));
  if ("cases" in t) return t.cases.some((c) => c.fields.some((f) => contains(f.t, key, seen)));
  if ("item" in t) return contains(t.item, key, seen);
  if ("keyT" in t) return contains(t.value, key, seen);
  return false;
};
const isRec = (t: LType): t is RType => typeof t === "object" && "fields" in t && "variant" in t;
const isList = (t: LType) => typeof t === "object" && ("item" in t || ("cases" in t && t.cases.length === 2));

// The fields a person held on the CPU (the program's decisions, G13a), by
// the field's node.
let onCpu: ReadonlySet<Id> = new Set();
export function holdOnCpu(fields: Iterable<Id>) { onCpu = new Set(fields); }
export function residentLists(ir: CoreIR, kernels: Record<number, GpuMap>, held: ReadonlySet<Id> = onCpu): Resident {
  const out: Resident = { fields: [], sites: [], draws: [] };
  if (!ir.awayMaps?.length) return out;
  // Every expression with where it is, and each function's locals' uses
  // and the calls of it.
  const all: At[] = [], uses = new Map<string, At[]>(), callsOf = new Map<number, At[]>(), asValue = new Set<number>();
  const walk = (e: SExpr, up: At | null, kid: number, fn: number) => {
    const at: At = { e, up, kid, fn };
    all.push(at);
    if (e.k === "local") { const k = `${fn}:${e.i}`; uses.set(k, [...(uses.get(k) ?? []), at]); }
    if (e.k === "call") callsOf.set(e.fn, [...(callsOf.get(e.fn) ?? []), at]);
    if (e.k === "closure") asValue.add(e.fn);
    kids(e).forEach((c, j) => walk(c, at, j, fn));
  };
  ir.funcs.forEach((f, i) => walk(f.body, null, 0, i));
  const typeOf = (e: SExpr, fn: number): LType | undefined => {
    switch (e.k) {
      case "local": return ir.funcs[fn].locals[e.i] ?? ir.funcs[fn].params[e.i];
      case "get": return e.t.fields[e.i]?.t;
      case "make": return e.t;
      case "new": case "list": return e.t;
      case "field": return e.t.cases[e.c]?.fields[e.i]?.t;
      case "call": return ir.funcs[e.fn]?.result;
      case "apply": return e.t.result;
      case "if": return e.t;
      case "let": return typeOf(e.body, fn);
      case "case": return e.result;
      case "closure": case "cap": return e.t;
      case "rt": return e.host?.t;
      case "world": return e.t;
      default: return undefined;
    }
  };
  // Whether a use is the CPU's map in the else of `if map.worth(x, s)`,
  // which a list on the GPU never takes (the runtime's worth says yes).
  const worthElse = (at: At, local: number): boolean => {
    for (let a: At | null = at; a?.up; a = a.up) {
      const p = a.up.e;
      if (p.k === "if" && a.kid === 2 && p.cond.k === "rt" && p.cond.fn === "map.worth" && p.cond.args[0]?.k === "local" && p.cond.args[0].i === local) return true;
    }
    return false;
  };
  const siteOf = (e: SExpr) => (e.k === "world" && e.op === "mapAway" && e.args[3]?.k === "num" ? e.args[3].v : -1);
  const words = (s: number) => kernels[s]?.result === "words";

  for (const r of ir.records) {
    const variant = ir.code.nodes[r.variant];
    r.fields.forEach((f, i) => {
      if (!isList(f.t) || variant?.kind !== "variant") return;
      const at = variant.fields[i];
      if (!at || held.has(at)) return;
      const sites = new Set<number>(), draws = new Set<number>();
      // Whether a value at `a` goes only where a list on the GPU may go;
      // `answers`: a map's answers (true) or a read of the field (false).
      const known = new Map<string, boolean>();
      const goes = (a: At, answers: boolean): boolean => {
        const p = a.up;
        if (!p) {
          // A function's answer: to wherever its calls go, if nothing calls
          // it as a value.
          if (asValue.has(a.fn)) return false;
          return (callsOf.get(a.fn) ?? []).every((c) => goes(c, answers));
        }
        const e = p.e;
        switch (e.k) {
          case "let":
            if (a.kid === 1) return goes(p, answers);
            return local(a.fn, e.i, answers);
          case "if": return a.kid !== 0 && goes(p, answers);
          case "case": return a.kid !== 0 && goes(p, answers);
          case "budget": case "attempt": case "handle": case "released": return goes(p, answers);
          case "make": return e.t.key === r.key && a.kid === i;
          case "call": return local(e.fn, a.kid, answers);
          case "rt":
            if (!answers && e.fn === "map.worth" && a.kid === 0) return true;
            if (!answers && /builtin\.frame\.draw$/.test(e.fn) && a.kid === 1 && e.args[4]?.k === "num") { draws.add(e.args[4].v); return true; }
            return false;
          case "world": {
            const s = siteOf(e);
            if (!answers && a.kid === 0 && s >= 0 && words(s)) { sites.add(s); return true; }
            return false;
          }
          default: return false;
        }
      };
      // A local's uses, each walked once: one met again while it is being
      // walked (a definition calling itself) is taken to go where the
      // rest do.
      const local = (fn: number, i: number, answers: boolean): boolean => {
        const k = `${fn}:${i}:${answers}`;
        const was = known.get(k);
        if (was !== undefined) return was;
        known.set(k, true);
        const ok = (uses.get(`${fn}:${i}`) ?? []).every((u) => (!answers && worthElse(u, i)) || goes(u, answers));
        known.set(k, ok);
        return ok;
      };
      const reads = all.filter((a) => a.e.k === "get" && a.e.t.key === r.key && a.e.i === i);
      if (!reads.length || !reads.every((a) => goes(a, false)) || !sites.size) return;
      // Nothing that holds the record goes to an operation, a host's call
      // but the cells', a list or a case's value, or away in a closure.
      const away = new Set(ir.awayMaps!.map((m) => m.site));
      const leaks = all.some((a) => {
        const p = a.up, t = typeOf(a.e, a.fn);
        if (!p || !t || !contains(t, r.key)) return false;
        const e = p.e;
        if (e.k === "op" || e.k === "new" || e.k === "list") return true;
        if (e.k === "rt") return !/^host:builtin\.cells\.(cell|read|write)(:|$)/.test(e.fn);
        if (e.k === "world") return e.op !== "mapAway" || a.kid === 1 || !away.has(siteOf(e));
        if (e.k === "closure") { for (let c: At = p; c.up; c = c.up) if (c.up.e.k === "world" && c.up.e.op === "mapAway" && c.kid === 1) return true; }
        return false;
      });
      if (leaks) return;
      // The maps whose answers go back into the field.
      for (const s of sites) {
        const w = all.find((a) => siteOf(a.e) === s)!.e as Extract<SExpr, { k: "world" }>;
        const k = w.args[w.args.length - 1];
        if (k?.k !== "closure" || !local(k.fn, 1, true)) sites.delete(s);
      }
      if (!sites.size) return;
      out.fields.push({ key: r.key, i, at, type: r.name, field: f.name });
      for (const s of sites) if (!out.sites.includes(s)) out.sites.push(s);
      for (const d of draws) if (!out.draws.includes(d)) out.draws.push(d);
    });
  }
  out.sites.sort((a, b) => a - b);
  out.draws.sort((a, b) => a - b);
  return out;
}

// What a page keeps on the GPU (G13b): the resident lists, and its draws,
// those given a kept list laid out as its kernel's answers are, so the
// kernel's buffer is the draw's instances as it is. Where a draw's
// instance isn't the kernel's answer leaf for leaf, nothing is kept.
export function keptOnGpu(ir: CoreIR, kernels: Record<number, GpuMap>, held: ReadonlySet<Id> = onCpu): { resident: Resident; draws: Record<number, DrawSite> } {
  const resident = residentLists(ir, kernels, held), none = { fields: [], sites: [], draws: [] };
  if (!resident.fields.length) return { resident: none, draws: ir.drawSites ? gpuDraws(ir).sites : {} };
  const draws = gpuDraws(ir, new Set(resident.draws)).sites;
  const same = (a: { path: number[]; kind: string }[], b: { path: number[]; kind: string }[]) => a.length === b.length && a.every((x, j) => x.kind === b[j].kind && x.path.join() === b[j].path.join());
  const ok = resident.sites.every((s) => kernels[s]?.words && resident.draws.every((d) => draws[d] && same(draws[d].instance, kernels[s].words!.out) && same(kernels[s].words!.item, kernels[s].words!.out)));
  return ok ? { resident, draws } : { resident: none, draws: ir.drawSites ? gpuDraws(ir).sites : {} };
}
