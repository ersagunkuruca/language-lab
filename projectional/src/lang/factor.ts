// Factoring polynomials with Int coefficients into irreducible ones, so an
// algebraic number can be held by its minimal polynomial: one spelling for
// each number, as a fraction is in lowest terms (EXACT-REALS.md, BACKLOG
// L88). Without it √2 could be the root of x² − 2 or of (x² − 2)(x² − 3),
// and two equal numbers would look different.
//
// Zassenhaus's method (1969), as in Cohen, "A Course in Computational
// Algebraic Number Theory" (1993) §3.5, and von zur Gathen and Gerhard,
// "Modern Computer Algebra" (2013) §15:
// - Pick a small prime q for which p stays square-free mod q.
// - Factor p mod q: distinct-degree factoring, then Cantor and Zassenhaus's
//   equal-degree split (1981), with a fixed seed so the answer is the same
//   every time.
// - Lift the factors mod q^k with Hensel's lemma, until q^k is past
//   Mignotte's bound on the coefficients of any factor over the integers.
// - Try products of the lifted factors, fewest first: each that divides p
//   over the integers is a factor.

import { degree, divExact, isZero, lead, primitive, signAt, squareFree, trim, type Poly, type Q } from "./poly.ts";

type M = bigint; // a modulus
const md = (a: bigint, m: M) => ((a % m) + m) % m;
const reduce = (p: Poly, m: M): Poly => trim(p.map((c) => md(c, m)));
// Coefficients between −m/2 and m/2: the integer a factor mod m stands for.
const symmetric = (p: Poly, m: M): Poly => trim(p.map((c) => { const r = md(c, m); return r > m / 2n ? r - m : r; }));

function inverse(a: bigint, m: M): bigint {
  let [r0, r1, s0, s1] = [md(a, m), m, 1n, 0n];
  while (r1) { const q = r0 / r1; [r0, r1] = [r1, r0 - q * r1]; [s0, s1] = [s1, s0 - q * s1]; }
  if (r0 !== 1n) throw new Error("not invertible");
  return md(s0, m);
}

const addM = (a: Poly, b: Poly, m: M): Poly => reduce(Array.from({ length: Math.max(a.length, b.length) }, (_, i) => (a[i] ?? 0n) + (b[i] ?? 0n)), m);
const subM = (a: Poly, b: Poly, m: M): Poly => reduce(Array.from({ length: Math.max(a.length, b.length) }, (_, i) => (a[i] ?? 0n) - (b[i] ?? 0n)), m);
function mulM(a: Poly, b: Poly, m: M): Poly {
  if (isZero(a) || isZero(b)) return [];
  const out: bigint[] = Array(a.length + b.length - 1).fill(0n);
  a.forEach((x, i) => { if (x) b.forEach((y, j) => { out[i + j] += x * y; }); });
  return reduce(out, m);
}
// Division with remainder mod m by b, whose top coefficient is invertible.
function divmodM(a: Poly, b: Poly, m: M): [Poly, Poly] {
  const r = reduce(a, m), inv = inverse(lead(b), m);
  const q: bigint[] = Array(Math.max(0, r.length - b.length + 1)).fill(0n);
  for (let i = r.length - b.length; i >= 0; i--) {
    const c = md(r[i + b.length - 1] * inv, m);
    q[i] = c;
    if (c) b.forEach((x, j) => { r[i + j] = md(r[i + j] - c * x, m); });
  }
  return [trim(q), trim(r)];
}
const remM = (a: Poly, b: Poly, m: M) => divmodM(a, b, m)[1];
const monicM = (a: Poly, m: M): Poly => (isZero(a) ? a : reduce(a.map((c) => c * inverse(lead(a), m)), m));
function gcdM(a: Poly, b: Poly, q: M): Poly {
  a = reduce(a, q); b = reduce(b, q);
  while (!isZero(b)) [a, b] = [b, remM(a, b, q)];
  return monicM(a, q);
}
// s·a + t·b = 1 mod a prime q, for a and b with no common factor.
function bezout(a: Poly, b: Poly, q: M): [Poly, Poly] {
  let [r0, r1, s0, s1, t0, t1] = [reduce(a, q), reduce(b, q), [1n] as Poly, [] as Poly, [] as Poly, [1n] as Poly];
  while (!isZero(r1)) {
    const [k, r] = divmodM(r0, r1, q);
    [r0, r1] = [r1, r];
    [s0, s1] = [s1, subM(s0, mulM(k, s1, q), q)];
    [t0, t1] = [t1, subM(t0, mulM(k, t1, q), q)];
  }
  if (degree(r0) !== 0) throw new Error("the factors share a root");
  const inv = inverse(r0[0], q);
  return [reduce(s0.map((c) => c * inv), q), reduce(t0.map((c) => c * inv), q)];
}
function powM(base: Poly, e: bigint, f: Poly, q: M): Poly {
  let out: Poly = [1n], b = remM(base, f, q);
  while (e > 0n) {
    if (e & 1n) out = remM(mulM(out, b, q), f, q);
    b = remM(mulM(b, b, q), f, q);
    e >>= 1n;
  }
  return out;
}

// A small pseudo-random generator with a fixed seed: the split below tries
// random polynomials, and the same input should give the same factors.
function generator(seed: number) {
  let s = seed >>> 0;
  return (below: bigint) => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return BigInt(s) % below; };
}

// The monic irreducible factors of a square-free monic f mod an odd prime q.
function factorModQ(f: Poly, q: M): Poly[] {
  const x: Poly = [0n, 1n];
  const byDegree: [Poly, number][] = [];
  let rest = f, h = x;
  for (let d = 1; 2 * d <= degree(rest); d++) {
    h = powM(h, q, rest, q);
    const g = gcdM(rest, subM(h, x, q), q);
    if (degree(g) > 0) {
      byDegree.push([g, d]);
      rest = divmodM(rest, g, q)[0];
      h = remM(h, rest, q);
    }
  }
  if (degree(rest) > 0) byDegree.push([monicM(rest, q), degree(rest)]);
  const random = generator(0x5eed);
  const out: Poly[] = [];
  const split = (g: Poly, d: number) => {
    if (degree(g) === d) { out.push(g); return; }
    for (;;) {
      const r = trim(Array.from({ length: degree(g) }, () => random(q)));
      if (degree(r) < 1) continue;
      const t = subM(powM(r, (q ** BigInt(d) - 1n) / 2n, g, q), [1n], q);
      const s = gcdM(g, t, q);
      if (degree(s) > 0 && degree(s) < degree(g)) { split(s, d); split(divmodM(g, s, q)[0], d); return; }
    }
  };
  for (const [g, d] of byDegree) split(g, d);
  return out;
}

// From f ≡ g·h mod m, with h monic and a·g + b·h ≡ 1, to the same mod m²
// (von zur Gathen and Gerhard, Algorithm 15.10).
function henselStep(f: Poly, g: Poly, h: Poly, a: Poly, b: Poly, m: M): [Poly, Poly, Poly, Poly] {
  const m2 = m * m;
  let e = subM(f, mulM(g, h, m2), m2);
  let [k, r] = divmodM(mulM(a, e, m2), h, m2);
  const g2 = addM(addM(g, mulM(b, e, m2), m2), mulM(k, g, m2), m2);
  const h2 = addM(h, r, m2);
  e = subM(addM(mulM(a, g2, m2), mulM(b, h2, m2), m2), [1n], m2);
  [k, r] = divmodM(mulM(a, e, m2), h2, m2);
  const a2 = subM(a, r, m2);
  const b2 = subM(subM(b, mulM(b, e, m2), m2), mulM(k, g2, m2), m2);
  return [g2, h2, a2, b2];
}

// The monic factors of f mod q lifted to mod a power of q past `bound`.
function lift(f: Poly, factors: Poly[], q: M, bound: bigint): { lifted: Poly[]; modulus: M } {
  let modulus = q;
  while (modulus <= bound) modulus *= modulus;
  const lifted: Poly[] = [];
  let rest = f;
  for (let i = 0; i < factors.length - 1; i++) {
    // rest ≡ lc · u_i · (the others): lift u_i against the others.
    let h = factors[i];
    let g = reduce(factors.slice(i + 1).reduce((acc, u) => mulM(acc, u, q), [lead(f)] as Poly), q);
    let [a, b] = bezout(g, h, q);
    for (let m = q; m < modulus; m *= m) [g, h, a, b] = henselStep(rest, g, h, a, b, m);
    lifted.push(reduce(h, modulus));
    rest = reduce(g, modulus);
  }
  lifted.push(monicM(rest, modulus));
  return { lifted, modulus };
}

const isqrt = (n: bigint): bigint => { if (n < 2n) return n; let x = n, y = (x + 1n) / 2n; while (y < x) { x = y; y = (x + n / x) / 2n; } return x; };
const PRIMES = [3n, 5n, 7n, 11n, 13n, 17n, 19n, 23n, 29n, 31n, 37n, 41n, 43n, 47n, 53n, 59n, 61n, 67n, 71n, 73n, 79n, 83n, 89n, 97n, 101n, 103n, 107n, 109n, 113n];

// The irreducible factors of a square-free primitive p of degree ≥ 1,
// each primitive with a positive top coefficient.
function factorSquareFree(p: Poly): Poly[] {
  if (degree(p) <= 1) return [p];
  const lc = lead(p);
  const q = PRIMES.find((q) => md(lc, q) !== 0n && degree(gcdM(p, deriveM(p, q), q)) === 0);
  if (q === undefined) throw new Error("no prime keeps it square-free");
  const modFactors = factorModQ(monicM(reduce(p, q), q), q);
  if (modFactors.length === 1) return [p];
  // Mignotte's bound: a factor's coefficients are at most 2ⁿ‖p‖₂, and the
  // top coefficient is put on each candidate.
  const norm = isqrt(p.reduce((s, c) => s + c * c, 0n)) + 1n;
  const bound = 2n * (lc < 0n ? -lc : lc) * (1n << BigInt(degree(p))) * norm;
  const { lifted, modulus } = lift(p, modFactors, q, bound);
  const out: Poly[] = [];
  let rest = p, left = lifted;
  for (let size = 1; 2 * size <= left.length; size++) {
    let found = true;
    while (found) {
      found = false;
      for (const pick of subsets(left.length, size)) {
        const chosen = pick.map((i) => left[i]);
        const candidate = primitive(symmetric(chosen.reduce((acc, u) => mulM(acc, u, modulus), [lead(rest)] as Poly), modulus));
        let quotient: Poly | null = null;
        try { quotient = divExact(rest, candidate); } catch { quotient = null; }
        if (!quotient) continue;
        out.push(candidate);
        rest = primitive(quotient);
        left = left.filter((_, i) => !pick.includes(i));
        found = 2 * size <= left.length;
        break;
      }
    }
  }
  out.push(rest);
  return out;
}
const deriveM = (p: Poly, q: M): Poly => reduce(p.slice(1).map((c, i) => c * BigInt(i + 1)), q);
function* subsets(n: number, k: number, from = 0): Generator<number[]> {
  if (k === 0) { yield []; return; }
  for (let i = from; i <= n - k; i++) for (const rest of subsets(n, k - 1, i + 1)) yield [i, ...rest];
}

// The irreducible factors of p, each once (p's repeated roots are dropped).
export function factor(p: Poly): Poly[] {
  const sf = squareFree(p);
  if (degree(sf) < 1) return [];
  // A root at 0: x is a factor of its own, which keeps the mod q work away
  // from a constant term of 0.
  const out: Poly[] = [];
  let rest = sf;
  if (rest[0] === 0n) { out.push([0n, 1n]); rest = primitive(divExact(rest, [0n, 1n])); }
  if (degree(rest) >= 1) out.push(...factorSquareFree(rest));
  return out.sort((a, b) => degree(a) - degree(b) || cmp(a, b));
}
const cmp = (a: Poly, b: Poly) => { for (let i = a.length - 1; i >= 0; i--) if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1; return 0; };

// The factor of p with the root lying strictly between lo and hi, the only
// root of p there: that root's minimal polynomial. A factor of a
// square-free p has simple roots and holds at most that one there, so it
// is the factor whose sign differs at the two ends.
export function minimalPolynomial(p: Poly, lo: Q, hi: Q): Poly {
  const f = factor(p).find((f) => signAt(f, lo) !== signAt(f, hi));
  if (!f) throw new Error("no factor has a root there");
  return f;
}
