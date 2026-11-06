// A relation used in one direction, written as the scalar profile's code
// (C195a), so WebAssembly and C run it as JavaScript does: the solver's
// plan with one way to an answer (relation.ts oncePlan) as lets, checks
// and the answer rounded as the solver rounds it. JavaScript prints the
// same plan as text (relation.ts compileSolve); this is that text's
// meaning in SExpr.

import type { Expr, Step } from "./relation.ts";
import type { LType, SExpr } from "./scalar.ts";

export class NotWritten extends Error {}

const num = (v: number): SExpr => ({ k: "num", v });
const op = (o: string, ...args: SExpr[]): SExpr => ({ k: "op", op: o as never, args });
const iff = (cond: SExpr, then: SExpr, otherwise: SExpr, t: LType): SExpr => ({ k: "if", cond, then, else: otherwise, t });
const let_ = (i: number, value: SExpr, body: SExpr): SExpr => ({ k: "let", i, value, body });
const local = (i: number): SExpr => ({ k: "local", i });
const and = (a: SExpr, b: SExpr) => op("and", a, b);
const atMost = (a: SExpr, b: SExpr) => op("not", op("less", b, a));
// $ok: finite (x − x is 0 only then).
export const finite = (x: SExpr) => op("equal", op("sub", x, x), num(0));
// $close: the solver's tolerance for a check.
const close = (l: SExpr, r: SExpr) => and(finite(l), and(finite(r), atMost(op("abs", op("sub", l, r)), op("mul", num(1e-9), op("add", num(1), op("add", op("abs", l), op("abs", r)))))));

const INFIX: Record<string, string> = { add: "add", sub: "sub", mul: "mul", div: "div", pow: "pow", atan2: "atan2" };
const UNARY = new Set(["sqrt", "abs", "sin", "cos", "tan", "exp", "log", "neg"]);

// The plan's steps as an expression: `vars` gives each of the relation's
// variables its local (fresh ones for those the steps find), `done` the
// expression once every step has its values, `fail` where a way gives no
// answer.
export function writtenSteps(steps: Step[], local0: (name: string) => number, done: () => SExpr, fail: () => SExpr, t: LType): SExpr {
  const ex = (e: Expr): SExpr => {
    if (e.k === "num") return num(e.v!);
    if (e.k === "var") return local(local0(e.name!));
    const a = e.args!.map(ex);
    if (INFIX[e.f!] && a.length === 2) return op(INFIX[e.f!], a[0], a[1]);
    if (UNARY.has(e.f!) && a.length === 1) return op(e.f!, a[0]);
    throw new NotWritten(`the solver's ${e.f}`);
  };
  const gen = (i: number): SExpr => {
    if (i === steps.length) return done();
    const s = steps[i];
    if (s.type === "check") return iff(close(ex(s.eq.lhs), ex(s.eq.rhs)), gen(i + 1), fail(), t);
    if (s.type === "linear") {
      // Each x's expression reads only what is known before the block.
      const values = s.xs.map((x) => ex(s.exprs[x]));
      const is = s.xs.map((x) => local0(x));
      const ok = is.map((j) => finite(local(j))).reduce((a, b) => and(a, b));
      return is.reduceRight<SExpr>((body, j, k) => let_(j, values[k], body), iff(ok, gen(i + 1), fail(), t));
    }
    if (s.type !== "solve" || s.branches.length !== 1) throw new NotWritten("a plan with more than one way");
    const b = s.branches[0], j = local0(s.x);
    const ok = b.guards.reduce<SExpr>((acc, g) => and(acc, atMost(num(-1e-9), ex(g))), finite(local(j)));
    return let_(j, ex(b.expr), iff(ok, gen(i + 1), fail(), t));
  };
  return gen(0);
}

// $clean, the solver's +x.toPrecision(12) (0 under 1e-12), as arithmetic:
// |x| between 10^e and 10^(e+1) is scaled by 10^(11−e) to a whole number
// of 12 digits, rounded half up from the product's exact value (Dekker's
// product, or the quotient's exact remainder), then scaled back by one
// correctly rounded operation, which is what reading the 12 digits back
// gives. Outside 1e-11 to 1e34 the number is left as it is (the 10^k
// used aren't exact there).
export function cleanBody(fresh: () => number): SExpr {
  const x = 0;
  const a = fresh();
  const SPLIT = 134217729;
  const splitC = (v: number) => { const c = SPLIT * v, hi = c - (c - v); return [hi, v - hi]; };
  const split = (v: SExpr, then: (hi: number, lo: number) => SExpr): SExpr => {
    const c = fresh(), hi = fresh(), lo = fresh();
    return let_(c, op("mul", num(SPLIT), v), let_(hi, op("sub", local(c), op("sub", local(c), v)), let_(lo, op("sub", v, local(hi)), then(hi, lo))));
  };
  // The error of p = u × P, P a constant: ((uh·Ph − p) + uh·Pl + ul·Ph) + ul·Pl.
  const productError = (u: SExpr, p: number, P: number, then: (err: number) => SExpr): SExpr => {
    const [Ph, Pl] = splitC(P);
    const err = fresh();
    return split(u, (uh, ul) => let_(err, op("add", op("add", op("add", op("sub", op("mul", local(uh), num(Ph)), local(p)), op("mul", local(uh), num(Pl))), op("mul", local(ul), num(Ph))), op("mul", local(ul), num(Pl))), then(err)));
  };
  // t, and the sign of its exact value less t, to a whole number, half up.
  const rounded = (t: number, below: SExpr /* true value − t ≥ 0 */, then: (n: number) => SExpr): SExpr => {
    const n0 = fresh(), fr = fresh(), n = fresh();
    return let_(n0, op("floor", local(t)), let_(fr, op("sub", local(t), local(n0)),
      let_(n, iff(op("less", num(0.5), local(fr)), op("add", local(n0), num(1)),
        iff(op("less", local(fr), num(0.5)), local(n0), iff(below, op("add", local(n0), num(1)), local(n0), "f64"), "f64"), "f64"), then(n))));
  };
  const at = (e: number): SExpr => {
    const k = 11 - e;
    if (k >= 0) {
      const P = 10 ** k, p = fresh();
      return let_(p, op("mul", local(a), num(P)), productError(local(a), p, P, (err) => rounded(p, atMost(num(0), local(err)), (n) => op("div", local(n), num(P)))));
    }
    const D = 10 ** -k, q = fresh(), pp = fresh(), r = fresh();
    return let_(q, op("div", local(a), num(D)), let_(pp, op("mul", local(q), num(D)), productError(local(q), pp, D, (pe) =>
      let_(r, op("sub", op("sub", local(a), local(pp)), local(pe)), rounded(q, atMost(num(0), local(r)), (n) => op("mul", local(n), num(D)))))));
  };
  // The decade by comparisons: e from −11 to 33.
  let chain: SExpr = local(a);
  for (let e = 33; e >= -11; e--) chain = iff(op("less", local(a), num(Number(`1e${e + 1}`))), at(e), chain, "f64");
  const m = fresh();
  return let_(a, op("abs", local(x)),
    iff(op("less", local(a), num(1e-12)), num(0),
      iff(op("less", local(a), num(1e-11)), local(x),
        let_(m, chain, iff(op("less", local(x), num(0)), op("neg", local(m)), local(m), "f64")), "f64"), "f64"));
}
