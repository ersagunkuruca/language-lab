// Real numbers as intervals that narrow on demand (EXACT-REALS.md step 4,
// BACKLOG L88e1). A Real is held by how it was made, a fraction or an
// operation on Reals, and gives on demand an Int m with |x − m/2ᵖ| < 2⁻ᵖ:
// x lies in the interval (m − 1, m + 1)/2ᵖ, as narrow as asked. Each
// operation asks its inputs for just the precision its own answer needs,
// and each answer is kept, so asking again, or narrower, reuses what was
// worked out. π, digits (L88e2) and comparisons (L88e3) build on this.
//
// Prior art: Boehm's constructive reals (Boehm, Cartwright, Riggle and
// O'Donnell, "Exact real arithmetic: a case study in higher order
// programming", 1986; Boehm, "Towards an API for the real numbers", PLDI
// 2020), which Android's calculator uses: the same approximation by a
// scaled integer and the same precision bounds for + and ·.

export type Real =
  | { op: "fraction"; n: bigint; d: bigint; kept: Map<number, bigint> }
  | { op: "pi"; kept: Map<number, bigint> }
  | { op: "add" | "multiply"; parts: [Real, Real]; kept: Map<number, bigint> }
  | { op: "negate" | "exp" | "log" | "sin" | "cos"; parts: [Real]; kept: Map<number, bigint> };

export const fraction = (n: bigint, d: bigint): Real => {
  if (d === 0n) throw new Error("a fraction's bottom can't be 0");
  return d < 0n ? { op: "fraction", n: -n, d: -d, kept: new Map() } : { op: "fraction", n, d, kept: new Map() };
};
// π, worked out as far as asked (L88e2), the same value wherever it's made.
export const pi = (): Real => PI;
const PI: Real = { op: "pi", kept: new Map() };
export const add = (x: Real, y: Real): Real => ({ op: "add", parts: [x, y], kept: new Map() });
export const negate = (x: Real): Real => ({ op: "negate", parts: [x], kept: new Map() });
export const subtract = (x: Real, y: Real): Real => add(x, negate(y));
export const multiply = (x: Real, y: Real): Real => ({ op: "multiply", parts: [x, y], kept: new Map() });
// eˣ and the natural log (L88e4), worked out as far as asked.
export const exp = (x: Real): Real => ({ op: "exp", parts: [x], kept: new Map() });
export const log = (x: Real): Real => ({ op: "log", parts: [x], kept: new Map() });
// sin and cos (L88e5), the same way.
export const sin = (x: Real): Real => ({ op: "sin", parts: [x], kept: new Map() });
export const cos = (x: Real): Real => ({ op: "cos", parts: [x], kept: new Map() });

// n/2ᵏ rounded to the nearest Int, halves away from 0.
function scale(n: bigint, k: number): bigint {
  if (k <= 0) return n << BigInt(-k);
  const half = 1n << BigInt(k - 1), q = (abs(n) + half) >> BigInt(k);
  return n < 0n ? -q : q;
}
const abs = (n: bigint) => (n < 0n ? -n : n);
// The number of bits of |n|.
const bits = (n: bigint): number => abs(n).toString(2).length;

// An Int m with |x − m/2ᵖ| < 2⁻ᵖ.
export function approximate(x: Real, p: number): bigint {
  const was = x.kept.get(p);
  if (was !== undefined) return was;
  let m: bigint;
  switch (x.op) {
    // Rounded: off by at most half of 2⁻ᵖ.
    case "fraction": {
      const t = p >= 0 ? x.n << BigInt(p) : x.n, d = p >= 0 ? x.d : x.d << BigInt(-p);
      const q = t / d, r = t - q * d;
      m = 2n * abs(r) >= d ? q + (t < 0n ? -1n : 1n) : q;
      break;
    }
    case "pi": m = piTo(p); break;
    case "exp": m = expTo(x.parts[0], p); break;
    case "log": m = logTo(x.parts[0], p); break;
    case "sin": m = sinCosTo(x.parts[0], p, 0); break;
    case "cos": m = sinCosTo(x.parts[0], p, 1); break;
    case "negate": m = -approximate(x.parts[0], p); break;
    // Each to 2⁻⁽ᵖ⁺²⁾, off by under 2·2⁻⁽ᵖ⁺²⁾, and the sum rounded to 2⁻ᵖ, off
    // by half of it more: under 2⁻ᵖ in all.
    case "add": m = scale(approximate(x.parts[0], p + 2) + approximate(x.parts[1], p + 2), 2); break;
    // |x| < 2^bits(x₀ + 2), so x to 2⁻⁽ᵖ⁺²⁺ᵇ⁽ʸ⁾⁾ and y to 2⁻⁽ᵖ⁺²⁺ᵇ⁽ˣ⁾⁾ make
    // each term of xy − ab under 2⁻⁽ᵖ⁺²⁾, and the product is rounded to 2⁻ᵖ.
    case "multiply": {
      const [a, b] = x.parts;
      const bx = bits(abs(approximate(a, 0)) + 2n), by = bits(abs(approximate(b, 0)) + 2n);
      const pa = p + 2 + by, pb = p + 2 + bx;
      m = scale(approximate(a, pa) * approximate(b, pb), pa + pb - p);
      break;
    }
  }
  x.kept.set(p, m);
  return m;
}

// π to 2⁻ᵖ by Machin's formula, π = 16·atan(1/5) − 4·atan(1/239) (John
// Machin, 1706), each atan summed as its series in Ints scaled by 2^(p+g):
// every term is cut toward 0, off by under one unit, and the guard bits g
// keep the sum of those cuts below a quarter of 2⁻ᵖ.
function piTo(p: number): bigint {
  if (p < 0) return scale(piTo(0), -p);
  const terms = Math.ceil((p + 4) / 4.6) + 2, g = bits(BigInt(20 * terms)) + 2, one = 1n << BigInt(p + g);
  // atan(1/k) · 2^(p+g): Σ (−1)ⁱ / ((2i + 1) k^(2i+1)).
  const atanInv = (k: bigint): bigint => {
    let sum = 0n, power = one / k, i = 0n;
    const kk = k * k;
    while (power !== 0n) { const t = power / (2n * i + 1n); sum += i % 2n === 0n ? t : -t; power /= kk; i++; }
    return sum;
  };
  return scale(16n * atanInv(5n) - 4n * atanInv(239n), g);
}

// eˣ to 2⁻ᵖ (L88e4). |x| < M, so eˣ and e^(x') for x' within 2⁻ᵠ of x
// differ by under 2^(eb + 2 − q), eb the bits of e^M: x is asked to q =
// p + eb + 4. Then x' halved s times to under ½, its series summed in
// Ints scaled by 2ʷ, and squared back s times; the guard bits in w
// (twice s and eb, and 32 more) keep the cuts of the sums, the squarings'
// doubling of them, and the size of the answer below a quarter of 2⁻ᵖ.
// Prior art: Boehm's constructive reals, which reduce the range the same
// way.
function expTo(x: Real, p: number): bigint {
  const M = Math.abs(Number(approximate(x, 0))) + 1, eb = Math.ceil(M * Math.LOG2E) + 1;
  const q = Math.max(0, p) + eb + 4, xm = approximate(x, q);
  const s = Math.max(0, bits(xm) - q + 1), w = Math.max(0, p) + 2 * s + 2 * eb + 32, one = 1n << BigInt(w);
  const y = scale(xm, q + s - w);
  let sum = one, term = one;
  for (let i = 1n; term !== 0n; i++) { term = (term * y) / (one * i); sum += term; }
  for (let i = 0; i < s; i++) sum = scale(sum * sum, w);
  return scale(sum, w - p);
}
// atanh(z) · 2ʷ for z = zw/2ʷ under ⅓: Σ z^(2i+1)/(2i+1), each term cut.
function atanhW(zw: bigint, w: number): bigint {
  const zz = scale(zw * zw, w);
  let sum = 0n, power = zw;
  for (let i = 1n; power !== 0n; i += 2n) { sum += power / i; power = scale(power * zz, w); }
  return sum;
}
// The natural log of x to 2⁻ᵖ (L88e4), x above 0. x is narrowed until it
// is surely above some 2ᴸ, so a change of 2⁻ᵠ in it, q = p + 4 − L, moves
// the log by under 2⁻⁽ᵖ⁺⁴⁾. Then x' = 2ᵏ·f with f in [1, 2), and log x' =
// k·ln 2 + 2·atanh((f − 1)/(f + 1)), ln 2 being 2·atanh(⅓), in Ints scaled
// by 2ʷ with guard bits for the cuts and for k. Not above 0 (or too close
// to 0 to tell within a few thousand bits): an error.
function logTo(x: Real, p: number): bigint {
  let r = 0, m = approximate(x, 0);
  for (; m < 4n; r = r ? 2 * r : 8, m = approximate(x, r)) {
    if (m <= -2n) throw new Error("the log of a Real below 0");
    if (r > 4096 + Math.max(0, p)) throw new Error("the log of a Real that isn't above 0, or too close to 0 to tell");
  }
  const L = bits(m - 1n) - 1 - r, q = Math.max(0, p) + 4 - L, xm = approximate(x, q);
  const k = bits(xm) - 1, e = k - q;
  const w = Math.max(0, p) + bits(BigInt(Math.abs(e))) + 16, one = 1n << BigInt(w);
  const f = scale(xm, k - w);
  const logF = 2n * atanhW(((f - one) << BigInt(w)) / (f + one), w);
  const ln2 = 2n * atanhW(one / 3n, w);
  return scale(BigInt(e) * ln2 + logF, w - p);
}

// sin x (which 0) or cos x (which 1) to 2⁻ᵖ (L88e5). Both move by at
// most the change in x, so x is asked to q = p + 4. Then, in Ints scaled
// by 2ʷ, x less the nearest multiple k of 2π (π asked to w and k's bits
// more, so k·2π is off by under 2⁻ʷ), and the Taylor series summed at
// |y| ≤ π, each term cut; 32 guard bits cover the cuts and the terms'
// size before they fall (πⁿ/n! is at most 2⁵).
function sinCosTo(x: Real, p: number, which: 0 | 1): bigint {
  const q = Math.max(0, p) + 4, xm = approximate(x, q);
  const kb = Math.max(0, bits(xm) - q) + 2, w = q + kb + 32, one = 1n << BigInt(w);
  let y = xm << BigInt(w - q);
  const twoPi = scale(2n * piTo(w + kb), kb);
  const k = (y < 0n ? -1n : 1n) * ((2n * abs(y) + twoPi) / (2n * twoPi));
  y -= k * twoPi;
  const yy = scale(y * y, w);
  let sum = 0n, term = which === 0 ? y : one;
  for (let i = BigInt(2 - which); term !== 0n; i += 2n) { sum += term; term = -(term * yy) / (one * i * (i + 1n)); }
  return scale(sum, w - p);
}

// x rounded to n decimals, as text, right to within one in the last place:
// whether a Real is just below or just above a decimal (0.4999… or 0.5)
// can't always be told, so its digits are rounded, not cut.
export function digits(x: Real, n: number): string {
  const places = Math.max(0, n), ten = 10n ** BigInt(places);
  const p = Math.ceil(places * 3.33) + 4;
  // m/2ᵖ is within 2⁻ᵖ, under a sixteenth of a unit in the last place.
  const whole = scale(approximate(x, p) * ten, p);
  const negative = whole < 0n;
  const a = abs(whole).toString().padStart(places + 1, "0");
  const text = places > 0 ? `${a.slice(0, a.length - places)}.${a.slice(a.length - places)}` : a;
  return negative ? `−${text}` : text;
}

// Which of x and y is larger (L88e3), narrowing both until their
// intervals come apart: −1 when x < y, 1 when x > y. Two Reals that are
// equal never come apart, and no number of steps can tell them from two
// that differ far down, so it narrows to at most 2⁻ᶠᵘᵉˡ and gives null if
// they are still that close.
export function compare(x: Real, y: Real, fuel: number): -1 | 1 | null {
  const d = subtract(x, y);
  for (let p = 0; ; p = Math.min(fuel, Math.max(8, 2 * p))) {
    // |d − m/2ᵖ| < 2⁻ᵖ, so m ≥ 2 means d > 2⁻ᵖ, and m ≤ −2 means d < −2⁻ᵖ.
    const m = approximate(d, p);
    if (m >= 2n) return 1;
    if (m <= -2n) return -1;
    if (p >= fuel) return null;
  }
}

// The interval x is in at precision p, as fractions (bottom 2ᵖ, or 1).
export function interval(x: Real, p: number): [[bigint, bigint], [bigint, bigint]] {
  const m = approximate(x, p), d = p >= 0 ? 1n << BigInt(p) : 1n, k = p >= 0 ? 1n : 1n << BigInt(-p);
  return [[(m - 1n) * k, d], [(m + 1n) * k, d]];
}
