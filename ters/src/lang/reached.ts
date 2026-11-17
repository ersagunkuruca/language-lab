// What a program's roots reach: their definitions, every type, the
// builtins, and what is found by type rather than by a reference (the
// implementations at the types reached, an interface's ways, the Shown and
// Ordered implementations show and compare go through). The compiler
// lowers only this (core-js.ts lowerCore), and the evaluator runs a main
// on it (run.ts runProgram, L265), so neither types library bodies the
// program never reaches.

import { dependencies, dependenciesOfAll, subtree, type Code, type Id } from "../model.ts";
import type { Info } from "./infer.ts";
import { implementationsOf, shownImplementations } from "./std-values.ts";
import { interfaceOps, waysIn } from "./ways.ts";
import { COMPARE, ORDERED, SHOW_ANY } from "./std-ids.ts";

// What the roots reach (reachedWithShows), and the implementations at the
// types that reaches: arith.ts, Shown and Ordered find those by type, not
// by a reference, so they're added until nothing more is reached.
export function reachedImplementing(code: Code, roots: Id[], info: Info): Code {
  // Each with the types it is at: an Embedding's are its two (int in
  // float64), kept by the interface's own type around them.
  const impls = [...(info.implementations ?? [])].map(([key, d]) => {
    const iface = key.slice(0, key.indexOf("|")), rest = key.slice(iface.length + 1);
    const ts = rest.startsWith("@") ? [rest.slice(1)] : [...rest.matchAll(/"t":"con","id":"([^"]+)"/g)].map((m) => m[1]).filter((t) => t !== iface);
    return [ts, d] as const;
  });
  // The types the roots use: what they refer to, types included (model.ts
  // dependencies); the builtin ones (Float64, Int, Text) always.
  const used = new Set<Id>(), more: Id[] = [], kept = new Set<Id>();
  const use = (r: Id) => { if (used.has(r)) return; used.add(r); for (const d of dependencies(code, r)) used.add(d); };
  roots.forEach(use);
  // The ways of a kept implementation's interface too (WAYS.md): arith.ts
  // puts one in for a field the implementation leaves `by its ways`, so it
  // is reached by no reference (examples/impact's `first touch by
  // advancing`, L120c).
  const ops = interfaceOps(code), ways = waysIn(code, ops);
  const ifaceOf = new Map(impls.map(([, d]) => [d, [...(info.implementations ?? [])].find(([, x]) => x === d)![0].split("|")[0]]));
  for (let grew = true; grew;) {
    grew = false;
    for (const [ts, d] of impls) if (!kept.has(d) && ts.every((t) => used.has(t) || t.startsWith("type."))) { kept.add(d); more.push(d); use(d); grew = true; }
    const ifaces = new Set([...kept].map((d) => ifaceOf.get(d)));
    for (const [field, ws] of ways) if (ifaces.has(ops.get(field))) for (const w of ws) if (!used.has(w.def)) { more.push(w.def); use(w.def); grew = true; }
  }
  return reachedWithShows(code, [...roots, ...more], info);
}

// The definitions the roots reach, every type, and the builtins: what
// the scalar profile and compile (C67) stage and check again (C90).
// The same, and the Shown implementations `show any` shows through when
// what the roots reach shows a value (L205, C148). `own`: only those of
// types not in std (the scalar lowering shows std's own way).
export function reachedWithShows(code: Code, roots: Id[], info: Info, own = false): Code {
  const reached = reachedFrom(code, roots);
  const showns = [...shownImplementations(info)].flatMap(([t, d]) => (own && t.startsWith("std.") ? [] : [d]));
  const shows = showns.length && Object.values(reached.nodes).some((n) => n.kind === "ref" && n.target === SHOW_ANY);
  // And the Ordered implementations a compare orders through (L204h).
  const ordereds = [...implementationsOf(info, ORDERED)].flatMap(([t, d]) => (own && t.startsWith("std.") ? [] : [d]));
  const compares = ordereds.length && Object.values(reached.nodes).some((n) => n.kind === "ref" && n.target === COMPARE);
  return shows || compares ? reachedFrom(code, [...roots, ...(shows ? showns : []), ...(compares ? ordereds : [])]) : reached;
}
export function reachedFrom(code: Code, roots: Id[]): Code {
  const reach = new Set<Id>();
  for (const r of roots) reach.add(r);
  for (const d of dependenciesOfAll(code, roots)) reach.add(d);
  const isType = (d: Id) => { const n = code.nodes[d]; return n?.kind === "def" && !!n.body && code.nodes[n.body]?.kind === "typedef"; };
  const defs = code.defs.filter((d) => reach.has(d) || isType(d));
  if (defs.length === code.defs.length) return code;
  const nodes: Code["nodes"] = {};
  for (const [id, n] of Object.entries(code.nodes)) if (n.kind === "builtin") nodes[id] = n;
  for (const d of defs) for (const id of subtree(code, d)) nodes[id] = code.nodes[id];
  return { nodes, defs };
}
