// Small pure functions put in place where they're called (C194), so that
// sharing (share-calls.ts, C189) reaches across them: break's `moved` works
// out `speed` itself and calls `travelled`, which works it out again; with
// `travelled` in place, both are the same call in one function, made once.
//
// Changes no bit of any answer: what's put in place only computes. A
// function is small when its body is lets and a pure expression (no
// attempt, loop or effect), of at most SMALL nodes, and it doesn't call
// itself. Its inputs become lets of the caller, and its lets the caller's.
// Then copies go (scalar.ts tidied).
// One pass, callers in order: a function put in place had its own small
// calls put in place first when it comes earlier.

import { kids, mapKids, mapLocals, tidied, type CoreIR, type SExpr } from "./scalar.ts";
import { PURE_OPS, pureFuncs, pureTree, SAFE_RT } from "./share-calls.ts";
import { COLUMN_READ } from "./kept-arrays.ts";
import { originalOf, PRELUDE_DEFS, typedOriginalOf } from "../../ters/src/lang/prelude-ids.ts";

// Kept a call of its own: its answers are kept with its inputs on a page
// (memo-calls.ts addedMemoFuncs, C354d).
const keptCall = (def: string) => typedOriginalOf(originalOf(def)) === PRELUDE_DEFS["set tree added all"];

const SMALL = 40;
const size = (e: SExpr): number => 1 + kids(e).reduce((n, k) => n + size(k), 0);
const calls = (e: SExpr, g: number): boolean => (e.k === "call" && e.fn === g) || kids(e).some((k) => calls(k, g));
// Lets and a pure expression.
const plainBody = (e: SExpr, pure: Set<number>): boolean =>
  e.k === "let" ? !e.check && !e.seeded && pureTree(e.value, pure) && plainBody(e.body, pure) : pureTree(e, pure);

// In a loop (a function calling itself last), a small function that uses
// the runtime's reads and Ints is put in place too (C303): mnist's `at or
// 0`, `first(xs item at i, else 0)`, and `n ≤ 0`. There the printer reads
// an array the loop keeps from its buffer and counts its positions as
// numbers (kept-arrays.ts), which it can do only for what the loop's own
// body does. Lets, branches and attempts of pure expressions and the
// runtime's functions that only read and compute.
const readTree = (e: SExpr, pure: Set<number>, tried = false): boolean => {
  switch (e.k) {
    case "rt": return !e.host && (SAFE_RT(e.fn) || COLUMN_READ.test(e.fn)) && e.args.every((a) => readTree(a, pure, tried));
    // An attempt's body may have no answer (columns' `item at`, C304c).
    case "attempt": return !e.spent && !e.resumes && readTree(e.body, pure, true) && kids(e).every((a) => a === e.body || readTree(a, pure, tried));
    case "fail": return tried;
    case "let": return !e.check && !e.seeded && readTree(e.value, pure, tried) && readTree(e.body, pure, tried);
    case "if": return kids(e).every((a) => readTree(a, pure, tried));
    case "call": return !e.cps && !e.tail && pure.has(e.fn) && e.args.every((a) => readTree(a, pure, tried));
    case "op": return PURE_OPS.has(e.op) && e.args.every((a) => readTree(a, pure, tried));
    case "make": case "new": return e.args.every((a) => readTree(a, pure, tried));
    default: return pureTree(e, pure);
  }
};
const loops = (e: SExpr, fi: number): boolean => (e.k === "call" && e.fn === fi && e.tail) || kids(e).some((k) => loops(k, fi));

const stops = (e: SExpr): boolean => (e.k === "call" && !!e.cps) || e.k === "handle" || kids(e).some(stops);
// `inLoops`: only those using the runtime, only into loops, run after
// the passes that read a loop's calls as they are written (columns.ts,
// the flock's and greenhouse's loops over arrays of records).
export function inlineSmall(ir: CoreIR, inLoops = false): number {
  const pure = pureFuncs(ir);
  const small = ir.funcs.map((g, i) => !inLoops && !keptCall(g.def) && pure.has(i) && !g.inner && size(g.body) <= SMALL && plainBody(g.body, pure) && !calls(g.body, i));
  const reader = ir.funcs.map((g, i) => inLoops && !keptCall(g.def) && !g.inner && size(g.body) <= SMALL && readTree(g.body, pure) && !calls(g.body, i));
  let changed = 0;
  ir.funcs.forEach((f, fi) => {
    // Not into a function that may stop and go on later (a call that keeps
    // the rest, a handler, an inner function such as a handler's body):
    // what it holds across a stop is saved in a frame laid out when lowered,
    // and a let added now may not be in it (open-file.test's `byte items`,
    // put into a handled body, read none).
    if (f.inner || stops(f.body)) return;
    const loop = loops(f.body, fi);
    if (inLoops && !loop) return;
    const put = (e: SExpr): SExpr => {
      const r = mapKids(e, put);
      if (r.k !== "call" || r.cps || r.tail || r.fn === fi || !(small[r.fn] || (loop && reader[r.fn]))) return r;
      const g = ir.funcs[r.fn];
      // Each of g's locals (its inputs first) a new local of f.
      const at = g.locals.map((t) => f.locals.push(t) - 1);
      changed++;
      return r.args.reduceRight<SExpr>((body, value, j) => ({ k: "let", i: at[j], value, body }), mapLocals(g.body, (i) => at[i]));
    };
    const before = changed;
    f.body = put(f.body);
    // An input given a local is that local (tidied), so the same call
    // reads the same locals wherever it was written.
    if (changed > before) f.body = tidied(f, fi).body;
  });
  return changed;
}

// Calls put in place for the printed JavaScript (Ersagun 2026-11-16: "why
// so many functions where we could inline lots of function calls and get
// rid of the stack burden?"): a function called from one place only,
// whatever it does, after every other pass, so the code doesn't grow (the
// function is no longer printed, core-js.ts reachedFuncs). Its inputs
// become lets of the caller, in order, so what it does is done as before,
// in the same order. Not a function whose call is itself something
// counted or kept: one that may not finish (each call takes a step from
// a page's budget), spends fuel, has no answer (partial), gives several,
// is a definition's value worked out once, reads a closure's captures, or
// can stop and go on later (handlers, waits, the rest of a search); nor one
// that reaches itself. Rounds until nothing more is put in place.
// Into a fold's own loop too (G3d): the flock's `met`, called once for
// each neighbour, is put in its loop over a cell's birds.
// Small functions called from several places stay calls: put in each
// place they made the pages bigger (dice 29.5 to 31.0 KB, spacetime 165 to
// 179 KB) and no run faster, as V8 puts a small function in place itself
// once it's called often (countdown, collatz, divisors, queens, 11 runs:
// the same times within 1-6%, either way).
export function inlineCalls(ir: CoreIR, divergent: (i: number) => boolean): number {
  const reach = ir.funcs.map(() => new Set<number>());
  const direct = (e: SExpr, out: Set<number>) => { if (e.k === "call" || e.k === "closure") out.add(e.fn); if (e.k === "closure" && e.d !== undefined) out.add(e.d); kids(e).forEach((k) => direct(k, out)); };
  ir.funcs.forEach((f, i) => direct(f.body, reach[i]));
  for (let grew = true; grew; ) { grew = false; for (const r of reach) for (const j of [...r]) for (const k of reach[j]) if (!r.has(k)) { r.add(k); grew = true; } }
  const plain = (e: SExpr): boolean => {
    switch (e.k) {
      case "cap": case "handle": case "released": case "budget": case "search": case "choose": case "fail": return false;
      case "attempt": if (e.resumes) return false; break;
      case "world": if (e.suspends || e.cps) return false; break;
      case "call": case "apply": if (e.cps) return false; break;
    }
    return kids(e).every(plain);
  };
  const can = ir.funcs.map((g, i) => !keptCall(g.def) && !g.inner && !g.partial && !g.spends && !g.budgeted && !g.multi && !g.piece && !g.value && g.bail === undefined && !divergent(i) && !reach[i].has(i) && plain(g.body));
  // Tail calls inside a body put where its call wasn't one aren't any more.
  const untail = (e: SExpr): SExpr => { const r = mapKids(e, untail); return (r.k === "call" || r.k === "apply") && r.tail ? { ...r, tail: false } : r; };
  let changed = 0;
  for (let round = 0; round < 8; round++) {
    const sites = new Map<number, number>();
    // (And what each function calls: one calling nothing that can be put
    // in place isn't walked again.)
    const callees = ir.funcs.map(() => new Set<number>());
    let at = 0;
    const count = (e: SExpr) => { if (e.k === "call") { sites.set(e.fn, (sites.get(e.fn) ?? 0) + 1); callees[at].add(e.fn); } if (e.k === "closure") sites.set(e.fn, Infinity); kids(e).forEach(count); };
    ir.funcs.forEach((f, i) => { at = i; count(f.body); });
    const before = changed;
    ir.funcs.forEach((f, fi) => {
      if (![...callees[fi]].some((j) => j !== fi && can[j] && sites.get(j) === 1)) return;
      if (stops(f.body)) return;
      const put = (e: SExpr): SExpr => {
        const r = mapKids(e, put);
        if (r.k !== "call" || r.cps || r.fn === fi || !can[r.fn] || reach[r.fn].has(fi)) return r;
        const g = ir.funcs[r.fn];
        if (sites.get(r.fn) !== 1) return r;
        const at = g.locals.map((t) => f.locals.push(t) - 1);
        changed++;
        const body = mapLocals(r.tail ? g.body : untail(g.body), (i) => at[i]);
        return r.args.reduceRight<SExpr>((b, value, j) => ({ k: "let", i: at[j], value, body: b }), body);
      };
      const was = changed;
      const body = put(f.body);
      if (changed > was) {
        f.body = body;
        f.body = tidied(f, fi).body;
        for (const j of [...reach[fi]]) for (const k of reach[j]) reach[fi].add(k);
      }
    });
    if (changed === before) break;
  }
  return changed;
}
