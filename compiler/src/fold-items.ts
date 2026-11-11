// A fold's work on each item shared out as a map (C42e): in
//
//   fold xs
//     nil → z
//     cons(x, rest) with r → v = e(x); b(v, r)
//
// where e reads the item (and what is around the fold) but never the rest
// or its result, and b reads v and the result but not the item, the fold
// is made one over map(xs, (x) => e(x)), its item v. The map is one a
// target may share out by items (pure-branches.ts `parallelLists`), so e
// runs for many items at once while b still puts them together in turn:
// no b need be associative, as C42b-d's joins must be.
//
// The program means the same. The fold works out the rest's result before
// an item's arm, so in turn the last item's e runs first, as map's fold
// runs it; e and b only compute (the fold is one `parallelFolds` takes),
// and an e that may run long never aborts, so where the first abort falls
// can't change.
//
// Only where e calls something the checker couldn't see end (a loop, a
// recursion): a cheap e is quicker in the loop, as a fold of a map is made
// one (fuse-steps.ts, C207c) for that reason, before this.

import { children, dependencies, freshId, subtree, isCall, type Code, type Id, type Node, type NodeOf } from "../../ters/src/model.ts";
import type { Info } from "../../ters/src/lang/infer.ts";
import { preludeDef } from "../../ters/src/lang/arith.ts";
import { CONS, NIL } from "../../ters/src/lang/std.ts";
import { DIVERGE } from "../../ters/src/lang/types.ts";
import { LIBRARY } from "../../ters/src/lang/library.ts";
import { ownEffects, parallelFolds } from "../../ters/src/lang/pure-branches.ts";

export function shareFoldItems(code: Code, info: Info): { code: Code; shared: number } {
  const map = preludeDef("map");
  if (!map) return { code, shared: 0 };
  const folds = parallelFolds(code, info);
  const reached = new Set(code.defs.flatMap((d) => subtree(code, d)));
  const nodes: Record<Id, Node> = { ...code.nodes };
  let shared = 0;
  for (const id of folds) {
    if (!reached.has(id)) continue;
    const fold = nodes[id] as NodeOf<"fold">;
    const arms = fold.arms.map((a) => nodes[a] as NodeOf<"arm">);
    const cons = arms.find((a) => a.variant === CONS), nil = arms.find((a) => a.variant === NIL);
    if (arms.length !== 2 || !cons || !nil || cons.binds.length !== 2 || !cons.results[1] || cons.results[0]) continue;
    const [x, rest] = cons.binds, r = cons.results[1]!;
    // The arm's body a let: (v) => b, given e.
    const body = nodes[cons.body];
    if (!isCall(body) || body.args?.length !== 1) continue;
    const lam = nodes[body.fn];
    if (lam?.kind !== "lambda" || lam.params.length !== 1) continue;
    const e = body.args[0];
    const refs = (at: Id) => subtree(code, at).map((n) => code.nodes[n]).filter((n): n is NodeOf<"ref"> => n?.kind === "ref").map((n) => n.target);
    const inE = refs(e), inB = refs(lam.body);
    if (inE.includes(r) || inE.includes(rest) || inB.includes(x) || inB.includes(rest)) continue;
    if (joins(code, lam.body, r)) continue;
    const own = ownEffects(code, info, e);
    if (!own?.has(DIVERGE)) continue;
    // map(xs, (x) => e), the fold's input; the arm's item v, its body b.
    const fn = freshId(), mapRef = freshId(), call = freshId();
    nodes[fn] = { id: fn, kind: "lambda", params: [x], body: e };
    nodes[mapRef] = { id: mapRef, kind: "ref", target: map };
    nodes[call] = { id: call, kind: "call", fn: mapRef, args: [fold.scrutinee, fn] } as Node;
    nodes[id] = { ...fold, scrutinee: call };
    nodes[cons.id] = { ...cons, binds: [lam.params[0], rest], body: lam.body };
    delete nodes[body.id];
    delete nodes[lam.id];
    shared++;
  }
  if (!shared) return { code, shared };
  // map's definition, and what it calls, from the library where the
  // program had none.
  const whole = LIBRARY.code, defs = [...code.defs];
  for (const d of [map, ...dependencies(whole, map)]) {
    if (defs.includes(d) || whole.nodes[d]?.kind !== "def") continue;
    defs.push(d);
    for (const n of subtree(whole, d)) nodes[n] ??= whole.nodes[n];
  }
  return { code: { nodes, defs }, shared };
}

// Whether b reads the rest's result r (or its fields) only to add an Int
// to it or to keep the larger or smaller: a join of C42b-d's, which shares
// the putting together too (scalar.ts `itemFold`), so it stays theirs.
const ADD = "builtin.int.add", LESS = "builtin.int.less";
function joins(code: Code, b: Id, r: Id): boolean {
  const up = new Map<Id, Id>();
  for (const id of subtree(code, b)) for (const k of children(code.nodes[id])) up.set(k, id);
  const isRef = (id: Id | undefined, t: string) => { const n = id ? code.nodes[id] : undefined; return n?.kind === "ref" && n.target === t; };
  const uses = subtree(code, b).filter((id) => isRef(id, r));
  return uses.length > 0 && uses.every((u) => {
    let at: Id = u, p = up.get(at);
    // A field read: field(r).
    const pn = p && code.nodes[p];
    if (pn && isCall(pn) && pn.args?.length === 1 && code.nodes[pn.fn]?.kind === "ref" && code.nodes[(code.nodes[pn.fn] as NodeOf<"ref">).target]?.kind === "field") { at = p!; p = up.get(at); }
    const q = p && code.nodes[p];
    if (!q) return false;
    if (isCall(q)) return isRef(q.fn, ADD) || isRef(q.fn, LESS);
    // Or what a case of an if (a match) gives.
    return q.kind === "arm" && q.body === at && code.nodes[up.get(p!) ?? ""]?.kind === "match";
  });
}
