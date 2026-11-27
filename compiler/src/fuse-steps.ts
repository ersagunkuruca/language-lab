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

import { children, mapIds, freshId, subtree, isCall, type Code, type Id, type Node, copyNodes, dropNode } from "../../ters/src/model.ts";
import type { Info } from "../../ters/src/lang/infer.ts";
import { preludeDef } from "../../ters/src/lang/arith.ts";
import { ARRAY_OPS, CONS, LIST, NIL, TRUE, FALSE } from "../../ters/src/lang/std.ts";
import { SIGS } from "../../ters/src/lang/std.ts";
import { DIVERGE, Subst, type Type } from "../../ters/src/lang/types.ts";

const MAPS = new Set([preludeDef("map"), preludeDef("array map")].filter((x): x is Id => !!x));
const WITHIN = preludeDef("within reach"), REACHES = preludeDef("reaches");

// `types`: the types of the nodes the rewrites made, carried from the
// check given (I203, the compiler redesign's stage 2), or null where one
// couldn't be: the program is then checked again.
export function fuseSteps(code: Code, info: Info): { code: Code; fused: number; types: Map<Id, Type> | null } {
  let fused = 0;
  let types: Map<Id, Type> | null = new Map();
  for (let c = candidate(code, info, types); c; c = candidate(code, info, types)) {
    const r = c();
    code = r.code;
    types = types && r.types;
    fused++;
  }
  return { code, fused, types };
}

// The first call to fuse, as the rewrite of the program.
function candidate(code: Code, info: Info, made: Map<Id, Type> | null): (() => { code: Code; types: Map<Id, Type> | null }) | null {
  const nodes = code.nodes;
  const reached = new Set(code.defs.flatMap((d) => subtree(code, d)));
  for (const id of reached) {
    const n = nodes[id];
    if (n?.kind === "fold" && within(code, info, n.scrutinee) && guardable(code, n)) return () => ({ code: guarded(code, id), types: null });
    if (!isCall(n) || !n.args || n.args.length !== 1) continue;
    const f = nodes[n.fn];
    if (f?.kind !== "ref") continue;
    const consumer = folds(code, info, f.target);
    if (!consumer) continue;
    const m = nodes[n.args[0]];
    if (!consumer.items && within(code, info, n.args[0])) return () => rewrite(code, info, null, id, consumer, n.args[0], null);
    if (!isCall(m) || !m.args || m.args.length !== 2) continue;
    const mf = nodes[m.fn];
    if (mf?.kind !== "ref" || !MAPS.has(mf.target)) continue;
    const [xs, g] = m.args;
    // g is made once in map; here it is read per item, so only a name or
    // a function written there.
    const gn = nodes[g];
    if (gn.kind !== "ref" && gn.kind !== "lambda") continue;
    if (!onlyComputes(code, info, g)) continue;
    return () => rewrite(code, info, made, id, consumer, xs, g);
  }
  return null;
}

// Whether g, a function written in place or a definition, does nothing but
// compute (or may run long, which it does in either order): what its body
// does, not its type, whose row is the place it is written in (main's
// Console for a lambda in main). Not even an abort: the fold would meet the
// last item's first.
function onlyComputes(code: Code, info: Info, g: Id): boolean {
  const n = code.nodes[g];
  const effs = n.kind === "lambda" ? does(code, info, n.body) : n.kind === "ref" && code.nodes[n.target]?.kind === "def" ? typeEffects(info, info.schemes.get(n.target)?.type) : null;
  return !!effs && [...effs].every((e) => e === DIVERGE);
}
const typeEffects = (info: Info, t: Type | undefined): Set<Id> | null => {
  const z = t && info.subst.zonk(t);
  return z?.t === "fn" ? new Set(z.eff.effs) : null;
};
// What an expression does: the effects its calls name, less those a
// callee handles for a function written in place (`first`'s Choice in
// its first input's row, not its own), or null when it calls a function
// whose effects only its caller knows.
export function does(code: Code, info: Info, id: Id): Set<Id> | null {
  const n = code.nodes[id];
  if (!n) return new Set();
  const out = new Set<Id>();
  const add = (x: Set<Id> | null) => { if (!x) return false; x.forEach((e) => out.add(e)); return true; };
  if (isCall(n)) {
    const f = code.nodes[n.fn];
    if (f?.kind === "lambda") return add(does(code, info, f.body)) && n.args.every((a) => add(does(code, info, a))) ? out : null;
    if (f?.kind !== "ref") return null;
    const target = code.nodes[f.target];
    if (!target || target.kind === "binder" || target.kind === "lambda") return null;
    let t: Type | undefined;
    if (target.kind === "def") t = info.schemes.get(target.id)?.type;
    else if (target.kind === "variant") {
      const owner = info.owner.get(target.id), td = owner ? code.nodes[(code.nodes[owner] as Extract<Node, { kind: "def" }>).body!] : undefined;
      if (td?.kind === "typedef" && td.effect) out.add(owner!);
    } else if (SIGS[f.target]) t = SIGS[f.target](new Subst());
    const ft = t && info.subst.zonk(t);
    if (ft?.t === "fn") ft.eff.effs.forEach((e) => out.add(e));
    for (const [i, a] of n.args.entries()) {
      const an = code.nodes[a], pt = ft?.t === "fn" ? ft.params[i] && info.subst.zonk(ft.params[i]) : undefined;
      if (an?.kind === "lambda" && pt?.t === "fn") {
        const inner = does(code, info, an.body);
        if (!inner) return null;
        for (const e of inner) if (!pt.eff.effs.includes(e) || ft?.t === "fn" && ft.eff.effs.includes(e)) out.add(e);
      } else if (!add(does(code, info, a))) return null;
    }
    return out;
  }
  if (n.kind === "ref") {
    const target = code.nodes[n.target];
    if (target?.kind === "binder") { const t = info.typeOf.get(n.id); if (t && info.subst.zonk(t).t === "fn") return null; }
    return out;
  }
  for (const c of children(n)) if (!add(does(code, info, c))) return null;
  return out;
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
// The types of what it made go into `made` (null: not carried): the
// consumer's at the call's instance of it; the fold's input and the rest
// its arm binds are xs's, and each item is given to g first.
function rewrite(code: Code, info: Info, made: Map<Id, Type> | null, at: Id, c: Consumer, xs: Id, g: Id | null): { code: Code; types: Map<Id, Type> | null } {
  const nodes: Record<Id, Node> = copyNodes(code.nodes);
  const typed = made && g !== null ? typer(code, info, made, at, c, xs, g) : null;
  // The consumer's fold copied, every id inside fresh.
  const ids = new Map<Id, Id>();
  for (const x of subtree(code, c.fold)) ids.set(x, freshId());
  const re = (x: Id) => ids.get(x) ?? x;
  for (const [old, now] of ids) { nodes[now] = mapIds(code.nodes[old], re); typed?.copy(old, now); }
  const fold = nodes[re(c.fold)] as Extract<Node, { kind: "fold" }>;
  // Its input: xs, or xs's items.
  if (c.items) {
    const s = nodes[fold.scrutinee] as Extract<Node, { kind: "call" }>;
    nodes[fold.scrutinee] = { ...s, args: [xs] } as Node;
    typed?.items(fold.scrutinee, s.fn);
  } else { nodes[fold.scrutinee] = { ...code.nodes[xs], id: fold.scrutinee } as Node; typed?.set(fold.scrutinee, typed.of(xs)); }
  // The item arm: a fresh item, and its old binder g of it, as a let
  // (a function written there, applied).
  for (const a of g === null ? [] : fold.arms) {
    const arm = nodes[a] as Extract<Node, { kind: "arm" }>;
    if (arm.variant !== CONS || !arm.binds[0] || g === null) continue;
    const item = freshId(), ref = freshId(), gref = freshId(), applied = freshId(), lam = freshId();
    nodes[item] = { id: item, kind: "binder" };
    nodes[ref] = { id: ref, kind: "ref", target: item };
    nodes[gref] = { ...code.nodes[g], id: gref } as Node;
    nodes[applied] = { id: applied, kind: "call", fn: gref, args: [ref] };
    nodes[lam] = { id: lam, kind: "lambda", params: [arm.binds[0]], body: arm.body };
    const body = freshId();
    nodes[body] = { id: body, kind: "call", fn: lam, args: [applied] };
    nodes[a] = { ...arm, binds: [item, ...arm.binds.slice(1)], body };
    typed?.item({ item, ref, gref, applied, lam, body, was: arm.binds[0], rest: arm.binds[1], armBody: arm.body });
  }
  nodes[at] = { ...fold, id: at };
  typed?.set(at, typed.of(at));
  dropNode(nodes, re(c.fold));
  return { code: { ...code, nodes }, types: typed ? typed.done() : null };
}

// The types of a rewrite's nodes, from the check given and those carried
// so far. The consumer's own are general in its variables: each is taken
// at the call's instance of it, found by matching its type against the
// type its name has at the call.
function typer(code: Code, info: Info, made: Map<Id, Type>, at: Id, c: Consumer, xs: Id, g: Id) {
  const out = new Map(made);
  let ok = true;
  const of = (id: Id): Type => { const t = out.get(id) ?? info.typeOf.get(id); if (!t) { ok = false; return { t: "var", v: -1 }; } return info.subst.zonk(t); };
  const call = code.nodes[at] as Extract<Node, { kind: "call" }>;
  const vars = new Map<number, Type>(), tails = new Map<number, number | null>();
  const match = (general: Type, at: Type): void => {
    if (!ok) return;
    if (general.t === "var") { const was = vars.get(general.v); if (was && JSON.stringify(was) !== JSON.stringify(at)) ok = false; else vars.set(general.v, at); return; }
    if (general.t === "con") { if (at.t !== "con" || at.id !== general.id || at.args.length !== general.args.length) { ok = false; return; } general.args.forEach((x, i) => match(x, at.args[i])); return; }
    if (at.t !== "fn" || at.params.length !== general.params.length || general.eff.effs.length !== at.eff.effs.length) { ok = false; return; }
    general.params.forEach((x, i) => match(x, at.params[i]));
    match(general.ret, at.ret);
    if (general.eff.tail !== null) { const was = tails.get(general.eff.tail); if (was !== undefined && was !== at.eff.tail) ok = false; else tails.set(general.eff.tail, at.eff.tail); }
  };
  const consumer = (code.nodes[(code.nodes[call.fn] as Extract<Node, { kind: "ref" }>).target]) as Extract<Node, { kind: "def" }>;
  match(of(consumer.id), of(call.fn));
  const inst = (t: Type): Type => {
    if (t.t === "var") return vars.get(t.v) ?? t;
    if (t.t === "con") return { t: "con", id: t.id, args: t.args.map(inst) };
    return { t: "fn", params: t.params.map(inst), ret: inst(t.ret), eff: { effs: t.eff.effs, tail: t.eff.tail === null ? null : tails.has(t.eff.tail) ? tails.get(t.eff.tail)! : t.eff.tail } };
  };
  const set = (id: Id, t: Type) => out.set(id, t);
  // What xs holds, a list's or an array's items.
  const xt = of(xs), item: Type | undefined = xt.t === "con" ? xt.args[0] : undefined;
  if (!item) ok = false;
  return {
    of,
    set,
    copy: (old: Id, now: Id) => { if (info.typeOf.has(old) || out.has(old)) set(now, inst(of(old))); },
    // The fold's input `items of array(xs)`: a list of xs's items.
    items: (scrutinee: Id, fn: Id) => {
      const list: Type = { t: "con", id: LIST, args: [item!] };
      const ft = of(fn);
      set(scrutinee, list);
      if (ft.t !== "fn") { ok = false; return; }
      set(fn, { t: "fn", params: [xt], ret: list, eff: (inst(ft) as Extract<Type, { t: "fn" }>).eff });
    },
    item: (x: { item: Id; ref: Id; gref: Id; applied: Id; lam: Id; body: Id; was: Id; rest?: Id; armBody: Id }) => {
      // The arm's own nodes are copies, typed at the instance already.
      const gt = of(g), mapped = of(x.was), result = of(x.armBody);
      if (gt.t !== "fn") { ok = false; return; }
      set(x.item, item!);
      set(x.ref, item!);
      set(x.gref, gt);
      set(x.applied, gt.ret);
      set(x.lam, { t: "fn", params: [mapped], ret: result, eff: { effs: [], tail: null } });
      set(x.body, result);
      if (x.rest) set(x.rest, { t: "con", id: LIST, args: [item!] });
    },
    done: () => (ok ? out : null),
  };
}

// A fold over the items that reach a place (G15b, LIGHTS.md), made one
// fold over the list: `fold within reach(xs, place, reach, here)` is a
// fold over xs whose item arm, where the item doesn't reach, gives the
// folded rest as it is. No list of the items that reach is made, so a
// shader's loop over the lights it captured reads them in place
// (scalar.ts shaderFold). First, a consumer given them (`sum(within
// reach(...))`) has its fold put in place, as for a map above.
//
// The same: within reach keeps an item iff `reaches` says so, in order;
// the place and reach given only compute, and here is a name or a
// literal, so reading them per item is reading them once.
function within(code: Code, info: Info, id: Id): boolean {
  const n = code.nodes[id];
  if (!WITHIN || !REACHES || !isCall(n) || n.args?.length !== 4) return false;
  const f = code.nodes[n.fn];
  if (f?.kind !== "ref" || f.target !== WITHIN) return false;
  const [, place, reach, here] = n.args;
  const plain = (x: Id) => { const k = code.nodes[x]?.kind; return k === "ref" || k === "lambda"; };
  const h = code.nodes[here]?.kind;
  return plain(place) && plain(reach) && onlyComputes(code, info, place) && onlyComputes(code, info, reach) && (h === "ref" || h === "lit")
    && !(h === "ref" && code.nodes[(code.nodes[here] as { target: Id }).target]?.kind === "def" && info.typeOf.get(here) && info.subst.zonk(info.typeOf.get(here)!).t === "fn");
}
// One arm for nil and one for the items, which names the folded rest and
// never reads the rest itself.
function guardable(code: Code, fold: Extract<Node, { kind: "fold" }>): boolean {
  const arms = fold.arms.map((a) => code.nodes[a]);
  if (arms.length !== 2 || arms.some((a) => a?.kind !== "arm")) return false;
  const cons = arms.find((a) => (a as { variant: Id }).variant === CONS) as Extract<Node, { kind: "arm" }> | undefined;
  if (!cons || !arms.some((a) => (a as { variant: Id }).variant === NIL) || !cons.results[1]) return false;
  return !cons.binds[1] || !subtree(code, cons.body).some((x) => { const r = code.nodes[x]; return r.kind === "ref" && r.target === cons.binds[1]; });
}
function guarded(code: Code, at: Id): Code {
  const nodes: Record<Id, Node> = copyNodes(code.nodes);
  const fold = nodes[at] as Extract<Node, { kind: "fold" }>;
  const call = code.nodes[fold.scrutinee] as Extract<Node, { kind: "call" }>;
  const [xs, place, reach, here] = call.args!;
  const cons = nodes[fold.arms.find((a) => (nodes[a] as { variant: Id }).variant === CONS)!] as Extract<Node, { kind: "arm" }>;
  const fresh = (n: Omit<Node, "id">): Id => { const id = freshId(); nodes[id] = { ...n, id } as Node; return id; };
  // The item named, so reaches can be given it.
  const item = cons.binds[0] ?? fresh({ kind: "binder" } as Omit<Node, "id">);
  const test = fresh({ kind: "call", fn: fresh({ kind: "ref", target: REACHES! } as Omit<Node, "id">), args: [fresh({ kind: "ref", target: item } as Omit<Node, "id">), place, reach, here] } as Omit<Node, "id">);
  const yes = fresh({ kind: "arm", variant: TRUE, binds: [], results: [], body: cons.body } as Omit<Node, "id">);
  const no = fresh({ kind: "arm", variant: FALSE, binds: [], results: [], body: fresh({ kind: "ref", target: cons.results[1]! } as Omit<Node, "id">) } as Omit<Node, "id">);
  const body = fresh({ kind: "match", scrutinee: test, arms: [yes, no], otherwise: null } as Omit<Node, "id">);
  nodes[cons.id] = { ...cons, binds: [item, ...cons.binds.slice(1)], body };
  nodes[at] = { ...fold, scrutinee: xs };
  // The within reach call and its function's ref go; its inputs are moved.
  dropNode(nodes, call.fn);
  dropNode(nodes, call.id);
  return { ...code, nodes };
}
