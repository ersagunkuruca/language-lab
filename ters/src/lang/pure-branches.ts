// Pure branches of `together` (BACKLOG L62, LANGUAGE-NEEDS-2026-10-24.md
// "Parallelism"): a `together` whose actions do nothing to the world, no
// Update, no waiting, no Choice, no draw from the shared random stream and
// none of the program's own effects (whose handler is shared state) may
// run its branches on other cores, and nobody can tell: the answer is the
// same either way. Its actions are one list, so they share one row; the
// row says it, with no word in the program. Haskell's `par` (Marlow et
// al., "Seq no more", 2010) without the annotation: `together` already
// says "independent", and the row says "and safe".
//
// The runtime decides by cost whether to (a branch worth less than a
// thread hop runs in place, C41); this only marks the calls it may.

import { originalOf, SPLIT_COPIED_FROM } from "./prelude-ids.ts";
import { subtree, type Code, type Id, type NodeOf, isCall } from "../model.ts";
import { preludeDef } from "./arith.ts";
import type { Info } from "./infer.ts";
import { ABORT, S, SIGS, writtenItems } from "./std.ts";
import { CHOICE, DIVERGE, Subst, type Type } from "./types.ts";

// What a branch may do and still run elsewhere: stop (Abort), or run long
// (Diverge). Everything else is shared with the caller or the world.
const ALONE: ReadonlySet<Id> = new Set([ABORT, DIVERGE]);

// What an action itself does: the effects named by what its body calls
// (a builtin's signature, a definition's generalized type, an operation's
// effect). Its type can't say: unified with together's, every action's row
// is the whole list's, Await and all. Null when it calls a function it was
// given or one computed, whose effects only the caller knows.
export function ownEffects(code: Code, info: Info, body: Id): Set<Id> | null {
  const out = new Set<Id>();
  const binders = new Set<Id>();
  for (const id of subtree(code, body)) { const n = code.nodes[id]; if (n?.kind === "lambda") n.params.forEach((p) => binders.add(p)); }
  const effsOf = (t: Type | undefined) => { if (t?.t === "fn") t.eff.effs.forEach((e) => out.add(e)); };
  for (const id of subtree(code, body)) {
    const n = code.nodes[id];
    if (isCall(n)) {
      const f = code.nodes[n.fn];
      // A let (a lambda written in place, called at once): what it does
      // is its body's, in the subtree too.
      if (f?.kind === "lambda") continue;
      if (f?.kind !== "ref") return null;
      const target = code.nodes[f.target];
      if (!target || target.kind === "binder" || target.kind === "lambda") return null;
    }
    if (n?.kind !== "ref") continue;
    const target = code.nodes[n.target];
    if (!target) continue;
    // A function from outside the action, given to something it calls
    // (map(xs, g) with g the caller's): only the caller knows what g does.
    if (target.kind === "binder" && !binders.has(target.id)) {
      const t = info.typeOf.get(n.id);
      if ((t && info.subst ? info.subst.zonk(t) : t)?.t === "fn") return null;
      continue;
    }
    if (target.kind === "variant") {
      const owner = info.owner.get(target.id), td = owner ? code.nodes[(code.nodes[owner] as NodeOf<"def">).body!] : undefined;
      if (td?.kind === "typedef" && td.effect) out.add(owner!);
    } else if (target.kind === "def") {
      const scheme = info.schemes.get(target.id);
      effsOf(scheme ? (info.subst ? info.subst.zonk(scheme.type) : scheme.type) : undefined);
    } else if (SIGS[n.target]) effsOf(SIGS[n.target](new Subst()));
  }
  return out;
}

// The calls of `together` whose actions, written in place as a list of
// lambdas, may run on other cores.
export function pureTogethers(code: Code, info: Info): Set<Id> {
  return new Set(pureActions(code, info).keys());
}

// Those a target may run at once with nothing to tell (C41): run in order,
// an action that aborts stops the ones after it, so none after one that
// may abort may run long (Diverge), where at once it would keep the
// together waiting. Then every action's answer, or the first abort in
// order, is the together's either way.
export function parallelTogethers(code: Code, info: Info): Set<Id> {
  const out = new Set<Id>();
  for (const [call, effs] of pureActions(code, info)) {
    const firstAbort = effs.findIndex((e) => e.has(ABORT));
    if (firstAbort < 0 || !effs.slice(firstAbort + 1).some((e) => e.has(DIVERGE))) out.add(call);
  }
  return out;
}

// The calls of `map` and `keep` a target may share out by items (C42,
// C43): the function written in place, doing nothing but compute, as a
// together's action may. Run in order, an item that aborts stops the ones
// after it, so a function that may abort may not also run long.
// all pass, any pass and first where (C43) stop at the first item that decides, so a
// test that may run long may not be run on an item past it: their tests
// may abort, never run long.
export type ListJob = "map" | "keep" | "all" | "any" | "first";
export function parallelLists(code: Code, info: Info): Map<Id, ListJob> {
  // List's map, and the array's that a split puts in its place (C196).
  const kinds = new Map<Id | undefined, ListJob>([[preludeDef("map"), "map"], [preludeDef("array map"), "map"], [preludeDef("keep"), "keep"], [preludeDef("all pass"), "all"], [preludeDef("any pass"), "any"], [preludeDef("first where"), "first"]]), out = new Map<Id, ListJob>();
  for (const n of Object.values(code.nodes)) {
    if (!isCall(n) || n.args.length !== 2) continue;
    const f = code.nodes[n.fn], l = code.nodes[n.args[1]];
    // Or the copy the arrays pass made of one (C93), or a split (C196) of
    // one that gives no list.
    const target = f?.kind === "ref" ? (f as NodeOf<"ref">).target : undefined;
    const split = target && kinds.get(originalOf(SPLIT_COPIED_FROM.get(target) ?? target));
    const kind = target ? kinds.get(originalOf(target)) ?? (split === "all" || split === "any" || split === "first" ? split : undefined) : undefined;
    if (!kind || l?.kind !== "lambda" || l.params.length !== 1) continue;
    const own = ownEffects(code, info, l.body);
    const stops = kind === "all" || kind === "any" || kind === "first";
    if (own && [...own].every((e) => ALONE.has(e)) && !(own.has(DIVERGE) && (stops || own.has(ABORT)))) out.set(n.id, kind);
  }
  return out;
}
export const parallelMaps = (code: Code, info: Info): Set<Id> => new Set([...parallelLists(code, info)].filter(([, k]) => k === "map").map(([id]) => id));

// The folds of a list a target may share out by items when they add an
// Int for each (C42): every arm doing nothing but compute, as a map's
// function may. A fold works out the rest's result before an item's arm,
// so in turn the last item's arm runs first: the runtime shares the items
// from the last, and an abort is the one the fold in turn would meet first.
export function parallelFolds(code: Code, info: Info): Set<Id> {
  const out = new Set<Id>();
  for (const n of Object.values(code.nodes)) {
    if (n.kind !== "fold") continue;
    const effs = n.arms.map((a) => ownEffects(code, info, (code.nodes[a] as NodeOf<"arm">).body));
    const all = new Set(effs.flatMap((e) => (e ? [...e] : [CHOICE])));
    if (effs.every((e) => e) && [...all].every((e) => ALONE.has(e)) && !(all.has(DIVERGE) && all.has(ABORT))) out.add(n.id);
  }
  return out;
}

// The calls of `count` and `all` a target may share out by the
// alternatives of their search's first choice (C43): the search written in
// place, doing nothing but compute and choose, as a map's function may.
// first stops at the first item with an answer, so as all pass's test its
// search may abort, never run long.
export function parallelCounts(code: Code, info: Info): Map<Id, "count" | "all" | "first"> {
  const out = new Map<Id, "count" | "all" | "first">();
  for (const n of Object.values(code.nodes)) {
    if (!isCall(n) || !n.args.length) continue;
    const f = code.nodes[n.fn], l = code.nodes[n.args[0]];
    const target = f?.kind === "ref" ? (f as NodeOf<"ref">).target : undefined;
    const kind = target === S.count ? "count" : target === S.all ? "all" : target === S.first ? "first" : undefined;
    if (!kind || n.args.length !== (kind === "first" ? 2 : 1) || l?.kind !== "lambda" || l.params.length) continue;
    const own = ownEffects(code, info, l.body);
    if (own && [...own].every((e) => e === CHOICE || ALONE.has(e)) && !(own.has(DIVERGE) && (kind === "first" || own.has(ABORT))) && !budgets(code, l.body)) out.set(n.id, kind);
  }
  return out;
}

// Whether a search sets a budget (`with fuel`), itself or in what it
// calls: one around its choices is spent by every alternative in turn, so
// a run of one alternative alone would start it afresh (C43).
function budgets(code: Code, body: Id): boolean {
  const seen = new Set<Id>(), todo = [body];
  while (todo.length) {
    for (const id of subtree(code, todo.pop()!)) {
      const n = code.nodes[id];
      if (n?.kind !== "ref") continue;
      if (n.target === S.fuel) return true;
      const d = code.nodes[n.target];
      if (d?.kind === "def" && d.body && !seen.has(d.id)) { seen.add(d.id); todo.push(d.body); }
    }
  }
  return false;
}

// Each marked call, with each action's own effects.
function pureActions(code: Code, info: Info): Map<Id, Set<Id>[]> {
  const together = preludeDef("together");
  const out = new Map<Id, Set<Id>[]>();
  if (!together) return out;
  for (const n of Object.values(code.nodes)) {
    if (!isCall(n) || n.args.length !== 1) continue;
    const f = code.nodes[n.fn];
    if (f?.kind !== "ref" || (f as NodeOf<"ref">).target !== together) continue;
    // The actions written in place, each a lambda of nothing.
    const list: Id[] = writtenItems(code.nodes, n.args[0]) ?? [""];
    const effs = list.map((a) => {
      const l = code.nodes[a];
      const own = l?.kind === "lambda" && !l.params.length ? ownEffects(code, info, l.body) : null;
      return own !== null && [...own].every((e) => ALONE.has(e)) ? own : null;
    });
    if (list.length > 0 && effs.every((e) => e)) out.set(n.id, effs as Set<Id>[]);
  }
  return out;
}

// Divide and conquer (C61 e): a call in a definition's body given two
// calls of that definition itself, g(f(a), f(b)), may run the two on
// other cores when f only computes, as a together's actions may. Their
// inputs, and the call's others, are worked out first: so those must do
// nothing at all (not even stop), or the first stop in order could change.
// The call, and the positions of the two calls of f among its inputs.
export function parallelHalves(code: Code, info: Info): Map<Id, [number, number]> {
  const out = new Map<Id, [number, number]>();
  for (const d of Object.values(code.nodes)) {
    if (d.kind !== "def" || !d.body) continue;
    const lam = code.nodes[d.body];
    if (lam?.kind !== "lambda") continue;
    const own = ownEffects(code, info, lam.body);
    if (!own || ![...own].every((e) => ALONE.has(e)) || (own.has(DIVERGE) && own.has(ABORT))) continue;
    const self = (id: Id) => { const c = code.nodes[id]; return isCall(c) && code.nodes[c.fn]?.kind === "ref" && (code.nodes[c.fn] as NodeOf<"ref">).target === d.id; };
    const refsSelf = (id: Id) => subtree(code, id).some((x) => { const r = code.nodes[x]; return r?.kind === "ref" && r.target === d.id; });
    const none = (id: Id) => { const e = ownEffects(code, info, id); return !!e && e.size === 0; };
    // Not inside a lambda of its own (that runs when it's called), but a
    // let's (a lambda called at once) is the body's.
    const lets = new Set<Id>();
    const inner = new Set<Id>();
    for (const id of subtree(code, lam.body)) {
      const n = code.nodes[id];
      if (isCall(n) && code.nodes[n.fn]?.kind === "lambda") lets.add(n.fn);
      if (n?.kind === "lambda" && !lets.has(id)) for (const x of subtree(code, id)) if (x !== id) inner.add(x);
    }
    for (const id of subtree(code, lam.body)) {
      const n = code.nodes[id];
      if (!isCall(n) || inner.has(id) || code.nodes[n.fn]?.kind !== "ref") continue;
      const at = n.args.flatMap((a, j) => (self(a) ? [j] : []));
      if (at.length !== 2) continue;
      const calls = at.map((j) => code.nodes[n.args[j]] as NodeOf<"call">);
      if (calls.some((c) => (c.args ?? []).some((a) => refsSelf(a) || !none(a)))) continue;
      if (n.args.some((a, j) => !at.includes(j) && (refsSelf(a) || !none(a))) || !none(n.fn)) continue;
      out.set(id, [at[0], at[1]]);
    }
  }
  return out;
}
