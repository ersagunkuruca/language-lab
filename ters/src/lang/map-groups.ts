// A library type's uses grouped by the type of its first argument (C358):
// a Map's sites by their key type, so each group can be stored its own way.
// crew's maps keyed by name are put into and read once per task, and its
// map keyed by worker number, about four of them, gives its smallest key
// in a loop: a hash table suits the first and a tree the second, and one
// choice for every Map gave both the tree.
//
// A site is a reference to one of the type's jobs, in a definition main
// reaches (never inside a job's own body, which its row replaces). Its
// key is the type its Map is used at there. In a definition generic in
// the key (crew's `still waiting`, on any `Map a Int`), the key is what
// the definition's callers give that variable, and theirs in turn: a
// variable some callers give one key and others another, or none, has no
// one group, and the program isn't grouped. Every site's group is the key
// type's name (its constructor's id); a site whose key isn't a named type
// (a function, a tuple of variables) isn't grouped either.

import { dependenciesOfAll, subtree, type Code, type Id, type NodeOf } from "../model.ts";
import type { Info } from "./infer.ts";
import { holders, madeOrMatched } from "./represent.ts";
import type { Type } from "./types.ts";

// `of`: each site's group; `inDef`: the groups of each definition's sites.
export interface Groups { of: Map<Id, string>; heads: string[]; inDef: Map<Id, Set<string>> }

// `jobs`: the ids that are the type's jobs (its rows' costed ids);
// `roots`: what the rewrite reaches from (main, and the program's own
// definitions, which are checked again whether main calls them or not).
// Null where some site has no one key.
export function keyGroups(code: Code, info: Info, roots: Id[], ty: Id, jobs: ReadonlySet<Id>): Groups | null {
  const zonk = (t: Type) => info.subst.zonk(t);
  const isDef = (d: Id) => code.nodes[d]?.kind === "def";
  // And as the rewrite does (represent.ts): a type holding a Map (a
  // priority queue's entries) takes every definition making or matching
  // it, reached or not, since the program is checked again whole.
  const seen = new Set<Id>();
  const todo = [...roots];
  let makers: Map<Id, Id[]> | null = null;
  const makersOf = (h: Id): Id[] => {
    if (!makers) { makers = new Map(); for (const d of code.defs) for (const t of madeOrMatched(code, d)) (makers.get(t) ?? makers.set(t, []).get(t)!).push(d); }
    return makers.get(h) ?? [];
  };
  while (todo.length) {
    const d = todo.pop()!;
    if (seen.has(d) || !isDef(d) || jobs.has(d)) continue;
    seen.add(d);
    for (const x of dependenciesOfAll(code, [d])) if (!seen.has(x)) todo.push(x);
    for (const h of holders(code, d, ty)) todo.push(h, ...makersOf(h));
  }
  const reach = [...seen];
  // Each node's definition, and each definition's references to others.
  const owner = new Map<Id, Id>();
  for (const d of reach) for (const x of subtree(code, d)) if (!owner.has(x)) owner.set(x, d);
  const callers = new Map<Id, Id[]>();
  for (const d of reach) for (const x of subtree(code, d)) {
    const n = code.nodes[x];
    if (n.kind === "ref" && isDef(n.target) && n.target !== d) (callers.get(n.target) ?? callers.set(n.target, []).get(n.target)!).push(x);
  }
  // The keys of every `ty` inside t, zonked.
  const keysIn = (t: Type, out: Type[] = []): Type[] => {
    t = zonk(t);
    if (t.t === "con") { if (t.id === ty && t.args[0]) out.push(zonk(t.args[0])); t.args.forEach((a) => keysIn(a, out)); }
    else if (t.t === "fn") [...t.params, t.ret].forEach((a) => keysIn(a, out));
    return out;
  };
  // The type a scheme's variable is given where the definition is used
  // at `inst`: matched structurally.
  const bound = (pattern: Type, inst: Type, v: number): Type | undefined => {
    inst = zonk(inst);
    if (pattern.t === "var") return pattern.v === v ? inst : undefined;
    if (pattern.t === "con" && inst.t === "con") { for (let i = 0; i < pattern.args.length; i++) { const b = inst.args[i] && bound(pattern.args[i], inst.args[i], v); if (b) return b; } return undefined; }
    if (pattern.t === "fn" && inst.t === "fn") { const ps = [...pattern.params, pattern.ret], is = [...inst.params, inst.ret]; for (let i = 0; i < ps.length; i++) { const b = is[i] && bound(ps[i], is[i], v); if (b) return b; } }
    return undefined;
  };
  // The named types a variable of definition d stands for, through its
  // callers; null where one isn't named.
  const resolving = new Set<string>();
  const headsOf = (t: Type, d: Id): Set<string> | null => {
    t = zonk(t);
    if (t.t === "con") return new Set([t.id]);
    if (t.t !== "var") return null;
    const key = `${d} ${t.v}`;
    if (resolving.has(key)) return new Set();
    const sc = info.schemes.get(d);
    if (!sc || !sc.vars.includes(t.v)) return null;
    resolving.add(key);
    try {
      const out = new Set<string>();
      for (const r of callers.get(d) ?? []) {
        const inst = info.typeOf.get(r), at = owner.get(r);
        const b = inst && at ? bound(sc.type, inst, t.v) : undefined;
        const hs = b && at ? headsOf(b, at) : null;
        if (!hs) return null;
        hs.forEach((h) => out.add(h));
      }
      return out;
    } finally { resolving.delete(key); }
  };
  const of = new Map<Id, string>(), heads = new Set<string>(), inDef = new Map<Id, Set<string>>();
  for (const d of reach) for (const x of subtree(code, d)) {
    const n = code.nodes[x];
    if (n.kind !== "ref" || !jobs.has(n.target)) continue;
    const t = info.typeOf.get(x);
    const keys = t ? keysIn(t) : [];
    if (!keys.length) return null;
    const hs = new Set<string>();
    for (const k of keys) { const h = headsOf(k, d); if (!h) return null; h.forEach((y) => hs.add(y)); }
    if (hs.size !== 1) return null;
    const h = [...hs][0];
    of.set(x, h);
    heads.add(h);
    (inDef.get(d) ?? inDef.set(d, new Set()).get(d)!).add(h);
  }
  return { of, heads: [...heads], inDef };
}

// A type reference's group: its first argument's name, where it is one.
export function trefGroup(code: Code, tref: NodeOf<"tref">): string | undefined {
  const a = tref.args[0] ? code.nodes[tref.args[0]] : undefined;
  return a?.kind === "tref" ? a.target : undefined;
}
