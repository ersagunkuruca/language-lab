// The runtime of native programs' Ints and Texts (projectional/NATIVE.md,
// stage N4), in C: what wasm-rt.ts is to WebAssembly. The meaning is the
// evaluator's (projectional/src/lang/int.ts and text.ts), case by case.
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

export interface ListNames { cons: string; nil: string; type: number; tag: number; head: number }
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
static lab_int lab__int64(int64_t v) {
  if (v >= lab__min && v <= lab__max) return LAB_SMALL(v);
  uint64_t u = v < 0 ? (uint64_t)0 - (uint64_t)v : (uint64_t)v;
  uint32_t d[2] = { (uint32_t)u, (uint32_t)(u >> 32) };
  return lab__int(v < 0, d, 2);
}
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
// JavaScript's String(x) for a Float64 (ECMA-262 Float64::toString): the
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
  "int.add": { uses: [], c: `static lab_int lab_int_add(lab_int a, lab_int b) { if (LAB_IS_SMALL(a) && LAB_IS_SMALL(b)) return lab__int64(LAB_VAL(a) + LAB_VAL(b)); return lab__addsub(a, b, 0); }` },
  "int.sub": { uses: [], c: `static lab_int lab_int_sub(lab_int a, lab_int b) { if (LAB_IS_SMALL(a) && LAB_IS_SMALL(b)) return lab__int64(LAB_VAL(a) - LAB_VAL(b)); return lab__addsub(a, b, 1); }` },
  "int.neg": { uses: [], c: `static lab_int lab_int_neg(lab_int a) { if (LAB_IS_SMALL(a)) return lab__int64(-LAB_VAL(a)); return lab__addsub(LAB_SMALL(0), a, 1); }` },
  "int.abs": { uses: ["int.neg"], c: `static lab_int lab_int_abs(lab_int a) { return (LAB_IS_SMALL(a) ? LAB_VAL(a) < 0 : LAB_BIG(a)->neg) ? lab_int_neg(a) : a; }` },
  "int.mul": {
    uses: [],
    c: `static lab_int lab_int_mul(lab_int x, lab_int y) {
  if (LAB_IS_SMALL(x) && LAB_IS_SMALL(y)) {
    int64_t a = LAB_VAL(x), b = LAB_VAL(y);
    if (a > -2147483648LL && a < 2147483648LL && b > -2147483648LL && b < 2147483648LL) return lab__int64(a * b);
  }
  lab__mag a, b;
  lab__mag_of(x, &a); lab__mag_of(y, &b);
  uint32_t *r = lab__limbs(a.n + b.n);
  lab__mul(r, a.d, a.n, b.d, b.n);
  lab_int out = lab__int(a.neg != b.neg, r, a.n + b.n);
  free(r);
  lab_int_drop(x); lab_int_drop(y);
  return out;
}` },
  "int.less": {
    uses: [],
    c: `static int32_t lab_int_less(lab_int x, lab_int y) {
  if (LAB_IS_SMALL(x) && LAB_IS_SMALL(y)) return LAB_VAL(x) < LAB_VAL(y);
  lab__mag a, b;
  lab__mag_of(x, &a); lab__mag_of(y, &b);
  int r = a.neg != b.neg ? a.neg : a.neg ? lab__cmp(b.d, b.n, a.d, a.n) < 0 : lab__cmp(a.d, a.n, b.d, b.n) < 0;
  lab_int_drop(x); lab_int_drop(y);
  return r;
}` },
  "int.equal": {
    uses: [],
    c: `static int32_t lab_int_equal(lab_int x, lab_int y) {
  if (LAB_IS_SMALL(x) || LAB_IS_SMALL(y)) { int r = x == y; lab_int_drop(x); lab_int_drop(y); return r; }
  lab_big *a = LAB_BIG(x), *b = LAB_BIG(y);
  int r = a->neg == b->neg && lab__cmp(a->d, a->n, b->d, b->n) == 0;
  lab_int_drop(x); lab_int_drop(y);
  return r;
}` },
  // The greatest common divisor, at least 0 (gcd(0, 0) is 0): Euclid's
  // algorithm (textbook), on int64s once both are small. For std.ts's
  // lowest terms, which the lowering writes with this and int.exact.
  "int.gcd": { uses: ["int.abs"], c: `static lab_int lab_int_gcd(lab_int x, lab_int y) { x = lab_int_abs(x); y = lab_int_abs(y); while (y != LAB_SMALL(0)) { if (LAB_IS_SMALL(x) && LAB_IS_SMALL(y)) { int64_t a = LAB_VAL(x), b = LAB_VAL(y); while (b) { int64_t t = a % b; a = b; b = t; } return LAB_SMALL(a); } lab_int r; lab__floordiv(x, y, 0, &r); lab_int_drop(x); x = y; y = r; } return x; }` },
  // x over g, g at least 0 and dividing x (int.gcd's); 0 when g is 0.
  "int.exact": { uses: [], c: `static lab_int lab_int_exact(lab_int x, lab_int g) { lab_int q; if (g == LAB_SMALL(0)) { lab_int_drop(x); return LAB_SMALL(0); } lab__floordiv(x, g, &q, 0); lab_int_drop(x); lab_int_drop(g); return q; }` },
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
    // A whole Float64 as it is, any other rounded to 9 places
    // (Math.round(x · 1e9) / 1e9: the nearest whole number, halves up).
    c: `static lab_cell *lab_number_show(double x) {
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
  // POSIX, failing as Node's world (projectional/src/lang/world.ts) does:
  // with its words for a reason, and status 2.
  "world.fail": {
    uses: [],
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
  lab_drop(path);
  lab_st = 2;
}
// A Text as a C string, for the C library's paths.
static char *lab__cstr(lab_cell *t) { char *s = malloc((size_t)LAB_TN(t) + 1); if (!s) lab_oom(); memcpy(s, LAB_TB(t), LAB_TN(t)); s[LAB_TN(t)] = 0; return s; }
// 0 nothing there, 1 a file (or anything but a folder), 2 a folder.
static int lab__kind(const char *p) { struct stat st; return stat(p, &st) ? 0 : S_ISDIR(st.st_mode) ? 2 : 1; }`,
  },
  "world.print": { uses: [], c: `static void lab_world_print(lab_cell *t) { fwrite(LAB_TB(t), 1, LAB_TN(t), stdout); putchar('\\n'); lab_drop(t); }` },
  "world.printError": { uses: [], c: `static void lab_world_printError(lab_cell *t) { fflush(stdout); fwrite(LAB_TB(t), 1, LAB_TN(t), stderr); fputc('\\n', stderr); lab_drop(t); }` },
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
  "world.readInput": { uses: ["world.readAll"], c: `static lab_cell *lab_world_readInput(void) { return lab__read_all(stdin); }` },
  // A line without its end (\n, or \r\n); none at the end of the input.
  "world.readLine": {
    uses: [],
    c: (o) => `static lab_cell *lab_world_readLine(void) {
  int c = getchar();
  if (c == EOF) return &${o.nil};
  size_t n = 0, cap = 128;
  char *s = malloc(cap);
  if (!s) lab_oom();
  for (; c != EOF && c != '\\n'; c = getchar()) { if (n == cap) { s = realloc(s, cap *= 2); if (!s) lab_oom(); } s[n++] = (char)c; }
  if (n && s[n - 1] == '\\r') n--;
  ${o.cons} *r = lab_new(sizeof(${o.cons}), ${o.type}, ${o.tag});
  r->f${o.head} = lab__text_of(s, n);
  free(s);
  return (lab_cell *)r;
}`,
  },
  "world.readFile": {
    uses: ["world.fail", "world.readAll"],
    c: `static lab_cell *lab_world_readFile(lab_cell *path) {
  char *p = lab__cstr(path);
  FILE *f = lab__kind(p) == 2 ? (errno = EISDIR, (FILE *)0) : fopen(p, "rb");
  free(p);
  if (!f) { lab__fail(errno, path); return 0; }
  lab_cell *t = lab__read_all(f);
  fclose(f);
  lab_drop(path);
  return t;
}`,
  },
  "world.put": {
    uses: ["world.fail"],
    c: `static void lab__put(lab_cell *path, lab_cell *t, const char *mode) {
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
  "world.fileExists": { uses: ["world.fail"], c: `static int32_t lab_world_fileExists(lab_cell *path) { char *p = lab__cstr(path); int r = lab__kind(p) != 0; free(p); lab_drop(path); return r; }` },
  // A folder's names, sorted as JavaScript sorts texts: by UTF-16 units,
  // so a character past U+FFFF comes before U+E000 to U+FFFF.
  "world.listFolder": {
    uses: ["world.fail"],
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
export const RESERVED = ["int_dup", "int_drop", "int_dec", ...Object.keys(FNS).map((n) => n.replace(/\./g, "_"))];

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
