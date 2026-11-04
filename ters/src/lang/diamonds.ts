// The diamond rule (EMBEDDINGS.md, BACKLOG L208d): embeddings compose, and
// when two paths of declared embeddings lead from one type to another they
// must agree. A path is read with each stretch that a declared embedding
// goes straight across replaced by it (Int → Rational → Float64 → Complex
// is Int → Float64 → Complex, since Int → Float64 is declared); two paths
// that still differ need a direct embedding declared, and the laws test
// then checks the direct one against each path (embed-laws.ts).
//
// Prior art: Lean 4's Mathlib, whose coercion paths must commute
// ("diamonds" in its instance graph); here a declaration settles each one
// and a test checks it. CREDITS.md.

import type { Id } from "../model.ts";

export interface Edge { def: Id; from: string; to: string }

// Every path of declared embeddings from `from` to `to`, visiting no type
// twice.
export function pathsBetween(edges: Edge[], from: string, to: string): Edge[][] {
  const out: Edge[][] = [];
  const go = (at: string, seen: Set<string>, path: Edge[]) => {
    if (at === to && path.length) { out.push(path); return; }
    for (const e of edges) if (e.from === at && !seen.has(e.to)) go(e.to, new Set([...seen, e.to]), [...path, e]);
  };
  go(from, new Set([from]), []);
  return out;
}

// A path with each stretch a declared embedding goes straight across
// replaced by it, the longest first, as the types it passes through.
export function shortened(path: Edge[], direct: Map<string, Edge>): string[] {
  const stops = [path[0].from, ...path.map((e) => e.to)];
  const out = [stops[0]];
  for (let i = 0; i < stops.length - 1; ) {
    let j = stops.length - 1;
    while (j > i + 1 && !direct.has(`${stops[i]} ${stops[j]}`)) j--;
    out.push(stops[j]);
    i = j;
  }
  return out;
}

// The pairs two paths lead between that still differ, with no direct
// embedding declared.
export function diamonds(edges: Edge[]): { from: string; to: string; paths: Edge[][] }[] {
  const direct = new Map(edges.map((e) => [`${e.from} ${e.to}`, e]));
  const types = [...new Set(edges.flatMap((e) => [e.from, e.to]))];
  const out: { from: string; to: string; paths: Edge[][] }[] = [];
  for (const a of types) for (const b of types) {
    if (a === b || direct.has(`${a} ${b}`)) continue;
    const ps = pathsBetween(edges, a, b);
    if (new Set(ps.map((p) => shortened(p, direct).join(" "))).size > 1) out.push({ from: a, to: b, paths: ps });
  }
  return out;
}

// Each declared embedding with every other path between its two types:
// the pairs the laws test compares.
export function shortcuts(edges: Edge[]): { direct: Edge; path: Edge[] }[] {
  return edges.flatMap((d) => pathsBetween(edges, d.from, d.to).filter((p) => p.length > 1).map((path) => ({ direct: d, path })));
}
