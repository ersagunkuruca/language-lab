// Library representations chosen without the program asking (BACKLOG C47,
// DATA-STRUCTURES.md step 2). A program that uses std's Map gets the
// representation the chooser picks from the costs of the jobs it uses:
// the sorted entries as defined, or L76's weight-balanced tree
// (map-tree.ts). A representations.json row for Map (lab, #97) still wins.
//
// The tree isn't a canonical spelling, so equal, show and compare on a
// map are given its meaning (the sorted entries) instead of the tree: a
// call whose input is a Map gets `meaning(input)` before the rewrite. Where
// a Map sits inside another value (a list of maps, a map's keys, main's
// answer) that wouldn't reach it, so such a program keeps the definition.

import { freshId, subtree, type Code, type Id, type Node } from "../model.ts";
import type { Names } from "../presentation.ts";
import type { Info } from "./infer.ts";
import { withMapTree } from "./map-tree.ts";
import { choose, represent, uses, type Representation } from "./represent.ts";
import { COMPARE, MAP, S, SHOW_ANY } from "./std.ts";
import type { Type } from "./types.ts";

// What equal, show and compare see of a value: these, given a Map, get its meaning.
const BY_VALUE = new Set<Id>([S.equal, SHOW_ANY, COMPARE]);

export interface Chosen { code: Code; names: Names; chosen: string[] }

// `defs`: the program's own definitions, which the rewrite changes;
// `asked`: rows from a representations.json, whose types are left alone.
export function withLibraryRepresentations(code: Code, info: Info, names: Names, main: Id, defs: Id[], asked: Representation[] = []): Chosen {
  const none = { code, names, chosen: [] };
  if (asked.some((r) => r.of === MAP)) return none;
  const w = withMapTree(code, names);
  if (!uses(w.code, main, [w.spec, w.rep]).length) return none;
  if (choose(w.code, main, [w.spec, w.rep]).rep !== w.rep || inside(info, defs, code, main)) return none;
  const meaning = w.rep.meaning!;
  const nodes: Record<Id, Node> = { ...w.code.nodes };
  const isMap = (id: Id) => { const t = info.typeOf.get(id); return !!t && isCon(info.subst.zonk(t), MAP); };
  for (const d of defs) for (const id of subtree(code, d)) {
    const n = code.nodes[id];
    if (n.kind !== "call") continue;
    const f = code.nodes[n.fn];
    if (f?.kind !== "ref" || !BY_VALUE.has(f.target) || !n.args.some(isMap)) continue;
    nodes[id] = { ...n, args: n.args.map((a) => {
      if (!isMap(a)) return a;
      const r = freshId(), c = freshId();
      nodes[r] = { id: r, kind: "ref", target: meaning };
      nodes[c] = { id: c, kind: "call", fn: r, args: [a] };
      return c;
    }) };
  }
  return { code: represent({ ...w.code, nodes }, defs, w.rep), names: w.names, chosen: [`Map as ${w.rep.name}`] };
}

const isCon = (t: Type, id: Id) => t.t === "con" && t.id === id;
// A Map anywhere but at the top of a value's type (a list of maps, a map
// with maps for keys), or in main's type.
function inside(info: Info, defs: Id[], code: Code, main: Id): boolean {
  const deep = (t: Type, top: boolean): boolean => {
    if (t.t === "con") return (!top && t.id === MAP) || t.args.some((a) => deep(info.subst.zonk(a), false));
    if (t.t === "fn") return [...t.params, t.ret].some((x) => deep(info.subst.zonk(x), true));
    return false;
  };
  const any = (t: Type): boolean => (t.t === "con" ? t.id === MAP || t.args.some((a) => any(info.subst.zonk(a))) : t.t === "fn" ? [...t.params, t.ret].some((x) => any(info.subst.zonk(x))) : false);
  const mt = info.typeOf.get(main);
  if (mt && any(info.subst.zonk(mt))) return true;
  return defs.some((d) => subtree(code, d).some((id) => { const t = info.typeOf.get(id); return !!t && deep(info.subst.zonk(t), true); }));
}
