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
import { pureFuncs, pureTree } from "./share-calls.ts";

const SMALL = 40;
const size = (e: SExpr): number => 1 + kids(e).reduce((n, k) => n + size(k), 0);
const calls = (e: SExpr, g: number): boolean => (e.k === "call" && e.fn === g) || kids(e).some((k) => calls(k, g));
// Lets and a pure expression.
const plainBody = (e: SExpr, pure: Set<number>): boolean =>
  e.k === "let" ? !e.check && !e.seeded && pureTree(e.value, pure) && plainBody(e.body, pure) : pureTree(e, pure);

const stops = (e: SExpr): boolean => (e.k === "call" && !!e.cps) || e.k === "handle" || kids(e).some(stops);
export function inlineSmall(ir: CoreIR): number {
  const pure = pureFuncs(ir);
  const small = ir.funcs.map((g, i) => pure.has(i) && !g.inner && size(g.body) <= SMALL && plainBody(g.body, pure) && !calls(g.body, i));
  let changed = 0;
  ir.funcs.forEach((f, fi) => {
    // Not into a function that may stop and go on later (a call that keeps
    // the rest, a handler, an inner function such as a handler's body):
    // what it holds across a stop is saved in a frame laid out when lowered,
    // and a let added now may not be in it (open-file.test's `byte items`,
    // put into a handled body, read none).
    if (f.inner || stops(f.body)) return;
    const put = (e: SExpr): SExpr => {
      const r = mapKids(e, put);
      if (r.k !== "call" || r.cps || r.tail || r.fn === fi || !small[r.fn]) return r;
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
