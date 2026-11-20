// `item at`, put in place where it's called (C265, C268; native): the
// library's `item at(items, j, else d)` is one attempt over an array's
// item, the stand-in d given as an input. Called, its stand-in is made for
// every read (the greenhouse's `nothing`, 32 million times a night) and
// the item it gives back is the caller's, a count taken on each of its
// cells and given back after `met` read two fields of it. In place, the
// stand-in is worked out only past the end, where it is pure, and the item
// is a read c.ts can lend (`peeked` there) when what reads it only reads.
//
// A function whose body is `attempt array.at(input 0, input 1) else input 2`
// is put in place at each call: inputs 0 and 1 worked out first, in order,
// as lets (a local as it is), and input 2 in the attempt's otherwise when
// it is pure and certain to answer (a local, a constant, a pure call of
// locals and constants), else a let after the other two. A read given to
// a call is let to a local before it, where only locals and constants come
// before it in the call.

import { mapKids, type CoreIR, type LType, type SExpr, type SFunc } from "./scalar.ts";
import { pureFuncs } from "./share-calls.ts";

const AT = /^array\.at\.a\d+$/;
// Whether g is `attempt array.at(p0, p1) else p2`.
function itemAt(g: SFunc): boolean {
  const b = g.body;
  if (g.params.length !== 3 || g.inner || g.multi || g.piece || g.spends || g.budgeted || b.k !== "attempt" || b.spent || b.resumes) return false;
  const r = b.body;
  return r.k === "rt" && !r.host && AT.test(r.fn) && r.args.length === 2 && r.args.every((a, j) => a.k === "local" && a.i === j)
    && b.ok.k === "local" && b.ok.i === b.res && b.otherwise.k === "local" && b.otherwise.i === 2;
}

export function itemReads(ir: CoreIR, only?: number[]): number {
  const targets = new Set(ir.funcs.flatMap((g, i) => (itemAt(g) ? [i] : [])));
  if (!targets.size) return 0;
  const pure = pureFuncs(ir);
  const lazy = (e: SExpr): boolean => e.k === "local" || e.k === "int" || e.k === "num" || e.k === "bool" || e.k === "text"
    || (e.k === "call" && !e.cps && pure.has(e.fn) && e.args.every(lazy));
  let n = 0;
  for (const fi of only ?? ir.funcs.map((_, i) => i)) {
    const f = ir.funcs[fi];
    if (targets.has(fi)) continue;
    const reads = new WeakSet<SExpr>();
    const put = (e: SExpr): SExpr => {
      const r = hoisted(mapKids(e, put));
      if (r.k !== "call" || r.cps || !targets.has(r.fn)) return r;
      const g = ir.funcs[r.fn], at = g.body as Extract<SExpr, { k: "attempt" }>;
      const lets: { i: number; value: SExpr }[] = [];
      const named = (x: SExpr, j: number): SExpr => {
        if (x.k === "local") return x;
        const i = f.locals.push(g.params[j]) - 1;
        lets.push({ i, value: x });
        return { k: "local", i };
      };
      const a = named(r.args[0], 0), k = named(r.args[1], 1);
      const d = lazy(r.args[2]) ? r.args[2] : named(r.args[2], 2);
      const res = f.locals.push(g.locals[at.res]) - 1;
      n++;
      const body: SExpr = { k: "attempt", body: { ...(at.body as Extract<SExpr, { k: "rt" }>), args: [a, k] }, res, ok: { k: "local", i: res }, otherwise: d, t: at.t };
      const read = lets.reduceRight<SExpr>((b, l) => ({ k: "let", i: l.i, value: l.value, body: b }), body);
      reads.add(read);
      return read;
    };
    // A read given to a call, with only locals and constants before it,
    // let to a local first, so that c.ts sees what reads it.
    const plain = (x: SExpr) => x.k === "local" || x.k === "int" || x.k === "num" || x.k === "bool" || x.k === "text";
    const hoisted = (e: SExpr): SExpr => {
      if (e.k !== "call" || e.cps) return e;
      const k = e.args.findIndex((x) => reads.has(x));
      if (k < 0 || !e.args.slice(0, k).every(plain)) return e;
      const i = f.locals.push(typeOf(e.args[k])) - 1;
      return { k: "let", i, value: e.args[k], body: { ...e, args: e.args.map((x, j) => (j === k ? { k: "local", i } : x)) } };
    };
    const typeOf = (x: SExpr): LType => { let y = x; while (y.k === "let") y = y.body; return (y as Extract<SExpr, { k: "attempt" }>).t; };
    f.body = put(f.body);
  }
  return n;
}

