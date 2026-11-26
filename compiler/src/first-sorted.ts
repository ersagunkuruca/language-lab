// A sorted list read only for its first item (C356, GAPS.md round 25,
// larder's `nicest of(sort by(options, key))`, every way to buy a food
// sorted to take the one first):
//
//   nicest of(sort by(xs, key))   where nicest of only asks for its list's
//                                 first item: `match l | nil → … | cons(o, _) → …`
//
// read as `nicest of(first by key(xs, key))`: the prelude's one pass
// keeping the item with the least key, a list of it, instead of a merge
// sort. Its first item is the sort's: each key is worked out once, in order,
// as sort by works them, and of equal keys the first stays, as the stable
// sort keeps them. What differs is only which keys are compared (n − 1
// compares against n log n), and compare only computes.
//
// A sorted list read so: the scrutinee of a match whose cons arms never
// read the rest, or given to one of the program's own definitions whose
// input is read only so (once, as such a match's scrutinee).
//
// Taken in the program's own definitions, before the list chooser
// (ters/cli/represented.ts), beside replace-reads.ts.

import { children, copyNodes, changedOver, isCall, subtree, type Code, type Id, type Node, type NodeOf } from "../../ters/src/model.ts";
import type { Names } from "../../ters/src/presentation.ts";
import { infer, inferRewritten, type Info, type Options } from "../../ters/src/lang/infer.ts";
import { preludeDef } from "../../ters/src/lang/arith.ts";
import { CONS } from "../../ters/src/lang/std.ts";

const SORT_BY = preludeDef("sort by"), FIRST_BY_KEY = preludeDef("first by key");

export function firstSorted(code: Code, info: Info, names: Names, own: Id[], opts: Options): { code: Code; info: Info; read: number } | null {
  if (!SORT_BY || !FIRST_BY_KEY) return null;
  const refTo = (id: Id): Id | undefined => { const n = code.nodes[id]; return n?.kind === "ref" ? n.target : undefined; };
  // Every reference to each binder in the program's own definitions.
  const uses = new Map<Id, Id[]>();
  for (const d of own) for (const id of subtree(code, d)) { const t = refTo(id); if (t !== undefined) uses.set(t, [...(uses.get(t) ?? []), id]); }
  const unused = (b: Id | undefined) => b === undefined || !(uses.get(b)?.length);
  // A match that reads its list's first item at most: no cons arm reads
  // the rest.
  const firstOnly = (m: Node | undefined): boolean => m?.kind === "match" && m.arms.every((a) => {
    const arm = code.nodes[a] as NodeOf<"arm"> | undefined;
    return !!arm && arm.kind === "arm" && (arm.variant !== CONS || unused(arm.binds[1]));
  });
  // Where each node sits: its parent.
  const parent = new Map<Id, Id>();
  for (const d of own) for (const id of subtree(code, d)) for (const c of code.nodes[id] ? children(code.nodes[id]) : []) parent.set(c, id);
  // An own definition's input read only as a firstOnly match's scrutinee.
  const inputsFirstOnly = new Map<Id, boolean[]>();
  for (const d of own) {
    const def = code.nodes[d];
    const lam = def?.kind === "def" && def.body ? code.nodes[def.body] : undefined;
    if (lam?.kind !== "lambda") continue;
    inputsFirstOnly.set(d, lam.params.map((p) => {
      const at = uses.get(p) ?? [];
      if (at.length !== 1) return false;
      const m = code.nodes[parent.get(at[0])!];
      return m?.kind === "match" && m.scrutinee === at[0] && firstOnly(m);
    }));
  }
  const reads: Id[] = [];
  for (const d of own) for (const id of subtree(code, d)) {
    const n = code.nodes[id];
    if (!isCall(n) || n.args?.length !== 2 || refTo(n.fn) !== SORT_BY) continue;
    const up = code.nodes[parent.get(id)!];
    const read = (up?.kind === "match" && up.scrutinee === id && firstOnly(up))
      || (isCall(up) && up.args !== undefined && up.args.some((a, i) => a === id && inputsFirstOnly.get(refTo(up.fn) ?? "")?.[i] === true));
    if (read) reads.push(n.fn);
  }
  if (!reads.length) return null;
  const nodes: Record<Id, Node> = copyNodes(code.nodes);
  for (const f of reads) nodes[f] = { id: f, kind: "ref", target: FIRST_BY_KEY };
  const next: Code = { ...code, nodes };
  const changed = changedOver(code.nodes, nodes);
  const checked = info.options === opts && changed ? inferRewritten(code, next, names, info, [...changed].filter((id) => code.nodes[id] !== undefined), []) : infer(next, names, undefined, opts);
  if (checked.errors.length > info.errors.length) return null;
  return { code: next, info: checked, read: reads.length };
}
