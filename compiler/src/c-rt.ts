// The runtime of native programs' Ints and Texts (docs/design/targets/NATIVE.md,
// stage N4), in C: what wasm-rt.ts is to WebAssembly. The meaning is the
// evaluator's (ters/src/lang/int.ts and text.ts), case by case.
//
// An Int is an int64_t: odd, the value itself shifted left one (while it
// fits 62 bits), else even, a pointer to a counted cell of 32-bit limbs and
// a sign. Each Int has one spelling (a value that fits is never a cell), so
// two small ones are equal when their words are. Big arithmetic is
// schoolbook, and division is Knuth's Algorithm D as Warren's Hacker's
// Delight writes it (divmnu).
//
// A Text is a counted cell of UTF-8 bytes and their number. Positions count
// characters (code points), as in the evaluator. UTF-8's byte order is the
// code points' order, so `less` compares bytes.
//
// The world (N4b) is the console and files over the C library and POSIX,
// failing with Node's world's words and status 2.
//
// Every function owns its inputs, as the program's own do, and drops them.
// One with no answer (Choice) sets lab_st to 1 and gives a stand-in.

import { nfcC } from "./c-nfc.ts";
export interface ListNames { cons: string; nil: string; type: number; tag: number; head: number; record?: string }
// A runtime function: its C, given the names of the list type it makes or
// reads, and what it calls.
interface Fn { c: string | ((l: ListNames) => string); uses: string[] }

// Types and helpers every Int or Text needs.
export const BASE = `#include <string.h>
// GCC (12 to 14, -O2) warns of reading address 1 where it knows an Int is
// small: on a path the test before it rules out.
#if defined(__GNUC__) && !defined(__clang__)
#pragma GCC diagnostic ignored "-Warray-bounds"
#endif
#define LAB_INT_T 65535
#define LAB_TEXT_T 65534
typedef int64_t lab_int;
typedef struct { lab_cell h; int32_t neg; uint32_t n; uint32_t d[]; } lab_big;
typedef struct { lab_cell h; uint32_t n; uint8_t b[]; } lab_text;
#define LAB_SMALL(v) ((lab_int)(((uint64_t)(int64_t)(v) << 1) | 1u))
#define LAB_IS_SMALL(x) (((x) & 1) != 0)
#define LAB_VAL(x) ((int64_t)(x) >> 1)
#define LAB_BIG(x) ((lab_big *)(intptr_t)(x))
#define LAB_TB(t) (((lab_text *)(t))->b)
#define LAB_TN(t) (((lab_text *)(t))->n)
static const int64_t lab__max = ((int64_t)1 << 62) - 1, lab__min = -((int64_t)1 << 62);
static inline lab_int lab_int_dup(lab_int x) { if (!LAB_IS_SMALL(x)) lab_dup((lab_cell *)LAB_BIG(x)); return x; }
static inline void lab_int_drop(lab_int x) { if (!LAB_IS_SMALL(x)) lab_drop((lab_cell *)LAB_BIG(x)); }
static inline void lab_int_dec(lab_int x) { if (!LAB_IS_SMALL(x)) lab_dec((lab_cell *)LAB_BIG(x)); }
static lab_cell *lab__text(size_t n) {
  lab_text *t = lab_new(sizeof(lab_text) + (n ? n : 1), LAB_TEXT_T, 0);
  t->n = (uint32_t)n;
  return (lab_cell *)t;
}
static lab_cell *lab__text_of(const char *s, size_t n) { lab_cell *t = lab__text(n); memcpy(LAB_TB(t), s, n); return t; }
// An Int's magnitude as limbs, borrowed: a small one's go in m->sm.
typedef struct { int neg; uint32_t n; const uint32_t *d; uint32_t sm[2]; } lab__mag;
static void lab__mag_of(lab_int x, lab__mag *m) {
  if (LAB_IS_SMALL(x)) {
    int64_t v = LAB_VAL(x);
    uint64_t u = v < 0 ? (uint64_t)0 - (uint64_t)v : (uint64_t)v;
    m->neg = v < 0; m->sm[0] = (uint32_t)u; m->sm[1] = (uint32_t)(u >> 32);
    m->n = m->sm[1] ? 2 : m->sm[0] ? 1 : 0; m->d = m->sm;
  } else { lab_big *b = LAB_BIG(x); m->neg = b->neg; m->n = b->n; m->d = b->d; }
}
// The one spelling of sign and limbs d[0..n) (n may count high zeros).
static lab_int lab__int(int neg, const uint32_t *d, uint32_t n) {
  while (n && !d[n - 1]) n--;
  if (n <= 2) {
    uint64_t u = n == 0 ? 0 : n == 1 ? d[0] : ((uint64_t)d[1] << 32) | d[0];
    if (u <= (uint64_t)lab__max) return LAB_SMALL(neg ? -(int64_t)u : (int64_t)u);
    if (neg && u == (uint64_t)1 << 62) return LAB_SMALL(lab__min);
  }
  lab_big *b = lab_new(sizeof(lab_big) + 4 * (size_t)n, LAB_INT_T, 0);
  b->neg = neg && n > 0; b->n = n;
  memcpy(b->d, d, 4 * (size_t)n);
  return (lab_int)(intptr_t)b;
}
// Each Int operation is a small inline part for two small Ints, which a
// loop compiles to a few machine instructions, and a call for the rest.
static lab_int lab__int64_big(int64_t v) {
  uint64_t u = v < 0 ? (uint64_t)0 - (uint64_t)v : (uint64_t)v;
  uint32_t d[2] = { (uint32_t)u, (uint32_t)(u >> 32) };
  return lab__int(v < 0, d, 2);
}
static inline lab_int lab__int64(int64_t v) { return v >= lab__min && v <= lab__max ? LAB_SMALL(v) : lab__int64_big(v); }
static uint32_t *lab__limbs(size_t n) { uint32_t *d = calloc(n ? n : 1, 4); if (!d) lab_oom(); return d; }
static int lab__cmp(const uint32_t *a, uint32_t an, const uint32_t *b, uint32_t bn) {
  while (an && !a[an - 1]) an--;
  while (bn && !b[bn - 1]) bn--;
  if (an != bn) return an < bn ? -1 : 1;
  for (uint32_t i = an; i-- > 0;) if (a[i] != b[i]) return a[i] < b[i] ? -1 : 1;
  return 0;
}
// r = a + b, r has max(an, bn) + 1 limbs.
static void lab__add(uint32_t *r, const uint32_t *a, uint32_t an, const uint32_t *b, uint32_t bn) {
  uint64_t k = 0;
  uint32_t n = an > bn ? an : bn;
  for (uint32_t i = 0; i < n; i++) { k += (uint64_t)(i < an ? a[i] : 0) + (i < bn ? b[i] : 0); r[i] = (uint32_t)k; k >>= 32; }
  r[n] = (uint32_t)k;
}
// r = a − b where a ≥ b, r has an limbs.
static void lab__sub(uint32_t *r, const uint32_t *a, uint32_t an, const uint32_t *b, uint32_t bn) {
  int64_t k = 0;
  for (uint32_t i = 0; i < an; i++) { k += (int64_t)a[i] - (i < bn ? b[i] : 0); r[i] = (uint32_t)k; k = k < 0 ? -1 : 0; }
}
// Signed a + b (or a − b, flip): sign and magnitude.
static lab_int lab__addsub(lab_int x, lab_int y, int flip) {
  lab__mag a, b;
  lab__mag_of(x, &a); lab__mag_of(y, &b);
  int bneg = b.neg ^ flip;
  uint32_t n = (a.n > b.n ? a.n : b.n) + 1;
  uint32_t *r = lab__limbs(n);
  lab_int out;
  if (a.neg == bneg) { lab__add(r, a.d, a.n, b.d, b.n); out = lab__int(a.neg, r, n); }
  else if (lab__cmp(a.d, a.n, b.d, b.n) >= 0) { lab__sub(r, a.d, a.n, b.d, b.n); out = lab__int(a.neg, r, a.n); }
  else { lab__sub(r, b.d, b.n, a.d, a.n); out = lab__int(bneg, r, b.n); }
  free(r);
  lab_int_drop(x); lab_int_drop(y);
  return out;
}
static void lab__mul(uint32_t *r, const uint32_t *a, uint32_t an, const uint32_t *b, uint32_t bn) {
  memset(r, 0, 4 * (size_t)(an + bn));
  for (uint32_t i = 0; i < an; i++) {
    uint64_t k = 0;
    for (uint32_t j = 0; j < bn; j++) { k += (uint64_t)a[i] * b[j] + r[i + j]; r[i + j] = (uint32_t)k; k >>= 32; }
    r[i + bn] = (uint32_t)k;
  }
}
static int lab__nlz(uint32_t x) { int n = 0; if (!x) return 32; while (!(x & 0x80000000u)) { x <<= 1; n++; } return n; }
// q = u / v and r = u mod v, of magnitudes (m ≥ n ≥ 1, v[n − 1] ≠ 0):
// Knuth's Algorithm D as Hacker's Delight's divmnu. q has m − n + 1 limbs,
// r has n.
static void lab__divmod(uint32_t *q, uint32_t *r, const uint32_t *u, uint32_t m, const uint32_t *v, uint32_t n) {
  const uint64_t b = (uint64_t)1 << 32;
  if (n == 1) {
    uint64_t k = 0;
    for (uint32_t j = m; j-- > 0;) { uint64_t x = (k << 32) | u[j]; q[j] = (uint32_t)(x / v[0]); k = x - (uint64_t)q[j] * v[0]; }
    r[0] = (uint32_t)k;
    return;
  }
  int s = lab__nlz(v[n - 1]);
  uint32_t *vn = lab__limbs(n), *un = lab__limbs(m + 1);
  for (uint32_t i = n - 1; i > 0; i--) vn[i] = (v[i] << s) | (uint32_t)((uint64_t)v[i - 1] >> (32 - s));
  vn[0] = v[0] << s;
  un[m] = (uint32_t)((uint64_t)u[m - 1] >> (32 - s));
  for (uint32_t i = m - 1; i > 0; i--) un[i] = (u[i] << s) | (uint32_t)((uint64_t)u[i - 1] >> (32 - s));
  un[0] = u[0] << s;
  for (int64_t j = (int64_t)m - n; j >= 0; j--) {
    uint64_t top = ((uint64_t)un[j + n] << 32) | un[j + n - 1];
    uint64_t qhat = top / vn[n - 1], rhat = top - qhat * vn[n - 1];
    while (qhat >= b || qhat * vn[n - 2] > ((rhat << 32) | un[j + n - 2])) { qhat--; rhat += vn[n - 1]; if (rhat >= b) break; }
    int64_t k = 0, t;
    for (uint32_t i = 0; i < n; i++) {
      uint64_t p = qhat * vn[i];
      t = (int64_t)un[i + j] - k - (int64_t)(p & 0xFFFFFFFFu);
      un[i + j] = (uint32_t)t;
      k = (int64_t)(p >> 32) - (t >> 32);
    }
    t = (int64_t)un[j + n] - k;
    un[j + n] = (uint32_t)t;
    q[j] = (uint32_t)qhat;
    if (t < 0) {
      q[j]--;
      uint64_t c = 0;
      for (uint32_t i = 0; i < n; i++) { c += (uint64_t)un[i + j] + vn[i]; un[i + j] = (uint32_t)c; c >>= 32; }
      un[j + n] += (uint32_t)c;
    }
  }
  for (uint32_t i = 0; i + 1 < n; i++) r[i] = (un[i] >> s) | (uint32_t)((uint64_t)un[i + 1] << (32 - s));
  r[n - 1] = un[n - 1] >> s;
  free(vn); free(un);
}
// Floor division and its remainder (the divisor's sign), y ≠ 0: q, r or both.
static void lab__floordiv(lab_int x, lab_int y, lab_int *q, lab_int *r) {
  if (LAB_IS_SMALL(x) && LAB_IS_SMALL(y)) {
    int64_t a = LAB_VAL(x), b = LAB_VAL(y), d = a / b, m = a % b;
    if (m != 0 && (m < 0) != (b < 0)) { d--; m += b; }
    if (q) *q = lab__int64(d);
    if (r) *r = LAB_SMALL(m);
    return;
  }
  lab__mag a, b;
  lab__mag_of(x, &a); lab__mag_of(y, &b);
  lab_int qi, ri;
  if (lab__cmp(a.d, a.n, b.d, b.n) < 0) { qi = LAB_SMALL(0); ri = lab_int_dup(x); }
  else {
    uint32_t bn = b.n; while (!b.d[bn - 1]) bn--;
    uint32_t *qd = lab__limbs(a.n - bn + 1), *rd = lab__limbs(bn);
    lab__divmod(qd, rd, a.d, a.n, b.d, bn);
    qi = lab__int(a.neg != b.neg, qd, a.n - bn + 1); ri = lab__int(a.neg, rd, bn);
    free(qd); free(rd);
  }
  // Truncated to floored: one less, and the remainder plus the divisor.
  int rz = ri == LAB_SMALL(0);
  if (!rz && a.neg != b.neg) {
    qi = lab__addsub(qi, LAB_SMALL(1), 1);
    ri = lab__addsub(ri, lab_int_dup(y), 0);
  }
  if (q) *q = qi; else lab_int_drop(qi);
  if (r) *r = ri; else lab_int_drop(ri);
}
// Decimal digits of a big magnitude, most significant first, into s (room
// for 10 per limb); its length.
static size_t lab__digits(const uint32_t *d, uint32_t n, char *s) {
  uint32_t *w = lab__limbs(n);
  memcpy(w, d, 4 * (size_t)n);
  size_t k = 0;
  while (n && !w[n - 1]) n--;
  while (n) {
    uint64_t rem = 0;
    for (uint32_t i = n; i-- > 0;) { uint64_t x = (rem << 32) | w[i]; w[i] = (uint32_t)(x / 1000000000u); rem = x % 1000000000u; }
    while (n && !w[n - 1]) n--;
    for (int j = 0; j < 9 && (n || rem); j++) { s[k++] = (char)('0' + rem % 10); rem /= 10; }
  }
  if (!k) s[k++] = '0';
  for (size_t i = 0; i < k / 2; i++) { char c = s[i]; s[i] = s[k - 1 - i]; s[k - 1 - i] = c; }
  free(w);
  return k;
}
// An Int's spelling, into a buffer the caller frees.
static char *lab__show(lab_int x, size_t *len) {
  lab__mag m;
  lab__mag_of(x, &m);
  char *s = malloc(10 * (size_t)m.n + 3);
  if (!s) lab_oom();
  size_t k = 0;
  if (m.neg) s[k++] = '-';
  k += lab__digits(m.d, m.n, s + k);
  s[k] = 0;
  *len = k;
  return s;
}
// A whole Float64 (finite) as an Int.
static lab_int lab__of_double(double f) {
  if (f > -4611686018427387904.0 && f < 4611686018427387904.0) return LAB_SMALL((int64_t)f);
  int e;
  double m = frexp(fabs(f), &e); // |f| = m · 2^e, 0.5 ≤ m < 1
  uint64_t u = (uint64_t)ldexp(m, 53);
  int sh = e - 53; // ≥ 10 here
  uint32_t n = (uint32_t)(sh / 32 + 3);
  uint32_t *d = lab__limbs(n);
  int w = sh / 32, b = sh % 32;
  uint32_t x0 = (uint32_t)u, x1 = (uint32_t)(u >> 32);
  d[w] = x0 << b;
  d[w + 1] = (b ? x0 >> (32 - b) : 0) | (x1 << b);
  d[w + 2] = b ? x1 >> (32 - b) : 0;
  lab_int r = lab__int(f < 0, d, n);
  free(d);
  return r;
}
// JavaScript's String(x) for a Float64 (ECMA-262 Number::toString): the
// fewest digits that read back as x (the first precision whose correctly
// rounded digits do), then whole up to 21 digits, a point inside, 0.000ddd
// down to 10⁻⁶, else d.ddde±x.
static lab_cell *lab__js_string(double x) {
  char out[40], buf[40];
  size_t k = 0;
  if (x != x) return lab__text_of("NaN", 3);
  if (x == 0) return lab__text_of("0", 1);
  if (x < 0) { out[k++] = '-'; x = -x; }
  if (isinf(x)) { memcpy(out + k, "Infinity", 8); return lab__text_of(out, k + 8); }
  for (int p = 1; p <= 17; p++) { snprintf(buf, sizeof buf, "%.*e", p - 1, x); if (strtod(buf, 0) == x) break; }
  char dig[20];
  int nd = 0;
  char *e = buf;
  for (; *e != 'e'; e++) if (*e != '.') dig[nd++] = *e;
  int n = atoi(e + 1) + 1;
  while (nd > 1 && dig[nd - 1] == '0') nd--;
  if (nd <= n && n <= 21) { memcpy(out + k, dig, nd); k += nd; for (int i = nd; i < n; i++) out[k++] = '0'; }
  else if (0 < n && n <= 21) { memcpy(out + k, dig, n); k += n; out[k++] = '.'; memcpy(out + k, dig + n, nd - n); k += nd - n; }
  else if (-6 < n && n <= 0) { out[k++] = '0'; out[k++] = '.'; for (int i = 0; i < -n; i++) out[k++] = '0'; memcpy(out + k, dig, nd); k += nd; }
  else {
    out[k++] = dig[0];
    if (nd > 1) { out[k++] = '.'; memcpy(out + k, dig + 1, nd - 1); k += nd - 1; }
    k += (size_t)sprintf(out + k, "e%c%d", n - 1 >= 0 ? '+' : '-', n - 1 >= 0 ? n - 1 : 1 - n);
  }
  return lab__text_of(out, k);
}
// Where the character ending at byte i (> 0) starts.
static inline uint32_t lab__back(const uint8_t *b, uint32_t i) { do i--; while (i > 0 && (b[i] & 0xC0) == 0x80); return i; }
// Byte position of character k (the length if there are fewer).
static uint32_t lab__at(const uint8_t *b, uint32_t n, int64_t k) {
  uint32_t i = 0;
  for (int64_t c = 0; i < n; i++) if ((b[i] & 0xC0) != 0x80 && c++ == k) return i;
  return n;
}
// An Int as an int64_t, a big one as ±2^63 (positions past any text).
static int64_t lab__clamp(lab_int x) { return LAB_IS_SMALL(x) ? LAB_VAL(x) : LAB_BIG(x)->neg ? INT64_MIN : INT64_MAX; }`;

const FNS: Record<string, Fn> = {
  "int.add": { uses: [], c: `static inline lab_int lab_int_add(lab_int a, lab_int b) { if (LAB_IS_SMALL(a) && LAB_IS_SMALL(b)) return lab__int64(LAB_VAL(a) + LAB_VAL(b)); return lab__addsub(a, b, 0); }` },
  "int.sub": { uses: [], c: `static inline lab_int lab_int_sub(lab_int a, lab_int b) { if (LAB_IS_SMALL(a) && LAB_IS_SMALL(b)) return lab__int64(LAB_VAL(a) - LAB_VAL(b)); return lab__addsub(a, b, 1); }` },
  "int.neg": { uses: [], c: `static inline lab_int lab_int_neg(lab_int a) { if (LAB_IS_SMALL(a)) return lab__int64(-LAB_VAL(a)); return lab__addsub(LAB_SMALL(0), a, 1); }` },
  "int.abs": { uses: ["int.neg"], c: `static lab_int lab_int_abs(lab_int a) { return (LAB_IS_SMALL(a) ? LAB_VAL(a) < 0 : LAB_BIG(a)->neg) ? lab_int_neg(a) : a; }` },
  "int.mul": {
    uses: [],
    c: `static lab_int lab__mul_big(lab_int x, lab_int y) {
  lab__mag a, b;
  lab__mag_of(x, &a); lab__mag_of(y, &b);
  uint32_t *r = lab__limbs(a.n + b.n);
  lab__mul(r, a.d, a.n, b.d, b.n);
  lab_int out = lab__int(a.neg != b.neg, r, a.n + b.n);
  free(r);
  lab_int_drop(x); lab_int_drop(y);
  return out;
}
static inline lab_int lab_int_mul(lab_int x, lab_int y) {
  if (LAB_IS_SMALL(x) && LAB_IS_SMALL(y)) {
    int64_t a = LAB_VAL(x), b = LAB_VAL(y), r;
#if defined(__GNUC__) || defined(__clang__)
    if (!__builtin_mul_overflow(a, b, &r)) return lab__int64(r);
#else
    if (a > -2147483648LL && a < 2147483648LL && b > -2147483648LL && b < 2147483648LL) return lab__int64(a * b);
#endif
  }
  return lab__mul_big(x, y);
}` },
  "int.less": {
    uses: [],
    c: `static int32_t lab__less_big(lab_int x, lab_int y) {
  lab__mag a, b;
  lab__mag_of(x, &a); lab__mag_of(y, &b);
  int r = a.neg != b.neg ? a.neg : a.neg ? lab__cmp(b.d, b.n, a.d, a.n) < 0 : lab__cmp(a.d, a.n, b.d, b.n) < 0;
  lab_int_drop(x); lab_int_drop(y);
  return r;
}
static inline int32_t lab_int_less(lab_int x, lab_int y) { return LAB_IS_SMALL(x) && LAB_IS_SMALL(y) ? LAB_VAL(x) < LAB_VAL(y) : lab__less_big(x, y); }` },
  "int.equal": {
    uses: [],
    c: `static int32_t lab__equal_big(lab_int x, lab_int y) {
  if (LAB_IS_SMALL(x) || LAB_IS_SMALL(y)) { int r = x == y; lab_int_drop(x); lab_int_drop(y); return r; }
  lab_big *a = LAB_BIG(x), *b = LAB_BIG(y);
  int r = a->neg == b->neg && lab__cmp(a->d, a->n, b->d, b->n) == 0;
  lab_int_drop(x); lab_int_drop(y);
  return r;
}
static inline int32_t lab_int_equal(lab_int x, lab_int y) { return LAB_IS_SMALL(x) && LAB_IS_SMALL(y) ? x == y : lab__equal_big(x, y); }` },
  // The greatest common divisor, at least 0 (gcd(0, 0) is 0): Euclid's
  // algorithm (textbook), on int64s once both are small. For std.ts's
  // lowest terms, which the lowering writes with this and int.exact.
  "int.gcd": { uses: ["int.abs"], c: `static lab_int lab_int_gcd(lab_int x, lab_int y) { x = lab_int_abs(x); y = lab_int_abs(y); while (y != LAB_SMALL(0)) { if (LAB_IS_SMALL(x) && LAB_IS_SMALL(y)) { int64_t a = LAB_VAL(x), b = LAB_VAL(y); while (b) { int64_t t = a % b; a = b; b = t; } return LAB_SMALL(a); } lab_int r; lab__floordiv(x, y, 0, &r); lab_int_drop(x); x = y; y = r; } return x; }` },
  // x over g, g at least 0 and dividing x (int.gcd's); 0 when g is 0.
  "int.exact": { uses: [], c: `static lab_int lab_int_exact(lab_int x, lab_int g) { lab_int q; if (g == LAB_SMALL(0)) { lab_int_drop(x); return LAB_SMALL(0); } lab__floordiv(x, g, &q, 0); lab_int_drop(x); lab_int_drop(g); return q; }` },
  // and, or, xor in two's complement with ones going on forever for a
  // negative, as BigInt's (int.ts bitAnd, C150): on the words when both
  // are small, else limb by limb, each turned to two's complement
  // (~m + 1) as it is read, and back.
  "int.bits": { uses: [], c: `static lab_int lab__bits_big(lab_int x, lab_int y, int op) {
  lab__mag a, b;
  lab__mag_of(x, &a); lab__mag_of(y, &b);
  uint32_t n = (a.n > b.n ? a.n : b.n) + 1, *r = lab__limbs(n);
  int neg = op == 0 ? (a.neg & b.neg) : op == 1 ? (a.neg | b.neg) : (a.neg ^ b.neg);
  uint64_t ca = 1, cb = 1, cr = 1;
  for (uint32_t i = 0; i < n; i++) {
    uint64_t u = i < a.n ? a.d[i] : 0, v = i < b.n ? b.d[i] : 0;
    if (a.neg) { u = (u ^ 0xffffffffu) + ca; ca = u >> 32; u &= 0xffffffffu; }
    if (b.neg) { v = (v ^ 0xffffffffu) + cb; cb = v >> 32; v &= 0xffffffffu; }
    uint64_t w = op == 0 ? (u & v) : op == 1 ? (u | v) : (u ^ v);
    if (neg) { w = (w ^ 0xffffffffu) + cr; cr = w >> 32; w &= 0xffffffffu; }
    r[i] = (uint32_t)w;
  }
  lab_int out = lab__int(neg, r, n);
  free(r);
  lab_int_drop(x); lab_int_drop(y);
  return out;
}
static inline lab_int lab__int_bits(lab_int x, lab_int y, int op) {
  if (LAB_IS_SMALL(x) && LAB_IS_SMALL(y)) { int64_t a = LAB_VAL(x), b = LAB_VAL(y); return LAB_SMALL(op == 0 ? (a & b) : op == 1 ? (a | b) : (a ^ b)); }
  return lab__bits_big(x, y, op);
}` },
  "int.bitAnd": { uses: ["int.bits"], c: `static inline lab_int lab_int_bitAnd(lab_int a, lab_int b) { return lab__int_bits(a, b, 0); }` },
  "int.bitOr": { uses: ["int.bits"], c: `static inline lab_int lab_int_bitOr(lab_int a, lab_int b) { return lab__int_bits(a, b, 1); }` },
  "int.bitXor": { uses: ["int.bits"], c: `static inline lab_int lab_int_bitXor(lab_int a, lab_int b) { return lab__int_bits(a, b, 2); }` },
  // A 32-bit machine word (C150e, machine-words.ts) held in an int32_t,
  // read unsigned: as an Int, from an Int known to fit, and shifted down
  // by an Int n (up when n is negative), kept to 32 bits.
  "word32.widen": { uses: [], c: `static lab_int lab_word32_widen(int32_t x) { return LAB_SMALL((int64_t)(uint32_t)x); }` },
  "word32.narrow": { uses: [], c: `static int32_t lab_word32_narrow(lab_int x) { int32_t r = LAB_IS_SMALL(x) ? (int32_t)(uint32_t)LAB_VAL(x) : 0; lab_int_drop(x); return r; }` },
  "word32.wrap": { uses: [], c: `static int32_t lab_word32_wrap(lab_int x) { uint32_t r = LAB_IS_SMALL(x) ? (uint32_t)LAB_VAL(x) : LAB_BIG(x)->n ? (LAB_BIG(x)->neg ? 0u - LAB_BIG(x)->d[0] : LAB_BIG(x)->d[0]) : 0u; lab_int_drop(x); return (int32_t)r; }` },
  // A 64-bit machine word (C150h) in an int64_t: one past 2⁶³ is a big
  // Int of two limbs.
  "word64.widen": { uses: [], c: `static lab_int lab_word64_widen(int64_t x) { uint64_t u = (uint64_t)x; if (u <= (uint64_t)lab__max) return LAB_SMALL((int64_t)u); uint32_t d[2] = { (uint32_t)u, (uint32_t)(u >> 32) }; return lab__int(0, d, 2); }` },
  "word64.wrap": { uses: [], c: `static int64_t lab_word64_wrap(lab_int x) { uint64_t r; if (LAB_IS_SMALL(x)) r = (uint64_t)LAB_VAL(x); else { lab_big *b = LAB_BIG(x); r = b->n ? b->d[0] : 0; if (b->n > 1) r |= (uint64_t)b->d[1] << 32; if (b->neg) r = 0u - r; } lab_int_drop(x); return (int64_t)r; }` },
  "word64.narrow": { uses: ["word64.wrap"], c: `static int64_t lab_word64_narrow(lab_int x) { return lab_word64_wrap(x); }` },
  "word64.shiftDown": { uses: [], c: `static int64_t lab_word64_shiftDown(int64_t x, lab_int n) { int64_t k = lab__clamp(n); lab_int_drop(n); return k >= 64 || k <= -64 ? 0 : k >= 0 ? (int64_t)((uint64_t)x >> k) : (int64_t)((uint64_t)x << -k); }` },
  "word32.shiftDown": { uses: [], c: `static int32_t lab_word32_shiftDown(int32_t x, lab_int n) { int64_t k = lab__clamp(n); lab_int_drop(n); return k >= 32 || k <= -32 ? 0 : k >= 0 ? (int32_t)((uint32_t)x >> k) : (int32_t)((uint32_t)x << -k); }` },
  // floor(a · b / 2ⁿ) for 0 ≤ n < 64 (wide-products.ts, L89): the 128-bit
  // product of two small Ints, shifted, when the answer is small too;
  // otherwise the product and the shift.
  "int.mulShift": {
    uses: ["int.mul", "int.shiftDown"],
    c: `static lab_int lab_int_mulShift(lab_int a, lab_int b, lab_int n) {
#ifdef __SIZEOF_INT128__
  if (LAB_IS_SMALL(a) && LAB_IS_SMALL(b) && LAB_IS_SMALL(n)) {
    __extension__ typedef __int128 wide;
    wide r = ((wide)LAB_VAL(a) * LAB_VAL(b)) >> LAB_VAL(n);
    if (r >= INT64_MIN && r <= INT64_MAX) return lab__int64((int64_t)r);
  }
#endif
  return lab_int_shiftDown(lab_int_mul(a, b), n);
}`,
  },
  // floor(a / 2ⁿ), a negative n shifting up (int.ts shiftDown, C150b):
  // a 64-bit shift when both are small and n ≥ 0, else floor division by
  // 2ⁿ (or · 2⁻ⁿ); past a's last limb only its sign is left.
  "int.shiftDown": {
    uses: ["int.quotient", "int.power", "int.mul"],
    c: `static lab_int lab__shift_big(lab_int a, lab_int n) {
  int neg = LAB_IS_SMALL(a) ? LAB_VAL(a) < 0 : LAB_BIG(a)->neg;
  if (!LAB_IS_SMALL(n)) { if (LAB_BIG(n)->neg) lab_oom(); lab_int_drop(a); lab_int_drop(n); return LAB_SMALL(neg ? -1 : 0); }
  int64_t k = LAB_VAL(n);
  if (k < 0) return lab_int_mul(a, lab_int_power(LAB_SMALL(2), lab__int64(-k)));
  if (LAB_IS_SMALL(a)) return lab__int64(LAB_VAL(a) >> (k < 63 ? k : 63));
  if ((uint64_t)k > 32 * (uint64_t)LAB_BIG(a)->n) { lab_int_drop(a); return LAB_SMALL(neg ? -1 : 0); }
  return lab_int_quotient(a, lab_int_power(LAB_SMALL(2), n));
}
static inline lab_int lab_int_shiftDown(lab_int a, lab_int n) { return LAB_IS_SMALL(a) && LAB_IS_SMALL(n) && LAB_VAL(n) >= 0 ? LAB_SMALL(LAB_VAL(a) >> (LAB_VAL(n) < 63 ? LAB_VAL(n) : 63)) : lab__shift_big(a, n); }`,
  },
  "int.quotient": { uses: [], c: `static lab_int lab_int_quotient(lab_int x, lab_int y) { lab_int q; if (y == LAB_SMALL(0)) { lab_int_drop(x); lab_st = 1; return LAB_SMALL(0); } lab__floordiv(x, y, &q, 0); lab_int_drop(x); lab_int_drop(y); return q; }` },
  "int.remainder": { uses: [], c: `static lab_int lab_int_remainder(lab_int x, lab_int y) { lab_int r; if (y == LAB_SMALL(0)) { lab_int_drop(x); lab_st = 1; return LAB_SMALL(0); } lab__floordiv(x, y, 0, &r); lab_int_drop(x); lab_int_drop(y); return r; }` },
  // A negative power has no answer; 0, 1 and −1 to any power are small.
  "int.power": {
    uses: ["int.mul", "int.less"],
    c: `static lab_int lab_int_power(lab_int a, lab_int n) {
  if (lab_int_less(lab_int_dup(n), LAB_SMALL(0))) { lab_int_drop(a); lab_int_drop(n); lab_st = 1; return LAB_SMALL(0); }
  if (a == LAB_SMALL(0) || a == LAB_SMALL(1)) { int z = n == LAB_SMALL(0); lab_int_drop(n); return z ? LAB_SMALL(1) : a; }
  if (a == LAB_SMALL(-1)) { int odd = LAB_IS_SMALL(n) ? (LAB_VAL(n) & 1) : (LAB_BIG(n)->d[0] & 1); lab_int_drop(n); return odd ? a : LAB_SMALL(1); }
  if (!LAB_IS_SMALL(n)) lab_oom();
  uint64_t k = (uint64_t)LAB_VAL(n);
  lab_int r = LAB_SMALL(1);
  while (k) {
    if (k & 1) r = lab_int_mul(r, lab_int_dup(a));
    k >>= 1;
    if (k) a = lab_int_mul(lab_int_dup(a), a);
  }
  lab_int_drop(a);
  return r;
}` },
  "int.show": { uses: [], c: `static lab_cell *lab_int_show(lab_int a) { size_t n; char *s = lab__show(a, &n); lab_cell *t = lab__text_of(s, n); free(s); lab_int_drop(a); return t; }` },
  // The nearest Float64: exact while it fits 53 bits, else strtod's
  // correct rounding of the digits.
  "int.toNumber": { uses: [], c: `static double lab_int_toNumber(lab_int a) { if (LAB_IS_SMALL(a)) return (double)LAB_VAL(a); size_t n; char *s = lab__show(a, &n); double d = strtod(s, 0); free(s); lab_int_drop(a); return d; }` },
  "int.wholePart": { uses: [], c: `static lab_int lab_int_wholePart(double x) { if (!isfinite(x)) { lab_st = 1; return LAB_SMALL(0); } return lab__of_double(floor(x)); }` },
  // Only show's spelling: no leading zeros or plus, not "-0".
  "int.read": {
    uses: [],
    c: `static lab_int lab_int_read(lab_cell *t) {
  const uint8_t *b = LAB_TB(t);
  uint32_t n = LAB_TN(t), i = b[0] == '-' && n > 0;
  int ok = n > i && (b[i] != '0' || n == i + 1) && !(i && n == 2 && b[1] == '0');
  for (uint32_t j = i; ok && j < n; j++) ok = b[j] >= '0' && b[j] <= '9';
  if (!ok) { lab_drop(t); lab_st = 1; return LAB_SMALL(0); }
  uint32_t m = (n - i) / 9 + 2;
  uint32_t *d = lab__limbs(m);
  for (uint32_t j = i; j < n;) {
    uint32_t chunk = 0, mul = 1;
    for (int c = 0; c < 9 && j < n; c++, j++) { chunk = chunk * 10 + (b[j] - '0'); mul *= 10; }
    uint64_t k = chunk;
    for (uint32_t l = 0; l < m; l++) { k += (uint64_t)d[l] * mul; d[l] = (uint32_t)k; k >>= 32; }
  }
  lab_int r = lab__int(i, d, m);
  free(d);
  lab_drop(t);
  return r;
}` },
  "number.show": {
    uses: [],
    // A whole Float64 as it is, a nonzero one below 1e-6 in size by its
    // shortest digits (L154), any other rounded to 9 places
    // (Math.round(x · 1e9) / 1e9: the nearest whole number, halves up).
    c: `static lab_cell *lab_number_show(double x) {
  if (x != 0 && fabs(x) < 1e-6) return lab__js_string(x);
  if (!(isfinite(x) && floor(x) == x)) {
    double y = x * 1e9, f = floor(y);
    if (isfinite(y) && floor(y) != y) { double r = y - f >= 0.5 ? f + 1 : f; if (r == 0 && y < 0) r = -0.0; y = r; }
    x = y / 1e9;
  }
  return lab__js_string(x);
}` },
  "text.concat": {
    uses: [],
    c: `static lab_cell *lab_text_concat(lab_cell *a, lab_cell *b) {
  if (!LAB_TN(a)) { lab_drop(a); return b; }
  if (!LAB_TN(b)) { lab_drop(b); return a; }
  lab_cell *t = lab__text((size_t)LAB_TN(a) + LAB_TN(b));
  memcpy(LAB_TB(t), LAB_TB(a), LAB_TN(a)); memcpy(LAB_TB(t) + LAB_TN(a), LAB_TB(b), LAB_TN(b));
  lab_drop(a); lab_drop(b);
  return t;
}` },
  // Random under \`seeded\` (C106): ters/src/lang/random.ts's generator,
  // xoshiro128** (Blackman and Vigna, 2018, public domain) seeded by
  // SplitMix32, so every target draws the same numbers.
  "rand.seed": { uses: [], c: `static uint32_t lab__r[4];
static uint32_t lab__rotl(uint32_t x, int k) { return (x << k) | (x >> (32 - k)); }
static double lab_rand_seed(double seed) {
  /* JavaScript's ToUint32 of the floor, exact for every double (C109). */
  double y = floor(seed);
  uint32_t z = (uint32_t)(y - floor(y / 4294967296.0) * 4294967296.0);
  for (int k = 0; k < 4; k++) {
    z += 0x9e3779b9u;
    uint32_t x = z;
    x = (x ^ (x >> 16)) * 0x85ebca6bu;
    x = (x ^ (x >> 13)) * 0xc2b2ae35u;
    lab__r[k] = x ^ (x >> 16);
  }
  return 0;
}
static uint32_t lab__rand_word(void) {
  uint32_t r = lab__rotl(lab__r[1] * 5, 7) * 9, t = lab__r[1] << 9;
  lab__r[2] ^= lab__r[0]; lab__r[3] ^= lab__r[1]; lab__r[1] ^= lab__r[2]; lab__r[0] ^= lab__r[3];
  lab__r[2] ^= t; lab__r[3] = lab__rotl(lab__r[3], 11);
  return r;
}
static double lab_rand_next(void) { double hi = (double)(lab__rand_word() >> 5); return (hi * 67108864.0 + (double)(lab__rand_word() >> 6)) / 9007199254740992.0; }
static double lab_rand_s0(void) { return lab__r[0]; }
static double lab_rand_s1(void) { return lab__r[1]; }
static double lab_rand_s2(void) { return lab__r[2]; }
static double lab_rand_s3(void) { return lab__r[3]; }
static double lab_rand_restore(double a, double b, double c, double d) { lab__r[0] = (uint32_t)a; lab__r[1] = (uint32_t)b; lab__r[2] = (uint32_t)c; lab__r[3] = (uint32_t)d; return 0; }` },
  ...Object.fromEntries(["rand.next", "rand.s0", "rand.s1", "rand.s2", "rand.s3", "rand.restore"].map((n) => [n, { uses: ["rand.seed"], c: "" }])),
  // Nobody has seeded the generator (C136): its words are all 0, which
  // seeding never gives.
  "rand.unset": { uses: ["rand.seed"], c: `static int32_t lab_rand_unset(void) { return (lab__r[0] | lab__r[1] | lab__r[2] | lab__r[3]) == 0; }` },
  // A Text shown, quoted as JSON.stringify quotes it (run.ts showValue, C102).
  "text.quoted": {
    uses: [],
    c: `static lab_cell *lab_text_quoted(lab_cell *t) {
  static const char hex[] = "0123456789abcdef";
  const uint8_t *b = LAB_TB(t); uint32_t n = LAB_TN(t); size_t m = 2;
  for (uint32_t i = 0; i < n; i++) { uint8_t c = b[i]; m += c == '"' || c == '\\\\' || c == '\\b' || c == '\\f' || c == '\\n' || c == '\\r' || c == '\\t' ? 2 : c < 32 ? 6 : 1; }
  lab_cell *r = lab__text(m);
  uint8_t *o = (uint8_t *)LAB_TB(r);
  *o++ = '"';
  for (uint32_t i = 0; i < n; i++) {
    uint8_t c = b[i], e = c == '"' ? '"' : c == '\\\\' ? '\\\\' : c == '\\b' ? 'b' : c == '\\f' ? 'f' : c == '\\n' ? 'n' : c == '\\r' ? 'r' : c == '\\t' ? 't' : 0;
    if (e) { *o++ = '\\\\'; *o++ = e; }
    else if (c < 32) { *o++ = '\\\\'; *o++ = 'u'; *o++ = '0'; *o++ = '0'; *o++ = hex[c >> 4]; *o++ = hex[c & 15]; }
    else *o++ = c;
  }
  *o = '"';
  lab_drop(t);
  return r;
}` },
  "text.length": { uses: [], c: `static lab_int lab_text_length(lab_cell *t) { int64_t k = 0; for (uint32_t i = 0; i < LAB_TN(t); i++) k += (LAB_TB(t)[i] & 0xC0) != 0x80; lab_drop(t); return LAB_SMALL(k); }` },
  "text.size": { uses: [], c: `static int32_t lab_text_size(lab_cell *t) { int32_t n = (int32_t)LAB_TN(t); lab_drop(t); return n; }` },
  "text.before": { uses: [], c: `static int32_t lab_text_before(lab_cell *t, int32_t i) { int32_t r = (int32_t)lab__back(LAB_TB(t), (uint32_t)i); lab_drop(t); return r; }` },
  "text.bytes": { uses: [], c: `static lab_cell *lab_text_bytes(lab_cell *t, int32_t a, int32_t b) { lab_cell *r = lab__text_of((const char *)LAB_TB(t) + a, (size_t)(b - a)); lab_drop(t); return r; }` },
  // Characters from up to, not including, to, clamped: it never fails.
  "text.slice": {
    uses: [],
    c: `static lab_cell *lab_text_slice(lab_cell *t, lab_int from, lab_int to) {
  int64_t a = lab__clamp(from), b = lab__clamp(to);
  lab_int_drop(from); lab_int_drop(to);
  if (a < 0) a = 0;
  if (b <= a) { lab_drop(t); return lab__text(0); }
  uint32_t i = lab__at(LAB_TB(t), LAB_TN(t), a), j = lab__at(LAB_TB(t), LAB_TN(t), b);
  if (i == 0 && j == LAB_TN(t)) return t;
  lab_cell *r = lab__text_of((const char *)LAB_TB(t) + i, j - i);
  lab_drop(t);
  return r;
}` },
  "text.equal": { uses: [], c: `static int32_t lab_text_equal(lab_cell *a, lab_cell *b) { int r = a == b || (LAB_TN(a) == LAB_TN(b) && !memcmp(LAB_TB(a), LAB_TB(b), LAB_TN(a))); lab_drop(a); lab_drop(b); return r; }` },
  "text.less": {
    uses: [],
    c: `static int32_t lab_text_less(lab_cell *a, lab_cell *b) {
  uint32_t n = LAB_TN(a) < LAB_TN(b) ? LAB_TN(a) : LAB_TN(b);
  int c = memcmp(LAB_TB(a), LAB_TB(b), n);
  int r = c ? c < 0 : LAB_TN(a) < LAB_TN(b);
  lab_drop(a); lab_drop(b);
  return r;
}` },
  // The first character position where part starts (0 for an empty part).
  "text.find": {
    uses: [],
    c: `static lab_int lab_text_find(lab_cell *t, lab_cell *part) {
  const uint8_t *b = LAB_TB(t), *p = LAB_TB(part);
  uint32_t n = LAB_TN(t), m = LAB_TN(part);
  for (uint32_t i = 0; i + m <= n; i++) {
    if (m && (b[i] != p[0] || memcmp(b + i, p, m))) continue;
    int64_t k = 0;
    for (uint32_t j = 0; j < i; j++) k += (b[j] & 0xC0) != 0x80;
    lab_drop(t); lab_drop(part);
    return LAB_SMALL(k);
  }
  lab_drop(t); lab_drop(part);
  lab_st = 1;
  return LAB_SMALL(0);
}` },
  // A one-character text's number.
  "text.code": {
    uses: [],
    c: `static lab_int lab_text_code(lab_cell *t) {
  const uint8_t *b = LAB_TB(t);
  uint32_t n = LAB_TN(t), w = !n ? 0 : b[0] < 0x80 ? 1 : b[0] < 0xE0 ? 2 : b[0] < 0xF0 ? 3 : 4;
  if (!n || n != w) { lab_drop(t); lab_st = 1; return LAB_SMALL(0); }
  int64_t c = w == 1 ? b[0] : b[0] & (0x7F >> w);
  for (uint32_t i = 1; i < w; i++) c = (c << 6) | (b[i] & 0x3F);
  lab_drop(t);
  return LAB_SMALL(c);
}` },
  // The Float64 a text spells (L176, C108): text.ts's grammar checked
  // here, then strtod, which rounds the decimal once to the nearest.
  "text.readNumber": {
    uses: [],
    c: `static double lab_text_readNumber(lab_cell *t) {
  const uint8_t *b = LAB_TB(t);
  uint32_t n = LAB_TN(t), i = 0, digits = 0;
  if (i < n && (b[i] == '+' || b[i] == '-')) i++;
  while (i < n && b[i] >= '0' && b[i] <= '9') { i++; digits++; }
  if (i < n && b[i] == '.') { i++; while (i < n && b[i] >= '0' && b[i] <= '9') { i++; digits++; } }
  int ok = digits > 0;
  if (ok && i < n && (b[i] == 'e' || b[i] == 'E')) {
    uint32_t ed = 0;
    i++;
    if (i < n && (b[i] == '+' || b[i] == '-')) i++;
    while (i < n && b[i] >= '0' && b[i] <= '9') { i++; ed++; }
    ok = ed > 0;
  }
  if (!ok || i != n) { lab_drop(t); lab_st = 1; return 0; }
  char *s = malloc(n + 1);
  memcpy(s, b, n);
  s[n] = 0;
  double x = strtod(s, 0);
  free(s);
  lab_drop(t);
  if (!isfinite(x)) { lab_st = 1; return 0; }
  return x == 0 ? 0 : x;
}` },
  // A character's text; not a character's number (a surrogate, beyond
  // U+10FFFF, below 0): no answer.
  "text.fromCode": {
    uses: [],
    c: `static lab_cell *lab_text_fromCode(lab_int x) {
  int64_t c = lab__clamp(x);
  lab_int_drop(x);
  if (c < 0 || c > 0x10FFFF || (c >= 0xD800 && c <= 0xDFFF)) { lab_st = 1; return 0; }
  char s[4];
  size_t n = c < 0x80 ? 1 : c < 0x800 ? 2 : c < 0x10000 ? 3 : 4;
  if (n == 1) s[0] = (char)c;
  else { for (size_t i = n - 1; i > 0; i--) { s[i] = (char)(0x80 | (c & 0x3F)); c >>= 6; } s[0] = (char)((0xF00 >> n) | c); }
  return lab__text_of(s, n);
}` },
  // range(n): 0, 1, …, n − 1, built from the end.
  "int.range": {
    uses: [],
    c: (l) => `static lab_cell *lab_int_range(lab_int x) {
  int64_t n = lab__clamp(x);
  lab_int_drop(x);
  lab_cell *acc = &${l.nil};
  for (int64_t i = n; i-- > 0;) { ${l.cons} *c = lab_new(sizeof(${l.cons}), ${l.type}, ${l.tag}); c->f${l.head} = LAB_SMALL(i); c->f${1 - l.head} = acc; acc = (lab_cell *)c; }
  return acc;
}` },
  // Its length is n as JavaScript's Array.from({ length: n }) takes it:
  // whole part, at least 0.
  "number.range": {
    uses: [],
    c: (l) => `static lab_cell *lab_number_range(double x) {
  double n = x != x || x <= 0 ? 0 : floor(x);
  lab_cell *acc = &${l.nil};
  for (double i = n - 1; i >= 0; i--) { ${l.cons} *c = lab_new(sizeof(${l.cons}), ${l.type}, ${l.tag}); c->f${l.head} = i; c->f${1 - l.head} = acc; acc = (lab_cell *)c; }
  return acc;
}` },
  "text.characters": {
    uses: [],
    c: (l) => `static lab_cell *lab_text_characters(lab_cell *t) {
  lab_cell *acc = &${l.nil};
  for (uint32_t j = LAB_TN(t); j > 0;) {
    uint32_t i = lab__back(LAB_TB(t), j);
    ${l.cons} *c = lab_new(sizeof(${l.cons}), ${l.type}, ${l.tag});
    c->f${l.head} = lab__text_of((const char *)LAB_TB(t) + i, j - i); c->f${1 - l.head} = acc;
    acc = (lab_cell *)c;
    j = i;
  }
  lab_drop(t);
  return acc;
}` },
  // JavaScript's split: the parts between each match of by, left to right;
  // by empty, the characters.
  "text.split": {
    uses: ["text.characters"],
    c: (l) => `static lab_cell *lab_text_split(lab_cell *t, lab_cell *by) {
  uint32_t n = LAB_TN(t), m = LAB_TN(by);
  if (!m) { lab_drop(by); return lab_text_characters(t); }
  const uint8_t *b = LAB_TB(t), *p = LAB_TB(by);
  uint32_t *at = malloc(4 * ((size_t)n / m + 2)), k = 0;
  if (!at) lab_oom();
  for (uint32_t i = 0; i + m <= n;) { if (!memcmp(b + i, p, m)) { at[k++] = i; i += m; } else i++; }
  lab_cell *acc = &${l.nil};
  uint32_t end = n;
  for (uint32_t j = k + 1; j-- > 0;) {
    uint32_t start = j ? at[j - 1] + m : 0;
    ${l.cons} *c = lab_new(sizeof(${l.cons}), ${l.type}, ${l.tag});
    c->f${l.head} = lab__text_of((const char *)b + start, end - start); c->f${1 - l.head} = acc;
    acc = (lab_cell *)c;
    if (j) end = at[j - 1];
  }
  free(at);
  lab_drop(t); lab_drop(by);
  return acc;
}` },
  "text.joinAll": {
    uses: [],
    c: (l) => `static lab_cell *lab_text_joinAll(lab_cell *parts, lab_cell *by) {
  size_t n = 0, k = 0;
  for (lab_cell *c = parts; c->tag == ${l.tag}; c = ((${l.cons} *)c)->f${1 - l.head}) n += LAB_TN(((${l.cons} *)c)->f${l.head}) + (k++ ? LAB_TN(by) : 0);
  lab_cell *t = lab__text(n);
  uint8_t *o = LAB_TB(t);
  k = 0;
  for (lab_cell *c = parts; c->tag == ${l.tag}; c = ((${l.cons} *)c)->f${1 - l.head}) {
    lab_cell *x = ((${l.cons} *)c)->f${l.head};
    if (k++) { memcpy(o, LAB_TB(by), LAB_TN(by)); o += LAB_TN(by); }
    memcpy(o, LAB_TB(x), LAB_TN(x)); o += LAB_TN(x);
  }
  lab_drop(parts); lab_drop(by);
  return t;
}` },

  // ---- The world (N4b): the console and files over the C library and
  // POSIX, failing as Node's world (ters/src/lang/world.ts) does:
  // with its words for a reason, and status 2.
  // L186's log of the world's answers (C172b), as worldlog.ts writes it:
  // with TERS_LOG=file set, each answer the world gives (its arguments and
  // what came back, or the failure) and each write, as JSON, for
  // \`ters run --replay\` to give the evaluator.
  "world.log": {
    uses: [],
    c: `static FILE *lab_log;
static int lab_log_state, lab_log_n, lab_log_open;
static void lab__log_end(void) { if (lab_log) { fputs("]\\n", lab_log); fclose(lab_log); lab_log = 0; } }
static int lab__log_on(void) {
  if (!lab_log_state) {
    lab_log_state = 1;
    const char *to = getenv("TERS_LOG");
    if (to && *to && (lab_log = fopen(to, "wb"))) { fputc('[', lab_log); atexit(lab__log_end); }
  }
  return lab_log != 0;
}
static void lab__log_raw(const char *s) { fputs(s, lab_log); }
static void lab__log_str(const uint8_t *b, size_t n) {
  fputc('"', lab_log);
  for (size_t i = 0; i < n; i++) {
    uint8_t c = b[i];
    if (c == '"' || c == '\\\\') { fputc('\\\\', lab_log); fputc(c, lab_log); }
    else if (c == '\\n') fputs("\\\\n", lab_log);
    else if (c == '\\r') fputs("\\\\r", lab_log);
    else if (c == '\\t') fputs("\\\\t", lab_log);
    else if (c < 0x20) fprintf(lab_log, "\\\\u%04x", c);
    else fputc(c, lab_log);
  }
  fputc('"', lab_log);
}
static void lab__log_text(lab_cell *t) { lab__log_str(LAB_TB(t), LAB_TN(t)); }
// An entry's start, up to its arguments' opening bracket; 0 when no log is kept.
static int lab__log_begin(const char *op) {
  if (!lab__log_on()) return 0;
  fprintf(lab_log, "%s{\\"op\\":\\"%s\\",\\"args\\":[", lab_log_n++ ? "," : "", op);
  lab_log_open = 1;
  return 1;
}
// After the arguments: what came back is written next, then lab__log_close.
static void lab__log_answer(void) { lab__log_raw("],\\"answer\\":"); }
static void lab__log_close(void) { lab__log_raw("}"); lab_log_open = 0; }
static void lab__log_write(void) { lab__log_raw("],\\"write\\":true}"); lab_log_open = 0; }`,
  },
  "world.fail": {
    uses: ["world.log"],
    c: `static void lab__fail(int e, lab_cell *path) {
  const char *p = (const char *)LAB_TB(path);
  int n = (int)LAB_TN(path);
  char *s = malloc((size_t)n + 64);
  if (!s) lab_oom();
  int k = e == ENOENT ? sprintf(s, "no such file or folder: %.*s", n, p)
    : e == EISDIR ? sprintf(s, "%.*s is a folder, not a file", n, p)
    : e == ENOTDIR ? sprintf(s, "%.*s is not a folder", n, p)
    : e == EACCES ? sprintf(s, "not allowed to use %.*s", n, p)
    : sprintf(s, "%.40s: %.*s", strerror(e), n, p);
  lab_drop(lab_reason);
  lab_reason = lab__text_of(s, (size_t)k);
  free(s);
  // An answer being logged ends as this failure (C172b).
  if (lab_log_open) { lab__log_raw("],\\"threw\\":"); lab__log_text(lab_reason); lab__log_raw("}"); lab_log_open = 0; }
  lab_drop(path);
  lab_st = 2;
}
// A Text as a C string, for the C library's paths.
static char *lab__cstr(lab_cell *t) { char *s = malloc((size_t)LAB_TN(t) + 1); if (!s) lab_oom(); memcpy(s, LAB_TB(t), LAB_TN(t)); s[LAB_TN(t)] = 0; return s; }
// 0 nothing there, 1 a file (or anything but a folder), 2 a folder.
static int lab__kind(const char *p) { struct stat st; return stat(p, &st) ? 0 : S_ISDIR(st.st_mode) ? 2 : 1; }`,
  },
  // The fuel, read, and swapped for another (C137c21).
  "fuel.get": { uses: [], c: "static double lab_fuel_get(void) { return lab_fuel; }" },
  "fuel.swap": { uses: [], c: "static double lab_fuel_swap(double x) { double t = lab_fuel; lab_fuel = x; return t; }" },
  // A stop with a reason (L51c): its words, then as lab_stop (c.ts).
  "world.stopWith": { uses: [], c: `static double lab_world_stopWith(lab_cell *t) { lab_stop_why = (const char *)LAB_TB(t); lab_stop_n = LAB_TN(t); return lab_stop(-1); }` },
  // The world's clock in milliseconds since 1970, and a wait that blocks
  // (C44a), logged as Node's world logs now and wait (worldlog.ts).
  "world.now": { uses: ["world.log"], c: `#include <time.h>
// Whether the clock was read (C199c: a native page's views that read it
// run again each frame, as a browser page's do).
static int lab_now_read;
static double lab_world_now(void) {
  lab_now_read = 1;
  struct timespec ts;
  clock_gettime(CLOCK_REALTIME, &ts);
  double ms = (double)ts.tv_sec * 1000.0 + (double)(ts.tv_nsec / 1000000);
  if (lab__log_begin("now")) { lab__log_answer(); fprintf(lab_log, "%.17g", ms); lab__log_close(); }
  return ms;
}` },
  "world.sleep": { uses: ["world.log"], c: `#include <time.h>
static double lab_world_sleep(double ms) {
  if (lab__log_begin("wait")) { fprintf(lab_log, "%.17g", ms); lab__log_write(); }
  if (ms > 0) {
    struct timespec ts = { (time_t)(ms / 1000.0), (long)(fmod(ms, 1000.0) * 1000000.0) };
    while (nanosleep(&ts, &ts) == -1) {}
  }
  fflush(stdout);
  return 0;
}` },
  "world.print": { uses: [], c: `static void lab_world_print(lab_cell *t) { fwrite(LAB_TB(t), 1, LAB_TN(t), stdout); putchar('\\n'); lab_drop(t); }` },
  // A seed from the world for Random's generator (C136): four bytes of
  // /dev/urandom, or the time and an address where there is none.
  // The seed is an answer L186's log keeps (C172c), so a replay draws
  // the same numbers from it.
  "world.randomSeed": { uses: ["world.log"], c: `#include <time.h>
static double lab_world_randomSeed(void) {
  uint32_t s = 0;
  FILE *f = fopen("/dev/urandom", "rb");
  if (f) { if (fread(&s, sizeof s, 1, f) != 1) s = 0; fclose(f); }
  if (!s) s = (uint32_t)time(NULL) ^ (uint32_t)clock() ^ (uint32_t)(uintptr_t)&s;
  if (lab__log_begin("randomSeed")) { lab__log_answer(); fprintf(lab_log, "%u", (unsigned)s); lab__log_close(); }
  return (double)s;
}` },
  // The files `with open file` keeps open (L213c5), as Node's world keeps
  // them (ters/src/lang/world.ts): opened for reading from the start and
  // adding at the end, read through a buffer that a line or bytes take
  // from, the reading ended for good once it finds the end. A file's
  // number is its place here, from 1; only the library sees it.
  "world.kept": { uses: [], c: `#include <fcntl.h>
#include <unistd.h>
typedef struct { int fd; long at; uint8_t *rest; size_t n; int ended; } lab_kept_file;
static lab_kept_file lab_kept[1024];
static int lab_kept_n;
static lab_kept_file *lab__kept(lab_int f) { int64_t i = LAB_IS_SMALL(f) ? LAB_VAL(f) : 0; return i >= 1 && i <= lab_kept_n && lab_kept[i - 1].fd >= 0 ? &lab_kept[i - 1] : 0; }
static void lab__kept_more(lab_kept_file *k) {
  uint8_t piece[1 << 16];
  ssize_t n = pread(k->fd, piece, sizeof piece, k->at);
  if (n <= 0) { k->ended = 1; return; }
  k->at += n;
  k->rest = realloc(k->rest, k->n + (size_t)n);
  if (!k->rest) lab_oom();
  memcpy(k->rest + k->n, piece, (size_t)n);
  k->n += (size_t)n;
}` },
  "world.keptOpen": {
    uses: ["world.kept", "world.fail"],
    c: (o) => `static lab_cell *lab_world_keptOpen(lab_cell *path) {
  char *p = lab__cstr(path);
  lab_drop(path);
  int fd = lab_kept_n < 1024 ? open(p, O_RDWR | O_CREAT | O_APPEND, 0666) : -1;
  free(p);
  if (fd < 0) return &${o.nil};
  lab_kept[lab_kept_n++] = (lab_kept_file){ fd, 0, 0, 0, 0 };
  ${o.cons} *r = lab_new(sizeof(${o.cons}), ${o.type}, ${o.tag});
  r->f${o.head} = LAB_SMALL(lab_kept_n);
  return (lab_cell *)r;
}`,
  },
  "world.keptLine": {
    uses: ["world.kept", "world.nfc"],
    c: (o) => `static lab_cell *lab_world_keptLine(lab_int f) {
  lab_kept_file *k = lab__kept(f);
  if (!k) return &${o.nil};
  while (!k->ended && !(k->n && memchr(k->rest, '\\n', k->n))) lab__kept_more(k);
  if (!k->n) return &${o.nil};
  uint8_t *nl = memchr(k->rest, '\\n', k->n);
  size_t end = nl ? (size_t)(nl - k->rest) : k->n, len = end;
  if (len && k->rest[len - 1] == '\\r') len--;
  lab_cell *t = lab__nfc(lab__text_of((const char *)k->rest, len));
  size_t used = nl ? end + 1 : end;
  memmove(k->rest, k->rest + used, k->n - used);
  k->n -= used;
  ${o.cons} *r = lab_new(sizeof(${o.cons}), ${o.type}, ${o.tag});
  r->f${o.head} = t;
  return (lab_cell *)r;
}`,
  },
  "world.keptAddLine": { uses: ["world.kept"], c: `static int32_t lab_world_keptAddLine(lab_int f, lab_cell *t) {
  lab_kept_file *k = lab__kept(f);
  int ok = k && write(k->fd, LAB_TB(t), LAB_TN(t)) == (ssize_t)LAB_TN(t) && write(k->fd, "\\n", 1) == 1;
  lab_drop(t);
  return ok;
}` },
  // Bytes from where the reading is, and bytes added at the end (L213c7):
  // Bytes is a record of a list of Ints, its C struct o.record.
  "world.keptBytes": {
    uses: ["world.kept"],
    c: (o) => `static ${o.record} lab_world_keptBytes(lab_int f, lab_int count) {
  lab_kept_file *k = lab__kept(f);
  int64_t want = LAB_IS_SMALL(count) ? LAB_VAL(count) : 0;
  size_t n = 0;
  if (k && want > 0) {
    while (!k->ended && k->n < (uint64_t)want) lab__kept_more(k);
    n = k->n < (uint64_t)want ? k->n : (size_t)want;
  }
  lab_cell *acc = &${o.nil};
  for (size_t i = n; i-- > 0;) { ${o.cons} *c = lab_new(sizeof(${o.cons}), ${o.type}, ${o.tag}); c->f${o.head} = LAB_SMALL(k->rest[i]); c->f${1 - o.head} = acc; acc = (lab_cell *)c; }
  if (n) { memmove(k->rest, k->rest + n, k->n - n); k->n -= n; }
  return (${o.record}){ acc };
}`,
  },
  "world.keptAddBytes": {
    uses: ["world.kept"],
    c: (o) => `static int32_t lab_world_keptAddBytes(lab_int f, ${o.record} b) {
  lab_kept_file *k = lab__kept(f);
  size_t n = 0;
  for (lab_cell *c = b.f0; c->tag == ${o.tag}; c = ((${o.cons} *)c)->f${1 - o.head}) n++;
  uint8_t *buf = malloc(n ? n : 1);
  if (!buf) lab_oom();
  n = 0;
  for (lab_cell *c = b.f0; c->tag == ${o.tag}; c = ((${o.cons} *)c)->f${1 - o.head}) buf[n++] = (uint8_t)LAB_VAL(((${o.cons} *)c)->f${o.head});
  int ok = k && write(k->fd, buf, n) == (ssize_t)n;
  free(buf);
  lab_drop(b.f0);
  return ok;
}`,
  },
  "world.keptClose": { uses: ["world.kept"], c: `static void lab_world_keptClose(lab_int f) { lab_kept_file *k = lab__kept(f); if (k) { close(k->fd); k->fd = -1; free(k->rest); k->rest = 0; k->n = 0; } }` },
  // A program's own handlers of operations answered at once (L213c4): a
  // stack of frames, each an effect's number and its cases' closures,
  // pushed while the code it handles runs; a perform calls the nearest
  // frame's case (given a count of it). Koka's evidence, as the core IR's
  // JavaScript keeps it.
  "handlers": { uses: [], c: `typedef struct { int e, n, busy; lab_cell *c[16]; } lab_hframe;
static lab_hframe lab_hs[4096];
static int lab_hn;
static int lab_handlers_push(int e, int n, lab_cell **cs) {
  if (lab_hn == 4096 || n > 16) { fputs("too many handlers\\n", stderr); exit(3); }
  lab_hframe *f = &lab_hs[lab_hn++];
  f->e = e; f->n = n; f->busy = 0;
  for (int k = 0; k < n; k++) f->c[k] = cs[k];
  return 0;
}
static int lab_handlers_pop(int e) {
  lab_hframe *f = &lab_hs[--lab_hn];
  (void)e;
  for (int k = 0; k < f->n; k++) if (f->c[k]) lab_drop(f->c[k]);
  return 0;
}
static lab_cell *lab_handlers_case(int e, int i) {
  for (int k = lab_hn; k-- > 0;) if (lab_hs[k].e == e) {
    if (!lab_hs[k].c[i]) { fputs("this operation isn't on C yet\\n", stderr); exit(3); }
    lab_dup(lab_hs[k].c[i]);
    return lab_hs[k].c[i];
  }
  fputs("nothing handles an operation\\n", stderr);
  exit(3);
}
// Where a handler's case may perform the operation it handles (Pig's
// recorded into draws a number for each it hands on): while the case
// runs, its frame is out of the search, so the draw is the next one's, or
// the world's when there is none (C199f).
static int lab_handlers_has(int e) { for (int k = lab_hn; k-- > 0;) if (lab_hs[k].e == e && !lab_hs[k].busy) return 1; return 0; }
static int lab_htaken[4096], lab_htn;
static lab_cell *lab_handlers_take(int e, int i) {
  for (int k = lab_hn; k-- > 0;) if (lab_hs[k].e == e && !lab_hs[k].busy) { lab_hs[k].busy = 1; lab_htaken[lab_htn++] = k; lab_dup(lab_hs[k].c[i]); return lab_hs[k].c[i]; }
  fputs("nothing handles an operation\\n", stderr);
  exit(3);
}
static int lab_handlers_give(int e) { (void)e; if (lab_htn) lab_hs[lab_htaken[--lab_htn]].busy = 0; return 0; }` },
  // A program's own handlers whose cases keep the rest (C44b): the code
  // handled runs on a fiber of its own (a stack, ucontext), which a
  // perform leaves for the handler's driver, taking its frame and those
  // above it off the stack of frames; the rest puts them back and goes
  // back in. One-shot, as Koka's and OCaml 5's effect handlers on fibers.
  // Android's libc has no ucontext (C199f): there a fiber is started by
  // moving the stack pointer onto its stack (one instruction per
  // processor) and switched with sigsetjmp and siglongjmp.
  "fibers": { uses: [], c: `#if defined(__ANDROID__) || defined(LAB_FIBER_SJLJ)
#include <setjmp.h>
typedef struct { sigjmp_buf jb; void (*fn)(void); char *top; } lab__ctx;
static void lab__cgo(lab__ctx *to) {
  if (to->fn) {
    void (*fn)(void) = to->fn; char *sp = to->top;
    to->fn = 0;
#if defined(__aarch64__)
    __asm__ volatile("mov sp, %0\\n\\tblr %1" :: "r"(sp), "r"(fn) : "memory");
#elif defined(__arm__)
    __asm__ volatile("mov sp, %0\\n\\tblx %1" :: "r"(sp), "r"(fn) : "memory");
#elif defined(__x86_64__)
    __asm__ volatile("mov %0, %%rsp\\n\\tcall *%1" :: "r"(sp), "r"(fn) : "memory");
#elif defined(__i386__)
    __asm__ volatile("mov %0, %%esp\\n\\tcall *%1" :: "r"(sp), "r"(fn) : "memory");
#else
#error "no fibers for this processor"
#endif
    __builtin_unreachable();
  }
  siglongjmp(to->jb, 1);
}
#define LAB_CSWAP(from, to) do { if (!sigsetjmp((from)->jb, 0)) lab__cgo(to); } while (0)
#define LAB_CSET(to) lab__cgo(to)
#define LAB_CMAKE(c, f, stk, n) ((c)->fn = (f), (c)->top = (char *)(((uintptr_t)(stk) + (n)) & ~(uintptr_t)15))
#else
#include <ucontext.h>
typedef ucontext_t lab__ctx;
#define LAB_CSWAP(from, to) swapcontext(from, to)
#define LAB_CSET(to) setcontext(to)
#define LAB_CMAKE(c, f, stk, n) (getcontext(c), (c)->uc_stack.ss_sp = (stk), (c)->uc_stack.ss_size = (n), (c)->uc_link = 0, makecontext(c, f, 0))
#endif
typedef struct lab__frame lab__frame;
typedef struct { lab__ctx ctx; void *stack; } lab__fiber;
struct lab__frame { int e, op, noff; lab__ctx driver; lab__fiber *fiber, *at; void (*entry)(lab__frame *); lab__frame **off; };
typedef struct { lab_cell h; void (*code)(void); void *k; } lab__frest; // a rest: its handler's frame
#define LAB_FIBER_STACK ((size_t)1 << 26)
static lab__frame **lab__fs, *lab__fnew;
static int lab__fn, lab__fcap;
static lab__fiber *lab__fcur;
static void lab__fpush(lab__frame *h) {
  if (lab__fn == lab__fcap) { lab__fcap = lab__fcap ? 2 * lab__fcap : 16; lab__fs = realloc(lab__fs, lab__fcap * sizeof *lab__fs); if (!lab__fs) lab_oom(); }
  lab__fs[lab__fn++] = h;
}
static void lab__fbody(void) {
  lab__frame *h = lab__fnew;
  h->entry(h);
  for (int k = lab__fn; k-- > 0;) if (lab__fs[k] == h) { lab__fn = k; break; }
  h->op = -1;
  LAB_CSET(&h->driver);
}
static void lab__fstart(lab__frame *h, int e, void (*entry)(lab__frame *)) {
  lab__fiber *f = calloc(1, sizeof *f);
  if (!f || !(f->stack = malloc(LAB_FIBER_STACK))) lab_oom();
  LAB_CMAKE(&f->ctx, lab__fbody, f->stack, LAB_FIBER_STACK);
  h->e = e; h->entry = entry; h->fiber = h->at = f;
  lab__fnew = h;
  lab__fpush(h);
}
// Into the fiber where the handled code is, until it performs one of the
// frame's operations (its number) or finishes (-1).
static int lab__fgo(lab__frame *h) {
  lab__fiber *prev = lab__fcur;
  lab__fcur = h->at;
  LAB_CSWAP(&h->driver, &h->at->ctx);
  lab__fcur = prev;
  if (h->op < 0) { free(h->fiber->stack); free(h->fiber); h->fiber = 0; free(h->off); h->off = 0; }
  return h->op;
}
static void lab__fperform(int e, int op) {
  int k = lab__fn;
  while (k-- > 0 && lab__fs[k]->e != e) {}
  if (k < 0) { fflush(stdout); fputs("nothing handles an operation\\n", stderr); exit(3); }
  lab__frame *h = lab__fs[k];
  h->noff = lab__fn - k;
  h->off = realloc(h->off, h->noff * sizeof *h->off);
  if (!h->off) lab_oom();
  for (int j = 0; j < h->noff; j++) h->off[j] = lab__fs[k + j];
  lab__fn = k; h->op = op; h->at = lab__fcur;
  LAB_CSWAP(&lab__fcur->ctx, &h->driver);
}
static int lab__fhas(int e) { for (int k = lab__fn; k-- > 0;) if (lab__fs[k]->e == e) return 1; return 0; }
static void lab__fresume(lab__frame *h) { for (int j = 0; j < h->noff; j++) lab__fpush(h->off[j]); }` },
  // A branch of together or race waits till a moment (C44): it parks, out
  // to the nearest scheduler (c.ts `fbranches:`), which goes on with the
  // branch whose moment is soonest; outside any, the program sleeps.
  "fibers.park": { uses: ["fibers", "world.now", "world.sleep"], c: `#define LAB_PARK (-2)
static double lab__park_at;
static int lab__fpark(double at) {
  if (lab__fhas(LAB_PARK)) { lab__park_at = at; lab__fperform(LAB_PARK, 0); }
  else lab_world_sleep(at - lab_world_now());
  return 0;
}` },
  // A line of the program's Log nothing handles (L213a6, a release's):
  // standard error, as Node's world writes it.
  "world.logLine": { uses: [], c: `static void lab_world_logLine(lab_cell *t) { fflush(stdout); fwrite(LAB_TB(t), 1, LAB_TN(t), stderr); fputc('\\n', stderr); lab_drop(t); }` },
  "world.printError": { uses: ["world.log"], c: `static void lab_world_printError(lab_cell *t) { if (lab__log_begin("error")) { lab__log_text(t); lab__log_write(); } fflush(stdout); fwrite(LAB_TB(t), 1, LAB_TN(t), stderr); fputc('\\n', stderr); lab_drop(t); }` },
  // All of a stream that's left.
  "world.readAll": {
    uses: [],
    c: `static lab_cell *lab__read_all(FILE *f) {
  size_t n = 0, cap = 4096;
  char *s = malloc(cap);
  if (!s) lab_oom();
  for (size_t got; (got = fread(s + n, 1, cap - n, f)) > 0;) { n += got; if (n == cap) { s = realloc(s, cap *= 2); if (!s) lab_oom(); } }
  lab_cell *t = lab__text_of(s, n);
  free(s);
  return t;
}`,
  },
  // Text from the world comes in in NFC (C151, c-nfc.ts), as the evaluator's (ters/src/lang/border.ts).
  "world.nfc": { uses: [], get c() { return nfcC(); } },
  "world.readInput": { uses: ["world.readAll", "world.nfc", "world.log"], c: `static lab_cell *lab_world_readInput(void) { int L = lab__log_begin("input"); lab_cell *t = lab__nfc(lab__read_all(stdin)); if (L) { lab__log_answer(); lab__log_text(t); lab__log_close(); } return t; }` },
  // A line without its end (\n, or \r\n); none at the end of the input.
  "world.readLine": {
    uses: ["world.nfc", "world.log"],
    c: (o) => `static lab_cell *lab_world_readLine(void) {
  int L = lab__log_begin("readLine");
  int c = getchar();
  if (c == EOF) { if (L) { lab__log_answer(); lab__log_raw("null"); lab__log_close(); } return &${o.nil}; }
  size_t n = 0, cap = 128;
  char *s = malloc(cap);
  if (!s) lab_oom();
  for (; c != EOF && c != '\\n'; c = getchar()) { if (n == cap) { s = realloc(s, cap *= 2); if (!s) lab_oom(); } s[n++] = (char)c; }
  if (n && s[n - 1] == '\\r') n--;
  ${o.cons} *r = lab_new(sizeof(${o.cons}), ${o.type}, ${o.tag});
  r->f${o.head} = lab__nfc(lab__text_of(s, n));
  free(s);
  if (L) { lab__log_answer(); lab__log_text(r->f${o.head}); lab__log_close(); }
  return (lab_cell *)r;
}`,
  },
  "world.readFile": {
    uses: ["world.fail", "world.readAll", "world.nfc"],
    c: `static lab_cell *lab_world_readFile(lab_cell *path) {
  if (lab__log_begin("readFile")) lab__log_text(path);
  char *p = lab__cstr(path);
  FILE *f = lab__kind(p) == 2 ? (errno = EISDIR, (FILE *)0) : fopen(p, "rb");
  free(p);
  if (!f) { lab__fail(errno, path); return 0; }
  lab_cell *t = lab__nfc(lab__read_all(f));
  fclose(f);
  if (lab_log_open) { lab__log_answer(); lab__log_text(t); lab__log_close(); }
  lab_drop(path);
  return t;
}`,
  },
  "world.put": {
    uses: ["world.fail"],
    c: `static void lab__put(lab_cell *path, lab_cell *t, const char *mode) {
  if (lab__log_begin(mode[0] == 'a' ? "appendFile" : "writeFile")) { lab__log_text(path); lab__log_raw(","); lab__log_text(t); lab__log_write(); }
  char *p = lab__cstr(path);
  FILE *f = lab__kind(p) == 2 ? (errno = EISDIR, (FILE *)0) : fopen(p, mode);
  free(p);
  if (!f) { lab__fail(errno, path); lab_drop(t); return; }
  fwrite(LAB_TB(t), 1, LAB_TN(t), f);
  fclose(f);
  lab_drop(path); lab_drop(t);
}`,
  },
  "world.writeFile": { uses: ["world.put"], c: `static void lab_world_writeFile(lab_cell *path, lab_cell *t) { lab__put(path, t, "wb"); }` },
  "world.appendFile": { uses: ["world.put"], c: `static void lab_world_appendFile(lab_cell *path, lab_cell *t) { lab__put(path, t, "ab"); }` },
  // A zone's offset from UTC at an instant, in seconds (L188): the host's
  // zone database through TZ, NaN for a zone it doesn't have (a file under
  // TZDIR or /usr/share/zoneinfo). The local time read back as UTC by
  // Hinnant's days from civil, so no tm_gmtoff is needed.
  "world.zoneOffset": { uses: ["world.fail"], c: `#include <time.h>
#include <math.h>
static double lab_world_zoneOffset(lab_cell *zone, double at) {
  char *z = lab__cstr(zone); lab_drop(zone);
  double r = NAN;
  const char *dir = getenv("TZDIR");
  size_t n = strlen(z);
  int ok = n > 0 && z[0] != '/' && !strstr(z, "..") && isfinite(at);
  if (ok) { char *p = malloc(strlen(dir ? dir : "/usr/share/zoneinfo") + n + 2); if (!p) lab_oom(); sprintf(p, "%s/%s", dir ? dir : "/usr/share/zoneinfo", z); ok = lab__kind(p) == 1; free(p); }
  if (ok) {
    char *was = getenv("TZ") ? strdup(getenv("TZ")) : 0;
    setenv("TZ", z, 1); tzset();
    time_t t = (time_t)floor(at); struct tm tm;
    if (localtime_r(&t, &tm)) {
      long long y = tm.tm_year + 1900LL, m = tm.tm_mon + 1, d = tm.tm_mday;
      y -= m <= 2; long long era = (y >= 0 ? y : y - 399) / 400, yoe = y - era * 400;
      long long doy = (153 * (m + (m > 2 ? -3 : 9)) + 2) / 5 + d - 1, doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
      long long local = (era * 146097 + doe - 719468) * 86400LL + tm.tm_hour * 3600LL + tm.tm_min * 60LL + tm.tm_sec;
      r = (double)(local - (long long)t);
    }
    if (was) { setenv("TZ", was, 1); free(was); } else unsetenv("TZ");
    tzset();
  }
  free(z);
  return r;
}` },
  "world.fileExists": { uses: ["world.fail"], c: `static int32_t lab_world_fileExists(lab_cell *path) { int L = lab__log_begin("fileExists"); if (L) lab__log_text(path); char *p = lab__cstr(path); int r = lab__kind(p) != 0; free(p); if (L) { lab__log_answer(); lab__log_raw(r ? "true" : "false"); lab__log_close(); } lab_drop(path); return r; }` },
  // A folder's names, sorted as JavaScript sorts texts: by UTF-16 units,
  // so a character past U+FFFF comes before U+E000 to U+FFFF.
  "world.listFolder": {
    uses: ["world.fail", "world.nfc"],
    c: (l) => `static uint32_t lab__u16(const uint8_t *b, uint32_t n, uint32_t *i, uint32_t *low) {
  if (*low) { uint32_t u = *low; *low = 0; return u; }
  uint32_t c = b[(*i)++], w = c < 0x80 ? 0 : c < 0xE0 ? 1 : c < 0xF0 ? 2 : 3;
  if (w) c &= 0x3F >> w;
  for (; w && *i < n; w--) c = (c << 6) | (b[(*i)++] & 0x3F);
  if (c < 0x10000) return c;
  *low = 0xDC00 | ((c - 0x10000) & 0x3FF);
  return 0xD800 | ((c - 0x10000) >> 10);
}
static int lab__js_order(const void *x, const void *y) {
  lab_cell *a = *(lab_cell *const *)x, *b = *(lab_cell *const *)y;
  uint32_t i = 0, j = 0, la = 0, lb = 0;
  for (;;) {
    int ea = !la && i >= LAB_TN(a), eb = !lb && j >= LAB_TN(b);
    if (ea || eb) return ea && eb ? 0 : ea ? -1 : 1;
    uint32_t u = lab__u16(LAB_TB(a), LAB_TN(a), &i, &la), v = lab__u16(LAB_TB(b), LAB_TN(b), &j, &lb);
    if (u != v) return u < v ? -1 : 1;
  }
}
static lab_cell *lab_world_listFolder(lab_cell *path) {
  if (lab__log_begin("listFolder")) lab__log_text(path);
  char *p = lab__cstr(path);
  int kind = lab__kind(p);
  DIR *dir = kind == 1 ? (errno = ENOTDIR, (DIR *)0) : opendir(p);
  free(p);
  if (!dir) { lab__fail(errno, path); return 0; }
  size_t n = 0, cap = 16;
  lab_cell **xs = malloc(cap * sizeof *xs);
  if (!xs) lab_oom();
  for (struct dirent *e; (e = readdir(dir));) {
    if (!strcmp(e->d_name, ".") || !strcmp(e->d_name, "..")) continue;
    if (n == cap) { xs = realloc(xs, (cap *= 2) * sizeof *xs); if (!xs) lab_oom(); }
    xs[n++] = lab__text_of(e->d_name, strlen(e->d_name));
  }
  closedir(dir);
  qsort(xs, n, sizeof *xs, lab__js_order);
  for (size_t k = 0; k < n; k++) xs[k] = lab__nfc(xs[k]);
  if (lab_log_open) { lab__log_answer(); lab__log_raw("["); for (size_t k = 0; k < n; k++) { if (k) lab__log_raw(","); lab__log_text(xs[k]); } lab__log_raw("]"); lab__log_close(); }
  lab_cell *acc = &${l.nil};
  for (size_t k = n; k-- > 0;) { ${l.cons} *c = lab_new(sizeof(${l.cons}), ${l.type}, ${l.tag}); c->f${l.head} = xs[k]; c->f${1 - l.head} = acc; acc = (lab_cell *)c; }
  free(xs);
  lab_drop(path);
  return acc;
}`,
  },
};

export const RT_C = new Set(Object.keys(FNS));
// What the world needs from POSIX, before any header.
export const POSIX = "#define _POSIX_C_SOURCE 200809L";
export const WORLD_H = "#include <errno.h>\n#include <sys/stat.h>\n#include <dirent.h>";
export const cName = (rt: string) => `lab_${rt.replace(/\./g, "_")}`;
// The C names the runtime defines besides `lab_` + a function's, which a
// program's own names must not take.
// Every `lab_` name the runtime's text defines or uses counts too (I214: a
// definition named `cell` took `lab_cell`, the runtime's cell type).
const LIST_SAMPLE: ListNames = { cons: "List_cons", nil: "List_nil", type: 0, tag: 0, head: 0 };
const words = (text: string) => [...text.matchAll(/\blab_([A-Za-z0-9_]+)/g)].map((m) => m[1]);
export const RESERVED = [...new Set(["int_dup", "int_drop", "int_dec", ...Object.keys(FNS).map((n) => n.replace(/\./g, "_")), ...words(BASE), ...Object.values(FNS).flatMap((f) => words(typeof f.c === "string" ? f.c : f.c(LIST_SAMPLE)))])];

// C's keywords and the names its headers declare, which a type's name
// (printed bare) must not take.
export const C_TAKEN = new Set(["auto", "break", "case", "char", "const", "continue", "default", "do", "double", "else", "enum", "extern", "float", "for", "goto", "if", "inline", "int", "long", "register", "restrict", "return", "short", "signed", "sizeof", "static", "struct", "switch", "typedef", "union", "unsigned", "void", "volatile", "while", "bool", "true", "false", "main", "exit", "abort", "malloc", "calloc", "realloc", "free", "printf", "fprintf", "sprintf", "snprintf", "puts", "putchar", "getchar", "strlen", "strcmp", "strcpy", "memcpy", "memset", "memmove", "memcmp", "qsort", "errno", "stdin", "stdout", "stderr", "FILE", "DIR", "size_t", "ssize_t", "int8_t", "int16_t", "int32_t", "int64_t", "uint8_t", "uint16_t", "uint32_t", "uint64_t", "intptr_t", "uintptr_t", "pthread_t", "sin", "cos", "tan", "exp", "log", "pow", "sqrt", "floor", "ceil", "round", "trunc", "fabs", "fmod", "atan2", "INFINITY", "NAN", "NULL", "assert", "time", "clock", "rand", "stat", "opendir", "readdir", "closedir", "isnan", "isinf"]);

// The C of the runtime functions `names` and what they call, in an order
// that defines each before its use. `list(fn)`: the names of the list type
// fn makes or reads.
export function runtimeC(names: Iterable<string>, list: (fn: string) => ListNames): string {
  const out: string[] = [], done = new Set<string>();
  const add = (n: string) => {
    if (done.has(n)) return;
    done.add(n);
    FNS[n].uses.forEach(add);
    const c = FNS[n].c;
    out.push(typeof c === "string" ? c : c(list(n)));
  };
  for (const n of names) add(n);
  return out.join("\n");
}
