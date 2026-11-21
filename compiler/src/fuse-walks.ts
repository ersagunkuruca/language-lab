// A walk over a list made by `map` or `flat map`, the walk over what they
// were given (G3b, GAPS game rounds 1 to 3: moths' nine cells, the
// greenhouse's nine and the flock's 27, each a list made per bird only to
// be walked once by `flock over`).
//
// A walker is a definition that goes down one of its inputs carrying an
// answer along, the rest of its inputs passed on as they came:
//
//   w(…, list, acc, …) = match list
//     nil → acc
//     cons(h, t) → w(…, t, step(h, acc, …), …)
//
// Walking `a ++ b` from acc is walking b from what walking a gave, so
//
//   w(…, flat map(xs, f), acc) = v(…, xs, acc)   where
//   v(…, xs, acc) = match xs
//     nil → acc
//     cons(x, r) → v(…, r, w(…, f(x), acc))
//
// and with `map(xs, g)` v's step is w's own, given g(x) for h. The items
// are met in the same order, one by one, so the answer is the same to the
// bit (a sum of floats included). v is a new definition, given what f or g
// read from where they were written as inputs of its own (lambda lifting,
// Johnsson 1985). A list made where it is walked, through lets or a call
// of a definition that only computes (the flock's `around cells`), is
// walked where it is made: the call goes into the lets, and the
// definition is put in place. Then the inner walk `w(…, f(x), acc)` is a
// walker's call on a made list in turn, so `flat map` of `flat map` of
// `map` is three loops, and no list is made.
//
// Only where everything moved only computes (or may run long): the step
// and f run in another order than as written (each f(x) after the steps
// on the items before it, not all at first), which nothing that only
// computes can tell. The walker stays defined, for its other callers.
//
// Deforestation (Philip Wadler, "Deforestation: transforming programs to
// eliminate trees", 1990), here by the walker's shape, as fuse-steps.ts
// does for folds.

import { freshId, isCall, subtree, mapIds, type Code, type Id, type Node, type NodeOf, copyNodes, dropNode, changedOver } from "../../ters/src/model.ts";
import type { Names } from "../../ters/src/presentation.ts";
import { infer, inferRewritten, type Info, type Options } from "../../ters/src/lang/infer.ts";
import { preludeDef } from "../../ters/src/lang/arith.ts";
import { CONS, NIL } from "../../ters/src/lang/std.ts";
import { DIVERGE, type Type } from "../../ters/src/lang/types.ts";
import { LIBRARY } from "../../ters/src/lang/library.ts";
import { does } from "./fuse-steps.ts";

const MAP = preludeDef("map"), FLAT_MAP = preludeDef("flat map");
// How deep a list may be made inside lets and calls and still be found.
const DEEP = 6;

interface Walker { def: Id; params: Id[]; k: number; m: number; head: Id; step: Id }

export function fuseWalks(code: Code, info: Info, names: Names, opts: Options): { code: Code; info: Info; names: Names; made: Id[] } {
  const before = new Set(code.defs);
  for (let round = 0; round < 40; round++) {
    const c = candidate(code, info, names);
    if (!c) break;
    const next = c();
    // Checked again only where the round changed it, over the check
    // before (infer.ts inferRewritten): a round adds a definition and
    // changes a call or two, and the whole program was checked each round
    // (greenhouse-page: 18 rounds, 0.9 s a compile).
    const changed = info.options === opts ? changedOver(code.nodes, next.code.nodes) : undefined;
    const checked = changed ? inferRewritten(code, next.code, next.names, info, changed.filter((id) => code.nodes[id] !== undefined), next.code.defs.filter((d) => !code.defs.includes(d))) : infer(next.code, next.names, undefined, opts);
    if (checked.errors.length > info.errors.length) break;
    ({ code, names } = next);
    info = checked;
  }
  return { code, info, names, made: code.defs.filter((d) => !before.has(d)) };
}

const refTo = (code: Code, x: Id | undefined): Id | null => { const n = x ? code.nodes[x] : undefined; return n?.kind === "ref" ? n.target : null; };
const onlyComputes = (effs: Set<Id> | null | undefined) => !!effs && [...effs].every((e) => e === DIVERGE);
function typeEffects(info: Info, def: Id): Set<Id> | null {
  const t = info.schemes.get(def)?.type ?? info.typeOf.get(def);
  const z = t && info.subst.zonk(t as Type);
  return z?.t === "fn" ? new Set(z.eff.effs) : null;
}

// def as a walker, or null.
function walker(code: Code, info: Info, def: Id): Walker | null {
  const d = code.nodes[def];
  if (d?.kind !== "def" || !d.body) return null;
  const lam = code.nodes[d.body];
  if (lam?.kind !== "lambda" || lam.params.length < 2 || lam.results) return null;
  if (!onlyComputes(typeEffects(info, def))) return null;
  const m0 = code.nodes[lam.body];
  if (m0?.kind !== "match" || m0.otherwise || m0.name || m0.arms.length !== 2) return null;
  const ps = lam.params, k = ps.indexOf(refTo(code, m0.scrutinee) ?? "");
  if (k < 0) return null;
  const arms = m0.arms.map((a) => code.nodes[a] as NodeOf<"arm">);
  const nil = arms.find((a) => a.variant === NIL), cons = arms.find((a) => a.variant === CONS);
  if (!nil || !cons || cons.binds.length !== 2) return null;
  const m = ps.indexOf(refTo(code, nil.body) ?? "");
  if (m < 0 || m === k) return null;
  const [head, tail] = cons.binds;
  const call = code.nodes[cons.body];
  if (!isCall(call) || !call.args || call.args.length !== ps.length || refTo(code, call.fn) !== def) return null;
  for (let i = 0; i < ps.length; i++) {
    if (i === m) continue;
    if (refTo(code, call.args[i]) !== (i === k ? tail : ps[i])) return null;
  }
  const step = call.args[m];
  const read = new Set(subtree(code, step).map((x) => refTo(code, x)));
  if (read.has(tail) || read.has(ps[k]) || read.has(def)) return null;
  return { def, params: ps, k, m, head, step };
}

// How the list e is made: by map or flat map, maybe inside lets or a call
// of a definition that only computes. null when it isn't.
// `f`: the function the list is made by, however deep.
type Made = ({ how: "list"; fn: Id } | { how: "let" } | { how: "def"; def: Id }) & { f: Id };
function made(code: Code, info: Info, e: Id, deep = 0): Made | null {
  const n = code.nodes[e];
  if (!isCall(n) || !n.args || deep > DEEP) return null;
  const fn = code.nodes[n.fn], target = refTo(code, n.fn);
  if ((target === MAP || target === FLAT_MAP) && n.args.length === 2) return { how: "list", fn: target, f: n.args[1] };
  if (fn?.kind === "lambda" && !fn.results && fn.params.length === n.args.length) { const m = made(code, info, fn.body, deep + 1); return m && { how: "let", f: m.f }; }
  if (!target) return null;
  const d = code.nodes[target];
  if (d?.kind !== "def" || !d.body || !onlyComputes(typeEffects(info, target))) return null;
  const lam = code.nodes[d.body];
  if (lam?.kind !== "lambda" || lam.results || lam.params.length !== n.args.length) return null;
  if (subtree(code, d.body).some((x) => refTo(code, x) === target)) return null;
  const m = made(code, info, lam.body, deep + 1);
  return m && { how: "def", def: target, f: m.f };
}

function candidate(code: Code, info: Info, names: Names): (() => { code: Code; names: Names }) | null {
  const walkers = new Map<Id, Walker | null>();
  const reached = new Set(code.defs.flatMap((d) => subtree(code, d)));
  for (const id of reached) {
    const n = code.nodes[id];
    if (!isCall(n) || !n.args || LIBRARY.code.nodes[id]) continue;
    const t = refTo(code, n.fn);
    if (!t || code.nodes[t]?.kind !== "def") continue;
    if (!walkers.has(t)) walkers.set(t, walker(code, info, t));
    const w = walkers.get(t);
    if (!w || n.args.length !== w.params.length) continue;
    const how = made(code, info, n.args[w.k]);
    if (!how) continue;
    // A map whose function loops on each item is kept: its items can be
    // made at once, shared out on workers (branches, map.pure), and each
    // item's work outweighs the list saved (I329: pond's plans, each fish's
    // a walk of the pond, made in turn between the plans applied, took
    // pond 100 40 from 1.8 to 5.8 s).
    if (loopsPerItem(how.f)) continue;
    if (!n.args.every((a) => onlyComputes(does(code, info, a)))) continue;
    return () => rewrite(code, names, id, w, how);
  }
  return null;

  // Whether f calls, here or through the definitions it calls, one that
  // calls itself: work on each item not bounded by what's written.
  function loopsPerItem(f: Id): boolean {
    const seen = new Map<Id, boolean>();
    const loops = (d: Id, path: Set<Id>): boolean => {
      if (path.has(d)) return true;
      const known = seen.get(d);
      if (known !== undefined) return known;
      const body = (code.nodes[d] as NodeOf<"def">).body;
      path.add(d);
      const r = !!body && calls(body).some((t) => loops(t, path));
      path.delete(d);
      seen.set(d, r);
      return r;
    };
    // The definitions called inside e but map and flat map, which this
    // pass walks through.
    const calls = (e: Id) => [...new Set(subtree(code, e).map((x) => refTo(code, x)).filter((t): t is Id => !!t && t !== MAP && t !== FLAT_MAP && code.nodes[t]?.kind === "def"))];
    return calls(f).some((t) => loops(t, new Set()));
  }
}

function rewrite(code: Code, names: Names, at: Id, w: Walker, how: Made): { code: Code; names: Names } {
  const nodes: Record<Id, Node> = copyNodes(code.nodes), more: Names = {};
  const call = code.nodes[at] as NodeOf<"call"> & { args: Id[] };
  const e = code.nodes[call.args[w.k]] as NodeOf<"call"> & { args: Id[] };
  const add = (x: Omit<Node, "id">, id = freshId()) => { nodes[id] = { id, ...x } as Node; return id; };
  const ref = (t: Id) => add({ kind: "ref", target: t } as Omit<Node, "id">);
  const binder = (name: string) => { const b = add({ kind: "binder" } as Omit<Node, "id">); more[b] = name; return b; };
  const callOf = (fn: Id, args: Id[], id?: Id) => add({ kind: "call", fn, args } as Omit<Node, "id">, id);
  const defs = [...code.defs];
  if (how.how === "let") {
    // w(…, (λys. B)(es), …) is (λys. w(…, B, …))(es).
    const lam = code.nodes[e.fn] as NodeOf<"lambda">;
    const inner = callOf(call.fn, call.args.map((a, i) => (i === w.k ? lam.body : a)));
    nodes[lam.id] = { ...lam, body: inner };
    dropNode(nodes, e.id);
    callOf(lam.id, e.args, at);
  } else if (how.how === "def") {
    // The definition's function copied in place, every id inside fresh.
    const body = (code.nodes[how.def] as NodeOf<"def">).body!;
    const ids = new Map(subtree(code, body).map((x) => [x, freshId()] as const));
    for (const [old, now] of ids) {
      nodes[now] = mapIds(code.nodes[old], (x) => ids.get(x) ?? x);
      if (names[old]) more[now] = names[old];
    }
    dropNode(nodes, e.fn);
    callOf(ids.get(body)!, e.args, e.id);
  } else {
    const [xs, f] = e.args;
    const inF = new Set(subtree(code, f));
    // What f reads from where it was written: inputs of v.
    const free = [...new Set(subtree(code, f).map((x) => refTo(code, x)).filter((t): t is Id => !!t && code.nodes[t]?.kind === "binder" && !inF.has(t)))];
    const v = freshId(), vname = `${names[w.def] ?? "walk"} over ${how.fn === MAP ? "map" : "flat map"}`;
    more[v] = vname;
    const ps = w.params.map((p, i) => binder(i === w.k ? "items" : names[p] ?? `p${i}`));
    const fvs = free.map((t) => binder(names[t] ?? "it"));
    const lifted = new Map(free.map((t, i) => [t, fvs[i]] as const));
    for (const x of inF) { const r = code.nodes[x]; if (r.kind === "ref" && lifted.has(r.target)) nodes[x] = { ...r, target: lifted.get(r.target)! }; }
    const x = binder("item"), r = binder("others");
    const fx = callOf(f, [ref(x)]);
    let step: Id;
    if (how.fn === FLAT_MAP) step = callOf(ref(w.def), w.params.map((_, i) => (i === w.k ? fx : ref(ps[i]))));
    else {
      // w's own step, given g(x) for its item.
      const h = binder(names[w.head] ?? "item");
      const ids = new Map(subtree(code, w.step).map((y) => [y, freshId()] as const));
      w.params.forEach((p, i) => ids.set(p, ps[i]));
      ids.set(w.head, h);
      for (const y of subtree(code, w.step)) nodes[ids.get(y)!] = mapIds(code.nodes[y], (z) => ids.get(z) ?? z);
      step = callOf(add({ kind: "lambda", params: [h], body: ids.get(w.step)! } as Omit<Node, "id">), [fx]);
    }
    const again = callOf(ref(v), [...w.params.map((_, i) => (i === w.k ? ref(r) : i === w.m ? step : ref(ps[i]))), ...fvs.map(ref)]);
    const nilArm = add({ kind: "arm", variant: NIL, binds: [], results: [], body: ref(ps[w.m]) } as Omit<Node, "id">);
    const consArm = add({ kind: "arm", variant: CONS, binds: [x, r], results: [], body: again } as Omit<Node, "id">);
    const match = add({ kind: "match", scrutinee: ref(ps[w.k]), arms: [nilArm, consArm], otherwise: null } as Omit<Node, "id">);
    const lam = add({ kind: "lambda", params: [...ps, ...fvs], body: match } as Omit<Node, "id">);
    nodes[v] = { id: v, kind: "def", body: lam } as Node;
    defs.push(v);
    dropNode(nodes, e.id);
    dropNode(nodes, e.fn);
    callOf(ref(v), [...call.args.map((a, i) => (i === w.k ? xs : a)), ...free.map(ref)], at);
  }
  return { code: { ...code, nodes, defs }, names: { ...names, ...more } };
}
