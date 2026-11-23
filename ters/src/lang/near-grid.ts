// neighbours on a grid in C and WebAssembly (C292, L280g): the program's
// calls of `neighbours` call the prelude's `neighbours on a grid`, which
// gives the same lists (ters/test/neighbours-grid.test.ts), copied into the
// program under fresh ids. It is plain Ters, so both targets compile the
// same code, and as the program's own the chooser stores its Map of cells
// and its lists as it does the program's (a table and arrays in C), as
// own-holders.ts does for a library type's definitions. The evaluator
// and compiled JavaScript have the grid in their runtimes (library/near.ts).
// Both are total, so a budget counts the same steps of either: none.

import { dependenciesOfAll, freshId, mapIds, subtree, copyNodes, type Code, type Id, type Node, type NodeOf } from "../model.ts";
import type { Names } from "../presentation.ts";
import { checksKept, infer, type Info } from "./infer.ts";
import { stableIds } from "../stable-ids.ts";
import { LIBRARY } from "./library.ts";
import { COPIED_FROM, originalOf } from "./prelude-ids.ts";
import type { Owned } from "./own-holders.ts";

const lib = (name: string) => LIBRARY.code.defs.find((d) => LIBRARY.names[d] === name);
// The grid's own definitions; what they use besides (map, sort, put) is
// the library's, which the chooser stores as the program's where the
// program's own code calls it.
const GRID = ["neighbours on a grid", "neighbours by every pair", "grid key", "grid cells", "grid around", "grid filed", "grid fits", "grid close", "grid run", "grid found"];

export function nearOnGrid(code: Code, info: Info, names: Names, main: Id, own: Id[]): Owned | null {
  const neighbours = lib("neighbours"), onGrid = lib("neighbours on a grid");
  if (!neighbours || !onGrid || !code.nodes[onGrid]) return null;
  const reached = new Set<Id>([main]);
  dependenciesOfAll(code, [main], reached);
  const mine = own.filter((d) => reached.has(d));
  const calls = (d: Id) => subtree(code, d).some((id) => { const n = code.nodes[id]; return n.kind === "ref" && originalOf(n.target) === neighbours; });
  if (!mine.some(calls)) return null;
  const grid = new Set(GRID.map(lib).filter((d): d is Id => !!d && !!code.nodes[d]));
  const copied = [onGrid, ...dependenciesOfAll(code, [onGrid])].filter((d) => grid.has(d));
  const fresh = new Map<Id, Id>();
  for (const d of copied) for (const id of subtree(code, d)) fresh.set(id, freshId());
  const f = (id: Id) => fresh.get(id) ?? id;
  const nodes: Record<Id, Node> = copyNodes(code.nodes);
  for (const d of copied) for (const id of subtree(code, d)) { const n = mapIds(code.nodes[id], f); nodes[n.id] = n; }
  const to = f(onGrid);
  for (const d of mine) for (const id of subtree(code, d)) {
    const n = code.nodes[id];
    if (n.kind === "ref" && originalOf(n.target) === neighbours) nodes[id] = { ...n, target: to };
  }
  let copies = copied.map(f);
  let out: Code = { nodes, defs: [...code.defs, ...copies] };
  let outNames: Names = { ...names };
  for (const [from, x] of fresh) { const n = names[from] ?? LIBRARY.names[from]; if (n !== undefined) outNames[x] = n; }
  // Named by what they hold where checks are kept, as own-holders.ts does.
  if (checksKept(info.options)) {
    const s = stableIds(out, new Set(fresh.values()), copies, own);
    if (s.rename.size) {
      const g = (id: Id) => s.rename.get(id) ?? id;
      out = s.code;
      copies = copies.map(g);
      const renamed: Names = {};
      for (const k in outNames) renamed[g(k)] = outNames[k];
      outNames = renamed;
      for (const [from, x] of fresh) fresh.set(from, g(x));
    }
  }
  for (const d of copied) COPIED_FROM.set(fresh.get(d)!, originalOf(d));
  const checked = infer(out, outNames, undefined, { ...info.options, units: false });
  if (checked.errors.length > info.errors.length) return null;
  return { code: out, names: outNames, own: [...own, ...copies], info: checked, copied: ["neighbours on a grid"] };
}

// Elsewhere (JavaScript, whose runtime finds them on a grid, near.ts):
// each of the program's calls of `neighbours` given its places alone,
// `neighbours(map(items, place), (p) => p, reach)`, which gives the same
// lists, as place only computes and the definition calls it once an item,
// in order. Then the items go only through a map, which columns.ts keeps
// as columns, where the runtime would take each item whole (the flock's
// birds, G3d).
export function nearByPlaces(code: Code, info: Info, names: Names, main: Id, own: Id[]): { code: Code; info: Info } | null {
  const neighbours = lib("neighbours"), map = lib("map");
  if (!neighbours || !map) return null;
  const reached = new Set<Id>([main]);
  dependenciesOfAll(code, [main], reached);
  const nodes: Record<Id, Node> = copyNodes(code.nodes);
  let changed = false;
  for (const d of own) if (reached.has(d)) for (const id of subtree(code, d)) {
    const n0 = code.nodes[id];
    if (n0.kind !== "call" || !Array.isArray(n0.args) || n0.args.length !== 3) continue;
    const n = n0 as NodeOf<"call"> & { args: Id[] };
    const f = code.nodes[n.fn];
    if (f?.kind !== "ref" || originalOf(f.target) !== neighbours) continue;
    // Already the places themselves.
    const p = code.nodes[n.args[1]];
    if (p?.kind === "lambda" && p.params.length === 1 && code.nodes[p.body]?.kind === "ref" && (code.nodes[p.body] as { target: Id }).target === p.params[0]) continue;
    const m = freshId(), call = freshId(), b = freshId(), r = freshId(), same = freshId();
    nodes[m] = { id: m, kind: "ref", target: map };
    nodes[call] = { id: call, kind: "call", fn: m, args: [n.args[0], n.args[1]] };
    nodes[b] = { id: b, kind: "binder" };
    nodes[r] = { id: r, kind: "ref", target: b };
    nodes[same] = { id: same, kind: "lambda", params: [b], body: r };
    nodes[id] = { ...n, args: [call, same, n.args[2]] };
    changed = true;
  }
  if (!changed) return null;
  const out: Code = { ...code, nodes };
  const checked = infer(out, names, undefined, { ...info.options, units: false });
  return checked.errors.length > info.errors.length ? null : { code: out, info: checked };
}
