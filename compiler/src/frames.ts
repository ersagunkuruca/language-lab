// Which values never leave the frame that made them (C327b, the lifetime
// half of ALLOCATIONS-2026-11-24's per-value analysis), on the lowered IR
// every printer reads.
//
// A value leaves its frame when it is the function's answer, is put into
// a record, a case, a list or a closure's captures, is set into a box,
// goes to the runtime, the world or an abort, or goes to a function (or a
// closure's code) whose parameter in that place leaves. Each function's
// parameters are summed up once (does it leave?), to a fixpoint over the
// calls, so a closure given to a helper that only applies it stays put.
//
// A value made inside a function's loop (its calls of itself made last)
// that is handed on to the next turn would share its one place in the
// frame with the next turn's: such a value counts as leaving too.
//
// A map on the threads (c.ts parC: par:map, keep, all, any, first and the
// folds) applies its function, and a fold's way of putting two together,
// only while it runs, and waits for its threads: those stay.
//
// Anything not read here (handlers, searches, budgets, releases) counts as
// leaving, so the answer is never wrong, only sometimes too careful.
import { kids, type SExpr, type SFunc } from "./scalar.ts";
import type { FType } from "./scalar.ts";

export interface Frames {
  // The closures (nodes of the funcs given) whose value never leaves the
  // function that made it.
  closures: Set<SExpr>;
  // Each function's parameters: true where what it's given may leave.
  leaves: boolean[][];
}

const PAR = /^par:(map|keep|all|any|first|fold:\w+)$/;
const lent = (e: SExpr, j: number) => e.k === "rt" && PAR.test(e.fn) && (j === 1 || (j === 3 && e.fn === "par:fold:with"));

export function frames(funcs: SFunc[]): Frames {
  // Every closure's code by its type: an `apply` of a type runs one of them.
  const codes = new Map<string, Set<number>>();
  const all = (e: SExpr, f: (x: SExpr) => void) => { f(e); for (const k of kids(e)) all(k, f); };
  for (const g of funcs) all(g.body, (e) => { if (e.k === "closure") (codes.get(e.t.key) ?? codes.set(e.t.key, new Set()).get(e.t.key)!).add(e.fn); });
  // Parameters start as staying, and only move to leaving.
  const leaves = funcs.map((g) => g.params.map(() => false));
  // Whether input j of an `apply` of type t may leave: any code's may.
  const applied = (t: FType, j: number) => [...codes.get(t.key) ?? []].some((c) => leaves[c]?.[j] ?? true);
  // Each function's locals: what flows into them leaves (`out`) or goes on
  // to the next turn of its loop (`on`).
  const outs = funcs.map((g) => g.locals.map(() => false));
  const ons = funcs.map((g) => g.locals.map(() => false));
  let changed = true;
  const mark = (a: boolean[], i: number) => { if (a[i] === false) { a[i] = true; changed = true; } };
  // Walk e, whose value leaves (out) or goes on (on) as given; a local in
  // such a place is marked so.
  const walk = (self: number, e: SExpr, out: boolean, on: boolean): void => {
    const o = outs[self], n = ons[self];
    switch (e.k) {
      case "local": if (out) mark(o, e.i); if (on) mark(n, e.i); return;
      case "num": case "int": case "text": case "bool": case "cap": case "fail": case "zero": return;
      case "let": walk(self, e.value, o[e.i], n[e.i]); walk(self, e.body, out, on); return;
      case "if": walk(self, e.cond, false, false); walk(self, e.then, out, on); walk(self, e.else, out, on); return;
      case "case": walk(self, e.scrut, o[e.s], n[e.s]); for (const a of e.arms) if (a) walk(self, a, out, on); return;
      case "op": for (const a of e.args) walk(self, a, false, false); return;
      case "get": case "field": case "tag": walk(self, e.rec, false, false); return;
      case "call": e.args.forEach((a, j) => walk(self, a, leaves[e.fn]?.[j] ?? true, e.tail && e.fn === self)); return;
      case "apply": [e.fn, ...e.args].forEach((a, j) => walk(self, a, applied(e.t, j), false)); return;
      case "set": walk(self, e.rec, false, false); walk(self, e.value, true, false); walk(self, e.then, out, on); return;
      case "rt": e.args.forEach((a, j) => walk(self, a, !lent(e, j), !lent(e, j))); return;
      default: for (const k of kids(e)) walk(self, k, true, true);
    }
  };
  while (changed) {
    changed = false;
    funcs.forEach((g, i) => {
      walk(i, g.body, true, false);
      g.params.forEach((_, j) => { if (outs[i][j] && !leaves[i][j]) { leaves[i][j] = true; changed = true; } });
    });
  }
  // A closure stays when nothing it flows into leaves or goes on, and its
  // own code doesn't let it (input 0) leave.
  const closures = new Set<SExpr>();
  const place = (self: number, e: SExpr, out: boolean, on: boolean): void => {
    const o = outs[self], n = ons[self];
    switch (e.k) {
      case "closure":
        if (!out && !on && e.d === undefined && !leaves[e.fn]?.[0]) closures.add(e);
        for (const c of e.caps) place(self, c, true, true);
        return;
      case "let": place(self, e.value, o[e.i], n[e.i]); place(self, e.body, out, on); return;
      case "if": place(self, e.cond, false, false); place(self, e.then, out, on); place(self, e.else, out, on); return;
      case "case": place(self, e.scrut, o[e.s], n[e.s]); for (const a of e.arms) if (a) place(self, a, out, on); return;
      case "call": e.args.forEach((a, j) => place(self, a, leaves[e.fn]?.[j] ?? true, e.tail && e.fn === self)); return;
      case "apply": [e.fn, ...e.args].forEach((a, j) => place(self, a, applied(e.t, j), false)); return;
      case "set": place(self, e.rec, false, false); place(self, e.value, true, false); place(self, e.then, out, on); return;
      case "rt": e.args.forEach((a, j) => place(self, a, !lent(e, j), !lent(e, j))); return;
      case "op": case "get": case "field": case "tag": for (const k of kids(e)) place(self, k, false, false); return;
      default: for (const k of kids(e)) place(self, k, true, true);
    }
  };
  funcs.forEach((g, i) => place(i, g.body, true, false));
  return { closures, leaves };
}
