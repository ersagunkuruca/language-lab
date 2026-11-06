// A small pure function put where it is called, so that sharing
// (share-calls.ts, C189) reaches across it (C194, GAPS.md round 12 B3):
// break's `moved` works `speed` out itself, and once more inside `rest
// time` and `travelled`, which it calls; with those in it, each is one read.
//
// Only functions that compute and always answer (pureFuncs), that call
// nothing that calls them back, read no closure's captures and are small.
// An input that is a local or a constant is read where the parameter was;
// another is given a local first. What the function's body computes is
// what the call computed, in the same order of its parts, so no bit of an
// answer changes.

import { kids, mapKids, mapLocals, type CoreIR, type SExpr } from "./scalar.ts";
import { pureFuncs } from "./share-calls.ts";

const SMALL = 40;
// What a function may grow by, so that chains of small calls stay small.
const GROWTH = 200;
const size = (e: SExpr): number => 1 + kids(e).reduce((n, x) => n + size(x), 0);
const has = (e: SExpr, k: SExpr["k"]): boolean => e.k === k || kids(e).some((x) => has(x, k));
const given = (e: SExpr): boolean => ["local", "num", "int", "bool", "text"].includes(e.k);

export function inlinePure(ir: CoreIR): number {
  const pure = pureFuncs(ir);
  const calls = ir.funcs.map((f) => { const out = new Set<number>(); const w = (e: SExpr) => { if (e.k === "call") out.add(e.fn); kids(e).forEach(w); }; w(f.body); return out; });
  // Whether i reaches itself through what it calls.
  const cyclic = (i: number): boolean => {
    const seen = new Set<number>(), todo = [...calls[i]];
    while (todo.length) { const j = todo.pop()!; if (j === i) return true; if (seen.has(j)) continue; seen.add(j); todo.push(...calls[j]); }
    return false;
  };
  // The bodies as they were, so what is put in place is never itself grown.
  const small = new Map(ir.funcs.flatMap((g, i) => (pure.has(i) && !g.inner && !g.value && !g.multi && size(g.body) <= SMALL && (has(g.body, "call") || size(g.body) <= 3) && !has(g.body, "attempt") && !has(g.body, "cap") && !cyclic(i) ? [[i, g.body] as const] : [])));
  let n = 0;
  ir.funcs.forEach((f) => {
    let grown = 0;
    const put = (e: SExpr): SExpr => {
      const r = mapKids(e, put);
      if (r.k !== "call" || r.cps || !small.has(r.fn)) return r;
      const add = size(small.get(r.fn)!);
      if (grown + add > GROWTH) return r;
      grown += add;
      const g = ir.funcs[r.fn];
      const at = f.locals.length;
      f.locals.push(...g.locals);
      const lets: [number, SExpr][] = [];
      const to = new Map<number, SExpr>();
      r.args.forEach((a, j) => { if (given(a)) to.set(at + j, a); else lets.push([at + j, a]); });
      // A call in it is in tail place no more.
      const untail = (x: SExpr): SExpr => { const y = mapKids(x, untail); return y.k === "call" && y.tail ? { ...y, tail: false } : y; };
      const read = (x: SExpr): SExpr => (x.k === "local" && to.has(x.i) ? to.get(x.i)! : mapKids(x, read));
      let body = read(untail(mapLocals(small.get(r.fn)!, (i) => i + at)));
      for (let j = lets.length - 1; j >= 0; j--) body = { k: "let", i: lets[j][0], value: lets[j][1], body };
      n++;
      // What it calls may be small too.
      return put(body);
    };
    f.body = put(f.body);
  });
  return n;
}
