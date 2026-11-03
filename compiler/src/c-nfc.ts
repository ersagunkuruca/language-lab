// Text from the world in Normalization Form C on C (C151, L214a,
// TEXT-2026-11-03.md §1): what C's read line, read input, read file and
// list folder give is normalised where it comes in, as ters/src/lang/
// border.ts does for the evaluator and compiled JS.
//
// The tables are not a copy of the Unicode data: they are read off the
// compiling machine's own `String.prototype.normalize` (the one the
// evaluator uses, so the two agree on the same Unicode version), once per
// process, in about a quarter of a second:
//  - each code point's full canonical decomposition, where NFD changes it;
//  - the canonical combining classes, as ranks only: NFD puts two marks in
//    order of their classes, so asking it about a pair says which class is
//    higher, and probing with U+0345 (class 240) and U+0334 (class 1) says
//    which code points have one at all;
//  - the primary composites, as the pair NFC puts together into each.
// Hangul syllables are by arithmetic, as Unicode defines them.
// The algorithm is Unicode Standard Annex #15's (decompose, put marks in
// order, compose with the last starter unless blocked).

let built: string | undefined;

export function nfcC(): string {
  return (built ??= build());
}

function build(): string {
  const ch = (c: number) => String.fromCodePoint(c);
  const cps = (s: string) => [...s].map((x) => x.codePointAt(0)!);
  const decomp = new Map<number, number[]>(), marks: number[] = [];
  let changes = 0x110000;
  for (let c = 0; c < 0x110000; c++) {
    if (c === 0xd800) { c = 0xdfff; continue; }
    if (c >= 0xac00 && c <= 0xd7a3) continue;
    const s = ch(c), d = s.normalize("NFD");
    if (d !== s) { decomp.set(c, cps(d)); continue; }
    if (("ͅ" + s).normalize("NFD") === s + "ͅ" || (s + "̴").normalize("NFD") === "̴" + s) marks.push(c);
  }
  const order = (a: number, b: number) => {
    if ((ch(a) + ch(b)).normalize("NFD") === ch(b) + ch(a)) return 1;
    if ((ch(b) + ch(a)).normalize("NFD") === ch(a) + ch(b)) return -1;
    return 0;
  };
  marks.sort(order);
  const rank: number[] = [];
  marks.forEach((m, i) => rank.push(i === 0 ? 1 : rank[i - 1] + (order(marks[i - 1], m) !== 0 ? 1 : 0)));
  if (rank.at(-1)! > 255) throw new Error("more combining classes than a byte holds");
  const ranked = marks.map((m, i) => [m, rank[i]] as const).sort((x, y) => x[0] - y[0]);
  const pairs: [bigint, number][] = [];
  for (const [p, d] of decomp) {
    const s = ch(p);
    if (s.normalize("NFC") !== s) continue;
    let pair: [number, number] | undefined;
    for (let i = d.length - 1; i >= 1 && !pair; i--) {
      const a = String.fromCodePoint(...d.filter((_, j) => j !== i)).normalize("NFC");
      if ([...a].length === 1 && (a + ch(d[i])).normalize("NFC") === s) pair = [a.codePointAt(0)!, d[i]];
    }
    if (!pair) throw new Error(`no pair composes U+${p.toString(16)}`);
    pairs.push([(BigInt(pair[0]) << 21n) | BigInt(pair[1]), p]);
    changes = Math.min(changes, pair[1]);
  }
  pairs.sort((x, y) => (x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : 0));
  // Below the first code point that decomposes, has a class or ends a
  // pair, a text is in NFC as it is.
  changes = Math.min(changes, marks[0] ?? changes, Math.min(...decomp.keys()), 0x1100);
  // Each code point becomes at most four (the buffers below).
  if ([...decomp.values()].some((d) => d.length > 4)) throw new Error("a decomposition longer than four");
  const keys = [...decomp.keys()].sort((a, b) => a - b), at: number[] = [0], flat: number[] = [];
  for (const k of keys) { flat.push(...decomp.get(k)!); at.push(flat.length); }
  const list = (xs: readonly (number | bigint)[], suffix = "") => xs.map((x) => `${x}${suffix}`).join(",");
  return `// Normalization Form C (UAX #15), tables from Node ${process.versions.node}'s Unicode ${process.versions.unicode} (compiler/src/c-nfc.ts).
static const uint32_t lab__nfd_key[${keys.length}] = {${list(keys)}};
static const uint16_t lab__nfd_at[${at.length}] = {${list(at)}};
static const uint32_t lab__nfd_cp[${flat.length}] = {${list(flat)}};
static const uint32_t lab__ccc_key[${ranked.length}] = {${list(ranked.map((x) => x[0]))}};
static const uint8_t lab__ccc_rank[${ranked.length}] = {${list(ranked.map((x) => x[1]))}};
static const uint64_t lab__nfc_pair[${pairs.length}] = {${list(pairs.map((x) => x[0]), "ULL")}};
static const uint32_t lab__nfc_comp[${pairs.length}] = {${list(pairs.map((x) => x[1]))}};
static int lab__find32(const uint32_t *a, int n, uint32_t x) {
  int lo = 0, hi = n - 1;
  while (lo <= hi) { int m = (lo + hi) / 2; if (a[m] == x) return m; if (a[m] < x) lo = m + 1; else hi = m - 1; }
  return -1;
}
static int lab__ccc(uint32_t c) {
  if (c < ${ranked[0]?.[0] ?? 0x110000}) return 0;
  int i = lab__find32(lab__ccc_key, ${ranked.length}, c);
  return i < 0 ? 0 : lab__ccc_rank[i];
}
static uint32_t lab__compose(uint32_t a, uint32_t b) {
  if (a >= 0x1100 && a < 0x1113 && b >= 0x1161 && b < 0x1176) return 0xAC00 + ((a - 0x1100) * 21 + (b - 0x1161)) * 28;
  if (a >= 0xAC00 && a < 0xD7A4 && (a - 0xAC00) % 28 == 0 && b > 0x11A7 && b < 0x11C3) return a + (b - 0x11A7);
  uint64_t k = ((uint64_t)a << 21) | b;
  int lo = 0, hi = ${pairs.length - 1};
  while (lo <= hi) { int m = (lo + hi) / 2; if (lab__nfc_pair[m] == k) return lab__nfc_comp[m]; if (lab__nfc_pair[m] < k) lo = m + 1; else hi = m - 1; }
  return 0;
}
// The text in NFC: the same cell when it already is (all of it below
// U+${changes.toString(16).toUpperCase()}, or nothing changed), and as it is when it isn't UTF-8.
static lab_cell *lab__nfc(lab_cell *t) {
  const uint8_t *b = LAB_TB(t);
  uint32_t n = LAB_TN(t), i = 0, count = 0;
  int plain = 1;
  for (; i < n; count++) {
    uint32_t c = b[i], w = c < 0x80 ? 0 : c >= 0xC2 && c < 0xE0 ? 1 : c >= 0xE0 && c < 0xF0 ? 2 : c >= 0xF0 && c < 0xF5 ? 3 : 4;
    if (w == 4) return t;
    if (w) c &= 0x3F >> w;
    for (uint32_t k = 1; k <= w; k++) { if (i + k >= n || (b[i + k] & 0xC0) != 0x80) return t; c = (c << 6) | (b[i + k] & 0x3F); }
    if ((w == 2 && (c < 0x800 || (c >= 0xD800 && c < 0xE000))) || (w == 3 && (c < 0x10000 || c > 0x10FFFF))) return t;
    if (c >= ${changes}) plain = 0;
    i += w + 1;
  }
  if (plain) return t;
  uint32_t *cs = malloc(((size_t)count * 4 + 1) * sizeof *cs);
  uint8_t *cc = malloc((size_t)count * 4 + 1);
  if (!cs || !cc) lab_oom();
  uint32_t m = 0;
  for (i = 0; i < n;) {
    uint32_t c = b[i], w = c < 0x80 ? 0 : c < 0xE0 ? 1 : c < 0xF0 ? 2 : 3;
    if (w) c &= 0x3F >> w;
    for (uint32_t k = 1; k <= w; k++) c = (c << 6) | (b[i + k] & 0x3F);
    i += w + 1;
    if (c >= 0xAC00 && c < 0xD7A4) {
      uint32_t s = c - 0xAC00;
      cs[m++] = 0x1100 + s / 588; cs[m++] = 0x1161 + (s % 588) / 28;
      if (s % 28) cs[m++] = 0x11A7 + s % 28;
      continue;
    }
    int d = c >= ${Math.min(...keys)} ? lab__find32(lab__nfd_key, ${keys.length}, c) : -1;
    if (d < 0) { cs[m++] = c; continue; }
    for (uint32_t k = lab__nfd_at[d]; k < lab__nfd_at[d + 1]; k++) cs[m++] = lab__nfd_cp[k];
  }
  // Marks in order of their classes, a stable insertion sort.
  for (uint32_t k = 0; k < m; k++) {
    cc[k] = (uint8_t)lab__ccc(cs[k]);
    for (uint32_t j = k; j > 0 && cc[j] && cc[j - 1] > cc[j]; j--) {
      uint32_t x = cs[j]; cs[j] = cs[j - 1]; cs[j - 1] = x;
      uint8_t y = cc[j]; cc[j] = cc[j - 1]; cc[j - 1] = y;
    }
  }
  // Composed with the last starter, unless a mark of the same class or
  // higher (or a starter) stands between.
  int64_t starter = -1;
  int last = -1;
  uint32_t o = 0;
  for (uint32_t k = 0; k < m; k++) {
    uint32_t c = cs[k];
    int cl = cc[k];
    if (starter >= 0 && (last == -1 || last < cl)) {
      uint32_t p = lab__compose(cs[starter], c);
      if (p) { cs[starter] = p; continue; }
    }
    if (cl == 0) { starter = o; last = -1; } else last = cl;
    cs[o++] = c;
  }
  char *u = malloc((size_t)o * 4 + 1);
  if (!u) lab_oom();
  uint32_t len = 0;
  for (uint32_t k = 0; k < o; k++) {
    uint32_t c = cs[k];
    if (c < 0x80) u[len++] = (char)c;
    else if (c < 0x800) { u[len++] = (char)(0xC0 | c >> 6); u[len++] = (char)(0x80 | (c & 0x3F)); }
    else if (c < 0x10000) { u[len++] = (char)(0xE0 | c >> 12); u[len++] = (char)(0x80 | (c >> 6 & 0x3F)); u[len++] = (char)(0x80 | (c & 0x3F)); }
    else { u[len++] = (char)(0xF0 | c >> 18); u[len++] = (char)(0x80 | (c >> 12 & 0x3F)); u[len++] = (char)(0x80 | (c >> 6 & 0x3F)); u[len++] = (char)(0x80 | (c & 0x3F)); }
  }
  free(cs); free(cc);
  if (len == n && !memcmp(u, b, n)) { free(u); return t; }
  lab_cell *r = lab__text_of(u, len);
  free(u);
  lab_drop(t);
  return r;
}`;
}
