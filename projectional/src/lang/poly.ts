// Polynomials with Int coefficients: what an algebraic number is held by
// (EXACT-REALS.md, BACKLOG L88 step 1). √2 is the root of x² − 2 between 1
// and 2, and arithmetic on such numbers is arithmetic on their polynomials:
// α + β is a root of Res_y(p(y), q(x − y)), α · β of Res_y(p(y), yⁿ q(x/y)).
//
// A polynomial is its coefficients as BigInts, constant first, with no
// zero at the top (the zero polynomial is []). Everything is exact. The
// algorithms are the textbook ones (Cohen, "A Course in Computational
// Algebraic Number Theory", 1993, §3.1-3.3): pseudo-remainders, the
// primitive remainder sequence for the gcd, Sturm's theorem (1829) to
// count real roots, and Bareiss's fraction-free elimination (1968) for the
// determinant of a Sylvester matrix.

export type Poly = bigint[];
export type Q = [bigint, bigint]; // a fraction n/d, d > 0

const abs = (a: bigint) => (a < 0n ? -a : a);
const gcdInt = (a: bigint, b: bigint): bigint => { a = abs(a); b = abs(b); while (b) [a, b] = [b, a % b]; return a; };

export function trim(p: Poly): Poly {
  let n = p.length;
  while (n && p[n - 1] === 0n) n--;
  return n === p.length ? p : p.slice(0, n);
}
export const poly = (...cs: (number | bigint)[]): Poly => trim(cs.map(BigInt));
export const degree = (p: Poly) => p.length - 1;
export const lead = (p: Poly) => p[p.length - 1];
export const isZero = (p: Poly) => p.length === 0;

export function add(a: Poly, b: Poly): Poly {
  const out = Array.from({ length: Math.max(a.length, b.length) }, (_, i) => (a[i] ?? 0n) + (b[i] ?? 0n));
  return trim(out);
}
export const scale = (a: Poly, c: bigint): Poly => trim(a.map((x) => x * c));
export const neg = (a: Poly): Poly => a.map((x) => -x);
export const sub = (a: Poly, b: Poly): Poly => add(a, neg(b));
export function mul(a: Poly, b: Poly): Poly {
  if (isZero(a) || isZero(b)) return [];
  const out: bigint[] = Array(a.length + b.length - 1).fill(0n);
  a.forEach((x, i) => { if (x) b.forEach((y, j) => { out[i + j] += x * y; }); });
  return trim(out);
}
export const derivative = (p: Poly): Poly => trim(p.slice(1).map((c, i) => c * BigInt(i + 1)));

// The gcd of the coefficients, and the polynomial divided by it with its
// top coefficient made positive.
export const content = (p: Poly): bigint => p.reduce(gcdInt, 0n);
export function primitive(p: Poly): Poly {
  if (isZero(p)) return p;
  const c = content(p) * (lead(p) < 0n ? -1n : 1n);
  return p.map((x) => x / c);
}

// a = b · quotient exactly, over the integers; throws if it doesn't divide.
export function divExact(a: Poly, b: Poly): Poly {
  if (isZero(b)) throw new Error("division by the zero polynomial");
  const r = [...a], q: bigint[] = Array(Math.max(0, a.length - b.length + 1)).fill(0n);
  for (let i = r.length - b.length; i >= 0; i--) {
    const top = r[i + b.length - 1];
    if (top % lead(b) !== 0n) throw new Error("not an exact division");
    const c = top / lead(b);
    q[i] = c;
    if (c) b.forEach((x, j) => { r[i + j] -= c * x; });
  }
  if (!isZero(trim(r))) throw new Error("not an exact division");
  return trim(q);
}

// lc(b)^(deg a − deg b + 1) · a = q · b + r: the remainder with no
// fractions. The sign is kept: the factor is made positive.
export function pseudoRemainder(a: Poly, b: Poly): Poly {
  let r = [...a];
  const lb = lead(b), db = degree(b);
  let steps = 0;
  while (!isZero(r) && degree(r) >= db) {
    const lr = lead(r), shift = degree(r) - db;
    const next = r.map((x) => x * lb);
    b.forEach((x, j) => { next[shift + j] -= lr * x; });
    r = trim(next);
    steps++;
  }
  const spare = degree(a) - db + 1 - steps;
  if (spare > 0) r = scale(r, lb ** BigInt(spare));
  // lc(b) to an odd power flips the sign when it is negative.
  return lb < 0n && (degree(a) - db + 1) % 2 === 1 ? neg(r) : r;
}

export function gcd(a: Poly, b: Poly): Poly {
  a = primitive(a); b = primitive(b);
  if (isZero(a)) return b;
  while (!isZero(b)) [a, b] = [b, primitive(pseudoRemainder(a, b))];
  return a;
}

// The same roots, each once: p / gcd(p, p′).
export function squareFree(p: Poly): Poly {
  p = primitive(p);
  const g = gcd(p, derivative(p));
  return degree(g) <= 0 ? p : primitive(divExact(p, g));
}

// The sign of p at a fraction n/d, exactly: dᵈᵉᵍ · p(n/d) is an integer
// with the same sign.
export function signAt(p: Poly, [n, d]: Q): -1 | 0 | 1 {
  let v = 0n;
  for (let i = p.length - 1; i >= 0; i--) v = v * n + p[i] * d ** BigInt(p.length - 1 - i);
  return v > 0n ? 1 : v < 0n ? -1 : 0;
}
// The sign at +∞ or −∞.
const signAtInfinity = (p: Poly, up: boolean): -1 | 0 | 1 =>
  isZero(p) ? 0 : ((lead(p) > 0n) === (up || degree(p) % 2 === 0) ? 1 : -1);

// Sturm's sequence: p, p′, then each the negated remainder of the two
// before. Pseudo-remainders keep it in integers; they only multiply by
// positive numbers, so the signs, which are all the count reads, stay.
export function sturm(p: Poly): Poly[] {
  // Divided by a positive number only: a sign flipped would change the count.
  const smaller = (q: Poly) => { const c = content(q); return c > 1n ? q.map((x) => x / c) : q; };
  const seq = [smaller(p), smaller(derivative(p))];
  while (!isZero(seq[seq.length - 1])) {
    const r = smaller(neg(pseudoRemainder(seq[seq.length - 2], seq[seq.length - 1])));
    if (isZero(r)) break;
    seq.push(r);
  }
  return seq.filter((s) => !isZero(s));
}
const changes = (signs: number[]) => {
  const s = signs.filter((x) => x !== 0);
  let n = 0;
  for (let i = 1; i < s.length; i++) if (s[i] !== s[i - 1]) n++;
  return n;
};
// How many different real roots p has between lo and hi, neither of them a
// root (Sturm's theorem); null for −∞ or +∞.
export function rootsIn(seq: Poly[], lo: Q | null, hi: Q | null): number {
  const at = (x: Q | null, up: boolean) => seq.map((s) => (x ? signAt(s, x) : signAtInfinity(s, up)));
  return changes(at(lo, false)) - changes(at(hi, true));
}

// Every real root of p, each strictly inside an interval with fraction
// ends that holds it and no other root, in increasing order. Halving from
// Cauchy's bound (every root is smaller than 1 + max |cᵢ / cₙ|); a halving
// point that is itself a root moves a little, so no end is ever a root.
export function isolate(p: Poly): [Q, Q][] {
  p = squareFree(p);
  if (degree(p) < 1) return [];
  const seq = sturm(p);
  let bound = 1n;
  for (const c of p.slice(0, -1)) { const b = abs(c) / abs(lead(p)) + 2n; if (b > bound) bound = b; }
  const out: [Q, Q][] = [];
  const go = (lo: Q, hi: Q) => {
    const k = rootsIn(seq, lo, hi);
    if (k === 0) return;
    if (k === 1) { out.push([lo, hi]); return; }
    let mid = midpoint(lo, hi);
    while (signAt(p, mid) === 0) mid = midpoint(lo, mid);
    go(lo, mid);
    go(mid, hi);
  };
  go([-bound, 1n], [bound, 1n]);
  return out;
}
export const midpoint = ([a, b]: Q, [c, d]: Q): Q => lowest(a * d + c * b, 2n * b * d);
export function lowest(n: bigint, d: bigint): Q {
  if (d < 0n) { n = -n; d = -d; }
  const g = gcdInt(n, d) || 1n;
  return [n / g, d / g];
}

// The determinant of a square matrix of polynomials, by Bareiss's
// elimination: every division in it is exact.
function determinant(m: Poly[][]): Poly {
  const n = m.length;
  if (!n) return [1n];
  const a = m.map((r) => [...r]);
  let prev: Poly = [1n], sign = 1n;
  for (let k = 0; k < n - 1; k++) {
    if (isZero(a[k][k])) {
      const i = a.findIndex((r, i) => i > k && !isZero(r[k]));
      if (i < 0) return [];
      [a[k], a[i]] = [a[i], a[k]];
      sign = -sign;
    }
    for (let i = k + 1; i < n; i++) {
      for (let j = k + 1; j < n; j++) a[i][j] = divExact(sub(mul(a[k][k], a[i][j]), mul(a[i][k], a[k][j])), prev);
    }
    prev = a[k][k];
  }
  return scale(a[n - 1][n - 1], sign);
}

// The resultant in y of two polynomials in y whose coefficients are
// polynomials in x: zero exactly where the two share a root in y.
function resultantY(f: Poly[], g: Poly[]): Poly {
  const m = f.length - 1, n = g.length - 1, size = m + n;
  const row = (cs: Poly[], shift: number) => Array.from({ length: size }, (_, j) => cs[cs.length - 1 - (j - shift)] ?? []);
  const rows = [...Array.from({ length: n }, (_, i) => row(f, i)), ...Array.from({ length: m }, (_, i) => row(g, i))];
  return determinant(rows);
}

const binomial = (n: number, k: number): bigint => { let r = 1n; for (let i = 1; i <= k; i++) r = (r * BigInt(n - i + 1)) / BigInt(i); return r; };

// A polynomial whose roots include every α + β, α a root of p and β of q.
export function sumPoly(p: Poly, q: Poly): Poly {
  const f = p.map((c) => (c ? [c] : []));
  // q(x − y) as a polynomial in y: the yʲ coefficient is
  // Σₖ cₖ C(k, j) (−1)ʲ x^(k−j).
  const g = Array.from({ length: q.length }, (_, j) =>
    trim(Array.from({ length: q.length - j }, (_, e) => q[e + j] * binomial(e + j, j) * (j % 2 ? -1n : 1n))));
  return primitive(resultantY(f, g));
}

// A polynomial whose roots include every α · β.
export function productPoly(p: Poly, q: Poly): Poly {
  const f = p.map((c) => (c ? [c] : []));
  // yⁿ q(x/y): the y^(n−k) coefficient is cₖ xᵏ.
  const n = degree(q);
  const g = Array.from({ length: n + 1 }, (_, j) => trim([...Array(n - j).fill(0n), q[n - j]]));
  return primitive(resultantY(f, g));
}

// −α is a root of p(−x); 1/α (α ≠ 0) of xⁿ p(1/x).
export const negatePoly = (p: Poly): Poly => primitive(p.map((c, i) => (i % 2 ? -c : c)));
export const inversePoly = (p: Poly): Poly => primitive(trim([...p].reverse()));
