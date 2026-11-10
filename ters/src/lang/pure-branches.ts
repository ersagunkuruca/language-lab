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

// The calls of `count` a target may share out by the alternatives of its
// search's first choice (C43): the search written in place, doing nothing
// but compute and choose, as a map's function may.
export function parallelCounts(code: Code, info: Info): Set<Id> {
  const out = new Set<Id>();
  for (const n of Object.values(code.nodes)) {
    if (!isCall(n) || n.args.length !== 1) continue;
    const f = code.nodes[n.fn], l = code.nodes[n.args[0]];
    if (f?.kind !== "ref" || (f as NodeOf<"ref">).target !== S.count || l?.kind !== "lambda" || l.params.length) continue;
    const own = ownEffects(code, info, l.body);
    if (own && [...own].every((e) => e === CHOICE || ALONE.has(e)) && !(own.has(DIVERGE) && own.has(ABORT))) out.add(n.id);
  }
  return out;
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
