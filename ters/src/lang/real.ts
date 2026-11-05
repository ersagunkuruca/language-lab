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
  | { op: "add" | "multiply"; parts: [Real, Real]; kept: Map<number, bigint> }
  | { op: "negate"; parts: [Real]; kept: Map<number, bigint> };

export const fraction = (n: bigint, d: bigint): Real => {
  if (d === 0n) throw new Error("a fraction's bottom can't be 0");
  return d < 0n ? { op: "fraction", n: -n, d: -d, kept: new Map() } : { op: "fraction", n, d, kept: new Map() };
};
export const add = (x: Real, y: Real): Real => ({ op: "add", parts: [x, y], kept: new Map() });
export const negate = (x: Real): Real => ({ op: "negate", parts: [x], kept: new Map() });
export const subtract = (x: Real, y: Real): Real => add(x, negate(y));
export const multiply = (x: Real, y: Real): Real => ({ op: "multiply", parts: [x, y], kept: new Map() });

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

// The interval x is in at precision p, as fractions (bottom 2ᵖ, or 1).
export function interval(x: Real, p: number): [[bigint, bigint], [bigint, bigint]] {
  const m = approximate(x, p), d = p >= 0 ? 1n << BigInt(p) : 1n, k = p >= 0 ? 1n : 1n << BigInt(-p);
  return [[(m - 1n) * k, d], [(m + 1n) * k, d]];
}
