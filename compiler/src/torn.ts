// A torn plan's search, written as the scalar profile's code (C195), so
// WebAssembly and C find the roots JavaScript's solver finds: relation.js
// tearRoots for a tear with one unknown and nothing solved inside it
// (`fall`'s quadratic in time). The residual is scanned on the solver's
// grid (1600 steps, sinh-spaced over ±1000), each sign change bisected,
// each dip of |residual| narrowed by golden section, and a root kept where
// its residual is about 0 and no kept root is that close; the roots go
// closest to 0 first, and the first eight are the answers. A residual
// that is 0 everywhere leaves the unknown free, which the solver reports
// and this code doesn't yet: it stops there with that said.
//
// The functions take the residual's known variables first, as Float64s,
// and give a list of Float64s (`lf`, whose case `cons` holds an item and
// the rest); loops are tail calls.

import type { Expr } from "./relation.ts";
import type { DType, LType, SExpr, SFunc } from "./scalar.ts";

export interface Tear { tear: string; xs: string[]; residual: { lhs: Expr; rhs: Expr }; inner: unknown[] }

const num = (v: number): SExpr => ({ k: "num", v });
const local = (i: number): SExpr => ({ k: "local", i });
const op = (o: string, ...args: SExpr[]): SExpr => ({ k: "op", op: o as never, args });
const iff = (cond: SExpr, then: SExpr, otherwise: SExpr, t: LType): SExpr => ({ k: "if", cond, then, else: otherwise, t });
const let_ = (i: number, value: SExpr, body: SExpr): SExpr => ({ k: "let", i, value, body });
const and = (a: SExpr, b: SExpr) => op("and", a, b);
const atMost = (a: SExpr, b: SExpr) => op("or", op("less", a, b), op("equal", a, b));
const finite = (x: SExpr) => op("equal", op("sub", x, x), num(0));
const abs = (x: SExpr) => op("abs", x);
const yes = (x: SExpr) => op("equal", x, num(1));
const nan = op("div", num(0), num(0));

const N = 1600, MAX_ROOTS = 8, UMAX = Math.asinh(1000), GOLD = 0.6180339887498949;

// The function giving the tear's roots, given its known variables (`ks`,
// in that order) as its inputs; `ex` writes a solver expression with each
// variable at the local `at` gives; `add` adds a function, giving its number.
export function tornRoots(s: Tear, ks: string[], lf: DType, ex: (e: Expr, at: (name: string) => number) => SExpr, add: (f: SFunc) => number, why: (x: string) => string): number {
  const cons = lf.cases.findIndex((c) => c.fields.length === 2), nil = 1 - cons;
  const K = ks.length;
  const fn = (name: string, params: LType[], result: LType): { g: SFunc; i: number } => {
    const g: SFunc = { def: "", name: `${s.tear} searched for: ${name}`, params, result, locals: [...params], body: num(0), spends: false, budgeted: false, inner: true };
    return { g, i: add(g) };
  };
  const kp = ks.map(() => "f64" as LType);
  const fresh = (g: SFunc, t: LType = "f64") => g.locals.push(t) - 1;
  const call = (i: number, args: SExpr[], tail = false): SExpr => ({ k: "call", fn: i, args, tail });
  const knowns = Array.from({ length: K }, (_, i) => local(i));
  const empty: SExpr = { k: "new", t: lf, c: nil, args: [] };
  const consOf = (h: SExpr, t: SExpr): SExpr => ({ k: "new", t: lf, c: cons, args: [h, t] });
  const caseOf = (g: SFunc, l: SExpr, none: SExpr, some: (h: SExpr, t: SExpr) => SExpr, result: LType): SExpr => {
    const v = fresh(g, lf);
    const arms: SExpr[] = [];
    arms[nil] = none;
    arms[cons] = some({ k: "field", rec: local(v), t: lf, c: cons, i: 0 }, { k: "field", rec: local(v), t: lf, c: cons, i: 1 });
    return { k: "case", scrut: l, s: v, t: lf, arms, result };
  };

  // residual(ks, x) and scale(ks, x): lhs − rhs, and 1 + |lhs| + |rhs|.
  const sides = (g: SFunc, then: (l: SExpr, r: SExpr) => SExpr): SExpr => {
    const at = (n: string) => { const i = n === s.tear ? K : ks.indexOf(n); if (i < 0) throw new Error(why(n)); return i; };
    const l = fresh(g), r = fresh(g);
    return let_(l, ex(s.residual.lhs, at), let_(r, ex(s.residual.rhs, at), then(local(l), local(r))));
  };
  const R = fn("residual", [...kp, "f64"], "f64");
  R.g.body = sides(R.g, (l, r) => op("sub", l, r));
  const S = fn("scale", [...kp, "f64"], "f64");
  S.g.body = sides(S.g, (l, r) => op("add", num(1), op("add", abs(l), abs(r))));
  const res = (x: SExpr) => call(R.i, [...knowns, x]);
  const scale = (x: SExpr) => call(S.i, [...knowns, x]);

  // near(x, l): 1 where a root in l is within 1e-7·(1 + |x|) of x.
  const near = fn("near", ["f64", lf], "f64");
  near.g.body = caseOf(near.g, local(1), num(0), (h, t) =>
    iff(atMost(abs(op("sub", h, local(0))), op("mul", num(1e-7), op("add", num(1), abs(local(0))))), num(1), call(near.i, [local(0), t], true), "f64"), "f64");
  // ins(x, l): x put in l, which is closest to 0 first, after those as close.
  const ins = fn("insert", ["f64", lf], lf);
  ins.g.body = caseOf(ins.g, local(1), consOf(local(0), empty), (h, t) =>
    iff(op("less", abs(local(0)), abs(h)), consOf(local(0), local(1)), consOf(h, call(ins.i, [local(0), t])), lf), lf);
  // take(l, k): l's first k.
  const take = fn("first ones", [lf, "f64"], lf);
  take.g.body = caseOf(take.g, local(0), empty, (h, t) =>
    iff(op("equal", local(1), num(0)), empty, consOf(h, call(take.i, [t, op("sub", local(1), num(1))])), lf), lf);

  // accept(ks, x, l): l with x, where x's residual is about 0 and no root
  // in l is that close.
  const acc = fn("accept", [...kp, "f64", lf], lf);
  {
    const x = local(K), l = local(K + 1), r = fresh(acc.g);
    acc.g.body = let_(r, res(x), iff(and(finite(local(r)), and(atMost(abs(local(r)), op("mul", num(1e-7), scale(x))), op("equal", call(near.i, [x, l]), num(0)))),
      call(ins.i, [x, l]), l, lf));
  }
  const accept = (x: SExpr, l: SExpr) => call(acc.i, [...knowns, x, l]);

  // bisect(ks, a, b, fa, it): a sign change between a and b narrowed.
  const bis = fn("bisect", [...kp, "f64", "f64", "f64", "f64"], "f64");
  {
    const a = local(K), b = local(K + 1), fa = local(K + 2), it = local(K + 3);
    const m = fresh(bis.g), fm = fresh(bis.g), a2 = fresh(bis.g), b2 = fresh(bis.g), fa2 = fresh(bis.g);
    const mid = op("div", op("add", a, b), num(2));
    const left = op("less", op("mul", fa, local(fm)), num(0));
    const narrowed = iff(atMost(abs(op("sub", local(b2), local(a2))), op("mul", num(1e-15), op("add", num(1), abs(local(a2))))),
      op("div", op("add", local(a2), local(b2)), num(2)),
      call(bis.i, [...knowns, local(a2), local(b2), local(fa2), op("add", it, num(1))], true), "f64");
    const halved = let_(a2, iff(left, a, local(m), "f64"), let_(b2, iff(left, local(m), b, "f64"), let_(fa2, iff(left, fa, local(fm), "f64"), narrowed)));
    const tried = iff(op("not", finite(local(fm))), mid, iff(op("equal", local(fm), num(0)), local(m), halved, "f64"), "f64");
    bis.g.body = iff(op("or", op("not", op("less", it, num(200))), op("equal", a, b)), mid, let_(m, mid, let_(fm, res(local(m)), tried)), "f64");
  }
  // golden(ks, a, b, it): where |residual| is least between a and b.
  const gold = fn("golden section", [...kp, "f64", "f64", "f64"], "f64");
  {
    const a = local(K), b = local(K + 1), it = local(K + 2);
    const c = fresh(gold.g), d = fresh(gold.g), keep = fresh(gold.g, "i32");
    gold.g.body = iff(and(op("less", it, num(200)), op("less", num(1e-300), op("sub", b, a))),
      let_(c, op("sub", b, op("mul", num(GOLD), op("sub", b, a))), let_(d, op("add", a, op("mul", num(GOLD), op("sub", b, a))),
        let_(keep, atMost(abs(res(local(c))), abs(res(local(d)))),
          call(gold.i, [...knowns, iff(local(keep), a, local(c), "f64"), iff(local(keep), local(d), b, "f64"), op("add", it, num(1))], true)))),
      op("div", op("add", a, b), num(2)), "f64");
  }

  // The grid's nth point: sinh(−umax + 2·umax·n/N).
  const grid = (g: SFunc, n: SExpr): SExpr => {
    const u = fresh(g);
    return let_(u, op("add", num(-UMAX), op("div", op("mul", num(2 * UMAX), n), num(N))),
      op("div", op("sub", op("exp", local(u)), op("exp", op("neg", local(u)))), num(2)));
  };

  // scan(ks, n, xp, x0, fp, f0, l, finites, zero): the grid from point n,
  // whose value is x0 and residual f0 (xp and fp the point before), the
  // roots so far in l, finites the residuals finite so far and zero 1
  // while every one is about 0.
  const scan = fn("scan", [...kp, "f64", "f64", "f64", "f64", "f64", lf, "f64", "f64"], lf);
  {
    const g = scan.g;
    const n = local(K), xp = local(K + 1), x0 = local(K + 2), fp = local(K + 3), f0 = local(K + 4), l = local(K + 5), fin = local(K + 6), zero = local(K + 7);
    const fin2 = fresh(g), zero2 = fresh(g), x1 = fresh(g), f1 = fresh(g), l2 = fresh(g, lf);
    const counted = (then: SExpr) => let_(fin2, iff(finite(f0), op("add", fin, num(1)), fin, "f64"),
      let_(zero2, iff(and(finite(f0), op("not", atMost(abs(f0), op("mul", num(1e-12), scale(x0))))), num(0), zero, "f64"), then));
    const free = and(op("less", num(N / 2), local(fin2)), yes(local(zero2)));
    const stop: SExpr = { k: "abort", reason: { k: "text", v: `solving this leaves ${s.tear} free, which this profile can't give yet` } };
    const last = counted(iff(free, stop, call(take.i, [iff(op("equal", f0, num(0)), accept(x0, l), l, lf), num(MAX_ROOTS)]), lf));
    const step = counted(let_(x1, grid(g, op("add", n, num(1))), let_(f1, res(local(x1)),
      let_(l2, iff(op("not", and(finite(f0), finite(local(f1)))), l,
        iff(op("equal", f0, num(0)), accept(x0, l),
          iff(op("less", op("mul", f0, local(f1)), num(0)), accept(call(bis.i, [...knowns, x0, local(x1), f0, num(0)]), l),
            iff(and(finite(fp), and(op("less", abs(f0), abs(fp)), atMost(abs(f0), abs(local(f1))))), accept(call(gold.i, [...knowns, xp, local(x1), num(0)]), l), l, lf), lf), lf), lf),
        call(scan.i, [...knowns, op("add", n, num(1)), x0, local(x1), f0, local(f1), local(l2), local(fin2), local(zero2)], true)))));
    g.body = iff(op("equal", n, num(N)), last, step, lf);
  }

  // roots(ks): the scan from point 0, with no point before it.
  const roots = fn("roots", kp, lf);
  {
    const x = fresh(roots.g);
    roots.g.body = let_(x, grid(roots.g, num(0)),
      call(scan.i, [...knowns, num(0), nan, local(x), nan, res(local(x)), empty, num(0), num(1)], true));
  }
  return roots.i;
}
