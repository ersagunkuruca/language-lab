// A tuple's parts read by the names of the result ports they came from
// (L128b, BACKLOG I131): where `results` is what a function with results
// named drift and drop gave, its first part reads results.drift, in the
// text as in the graph, and the text reader reads results.drift back as
// that part. Without names the part reads by its place, results.first.

import type { Code, Id, NodeOf } from "../model.ts";
import { TUPLE_MAX, tuplePart } from "./std.ts";

// What each let's dot holds, per program: found once.
const lets = new WeakMap<Code["nodes"], Map<Id, Id>>();
function letValue(code: Code, b: Id): Id | undefined {
  let m = lets.get(code.nodes);
  if (!m) {
    m = new Map();
    for (const c of Object.values(code.nodes)) if (c.kind === "call") { const l = code.nodes[c.fn]; if (l?.kind === "lambda") l.params.forEach((p, i) => c.args[i] && m!.set(p, c.args[i])); }
    lets.set(code.nodes, m);
  }
  return m.get(b);
}

// The function or call `e` stands for, through names and dots (`e` a
// dot itself, too).
function follow(code: Code, e: Id | undefined): NodeOf<"lambda"> | NodeOf<"call"> | null {
  for (let hops = 0; e && hops < 8; hops++) {
    const x = code.nodes[e];
    if (x?.kind === "lambda" || x?.kind === "call") return x;
    if (x?.kind === "binder") { e = letValue(code, e); continue; }
    if (x?.kind !== "ref") return null;
    const t = code.nodes[x.target];
    e = t?.kind === "def" ? t.body ?? undefined : t?.kind === "binder" ? letValue(code, x.target) : undefined;
  }
  return null;
}

// The named result ports of the function whose call `from` is.
export function resultPorts(code: Code, from: Id): Id[] | undefined {
  const c = follow(code, from);
  const fn = c?.kind === "call" ? follow(code, c.fn) : null;
  return fn?.kind === "lambda" ? fn.results : undefined;
}

// Which place a tuple part is: [index, size], or null.
export function tuplePlace(field: Id): [number, number] | null {
  for (let m = 2; m <= TUPLE_MAX; m++) for (let i = 0; i < m; i++) if (tuplePart(m, i) === field) return [i, m];
  return null;
}

// The result port the part `field` of `from` came out of, or null.
export function partPort(code: Code, field: Id, from: Id): Id | null {
  const at = tuplePlace(field);
  if (!at) return null;
  const rs = resultPorts(code, from);
  return rs?.length === at[1] ? rs[at[0]] : null;
}

// The tuple part `name` reads on `from` (a dot, or a read of one), by its
// result port's name.
export function partNamed(code: Code, names: Record<Id, string>, from: Id, name: string): Id | null {
  const rs = resultPorts(code, from);
  const i = rs ? rs.findIndex((r) => names[r] === name) : -1;
  return rs && i >= 0 && rs.length >= 2 && rs.length <= TUPLE_MAX ? tuplePart(rs.length, i) : null;
}
