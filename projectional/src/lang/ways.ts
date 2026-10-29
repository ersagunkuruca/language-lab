// Several ways to compute one operation (WAYS.md, BACKLOG L96): the
// definitions that give an interface's field from its other fields, and
// the cheapest way to each field an implementation leaves `by its ways`.
// arith.ts resolves each use with it; infer.ts checks with it that every
// field left to its ways has a way that ends in a field the
// implementation gives, before anything runs.

import { children, type Code, type Id, type NodeOf } from "../model.ts";
import { S } from "./std.ts";

// The operations of the program's interfaces (INTERFACES.md): each field
// of an interface typedef, and the interface it belongs to.
export function interfaceOps(code: Code): Map<Id, Id> {
  const out = new Map<Id, Id>();
  for (const d of code.defs) {
    const n = code.nodes[d], td = n?.kind === "def" && n.body ? code.nodes[n.body] : null;
    if (td?.kind !== "typedef" || !td.interface) continue;
    for (const v of td.variants) for (const f of (code.nodes[v] as NodeOf<"variant">).fields) out.set(f, d);
  }
  return out;
}

export type Ways = Map<Id, { def: Id; uses: Set<Id> }[]>;

// The ways in a program: for each field, the definitions marked as a way
// of it, and the fields each one uses.
export function waysIn(code: Code, ops: Map<Id, Id> = interfaceOps(code)): Ways {
  const ways: Ways = new Map();
  for (const n of Object.values(code.nodes)) {
    if (n.kind !== "def" || !n.way || !n.body) continue;
    const uses = new Set<Id>();
    const look = (x: Id) => { const m = code.nodes[x]; if (m.kind === "ref" && ops.has(m.target)) uses.add(m.target); children(m).forEach(look); };
    look(n.body);
    ways.set(n.way, [...(ways.get(n.way) ?? []), { def: n.id, uses }]);
  }
  return ways;
}

// Whether an implementation's argument is `by its ways`.
export const leftToWays = (code: Code, arg: Id) => { const g = code.nodes[arg]; return g?.kind === "ref" && g.target === S.byItsWays; };

// For one implementation (its variant's fields and the arguments it gives
// them), the cheapest way to each field: a field it gives costs 1 (and
// maps to null), a way 1 plus what it uses. A field with no way that ends
// in given fields is missing from the answer. Knuth's generalisation of
// Dijkstra's algorithm (1977): the cheapest field whose way uses only
// finished fields is finished next, so a cycle of ways is never followed.
export function pickWays(code: Code, ways: Ways, variant: NodeOf<"variant">, args: Id[]): Map<Id, Id | null> {
  const cost = new Map<Id, number>(), pick = new Map<Id, Id | null>();
  variant.fields.forEach((f, i) => { if (!leftToWays(code, args[i])) { cost.set(f, 1); pick.set(f, null); } });
  for (;;) {
    let best: { field: Id; way: Id; cost: number } | null = null;
    for (const f of variant.fields) {
      if (cost.has(f)) continue;
      for (const w of ways.get(f) ?? []) {
        if (![...w.uses].every((u) => cost.has(u))) continue;
        const c = 1 + [...w.uses].reduce((a, u) => a + cost.get(u)!, 0);
        if (!best || c < best.cost) best = { field: f, way: w.def, cost: c };
      }
    }
    if (!best) break;
    cost.set(best.field, best.cost);
    pick.set(best.field, best.way);
  }
  return pick;
}
