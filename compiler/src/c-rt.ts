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
// code points' order, so `less` compares bytes. A long slice is a view
// (I222): its bytes are another text's (\`base\`, counted), from p for n,
// so taking the rest of a text is constant time, not a copy; a short one
// is copied, so a few characters don't keep a long text alive. Each text
// knows how many characters it has once counted (\`chars\`, LAB_UNCOUNTED
// till then), so the length of each rest isn't counted again.
//
// The world (N4b) is the console and files over the C library and POSIX,
// failing with Node's world's words and status 2.
//
// Every function owns its inputs, as the program's own do, and drops them.
// One with no answer (Choice) sets lab_st to 1 and gives a stand-in.

import { nfcC } from "./c-nfc.ts";
export interface ListNames { cons: string; nil: string; type: number; tag: number; head: number; record?: string; info?: InfoNames; raw?: boolean }
// File info's C names (C310): its struct, its Instant's, File kind's four
// cases' cells (plain file, folder, link, special), and its size's type.
export interface InfoNames { record: string; instant: string; kinds: string[]; size: "int" | "i64" }
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
typedef struct { lab_cell h; uint32_t n, chars; uint8_t *p; lab_cell *base; uint8_t b[]; } lab_text;
#define LAB_UNCOUNTED 0xFFFFFFFFu
// A slice this long or longer is a view on its text's bytes.
#define LAB_VIEW 64
#define LAB_SMALL(v) ((lab_int)(((uint64_t)(int64_t)(v) << 1) | 1u))
#define LAB_IS_SMALL(x) (((x) & 1) != 0)
#define LAB_VAL(x) ((int64_t)(x) >> 1)
#define LAB_BIG(x) ((lab_big *)(intptr_t)(x))
#define LAB_TB(t) (((lab_text *)(t))->p)
#define LAB_TN(t) (((lab_text *)(t))->n)
static const int64_t lab__max = ((int64_t)1 << 62) - 1, lab__min = -((int64_t)1 << 62);
static inline lab_int lab_int_dup(lab_int x) { if (!LAB_IS_SMALL(x)) lab_dup((lab_cell *)LAB_BIG(x)); return x; }
static inline void lab_int_drop(lab_int x) { if (!LAB_IS_SMALL(x)) lab_drop((lab_cell *)LAB_BIG(x)); }
static inline void lab_int_dec(lab_int x) { if (!LAB_IS_SMALL(x)) lab_dec((lab_cell *)LAB_BIG(x)); }
static lab_cell *lab__text(size_t n) {
  lab_text *t = lab_new(sizeof(lab_text) + (n ? n : 1), LAB_TEXT_T, 0);
  t->n = (uint32_t)n; t->chars = n ? LAB_UNCOUNTED : 0; t->p = t->b; t->base = 0;
  return (lab_cell *)t;
}
// Its characters, counted once (texts don't change, so every thread that
// counts finds the same number).
static uint32_t lab__chars(lab_cell *c) {
  lab_text *t = (lab_text *)c;
  uint32_t k = __atomic_load_n(&t->chars, __ATOMIC_RELAXED);
  if (k != LAB_UNCOUNTED) return k;
  k = 0;
  for (uint32_t i = 0; i < t->n; i++) k += (t->p[i] & 0xC0) != 0x80;
  if (t->h.rc) __atomic_store_n(&t->chars, k, __ATOMIC_RELAXED);
  return k;
}
// Bytes i up to j of t (taking t): a view when long, a copy when short.
static lab_cell *lab__part(lab_cell *t, uint32_t i, uint32_t j, uint32_t chars) {
  lab_text *s = (lab_text *)t, *r;
  if (j - i < LAB_VIEW || !s->h.rc) {
    r = (lab_text *)lab__text(j - i);
    memcpy(r->p, s->p + i, j - i);
    lab_drop(t);
  } else {
    r = lab_new(sizeof(lab_text), LAB_TEXT_T, 0);
    r->n = j - i; r->p = s->p + i;
    // A view's base is a text with bytes of its own.
    if (s->base) { r->base = lab_dup(s->base); lab_drop(t); } else r->base = t;
  }
  r->chars = chars;
  return (lab_cell *)r;
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
  if (k <= 0) return 0;
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
  // Two small ones divided where they're used (C337): pack's codes and
  // checksums by a literal took a call each, 14% of its instructions; cc
  // turns a division by a literal into a multiply there.
  "int.quotient": { uses: [], c: `static lab_int lab__int_quotient(lab_int x, lab_int y);
static LAB_INLINE lab_int lab_int_quotient(lab_int x, lab_int y) {
  if (LAB_IS_SMALL(x) && LAB_IS_SMALL(y) && y != LAB_SMALL(0) && y != LAB_SMALL(-1)) { int64_t a = LAB_VAL(x), b = LAB_VAL(y), d = a / b, m = a % b; if (m != 0 && (m < 0) != (b < 0)) d--; return LAB_SMALL(d); }
  return lab__int_quotient(x, y);
}
static lab_int lab__int_quotient(lab_int x, lab_int y) { lab_int q; if (y == LAB_SMALL(0)) { lab_int_drop(x); lab_st = 1; return LAB_SMALL(0); } lab__floordiv(x, y, &q, 0); lab_int_drop(x); lab_int_drop(y); return q; }` },
  "int.remainder": { uses: [], c: `static lab_int lab__int_remainder(lab_int x, lab_int y);
static LAB_INLINE lab_int lab_int_remainder(lab_int x, lab_int y) {
  if (LAB_IS_SMALL(x) && LAB_IS_SMALL(y) && y != LAB_SMALL(0)) { int64_t a = LAB_VAL(x), b = LAB_VAL(y), m = a % b; if (m != 0 && (m < 0) != (b < 0)) m += b; return LAB_SMALL(m); }
  return lab__int_remainder(x, y);
}
static lab_int lab__int_remainder(lab_int x, lab_int y) { lab_int r; if (y == LAB_SMALL(0)) { lab_int_drop(x); lab_st = 1; return LAB_SMALL(0); } lab__floordiv(x, y, 0, &r); lab_int_drop(x); lab_int_drop(y); return r; }` },
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
    // A long one goes in bytes with as much room again on the shorter
    // side's end, kept by a fill: the base of the views on them, which
    // knows where the used bytes start and end. A later a ++ b writes into
    // that room instead of copying (claiming it with one atomic step, as
    // two threads may hold a): b after a when a ends where the used bytes
    // end, a before b when b starts where they start. No text sees the
    // bytes outside them, so each keeps its bytes, and a text built a
    // piece at a time copies each byte a few times, not once for every
    // piece after it (I222).
    c: `typedef struct { lab_cell h; uint32_t n, chars; uint8_t *p; lab_cell *base; uint32_t lo, hi; } lab__fill;
#define LAB_FILL 0xFFFFFFFEu
static lab__fill *lab__fill_of(lab_text *t) { return t->base && ((lab_text *)t->base)->chars == LAB_FILL ? (lab__fill *)t->base : 0; }
static lab_cell *lab__view_on(lab__fill *f, uint32_t at, uint32_t n, uint32_t chars) {
  lab_text *r = lab_new(sizeof(lab_text), LAB_TEXT_T, 0);
  r->n = n; r->chars = chars; r->p = f->p + at; r->base = (lab_cell *)f;
  return (lab_cell *)r;
}
static lab_cell *lab_text_concat(lab_cell *a, lab_cell *b) {
  if (!LAB_TN(a)) { lab_drop(a); return b; }
  if (!LAB_TN(b)) { lab_drop(b); return a; }
  lab_text *x = (lab_text *)a, *y = (lab_text *)b;
  uint32_t n = x->n + y->n, chars = x->chars != LAB_UNCOUNTED && y->chars != LAB_UNCOUNTED ? x->chars + y->chars : LAB_UNCOUNTED, at, e;
  lab__fill *f;
  lab_cell *t;
  if (n < LAB_VIEW) {
    t = lab__text(n);
    memcpy(LAB_TB(t), x->p, x->n); memcpy(LAB_TB(t) + x->n, y->p, y->n);
    ((lab_text *)t)->chars = chars;
  } else if ((f = lab__fill_of(x)) && (e = at = (uint32_t)(x->p - f->p) + x->n) && y->n <= f->n - at && __atomic_compare_exchange_n(&f->hi, &e, at + y->n, 0, __ATOMIC_RELAXED, __ATOMIC_RELAXED)) {
    memcpy(f->p + at, y->p, y->n);
    t = lab__view_on((lab__fill *)lab_dup((lab_cell *)f), (uint32_t)(x->p - f->p), n, chars);
  } else if ((f = lab__fill_of(y)) && (e = at = (uint32_t)(y->p - f->p)) >= x->n && __atomic_compare_exchange_n(&f->lo, &e, at - x->n, 0, __ATOMIC_RELAXED, __ATOMIC_RELAXED)) {
    memcpy(f->p + at - x->n, x->p, x->n);
    t = lab__view_on((lab__fill *)lab_dup((lab_cell *)f), at - x->n, n, chars);
  } else {
    size_t cap = 2 * (size_t)n;
    f = lab_new(sizeof(lab__fill) + cap, LAB_TEXT_T, 0);
    at = x->n < y->n ? (uint32_t)(cap - n) : 0;
    f->n = (uint32_t)cap; f->chars = LAB_FILL; f->p = (uint8_t *)(f + 1); f->base = 0; f->lo = at; f->hi = at + n;
    memcpy(f->p + at, x->p, x->n); memcpy(f->p + at + x->n, y->p, y->n);
    t = lab__view_on(f, at, n, chars);
  }
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
  "text.length": { uses: [], c: `static lab_int lab_text_length(lab_cell *t) { int64_t k = lab__chars(t); lab_drop(t); return LAB_SMALL(k); }` },
  "text.size": { uses: [], c: `static int32_t lab_text_size(lab_cell *t) { int32_t n = (int32_t)LAB_TN(t); lab_drop(t); return n; }` },
  "text.after": { uses: [], c: `static int32_t lab_text_after(lab_cell *t, int32_t i) { const uint8_t *b = LAB_TB(t); uint32_t n = LAB_TN(t); do i++; while ((uint32_t)i < n && (b[i] & 0xc0) == 0x80); lab_drop(t); return i; }` },
  "text.before": { uses: [], c: `static int32_t lab_text_before(lab_cell *t, int32_t i) { int32_t r = (int32_t)lab__back(LAB_TB(t), (uint32_t)i); lab_drop(t); return r; }` },
  "text.bytes": { uses: [], c: `static lab_cell *lab_text_bytes(lab_cell *t, int32_t a, int32_t b) { return lab__part(t, (uint32_t)a, (uint32_t)b, LAB_UNCOUNTED); }` },
  // Characters from up to, not including, to, clamped: it never fails.
  "text.slice": {
    uses: [],
    c: `static lab_cell *lab_text_slice(lab_cell *t, lab_int from, lab_int to) {
  int64_t a = lab__clamp(from), b = lab__clamp(to);
  lab_int_drop(from); lab_int_drop(to);
  if (a < 0) a = 0;
  if (b <= a) { lab_drop(t); return lab__text(0); }
  // Known in characters, the ends are found without walking the text
  // where they can be: past its end, or every character a byte.
  uint32_t n = LAB_TN(t), k = ((lab_text *)t)->chars;
  if (k != LAB_UNCOUNTED && a >= k) { lab_drop(t); return lab__text(0); }
  uint32_t i = k == n ? (uint32_t)a : lab__at(LAB_TB(t), n, a);
  uint32_t j = k != LAB_UNCOUNTED && b >= k ? n : k == n ? (uint32_t)b : i + lab__at(LAB_TB(t) + i, n - i, b - a);
  if (i == 0 && j == n) return t;
  return lab__part(t, i, j, j < n ? (uint32_t)(b - a) : k == LAB_UNCOUNTED ? LAB_UNCOUNTED : k - (uint32_t)a);
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
  // What the world asks of the system (C296). Paths, names and values are
  // UTF-8 in the program; on Windows they go through the wide (UTF-16)
  // calls, converted here, since a narrow call reads the code page's
  // bytes. Windows' own functions are declared here, not by windows.h,
  // whose macros and type names a program's own names could meet.
  "world.os": {
    uses: [],
    c: `#ifdef _WIN32
#include <wchar.h>
__declspec(dllimport) int __stdcall MultiByteToWideChar(unsigned, unsigned long, const char *, int, wchar_t *, int);
__declspec(dllimport) int __stdcall WideCharToMultiByte(unsigned, unsigned long, const wchar_t *, int, char *, int, const char *, int *);
__declspec(dllimport) unsigned long __stdcall GetLastError(void);
static wchar_t *lab__wide(const char *s) {
  int n = MultiByteToWideChar(65001, 0, s, -1, 0, 0);
  wchar_t *w = malloc((size_t)(n > 0 ? n : 1) * sizeof *w);
  if (!w) lab_oom();
  if (n > 0) MultiByteToWideChar(65001, 0, s, -1, w, n); else w[0] = 0;
  return w;
}
static char *lab__narrow(const wchar_t *w) {
  int n = WideCharToMultiByte(65001, 0, w, -1, 0, 0, 0, 0);
  char *s = malloc(n > 0 ? (size_t)n : 1);
  if (!s) lab_oom();
  if (n > 0) WideCharToMultiByte(65001, 0, w, -1, s, n, 0, 0); else s[0] = 0;
  return s;
}
static FILE *lab__fopen(const char *p, const char *m) {
  wchar_t *w = lab__wide(p), wm[4] = { 0 };
  for (int i = 0; i < 3 && m[i]; i++) wm[i] = (wchar_t)m[i];
  FILE *f = _wfopen(w, wm);
  free(w);
  return f;
}
// An environment variable's value, UTF-8, kept until the next call.
static const char *lab__getenv(const char *n) {
  static char *v;
  wchar_t *w = lab__wide(n);
  const wchar_t *x = _wgetenv(w);
  free(w); free(v); v = x ? lab__narrow(x) : 0;
  return v;
}
// 0 nothing there, 1 a file (or anything but a folder), 2 a folder.
static int lab__kind(const char *p) { wchar_t *w = lab__wide(p); struct _stat64 st; int bad = _wstat64(w, &st); free(w); return bad ? 0 : (st.st_mode & _S_IFDIR) ? 2 : 1; }
// A Windows error as errno, as libuv maps the ones a path gives.
static int lab__errno(unsigned long e) { return e == 2 || e == 3 || e == 123 || e == 161 ? ENOENT : e == 5 || e == 32 ? EACCES : e == 267 ? ENOTDIR : EIO; }
#else
#define lab__getenv getenv
#if defined(__ANDROID__) || defined(LAB_TREE)
// A folder the person picked (L284, C313): once they have, a path that
// isn't absolute is in it, opened, told of and listed by the app's Java
// over JNI (MainActivity treeOpen, treeKind, treeList), its files the
// page's from then on, as a browser's picked folder is. (LAB_TREE alone:
// the same off Android, for a test.)
#ifndef LAB_TREE
#define LAB_TREE 1
#endif
#include <unistd.h>
#include <fcntl.h>
static int lab_tree_on;
// An open file's descriptor (fopen's modes), or -1.
static int (*lab_tree_open)(const char *p, const char *mode);
// 0 nothing there, 1 a file, 2 a folder; a file's size and when it
// changed, in ms since 1970.
static int (*lab_tree_kind)(const char *p, int64_t *size, double *modified);
// A folder's names, n of them, each and all malloc'd; 0 when it isn't one.
static char **(*lab_tree_list)(const char *p, size_t *n);
static int lab__in_tree(const char *p) { return lab_tree_on && p[0] != '/'; }
static FILE *lab__fopen(const char *p, const char *m) {
  if (!lab__in_tree(p)) return fopen(p, m);
  int64_t n; double t;
  int k = lab_tree_kind(p, &n, &t);
  if (k == 2) { errno = EISDIR; return 0; }
  int fd = lab_tree_open(p, m);
  if (fd < 0) { errno = k ? EACCES : ENOENT; return 0; }
  if (m[0] == 'a') fcntl(fd, F_SETFL, fcntl(fd, F_GETFL) | O_APPEND);
  FILE *f = fdopen(fd, m);
  if (!f) close(fd);
  return f;
}
static int lab__kind(const char *p) {
  if (lab__in_tree(p)) { int64_t n; double t; int k = lab_tree_kind(p, &n, &t); if (!k) errno = ENOENT; return k; }
  struct stat st; return stat(p, &st) ? 0 : S_ISDIR(st.st_mode) ? 2 : 1;
}
#else
#define lab__fopen fopen
static int lab__kind(const char *p) { struct stat st; return stat(p, &st) ? 0 : S_ISDIR(st.st_mode) ? 2 : 1; }
#endif
#endif`,
  },
  "world.log": {
    uses: ["world.os"],
    c: `static FILE *lab_log;
static int lab_log_state, lab_log_n, lab_log_open;
// A page's views reading the clock outside a handler (lab_log_quiet): not
// logged, as a browser page's aren't (worldlog.ts, I265). A run of frames
// one element heard in a row, kept open to add each frame's seconds to
// (lab_frames_at: its path and what it was given, I239a).
static int lab_log_quiet, lab_frames_open;
static char *lab_frames_at;
static void lab__frames_end(void) { if (lab_frames_open) { fputs("]}", lab_log); lab_frames_open = 0; } }
static void lab__log_end(void) { if (lab_log) { lab__frames_end(); fputs("]\\n", lab_log); fclose(lab_log); lab_log = 0; } }
static int lab__log_on(void) {
  if (!lab_log_state) {
    lab_log_state = 1;
    const char *to = lab__getenv("TERS_LOG");
    if (to && *to && (lab_log = lab__fopen(to, "wb"))) { fputc('[', lab_log); atexit(lab__log_end); }
  }
  return lab_log != 0;
}
// The log as a whole file now, for an app that may be stopped from here
// on without exiting (a phone's app, left: L280d): the brackets that close
// it written, then written over by what comes next.
static void lab__log_mark(void) {
  if (!lab_log) return;
  lab__frames_end();
  fputc(']', lab_log); fflush(lab_log); fseek(lab_log, -1, SEEK_CUR);
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
  lab__frames_end();
  fprintf(lab_log, "%s{\\"op\\":\\"%s\\",\\"args\\":[", lab_log_n++ ? "," : "", op);
  lab_log_open = 1;
  return 1;
}
// After the arguments: what came back is written next, then lab__log_close.
static void lab__log_answer(void) { lab__log_raw("],\\"answer\\":"); }
static void lab__log_close(void) { lab__log_raw("}"); lab_log_open = 0; }
static void lab__log_write(void) { lab__log_raw("],\\"write\\":true}"); lab_log_open = 0; }
// A page's event (C172e, worldlog.ts heardInto): its handler's event's
// name, what it was given, and where its element is under the page's root
// (html.ts pathOf), so \`ters decisions --measure --replay\` can give the
// evaluator an app's run (L280d). A frame after one the same element heard
// with the same givens adds its seconds to that entry.
static void lab__log_event(const char *name, size_t nn, const char *value, size_t vn, const char *key, size_t kn, double x, double y, double seconds, const int *path, int np, int held) {
  if (!lab__log_on()) return;
  size_t cap = 64 + 12 * (size_t)np + 2 * (vn + kn);
  char *at = malloc(cap);
  if (!at) lab_oom();
  int w = 0;
  at[w++] = '[';
  for (int i = 0; i < np; i++) w += sprintf(at + w, "%s%d", i ? "," : "", path[i]);
  at[w++] = ']';
  int frame = nn == 5 && !memcmp(name, "frame", 5);
  if (frame) {
    // The givens after the path, to tell two runs of frames apart.
    w += sprintf(at + w, "|%.17g|%.17g|", x, y);
    memcpy(at + w, value, vn); w += (int)vn; at[w++] = '|'; memcpy(at + w, key, kn); w += (int)kn;
    at[w] = 0;
    if (lab_frames_open && lab_frames_at && !strcmp(lab_frames_at, at)) { fprintf(lab_log, ",%.17g", seconds); free(at); return; }
    lab__frames_end();
    free(lab_frames_at); lab_frames_at = at;
    fprintf(lab_log, "%s{\\"op\\":\\"frames\\",\\"args\\":[[", lab_log_n++ ? "," : "");
    for (int i = 0; i < np; i++) fprintf(lab_log, "%s%d", i ? "," : "", path[i]);
    lab__log_raw("],"); lab__log_str((const uint8_t *)value, vn); lab__log_raw(","); lab__log_str((const uint8_t *)key, kn);
    fprintf(lab_log, ",%.17g,%.17g],\\"seconds\\":[%.17g", x, y, seconds);
    lab_frames_open = 1;
    return;
  }
  free(at);
  lab__log_begin("event");
  lab__log_str((const uint8_t *)name, nn); lab__log_raw(","); lab__log_str((const uint8_t *)value, vn); lab__log_raw(","); lab__log_str((const uint8_t *)key, kn);
  fprintf(lab_log, ",%.17g,%.17g,%.17g,[", x, y, seconds);
  for (int i = 0; i < np; i++) fprintf(lab_log, "%s%d", i ? "," : "", path[i]);
  lab__log_raw("]");
  if (held) fprintf(lab_log, ",%d", held);
  lab__log_raw("]}"); lab_log_open = 0;
}`,
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
// The page's files (L284): on a desktop, once the person picked a folder
// (C318), a path that isn't absolute is in it (ters_page_files); the
// app's own folder keeps what the page keeps.
#define LAB_FILES_AT 1
static char *lab_files_at;
static char *lab__path(lab_cell *t) {
  char *s = lab__cstr(t);
  if (!lab_files_at || s[0] == '/' || s[0] == 92 || (s[0] && s[1] == ':')) return s;
  size_t a = strlen(lab_files_at), b = strlen(s);
  char *r = malloc(a + b + 2);
  if (!r) lab_oom();
  memcpy(r, lab_files_at, a); r[a] = '/'; memcpy(r + a + 1, s, b + 1);
  free(s);
  return r;
}`,
  },
  // A formula kept (C300): its number, whether what it gave still holds
  // (no cell it read written since: the page's write epochs, c.ts
  // READS_C), and its reads noted while it runs, then told to whatever
  // reads it. Outside a page nothing notes writes, so it always runs.
  "formula.new": { uses: ["formula.kept"], c: "static int32_t lab_formula_new(void) { if (lab_nkp == lab_ckp) { lab_ckp = lab_ckp ? 2 * lab_ckp : 16; lab_kp = realloc(lab_kp, sizeof *lab_kp * (size_t)lab_ckp); if (!lab_kp) lab_oom(); } lab_kp[lab_nkp] = (lab_kept){ 0, 0, 0, 0 }; return lab_nkp++; }" },
  "formula.fresh": { uses: ["formula.kept"], c: `static int32_t lab_formula_fresh(int32_t id) {
#ifdef LAB_KEEP_FORMULAS
  lab_kept *k = &lab_kp[id];
  if (!k->ok) return 0;
  for (int j = 0; j < k->nrd; j++) if (lab__eget(k->rd[j]) > k->at) return 0;
  for (int j = 0; j < k->nrd; j++) lab_touch(k->rd[j]);
  return 1;
#else
  (void)id; return 0;
#endif
}` },
  "formula.begin": { uses: ["formula.kept"], c: `static int32_t lab_formula_begin(int32_t id) {
#ifdef LAB_KEEP_FORMULAS
  if (lab_nks == lab_cks) { lab_cks = lab_cks ? 2 * lab_cks : 8; lab_ks = realloc(lab_ks, sizeof *lab_ks * (size_t)lab_cks); if (!lab_ks) lab_oom(); }
  lab_ks[lab_nks++] = (lab_rdsave){ lab_rd, lab_nrd, lab_crd, lab_rding };
  lab_rd = 0; lab_nrd = lab_crd = 0; lab_rding = 1;
  lab_kp[id].ok = 0;
  lab_kp[id].at = lab_epoch;
#else
  (void)id;
#endif
  return 0;
}` },
  "formula.end": { uses: ["formula.kept"], c: `static int32_t lab_formula_end(int32_t id) {
#ifdef LAB_KEEP_FORMULAS
  lab_kept *k = &lab_kp[id];
  free(k->rd); k->rd = lab_rd; k->nrd = lab_nrd; k->ok = 1;
  lab_rdsave o = lab_ks[--lab_nks];
  lab_rd = o.rd; lab_nrd = o.nrd; lab_crd = o.crd; lab_rding = o.rding;
  for (int j = 0; j < k->nrd; j++) lab_touch(k->rd[j]);
#else
  (void)id;
#endif
  return 0;
}` },
  "formula.kept": { uses: [], c: `typedef struct { void **rd; int nrd, ok; uint64_t at; } lab_kept;
static lab_kept *lab_kp;
static int lab_nkp, lab_ckp;
#ifdef LAB_KEEP_FORMULAS
typedef struct { void **rd; int nrd, crd, rding; } lab_rdsave;
static lab_rdsave *lab_ks;
static int lab_nks, lab_cks;
#endif` },
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
  if (!lab_log_quiet && lab__log_begin("now")) { lab__log_answer(); fprintf(lab_log, "%.17g", ms); lab__log_close(); }
  return ms;
}` },
  // The platform's sound latency in seconds (`my sound latency`, C260b):
  // 0 on a command line, as a browser's where the platform reports none;
  // a native app's screen sets it once a sound plays
  // (ters_page_sound_latency).
  "world.mySoundLatency": { uses: [], c: `static double lab_sound_latency;
// A page notes it read like a cell's (c.ts READS_C), so what read it runs
// again when the screen measures it.
static double lab_world_mySoundLatency(void) {
#ifdef LAB_KEEP_FORMULAS
  lab_touch(&lab_sound_latency);
#endif
  return lab_sound_latency;
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
  // Asking for a permission (L236): a command line answers yes; a native
  // page's runtime sets lab_ask to ask the person (c.ts, L236b), which
  // may park the handler that asked until they answer.
  // The screen's asker (L236b): 1 yes, 0 no; and the file the person
  // chose for an ask's yes (ters_page_chosen, L271c), malloc'd.
  "world.ask": { uses: [], c: `#define LAB_ASKS 1
static int (*lab_ask)(const char *what, size_t n);
static char *lab_chosen;` },
  "world.askPermission": { uses: ["world.ask"], c: `static int32_t lab_world_askPermission(lab_cell *t) { int r = lab_ask ? lab_ask((const char *)LAB_TB(t), LAB_TN(t)) : 1; lab_drop(t); return r; }` },
  "world.print": { uses: [], c: `static void lab_world_print(lab_cell *t) { fwrite(LAB_TB(t), 1, LAB_TN(t), stdout); putchar('\\n'); lab_drop(t); }` },
  // A seed from the world for Random's generator (C136): four bytes of
  // /dev/urandom, or the time and an address where there is none.
  // The seed is an answer L186's log keeps (C172c), so a replay draws
  // the same numbers from it.
  "world.randomSeed": { uses: ["world.log"], c: `#include <time.h>
#ifdef _WIN32
// RtlGenRandom, the system's random bytes (advapi32).
__declspec(dllimport) unsigned char __stdcall SystemFunction036(void *, unsigned long);
#endif
static double lab_world_randomSeed(void) {
  uint32_t s = 0;
#ifdef _WIN32
  if (!SystemFunction036(&s, sizeof s)) s = 0;
#else
  FILE *f = fopen("/dev/urandom", "rb");
  if (f) { if (fread(&s, sizeof s, 1, f) != 1) s = 0; fclose(f); }
#endif
  if (!s) s = (uint32_t)time(NULL) ^ (uint32_t)clock() ^ (uint32_t)(uintptr_t)&s;
  if (lab__log_begin("randomSeed")) { lab__log_answer(); fprintf(lab_log, "%u", (unsigned)s); lab__log_close(); }
  return (double)s;
}` },
  // The files `with open file` keeps open (L213c5), as Node's world keeps
  // them (ters/src/lang/world.ts): opened for reading from the start and
  // adding at the end, read through a buffer that a line or bytes take
  // from, the reading ended for good once it finds the end. A file's
  // number is its place here, from 1; only the library sees it.
  "world.kept": { uses: ["world.os"], c: `#include <fcntl.h>
#include <unistd.h>
#ifdef _WIN32
#include <io.h>
// Opened by its wide name, unchanged bytes (no \\r added before \\n).
static int lab__open(const char *p) { wchar_t *w = lab__wide(p); int fd = _wopen(w, _O_RDWR | _O_CREAT | _O_APPEND | _O_BINARY, _S_IREAD | _S_IWRITE); free(w); return fd; }
static ssize_t lab__pread(int fd, void *b, size_t n, int64_t at) { return _lseeki64(fd, at, SEEK_SET) < 0 ? -1 : _read(fd, b, (unsigned)n); }
#elif defined(LAB_TREE)
// In a picked folder (C313), read and written, writes at its end.
static int lab__open(const char *p) {
  if (!lab__in_tree(p)) return open(p, O_RDWR | O_CREAT | O_APPEND, 0666);
  int fd = lab_tree_open(p, "a+");
  if (fd >= 0) fcntl(fd, F_SETFL, fcntl(fd, F_GETFL) | O_APPEND);
  return fd;
}
#define lab__pread pread
#else
static int lab__open(const char *p) { return open(p, O_RDWR | O_CREAT | O_APPEND, 0666); }
#define lab__pread pread
#endif
typedef struct { int fd; int64_t at; uint8_t *rest; size_t n; int ended; } lab_kept_file;
static lab_kept_file lab_kept[1024];
static int lab_kept_n;
static lab_kept_file *lab__kept(lab_int f) { int64_t i = LAB_IS_SMALL(f) ? LAB_VAL(f) : 0; return i >= 1 && i <= lab_kept_n && lab_kept[i - 1].fd >= 0 ? &lab_kept[i - 1] : 0; }
static void lab__kept_more(lab_kept_file *k) {
  uint8_t piece[1 << 16];
  ssize_t n = lab__pread(k->fd, piece, sizeof piece, k->at);
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
  char *p = lab__path(path);
  lab_drop(path);
  int fd = lab_kept_n < 1024 ? lab__open(p) : -1;
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
  // A file's bytes as they are (C350, as C321 in JavaScript and C345 on
  // WASI), with o.raw: a Bytes's list is then a cell of the bytes
  // (lab_bytes, c.ts), and the list is made from them the first time
  // something reads it (lab__bytes_list, once; a list is itself). A file's
  // 47 MB were 47 million list cells.
  "world.rawBytes": {
    uses: [],
    c: (o) => !o.raw ? "" : `static lab_cell *lab__bytes_raw(const uint8_t *s, size_t n) {
  if (n > UINT32_MAX) lab_oom();
  lab_bytes *y = lab_new(sizeof(lab_bytes) + (n ? n : 1), LAB_BYTES_T, 0);
  y->list = 0; y->n = (uint32_t)n;
  if (n) memcpy(y->b, s, n);
  return (lab_cell *)y;
}
static lab_cell *lab__bytes_list(lab_cell *c) {
  if (c->type != LAB_BYTES_T) return c;
  lab_bytes *y = (lab_bytes *)c;
  lab_cell *l = __atomic_load_n(&y->list, __ATOMIC_ACQUIRE);
  if (l) return l;
  lab_cell *acc = &${o.nil};
  for (size_t i = y->n; i-- > 0;) { ${o.cons} *k = lab_new(sizeof(${o.cons}), ${o.type}, ${o.tag}); k->f${o.head} = LAB_SMALL(y->b[i]); k->f${1 - o.head} = acc; acc = (lab_cell *)k; }
  lab_cell *none = 0;
  if (__atomic_compare_exchange_n(&y->list, &none, acc, 0, __ATOMIC_ACQ_REL, __ATOMIC_ACQUIRE)) return acc;
  lab_drop(acc);
  return none;
}`,
  },
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
    uses: ["world.kept", "world.rawBytes"],
    c: (o) => `static int32_t lab_world_keptAddBytes(lab_int f, ${o.record} b) {
  lab_kept_file *k = lab__kept(f);
  size_t n = 0;
  lab_cell *items = ${o.raw ? "lab__bytes_list(b.f0)" : "b.f0"};
  for (lab_cell *c = items; c->tag == ${o.tag}; c = ((${o.cons} *)c)->f${1 - o.head}) n++;
  uint8_t *buf = malloc(n ? n : 1);
  if (!buf) lab_oom();
  n = 0;
  for (lab_cell *c = items; c->tag == ${o.tag}; c = ((${o.cons} *)c)->f${1 - o.head}) buf[n++] = (uint8_t)LAB_VAL(((${o.cons} *)c)->f${o.head});
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
  // processor) and switched with sigsetjmp and siglongjmp. Apple's too
  // (C294): ucontext is deprecated on macOS, and iOS builds with this.
  // Windows' own fibers there (C296): a stack switched by hand would break
  // its unwinding; each thread becomes a fiber the first time it switches.
  "fibers": { uses: [], c: `#if defined(_WIN32)
__declspec(dllimport) void *__stdcall CreateFiberEx(size_t, size_t, unsigned long, void (__stdcall *)(void *), void *);
__declspec(dllimport) void __stdcall SwitchToFiber(void *);
__declspec(dllimport) void __stdcall DeleteFiber(void *);
__declspec(dllimport) void *__stdcall ConvertThreadToFiber(void *);
typedef void *lab__ctx;
static __thread void *lab__self;
static void __stdcall lab__cstart(void *f) { ((void (*)(void))f)(); }
static void lab__cgo(lab__ctx *to) { lab__self = *to; SwitchToFiber(*to); }
#define LAB_CSWAP(from, to) do { if (!lab__self) lab__self = ConvertThreadToFiber(0); *(from) = lab__self; lab__cgo(to); } while (0)
#define LAB_CSET(to) lab__cgo(to)
#define LAB_CMAKE(c, f, stk, n) (*(c) = CreateFiberEx(0, (n), 1, lab__cstart, (void *)(f)), (void)(stk), *(c) ? (void)0 : lab_oom())
#define LAB_CSTACK 0
#define LAB_CFREE(c) DeleteFiber(*(c))
#elif defined(__ANDROID__) || defined(__APPLE__) || defined(LAB_FIBER_SJLJ)
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
#define LAB_CSTACK 1
#define LAB_CFREE(c) ((void)0)
#else
#include <ucontext.h>
typedef ucontext_t lab__ctx;
#define LAB_CSWAP(from, to) swapcontext(from, to)
#define LAB_CSET(to) setcontext(to)
#define LAB_CMAKE(c, f, stk, n) (getcontext(c), (c)->uc_stack.ss_sp = (stk), (c)->uc_stack.ss_size = (n), (c)->uc_link = 0, makecontext(c, f, 0))
#define LAB_CSTACK 1
#define LAB_CFREE(c) ((void)0)
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
  if (!f || (LAB_CSTACK && !(f->stack = malloc(LAB_FIBER_STACK)))) lab_oom();
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
  if (h->op < 0) { LAB_CFREE(&h->fiber->ctx); free(h->fiber->stack); free(h->fiber); h->fiber = 0; free(h->off); h->off = 0; }
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
  char *p = lab__path(path);
  FILE *f = lab__kind(p) == 2 ? (errno = EISDIR, (FILE *)0) : lab__fopen(p, "rb");
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
  char *p = lab__path(path);
  FILE *f = lab__kind(p) == 2 ? (errno = EISDIR, (FILE *)0) : lab__fopen(p, mode);
  free(p);
  if (!f) { lab__fail(errno, path); lab_drop(t); return; }
  fwrite(LAB_TB(t), 1, LAB_TN(t), f);
  fclose(f);
  lab_drop(path); lab_drop(t);
}`,
  },
  "world.writeFile": { uses: ["world.put"], c: `static void lab_world_writeFile(lab_cell *path, lab_cell *t) { lab__put(path, t, "wb"); }` },
  "world.appendFile": { uses: ["world.put"], c: `static void lab_world_appendFile(lab_cell *path, lab_cell *t) { lab__put(path, t, "ab"); }` },
  // Bytes in a run's log as worldlog.ts logText keeps them: {"bytes":[…]}.
  "world.logBytes": {
    uses: ["world.log"],
    c: `static void lab__log_bytes(const uint8_t *b, size_t n) {
  lab__log_raw("{\\"bytes\\":[");
  for (size_t i = 0; i < n; i++) fprintf(lab_log, i ? ",%u" : "%u", (unsigned)b[i]);
  lab__log_raw("]}");
}`,
  },
  // A file's kind, size and time last changed (C310, as world.ts answers
  // file info): lstat's, so a link is a link; logged as JavaScript logs
  // it, {"kind", "size", "modified"}, modified in seconds.
  "world.fileInfo": {
    uses: ["world.fail"],
    c: (o) => {
      const i = o.info!;
      const size = (x: string) => (i.size === "int" ? `LAB_SMALL(${x})` : `(int64_t)(${x})`);
      return `#ifdef _WIN32
// Windows (C296): the attributes, and a reparse point's tag, as libuv's
// lstat reads them for Node: a symbolic link, a junction or an app's
// link is a link, other reparse points (cloud files) what they hold.
typedef struct { unsigned long attrs, made[2], seen[2], written[2], hi, lo; } lab__wattrs;
typedef struct { unsigned long attrs, made[2], seen[2], written[2], hi, lo, tag, more; wchar_t name[260], short_name[14]; } lab__wfound;
__declspec(dllimport) int __stdcall GetFileAttributesExW(const wchar_t *, int, lab__wattrs *);
__declspec(dllimport) void *__stdcall FindFirstFileW(const wchar_t *, lab__wfound *);
__declspec(dllimport) int __stdcall FindClose(void *);
__declspec(dllimport) void *__stdcall CreateFileW(const wchar_t *, unsigned long, unsigned long, void *, unsigned long, unsigned long, void *);
__declspec(dllimport) int __stdcall DeviceIoControl(void *, unsigned long, void *, unsigned long, void *, unsigned long, unsigned long *, void *);
__declspec(dllimport) int __stdcall CloseHandle(void *);
// A link's size: its target's length in UTF-8, as libuv's readlink reads
// a symbolic link's or a junction's target (\\??\\C:\\… as C:\\…, \\??\\UNC\\… as \\\\…).
static int64_t lab__link_size(const wchar_t *w) {
  void *h = CreateFileW(w, 0, 7, 0, 3, 0x02200000, 0);
  if (h == (void *)(intptr_t)-1) return 0;
  static unsigned char b[16384];
  unsigned long got = 0, tag;
  int ok = DeviceIoControl(h, 0x000900A8, 0, 0, b, sizeof b, &got, 0);
  CloseHandle(h);
  if (!ok || got < 16) return 0;
  uint16_t off, len;
  uint32_t flags = 0;
  size_t at;
  memcpy(&tag, b, 4); memcpy(&off, b + 8, 2); memcpy(&len, b + 10, 2);
  if (tag == 0xA000000C) { memcpy(&flags, b + 16, 4); at = 20; } else if (tag == 0xA0000003) at = 16; else return 0;
  if (at + off + len > got) return 0;
  size_t n = len / 2;
  wchar_t *t = malloc((n + 3) * sizeof *t);
  if (!t) lab_oom();
  memcpy(t + 2, b + at + off, len);
  t[n + 2] = 0;
  wchar_t *x = t + 2;
  if (n >= 8 && !wcsncmp(x, L"\\\\??\\\\UNC\\\\", 8)) { x += 6; x[0] = x[1] = L'\\\\'; }
  else if (n >= 7 && !wcsncmp(x, L"\\\\??\\\\", 4) && x[5] == L':' && x[6] == L'\\\\') x += 4;
  else if (!(tag == 0xA000000C && (flags & 1))) { free(t); return 0; }
  char *u = lab__narrow(x);
  int64_t r = (int64_t)strlen(u);
  free(u); free(t);
  return r;
}
#endif
static ${i.record} lab_world_fileInfo(lab_cell *path) {
  if (lab__log_begin("fileInfo")) lab__log_text(path);
  char *p = lab__path(path);
  int kind;
  int64_t bytes;
  double modified;
#ifdef _WIN32
  wchar_t *w = lab__wide(p);
  lab__wattrs a;
  int ok = GetFileAttributesExW(w, 0, &a);
  unsigned long e = ok ? 0 : GetLastError();
  unsigned long tag = 0;
  if (ok && (a.attrs & 0x400)) { lab__wfound f; void *h = FindFirstFileW(w, &f); if (h != (void *)(intptr_t)-1) { tag = f.tag; FindClose(h); } }
  int link = tag == 0xA000000C || tag == 0xA0000003 || tag == 0x8000001B;
  int64_t to = link ? lab__link_size(w) : 0;
  free(w);
  free(p);
  if (!ok) { lab__fail(lab__errno(e), path); return (${i.record}){ &${i.kinds[0]}, ${size("0")}, { 0 } }; }
  kind = link ? 2 : a.attrs & 0x10 ? 1 : 0;
  bytes = kind == 0 ? (int64_t)((uint64_t)a.hi << 32 | a.lo) : kind == 2 ? to : 0;
  // 100 ns from 1601 to seconds and nanoseconds from 1970, as libuv.
  int64_t t = (int64_t)((uint64_t)a.written[1] << 32 | a.written[0]) - 116444736000000000LL;
  modified = ((double)(t / 10000000) * 1e3 + (double)(t % 10000000 * 100) / 1e6) / 1000;
#else
#ifdef LAB_TREE
  if (lab__in_tree(p)) {
    int64_t n = 0;
    double t = 0;
    int k = lab_tree_kind(p, &n, &t);
    free(p);
    if (!k) { lab__fail(ENOENT, path); return (${i.record}){ &${i.kinds[0]}, ${size("0")}, { 0 } }; }
    kind = k == 2 ? 1 : 0; bytes = k == 2 ? 0 : n; modified = t / 1000;
  } else {
#endif
  struct stat st;
  int bad = lstat(p, &st);
  free(p);
  if (bad) { lab__fail(errno, path); return (${i.record}){ &${i.kinds[0]}, ${size("0")}, { 0 } }; }
  kind = S_ISREG(st.st_mode) ? 0 : S_ISDIR(st.st_mode) ? 1 : S_ISLNK(st.st_mode) ? 2 : 3;
  bytes = (int64_t)st.st_size;
  // In ms first, then seconds, as Node's mtimeMs / 1000 (world.ts).
#ifdef __APPLE__
  modified = ((double)st.st_mtimespec.tv_sec * 1e3 + st.st_mtimespec.tv_nsec / 1e6) / 1000;
#else
  modified = ((double)st.st_mtim.tv_sec * 1e3 + st.st_mtim.tv_nsec / 1e6) / 1000;
#endif
#ifdef LAB_TREE
  }
#endif
#endif
  static const char *names[] = { "file", "folder", "link", "special" };
  if (lab_log_open) { lab__log_answer(); fprintf(lab_log, "{\\"kind\\":\\"%s\\",\\"size\\":%lld,\\"modified\\":%.17g}", names[kind], (long long)bytes, modified); lab__log_close(); }
  lab_drop(path);
  lab_cell *kinds[] = { ${i.kinds.map((k) => `&${k}`).join(", ")} };
  return (${i.record}){ kinds[kind], ${size("bytes")}, { modified } };
}`;
    },
  },
  // A file's bytes as they are, and bytes written as a file (C291, as
  // world.ts answers read bytes and write bytes): Bytes is a record of a
  // list of Ints, its C struct o.record, as the kept files' (L213c7).
  "world.readBytes": {
    uses: ["world.fail", "world.logBytes", "world.rawBytes"],
    c: (o) => `static ${o.record} lab_world_readBytes(lab_cell *path) {
  if (lab__log_begin("readBytes")) lab__log_text(path);
  char *p = lab__path(path);
  FILE *f = lab__kind(p) == 2 ? (errno = EISDIR, (FILE *)0) : lab__fopen(p, "rb");
  free(p);
  if (!f) { lab__fail(errno, path); return (${o.record}){ &${o.nil} }; }
  size_t n = 0, cap = 4096;
  uint8_t *s = malloc(cap);
  if (!s) lab_oom();
  for (size_t got; (got = fread(s + n, 1, cap - n, f)) > 0;) { n += got; if (n == cap) { s = realloc(s, cap *= 2); if (!s) lab_oom(); } }
  fclose(f);
  if (lab_log_open) { lab__log_answer(); lab__log_bytes(s, n); lab__log_close(); }
  ${o.raw ? "lab_cell *acc = lab__bytes_raw(s, n);" : `lab_cell *acc = &${o.nil};
  for (size_t i = n; i-- > 0;) { ${o.cons} *c = lab_new(sizeof(${o.cons}), ${o.type}, ${o.tag}); c->f${o.head} = LAB_SMALL(s[i]); c->f${1 - o.head} = acc; acc = (lab_cell *)c; }`}
  free(s);
  lab_drop(path);
  return (${o.record}){ acc };
}`,
  },
  // Bytes written as a file, logged as op with the path given: write
  // bytes's, and offer file's under the name alone (L271c).
  "world.putBytes": {
    uses: ["world.fail", "world.logBytes", "world.rawBytes"],
    c: (o) => `static void lab__put_bytes(const char *op, lab_cell *given, lab_cell *path, ${o.record} b) {
  size_t n = 0;
  uint8_t *buf;${o.raw ? `
  if (b.f0->type == LAB_BYTES_T) {
    n = ((lab_bytes *)b.f0)->n;
    buf = malloc(n ? n : 1);
    if (!buf) lab_oom();
    memcpy(buf, ((lab_bytes *)b.f0)->b, n);
  } else {` : " {"}
  for (lab_cell *c = b.f0; c->tag == ${o.tag}; c = ((${o.cons} *)c)->f${1 - o.head}) n++;
  buf = malloc(n ? n : 1);
  if (!buf) lab_oom();
  n = 0;
  for (lab_cell *c = b.f0; c->tag == ${o.tag}; c = ((${o.cons} *)c)->f${1 - o.head}) buf[n++] = (uint8_t)LAB_VAL(((${o.cons} *)c)->f${o.head});
  }
  lab_drop(b.f0);
  if (lab__log_begin(op)) { lab__log_text(given); lab__log_raw(","); lab__log_bytes(buf, n); lab__log_write(); }
  if (given != path) lab_drop(given);
  char *p = lab__path(path);
  FILE *f = lab__kind(p) == 2 ? (errno = EISDIR, (FILE *)0) : lab__fopen(p, "wb");
  free(p);
  if (!f) { free(buf); lab__fail(errno, path); return; }
  int ok = fwrite(buf, 1, n, f) == n;
  int e = errno;
  free(buf);
  if (fclose(f) != 0 || !ok) { lab__fail(e ? e : EIO, path); return; }
  lab_drop(path);
}`,
  },
  "world.writeBytes": {
    uses: ["world.putBytes"],
    c: (o) => `static void lab_world_writeBytes(lab_cell *path, ${o.record} b) { lab__put_bytes("writeBytes", path, path, b); }`,
  },
  // A file handed to the person (L271a, as world.ts on the command line):
  // written in the folder the program runs in, under its name alone
  // ("file" when it has none).
  // In an app (L271c), the screen asks the person where to keep it
  // ("offer file:" and the name, as a save dialog would), and it's
  // written where they chose; no place chosen aborts.
  "world.offerFile": {
    uses: ["world.putBytes", "world.ask", "world.chosen"],
    c: (o) => `static void lab_world_offerFile(lab_cell *name, ${o.record} b) {
  const char *s = (const char *)LAB_TB(name);
  size_t end = LAB_TN(name), start;
#ifdef _WIN32
#define LAB_SEP(c) ((c) == '/' || (c) == '\\\\')
#else
#define LAB_SEP(c) ((c) == '/')
#endif
  while (end > 0 && LAB_SEP(s[end - 1])) end--;
  for (start = end; start > 0 && !LAB_SEP(s[start - 1]); start--) {}
#undef LAB_SEP
  lab_cell *alone = end > start ? lab__text_of(s + start, end - start) : lab__text_of("file", 4);
  if (lab_ask) {
    lab_cell *at = lab__chosen("offer file:", alone);
    if (!at) { lab__chosen_none("no place was chosen to keep ", alone); lab_drop(b.f0); lab_drop(name); return; }
    lab_drop(alone);
    // Once written, the screen is told where (a phone hands it on from
    // there, as its share sheet or a document made for it).
    lab_dup(at);
    lab__put_bytes("offerFile", name, at, b);
    if (!lab_st) { lab_cell *k = lab__chosen("offered:", at); if (k) lab_drop(k); }
    lab_drop(at);
    return;
  }
  lab__put_bytes("offerFile", name, alone, b);
}`,
  },
  // A file the person chooses (L271a): on the command line there's no one
  // to choose, so it aborts, as world.ts does.
  // In an app (L271c), the screen asks the person for one ("ask for
  // file:" and the kinds, as an open dialog would), and its bytes are
  // read; none chosen aborts, as a page's picker does.
  "world.askForFile": {
    uses: ["world.fail", "world.ask", "world.chosen", "world.readBytes"],
    c: (o) => `static ${o.record} lab_world_askForFile(lab_cell *kinds) {
  if (lab_ask) {
    lab_cell *at = lab__chosen("ask for file:", kinds);
    lab_drop(kinds);
    if (at) return lab_world_readBytes(at);
    lab__chosen_none("no file was chosen", 0);
    return (${o.record}){ &${o.nil} };
  }
  if (lab__log_begin("askForFile")) lab__log_text(kinds);
  lab_drop(kinds);
  static const char why[] = "there's no one to choose a file on the command line: read one with read bytes";
  lab_drop(lab_reason);
  lab_reason = lab__text_of(why, sizeof why - 1);
  if (lab_log_open) { lab__log_raw("],\\"threw\\":"); lab__log_text(lab_reason); lab__log_raw("}"); lab_log_open = 0; }
  lab_st = 2;
  return (${o.record}){ &${o.nil} };
}`,
  },
  // What the screen is asked for a file (L271c): the ask, what before
  // and the text after it (kept); the path the person chose as a Text,
  // or null for none. And the reason for none, a text after it if one
  // is given (dropped).
  "world.chosen": {
    uses: ["world.ask", "world.fail"],
    c: `static lab_cell *lab__chosen(const char *what, lab_cell *t) {
  size_t a = strlen(what), n = LAB_TN(t);
  char *q = malloc(a + n + 1);
  if (!q) lab_oom();
  memcpy(q, what, a); memcpy(q + a, LAB_TB(t), n); q[a + n] = 0;
  free(lab_chosen); lab_chosen = 0;
  int yes = lab_ask(q, a + n);
  free(q);
  if (!yes || !lab_chosen) { free(lab_chosen); lab_chosen = 0; return 0; }
  lab_cell *r = lab__text_of(lab_chosen, strlen(lab_chosen));
  free(lab_chosen); lab_chosen = 0;
  return r;
}
static void lab__chosen_none(const char *why, lab_cell *t) {
  size_t a = strlen(why), n = t ? LAB_TN(t) : 0;
  lab_cell *r = lab__text(a + n);
  memcpy(LAB_TB(r), why, a);
  if (t) { memcpy(LAB_TB(r) + a, LAB_TB(t), n); lab_drop(t); }
  lab_drop(lab_reason);
  lab_reason = r;
  lab_st = 2;
}` },
  // A zone's offset from UTC at an instant, in seconds (L188): the host's
  // zone database through TZ, NaN for a zone it doesn't have (a file under
  // TZDIR or /usr/share/zoneinfo). The local time read back as UTC by
  // Hinnant's days from civil, so no tm_gmtoff is needed.
  "world.zoneOffset": { uses: ["world.fail"], c: `#include <time.h>
#include <math.h>
#ifdef _WIN32
// Windows (C296): ICU, which Windows has as icu.dll since 10 1903 and
// Node's Intl reads, so the offsets are the same; NaN without it.
__declspec(dllimport) void *__stdcall LoadLibraryW(const wchar_t *);
__declspec(dllimport) void *__stdcall GetProcAddress(void *, const char *);
static double lab_world_zoneOffset(lab_cell *zone, double at) {
  static void *icu;
  static int tried;
  if (!tried) { tried = 1; icu = LoadLibraryW(L"icu.dll"); }
  char *z = lab__cstr(zone); lab_drop(zone);
  double r = NAN;
  void *(*open)(const uint16_t *, int32_t, const char *, int, int *) = icu ? (void *(*)(const uint16_t *, int32_t, const char *, int, int *))GetProcAddress(icu, "ucal_open") : 0;
  int32_t (*canonical)(const uint16_t *, int32_t, uint16_t *, int32_t, int8_t *, int *) = icu ? (int32_t (*)(const uint16_t *, int32_t, uint16_t *, int32_t, int8_t *, int *))GetProcAddress(icu, "ucal_getCanonicalTimeZoneID") : 0;
  void (*set)(void *, double, int *) = icu ? (void (*)(void *, double, int *))GetProcAddress(icu, "ucal_setMillis") : 0;
  int32_t (*get)(const void *, int, int *) = icu ? (int32_t (*)(const void *, int, int *))GetProcAddress(icu, "ucal_get") : 0;
  void (*close)(void *) = icu ? (void (*)(void *))GetProcAddress(icu, "ucal_close") : 0;
  if (open && canonical && set && get && close && *z && isfinite(at)) {
    wchar_t *w = lab__wide(z);
    int32_t n = (int32_t)wcslen(w);
    uint16_t c[128];
    int8_t sys = 0;
    int e = 0;
    canonical((const uint16_t *)w, n, c, 128, &sys, &e);
    // A zone ICU doesn't know would be GMT: NaN, as Intl's RangeError.
    if (e <= 0 && sys) {
      void *cal = open((const uint16_t *)w, n, "", 1, &e);
      if (cal && e <= 0) {
        set(cal, floor(at) * 1000, &e);
        int32_t base = get(cal, 15, &e), dst = get(cal, 16, &e);
        if (e <= 0) r = (base + dst) / 1000;
      }
      if (cal) close(cal);
    }
    free(w);
  }
  free(z);
  return r;
}
#else
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
}
#endif` },
  // The person's time zone (C315), an IANA name as Node's Intl gives it:
  // TZ, else where /etc/localtime points into zoneinfo (Android: its
  // property; Windows: ICU's default zone); UTC's other names are UTC.
  "world.myTimeZone": { uses: ["world.os"], c: `#ifdef _WIN32
__declspec(dllimport) void *__stdcall LoadLibraryW(const wchar_t *);
__declspec(dllimport) void *__stdcall GetProcAddress(void *, const char *);
#else
#include <unistd.h>
#endif
#ifdef __ANDROID__
#include <sys/system_properties.h>
#endif
static lab_cell *lab_world_myTimeZone(void) {
  char buf[512];
  const char *tz = 0;
#ifdef _WIN32
  void *icu = LoadLibraryW(L"icu.dll");
  int32_t (*get)(uint16_t *, int32_t, int *) = icu ? (int32_t (*)(uint16_t *, int32_t, int *))GetProcAddress(icu, "ucal_getDefaultTimeZone") : 0;
  uint16_t z[128];
  int e = 0;
  int32_t n = get ? get(z, 127, &e) : 0;
  if (n > 0 && e <= 0) { z[n] = 0; char *s = lab__narrow((const wchar_t *)z); snprintf(buf, sizeof buf, "%s", s); free(s); tz = buf; }
#elif defined(__ANDROID__)
  if (__system_property_get("persist.sys.timezone", buf) > 0) tz = buf;
#else
  tz = getenv("TZ");
  if (tz && *tz == ':') tz++;
  if (!tz || !*tz) { ssize_t n = readlink("/etc/localtime", buf, sizeof buf - 1); tz = n > 0 ? (buf[n] = 0, buf) : 0; }
  if (tz) { const char *z = strstr(tz, "zoneinfo/"); tz = z ? z + 9 : *tz == '/' ? 0 : tz; }
#endif
  static const char *utc[] = { "Etc/UTC", "Etc/UCT", "Etc/GMT", "Etc/GMT0", "Etc/GMT+0", "Etc/GMT-0", "Etc/Universal", "Etc/Zulu", "Etc/Greenwich", "GMT", "GMT0", "GMT+0", "GMT-0", "UCT", "Universal", "Zulu", "Greenwich" };
  for (size_t i = 0; tz && i < sizeof utc / sizeof *utc; i++) if (!strcmp(tz, utc[i])) tz = 0;
  if (!tz || !*tz) tz = "UTC";
  return lab__text_of(tz, strlen(tz));
}` },
  // The person's locale (C315), as Node's Intl names it: LC_ALL, then
  // LC_MESSAGES, then LANG, without its encoding and modifier and with a
  // hyphen ("tr_TR.UTF-8" is tr-TR); C, POSIX and none are en-US. Windows:
  // the user's locale name; Android: its property. A Locale, o.record.
  "world.myLocale": {
    uses: ["world.os"],
    c: (o) => `#ifdef _WIN32
__declspec(dllimport) int __stdcall GetUserDefaultLocaleName(wchar_t *, int);
#endif
#ifdef __ANDROID__
#include <sys/system_properties.h>
#endif
static ${o.record} lab_world_myLocale(void) {
  char buf[128];
  const char *v = 0;
#ifdef _WIN32
  wchar_t w[85];
  if (GetUserDefaultLocaleName(w, 85) > 0) { char *s = lab__narrow(w); snprintf(buf, sizeof buf, "%s", s); free(s); v = buf; }
#elif defined(__ANDROID__)
  if (__system_property_get("persist.sys.locale", buf) > 0 || __system_property_get("ro.product.locale", buf) > 0) v = buf;
#else
  const char *names[] = { "LC_ALL", "LC_MESSAGES", "LANG" };
  for (int i = 0; i < 3 && (!v || !*v); i++) v = getenv(names[i]);
#endif
  char out[128];
  size_t n = 0;
  for (; v && v[n] && v[n] != '.' && v[n] != '@' && n < sizeof out - 1; n++) out[n] = v[n] == '_' ? '-' : v[n];
  out[n] = 0;
  if (!n || !strcmp(out, "C") || !strcmp(out, "POSIX")) { strcpy(out, "en-US"); n = 5; }
  return (${o.record}){ lab__text_of(out, n) };
}`,
  },
  // A file or folder to the platform's own app (C315, L283), as world.ts:
  // \`open\` on a Mac, xdg-open elsewhere (TERS_OPEN_OUTSIDE names
  // another), waited for, Windows' ShellExecute, or an Android app's
  // opener (C311); an iPhone has none here.
  // Logged as a write; fails as reading a file does when nothing is there.
  "world.openOutside": {
    uses: ["world.fail"],
    c: `#ifdef _WIN32
__declspec(dllimport) void *__stdcall ShellExecuteW(void *, const wchar_t *, const wchar_t *, const wchar_t *, const wchar_t *, int);
#elif defined(__APPLE__)
#include <TargetConditionals.h>
#endif
#ifdef __ANDROID__
// The app's opener (C311, native-app.ts j_open): why the file didn't open,
// malloc'd, or null when it did.
#define LAB_OPENER 1
static char *(*lab_opener)(const char *path);
#endif
#if !defined(_WIN32) && !defined(__ANDROID__) && !(defined(TARGET_OS_IPHONE) && TARGET_OS_IPHONE)
#include <spawn.h>
#include <sys/wait.h>
#include <fcntl.h>
extern char **environ;
#endif
static void lab_world_openOutside(lab_cell *path) {
  if (lab__log_begin("openOutside")) { lab__log_text(path); lab__log_write(); }
  char *p = lab__path(path), how[256];
  const char *why = 0;
  if (!lab__kind(p)) { int e = errno; free(p); lab__fail(e, path); return; }
#ifdef _WIN32
  wchar_t *w = lab__wide(p);
  intptr_t r = (intptr_t)ShellExecuteW(0, L"open", w, 0, 0, 1);
  free(w);
  if (r <= 32) { snprintf(how, sizeof how, "ShellExecute answered %d", (int)r); why = how; }
#elif defined(__ANDROID__)
  char *said = lab_opener ? lab_opener(p) : 0;
  if (!lab_opener) why = "this platform has no opener here";
  else if (said) { snprintf(how, sizeof how, "%s", said); free(said); why = how; }
#elif defined(TARGET_OS_IPHONE) && TARGET_OS_IPHONE
  why = "this platform has no opener here";
#else
  const char *cmd = getenv("TERS_OPEN_OUTSIDE");
#ifdef __APPLE__
  if (!cmd || !*cmd) cmd = "open";
#else
  if (!cmd || !*cmd) cmd = "xdg-open";
#endif
  char *argv[] = { (char *)cmd, p, 0 };
  posix_spawn_file_actions_t fa;
  posix_spawn_file_actions_init(&fa);
  for (int fd = 0; fd < 3; fd++) posix_spawn_file_actions_addopen(&fa, fd, "/dev/null", fd ? O_WRONLY : O_RDONLY, 0);
  pid_t pid;
  int st = 0, e = posix_spawnp(&pid, cmd, &fa, 0, argv, environ);
  posix_spawn_file_actions_destroy(&fa);
  if (e) { snprintf(how, sizeof how, "spawnSync %.40s %s", cmd, e == ENOENT ? "ENOENT" : strerror(e)); why = how; }
  else if (waitpid(pid, &st, 0) < 0 || !WIFEXITED(st) || WEXITSTATUS(st)) {
    if (WIFEXITED(st)) snprintf(how, sizeof how, "%.40s ended with %d", cmd, WEXITSTATUS(st)); else snprintf(how, sizeof how, "%.40s ended with null", cmd);
    why = how;
  }
#endif
  if (why) {
    char *s = malloc(strlen(p) + strlen(why) + 32);
    if (!s) lab_oom();
    int k = sprintf(s, "could not open %s outside: %s", p, why);
    lab_drop(lab_reason);
    lab_reason = lab__text_of(s, (size_t)k);
    free(s);
    lab_st = 2;
  }
  free(p);
  lab_drop(path);
}`,
  },
  // An environment variable (L253): getenv's value, NFC, or none.
  "world.environmentVariable": {
    uses: ["world.fail", "world.nfc", "world.log"],
    c: (o) => `static lab_cell *lab_world_environmentVariable(lab_cell *name) {
  int L = lab__log_begin("environmentVariable");
  if (L) lab__log_text(name);
  char *n = lab__cstr(name);
  const char *v = lab__getenv(n);
  free(n);
  lab_drop(name);
  if (!v) { if (L) { lab__log_answer(); lab__log_raw("null"); lab__log_close(); } return &${o.nil}; }
  ${o.cons} *r = lab_new(sizeof(${o.cons}), ${o.type}, ${o.tag});
  r->f${o.head} = lab__nfc(lab__text_of(v, strlen(v)));
  if (L) { lab__log_answer(); lab__log_text(r->f${o.head}); lab__log_close(); }
  return (lab_cell *)r;
}`,
  },
  "world.fileExists": { uses: ["world.fail"], c: `static int32_t lab_world_fileExists(lab_cell *path) { int L = lab__log_begin("fileExists"); if (L) lab__log_text(path); char *p = lab__path(path); int r = lab__kind(p) != 0; free(p); if (L) { lab__log_answer(); lab__log_raw(r ? "true" : "false"); lab__log_close(); } lab_drop(path); return r; }` },
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
  char *p = lab__path(path);
  int kind = lab__kind(p);
  size_t n = 0, cap = 16;
  lab_cell **xs;
#ifdef LAB_TREE
  // In a picked folder (C313), its names as the app's Java reads them.
  if (lab__in_tree(p)) {
    char **names = kind == 2 ? lab_tree_list(p, &n) : 0;
    free(p);
    if (!names) { lab__fail(kind == 1 ? ENOTDIR : ENOENT, path); return 0; }
    xs = malloc((n ? n : 1) * sizeof *xs);
    if (!xs) lab_oom();
    for (size_t k = 0; k < n; k++) { xs[k] = lab__text_of(names[k], strlen(names[k])); free(names[k]); }
    free(names);
    goto sort;
  }
#endif
#ifdef _WIN32
  // By its wide name, each name back to UTF-8 (C296).
  wchar_t *w = lab__wide(p);
  _WDIR *dir = kind == 1 ? (errno = ENOTDIR, (_WDIR *)0) : _wopendir(w);
  free(w);
#else
  DIR *dir = kind == 1 ? (errno = ENOTDIR, (DIR *)0) : opendir(p);
#endif
  free(p);
  if (!dir) { lab__fail(errno, path); return 0; }
  xs = malloc(cap * sizeof *xs);
  if (!xs) lab_oom();
#ifdef _WIN32
  for (struct _wdirent *e; (e = _wreaddir(dir));) {
    if (!wcscmp(e->d_name, L".") || !wcscmp(e->d_name, L"..")) continue;
    if (n == cap) { xs = realloc(xs, (cap *= 2) * sizeof *xs); if (!xs) lab_oom(); }
    char *name = lab__narrow(e->d_name);
    xs[n++] = lab__text_of(name, strlen(name));
    free(name);
  }
  _wclosedir(dir);
#else
  for (struct dirent *e; (e = readdir(dir));) {
    if (!strcmp(e->d_name, ".") || !strcmp(e->d_name, "..")) continue;
    if (n == cap) { xs = realloc(xs, (cap *= 2) * sizeof *xs); if (!xs) lab_oom(); }
    xs[n++] = lab__text_of(e->d_name, strlen(e->d_name));
  }
  closedir(dir);
#endif
#ifdef LAB_TREE
sort:
#endif
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
// On Apple, strict POSIX hides stat's st_mtimespec and sysconf's
// _SC_NPROCESSORS_ONLN, so Darwin's own names come too (C316).
export const POSIX = "#define _POSIX_C_SOURCE 200809L\n#ifdef __APPLE__\n#define _DARWIN_C_SOURCE\n#endif";
export const WORLD_H = "#include <errno.h>\n#include <sys/stat.h>\n#include <dirent.h>";
export const cName = (rt: string) => `lab_${rt.replace(/\./g, "_")}`;
// The C names the runtime defines besides `lab_` + a function's, which a
// program's own names must not take.
// Every `lab_` name the runtime's text defines or uses counts too (I214: a
// definition named `cell` took `lab_cell`, the runtime's cell type).
const LIST_SAMPLE: ListNames = { cons: "List_cons", nil: "List_nil", type: 0, tag: 0, head: 0, info: { record: "File_info", instant: "Instant", kinds: ["File_kind_plain_file", "File_kind_folder", "File_kind_link", "File_kind_special"], size: "int" } };
const words = (text: string) => [...text.matchAll(/\blab_([A-Za-z0-9_]+)/g)].map((m) => m[1]);
// Found on first use: the NFC table's text (c-nfc.ts) takes 0.2 s to
// build, and a run on JavaScript loads this file without printing C (I264).
let reserved: string[] | undefined;
export const reservedNames = (): string[] => (reserved ??= [...new Set(["int_dup", "int_drop", "int_dec", ...Object.keys(FNS).map((n) => n.replace(/\./g, "_")), ...words(BASE), ...Object.values(FNS).flatMap((f) => words(typeof f.c === "string" ? f.c : f.c(LIST_SAMPLE)))])]);

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
