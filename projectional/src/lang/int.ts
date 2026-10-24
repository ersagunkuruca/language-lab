// Int: whole numbers that never overflow (NUMBERS.md, stage 1).
//
// The meaning is the mathematical integers. The representation is a JS
// number while it is a safe integer (|x| < 2^53), and a BigInt beyond, so
// small numbers are as fast as floats and big ones are exact. It is
// canonical: every integer has exactly one spelling (a safe integer is never
// a BigInt), so `===`, `equal` and hashing stay correct.

export type Int = number | bigint;

export const isInt = (x: unknown): x is Int => typeof x === "bigint" || Number.isSafeInteger(x);

// The one spelling of a BigInt.
export const norm = (b: bigint): Int => (b >= -9007199254740991n && b <= 9007199254740991n ? Number(b) : b);
const big = (x: Int) => (typeof x === "bigint" ? x : BigInt(x));

// A literal: digits in a string when they don't fit a safe integer.
export const intLit = (v: number | string): Int => (typeof v === "number" ? v : norm(BigInt(v)));

// The float result is exact whenever it is a safe integer, so the fast path
// needs only that check.
export function add(a: Int, b: Int): Int {
  if (typeof a === "number" && typeof b === "number") { const r = a + b; if (Number.isSafeInteger(r)) return r; }
  return norm(big(a) + big(b));
}
export function sub(a: Int, b: Int): Int {
  if (typeof a === "number" && typeof b === "number") { const r = a - b; if (Number.isSafeInteger(r)) return r; }
  return norm(big(a) - big(b));
}
export function mul(a: Int, b: Int): Int {
  if (typeof a === "number" && typeof b === "number") { const r = a * b; if (Number.isSafeInteger(r)) return r === 0 ? 0 : r; }
  return norm(big(a) * big(b));
}
export const neg = (a: Int): Int => (typeof a === "number" ? (a === 0 ? 0 : -a) : norm(-a));
export const abs = (a: Int): Int => (less(a, 0) ? neg(a) : a);
export const less = (a: Int, b: Int): boolean => a < b;

// Division rounds down and the remainder has the divisor's sign, so
// a = b · quotient + remainder always, and remainder(-1, 3) = 2. Dividing by
// zero has no answer: these are Choice.
export function quotient(a: Int, b: Int): Int[] {
  if (b === 0) return [];
  if (typeof a === "number" && typeof b === "number") {
    // a − r is an exact multiple of b, so the division is exact.
    const d = a - floorMod(a, b);
    if (Number.isSafeInteger(d)) { const q = d / b; return [q === 0 ? 0 : q]; }
  }
  const x = big(a), y = big(b), q = x / y, r = x % y;
  return [norm(r !== 0n && (r < 0n) !== (y < 0n) ? q - 1n : q)];
}
const floorMod = (a: number, b: number) => { const r = a % b; return r !== 0 && (r < 0) !== (b < 0) ? r + b : r; };
export function remainder(a: Int, b: Int): Int[] {
  if (b === 0) return [];
  if (typeof a === "number" && typeof b === "number") { const r = floorMod(a, b); return [r === 0 ? 0 : r]; }
  const y = big(b), r = big(a) % y;
  return [norm(r !== 0n && (r < 0n) !== (y < 0n) ? r + y : r)];
}

// A negative power isn't whole: no answer.
export function power(a: Int, n: Int): Int[] {
  if (less(n, 0)) return [];
  if (typeof a === "number" && typeof n === "number") { const r = a ** n; if (Number.isSafeInteger(r)) return [r]; }
  return [norm(big(a) ** big(n))];
}

// Divided by their greatest common divisor (Euclid's algorithm), the
// second made positive: a fraction in lowest terms. (n, 0) gives (±1, 0).
export function lowestTerms(a: Int, b: Int): [Int, Int] {
  let x = big(abs(a)), y = big(abs(b));
  while (y !== 0n) [x, y] = [y, x % y];
  if (x === 0n) return [0, 0];
  const sign = less(b, 0) ? -1n : 1n;
  return [norm((sign * big(a)) / x), norm((sign * big(b)) / x)];
}

export const show = (a: Int): string => String(a);
// The nearest float; exact up to 2^53.
export const toNumber = (a: Int): number => Number(a);
// Rounds down. Infinity and NaN aren't whole numbers: no answer.
export function wholePart(x: number): Int[] {
  if (!Number.isFinite(x)) return [];
  const f = Math.floor(x);
  return [Number.isSafeInteger(f) ? (f === 0 ? 0 : f) : norm(BigInt(f))];
}
// Only the spelling `show` produces: no leading zeros, no plus sign, no
// spaces. So reading is `show` run backwards, and it has one answer or none.
export function read(t: string): Int[] {
  if (!/^-?(0|[1-9][0-9]*)$/.test(t) || t === "-0") return [];
  return [norm(BigInt(t))];
}

// A fraction literal's parts in lowest terms: 3 is 3/1, "6/-8" isn't one
// (the sign goes on top), "6/8" is 3/4. Null when it isn't a fraction or
// the bottom is 0. (arith.ts spells such a literal as ratio(top, bottom).)
export function ratioParts(v: number | string): [bigint, bigint] | null {
  const m = typeof v === "number" ? (Number.isInteger(v) ? [String(v), "1"] : null) : /^\s*(-?\d+)\s*(?:\/\s*(\d+)\s*)?$/.exec(v)?.slice(1, 3).map((x) => x ?? "1");
  if (!m) return null;
  const [p, q] = m.map((x) => BigInt(x as string));
  if (q === 0n) return null;
  const gcd = (a: bigint, b: bigint): bigint => (b === 0n ? (a < 0n ? -a : a) : gcd(b, a % b));
  const g = gcd(p, q);
  return [p / g, q / g];
}
