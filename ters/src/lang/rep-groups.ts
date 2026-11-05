// Groups of list values, each with its own representation (C93 s2,
// docs/design/data/REPRESENTATION-PER-VALUE-2026-11-05.md): a report, no
// rewrite. Today the chooser (library-reps.ts) picks one representation
// of List for the whole program, from every job main reaches. Here each
// of the program's definitions gets the choice its own reach would make
// (represent.ts `choose` from it, over List's rows), and the definitions
// are grouped as main's calls reach them: a definition starts a group of
// its own where its choice differs from its caller's, and that call is a
// crossing, where a list would be converted (n, once per call).
//
// A definition with no list job of its own reach, or whose jobs every row
// does at the same cost, goes with its caller's group.

import { subtree, type Code, type Id } from "../model.ts";
import { LIBRARY } from "./library.ts";
import { choose, uses } from "./represent.ts";
import { LIST } from "./std.ts";

export interface ListGroup { root: Id; rep: string; defs: Id[] }
export interface Crossing { from: Id; to: Id; fromRep: string; toRep: string }
export interface ListGroups { whole: string; groups: ListGroup[]; crossings: Crossing[] }

export function listGroups(code: Code, main: Id, defs: Id[]): ListGroups {
  const own = new Set(defs);
  const spec = LIBRARY.reps.find((r) => r.of === LIST && r.canonical)!;
  const rows = [spec, ...LIBRARY.reps.filter((r) => r.of === LIST && r.byType && !r.canonical)];
  const choice = new Map<Id, string | null>();
  const chosen = (d: Id) => {
    if (!choice.has(d)) {
      const jobs = uses(code, d, rows);
      const c = jobs.length ? choose(code, d, rows) : null;
      // Every row doing its jobs at the same costs (a few conses): no
      // preference of its own.
      const same = c && c.table.every((t) => jobs.every((j) => t.costs[j] === c.table[0].costs[j]));
      choice.set(d, c && !same ? c.rep.name : null);
    }
    return choice.get(d)!;
  };
  const calls = (d: Id) => [...new Set(subtree(code, d).map((x) => code.nodes[x]).filter((n) => n?.kind === "ref" && own.has(n.target) && n.target !== d).map((n) => (n as { target: Id }).target))];
  const groups: ListGroup[] = [], crossings: Crossing[] = [], placed = new Map<Id, ListGroup>();
  const visit = (d: Id, from: ListGroup | null, caller: Id | null) => {
    if (placed.has(d)) {
      const g = placed.get(d)!;
      if (from && caller && g !== from && g.rep !== from.rep) crossings.push({ from: caller, to: d, fromRep: from.rep, toRep: g.rep });
      return;
    }
    const c = chosen(d);
    let g = from;
    if (!g || (c !== null && c !== g.rep)) {
      g = { root: d, rep: c ?? spec.name, defs: [] };
      groups.push(g);
      if (from && caller) crossings.push({ from: caller, to: d, fromRep: from.rep, toRep: g.rep });
    }
    g.defs.push(d);
    placed.set(d, g);
    for (const x of calls(d)) visit(x, g, d);
  };
  visit(main, null, null);
  return { whole: chosen(main) ?? spec.name, groups, crossings };
}
