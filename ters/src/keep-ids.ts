// A part retyped keeps the ids of what reads the same (I266,
// GIT-TRIAL-2026-11-14 §2). Text read into a hole is all new nodes, so
// retyping `floor(random() · 6) + 1` as `… + 0` gave `floor`, `random` and
// the 6 new ids too: two unrelated edits to one definition then conflict
// in a merge (I265), and a one-character edit is dozens of lines of
// code.json. Here the new tree is matched against the old one, top-down:
// a node of the same kind in the same place takes the old node's id, and
// so do the nodes under it, slot by slot. In a list (a call's arguments, a
// lambda's parameters, a match's arms) the parts that read alike are
// paired first, in order (their longest common run), and the rest by
// place among those of the same kind, so an argument put in front leaves
// the others theirs, and one moved past another keeps its id too. A node whose kind changed is new, and so is all under
// it. What points at a matched node (a ref to a parameter) follows it, and
// so do the names.
//
// Matching trees by shape, top-down and then by place, is the first phase
// of GumTree (Falleri et al., "Fine-grained and accurate source code
// differencing", ASE 2014), simplified to a tree whose root is fixed.

import type { Code, Id, Node } from "./model.ts";
import { SCHEMA, mapIds, subtree } from "./model.ts";
import type { Names } from "./presentation.ts";

export function keptIds(before: Code, after: Code, names: Names, root: Id): { code: Code; names: Names } {
  if (!before.nodes[root] || !after.nodes[root]) return { code: after, names };
  const old = new Set(subtree(before, root)), made = subtree(after, root), fresh = new Set(made.filter((x) => !before.nodes[x]));
  if (!fresh.size) return { code: after, names };
  const to = new Map<Id, Id>(), taken = new Set<Id>(made.filter((x) => !fresh.has(x)));
  // What a node reads as, ids left out: its kind, what it means, what it
  // points at outside the tree, and its parts', in order.
  const shapes = new Map<string, string>();
  const shape = (code: Code, inside: Set<Id>, id: Id, side: string): string => {
    const k = `${side} ${id}`, had = shapes.get(k);
    if (had !== undefined) return had;
    const n = code.nodes[id];
    if (!n) return "?";
    const parts: string[] = [n.kind];
    for (const [a, slot] of Object.entries(SCHEMA[n.kind] ?? {})) {
      const v = (n as Record<string, unknown>)[a];
      if (v === undefined) continue;
      if (slot === "child") parts.push(`${a}(${ids(v).map((c) => shape(code, inside, c, side)).join(",")})`);
      else if (slot === "ref") parts.push(`${a}=${ids(v).map((t) => (inside.has(t) ? "·" : t)).join(",")}`);
      else if (slot === "meaning") parts.push(`${a}=${JSON.stringify(v)}`);
    }
    const s = parts.join(" ");
    shapes.set(k, s);
    return s;
  };
  const newSet = new Set(made);
  const pair = (o: Id, n: Id) => {
    const a = before.nodes[o], b = after.nodes[n];
    if (!a || !b || a.kind !== b.kind) return;
    if (n !== o) {
      if (!fresh.has(n) || taken.has(o) || newSet.has(o) || !old.has(o)) return;
      to.set(n, o);
      taken.add(o);
    }
    for (const [slot, kind] of Object.entries(SCHEMA[b.kind] ?? {})) {
      if (kind !== "child") continue;
      const va = (a as Record<string, unknown>)[slot], vb = (b as Record<string, unknown>)[slot];
      if (typeof va === "string" && typeof vb === "string") pair(va, vb);
      else if (Array.isArray(va) && Array.isArray(vb)) pairList(va.filter((x): x is Id => typeof x === "string"), vb.filter((x): x is Id => typeof x === "string"));
      else if (va && vb && typeof va === "object" && typeof vb === "object") pairList(Object.values(va) as Id[], Object.values(vb) as Id[]);
    }
  };
  const pairList = (xs: Id[], ys: Id[]) => {
    const sx = xs.map((x) => shape(before, old, x, "o")), sy = ys.map((y) => shape(after, newSet, y, "n"));
    // The longest common run of parts that read alike.
    const L = xs.map(() => ys.map(() => 0));
    const at = (i: number, j: number) => (i < xs.length && j < ys.length ? L[i][j] : 0);
    for (let i = xs.length - 1; i >= 0; i--) for (let j = ys.length - 1; j >= 0; j--) L[i][j] = sx[i] === sy[j] ? at(i + 1, j + 1) + 1 : Math.max(at(i + 1, j), at(i, j + 1));
    const alike: [number, number][] = [];
    for (let i = 0, j = 0; i < xs.length && j < ys.length;) {
      if (sx[i] === sy[j]) { alike.push([i, j]); i++; j++; } else if (at(i + 1, j) >= at(i, j + 1)) i++; else j++;
    }
    for (const [i, j] of alike) pair(xs[i], ys[j]);
    // The rest by place among those of the same kind: between the alike
    // first, then across them (a part moved past another, `1 + x` for
    // `x + 1`).
    const doneX = new Set(alike.map(([i]) => i)), doneY = new Set(alike.map(([, j]) => j));
    const byKind = (within: (i: number, j: number) => boolean) => {
      for (let j = 0; j < ys.length; j++) {
        if (doneY.has(j)) continue;
        const i = xs.findIndex((x, q) => !doneX.has(q) && within(q, j) && before.nodes[x]?.kind === after.nodes[ys[j]]?.kind);
        if (i >= 0) { doneX.add(i); doneY.add(j); pair(xs[i], ys[j]); }
      }
    };
    const gap = (i: number, j: number) => alike.every(([a, b]) => (a < i) === (b < j));
    byKind(gap);
    byKind(() => true);
  };
  pair(root, root);
  if (!to.size) return { code: after, names };
  const f = (id: Id) => to.get(id) ?? id;
  const nodes: Record<Id, Node> = {}, back = new Set(to.values());
  for (const [id, n] of Object.entries(after.nodes)) {
    // An old node left behind by the hole gives way to its match.
    if (back.has(id) && !newSet.has(id)) continue;
    // Only the new tree holds or points at its new ids.
    const m = newSet.has(id) ? mapIds(n, f) : n;
    nodes[m.id] = m;
  }
  const out: Names = { ...names };
  for (const [n, o] of to) if (n in out) { out[o] = out[n]; delete out[n]; }
  return { code: { ...after, nodes }, names: out };
}

const ids = (v: unknown): Id[] => (typeof v === "string" ? [v] : Array.isArray(v) ? v.filter((x): x is Id => typeof x === "string") : v && typeof v === "object" ? (Object.values(v) as Id[]) : []);
