// Algebraic numbers, exactly (EXACT-REALS.md, BACKLOG L88 step 2): √2 is
// "the root of x² − 2 between 1 and 2". A value is held by its minimal
// polynomial (factor.ts) and which of its real roots it is, counting from
// the smallest at 0, so each number has one spelling, the way a fraction
// is kept in lowest terms, and `equal` is equality of the two. The
// isolating interval is worked out from them when it is needed.
//
// An operation computes a polynomial its answer is a root of (poly.ts:
// resultants for + and ·, substitutions for −x, 1/x and √x), narrows its
// inputs until interval arithmetic on them picks out one root of that
// polynomial, and keeps the factor that root belongs to. A result whose
// minimal polynomial has degree 1 is a fraction: √2 · √2 is 2.
//
// Prior art: Loos, "Computing in algebraic extensions" (1982); the same
// representation as Mathematica's Root objects and Sage's AA.

import { degree, isolate, isZero, lowest, midpoint, primitive, productPoly, rootsIn, signAt, sturm, sumPoly, trim, negatePoly, inversePoly, type Poly, type Q } from "./poly.ts";
import { minimalPolynomial } from "./factor.ts";

export interface Algebraic { p: Poly; k: number }

const key = (p: Poly) => p.join(",");
const roots = new Map<string, [Q, Q][]>();
// The isolating intervals of p's real roots, worked out once per polynomial.
function rootsOf(p: Poly): [Q, Q][] {
  let r = roots.get(key(p));
  if (!r) { r = isolate(p); roots.set(key(p), r); if (roots.size > 4096) roots.clear(); }
  return r;
}

const qLess = ([a, b]: Q, [c, d]: Q) => a * d < c * b;
const qAdd = ([a, b]: Q, [c, d]: Q): Q => lowest(a * d + c * b, b * d);
const qMul = ([a, b]: Q, [c, d]: Q): Q => lowest(a * c, b * d);
const qMin = (...xs: Q[]) => xs.reduce((m, x) => (qLess(x, m) ? x : m));
const qMax = (...xs: Q[]) => xs.reduce((m, x) => (qLess(m, x) ? x : m));
const width = ([lo, hi]: [Q, Q]): Q => qAdd(hi, [-lo[0], lo[1]]);

// A fraction n/d.
export function fraction(n: bigint, d: bigint): Algebraic {
  const [a, b] = lowest(n, d);
  return { p: [-a, b], k: 0 };
}
// The fraction it is, when it is one.
export const asFraction = (x: Algebraic): Q | null => (degree(x.p) === 1 ? lowest(-x.p[0], x.p[1]) : null);

// An interval with fraction ends holding x and no other root of its
// polynomial, narrower than 2^-bits; a fraction is its own interval.
export function interval(x: Algebraic, bits = 0): [Q, Q] {
  const f = asFraction(x);
  if (f) return [f, f];
  let [lo, hi] = rootsOf(x.p)[x.k];
  const small: Q = [1n, 1n << BigInt(Math.max(0, bits))];
  const s = signAt(x.p, hi);
  while (!qLess(width([lo, hi]), small)) {
    const mid = midpoint(lo, hi);
    // An irreducible polynomial of degree 2 or more has no fraction roots.
    if (signAt(x.p, mid) === s) hi = mid; else lo = mid;
  }
  return [lo, hi];
}

// The algebraic number that is a root of `p` and lies in every interval
// `enclose(bits)` gives, for bits growing: narrow until the interval holds
// one root of p and neither end is one, then keep the factor it belongs to.
function located(p: Poly, enclose: (bits: number) => [Q, Q]): Algebraic {
  p = primitive(trim(p));
  if (isZero(p)) throw new Error("no polynomial");
  const seq = sturm(p);
  for (let bits = 4; ; bits += 8) {
    const [lo, hi] = enclose(bits);
    if (!qLess(lo, hi)) {
      // A point: the answer is that fraction.
      return fraction(lo[0], lo[1]);
    }
    if (signAt(p, lo) === 0 || signAt(p, hi) === 0) continue;
    if (rootsIn(seq, lo, hi) !== 1) continue;
    const m = minimalPolynomial(p, lo, hi);
    if (degree(m) === 1) return fraction(-m[0], m[1]);
    return { p: m, k: rootsIn(sturm(m), null, lo) };
  }
}

const intervalAdd = ([a, b]: [Q, Q], [c, d]: [Q, Q]): [Q, Q] => [qAdd(a, c), qAdd(b, d)];
function intervalMul([a, b]: [Q, Q], [c, d]: [Q, Q]): [Q, Q] {
  const ps = [qMul(a, c), qMul(a, d), qMul(b, c), qMul(b, d)];
  return [qMin(...ps), qMax(...ps)];
}

export function add(x: Algebraic, y: Algebraic): Algebraic {
  const fx = asFraction(x), fy = asFraction(y);
  if (fx && fy) { const [n, d] = qAdd(fx, fy); return fraction(n, d); }
  return located(sumPoly(x.p, y.p), (bits) => intervalAdd(interval(x, bits), interval(y, bits)));
}
export function negate(x: Algebraic): Algebraic {
  const f = asFraction(x);
  if (f) return fraction(-f[0], f[1]);
  // −x is the root of p(−x) in the mirrored place.
  return { p: negatePoly(x.p), k: rootsOf(x.p).length - 1 - x.k };
}
export const subtract = (x: Algebraic, y: Algebraic) => add(x, negate(y));
export function multiply(x: Algebraic, y: Algebraic): Algebraic {
  const fx = asFraction(x), fy = asFraction(y);
  if (fx && fy) { const [n, d] = qMul(fx, fy); return fraction(n, d); }
  if ((fx && fx[0] === 0n) || (fy && fy[0] === 0n)) return fraction(0n, 1n);
  return located(productPoly(x.p, y.p), (bits) => intervalMul(interval(x, bits), interval(y, bits)));
}
// 1/x, or null for 0.
export function inverse(x: Algebraic): Algebraic | null {
  const f = asFraction(x);
  if (f) return f[0] === 0n ? null : fraction(f[1], f[0]);
  // Not 0, so an interval narrow enough to leave 0 out has a fraction
  // inverse: 1/hi to 1/lo.
  return located(inversePoly(x.p), (bits) => {
    let [lo, hi] = interval(x, bits);
    while (!(qLess([0n, 1n], lo) || qLess(hi, [0n, 1n]))) [lo, hi] = interval(x, bits += 8);
    // Both ends on one side of 0, so 1/x is between 1/hi and 1/lo.
    return [lowest(hi[1], hi[0]), lowest(lo[1], lo[0])];
  });
}
export const divide = (x: Algebraic, y: Algebraic): Algebraic | null => { const i = inverse(y); return i ? multiply(x, i) : null; };

export function compare(x: Algebraic, y: Algebraic): -1 | 0 | 1 {
  if (x.k === y.k && key(x.p) === key(y.p)) return 0;
  // Two different numbers: narrow until their intervals come apart.
  for (let bits = 0; ; bits += 8) {
    const [a, b] = interval(x, bits), [c, d] = interval(y, bits);
    if (qLess(b, c)) return -1;
    if (qLess(d, a)) return 1;
    if (!qLess(a, b) && !qLess(c, d)) return qLess(a, c) ? -1 : 1;
  }
}
export const less = (x: Algebraic, y: Algebraic) => compare(x, y) < 0;

// The k-th root of x, the real one (the positive one for an even k), or
// null when there is none (an even root of a negative number).
export function root(x: Algebraic, k: number): Algebraic | null {
  if (k < 1) return null;
  const sign = compare(x, fraction(0n, 1n));
  if (sign === 0) return x;
  if (sign < 0 && k % 2 === 0) return null;
  // p(xᵏ) has x's k-th roots as roots.
  const p: Poly = [];
  x.p.forEach((c, i) => { p[i * k] = c; });
  const q = trim(Array.from({ length: p.length }, (_, i) => p[i] ?? 0n));
  return located(q, (bits) => {
    const [lo, hi] = interval(x, bits + 4);
    return [rootBound(lo, k, bits, false), rootBound(hi, k, bits, true)];
  });
}
// A fraction below (or, `up`, above) the k-th root of a, within 2^-bits.
function rootBound([n, d]: Q, k: number, bits: number, up: boolean): Q {
  const negative = n < 0n;
  if (negative) { const r = rootBound([-n, d], k, bits, !up); return [-r[0], r[1]]; }
  const scale = 1n << BigInt(bits + 2);
  // floor((n/d)^(1/k) · scale) = floor((n · scale^k / d)^(1/k)).
  const target = (n * scale ** BigInt(k)) / d;
  // One step past it either way, so an exact root (∛8) is never an end.
  const r = nthRoot(target, k) + (up ? 1n : -1n);
  return lowest(r, scale);
}
function nthRoot(a: bigint, k: number): bigint {
  if (a < 2n) return a;
  const K = BigInt(k);
  let x = 1n << BigInt(Math.ceil(a.toString(2).length / k) + 1);
  for (;;) {
    const y = ((K - 1n) * x + a / x ** (K - 1n)) / K;
    if (y >= x) break;
    x = y;
  }
  while (x ** K > a) x -= 1n;
  while ((x + 1n) ** K <= a) x += 1n;
  return x;
}

// The first `n` digits after the point, cut off (not rounded), and the
// sign: digits(√2, 5) is "1.41421".
export function digits(x: Algebraic, n: number): string {
  const scale = 10n ** BigInt(Math.max(0, n));
  const floorQ = ([a, b]: Q) => { const q = a / b; return a < 0n && q * b !== a ? q - 1n : q; };
  let whole: bigint;
  const f = asFraction(x);
  if (f) whole = floorQ([f[0] * scale, f[1]]);
  else for (let bits = 8; ; bits += 8) {
    const [lo, hi] = interval(x, bits);
    const a = floorQ([lo[0] * scale, lo[1]]), b = floorQ([hi[0] * scale, hi[1]]);
    if (a === b) { whole = a; break; }
  }
  const negative = whole < 0n;
  const abs = (negative ? -whole : whole).toString().padStart(n + 1, "0");
  const text = n > 0 ? `${abs.slice(0, abs.length - n)}.${abs.slice(abs.length - n)}` : abs;
  return negative ? `−${text}` : text;
}

// The nearest Float64, near enough: the interval narrowed past a double's
// precision.
export function toNumber(x: Algebraic): number {
  const f = asFraction(x) ?? interval(x, 64)[0];
  const [n, d] = f;
  const shift = BigInt(Math.max(0, d.toString(2).length - 60));
  return Number(n >> shift) / Number(d >> shift);
}

// How it reads: a fraction as one, √n or −√n for those, else ten digits
// and an ellipsis.
export function show(x: Algebraic): string {
  const f = asFraction(x);
  if (f) return f[1] === 1n ? String(f[0]) : `${f[0]}/${f[1]}`;
  if (degree(x.p) === 2 && x.p[1] === 0n && x.p[2] === 1n && x.p[0] < 0n) return `${x.k ? "" : "−"}√${-x.p[0]}`;
  return `${digits(x, 10)}…`;
}
