// Linear elimination over exact rationals.
//
// This is what makes the inverse of (c = a + b, d = a − b) fall out. Undoing
// + and − one at a time is not enough, because every equation has two
// unknowns. But + and − are linear, so the system can be written as a matrix
// and eliminated: the "extra" knowledge needed is just that terms in the same
// unknown can be collected (a ring law), which Gaussian elimination encodes.

import { num, add, sub, mul, div, neg, show, vars } from './expr.js';

// ---- exact fractions -------------------------------------------------------

const gcd = (a, b) => (b ? gcd(b, a % b) : Math.abs(a));
export const frac = (n, d = 1) => {
  if (d < 0) { n = -n; d = -d; }
  const g = gcd(n, d) || 1;
  return { n: n / g, d: d / g };
};
const F0 = frac(0);
const fadd = (x, y) => frac(x.n * y.d + y.n * x.d, x.d * y.d);
const fmul = (x, y) => frac(x.n * y.n, x.d * y.d);
const fdiv = (x, y) => frac(x.n * y.d, x.d * y.n);
const fneg = (x) => frac(-x.n, x.d);
const fzero = (x) => x.n === 0;

function fracFromNumber(x) {
  for (let d = 1; d <= 10000; d++) {
    const n = Math.round(x * d);
    if (Math.abs(n - x * d) < 1e-9 * d) return frac(n, d);
  }
  return null;
}

// ---- linear combinations ---------------------------------------------------
// { terms: Map<key, { atom, c }>, c0 } meaning c0 + Σ c·atom.
// An atom is either an unknown variable or any sub-expression that contains
// no unknowns (it is treated as an opaque known quantity).

const lc = (terms = new Map(), c0 = F0) => ({ terms, c0 });
const atomLc = (atom) => lc(new Map([[show(atom), { atom, c: frac(1) }]]));

function lcAdd(x, y, s = frac(1)) {
  const terms = new Map(x.terms);
  for (const [k, t] of y.terms) {
    const c = fadd(terms.get(k)?.c ?? F0, fmul(s, t.c));
    if (fzero(c)) terms.delete(k);
    else terms.set(k, { atom: t.atom, c });
  }
  return lc(terms, fadd(x.c0, fmul(s, y.c0)));
}
const lcScale = (x, s) => lcAdd(lc(), x, s);
const isConst = (x) => x.terms.size === 0;

function mentions(e, U) {
  for (const n of vars(e)) if (U.has(n)) return true;
  return false;
}

// Returns a linear combination of `e` in which every unknown in U appears
// only with a constant rational coefficient, or null if `e` is not linear in U.
export function linearize(e, U) {
  if (!mentions(e, U)) {
    if (e.k === 'num' && !e.name) {
      const f = fracFromNumber(e.v);
      if (f) return lc(new Map(), f);
    }
    return atomLc(e);
  }
  if (e.k === 'var') return atomLc(e);
  const [a, b] = e.args;
  switch (e.f) {
    case 'add': { const x = linearize(a, U), y = linearize(b, U); return x && y && lcAdd(x, y); }
    case 'sub': { const x = linearize(a, U), y = linearize(b, U); return x && y && lcAdd(x, y, frac(-1)); }
    case 'neg': { const x = linearize(a, U); return x && lcScale(x, frac(-1)); }
    case 'mul': {
      const x = linearize(a, U), y = linearize(b, U);
      if (!x || !y) return null;
      if (isConst(x)) return lcScale(y, x.c0);
      if (isConst(y)) return lcScale(x, y.c0);
      return null;
    }
    case 'div': {
      const x = linearize(a, U), y = linearize(b, U);
      if (!x || !y || !isConst(y) || fzero(y.c0)) return null;
      return lcScale(x, fdiv(frac(1), y.c0));
    }
  }
  return null;
}

// Turn a combination of known atoms back into a readable expression,
// putting everything over a common denominator: (c + d) / 2.
export function lcToExpr(x) {
  const parts = [...x.terms.values()];
  if (!fzero(x.c0)) parts.push({ atom: null, c: x.c0 });
  if (!parts.length) return num(0);
  parts.sort((p, q) => (q.c.n > 0) - (p.c.n > 0)); // lead with a positive term
  const D = parts.reduce((l, p) => (l * p.c.d) / gcd(l, p.c.d), 1);
  let out = null;
  for (const { atom, c } of parts) {
    const n = (c.n * D) / c.d;
    const mag = Math.abs(n);
    const term = atom === null ? num(mag) : mag === 1 ? atom : mul(num(mag), atom);
    if (out === null) out = n < 0 ? neg(term) : term;
    else out = n < 0 ? sub(out, term) : add(out, term);
  }
  return D === 1 ? out : div(out, num(D));
}

// Solve a square block of equations for the unknowns `us` by Gaussian
// elimination. Each equation is { lhs, rhs }. Returns { [u]: expr } or null
// if the block is nonlinear in `us` or singular.
export function solveLinear(eqs, us) {
  const U = new Set(us);
  const rows = [];
  for (const { lhs, rhs } of eqs) {
    const r = linearize(sub(lhs, rhs), U);
    if (!r) return null;
    const coeffs = us.map((u) => r.terms.get(u)?.c ?? F0);
    // move the known part to the right-hand side
    let known = lc(new Map(), r.c0);
    for (const [k, t] of r.terms) if (!U.has(k)) known = lcAdd(known, lc(new Map([[k, t]])));
    rows.push({ coeffs, rhs: lcScale(known, frac(-1)) });
  }
  const n = us.length;
  for (let col = 0; col < n; col++) {
    const p = rows.findIndex((r, i) => i >= col && !fzero(r.coeffs[col]));
    if (p < 0) return null;
    [rows[col], rows[p]] = [rows[p], rows[col]];
    const piv = rows[col];
    const inv = fdiv(frac(1), piv.coeffs[col]);
    piv.coeffs = piv.coeffs.map((c) => fmul(c, inv));
    piv.rhs = lcScale(piv.rhs, inv);
    rows.forEach((r, i) => {
      if (i === col || fzero(r.coeffs[col])) return;
      const f = fneg(r.coeffs[col]);
      r.coeffs = r.coeffs.map((c, j) => fadd(c, fmul(f, piv.coeffs[j])));
      r.rhs = lcAdd(r.rhs, piv.rhs, f);
    });
  }
  return Object.fromEntries(us.map((u, i) => [u, lcToExpr(rows[i].rhs)]));
}
