// A fold of a map made one fold (C207c): `sum(map(xs, g))`, where sum is a
// definition whose body folds its one input and map is the library's (on a
// list or, stored as one, an array), is put in place as sum's own fold over
// xs, each item first given to g. No mapped list or array is made, and g is
// called in the loop rather than through a closure.
//
// The program means the same: the consumer's arms only compute (its type
// has no effects) and never read the rest (which would be the mapped
// items), and g only computes too, so nothing can tell the two apart.
// map calls g on the items first to last, and the fold that takes its
// place may meet them last first (scalar.ts `loop`, on the way back up),
// so a g that acts is left as it is (I219: pig's `games won by B`, a sum
// of a map of games that each draw from Random, drew its games in the
// other order). The consumer stays defined, for its other callers.
//
// Deforestation (Philip Wadler, "Deforestation: transforming programs to
// eliminate trees", 1990) in the form of short-cut fusion (Gill,
// Launchbury and Peyton Jones, "A short cut to deforestation", FPCA 1993):
// here the steps are known definitions, so the rewrite is by the
// consumer's shape rather than a foldr/build rule.

import { mapIds, freshId, subtree, isCall, type Code, type Id, type Node } from "../../ters/src/model.ts";
import type { Info } from "../../ters/src/lang/infer.ts";
import { preludeDef } from "../../ters/src/lang/arith.ts";
import { ARRAY_OPS, CONS } from "../../ters/src/lang/std.ts";

const MAPS = new Set([preludeDef("map"), preludeDef("array map")].filter((x): x is Id => !!x));

export function fuseSteps(code: Code, info: Info): { code: Code; fused: number } {
  let fused = 0;
  for (let c = candidate(code, info); c; c = candidate(code, info)) {
    code = c();
    fused++;
  }
  return { code, fused };
}

// The first call to fuse, as the rewrite of the program.
function candidate(code: Code, info: Info): (() => Code) | null {
  const nodes = code.nodes;
  const reached = new Set(code.defs.flatMap((d) => subtree(code, d)));
  for (const id of reached) {
    const n = nodes[id];
    if (!isCall(n) || !n.args || n.args.length !== 1) continue;
    const f = nodes[n.fn];
    if (f?.kind !== "ref") continue;
    const consumer = folds(code, info, f.target);
    if (!consumer) continue;
    const m = nodes[n.args[0]];
    if (!isCall(m) || !m.args || m.args.length !== 2) continue;
    const mf = nodes[m.fn];
    if (mf?.kind !== "ref" || !MAPS.has(mf.target)) continue;
    const [xs, g] = m.args;
    // g is made once in map; here it is read per item, so only a name or
    // a function written there.
    const gn = nodes[g];
    if (gn.kind !== "ref" && gn.kind !== "lambda") continue;
    const gt = info.typeOf.get(g) && info.subst.zonk(info.typeOf.get(g)!);
    if (gt?.t !== "fn" || gt.eff.effs.length) continue;
    return () => rewrite(code, id, consumer, xs, g);
  }
  return null;
}

interface Consumer { param: Id; fold: Id; items: boolean }
// A definition `(p) => fold p …` or `(p) => fold items of array(p) …`
// whose arms read nothing of it but p's items and the results, never the
// rest, and whose type has no effects.
function folds(code: Code, info: Info, def: Id): Consumer | null {
  const d = code.nodes[def];
  if (d?.kind !== "def" || !d.body) return null;
  const lam = code.nodes[d.body];
  if (lam?.kind !== "lambda" || lam.params.length !== 1) return null;
  const t = info.typeOf.get(def) && info.subst.zonk(info.typeOf.get(def)!);
  // Its row may stay open: with one input that isn't a function, it can
  // only do what it says itself.
  if (!t || t.t !== "fn" || t.eff.effs.length || t.params[0].t === "fn") return null;
  const fold = code.nodes[lam.body];
  if (fold?.kind !== "fold") return null;
  const p = lam.params[0], s = code.nodes[fold.scrutinee];
  const isP = (x: Id) => code.nodes[x]?.kind === "ref" && (code.nodes[x] as { target: Id }).target === p;
  let items: boolean;
  if (isP(fold.scrutinee)) items = false;
  else if (isCall(s) && s.args?.length === 1 && code.nodes[s.fn]?.kind === "ref" && (code.nodes[s.fn] as { target: Id }).target === ARRAY_OPS.items && isP(s.args[0])) items = true;
  else return null;
  for (const a of fold.arms) {
    const arm = code.nodes[a];
    if (arm.kind !== "arm") return null;
    const refs = subtree(code, arm.body).map((x) => code.nodes[x]).filter((x) => x.kind === "ref").map((x) => (x as { target: Id }).target);
    if (refs.includes(p)) return null;
    if (arm.variant === CONS && arm.binds[1] && refs.includes(arm.binds[1])) return null;
  }
  return { param: p, fold: lam.body, items };
}

// The call at `at` made the consumer's fold over xs, its item arm's item
// g of the item.
function rewrite(code: Code, at: Id, c: Consumer, xs: Id, g: Id): Code {
  const nodes: Record<Id, Node> = { ...code.nodes };
  // The consumer's fold copied, every id inside fresh.
  const ids = new Map<Id, Id>();
  for (const x of subtree(code, c.fold)) ids.set(x, freshId());
  const re = (x: Id) => ids.get(x) ?? x;
  for (const [old, now] of ids) nodes[now] = mapIds(code.nodes[old], re);
  const fold = nodes[re(c.fold)] as Extract<Node, { kind: "fold" }>;
  // Its input: xs, or xs's items.
  if (c.items) {
    const s = nodes[fold.scrutinee] as Extract<Node, { kind: "call" }>;
    nodes[fold.scrutinee] = { ...s, args: [xs] } as Node;
  } else nodes[fold.scrutinee] = { ...code.nodes[xs], id: fold.scrutinee } as Node;
  // The item arm: a fresh item, and its old binder g of it, as a let
  // (a function written there, applied).
  for (const a of fold.arms) {
    const arm = nodes[a] as Extract<Node, { kind: "arm" }>;
    if (arm.variant !== CONS || !arm.binds[0]) continue;
    const item = freshId(), ref = freshId(), gref = freshId(), applied = freshId(), lam = freshId();
    nodes[item] = { id: item, kind: "binder" };
    nodes[ref] = { id: ref, kind: "ref", target: item };
    nodes[gref] = { ...code.nodes[g], id: gref } as Node;
    nodes[applied] = { id: applied, kind: "call", fn: gref, args: [ref] };
    nodes[lam] = { id: lam, kind: "lambda", params: [arm.binds[0]], body: arm.body };
    const body = freshId();
    nodes[body] = { id: body, kind: "call", fn: lam, args: [applied] };
    nodes[a] = { ...arm, binds: [item, ...arm.binds.slice(1)], body };
  }
  nodes[at] = { ...fold, id: at };
  delete nodes[re(c.fold)];
  return { ...code, nodes };
}
