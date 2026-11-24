#!/usr/bin/env python3
# Instrument a `ters native` C file (ALLOCATIONS-2026-11-24.md): count each
# cell made by kind, and whether it is freed (or its memory reused) while
# the program function that made it is still running, or after it returned.
# Usage: kinds.py in.c out.c, then build out.c with -finstrument-functions
# and run it with TERS_WORKERS=0; the report is on standard error.
import re, sys
src = open(sys.argv[1]).read()

ids = {}
for name, tid in re.findall(r"lab_new\(sizeof\((\w+)\)[^,;]*,\s*(\d+|LAB_\w+)\s*,", src):
    ids.setdefault(tid, name)
ids.setdefault("LAB_TEXT_T", "lab_text"); ids.setdefault("LAB_INT_T", "lab_big")

def kind(n):
    if n.startswith("Closure"): return 1
    if re.match(r"List(_\d+)?_cons", n): return 2
    if n.startswith("List_frames"): return 3
    if re.match(r"(Map|Set)_tree", n): return 4
    if n == "lab_text" or n == "lab__fill": return 5
    if n.startswith("Box"): return 6
    if re.search(r"view|buf|Array|arr", n, re.I): return 7
    if n.startswith("Optional"): return 8
    if n.startswith("Tuple"): return 9
    return 10
names = ["?", "closure", "list cell", "heap frame", "tree node", "text", "search box", "array/view", "optional", "tuple", "record/case"]

table = ",".join(f"[{t}]={kind(n)}" for t, n in ids.items() if t.isdigit())
hooks_proto = """
static void lab__hnew(void *c) LAB__NOI;
static void lab__hfree(void *c) LAB__NOI;
static void *lab__hreuse(void *c) LAB__NOI;
"""
hooks = r"""
static const unsigned char lab__kd[65536] = { %s, [65534]=5, [65535]=10 };
static const char *lab__kn[] = { %s };
static unsigned long long lab__frames[1 << 20]; static int lab__depth; static unsigned long long lab__serial;
void __cyg_profile_func_enter(void *f, void *s) LAB__NOI;
void __cyg_profile_func_exit(void *f, void *s) LAB__NOI;
void __cyg_profile_func_enter(void *f, void *s) { (void)f; (void)s; if (lab__depth < (1 << 20) - 1) lab__frames[++lab__depth] = ++lab__serial; }
void __cyg_profile_func_exit(void *f, void *s) { (void)f; (void)s; if (lab__depth > 0) lab__depth--; }
typedef struct { void *p; unsigned long long serial; int depth; unsigned char k; } lab__meta;
#define LAB__HN (1u << 24)
static lab__meta *lab__h;
static unsigned long long lab__made[16], lab__inframe[16], lab__outlived[16], lab__reuses[16], lab__unknown;
static unsigned long long lab__slot(void *p) LAB__NOI;
static unsigned long long lab__slot(void *p) { unsigned long long x = (unsigned long long)p; x ^= x >> 33; x *= 0xff51afd7ed558ccdULL; x ^= x >> 33; return x & (LAB__HN - 1); }
static void lab__report(void) LAB__NOI;
static void lab__report(void) {
  unsigned long long tm = 0, ti = 0, to = 0, tr = 0;
  fprintf(stderr, "ALLOC kind made in-frame outlived reused live-at-end\n");
  for (int k = 1; k < 11; k++) { if (!lab__made[k] && !lab__reuses[k]) continue; tm += lab__made[k]; ti += lab__inframe[k]; to += lab__outlived[k]; tr += lab__reuses[k];
    fprintf(stderr, "ALLOC %%s %%llu %%llu %%llu %%llu %%llu\n", lab__kn[k], lab__made[k], lab__inframe[k], lab__outlived[k], lab__reuses[k], lab__made[k] - lab__inframe[k] - lab__outlived[k]); }
  fprintf(stderr, "ALLOC total %%llu %%llu %%llu %%llu %%llu unknown-frees %%llu\n", tm, ti, to, tr, tm - ti - to, lab__unknown);
}
static void lab__put(void *c, unsigned char k) LAB__NOI;
static void lab__put(void *c, unsigned char k) {
  if (!lab__h) { lab__h = calloc(LAB__HN, sizeof *lab__h); atexit(lab__report); }
  unsigned long long i = lab__slot(c);
  while (lab__h[i].p && lab__h[i].p != c) i = (i + 1) & (LAB__HN - 1);
  lab__h[i].p = c; lab__h[i].serial = lab__frames[lab__depth]; lab__h[i].depth = lab__depth; lab__h[i].k = k;
}
static int lab__take(void *c, unsigned char *k) LAB__NOI;
static int lab__take(void *c, unsigned char *k) {
  if (!lab__h) return -1;
  unsigned long long i = lab__slot(c);
  while (lab__h[i].p && lab__h[i].p != c) i = (i + 1) & (LAB__HN - 1);
  if (!lab__h[i].p) return -1;
  lab__meta m = lab__h[i]; *k = m.k;
  // backward-shift delete
  unsigned long long j = i;
  for (;;) { j = (j + 1) & (LAB__HN - 1); if (!lab__h[j].p) break; unsigned long long h = lab__slot(lab__h[j].p);
    if ((j > i && (h <= i || h > j)) || (j < i && (h <= i && h > j))) { lab__h[i] = lab__h[j]; i = j; } }
  lab__h[i].p = 0;
  return m.depth <= lab__depth && lab__frames[m.depth] == m.serial;
}
static void lab__hnew(void *c) { unsigned char k = lab__kd[((lab_cell *)c)->type]; if (!k) k = 10; lab__made[k]++; lab__put(c, k); }
static void lab__hfree(void *c) { unsigned char k; int r = lab__take(c, &k); if (r < 0) { lab__unknown++; return; } if (r) lab__inframe[k]++; else lab__outlived[k]++; }
static void *lab__hreuse(void *c) { unsigned char k; int r = lab__take(c, &k); if (r < 0) { lab__unknown++; return c; } if (r) lab__inframe[k]++; else lab__outlived[k]++; lab__reuses[k]++; lab__made[k]++; lab__put(c, k); return c; }
""" % (table, ",".join(f'"{n}"' for n in names))

lines = src.split("\n")
L = lines.index("// main")
for i in range(L):
    ln = lines[i]
    if re.match(r"(static |__attribute__)", ln) and "(" in ln and not re.match(r"[^(]*=", ln) and not re.match(r"[^(]*\(\s*\*", ln) and not ln.rstrip().endswith(";"):
        lines[i] = "LAB__NOI " + ln
src = "#define LAB__NOI __attribute__((no_instrument_function))\n" + "\n".join(lines)
src = src.replace("LAB__NOI static void *lab_new(size_t size, uint16_t type, uint8_t tag) {", hooks_proto + "LAB__NOI static void *lab_new(size_t size, uint16_t type, uint8_t tag) {", 1)
src, n1 = re.subn(r"(c->rc = 1; c->type = type; c->tag = tag; c->size = \(uint8_t\)k;\n  lab_live\+\+;\n)", r"\1  lab__hnew(c);\n", src, count=1)
src, n2 = re.subn(r"(LAB__NOI static inline void lab_free\(lab_cell \*c\) \{\n  lab_live--;\n)", r"\1  lab__hfree(c);\n", src, count=1)
src, n3 = re.subn(r"if \((r\d+)\) \{ (t\d+) = \1;", r"if (\1) { \2 = lab__hreuse(\1);", src)
src += hooks
sys.stderr.write(f"patched: new {n1} free {n2} reuse sites {n3}, {len(ids)} types\n")
open(sys.argv[2], "w").write(src)
