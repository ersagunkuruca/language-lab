// C for the lowering wasm.ts, wgsl.ts and js-scalar.ts print (scalar.ts),
// printed as C: native programs (docs/design/targets/NATIVE.md). Float64 is
// `double`, Bool is an `int32_t` 0 or 1, a record is a struct passed by
// value, a let is a local, and `if` and a match are statements. Lower with
// `{ records: true }` to have records, `{ data: true }` for data too.
//
// The numbers are the evaluator's, bit for bit, on any C compiler that
// keeps IEEE 754's rules: + − × ÷, sqrt and floor are exact in C as in
// JavaScript, and `mod` is fmod twice (as runtime.js's `$mod`). sin, cos,
// tan, exp, log, pow and atan2 are the platform's own, libm's, within a few
// ulp of the evaluator's (SPEC §3.2, Ersagun 2026-11-03, C144); with
// `math: "fdlibm"` they are V8's fdlibm translated to C (c-math.ts), what
// Node's Math runs, the same bits, which the agreement tests build with.
// What a compiler may do to the rest, it must
// be told not to: contract a·b + c into one fused step (GCC does on
// aarch64 unless -ffp-contract=off), or keep x87's extra bits on 32-bit
// x86 (-msse2 -mfpmath=sse). CFLAGS has the flags.
//
// Data (N2) is a pointer to a cell: a count, the cell's type and case,
// then the fields, one C struct per case. A case with no fields is one
// static cell whose count is 0, which means it is never counted or freed.
import { TICKET_V } from "../../ters/src/lang/std.ts";
// Values are owned: whoever holds one gives it on (to a call, a field, a
// let) or drops it, so a function owns its inputs. Each use of a local is
// the last one or a `dup`, and a local that one branch doesn't use is
// dropped where that branch starts: the liveness half of Koka's Perceus
// (Reinking, Xie, de Moura and Leijen, PLDI 2021); reuse comes in N5.
// Reading a field borrows the cell and dups the field. A cell whose count
// reaches 0 frees its fields' counts in turn, from a stack of cells rather
// than by recursion, so a million-long list frees in constant C stack.
//
// Functions as values (N3) are cells too: the code's address, then what
// the function captured. A search's box (a record the lowering makes with
// a field the search sets) is a cell, since the search and its caller
// share it. A function with one answer or none sets `lab_st` (1: none)
// and returns a zero, as WebAssembly's give a status (W4a): a call of one
// checks it and goes to the nearest attempt (first, optional, a budget)
// with `goto`, dropping on the way what that attempt won't use. Searches
// with several answers are already functions taking the rest of the
// search (W4d), so they need nothing more. lab_st is 0 except while one
// of these is on its way out.
//
// A call to itself as the last step is a loop, as in WGSL; other recursion
// recurses. A budget (with fuel) is one variable, `lab_fuel`, spent as in
// the other targets.
//
// Ints and Texts (N4a) are c-rt.ts's: an Int a word that is the value or a
// counted cell of limbs, a Text a counted cell of UTF-8. Abort is status 2,
// its reason in `lab_reason`, and a handler a label for it as an attempt
// is for status 1. Every call is a statement of its own, in order, since C
// runs a call's arguments in any order and a call may drop what another
// argument reads. The console and files (N4b) are c-rt.ts's too, and
// `main` (opts.main) runs the program on a thread with a big stack. What
// can't be printed is in `refused`, with the reason, and so is anything
// that calls it.

import { FDLIBM_C } from "./c-math.ts";
import { LAYOUT_C, UI_HEADLESS_C } from "./c-layout.ts";
import { BASE, cName, POSIX, RESERVED, RT_C, runtimeC, WORLD_H, type ListNames } from "./c-rt.ts";
import { runtime } from "./wasm-rt.ts";
import type { HostOps } from "./core-rt.ts";
import { hostCName as hostName, type Shape } from "../../ters/src/lang/hosts.ts";
const UOPS: Partial<Record<Op, string>> = { uadd: "+", usub: "-", umul: "*", uand: "&", uor: "|", uxor: "^" };
const U64OPS: Partial<Record<Op, string>> = { u64add: "+", u64sub: "-", u64mul: "*", u64and: "&", u64or: "|", u64xor: "^" };
import { SITES, STOPS } from "./stops.ts";
import { fails, listSteps, isArray, isTable, isData, isFn, isRecord, kids, mapKids, OPS, type AType, type TType, type DType, type FType, type LType, type CoreIR, type Op, type RType, type SExpr, type SFunc } from "./scalar.ts";

// What a C compiler needs to keep the evaluator's numbers. -fwrapv: fdlibm
// shifts signed ints past their top bit (pow's test for an odd exponent).
export const CFLAGS = ["-std=c99", "-O2", "-ffp-contract=off", "-fwrapv"];

// and, or: both sides, as WebAssembly's i32.and (a side may hold cells
// its call owns, which skipping it would leak), on Bools that are 0 or 1.
const INFIX: Partial<Record<Op, string>> = {
  add: "+", sub: "-", mul: "*", div: "/", less: "<", equal: "==", beq: "==", and: "&", or: "|", iless: "<", ieq: "==",
};
// An Int in 32 bits (C163, the plain profile's; C66c's in shaders): an
// int32_t, wrapped as WebAssembly's i32 wraps, and past 32 bits it spends
// the fuel, as a budget running out does (js-scalar.ts, wasm-rt.ts).
const INT32_C: Partial<Record<Op, string>> = {
  iadd: "static int32_t lab_iadd(int32_t a, int32_t b) { int64_t r = (int64_t)a + b; if (r > INT32_MAX || r < INT32_MIN) lab_fuel = -1; return (int32_t)(uint32_t)r; }",
  isub: "static int32_t lab_isub(int32_t a, int32_t b) { int64_t r = (int64_t)a - b; if (r > INT32_MAX || r < INT32_MIN) lab_fuel = -1; return (int32_t)(uint32_t)r; }",
  imul: "static int32_t lab_imul(int32_t a, int32_t b) { int64_t r = (int64_t)a * b; if (r > INT32_MAX || r < INT32_MIN) lab_fuel = -1; return (int32_t)(uint32_t)r; }",
  ineg: "static int32_t lab_ineg(int32_t a) { if (a == INT32_MIN) lab_fuel = -1; return (int32_t)(0u - (uint32_t)a); }",
  iabs: "static int32_t lab_iabs(int32_t a) { if (a == INT32_MIN) lab_fuel = -1; return a < 0 ? (int32_t)(0u - (uint32_t)a) : a; }",
};
const LIBM: Partial<Record<Op, string>> = { sqrt: "sqrt", abs: "fabs", floor: "floor" };
const FDLIBM: Partial<Record<Op, string>> = {
  sin: "lab_fdlibm_sin", cos: "lab_fdlibm_cos", tan: "lab_fdlibm_tan", exp: "lab_fdlibm_exp", log: "lab_fdlibm_log", pow: "lab_fdlibm_pow", atan2: "lab_fdlibm_atan2",
};
// The same functions from the platform's libm (C144).
const PLATFORM: Partial<Record<Op, string>> = { sin: "sin", cos: "cos", tan: "tan", exp: "exp", log: "log", pow: "pow", atan2: "atan2" };
const PRINTED = new Set<SExpr["k"]>([
  "num", "bool", "local", "let", "if", "op", "call", "make", "get", "budget", "new", "list", "field", "tag", "case",
  "closure", "cap", "apply", "fail", "attempt", "set", "zero", "int", "text", "rt", "abort", "handle", "world", "released",
]);
// std's Array's runtime functions, one copy per item type (scalar.ts).
const ARRAY_FN = /^array\.(\w+)\.a(\d+)$/;
// std's Table's runtime functions, one copy per table type (C63h).
const TABLE_FN = /^table\.(\w+)\.t(\d+)(?:\.e(\d+))?$/;
const LIST_TEXT = "std.list<type.string<>>", OPTION_TEXT = "std.optional<type.string<>>", OPTION_INT = "std.optional<type.int<>>", LIST_INT = "std.list<type.int<>>", BYTES_T = "std.bytes<>";

// The runtime of counted cells. A null cell (a box's value before the
// search sets it) is never counted.
// With threads (L101, `par:map`), each thread has its own status, cells
// and free lists (TL), and a cell another thread may hold too has the top
// bit of its count set (lab_share) and its count changed atomically.
const cellsC = (threads: boolean) => {
  const TL = threads ? "_Thread_local " : "";
  return `typedef struct lab_cell { uint32_t rc; uint16_t type; uint8_t tag, size; } lab_cell;
typedef struct { lab_cell h; void (*code)(void); } lab_closure;
static ${TL}int lab_st = 0; // 1: no answer, 2: aborted, with lab_reason
static ${TL}lab_cell *lab_reason = 0;
static ${TL}int64_t lab_live = 0;
static ${TL}lab_cell **lab_dead = 0;
static ${TL}size_t lab_dead_n = 0, lab_dead_cap = 0;
static void lab_oom(void) { fputs("out of memory\\n", stderr); exit(3); }
// Cells up to 256 bytes come in sizes 8 bytes apart, each with a list of
// the free ones, cut from blocks that are never given back (as Lean's and
// Koka's runtimes keep small objects); a cell's size (in 8s, 0 for a
// bigger one from malloc) sits in its header. Under a sanitizer each is
// malloc's, so it sees every cell.
#if defined(__SANITIZE_ADDRESS__) || defined(LAB_MALLOC)
#define LAB_SIZES 0
#elif defined(__has_feature)
#if __has_feature(address_sanitizer)
#define LAB_SIZES 0
#endif
#endif
#ifndef LAB_SIZES
#define LAB_SIZES 32
#endif
static ${TL}void *lab_unused[LAB_SIZES + 1];
static ${TL}char *lab_block = 0, *lab_block_end = 0;
static void *lab_new(size_t size, uint16_t type, uint8_t tag) {
  size_t k = (size + 7) >> 3;
  lab_cell *c;
  if (k > LAB_SIZES) { c = malloc(size); k = 0; }
  else if (lab_unused[k]) { c = lab_unused[k]; lab_unused[k] = *(void **)c; }
  else {
    if (lab_block_end - lab_block < (ptrdiff_t)(8 * k)) { lab_block = malloc(1 << 18); lab_block_end = lab_block ? lab_block + (1 << 18) : 0; }
    c = (lab_cell *)lab_block; lab_block += 8 * k;
  }
  if (!c) lab_oom();
  c->rc = 1; c->type = type; c->tag = tag; c->size = (uint8_t)k;
  lab_live++;
  return c;
}
static inline void lab_free(lab_cell *c) {
  lab_live--;
#if LAB_SIZES
  uint8_t k = c->size;
  if (k) { *(void **)c = lab_unused[k]; lab_unused[k] = c; return; }
#endif
  free(c);
}
${threads ? `#define LAB_SHARED 0x80000000u
#define LAB_RC(c) __atomic_load_n(&(c)->rc, __ATOMIC_RELAXED)
static inline lab_cell *lab_dup(lab_cell *c) { uint32_t r; if (c && (r = LAB_RC(c))) { if (r & LAB_SHARED) __atomic_fetch_add(&c->rc, 1, __ATOMIC_RELAXED); else c->rc = r + 1; } return c; }
static inline int lab__last(lab_cell *c) { uint32_t r = LAB_RC(c); if (r & LAB_SHARED) return __atomic_sub_fetch(&c->rc, 1, __ATOMIC_ACQ_REL) == LAB_SHARED; c->rc = r - 1; return r == 1; }` : `#define LAB_RC(c) ((c)->rc)
static inline lab_cell *lab_dup(lab_cell *c) { if (c && c->rc) c->rc++; return c; }
#define lab__last(c) (--(c)->rc == 0)`}
// One count fewer; a cell that has none left waits on lab_dead.
static inline void lab_dec(lab_cell *c) {
  if (c && LAB_RC(c) && lab__last(c)) {
    if (lab_dead_n == lab_dead_cap) { lab_dead_cap = lab_dead_cap ? 2 * lab_dead_cap : 64; lab_dead = realloc(lab_dead, lab_dead_cap * sizeof *lab_dead); if (!lab_dead) lab_oom(); }
    lab_dead[lab_dead_n++] = c;
  }
}
static void lab_fields(lab_cell *c);
static void lab_drop(lab_cell *c) {
  if (!c || !LAB_RC(c) || !lab__last(c)) return;
  size_t base = lab_dead_n;
  lab_fields(c);
  lab_free(c);
  while (lab_dead_n > base) { lab_cell *d = lab_dead[--lab_dead_n]; lab_fields(d); lab_free(d); }
}`;
};

// Marking what a map's items and function reach as shared (L101), before
// any other thread sees it: each cell's top bit, its fields' through
// lab_shares (made with lab_fields). A table or a box can't be shared (its
// store is changed in place), and lab_share_no says one was met: the map
// then runs on one thread.
const SHARE_C = `static int lab_share_no = 0;
static lab_cell **lab_share_st = 0;
static size_t lab_share_n = 0, lab_share_cap = 0;
static void lab_share(lab_cell *c) {
  if (!c || !c->rc || (c->rc & LAB_SHARED)) return;
  c->rc |= LAB_SHARED;
  if (lab_share_n == lab_share_cap) { lab_share_cap = lab_share_cap ? 2 * lab_share_cap : 64; lab_share_st = realloc(lab_share_st, lab_share_cap * sizeof *lab_share_st); if (!lab_share_st) lab_oom(); }
  lab_share_st[lab_share_n++] = c;
}
static inline void lab_int_share(lab_int x) { if (!LAB_IS_SMALL(x)) lab_share((lab_cell *)LAB_BIG(x)); }
static void lab_shares(lab_cell *c);
static void lab_shared(void) { while (lab_share_n) lab_shares(lab_share_st[--lab_share_n]); }`;

// The threads a map's items are shared out on (L101): started at the
// first map worth it and kept, as many as the cores less one (or
// TERS_WORKERS), each running every job given to lab_pool_run beside the
// thread that gave it. A map met on one of them, or inside a job, stays
// on its thread. With TERS_BRANCHES=say, how many items they ran is said
// at the exit, as compiled JavaScript says it (branches-rt.ts).
const POOL_C = `static _Thread_local int lab_in_par = 0, lab_on_pool = 0;
static int64_t lab_par_items = 0;
static void lab_par_say(void) { fprintf(stderr, "items on threads: %lld\\n", (long long)__atomic_load_n(&lab_par_items, __ATOMIC_RELAXED)); }
static pthread_mutex_t lab_pool_m = PTHREAD_MUTEX_INITIALIZER;
static pthread_cond_t lab_pool_go = PTHREAD_COND_INITIALIZER, lab_pool_done = PTHREAD_COND_INITIALIZER;
static void (*lab_pool_fn)(void *);
static void *lab_pool_arg;
static unsigned long lab_pool_gen = 0;
static int lab_pool_busy = 0, lab_pool_n = -1;
static int64_t lab_pool_live = 0;
static void *lab_pool_loop(void *unused) {
  unsigned long seen = 0;
  (void)unused;
  lab_in_par = lab_on_pool = 1;
  for (;;) {
    pthread_mutex_lock(&lab_pool_m);
    while (lab_pool_gen == seen) pthread_cond_wait(&lab_pool_go, &lab_pool_m);
    seen = lab_pool_gen;
    void (*fn)(void *) = lab_pool_fn;
    void *arg = lab_pool_arg;
    pthread_mutex_unlock(&lab_pool_m);
    int64_t live = lab_live;
    fn(arg);
    pthread_mutex_lock(&lab_pool_m);
    lab_pool_live += lab_live - live;
    if (--lab_pool_busy == 0) pthread_cond_signal(&lab_pool_done);
    pthread_mutex_unlock(&lab_pool_m);
  }
  return 0;
}
static int lab_pool_ready(void) {
  if (lab_in_par) return 0;
  if (lab_pool_n < 0) {
    const char *w = getenv("TERS_WORKERS");
    long n = w ? atol(w) : sysconf(_SC_NPROCESSORS_ONLN) - 1;
    pthread_attr_t a;
    lab_pool_n = 0;
    if (getenv("TERS_BRANCHES") && !strcmp(getenv("TERS_BRANCHES"), "say")) atexit(lab_par_say);
    pthread_attr_init(&a);
    pthread_attr_setstacksize(&a, sizeof(void *) == 8 ? (size_t)1 << 28 : (size_t)1 << 24);
    for (long k = 0; k < (n > 15 ? 15 : n); k++) { pthread_t t; if (pthread_create(&t, &a, lab_pool_loop, 0)) break; pthread_detach(t); lab_pool_n++; }
  }
  return lab_pool_n > 0;
}
static void lab_pool_run(void (*fn)(void *), void *arg) {
  pthread_mutex_lock(&lab_pool_m);
  lab_pool_fn = fn; lab_pool_arg = arg; lab_pool_busy = lab_pool_n; lab_pool_gen++;
  pthread_cond_broadcast(&lab_pool_go);
  pthread_mutex_unlock(&lab_pool_m);
  lab_in_par = 1;
  fn(arg);
  lab_in_par = 0;
  pthread_mutex_lock(&lab_pool_m);
  while (lab_pool_busy) pthread_cond_wait(&lab_pool_done, &lab_pool_m);
  lab_live += lab_pool_live; lab_pool_live = 0;
  pthread_mutex_unlock(&lab_pool_m);
}
// Items that took a millisecond on this thread are worth sharing.
static int lab_par_worth(const struct timespec *t0) {
  struct timespec t;
  clock_gettime(CLOCK_MONOTONIC, &t);
  return (double)(t.tv_sec - t0->tv_sec) * 1e3 + (double)(t.tv_nsec - t0->tv_nsec) / 1e6 >= 1;
}`;

export interface CProgram { c: string; names: Map<number, string>; refused: Map<number, string> }

// Where an answer that isn't there goes: the attempt's label, the locals
// it keeps, and how many temporaries were waiting when it began.
interface Target { label: string; keep: Set<number>; pending: number }

// `harness`: a main that reads calls from standard input, one a line (the
// function's index, then its inputs), and prints each answer the same way,
// then how many cells are left: how the tests compare with the evaluator.
// A Float64 is its bits in hex, a Bool 0 or 1, a record its fields, data
// its case's number then its fields; a function with one answer or none
// prints `?` first when it has none.
// `main`: the definition to run as the program, with the arguments (a
// List Text) if it takes them, on a thread with a big stack (1 GiB of
// address space, used only as deep as the program goes); its Int or Float64
// is the exit code, and an Abort's reason goes to standard error, with 1.
// `math`: where sin, cos, tan, exp, log, pow and atan2 come from: the
// platform's libm (the default), or V8's fdlibm carried in the program, the
// same bits as Node's Math (the agreement tests).
// A program's own operation, performed (scalar.ts): its effect and number.
const isPerform = (fn: string) => fn.startsWith("perform:");
// A program's own handler of operations answered at once (L213c4): its
// cases pushed while the code it handles runs, and a perform's case the
// nearest's (scalar.ts handleOps with `handlers`).
const STACK = /^(hpush|hpop|handler|hhas|htake|hgive):([^:]+)(?::(\d+))?$/;
const isStack = (fn: string) => STACK.test(fn);
// A program's own handler whose cases keep the rest (C44b), and a perform
// of one of its operations: the code handled on a fiber (c-rt "fibers").
const FIBER = /^f(handle|perform|ready|park|branches)(:|$)/;
const isFiber = (fn: string) => FIBER.test(fn);
// A map whose function only computes, its items on threads (L101), and a
// together whose actions only compute, its actions so (C201).
// A search split by its first choice (C203): the item a thread's run
// keeps of it, and a search inside that keeps all of its own (scalar.ts).
const isSplit = (fn: string) => fn === "choose.split" || fn === "split.hold" || fn === "split.give";
type SearchHow = "count" | "all" | "first";
const folds = (job: string) => job === "add" || job === "max" || job === "min";
const isPar = (fn: string) => fn.startsWith("par:fold:") || fn === "par:count:search" || fn === "par:all:search" || fn === "par:first:search" || fn === "par:map" || fn === "par:keep" || fn === "par:all" || fn === "par:any" || fn === "par:first" || fn === "par:together";
// What crosses to a C host (L69b1): each shape's type in the program and
// at the host.
const HOST_C: Partial<Record<Shape["k"], { lab: string; host: string }>> = {
  int: { lab: "lab_int", host: "int64_t" }, float: { lab: "double", host: "double" }, text: { lab: "lab_cell *", host: "const char *" },
  bool: { lab: "int32_t", host: "int" }, unit: { lab: "int32_t", host: "void" },
};
// What every host wrapper uses: the host's way to fail (lab_host_fail,
// which hosts/c.c may call), a Text as a C string, and the Abort.
const HOST_RT = `static const char *lab_host_why = 0;
static void lab_host_fail(const char *why) { lab_host_why = why ? why : "no reason given"; }
static char *lab__host_str(lab_cell *t) { char *s = malloc((size_t)LAB_TN(t) + 1); if (!s) lab_oom(); memcpy(s, LAB_TB(t), LAB_TN(t)); s[LAB_TN(t)] = 0; return s; }
static void lab__host_abort(const char *name, const char *what, const char *detail) {
  size_t n = strlen(name) + strlen(what) + strlen(detail) + 16;
  char *s = malloc(n);
  if (!s) lab_oom();
  int k = snprintf(s, n, "the host's %s %s%s", name, what, detail);
  lab_drop(lab_reason);
  lab_reason = lab__text_of(s, (size_t)k);
  free(s);
  lab_st = 2;
}`;

// `hosts`: the program's own operations (core-js.ts hostOpsOf) and its
// hosts/c.c, which answers those nothing in the program handles (L69b1).
// Which cells a page's parts read, and which were written since the page
// was last run again (C199f): a part runs again on each change, but html.ts
// mounts it again only when a cell it read was written, and then its
// elements are new (their animations start again, c-layout.ts).
const READS_C = String.raw`
static void **lab_rd, **lab_wr;
static int lab_nrd, lab_crd, lab_rding, lab_nwr, lab_cwr;
static void *lab_touch(void *c) {
  if (lab_rding) { if (lab_nrd == lab_crd) { lab_crd = lab_crd ? 2 * lab_crd : 16; lab_rd = realloc(lab_rd, sizeof *lab_rd * (size_t)lab_crd); } lab_rd[lab_nrd++] = c; }
  return c;
}
static void lab_wrote(void *c) {
  for (int j = 0; j < lab_nwr; j++) if (lab_wr[j] == c) return;
  if (lab_nwr == lab_cwr) { lab_cwr = lab_cwr ? 2 * lab_cwr : 16; lab_wr = realloc(lab_wr, sizeof *lab_wr * (size_t)lab_cwr); }
  lab_wr[lab_nwr++] = c;
}
`;

// A host with no screen (C199b): the page kept as a tree of nodes, printed
// as HTML the way the tests' fake document prints it (ters/test/
// fakedom.ts), and a main that does what its arguments say, printing the
// page after each: click:ID, keydown:ID:KEY, input:ID:TEXT (typed into the
// field, then "input"), frames:N:MS (N frames MS apart). ID is the first
// element whose id attribute it is.
// Each page printed ends with a record separator (\x1e) and a newline.
const HEADLESS_C = String.raw`
typedef struct tn { char *tag, *text, *value, **an, **av, **ev; int checked, na, nk, ne, *eh; struct tn **kids; } tn;
static char *t_dup(const char *s, size_t n) { char *r = malloc(n + 1); memcpy(r, s, n); r[n] = 0; return r; }
static void *t_element(void *c, const char *tag, size_t n) { (void)c; tn *e = calloc(1, sizeof *e); e->tag = t_dup(tag, n); e->value = t_dup("", 0); return e; }
static void *t_text(void *c, const char *s, size_t n) { (void)c; tn *e = calloc(1, sizeof *e); e->text = t_dup(s, n); return e; }
static void t_set_text(void *c, void *x, const char *s, size_t n) { (void)c; tn *e = x; free(e->text); e->text = t_dup(s, n); }
static int t_is(const char *a, const char *b, size_t n) { return strlen(a) == n && !memcmp(a, b, n); }
static void t_set_attribute(void *c, void *x, const char *k, size_t kn, const char *v, size_t vn) {
  (void)c; tn *e = x;
  if (t_is("value", k, kn)) { free(e->value); e->value = t_dup(v, vn); return; }
  if (t_is("checked", k, kn)) { e->checked = t_is("true", v, vn); return; }
  for (int j = 0; j < e->na; j++) if (t_is(e->an[j], k, kn)) { free(e->av[j]); e->av[j] = t_dup(v, vn); return; }
  e->an = realloc(e->an, sizeof *e->an * (size_t)(e->na + 1)); e->av = realloc(e->av, sizeof *e->av * (size_t)(e->na + 1));
  e->an[e->na] = t_dup(k, kn); e->av[e->na++] = t_dup(v, vn);
}
static void t_remove_attribute(void *c, void *x, const char *k, size_t kn) {
  (void)c; tn *e = x;
  for (int j = 0; j < e->na; j++) if (t_is(e->an[j], k, kn)) { free(e->an[j]); free(e->av[j]); for (int i = j + 1; i < e->na; i++) { e->an[i - 1] = e->an[i]; e->av[i - 1] = e->av[i]; } e->na--; return; }
}
static void t_append(void *c, void *p, void *k) { (void)c; tn *e = p; e->kids = realloc(e->kids, sizeof *e->kids * (size_t)(e->nk + 1)); e->kids[e->nk++] = k; }
static void t_clear(void *c, void *p) { (void)c; ((tn *)p)->nk = 0; }
static void t_listen(void *c, void *x, const char *ev, size_t n, int h) {
  (void)c; tn *e = x;
  e->ev = realloc(e->ev, sizeof *e->ev * (size_t)(e->ne + 1)); e->eh = realloc(e->eh, sizeof *e->eh * (size_t)(e->ne + 1));
  e->ev[e->ne] = t_dup(ev, n); e->eh[e->ne++] = h;
}
static void t_gone(void *c, void *x) {
  (void)c; tn *e = x;
  for (int j = 0; j < e->na; j++) { free(e->an[j]); free(e->av[j]); }
  for (int j = 0; j < e->ne; j++) free(e->ev[j]);
  free(e->an); free(e->av); free(e->ev); free(e->eh); free(e->kids); free(e->tag); free(e->text); free(e->value); free(e);
}
static void t_print(tn *e) {
  if (!e->tag) { fputs(e->text, stdout); return; }
  printf("<%s", e->tag);
  for (int j = 0; j < e->na; j++) printf(" %s=\"%s\"", e->an[j], e->av[j]);
  if (!strcmp(e->tag, "input")) printf(" value=\"%s\"%s", e->value, e->checked ? " checked" : "");
  putchar('>');
  for (int j = 0; j < e->nk; j++) t_print(e->kids[j]);
  printf("</%s>", e->tag);
}
static tn *t_find(tn *e, const char *id) {
  if (!e->tag) return 0;
  for (int j = 0; j < e->na; j++) if (!strcmp(e->an[j], "id") && !strcmp(e->av[j], id)) return e;
  for (int j = 0; j < e->nk; j++) { tn *r = t_find(e->kids[j], id); if (r) return r; }
  return 0;
}
// Every element that listens for frames gets one, s seconds after the
// last (a browser's frame event, html.ts everyFrame).
static void t_frame(tn *e, double s) {
  if (!e->tag) return;
  for (int j = 0; j < e->ne; j++) if (!strcmp(e->ev[j], "frame")) ters_page_event(e->eh[j], "", 0, "", 0, 0, 0, s);
  for (int j = 0; j < e->nk; j++) t_frame(e->kids[j], s);
}
static void t_frames(tn *root, double s) { t_frame(root, s); ters_page_frame(); }
static void t_fire(tn *e, const char *type, const char *key) {
  // A handler may draw this element again: what it listens to is copied
  // first.
  int ne = e->ne, *hs = malloc(sizeof *hs * (size_t)(ne + 1)), m = 0;
  for (int j = 0; j < ne; j++) if (!strcmp(e->ev[j], type)) hs[m++] = e->eh[j];
  char *value = t_dup(e->value, strlen(e->value));
  for (int j = 0; j < m; j++) ters_page_event(hs[j], value, strlen(value), key, strlen(key), 0, 0, 0);
  free(value); free(hs);
}
int main(int argc, char **argv) {
  static ters_host h = { 0, t_element, t_text, t_set_text, t_set_attribute, t_remove_attribute, t_append, t_clear, t_listen, t_gone };
  tn *root = ters_page_start(&h);
  if (!root) return 1;
  t_print(root); fputs("\x1e\n", stdout);
  for (int a = 1; a < argc; a++) {
    char *s = t_dup(argv[a], strlen(argv[a])), *id = strchr(s, ':'), *more;
    if (!id) return 2;
    *id++ = 0;
    if ((more = strchr(id, ':'))) *more++ = 0;
    if (!strcmp(s, "frames")) {
      // frames:N:MS, N frames MS milliseconds apart, as the clock goes.
      int n = atoi(id);
      double ms = more ? atof(more) : 16;
      for (int k = 0; k < n; k++) { struct timespec ts = { 0, (long)(ms * 1e6) }; nanosleep(&ts, 0); t_frames(root, ms / 1000); }
      t_print(root); fputs("\x1e\n", stdout);
      free(s);
      continue;
    }
    tn *e = t_find(root, id);
    if (!e) { fprintf(stderr, "no element with id %s\n", id); return 2; }
    if (!strcmp(s, "input")) { free(e->value); e->value = t_dup(more ? more : "", more ? strlen(more) : 0); t_fire(e, "input", ""); }
    else t_fire(e, s, more ? more : "");
    t_print(root); fputs("\x1e\n", stdout);
    free(s);
  }
  fflush(stdout);
  return 0;
}
`;

// `page` (C199b, NATIVE-APPS.md): main gives Html, mounted on a view host
// (`ters_page_start`, `ters_page_event`) instead of run as a program;
// "headless" adds HEADLESS_C's host and main; "ui" adds c-layout.ts's
// style and layout over a ters_ui (C199d), and "ui-headless" a ui that
// prints where each box went.
export function emitC(lowered: CoreIR, opts: { harness?: boolean; main?: string; math?: "platform" | "fdlibm"; hosts?: { ops: HostOps; c?: string }; page?: "api" | "headless" | "ui" | "ui-headless" } = {}): CProgram {
  const LIBRARY = opts.math === "fdlibm" ? FDLIBM : PLATFORM;
  const { shapes } = lowered;
  // A value that can't be had (a search's k given no answer) is the
  // expression it's in failing, when nothing before it in that
  // expression does anything: C has no value of every type to stand in.
  const pure = (e: SExpr) => !walk(e).some((x) => ["call", "apply", "rt", "world", "set", "abort"].includes(x.k));
  const settle = (e: SExpr): SExpr => {
    const m = mapKids(e, settle);
    const strict = m.k === "if" ? [m.cond] : m.k === "let" ? [m.value] : m.k === "case" ? [m.scrut] : m.k === "set" ? [m.rec, m.value]
      : ["op", "call", "make", "new", "rt", "world", "get", "field", "tag", "closure", "apply"].includes(m.k) ? kids(m) : [];
    const j = strict.findIndex((x) => x.k === "fail" || x.k === "abort");
    return j >= 0 && strict.slice(0, j).every(pure) ? strict[j] : m;
  };
  const funcs = lowered.funcs.map((f) => ({ ...f, locals: [...f.locals], body: settle(f.body) }));
  // The Int-in-32-bits helpers the code calls (INT32_C).
  const int32Used = new Set<Op>();
  const used = new Set<string>(["iadd", "isub", "imul", "ineg", "iabs", "new", "free", "unused", "block", "block_end", "dup", "dec", "drop", "fields", "oom", "live", "st", "reason", "fuel", "mod", "in", "out", "bits", "run", "code", "argc", "argv", "hex", "hexd", "word", "token", ...RESERVED, ...lowered.arrays.flatMap((_, i) => ["empty", "of", "items", "length", "at", "push", "first", "rest", "pushFront", "get", "replaceAt"].map((op) => `array_${op}_a${i}`)), ...lowered.tables.flatMap((t, i) => [...["empty", "put", "remove", "has", "size", "at"].map((op) => `table_${op}_t${i}`), ...t.entries.map((_, j) => `table_entries_t${i}_e${j}`), `Table_t${i}`, `Store_t${i}`, ...["find", "change", "grow", "hash", "eq", "cmp", "sort", "made", "store", "reroot"].map((h) => `_${h}_t${i}`)])]);
  const ident = (hint: string) => {
    const base = hint.normalize("NFKD").replace(/[^A-Za-z0-9_]+/g, "_").replace(/^_+|_+$/g, "") || "f";
    let n = base;
    for (let i = 2; used.has(n); i++) n = `${base}_${i}`;
    used.add(n);
    return n;
  };

  // What can be printed: the kinds above, on Float64s, Bools, records,
  // data and functions, calling only what can be printed.
  const refused = new Map<number, string>();
  const why = (t: LType): string | null =>
    t === "f64" || t === "i32" || t === "int32" || t === "i64" || t === "int" || t === "text" ? null
    : isRecord(t) ? t.fields.map((x) => why(x.t)).find(Boolean) ?? null
    : isData(t) ? null
    : isArray(t) ? why(t.item)
    : isTable(t) ? why(t.value)
    : [...(t as FType).params, (t as FType).result].map(why).find(Boolean) ?? null;
  // A program's own operation that nothing in it handles (FOREIGN.md,
  // L69b1): answered by hosts/c.c's host_<its id>, its values crossing
  // as C's own (an Int as int64_t, a Float64 as double, a Text as a
  // C string, a Bool as int), checked on the way back as the evaluator's
  // border checks hosts/js.js's. One that isn't there is a refusal that
  // names the operation.
  const hostOf = (fn: string) => { const [, e, op] = fn.split(":"); return opts.hosts?.ops[`${e}:${op}`]; };
  const hostWhy = (fn: string): string | null => {
    const h = hostOf(fn);
    if (!h) return null;
    const bad = [...h.ins.filter((x) => x.k !== "unit"), h.out].find((x) => !HOST_C[x.k]) ?? h.ins.find((x) => x.k === "unit");
    if (bad) return `${h.name} takes or gives ${bad.k === "list" ? "a list" : bad.k === "record" ? "a record" : "a value"}, which doesn't cross to a C host yet`;
    if (lowered.int32 && [...h.ins, h.out].some((x) => x.k === "int")) return `${h.name} takes or gives an Int, which a C host gets as int64_t, not in 32 bits`;
    if (!opts.hosts?.c) return `${h.name} is answered by the host, and the program has no hosts/c.c`;
    if (!new RegExp(`\\b${hostName(h.op)}\\s*\\(`).test(opts.hosts.c)) return `hosts/c.c has no answer for ${h.name} (${h.op}): no ${hostName(h.op)}`;
    return null;
  };
  funcs.forEach((f, i) => {
    const t = [...f.locals, f.result].map(why).find(Boolean);
    if (t) return refused.set(i, t);
    const k = walk(f.body).find((e) => !PRINTED.has(e.k) || (e.k === "rt" && (isPerform(e.fn) ? !!hostWhy(e.fn) : !isStack(e.fn) && !isFiber(e.fn) && !isPar(e.fn) && !isSplit(e.fn) && !RT_C.has(e.fn) && !ARRAY_FN.test(e.fn) && !TABLE_FN.test(e.fn))) || (e.k === "world" && !RT_C.has(`world.${e.op}`)));
    if (k) refused.set(i, k.k === "rt" ? hostWhy(k.fn) ?? `${k.fn} isn't in C's runtime` : k.k === "world" ? `the world's ${k.op} isn't in C's runtime` : `${k.k} isn't printed as C`);
  });
  const callees = (e: SExpr) => walk(e).flatMap((x) => (x.k === "call" || x.k === "closure" ? [x.fn] : []));
  for (let changed = true; changed;) {
    changed = false;
    funcs.forEach((f, i) => {
      if (refused.has(i)) return;
      const c = callees(f.body).find((g) => refused.has(g));
      if (c !== undefined) { refused.set(i, `it calls ${funcs[c].name}, which isn't in C yet`); changed = true; }
    });
  }
  const kept = funcs.map((_, i) => i).filter((i) => !refused.has(i));
  // Maps on threads (L101): a definition's value is then worked out at
  // each use, as no thread may keep it for the others.
  const threads = kept.some((i) => walk(funcs[i].body).some((e) => e.k === "rt" && isPar(e.fn)));
  // A definition's value worked out once (C173b), as WebAssembly and the
  // core IR's JavaScript keep it: what a function of no inputs gives (a
  // record, data or a text) is held in a static of its own from its first
  // call, each call after given one more count of it. The test harness
  // lets go of them after each call, so its count of cells left is still 0.
  // An array too (C30): the static's count makes replace at copy it, as
  // it does any array another holds.
  const once = new Set(kept.filter((i) => { const f = funcs[i]; return !threads && f.value && !f.params.length && !f.partial && !f.spends && (f.result === "text" || isRecord(f.result) || isData(f.result) || isArray(f.result)); }));

  // Types: every record, data type and function type the kept functions
  // mention, and the shapes of their closures.
  const records = new Map<string, RType>(), data = new Map<string, DType>(), fns = new Map<string, FType>(), arrays = new Map<string, AType>(), tables = new Map<string, TType>();
  const collect = (t: LType) => {
    if (isTable(t) && !tables.has(t.key)) { tables.set(t.key, t); collect(t.keyT); collect(t.value); t.entries.forEach(collect); }
    if (isArray(t) && !arrays.has(t.key)) { arrays.set(t.key, t); collect(t.item); if (t.list) collect(t.list); }
    if (isRecord(t) && !records.has(t.key)) { records.set(t.key, t); t.fields.forEach((x) => collect(x.t)); }
    if (isData(t) && !data.has(t.key)) { data.set(t.key, t); t.cases.forEach((c) => c.fields.forEach((x) => collect(x.t))); }
    if (isFn(t) && !fns.has(t.key)) { fns.set(t.key, t); [...t.params, t.result].forEach(collect); }
  };
  const shaped = new Set<number>();
  for (const i of kept) {
    [...funcs[i].params, ...funcs[i].locals, funcs[i].result].forEach(collect);
    walk(funcs[i].body).forEach((e) => {
      if ("t" in e && typeof e.t === "object") collect(e.t as LType);
      if (e.k === "closure" || e.k === "cap") shaped.add(e.shape);
      const a = e.k === "rt" ? ARRAY_FN.exec(e.fn) : null;
      if (a) collect(lowered.arrays[Number(a[2])]);
      const tb = e.k === "rt" ? TABLE_FN.exec(e.fn) : null;
      if (tb) collect(lowered.tables[Number(tb[2])]);
      // A runtime function that makes or takes a list of texts (split,
      // join all): its list type, though no function here names it.
      if (e.k === "rt" && isPar(e.fn)) collect(e.host!.t);
      if (e.k === "rt" && !a && !tb && !isPerform(e.fn) && !isStack(e.fn) && !isFiber(e.fn) && !isPar(e.fn) && !isSplit(e.fn)) {
        const r = runtime(e.fn);
        if (r.result === "list" || r.params.some(([, t]) => t === "list")) { const d = lowered.data.find((x) => x.key === (r.list ?? LIST_TEXT)); if (d) collect(d); }
      }
    });
  }
  shaped.forEach((s) => { collect(shapes[s].t); shapes[s].caps.forEach(collect); });
  const boxes = [...records.values()].filter((r) => r.mutable);
  const sname = new Map([...records.values()].map((r) => [r.key, ident(r.name)]));
  const dname = new Map([...data.values()].map((d) => [d.key, ident(d.name)]));
  const fname = new Map([...fns.keys()].map((k) => [k, ident("Fn")]));
  const shapeName = new Map([...shaped].map((s) => [s, ident(`Closure`)]));
  // Cell types, numbered: data types, boxes, closures' shapes.
  const tnum = new Map<string, number>();
  [...data.keys(), ...boxes.map((b) => b.key), ...[...shaped].map((s) => `shape ${s}`), ...[...arrays.keys()].flatMap((k) => [`array ${k}`, `buf ${k}`]), ...[...tables.keys()].map((k) => `table ${k}`)].forEach((k, j) => tnum.set(k, j));
  const aname = new Map([...arrays.keys()].map((k) => [k, { view: ident("Array"), buf: ident("Buffer") }]));
  const cname = (t: DType, c: number) => `${dname.get(t.key)}_${t.cases[c].name.replace(/[^A-Za-z0-9_]/g, "_")}`;
  const names = new Map(kept.map((i) => [i, `lab_${ident(funcs[i].name)}`]));

  // Cells of the same fields are one size, so one can take the other's place.
  const layout = (fs: { t: LType }[]) => fs.map((x) => ty(x.t)).join(", ");
  const ty = (t: LType): string => (t === "f64" ? "double" : t === "i32" || t === "int32" ? "int32_t" : t === "i64" ? "int64_t" : t === "int" ? "lab_int" : isRecord(t) && !t.mutable ? sname.get(t.key)! : "lab_cell *");
  // Whether a value of t is a cell, or holds counts (an Int may be a cell).
  const cell = (t: LType) => t === "text" || isData(t) || isFn(t) || isArray(t) || isTable(t) || (isRecord(t) && !!t.mutable);
  const counted = (t: LType): boolean => cell(t) || t === "int" || (isRecord(t) && t.fields.some((x) => counted(x.t)));
  const dup = (t: LType, x: string) => (cell(t) ? `lab_dup(${x})` : t === "int" ? `lab_int_dup(${x})` : isRecord(t) && counted(t) ? `${sname.get(t.key)}_dup(${x})` : x);
  const drop = (t: LType, x: string) => (cell(t) ? `lab_drop(${x});` : t === "int" ? `lab_int_drop(${x});` : `${sname.get((t as RType).key)}_drop(${x});`);
  const dec = (t: LType, x: string) => (cell(t) ? `lab_dec(${x});` : t === "int" ? `lab_int_dec(${x});` : `${sname.get((t as RType).key)}_dec(${x});`);
  // The same, marking what it reaches shared (L101, SHARE_C).
  const share = (t: LType, x: string) => (cell(t) ? `lab_share(${x});` : t === "int" ? `lab_int_share(${x});` : `${sname.get((t as RType).key)}_share(${x});`);
  // The type of a runtime function's answer.
  const rtType = (fn: string): LType => {
    const r = runtime(fn), a = ARRAY_FN.exec(fn), tb = TABLE_FN.exec(fn);
    if (tb) {
      const t = lowered.tables[Number(tb[2])];
      return r.result === "table" ? t : r.result === "value" ? t.value : r.result === "list" ? t.entries[Number(tb[3])] : r.result as LType;
    }
    if (a) {
      const t = lowered.arrays[Number(a[2])];
      return r.result === "array" ? t : r.result === "item" ? t.item : r.result === "list" ? t.list! : r.result as LType;
    }
    if (r.result !== "list") return r.result as LType;
    const d = data.get(r.list ?? LIST_TEXT);
    if (!d) throw new Error(`${fn}'s list type isn't one the program has`);
    return d;
  };
  // The names a runtime function that makes or reads a list needs.
  const listNames = (fn: string): ListNames => {
    const bytes = fn === "world.keptBytes" || fn === "world.keptAddBytes";
    const d = data.get(fn === "world.readLine" || fn === "world.keptLine" ? OPTION_TEXT : fn === "world.keptOpen" ? OPTION_INT : bytes ? LIST_INT : fn.startsWith("world.") ? LIST_TEXT : runtime(fn).list ?? LIST_TEXT)!;
    if (bytes) {
      const tag = d.cases.findIndex((c) => c.fields.length > 0);
      return { cons: cname(d, tag), nil: cname(d, 1 - tag), type: tnum.get(d.key)!, tag, head: d.cases[tag].fields.findIndex((x) => x.t !== d), record: sname.get(BYTES_T) };
    }
    const tag = d.cases.findIndex((c) => c.fields.length > 0);
    return { cons: cname(d, tag), nil: cname(d, 1 - tag), type: tnum.get(d.key)!, tag, head: d.cases[tag].fields.findIndex((x) => x.t !== d) };
  };
  // Text and big Int constants, as static cells that are never counted;
  // and the runtime functions called.
  const statics = new Map<string, { name: string; decl: string }>(), rts = new Set<string>(), arrayFns = new Set<string>();
  // Each map on threads, by its array types and function type (parC).
  // A keep (C202) is a map whose function's answers say which items stay.
  // all pass and any pass (C202b), whose answer is the first deciding test's;
  // first where (C202c), an array of the item that first passes, or empty.
  // A fold of an array adding its items' Ints, or keeping the largest or
  // smallest (C202d: add, max, min), from the empty list's Int.
  type ParJob = "map" | "keep" | "all" | "any" | "first" | "add" | "max" | "min";
  const pars = new Map<string, { n: number; ta: AType; tf: FType; to: AType; job: ParJob }>();
  const parSite = (ta: AType, tf: FType, to: AType, job: ParJob = "map"): number => {
    const k = `${ta.key} ${tf.key} ${to.key} ${job}`;
    if (!pars.has(k)) pars.set(k, { n: pars.size, ta, tf, to, job });
    if (folds(job)) rts.add(job === "add" ? "int.add" : "int.less");
    arrayFns.add(`array.length.a${ta.index}`).add(`array.empty.a${to.index}`);
    return pars.get(k)!.n;
  };
  // A count of a search split by its first choice (C203), by its closure's
  // type, and each list type a choice splits.
  const countPars = new Map<string, { n: number; tf: FType; how: SearchHow }>();
  const countSite = (tf: FType, how: SearchHow): number => {
    if (!countPars.has(tf.key)) countPars.set(tf.key, { n: countPars.size, tf, how });
    if (how === "count") rts.add("int.add");
    return countPars.get(tf.key)!.n;
  };
  const splitLists = new Map<string, { n: number; t: DType }>();
  let splits = false;
  const togethers = new Map<string, { n: number; ti: DType; to: DType }>();
  const togetherSite = (ti: DType, to: DType): number => {
    const k = `${ti.key} ${to.key}`;
    if (!togethers.has(k)) togethers.set(k, { n: togethers.size, ti, to });
    return togethers.get(k)!.n;
  };
  // The host's operations called (L69b1), each a wrapper lab_host_<n>.
  const hostsUsed = new Map<string, number>(), hostTypes = new Map<string, LType>();
  // The effects a program handles itself on the handler stack, numbered.
  const effectNums = new Map<string, number>();
  // Handlers on fibers (C44b): each effect's number, each handler's
  // driver and the rest's code, and the globals values cross by (an
  // operation's inputs, the value it's resumed with, the code's value).
  const fiberEffects = new Map<string, number>(), fiberC: string[] = [], fiberGlobals = new Map<string, string>();
  // An operation of some type (await's a) has a global for each C type.
  const fiberGlobal = (name: string, t: LType) => {
    const c = ty(t), n = `${name}_${c.replace(/[^A-Za-z0-9_]/g, "")}`;
    fiberGlobals.set(n, c);
    return n;
  };
  const fiberEffect = (e: string) => { let n = fiberEffects.get(e); if (n === undefined) fiberEffects.set(e, (n = fiberEffects.size)); return n; };
  const textLit = (v: string) => {
    const k = `t ${v}`;
    if (!statics.has(k)) {
      const name = `lab_s${statics.size}`, b = [...new TextEncoder().encode(v)];
      statics.set(k, { name, decl: `static struct { lab_cell h; uint32_t n; uint8_t b[${b.length || 1}]; } ${name} = { { 0, LAB_TEXT_T, 0 }, ${b.length}, { ${b.join(", ") || "0"} } };` });
    }
    return `((lab_cell *)&${statics.get(k)!.name})`;
  };
  const intLit = (v: bigint) => {
    if (v >= -(1n << 62n) && v < 1n << 62n) return `LAB_SMALL(INT64_C(${v}))`;
    const k = `i ${v}`;
    if (!statics.has(k)) {
      const name = `lab_b${statics.size}`, ds: string[] = [];
      for (let m = v < 0n ? -v : v; m > 0n; m >>= 32n) ds.push(`${m & 0xffffffffn}u`);
      statics.set(k, { name, decl: `static struct { lab_cell h; int32_t neg; uint32_t n; uint32_t d[${ds.length}]; } ${name} = { { 0, LAB_INT_T, 0 }, ${v < 0n ? 1 : 0}, ${ds.length}, { ${ds.join(", ")} } };` });
    }
    return `((lab_int)(intptr_t)&${statics.get(k)!.name})`;
  };
  // Whether t holds an Int or a Text.
  const mentions = (t: LType, seen = new Set<string>()): boolean => {
    if (t === "int" || t === "text") return true;
    if (typeof t !== "object" || seen.has(t.key)) return false;
    seen.add(t.key);
    return isRecord(t) ? t.fields.some((x) => mentions(x.t, seen)) : isArray(t) ? mentions(t.item, seen) : isData(t) ? t.cases.some((c) => c.fields.some((x) => mentions(x.t, seen))) : [...(t as FType).params, (t as FType).result].some((x) => mentions(x, seen));
  };

  const header = (i: number, lending = false) => {
    const f = funcs[i];
    return `${ty(f.result)} ${lending ? bnames.get(i) : names.get(i)}(${f.params.map((t, j) => `${ty(t)} p${j}`).join(", ") || "void"})`;
  };
  const fuel = kept.some((i) => funcs[i].spends || walk(funcs[i].body).some((e) => e.k === "budget"));
  const math = opts.math === "fdlibm" && kept.some((i) => walk(funcs[i].body).some((e) => e.k === "op" && e.op in FDLIBM));
  for (const i of kept) funcs[i].body = readFirst(funcs[i], funcs);
  // Inputs lent, not given (C94, Perceus's borrowed parameters): a record
  // or cell input the body only reads fields of, or lends on in turn, is
  // neither dup'd by the caller nor dropped by the callee. Such a function
  // is written as name_b, which callers in the program call; `name`, the
  // one the host and closures call, gives the inputs back to name_b and
  // drops them after. A loop's inputs are set again each round, so a
  // function that loops keeps its own.
  const viaClosure = new Set(kept.flatMap((i) => walk(funcs[i].body).flatMap((e) => (e.k === "closure" ? [e.fn] : []))));
  const lent = new Map<number, Set<number>>();
  for (const i of kept) {
    const f = funcs[i];
    if (viaClosure.has(i) || calls(f.body).some((x) => x.fn === i && x.tail)) continue;
    // One that makes a new value of the input's type is an update (machine's
    // `stored`): it keeps the input, so the fields it moves on have one
    // holder and are changed in place.
    const made = new Set(walk(f.body).flatMap((e) => (e.k === "make" || e.k === "new" || e.k === "list" ? [e.t.key] : [])));
    const c = new Set(f.params.flatMap((t, j) => (((isRecord(t) && !t.mutable && counted(t)) || isData(t)) && !made.has((t as RType).key) ? [j] : [])));
    if (c.size) lent.set(i, c);
  }
  // Whether e uses local j other than as a field's record or a lent input.
  const owns = (e: SExpr, j: number): boolean => {
    if (e.k === "local") return e.i === j;
    if ((e.k === "get" || e.k === "field" || e.k === "tag") && e.rec.k === "local" && e.rec.i === j) return false;
    if (e.k === "call") return e.args.some((a, k) => (a.k === "local" && a.i === j ? !lent.get(e.fn)?.has(k) : owns(a, j)));
    return kids(e).some((x) => owns(x, j));
  };
  for (let more = true; more;) {
    more = false;
    for (const [i, ps] of lent) for (const j of [...ps]) if (owns(funcs[i].body, j)) { ps.delete(j); more = true; }
  }
  for (const [i, ps] of [...lent]) if (!ps.size) lent.delete(i);
  const bnames = new Map([...lent.keys()].map((i) => [i, ident(`${names.get(i)}_b`)]));
  const text = kept.map((i) => func(funcs[i], i));
  const ints = opts.main !== undefined || rts.size > 0 || hostsUsed.size > 0 || arrayFns.size > 0 || statics.size > 0 || kept.some((i) => [...funcs[i].params, ...funcs[i].locals, funcs[i].result].some((t) => mentions(t)));
  const cells = ints || tnum.size > 0 || kept.some((i) => funcs[i].partial);
  const tests = opts.harness ? harness() : "";

  // Records in the order they hold each other: a record's struct holds
  // another (not a box, which is a cell) by value, so the inner one is
  // declared first, and its dup, drop and dec too (C91: machine's
  // `(Int, (Instr, Int))`).
  const inOrder: RType[] = [];
  const place = (r: RType) => {
    if (inOrder.includes(r)) return;
    for (const x of r.fields) if (isRecord(x.t) && !x.t.mutable) { const inner = records.get(x.t.key); if (inner && inner !== r) place(inner); }
    inOrder.push(r);
  };
  for (const r of records.values()) place(r);
  const types: string[] = [];
  for (const r of inOrder) {
    const n = sname.get(r.key)!;
    types.push(r.mutable
      ? `typedef struct { lab_cell h; ${r.fields.map((x, j) => `${ty(x.t)} f${j};`).join(" ")} } ${n}; // a box`
      : `typedef struct { ${r.fields.map((x, j) => `${ty(x.t)} f${j};`).join(" ") || "char none;"} } ${n}; // ${r.name}: ${r.fields.map((x) => x.name).join(", ")}`);
  }
  for (const d of data.values()) {
    if (d.cases.length > 256) throw new Error(`${d.name} has ${d.cases.length} cases; a cell's tag in C holds 256`);
    d.cases.forEach((c, j) => {
      const n = cname(d, j);
      types.push(c.fields.length
        ? `typedef struct { lab_cell h; ${c.fields.map((x, k) => `${ty(x.t)} f${k};`).join(" ")} } ${n}; // ${d.name} ${c.name}: ${c.fields.map((x) => x.name).join(", ")}`
        : `static lab_cell ${n} = { 0, ${tnum.get(d.key)}, ${j} }; // ${d.name} ${c.name}`);
    });
  }
  // A function type's code takes the closure, then the inputs.
  for (const a of arrays.values()) {
    const n = aname.get(a.key)!;
    // An array of Ints keeps bytes one a slot (L189f2): `bytes` set, its
    // items are uint8_t, as the evaluator's Uint8Array (std.ts arrayOfItems).
    types.push(`typedef struct { lab_cell h; uint32_t lo, hi, cap;${a.item === "int" ? " uint8_t bytes;" : ""} ${ty(a.item)} it[]; } ${n.buf}; // an array's buffer: items lo..hi used`,
      `typedef struct { lab_cell h; lab_cell *b; uint32_t s, n; } ${n.view}; // an array: n items from s`);
  }
  for (const t of tables.values()) {
    const K = ty(t.keyT);
    types.push(`typedef struct { uint32_t n, used, cap; uint8_t *st; ${K} *ks; ${ty(t.value)} *vs; } lab_Store_t${t.index}; // a table's slots: cap, n full, used full or removed`,
      `typedef struct { lab_cell h; lab_Store_t${t.index} *cur; lab_cell *next; ${K} key; ${ty(t.value)} old; uint8_t had; } lab_Table_t${t.index}; // a version: the newest holds the slots (cur), an older one the change from the next (key had old or was absent)`);
  }
  for (const [k, t] of fns) types.push(`typedef ${ty(t.result)} (*${fname.get(k)})(${["lab_cell *", ...t.params.map(ty)].join(", ")});`);
  for (const s of shaped) types.push(`typedef struct { lab_cell h; void (*code)(void); ${shapes[s].caps.map((x, j) => `${ty(x)} c${j};`).join(" ")} } ${shapeName.get(s)};`);
  // Dup and drop for records that hold counts, and each cell type's
  // fields given up when its cell goes.
  const counts: string[] = [];
  for (const r of inOrder) {
    if (!counted(r) || r.mutable) continue;
    const n = sname.get(r.key)!;
    const parts = r.fields.map((x, j) => ({ t: x.t, at: `r.f${j}` })).filter((x) => counted(x.t));
    counts.push(
      `static inline ${n} ${n}_dup(${n} r) { ${parts.map((x) => `${dup(x.t, x.at)};`).join(" ")} return r; }`,
      `static inline void ${n}_drop(${n} r) { ${parts.map((x) => drop(x.t, x.at)).join(" ")} }`,
      `static inline void ${n}_dec(${n} r) { ${parts.map((x) => dec(x.t, x.at)).join(" ")} }`,
      ...(threads ? [`static inline void ${n}_share(${n} r) { ${parts.map((x) => share(x.t, x.at)).join(" ")} }`] : []),
    );
  }
  const fieldsOf: string[] = [], sharesOf: string[] = [];
  const kidsOf = (out: string[], each: (t: LType, x: string) => string) => {
    for (const d of data.values()) {
      const arms = d.cases.map((c, j) => {
        const ks = c.fields.map((x, k) => ({ t: x.t, at: `((${cname(d, j)} *)c)->f${k}` })).filter((x) => counted(x.t));
        return ks.length ? `case ${j}: ${ks.map((x) => each(x.t, x.at)).join(" ")} break;` : "";
      }).filter(Boolean);
      out.push(arms.length ? `case ${tnum.get(d.key)}: switch (c->tag) { ${arms.join(" ")} } break;` : "");
    }
    for (const a of arrays.values()) {
      const n = aname.get(a.key)!;
      out.push(`case ${tnum.get(`array ${a.key}`)}: ${each(a, `((${n.view} *)c)->b`)} break;`);
      if (counted(a.item)) out.push(`case ${tnum.get(`buf ${a.key}`)}: { ${n.buf} *b = (${n.buf} *)c; ${a.item === "int" ? "if (!b->bytes) " : ""}for (uint32_t k = b->lo; k < b->hi; k++) ${each(a.item, "b->it[k]")} } break;`);
    }
    for (const s of shaped) {
      const ks = shapes[s].caps.map((x, j) => (counted(x) ? each(x, `((${shapeName.get(s)} *)c)->c${j}`) : "")).filter(Boolean);
      out.push(ks.length ? `case ${tnum.get(`shape ${s}`)}: ${ks.join(" ")} break;` : "");
    }
  };
  kidsOf(fieldsOf, dec);
  if (threads) {
    kidsOf(sharesOf, share);
    for (const k of [...boxes.map((b) => b.key), ...[...tables.keys()].map((k) => `table ${k}`)]) sharesOf.push(`case ${tnum.get(k)}: lab_share_no = 1; break;`);
  }
  for (const b of boxes) fieldsOf.push(counted(b.fields[0].t) ? `case ${tnum.get(b.key)}: ${dec(b.fields[0].t, `((${sname.get(b.key)} *)c)->f0`)} break;` : "");
  for (const t of tables.values()) {
    const T = `lab_Table_t${t.index}`, k = counted(t.keyT) ? dec(t.keyT, "b->ks[j]") : "";
    const v = (x: string) => (counted(t.value) ? dec(t.value, x) : "");
    fieldsOf.push(`case ${tnum.get(`table ${t.key}`)}: { ${T} *v = (${T} *)c; lab_Store_t${t.index} *b = v->cur; if (b) { for (uint32_t j = 0; j < b->cap; j++) if (b->st[j] == 1) { ${k} ${v("b->vs[j]")} } free(b->st); free(b->ks); free(b->vs); free(b); } else { ${k.replace("b->ks[j]", "v->key")} if (v->had) { ${v("v->old")} } lab_dec(v->next); } } break;`);
  }

  const world = [...rts].some((x) => x.startsWith("world."));
  const entry = opts.main === undefined ? "" : opts.page ? pageC(opts.main, opts.page) : program(opts.main);
  const TL = threads ? "_Thread_local " : "";
  const stops = text.some((t) => t.includes("lab_stop(")) || rts.has("world.stopWith") || !!opts.harness;
  const fuelled = int32Used.size > 0 || text.some((t) => t.includes("lab_fuel"));
  const c = [
    ...(world ? [POSIX] : []),
    "// Generated by compiler/src/c.ts from a typed program. Do not edit.",
    "// Build with -ffp-contract=off (and -msse2 -mfpmath=sse on 32-bit x86):",
    "// the numbers are then the evaluator's, bit for bit.",
    "#pragma STDC FP_CONTRACT OFF",
    "#include <stddef.h>",
    "#include <stdint.h>",
    "#include <stdio.h>",
    "#include <stdlib.h>",
    "#include <math.h>",
    ...(world ? [WORLD_H] : []),
    ...(entry || threads ? ["#include <pthread.h>"] : []),
    ...(threads ? ["#include <string.h>", "#include <time.h>", "#include <unistd.h>"] : []),
    ...(math ? [FDLIBM_C] : []),
    ...(cells ? [cellsC(threads)] : []),
    ...(ints ? [BASE] : []),
    ...(threads ? [SHARE_C] : []),
    "",
    ...types,
    ...counts,
    ...(opts.page ? [READS_C] : []),
    ...(cells ? [`static void lab_fields(lab_cell *c) { switch (c->type) { ${fieldsOf.filter(Boolean).join(" ")} default: break; } }`] : []),
    ...(threads ? [`static void lab_shares(lab_cell *c) { switch (c->type) { ${sharesOf.filter(Boolean).join(" ")} default: break; } }`] : []),
    ...(text.some((t) => t.includes("lab_none")) ? [`static ${TL}int lab_none = 0; // no answer inside a search (C166)`] : []),
    ...(int32Used.size || text.some((t) => t.includes("lab_fuel")) ? [`static ${TL}double lab_fuel = INFINITY; // outside any budget, as much as it takes`] : []),
    ...[...int32Used].map((op) => INT32_C[op]!),
    ...(text.some((t) => t.includes("lab_mod(")) ? ["static double lab_mod(double a, double b) { return fmod(fmod(a, b) + b, b); }"] : []),
    // A Float64 with no answer or too big (L125c2, stops.ts): the reason
    // to standard error and exit 1, as an Abort nothing handled does.
    // A stop with a reason (L51c) is number -1, its words in lab_stop_why.
    ...(text.some((t) => t.includes("lab_stop(")) || rts.has("world.stopWith") || opts.harness ? [`static const char *lab_stops[] = { ${STOPS.map((x) => JSON.stringify(x)).join(", ")} };`, "#include <setjmp.h>",
      // The test harness goes on to its next call instead (lab_stop_at).
      `static ${TL}jmp_buf *lab_stop_at = 0; static ${TL}int lab_stopped = 0;`,
      `static ${TL}const char *lab_stop_why = 0; static ${TL}size_t lab_stop_n = 0;`,
      // Each stop site's definition (C143b), printed after the reason.
      `static const char *lab_sites[] = { ${[...(lowered.stops ?? []).map((x) => JSON.stringify(x.name ?? "")), "0"].join(", ")} };`,
      "static double lab_stop(double i) { if (lab_stop_at) { lab_stopped = (int)i; longjmp(*lab_stop_at, 1); } fflush(stdout); int s = (int)i / " + SITES + " - 1; if (i < 0) fprintf(stderr, \"%.*s\\n\", (int)lab_stop_n, lab_stop_why); else if (s >= 0 && s < " + (lowered.stops?.length ?? 0) + " && lab_sites[s][0]) fprintf(stderr, \"%s (in %s)\\n\", lab_stops[(int)i % " + SITES + "], lab_sites[s]); else fprintf(stderr, \"%s\\n\", lab_stops[(int)i % " + SITES + "]); exit(1); }"] : []),
    ...[...statics.values()].map((x) => x.decl),
    ...(rts.size ? ["", runtimeC(rts, listNames)] : []),
    ...(hostsUsed.size ? ["", HOST_RT, "// hosts/c.c", opts.hosts!.c!, "", ...[...hostsUsed].map(([op, n]) => hostWrapper(opts.hosts!.ops[Object.keys(opts.hosts!.ops).find((k) => opts.hosts!.ops[k].op === op)!], n, hostTypes.get(op)!))] : []),
    ...[...arrays.values()].flatMap((a) => arrayC(a)),
    ...[...tables.values()].flatMap((t) => tableC(t)),
    ...(splits ? [splitC(TL)] : []),
    ...(threads ? [POOL_C, ...[...countPars.values()].map((x) => countC(x, stops, fuelled)), ...[...pars.values()].map((x) => parC(x, stops, fuelled)), ...[...togethers.values()].map((x) => togetherC(x, stops, fuelled))] : []),
    "",
    ...[...fiberGlobals].map(([n, t]) => `static ${t} ${n};`),
    ...fiberC,
    ...kept.map((i) => `${header(i)};`),
    ...[...lent.keys()].map((i) => `${header(i, true)};`),
    ...[...once].map((i) => `static ${ty(funcs[i].result)} lab_m${i}; static int lab_m${i}_has = 0;`),
    ...(opts.harness ? [`static void lab_memo_clear(void) { ${[...once].map((i) => `if (lab_m${i}_has) { ${counted(funcs[i].result) ? drop(funcs[i].result, `lab_m${i}`) : ""} lab_m${i}_has = 0; }`).join(" ")} }`] : []),
    "",
    text.join("\n\n"),
    ...(opts.harness ? ["", tests] : []),
    ...(entry ? ["", entry] : []),
    "",
  ].join("\n");
  return { c, names, refused };

  // The wrapper of a host's operation: the program's values to C's, the
  // host's answer back, checked as hosts.ts's border checks one from
  // hosts/js.js; a wrong answer, or the host's lab_host_fail, is the
  // program's Abort with the reason. It owns its inputs, as the runtime's
  // functions do.
  function hostWrapper(h: HostOps[string], n: number, t: LType): string {
    const ps = h.ins.map((x, j) => `${HOST_C[x.k]!.lab} p${j}`), name = JSON.stringify(h.name).slice(1, -1);
    const lines = [`static ${ty(t)} lab_host_${n}(${ps.join(", ") || "void"}) {`];
    const fail = (what: string, detail = '""') => [`lab__host_abort("${name}", ${JSON.stringify(what)}, ${detail});`, `return ${zero(t)};`];
    const args: string[] = [], after: string[] = [];
    h.ins.forEach((x, j) => {
      if (x.k === "int") {
        lines.push(`  int big${j} = !LAB_IS_SMALL(p${j}); int64_t a${j} = big${j} ? 0 : LAB_VAL(p${j}); lab_int_drop(p${j});`);
        lines.push(`  if (big${j}) { ${fail("was given an Int too big for int64_t").join(" ")} }`);
        args.push(`a${j}`);
      } else if (x.k === "text") {
        lines.push(`  char *a${j} = lab__host_str(p${j}); lab_drop(p${j});`);
        args.push(`a${j}`); after.push(`free(a${j});`);
      } else if (x.k === "unit") { /* nothing crosses */ } else args.push(`p${j}`);
    });
    const call = `${hostName(h.op)}(${args.join(", ")})`;
    lines.push("  lab_host_why = 0;");
    if (h.out.k === "unit") lines.push(`  ${call};`); else lines.push(`  ${HOST_C[h.out.k]!.host} r = ${call};`);
    lines.push(...after.map((x) => `  ${x}`));
    lines.push(`  if (lab_host_why) { ${fail("failed: ", "lab_host_why").join(" ")} }`);
    switch (h.out.k) {
      case "unit": lines.push(`  return ${zero(t)};`); break;
      case "float": lines.push(`  if (!isfinite(r)) { char g[48]; snprintf(g, sizeof g, "%s, not a finite number", isnan(r) ? "NaN" : r > 0 ? "Infinity" : "-Infinity"); ${fail("gave ", "g").join(" ")} }`, "  return r;"); break;
      case "bool": lines.push(`  if (r != 0 && r != 1) { char g[48]; snprintf(g, sizeof g, "%d, not true (1) or false (0)", r); ${fail("gave ", "g").join(" ")} }`, "  return r;"); break;
      case "int": lines.push("  return lab__int64(r);"); break;
      case "text": lines.push(`  if (!r) { ${fail("gave nothing, not a text").join(" ")} }`, "  return lab__text_of(r, strlen(r));"); break;
    }
    lines.push("}");
    return lines.join("\n");
  }

  // A page on a view host (C199b, NATIVE-APPS.md): main's Html mounted as
  // the host's views, kept as a tree of what was drawn. After each event
  // every text, attribute and part runs again and the host is told only
  // what changed; a part's new Html is laid over what it drew, element by
  // element, where the tags and attributes are the same.
  function pageC(def: string, mode: "api" | "headless" | "ui" | "ui-headless"): string {
    const i = kept.find((j) => funcs[j].def === def && !funcs[j].inner);
    if (i === undefined) {
      const j = funcs.findIndex((g) => g.def === def && !g.inner);
      throw new Error(`main isn't in C: ${j < 0 ? lowered.refused.get(def as never) ?? "it isn't lowered" : refused.get(j)}`);
    }
    const H = funcs[i].result as DType;
    const ci = (t: DType, v: string) => t.cases.findIndex((c) => c.variant === v);
    if (!H || typeof H !== "object" || !("cases" in H) || H.def !== "std.html") throw new Error("main isn't a page: it doesn't give Html");
    const el = ci(H, "std.html.element"), tx = ci(H, "std.html.text"), pt = ci(H, "std.html.part");
    const LA = H.cases[el].fields[1].t as DType, LH = H.cases[el].fields[2].t as DType;
    const consOf = (l: DType) => { const c = l.cases.findIndex((x) => x.fields.length > 0); return { c, head: l.cases[c].fields.findIndex((x) => x.t !== l), rest: l.cases[c].fields.findIndex((x) => x.t === l) }; };
    const la = consOf(LA), lh = consOf(LH);
    const A = LA.cases[la.c].fields[la.head].t as DType;
    const pr = ci(A, "std.attribute.property"), on = ci(A, "std.attribute.on");
    const TF = H.cases[tx].fields[0].t as FType, PF = H.cases[pt].fields[0].t as FType, VF = A.cases[pr].fields[1].t as FType, EF = A.cases[on].fields[1].t as FType;
    const E = EF.params[0] as RType;
    const call = (f: FType, c: string, xs: string[] = []) => `((${fname.get(f.key)})((lab_closure *)${c})->code)(${[c, ...xs].join(", ")})`;
    const field = (t: DType, c: number, j: number, v: string) => `((${cname(t, c)} *)${v})->f${j}`;
    return `// The page (C199b): main's Html on a view host.
typedef struct ters_host {
  void *ctx;
  void *(*element)(void *ctx, const char *tag, size_t n);
  void *(*text)(void *ctx, const char *s, size_t n);
  void (*set_text)(void *ctx, void *node, const char *s, size_t n);
  void (*set_attribute)(void *ctx, void *el, const char *name, size_t nn, const char *value, size_t vn);
  void (*remove_attribute)(void *ctx, void *el, const char *name, size_t nn);
  void (*append)(void *ctx, void *parent, void *kid);
  void (*clear)(void *ctx, void *el);
  void (*listen)(void *ctx, void *el, const char *event, size_t n, int handler);
  void (*gone)(void *ctx, void *node);
  // A part ran again after a cell it read was written, and drew into the
  // same elements (ters_lay): to a browser, which mounts such a part's
  // elements again, they are new, and their animations start again
  // (c-layout.ts). May be null.
  void (*renew)(void *ctx, void *el);
} ters_host;
static ters_host *ters_h;
// Run after the page changed (c-layout.ts lays it out again).
static void (*ters_after)(void);
// A screen's own animations (c-layout.ts tl_moving): 0, whether any runs;
// 1, move them on to now, telling their ends. Whether any still runs.
static int (*ters_moving)(int);
// What was drawn: an element (its tag, attributes and children), a text,
// or a part (what it drew). A property keeps what it showed (null: none);
// an event keeps its handler's number.
typedef struct ters_attr { int kind; lab_cell *name, *f, *shown; int handler; } ters_attr;
typedef struct ters_m { int kind, svg; void *view; lab_cell *tag, *f, *shown; int na, nk, nreads; ters_attr *attrs; struct ters_m **kids, *part; void **reads; } ters_m;
// Whether what is mounted now is inside an svg element: a part there is an
// SVG group, as html.ts makes it, not a lab-part.
static int ters_svg;
static lab_cell **ters_handlers;
static int ters_nh, ters_ch;
static ters_m *ters_root;
static int ters_same(lab_cell *a, lab_cell *b) { return a && b && LAB_TN(a) == LAB_TN(b) && !memcmp(LAB_TB(a), LAB_TB(b), LAB_TN(a)); }
// A view's function run: its text, or null with no answer (an abort says
// why on stderr).
static lab_cell *ters_view(lab_cell *f) {
  lab_dup(f);
  lab_cell *r = ${call(VF, "f")};
  if (lab_st) { if (lab_st == 2) { fwrite(LAB_TB(lab_reason), 1, LAB_TN(lab_reason), stderr); fputc('\\n', stderr); } lab_st = 0; return 0; }
  return r;
}
static int ters_handler(lab_cell *f) {
  if (ters_nh == ters_ch) { ters_ch = ters_ch ? 2 * ters_ch : 16; ters_handlers = realloc(ters_handlers, sizeof *ters_handlers * (size_t)ters_ch); }
  lab_dup(f);
  ters_handlers[ters_nh] = f;
  return ters_nh++;
}
static void ters_show(ters_m *m, ters_attr *a) {
  lab_cell *v = ters_view(a->f);
  int live = (LAB_TN(a->name) == 5 && !memcmp(LAB_TB(a->name), "value", 5)) || (LAB_TN(a->name) == 7 && !memcmp(LAB_TB(a->name), "checked", 7));
  // None: an attribute is taken off; a field's value or tick stays.
  if (!v) { if (a->shown) { if (!live) ters_h->remove_attribute(ters_h->ctx, m->view, (const char *)LAB_TB(a->name), LAB_TN(a->name)); lab_drop(a->shown); a->shown = 0; } return; }
  if (ters_same(v, a->shown)) { lab_drop(v); return; }
  ters_h->set_attribute(ters_h->ctx, m->view, (const char *)LAB_TB(a->name), LAB_TN(a->name), (const char *)LAB_TB(v), LAB_TN(v));
  if (a->shown) lab_drop(a->shown);
  a->shown = v;
}
static void ters_text(ters_m *m) {
  lab_cell *v = ters_view(m->f);
  if (!v) v = lab__text_of("", 0);
  if (ters_same(v, m->shown)) { lab_drop(v); return; }
  ters_h->set_text(ters_h->ctx, m->view, (const char *)LAB_TB(v), LAB_TN(v));
  if (m->shown) lab_drop(m->shown);
  m->shown = v;
}
static ters_m *ters_mount(lab_cell *h);
static void ters_forget(ters_m *m);
static void ters_part(ters_m *m);
// The attributes and children of an element, borrowed.
static void ters_fill(ters_m *m, lab_cell *h) {
  lab_cell *as = ${field(H, el, 1, "h")}, *ks = ${field(H, el, 2, "h")};
  for (lab_cell *x = as; x->tag == ${la.c}; x = ${field(LA, la.c, la.rest, "x")}) m->na++;
  for (lab_cell *x = ks; x->tag == ${lh.c}; x = ${field(LH, lh.c, lh.rest, "x")}) m->nk++;
  m->attrs = calloc((size_t)m->na + 1, sizeof *m->attrs);
  m->kids = calloc((size_t)m->nk + 1, sizeof *m->kids);
  int j = 0;
  for (lab_cell *x = as; x->tag == ${la.c}; x = ${field(LA, la.c, la.rest, "x")}, j++) {
    lab_cell *a = ${field(LA, la.c, la.head, "x")};
    ters_attr *t = &m->attrs[j];
    t->kind = a->tag;
    if (a->tag == ${pr}) { t->name = ${field(A, pr, 0, "a")}; t->f = ${field(A, pr, 1, "a")}; lab_dup(t->name); lab_dup(t->f); ters_show(m, t); }
    else if (a->tag == ${on}) { t->name = ${field(A, on, 0, "a")}; lab_dup(t->name); t->handler = ters_handler(${field(A, on, 1, "a")}); ters_h->listen(ters_h->ctx, m->view, (const char *)LAB_TB(t->name), LAB_TN(t->name), t->handler); }
    else fputs("a page's sound plays only in a browser (ters build-web)\\n", stderr);
  }
  j = 0;
  for (lab_cell *x = ks; x->tag == ${lh.c}; x = ${field(LH, lh.c, lh.rest, "x")}, j++) { m->kids[j] = ters_mount(${field(LH, lh.c, lh.head, "x")}); ters_h->append(ters_h->ctx, m->view, m->kids[j]->view); }
}
static ters_m *ters_mount(lab_cell *h) {
  ters_m *m = calloc(1, sizeof *m);
  m->kind = h->tag;
  if (h->tag == ${el}) {
    m->tag = ${field(H, el, 0, "h")}; lab_dup(m->tag);
    int was = ters_svg;
    if (LAB_TN(m->tag) == 3 && !memcmp(LAB_TB(m->tag), "svg", 3)) ters_svg = 1;
    m->svg = ters_svg;
    m->view = ters_h->element(ters_h->ctx, (const char *)LAB_TB(m->tag), LAB_TN(m->tag));
    ters_fill(m, h);
    ters_svg = was;
  } else if (h->tag == ${tx}) {
    m->f = ${field(H, tx, 0, "h")}; lab_dup(m->f);
    m->view = ters_h->text(ters_h->ctx, "", 0);
    ters_text(m);
  } else {
    m->f = ${field(H, pt, 0, "h")}; lab_dup(m->f);
    m->svg = ters_svg;
    if (m->svg) m->view = ters_h->element(ters_h->ctx, "g", 1);
    else {
      m->view = ters_h->element(ters_h->ctx, "lab-part", 8);
      ters_h->set_attribute(ters_h->ctx, m->view, "style", 5, "display: contents", 17);
    }
    ters_part(m);
  }
  return m;
}
static void ters_forget(ters_m *m) {
  if (!m) return;
  for (int j = 0; j < m->na; j++) { if (m->attrs[j].name) lab_drop(m->attrs[j].name); if (m->attrs[j].f) lab_drop(m->attrs[j].f); if (m->attrs[j].shown) lab_drop(m->attrs[j].shown); if (m->attrs[j].kind == ${on}) { lab_drop(ters_handlers[m->attrs[j].handler]); ters_handlers[m->attrs[j].handler] = 0; } }
  for (int j = 0; j < m->nk; j++) ters_forget(m->kids[j]);
  ters_forget(m->part);
  free(m->reads);
  if (m->tag) lab_drop(m->tag);
  if (m->f) lab_drop(m->f);
  if (m->shown) lab_drop(m->shown);
  ters_h->gone(ters_h->ctx, m->view);
  free(m->attrs); free(m->kids); free(m);
}
// Whether drawn m can take h's place: the same kind, and for an element
// the same tag, attributes (kinds and names) and number of children, each
// of which can too.
static int ters_fits(ters_m *m, lab_cell *h) {
  if (m->kind != (int)h->tag) return 0;
  if (h->tag != ${el}) return 1;
  if (!ters_same(m->tag, ${field(H, el, 0, "h")})) return 0;
  int j = 0;
  for (lab_cell *x = ${field(H, el, 1, "h")}; x->tag == ${la.c}; x = ${field(LA, la.c, la.rest, "x")}, j++) {
    lab_cell *a = ${field(LA, la.c, la.head, "x")};
    if (j >= m->na || m->attrs[j].kind != (int)a->tag) return 0;
    if (a->tag == ${pr} ? !ters_same(m->attrs[j].name, ${field(A, pr, 0, "a")}) : a->tag == ${on} ? !ters_same(m->attrs[j].name, ${field(A, on, 0, "a")}) : 1) return 0;
  }
  if (j != m->na) return 0;
  j = 0;
  for (lab_cell *x = ${field(H, el, 2, "h")}; x->tag == ${lh.c}; x = ${field(LH, lh.c, lh.rest, "x")}, j++) if (j >= m->nk || !ters_fits(m->kids[j], ${field(LH, lh.c, lh.head, "x")})) return 0;
  return j == m->nk;
}
// h laid over m, which fits it: its functions take the old ones' places.
static void ters_lay(ters_m *m, lab_cell *h) {
  if (h->tag == ${el}) {
    int j = 0;
    for (lab_cell *x = ${field(H, el, 1, "h")}; x->tag == ${la.c}; x = ${field(LA, la.c, la.rest, "x")}, j++) {
      lab_cell *a = ${field(LA, la.c, la.head, "x")};
      if (a->tag == ${pr}) { lab_cell *f = ${field(A, pr, 1, "a")}; lab_dup(f); lab_drop(m->attrs[j].f); m->attrs[j].f = f; ters_show(m, &m->attrs[j]); }
      else { lab_cell *f = ${field(A, on, 1, "a")}; lab_dup(f); lab_drop(ters_handlers[m->attrs[j].handler]); ters_handlers[m->attrs[j].handler] = f; }
    }
    j = 0;
    for (lab_cell *x = ${field(H, el, 2, "h")}; x->tag == ${lh.c}; x = ${field(LH, lh.c, lh.rest, "x")}, j++) ters_lay(m->kids[j], ${field(LH, lh.c, lh.head, "x")});
  } else {
    lab_cell *f = h->tag == ${tx} ? ${field(H, tx, 0, "h")} : ${field(H, pt, 0, "h")};
    lab_dup(f); lab_drop(m->f); m->f = f;
    if (h->tag == ${tx}) ters_text(m); else ters_part(m);
  }
}
// Each element of a part that drew something else, told it is new.
static void ters_renew(ters_m *m) {
  if (!m) return;
  if (m->kind == ${el}) { ters_h->renew(ters_h->ctx, m->view); for (int j = 0; j < m->nk; j++) ters_renew(m->kids[j]); }
  else if (m->kind == ${pt}) ters_renew(m->part);
}
static void ters_part(ters_m *m) {
  lab_dup(m->f);
  // Whether a cell it read last time was written since, and what it reads
  // now (its own reads: a part inside notes its own).
  int stale = 0;
  for (int j = 0; j < m->nreads && !stale; j++) for (int k = 0; k < lab_nwr; k++) if (m->reads[j] == lab_wr[k]) { stale = 1; break; }
  void **rd = lab_rd; int nrd = lab_nrd, crd = lab_crd, rding = lab_rding;
  lab_rd = 0; lab_nrd = lab_crd = 0; lab_rding = 1;
  lab_cell *h = ${call(PF, "m->f")};
  free(m->reads); m->reads = lab_rd; m->nreads = lab_nrd;
  lab_rd = rd; lab_nrd = nrd; lab_crd = crd; lab_rding = rding;
  if (lab_st) { if (lab_st == 2) { fwrite(LAB_TB(lab_reason), 1, LAB_TN(lab_reason), stderr); fputc('\\n', stderr); } lab_st = 0; ters_forget(m->part); m->part = 0; ters_h->clear(ters_h->ctx, m->view); return; }
  if (m->part && ters_fits(m->part, h)) { ters_lay(m->part, h); if (stale && ters_h->renew) ters_renew(m->part); }
  else { ters_forget(m->part); ters_h->clear(ters_h->ctx, m->view); int was = ters_svg; ters_svg = m->svg; m->part = ters_mount(h); ters_svg = was; ters_h->append(ters_h->ctx, m->view, m->part->view); }
  lab_drop(h);
}
// Everything shown, run again.
static int ters_no_clock, ters_clock;
static void ters_refresh(ters_m *m) {
  if (m->kind == ${tx}) { ters_text(m); return; }
  if (m->kind == ${pt}) { ters_part(m); return; }
  for (int j = 0; j < m->na; j++) if (m->attrs[j].kind == ${pr}) ters_show(m, &m->attrs[j]);
  for (int j = 0; j < m->nk; j++) ters_refresh(m->kids[j]);
}
// main's page on host h: its root's view, or null when main has no answer.
void *ters_page_start(ters_host *h) {
  ters_h = h;
  ${rts.has("world.now") ? "lab_now_read" : "ters_no_clock"} = 0;
  lab_cell *html = ${names.get(i)}();
  if (lab_st) { if (lab_st == 2) { fwrite(LAB_TB(lab_reason), 1, LAB_TN(lab_reason), stderr); fputc('\\n', stderr); } lab_st = 0; return 0; }
  ters_root = ters_mount(html);
  lab_drop(html);
  ters_clock = ${rts.has("world.now") ? "lab_now_read" : "ters_no_clock"};
  return ters_root->view;
}
// An event given to handler n: what was typed or chosen, the key, where
// the pointer is and the seconds since the frame before. Then the page
// shows what changed. 0 when the handler stopped (an abort).
int ters_page_event(int n, const char *value, size_t vn, const char *key, size_t kn, double x, double y, double seconds) {
  if (n < 0 || n >= ters_nh || !ters_handlers[n]) return 1;
  lab_cell *f = ters_handlers[n];
  lab_dup(f);
  ${ty(E)} e = { lab__text_of(value, vn), lab__text_of(key, kn), x, y, seconds };
  ${ty(EF.result)} r = ${call(EF, "f", ["e"])};
  (void)r;
  int ok = 1;
  if (lab_st) { if (lab_st == 2) { fwrite(LAB_TB(lab_reason), 1, LAB_TN(lab_reason), stderr); fputc('\\n', stderr); } lab_st = 0; ok = 0; }
  ${rts.has("world.now") ? "lab_now_read" : "ters_no_clock"} = 0;
  ters_refresh(ters_root);
  lab_nwr = 0;
  ters_clock = ${rts.has("world.now") ? "lab_now_read" : "ters_no_clock"};
  if (ters_after) ters_after();
  return ok;
}
// Whether what the page shows read the clock, so it runs again each frame.
int ters_page_clock(void) { return ters_clock || (ters_moving && ters_moving(0)); }
// A frame: what the page shows runs again, if it read the clock. Whether
// it still does.
int ters_page_frame(void) {
  int moving = ters_moving && ters_moving(0);
  if (!ters_clock && !moving) return 0;
  if (ters_clock) {
    ${rts.has("world.now") ? "lab_now_read" : "ters_no_clock"} = 0;
    ters_refresh(ters_root);
    lab_nwr = 0;
    ters_clock = ${rts.has("world.now") ? "lab_now_read" : "ters_no_clock"};
    if (ters_after) ters_after();
  }
  if (ters_moving) moving = ters_moving(1);
  return ters_clock || moving;
}
${mode === "headless" ? HEADLESS_C : mode === "ui" ? LAYOUT_C : mode === "ui-headless" ? LAYOUT_C + UI_HEADLESS_C : ""}`;
  }

  function program(def: string): string {
    const i = kept.find((j) => funcs[j].def === def && !funcs[j].inner);
    if (i === undefined) {
      const j = funcs.findIndex((g) => g.def === def && !g.inner);
      throw new Error(`main isn't in C: ${j < 0 ? lowered.refused.get(def as never) ?? "it isn't lowered" : refused.get(j)}`);
    }
    const f = funcs[i];
    const list = f.params.length ? (f.params[0] as DType) : null;
    const ln = list && (() => { const tag = list.cases.findIndex((c) => c.fields.length > 0); return { cons: cname(list, tag), nil: cname(list, 1 - tag), type: tnum.get(list.key)!, tag, head: list.cases[tag].fields.findIndex((x) => x.t !== list) }; })();
    const code = f.result === "int" ? "lab_code = (int)(LAB_IS_SMALL(r) ? LAB_VAL(r) : (int64_t)LAB_BIG(r)->d[0] * (LAB_BIG(r)->neg ? -1 : 1)); lab_int_drop(r);"
      : f.result === "f64" ? "lab_code = (int)r;" : counted(f.result) ? `${drop(f.result, "r")} lab_code = 0;` : "(void)r; lab_code = 0;";
    return `// The program: main on a thread with room to recurse deeply.
static int lab_argc, lab_code;
static char **lab_argv;
static void *lab_run(void *unused) {
  (void)unused;
${ln ? `  lab_cell *args = &${ln.nil};
  for (int k = lab_argc; k-- > 1;) { ${ln.cons} *c = lab_new(sizeof(${ln.cons}), ${ln.type}, ${ln.tag}); c->f${ln.head} = lab__text_of(lab_argv[k], strlen(lab_argv[k])); c->f${1 - ln.head} = args; args = (lab_cell *)c; }
` : ""}  ${ty(f.result)} r = ${names.get(i)}(${ln ? "args" : ""});
  if (lab_st) {
    fflush(stdout);
    if (lab_st == 2) { fwrite(LAB_TB(lab_reason), 1, LAB_TN(lab_reason), stderr); fputc('\\n', stderr); }
    lab_code = 1;
    return 0;
  }
  ${code}
  return 0;
}
int main(int argc, char **argv) {
  pthread_attr_t a;
  pthread_t t;
  lab_argc = argc; lab_argv = argv;
  pthread_attr_init(&a);
  if (pthread_attr_setstacksize(&a, sizeof(void *) == 8 ? (size_t)1 << 30 : (size_t)1 << 28) || pthread_create(&t, &a, lab_run, 0)) lab_run(0);
  else pthread_join(t, 0);
  fflush(stdout);
  return lab_code;
}`;
  }

  function func(f: SFunc, i: number): string {
    const loops = calls(f.body).some((x) => x.fn === i && x.tail);
    const local = (j: number) => (j < f.params.length ? `p${j}` : `l${j}`);
    let temps = 0, labels = 0;
    const decls: string[] = [];
    const temp = (t: LType) => { const n = `t${temps++}`; decls.push(`  ${ty(t)} ${n};`); return n; };
    // Every local is declared once at the top: a let in one branch of an
    // if is still one variable.
    f.locals.forEach((t, j) => { if (j >= f.params.length) decls.push(`  ${ty(t)} ${local(j)};`); });
    // A lent input isn't this function's to give on or drop.
    const mine = lent.get(i);
    const isCounted = (j: number) => counted(f.locals[j]) && !mine?.has(j);
    // The counted locals e reads before setting them. `cap` reads the
    // closure, input 0.
    const memo = new Map<SExpr, Set<number>>();
    const free = (e: SExpr): Set<number> => {
      let s = memo.get(e);
      if (s) return s;
      s = new Set<number>();
      const bound = e.k === "let" ? e.i : e.k === "case" ? e.s : e.k === "attempt" ? e.res : -1;
      if (e.k === "local") { if (isCounted(e.i)) s.add(e.i); }
      else if (e.k === "cap") s.add(0);
      else if (e.k === "let" || e.k === "case") { free(e.k === "let" ? e.value : e.scrut).forEach((x) => s!.add(x)); kids(e).slice(1).forEach((k) => free(k).forEach((x) => x !== bound && s!.add(x))); }
      else if (e.k === "attempt") { free(e.body).forEach((x) => s!.add(x)); free(e.ok).forEach((x) => x !== bound && s!.add(x)); free(e.otherwise).forEach((x) => s!.add(x)); }
      else if (e.k === "handle") { free(e.body).forEach((x) => s!.add(x)); free(e.arm).forEach((x) => x !== e.reason && s!.add(x)); }
      else kids(e).forEach((k) => free(k).forEach((x) => s!.add(x)));
      memo.set(e, s);
      return s;
    };
    const union = (...xs: Set<number>[]) => new Set(xs.flatMap((x) => [...x]));
    const without = (xs: Set<number>, j: number) => new Set([...xs].filter((x) => x !== j));
    // Drops for the locals live here that `rest` and `after` don't use.
    const drops = (live: Set<number>, rest: Set<number>, after: Set<number>, d: string) =>
      [...live].filter((j) => !rest.has(j) && !after.has(j)).map((j) => `${d}${drop(f.locals[j], local(j))}`);

    // Where no answer goes, innermost last (none: out of the function),
    // and the owned temporaries an expression is holding while its other
    // parts run.
    const targets: Target[] = [];
    // The labels some way out goes to: one nothing goes to isn't written
    // (an unused label is a warning; C101).
    const jumped = new Set<string>();
    const at = (d: string, label: string) => (jumped.has(label) ? [`${d}${label}:`] : []);
    const pending: { t: LType; v: string }[] = [];
    // Cells taken apart (takeApart) that the next new cell of the same
    // fields can have, innermost last: v holds the cell, or 0 if it was
    // shared. Every way on either uses it or frees it.
    const tokens: { v: string; fields: string; alive: boolean; used: boolean }[] = [];
    const letGo = (ts: typeof tokens, d: string) => ts.filter((x) => x.alive).map((x) => ((x.used = true), `${d}if (${x.v}) { lab_free(${x.v}); ${x.v} = 0; }`));
    // Branches with the tokens alive before them: one a branch uses is
    // freed at the start of each branch that doesn't.
    const branches = (gens: (() => string[])[], d: string): string[][] => {
      const live = tokens.filter((x) => x.alive);
      const done = gens.map((g) => { live.forEach((x) => (x.alive = true)); const lines = g(); return { lines, gone: live.filter((x) => !x.alive) }; });
      const taken = live.filter((x) => done.some((b) => b.gone.includes(x)));
      live.forEach((x) => (x.alive = !taken.includes(x)));
      return done.map((b) => [...letGo(taken.filter((x) => !b.gone.includes(x)).map((x) => ({ ...x, alive: true })), d), ...b.lines]);
    };
    // Going out with no answer from a point where `after` is live: drop
    // what the target won't use, then jump (or return a zero).
    const out = (d: string, after: Set<number>): string[] => {
      const t = targets.at(-1);
      if (t) jumped.add(t.label);
      const gone = [...after].filter((j) => !t?.keep.has(j)).map((j) => `${d}${drop(f.locals[j], local(j))}`);
      const temps = pending.slice(t?.pending ?? 0).filter((x) => counted(x.t)).map((x) => `${d}${drop(x.t, x.v)}`);
      return [...gone, ...temps, ...letGo(tokens, d), t ? `${d}goto ${t.label};` : f.partial ? `${d}return ${zero(f.result)};` : `${d}abort(); // no answer, and nowhere to go`];
    };
    // A label to go to, with what it keeps.
    const within = <T>(keep: Set<number>, body: (label: string) => T): T => {
      const label = `L${labels++}`;
      targets.push({ label, keep, pending: pending.length });
      try { return body(label); } finally { targets.pop(); }
    };

    // The arguments of a call or a constructor, left to right: one whose
    // code needs statements first puts the ones before it in locals, so
    // they are read before those statements run (they may drop a cell, or
    // go out with no answer, dropping them).
    function args(es: SExpr[], pre: string[], d: string, after: Set<number>): string[] {
      const xs: string[] = [];
      const mark = pending.length;
      // What the ones after each read, from the end once (a written list
      // has ten thousand, L181b); a set shared while nothing adds to it.
      const laters: Set<number>[] = new Array(es.length);
      for (let k = es.length - 1, acc = after; k >= 0; k--) { laters[k] = acc; const s = free(es[k]); if (s.size) acc = union(acc, s); }
      // The earlier ones that would go into temps: not numbers, not held yet.
      let open: number[] = [];
      es.forEach((a, k) => {
        const later = laters[k];
        // The earlier ones go into temps (owned, so a way out drops them)
        // if this one has statements: named before it's printed.
        const held = open.map((j) => ({ j, t: typeOf(es[j], f.locals) })).map(({ j, t }) => ({ j, t, v: temp(t) }));
        pending.push(...held);
        const mine: string[] = [];
        const x = ex(a, mine, d, later);
        if (mine.length) {
          for (const h of held) { pre.push(`${d}${h.v} = ${xs[h.j]};`); xs[h.j] = h.v; }
          pre.push(...mine);
          open = [];
        } else pending.splice(pending.length - held.length);
        if (!/^(\d[\w.+-]*|\(-?[\d.e+-]+\))$/.test(x) && !pending.some((p) => p.v === x)) open.push(k);
        xs.push(x);
      });
      pending.splice(mark);
      return xs;
    }
    // A field of rec (data, a record or a box): rec is borrowed, the field
    // dup'd, and rec dropped if this was its last use.
    function borrow(rec: SExpr, t: LType, at: (r: string) => string, pre: string[], d: string, after: Set<number>): string {
      const read = (r: string) => { const v = at(r); return counted(t) ? dup(t, v) : v; };
      if (rec.k === "local") {
        if (!isCounted(rec.i) || after.has(rec.i)) return read(local(rec.i));
        const v = temp(t);
        pre.push(`${d}${v} = ${read(local(rec.i))};`, `${d}${drop(f.locals[rec.i], local(rec.i))}`);
        return v;
      }
      const rt = typeOf(rec, f.locals);
      const r = ex(rec, pre, d, after);
      if (!counted(rt)) return read(r);
      const owned = temp(rt), v = temp(t);
      pre.push(`${d}${owned} = ${r};`, `${d}${v} = ${read(owned)};`, `${d}${drop(rt, owned)}`);
      return v;
    }
    // A call as a statement of its own, in order: it may drop what an
    // argument beside it still reads (C runs those in any order).
    function stated(call: string, t: LType, pre: string[], d: string): string {
      const v = temp(t);
      pre.push(`${d}${v} = ${call};`);
      return v;
    }
    // A handler on a fiber, or a perform of its operation (C44b). The
    // handler: its frame made and the code started on a fiber, then its
    // driver, which goes into the fiber until the code performs (a case
    // called, given the rest when it takes one) or finishes (its value,
    // or the finish case's). A perform: its inputs in the operation's
    // globals, out of the fiber, and the value it was resumed with.
    function fiber(e: SExpr & { k: "rt" }, pre: string[], d: string, after: Set<number>): string {
      const [kind, ...rest] = e.fn.split(":");
      // The first ready of some tickets (any of): sleep till then, and
      // its position, as the world's timers have it (ters timers.ts).
      if (kind === "fready") {
        const lt = data.get(rest.join(":"))!, tag = lt.cases.findIndex((c) => c.fields.length > 0), cons = cname(lt, tag);
        const head = lt.cases[tag].fields.findIndex((x) => x.t !== lt), tt = lt.cases[tag].fields[head].t as DType;
        const R = `lab__ready_${tnum.get(tt.key)}`, F = `lab__first_${tnum.get(lt.key)}`;
        const timer = tt.cases.findIndex((c) => c.variant === TICKET_V.timer), at = tt.cases.findIndex((c) => c.variant === TICKET_V.at), first = tt.cases.findIndex((c) => c.variant === TICKET_V.firstReady);
        if (!fiberC.some((x) => x.includes(`${F}(`))) {
          rts.add("world.now"); rts.add("world.sleep"); rts.add("fibers.park");
          const items = (l: string, body: string) => `for (lab_cell *c = ${l}; c->tag == ${tag}; c = ((${cons} *)c)->f${1 - head}) { lab_cell *x = ((${cons} *)c)->f${head}; ${body} }`;
          const never = (why: string) => `{ lab_reason = ${textLit(why)}; lab_st = 2; return 0; }`;
          fiberC.push([
            `static double ${R}(lab_cell *t, double now) {`,
            `  switch (t->tag) {`,
            `    case ${timer}: return now + ((${cname(tt, timer)} *)t)->f0;`,
            `    case ${at}: return ((${cname(tt, at)} *)t)->f0;`,
            `    case ${first}: { double m = INFINITY; ${items(`((${cname(tt, first)} *)t)->f0`, `double r = ${R}(x, now); if (r < m) m = r;`)} return m; }`,
            `    default: return NAN;`,
            "  }",
            "}",
            `static lab_int ${F}(lab_cell *ts) {`,
            `  double now = lab_world_now(), m = INFINITY; int64_t k = 0, i = -1;`,
            `  ${items("ts", `double r = ${R}(x, now); if (r != r) ${never("a ticket of the world's other than a timer, awaited in C (C44)")} if (i < 0 || r < m) { m = r; i = k; } k++;`)}`,
            `  lab_drop(ts);`,
            `  if (i < 0) ${never("any of no tickets is never ready")}`,
            "  lab__fpark(m);",
            "  return LAB_SMALL(i);",
            "}",
          ].join("\n"));
        }
        return checked(`${F}(${args(e.args, pre, d, after).join(", ")})`, "int", pre, d, after);
      }
      if (kind === "fpark") { rts.add("world.now"); rts.add("world.sleep"); rts.add("fibers.park"); return stated(`lab__fpark(${args(e.args, pre, d, after)[0]})`, "i32", pre, d); }
      // together and race (C44): each action on a fiber of its own, run
      // till it parks or finishes, in order; then the parked one soonest
      // ready (the first of those tied) goes on, till every one has its
      // value (together) or one has (race: the first in order).
      if (kind === "fbranches") {
        rts.add("world.now"); rts.add("world.sleep"); rts.add("fibers.park");
        const race = rest[0] === "first", T = e.host!.t, lt = typeOf(e.args[0], f.locals) as DType;
        const ltag = lt.cases.findIndex((c) => c.fields.length > 0), lcons = cname(lt, ltag), lhead = lt.cases[ltag].fields.findIndex((x) => x.t !== lt);
        const at = lt.cases[ltag].fields[lhead].t as FType, A = at.result, N = fiberC.length, Bn = `lab__br_${N}`;
        const call = `((${fname.get(at.key)})((lab_closure *)a)->code)(a)`;
        const each = (l: string, body: string) => `for (lab_cell *c = ${l}; c->tag == ${ltag}; c = ((${lcons} *)c)->f${1 - lhead}) { lab_cell *x = ((${lcons} *)c)->f${lhead}; ${body} }`;
        const dropV = (v: string) => (counted(A) ? drop(A, v) : "");
        let made = "";
        if (!race) {
          const rt = T as DType, rtag = rt.cases.findIndex((c) => c.fields.length > 0), rcons = cname(rt, rtag), rhead = rt.cases[rtag].fields.findIndex((x) => x.t !== rt);
          made = `lab_cell *r = (&${cname(rt, 1 - rtag)}); for (int k = n; k-- > 0;) { ${rcons} *c = lab_new(sizeof(${rcons}), ${tnum.get(rt.key)}, ${rtag}); c->f${rhead} = bs[k]->v; c->f${1 - rhead} = r; r = (lab_cell *)c; free(bs[k]); } free(bs); return r;`;
        }
        fiberC.push([
          `typedef struct { lab__frame f; lab_cell *act; ${ty(A)} v; double at; int done; } ${Bn};`,
          `static void lab__bre_${N}(lab__frame *f) { ${Bn} *b = (${Bn} *)f; lab_cell *a = b->act; b->act = 0; b->v = ${call}; }`,
          `static void lab__brs_${N}(${Bn} *b) { if (lab__fgo(&b->f) < 0) b->done = 1; else b->at = lab__park_at; }`,
          `static ${ty(T)} lab__brun_${N}(lab_cell *acts) {`,
          `  int n = 0, k = 0;`,
          `  ${each("acts", "n++;")}`,
          `  ${Bn} **bs = calloc(n ? n : 1, sizeof *bs);`,
          `  if (!bs) lab_oom();`,
          `  ${each("acts", `${Bn} *b = bs[k++] = calloc(1, sizeof *b); if (!b) lab_oom(); lab_dup(x); b->act = x; lab__fstart(&b->f, LAB_PARK, lab__bre_${N}); lab__brs_${N}(b); if (lab_st) { lab_drop(acts); return ${zero(T)}; }`)}`,
          `  lab_drop(acts);`,
          "  for (;;) {",
          ...(race ? [`    for (k = 0; k < n; k++) if (bs[k]->done) { ${ty(A)} r = bs[k]->v; for (int j = k + 1; j < n; j++) if (bs[j]->done) { ${dropV("bs[j]->v")} } return r; }`] : []),
          "    int m = -1;",
          "    for (k = 0; k < n; k++) if (!bs[k]->done && (m < 0 || bs[k]->at < bs[m]->at)) m = k;",
          `    if (m < 0) ${race ? `{ lab_reason = ${textLit("race of no actions has no first")}; lab_st = 2; return ${zero(T)}; }` : "break;"}`,
          "    lab__fpark(bs[m]->at);",
          `    lab__fresume(&bs[m]->f); lab__brs_${N}(bs[m]);`,
          `    if (lab_st) return ${zero(T)};`,
          "  }",
          `  ${made}`,
          "}",
        ].join("\n"));
        return checked(`lab__brun_${N}(${args(e.args, pre, d, after).join(", ")})`, T, pre, d, after);
      }
      if (kind === "fperform") {
        const [eff, op] = rest, n = fiberEffect(eff);
        const xs = args(e.args, pre, d, after);
        xs.forEach((x, j) => pre.push(`${d}${fiberGlobal(`lab__fa_${n}_${op}_${j}`, typeOf(e.args[j], f.locals))} = ${x};`));
        pre.push(`${d}lab__fperform(${n}, ${op});`);
        return stated(fiberGlobal(`lab__fy_${n}_${op}`, e.host!.t), e.host!.t, pre, d);
      }
      const [, eff, nowS, finS] = rest, n = fiberEffect(eff), now = nowS ? nowS.split(",").map(Number) : [];
      const N = fiberC.length, H = `lab__fh_${N}`, T = e.host!.t;
      const types = e.args.map((x) => typeOf(x, f.locals) as FType);
      const [bt, ...cts] = types, fin = finS === "fin" ? cts.pop()! : null;
      const fb = fiberGlobal(`lab__fb_${N}`, bt.result);
      const call = (fnT: FType, c: string, xs: string[]) => `((${fname.get(fnT.key)})((lab_closure *)${c})->code)(${[c, ...xs].join(", ")})`;
      const lines = [
        `typedef struct { lab__frame f; lab_cell *b, *c[${cts.length}], *fin; } ${H};`,
        `static void lab__fe_${N}(lab__frame *f) { ${H} *h = (${H} *)f; lab_cell *b = h->b; h->b = 0; ${fb} = ${call(bt, "b", [])}; }`,
        `static ${ty(T)} lab__fd_${N}(${H} *h);`,
      ];
      const arms: string[] = [];
      cts.forEach((ct, i) => {
        const later = !now.includes(i), ins = later ? ct.params.slice(0, -1) : ct.params;
        const xs = ins.map((p, j) => fiberGlobal(`lab__fa_${n}_${i}_${j}`, p));
        if (!later) {
          arms.push(`case ${i}: { lab_cell *c = h->c[${i}]; lab_dup(c); ${fiberGlobal(`lab__fy_${n}_${i}`, ct.result)} = ${call(ct, "c", xs)}; if (lab_st) return ${zero(T)}; lab__fresume(&h->f); continue; }`);
          return;
        }
        const rt = ct.params[ct.params.length - 1] as FType;
        lines.push(`static ${ty(rt.result)} lab__fr_${N}_${i}(lab_cell *self, ${ty(rt.params[0])} y) { ${H} *h = ((lab__frest *)self)->k; lab_drop(self); ${fiberGlobal(`lab__fy_${n}_${i}`, rt.params[0])} = y; lab__fresume(&h->f); return lab__fd_${N}(h); }`);
        arms.push(`case ${i}: { lab__frest *r = lab_new(sizeof(lab__frest), 65535, 0); r->code = (void (*)(void))lab__fr_${N}_${i}; r->k = h; lab_cell *c = h->c[${i}]; lab_dup(c); return ${call(ct, "c", [...xs, "(lab_cell *)r"])}; }`);
      });
      const done = fin ? `lab_cell *fin = h->fin; free(h); return ${call(fin, "fin", [fb])};` : `free(h); return ${fb};`;
      lines.push(
        `static ${ty(T)} lab__fd_${N}(${H} *h) {`,
        "  for (;;) switch (lab__fgo(&h->f)) {",
        ...arms.map((a) => `    ${a}`),
        `    default: { for (int k = 0; k < ${cts.length}; k++) lab_drop(h->c[k]); if (lab_st) { ${fin ? "lab_drop(h->fin); " : ""}free(h); return ${zero(T)}; } ${done} }`,
        "  }",
        "}",
        `static ${H} *lab__fmk_${N}(${["lab_cell *b", ...cts.map((_, k) => `lab_cell *c${k}`), ...(fin ? ["lab_cell *fin"] : [])].join(", ")}) { ${H} *h = calloc(1, sizeof *h); if (!h) lab_oom(); h->b = b; ${cts.map((_, k) => `h->c[${k}] = c${k};`).join(" ")}${fin ? " h->fin = fin;" : ""} lab__fstart(&h->f, ${n}, lab__fe_${N}); return h; }`,
      );
      fiberC.push(lines.filter(Boolean).join("\n"));
      return checked(`lab__fd_${N}(lab__fmk_${N}(${args(e.args, pre, d, after).join(", ")}))`, T, pre, d, after);
    }
    // A call of something with one answer or none: if it has none, out.
    function checked(call: string, t: LType, pre: string[], d: string, after: Set<number>): string {
      const v = temp(t);
      pre.push(`${d}${v} = ${call};`, `${d}if (lab_st) {`, ...out(d + "  ", after), `${d}}`);
      return v;
    }

    // An expression, with the statements it needs first. `after`: the
    // counted locals used after it.
    function ex(e: SExpr, pre: string[], d: string, after: Set<number>): string {
      switch (e.k) {
        case "num": return num(e.v);
        case "bool": return e.v ? "1" : "0";
        case "int": return lowered.int32 ? `((int32_t)${e.v})` : intLit(e.v);
        case "text": return textLit(e.v);
        case "rt": {
          const st = STACK.exec(e.fn);
          if (st) {
            rts.add("handlers");
            let n = effectNums.get(st[2]);
            if (n === undefined) effectNums.set(st[2], (n = effectNums.size));
            const xs = args(e.args, pre, d, after);
            const c = st[1] === "hpush" ? `lab_handlers_push(${n}, ${xs.length}, (lab_cell *[]){ ${xs.join(", ")} })` : st[1] === "hpop" ? `lab_handlers_pop(${n})` : st[1] === "hhas" ? `lab_handlers_has(${n})` : st[1] === "htake" ? `lab_handlers_take(${n}, ${st[3]})` : st[1] === "hgive" ? `lab_handlers_give(${n})` : `lab_handlers_case(${n}, ${st[3]})`;
            return stated(c, e.host!.t, pre, d);
          }
          if (isFiber(e.fn)) { rts.add("fibers"); return fiber(e as SExpr & { k: "rt" }, pre, d, after); }
          if (e.fn === "par:together") {
            const n = togetherSite(typeOf(e.args[0], f.locals) as DType, e.host!.t as DType);
            return checked(`lab_par_together_${n}(${args(e.args, pre, d, after).join(", ")})`, e.host!.t, pre, d, after);
          }
          if (isSplit(e.fn)) {
            splits = true;
            const xs = args(e.args, pre, d, after);
            if (e.fn !== "choose.split") return stated(`${cName(e.fn)}(${xs.join(", ")})`, "f64", pre, d);
            const t = e.host!.t as DType;
            if (!splitLists.has(t.key)) splitLists.set(t.key, { n: splitLists.size, t });
            return stated(`lab_split_${splitLists.get(t.key)!.n}(${xs[0]})`, t, pre, d);
          }
          const sh = /^par:(count|all|first):search$/.exec(e.fn);
          if (sh) return checked(`lab_par_search_${countSite(typeOf(e.args[0], f.locals) as FType, sh[1] as SearchHow)}(${args(e.args, pre, d, after).join(", ")})`, e.host!.t, pre, d, after);
          if (isPar(e.fn)) {
            const job = (e.fn.startsWith("par:fold:") ? e.fn.slice(9) : e.fn.slice(4)) as "map" | "keep" | "all" | "any" | "first" | "add" | "max" | "min", ta = typeOf(e.args[0], f.locals) as AType;
            const n = parSite(ta, typeOf(e.args[1], f.locals) as FType, job === "all" || job === "any" || folds(job) ? ta : e.host!.t as AType, job);
            return checked(`lab_par_map_${n}(${args(e.args, pre, d, after).join(", ")})`, e.host!.t, pre, d, after);
          }
          if (isPerform(e.fn)) {
            const h = hostOf(e.fn)!;
            let n = hostsUsed.get(h.op);
            if (n === undefined) hostsUsed.set(h.op, (n = hostsUsed.size));
            hostTypes.set(h.op, e.host!.t);
            return checked(`lab_host_${n}(${args(e.args, pre, d, after).join(", ")})`, e.host!.t, pre, d, after);
          }
          (ARRAY_FN.test(e.fn) || TABLE_FN.test(e.fn) ? arrayFns : rts).add(e.fn);
          const c = `${cName(e.fn)}(${args(e.args, pre, d, after).join(", ")})`;
          return runtime(e.fn).partial ? checked(c, rtType(e.fn), pre, d, after) : stated(c, rtType(e.fn), pre, d);
        }
        // The console and files: a Unit's call is a statement; one that
        // fails has set lab_st to 2, with the reason.
        case "world": {
          rts.add(`world.${e.op}`);
          const c = `${cName(`world.${e.op}`)}(${args(e.args, pre, d, after).join(", ")})`;
          const unit = isRecord(e.t) && !e.t.fields.length;
          if (!unit) return e.aborts ? checked(c, e.t, pre, d, after) : stated(c, e.t, pre, d);
          pre.push(`${d}${c};`, ...(e.aborts ? [`${d}if (lab_st) {`, ...out(d + "  ", after), `${d}}`] : []));
          return zero(e.t);
        }
        // The reason goes in lab_reason, then out with status 2; another
        // operation that never returns (C34) is in lab_reason as a cell of
        // its effect's type, with status 2 + its number.
        case "abort": {
          const r = ex(e.reason, pre, d, after);
          pre.push(`${d}lab_reason = ${r};`, `${d}lab_st = ${2 + (e.esc ?? 0)};`, ...out(d, after));
          return "0";
        }
        case "local": return isCounted(e.i) && after.has(e.i) ? dup(f.locals[e.i], local(e.i)) : local(e.i);
        case "let": {
          const body = free(e.body);
          pre.push(`${d}${local(e.i)} = ${ex(e.value, pre, d, union(after, without(body, e.i)))};`);
          if (isCounted(e.i) && !body.has(e.i) && !after.has(e.i)) pre.push(`${d}${drop(f.locals[e.i], local(e.i))}`);
          return ex(e.body, pre, d, after);
        }
        case "if": case "case": case "attempt": case "budget": case "handle": case "released": {
          const t = temp(e.k === "case" ? e.result : e.t);
          pre.push(...block(e, { set: t }, d, after));
          return t;
        }
        case "make": {
          const xs = args(e.args, pre, d, after);
          if (!e.t.mutable) return `((${ty(e.t)}){ ${xs.join(", ") || "0"} })`;
          const v = temp(e.t), n = sname.get(e.t.key)!;
          pre.push(`${d}${v} = lab_new(sizeof(${n}), ${tnum.get(e.t.key)}, 0);`, ...xs.map((x, k) => `${d}((${n} *)${v})->f${k} = ${x};`));
          return v;
        }
        case "get": {
          // A page's cell read is noted, for the part reading it (READS_C).
          const touch = opts.page && e.t.mutable && e.t.key.startsWith("cell:");
          return borrow(e.rec, e.t.fields[e.i].t, (r) => (e.t.mutable ? `((${sname.get(e.t.key)} *)${touch ? `lab_touch(${r})` : r})->f${e.i}` : `${r}.f${e.i}`), pre, d, after);
        }
        case "new": {
          const c = e.t.cases[e.c];
          if (!c.fields.length) return `(&${cname(e.t, e.c)})`;
          const xs = args(e.args, pre, d, after);
          const v = temp(e.t), n = cname(e.t, e.c);
          const r = tokens.findLast((x) => x.alive && x.fields === layout(c.fields));
          const made = `${v} = lab_new(sizeof(${n}), ${tnum.get(e.t.key)}, ${e.c});`;
          if (r) { r.alive = false; r.used = true; }
          pre.push(r ? `${d}if (${r.v}) { ${v} = ${r.v}; ${v}->type = ${tnum.get(e.t.key)}; ${v}->tag = ${e.c}; } else ${made}` : `${d}${made}`, ...xs.map((x, k) => `${d}((${n} *)${v})->f${k} = ${x};`));
          return v;
        }
        // A written list (L181b): its items in order, then a cell for each
        // from the last, onto the empty case.
        case "list": {
          const xs = args(e.items, pre, d, after), c = e.t.cases[e.c], n = cname(e.t, e.c), v = temp(e.t);
          pre.push(`${d}${v} = (&${cname(e.t, e.t.cases.findIndex((x) => !x.fields.length))});`);
          const cell = temp(e.t);
          for (let k = xs.length - 1; k >= 0; k--) {
            pre.push(`${d}${cell} = lab_new(sizeof(${n}), ${tnum.get(e.t.key)}, ${e.c}); ${c.fields.map((x, j) => `((${n} *)${cell})->f${j} = ${x.t === e.t ? v : xs[k]};`).join(" ")} ${v} = ${cell};`);
          }
          return v;
        }
        case "field": return borrow(e.rec, e.t.cases[e.c].fields[e.i].t, (r) => `((${cname(e.t, e.c)} *)${r})->f${e.i}`, pre, d, after);
        case "tag": return borrow(e.rec, "i32", (r) => `(int32_t)${r}->tag`, pre, d, after);
        case "call": {
          const ps = lent.get(e.fn);
          if (once.has(e.fn)) {
            const m = `lab_m${e.fn}`, t = funcs[e.fn].result, v = temp(t);
            pre.push(`${d}if (!${m}_has) { ${m} = ${names.get(e.fn)}(); ${m}_has = 1; }`, `${d}${v} = ${counted(t) ? dup(t, m) : m};`);
            return v;
          }
          if (!ps) {
            const c = `${names.get(e.fn)}(${args(e.args, pre, d, after).join(", ")})`;
            return funcs[e.fn].partial ? checked(c, funcs[e.fn].result, pre, d, after) : stated(c, funcs[e.fn].result, pre, d);
          }
          // Lent inputs (C94): a local still used after the call, or one
          // lent to this function, goes as it is; any other value is held
          // through the call and dropped after it.
          const as = (a: SExpr) => a.k === "local" && (!isCounted(a.i) || after.has(a.i));
          const xs = args(e.args.map((a, k) => (ps.has(k) && as(a) ? { k: "num", v: 0 } as SExpr : a)), pre, d, after);
          const held: { t: LType; v: string }[] = [];
          e.args.forEach((a, k) => {
            if (!ps.has(k)) return;
            if (as(a)) { xs[k] = local((a as Extract<SExpr, { k: "local" }>).i); return; }
            const v = temp(funcs[e.fn].params[k]);
            pre.push(`${d}${v} = ${xs[k]};`);
            xs[k] = v;
            held.push({ t: funcs[e.fn].params[k], v });
          });
          pending.push(...held);
          const c = `${bnames.get(e.fn)}(${xs.join(", ")})`;
          const r = funcs[e.fn].partial ? checked(c, funcs[e.fn].result, pre, d, after) : stated(c, funcs[e.fn].result, pre, d);
          pending.splice(pending.length - held.length);
          for (const h of held) pre.push(`${d}${drop(h.t, h.v)}`);
          return r;
        }
        case "closure": {
          const s = shapes[e.shape], n = shapeName.get(e.shape)!;
          const xs = args(e.caps, pre, d, after);
          const v = temp(s.t);
          pre.push(`${d}${v} = lab_new(sizeof(${n}), ${tnum.get(`shape ${e.shape}`)}, 0);`, `${d}((${n} *)${v})->code = (void (*)(void))${names.get(e.fn)};`, ...xs.map((x, k) => `${d}((${n} *)${v})->c${k} = ${x};`));
          return v;
        }
        case "cap": return borrow({ k: "local", i: 0 }, shapes[e.shape].caps[e.i], (r) => `((${shapeName.get(e.shape)} *)${r})->c${e.i}`, pre, d, after);
        case "apply": {
          // The closure goes to its own code, which owns it, as its first input.
          const [fn, ...xs] = args([e.fn, ...e.args], pre, d, after);
          const t = temp(e.t);
          pre.push(`${d}${t} = ${fn};`);
          const c = `((${fname.get(e.t.key)})((lab_closure *)${t})->code)(${[t, ...xs].join(", ")})`;
          return e.t.partial ? checked(c, e.t.result, pre, d, after) : stated(c, e.t.result, pre, d);
        }
        case "fail": pre.push(`${d}lab_st = 1;`, ...out(d, after)); return "0";
        case "zero": if (e.none) pre.push(`${d}lab_none = 1;`); return zero(e.t);
        case "set": {
          // The box is borrowed; what it held is dropped.
          const n = sname.get(e.t.key)!, ft = e.t.fields[e.i].t;
          const box = ex(e.rec, pre, d, union(after, free(e.value), free(e.then)));
          const b = temp(e.t);
          pre.push(`${d}${b} = ${box};`);
          pending.push({ t: e.t, v: b });
          const v = ex(e.value, pre, d, union(after, free(e.then)));
          pending.pop();
          if (counted(ft)) { const old = temp(ft); pre.push(`${d}${old} = ((${n} *)${b})->f${e.i};`, `${d}((${n} *)${b})->f${e.i} = ${v};`, `${d}${drop(ft, old)}`); }
          else pre.push(`${d}((${n} *)${b})->f${e.i} = ${v};`);
          if (opts.page && e.t.key.startsWith("cell:")) pre.push(`${d}lab_wrote(${b});`);
          pre.push(`${d}${drop(e.t, b)}`);
          return ex(e.then, pre, d, after);
        }
        case "op": {
          const xs = args(e.args, pre, d, after);
          if (INFIX[e.op]) return `(${xs[0]} ${INFIX[e.op]} ${xs[1]})`;
          if (e.op === "neg") return `(-${xs[0]})`;
          if (e.op === "not") return `(!${xs[0]})`;
          if (e.op === "float32") return `((double)(float)${xs[0]})`;
          if (e.op === "mod") return `lab_mod(${xs.join(", ")})`;
          if (e.op === "stop") return `lab_stop(${xs[0]})`;
          if (e.op === "itof") return `((double)${xs[0]})`;
          // A 32-bit machine word (C150f): wrapping, compared unsigned.
          if (UOPS[e.op]) return `((int32_t)((uint32_t)${xs[0]} ${UOPS[e.op]} (uint32_t)${xs[1]}))`;
          if (e.op === "uneg") return `((int32_t)(0u - (uint32_t)${xs[0]}))`;
          if (e.op === "uless") return `((uint32_t)${xs[0]} < (uint32_t)${xs[1]})`;
          // And a 64-bit one (C150h).
          if (U64OPS[e.op]) return `((int64_t)((uint64_t)${xs[0]} ${U64OPS[e.op]} (uint64_t)${xs[1]}))`;
          if (e.op === "u64neg") return `((int64_t)(0u - (uint64_t)${xs[0]}))`;
          if (e.op === "u64less") return `((uint64_t)${xs[0]} < (uint64_t)${xs[1]})`;
          if (INT32_C[e.op]) { int32Used.add(e.op); return `lab_${e.op}(${xs.join(", ")})`; }
          if (OPS[e.op].t === "int32") throw new Error(`an Int's ${e.op} in 32 bits isn't in C yet`);
          return `${LIBM[e.op] ?? LIBRARY[e.op]}(${xs.join(", ")})`;
        }
        default: throw new Error(`${e.k} in C comes with NATIVE.md's stage N4`);
      }
    }

    // Statements that end by returning e's value, or setting a variable to it.
    // An arm that reads its case's fields into locals and then no longer
    // needs the cell: if nothing else holds the cell, its fields move into
    // the locals (no dup now, no drop when it goes) and the cell is freed
    // with the fields nobody took dropped by type, not by lab_fields; if
    // it's shared, the fields are dup'd and the cell loses one count.
    // Perceus's drop specialization (Reinking, Xie, de Moura and Leijen,
    // PLDI 2021). And the cell itself goes to the arm's first new cell
    // with the same fields, if every way through makes one or frees it
    // (Lean 4's reset and reuse: Ullrich and de Moura, IFL 2019).
    function takeApart(a: SExpr, s: number, t: DType, c: number, after: Set<number>, d: string, rest: (b: SExpr) => string[]): string[] | null {
      const reads: { i: number; f: number }[] = [];
      let body = a;
      while (body.k === "let" && body.value.k === "field" && body.value.rec.k === "local" && body.value.rec.i === s && body.value.c === c) {
        reads.push({ i: body.i, f: body.value.i });
        body = body.body;
      }
      // Fields read later in the arm (a function written in the lowering
      // reads them where it uses them) are read into locals here too.
      const later = walk(body).filter((x): x is Extract<SExpr, { k: "field" }> => x.k === "field" && x.rec.k === "local" && x.rec.i === s);
      if (later.some((x) => x.c !== c)) return null;
      if (later.length) {
        const into = new Map<number, number>();
        for (const x of later) {
          if (into.has(x.i)) continue;
          const j = f.locals.push(t.cases[c].fields[x.i].t) - 1;
          decls.push(`  ${ty(f.locals[j])} ${local(j)};`);
          into.set(x.i, j);
          reads.push({ i: j, f: x.i });
        }
        const swap = (x: SExpr): SExpr => (x.k === "field" && x.rec.k === "local" && x.rec.i === s ? { k: "local", i: into.get(x.i)! } : mapKids(x, swap));
        body = swap(body);
      }
      if (!reads.length || free(body).has(s) || new Set(reads.map((r) => r.f)).size < reads.length) return null;
      const used = union(free(body), after);
      const n = cname(t, c), fields = t.cases[c].fields;
      const at = (k: number) => `((${n} *)${local(s)})->f${k}`;
      const kept = reads.filter((r) => used.has(r.i) || !counted(f.locals[r.i]));
      const moved = new Set(kept.map((r) => r.f));
      // The rest with the cell to give away; if some way through neither
      // used nor freed it, the rest again without.
      const r = { v: `r${temps++}`, fields: layout(fields), alive: true, used: false };
      if (!walk(body).some((x) => x.k === "new" && x.t.cases[x.c].fields.length && layout(x.t.cases[x.c].fields) === r.fields)) r.alive = false;
      const was = tokens.map((x) => [x.alive, x.used]);
      tokens.push(r);
      let lines = rest(body);
      tokens.pop();
      if (r.alive) {
        tokens.forEach((x, k) => ([x.alive, x.used] = was[k]));
        // Not given this time: what the first try did with it is undone
        // (a way out had freed it, so the cell was kept and leaked; C101).
        r.alive = false;
        r.used = false;
        lines = rest(body);
      }
      const give = !r.alive && r.used;
      if (give) decls.push(`  lab_cell * ${r.v};`);
      return [
        `${d}if (${local(s)}->rc == 1) {`,
        ...kept.map((r) => `${d}  ${local(r.i)} = ${at(r.f)};`),
        ...fields.flatMap((x, k) => (moved.has(k) || !counted(x.t) ? [] : [`${d}  ${drop(x.t, at(k))}`])),
        give ? `${d}  ${r.v} = ${local(s)};` : `${d}  lab_free(${local(s)});`,
        `${d}} else {`,
        ...kept.map((r) => `${d}  ${local(r.i)} = ${dup(f.locals[r.i], at(r.f))};`),
        threads ? `${d}  lab_drop(${local(s)});` : `${d}  if (${local(s)}->rc) ${local(s)}->rc--;`,
        ...(give ? [`${d}  ${r.v} = 0;`] : []),
        `${d}}`,
        ...lines,
      ];
    }
    function block(e: SExpr, to: { set: string } | "return", d: string, after: Set<number>): string[] {
      const pre: string[] = [];
      const give = (x: string) => (to === "return" ? `${d}return ${x};` : `${d}${to.set} = ${x};`);
      // A label inside may be gone to after a cell given away is used:
      // it's freed first.
      if ((e.k === "attempt" || e.k === "budget" || e.k === "handle") && tokens.some((x) => x.alive)) {
        const gone = letGo(tokens, d);
        tokens.forEach((x) => (x.alive = false));
        return [...gone, ...block(e, to, d, after)];
      }
      if (e.k === "let") {
        const body = free(e.body);
        pre.push(`${d}${local(e.i)} = ${ex(e.value, pre, d, union(after, without(body, e.i)))};`);
        if (isCounted(e.i) && !body.has(e.i) && !after.has(e.i)) pre.push(`${d}${drop(f.locals[e.i], local(e.i))}`);
        return [...pre, ...block(e.body, to, d, after)];
      }
      if (e.k === "if") {
        const live = union(after, free(e.then), free(e.else));
        const c = ex(e.cond, pre, d, live);
        const [then, other] = branches([() => block(e.then, to, d + "  ", after), () => block(e.else, to, d + "  ", after)], d + "  ");
        return [
          ...pre, `${d}if (${c}) {`, ...drops(live, free(e.then), after, d + "  "), ...then,
          `${d}} else {`, ...drops(live, free(e.else), after, d + "  "), ...other, `${d}}`,
        ];
      }
      if (e.k === "case") {
        const arms = e.arms.map((a) => (a ? free(a) : new Set<number>()));
        const live = union(after, ...arms);
        const s = ex(e.scrut, pre, d, without(live, e.s));
        if (s !== local(e.s)) pre.push(`${d}${local(e.s)} = ${s};`);
        const inLive = union(live, isCounted(e.s) ? new Set([e.s]) : new Set());
        pre.push(`${d}switch (${local(e.s)}->tag) {`);
        const js = e.arms.flatMap((a, j) => (a ? [j] : []));
        const bodies = branches(js.map((j) => () => {
          const a = e.arms[j]!, go = (b: SExpr) => block(b, to, d + "  ", after);
          return (isCounted(e.s) && !after.has(e.s) ? takeApart(a, e.s, e.t, j, after, d + "  ", go) : null) ?? go(a);
        }), d + "  ");
        js.forEach((j, k) => {
          pre.push(`${d}case ${j}: { // ${e.t.cases[j].name}`, ...drops(inLive, arms[j], after, d + "  "), ...bodies[k], ...(to === "return" ? [] : [`${d}  break;`]), `${d}}`);
        });
        pre.push(`${d}default: abort();`, `${d}}`);
        return pre;
      }
      if (e.k === "fail") return [`${d}lab_st = 1;`, ...out(d, after)];
      if (e.k === "abort") { ex(e, pre, d, after); return pre; }
      if (e.k === "handle") {
        // As an attempt for status 2 (no answer goes on out): the fuel back
        // as it was when the handler started, as the evaluator does, and
        // the reason the arm's.
        const keep = union(after, without(free(e.arm), e.reason));
        const done = `L${labels++}`;
        const lines: string[] = fuel ? [`${d}${local(e.save)} = lab_fuel;`] : [];
        let label = "";
        // On with an answer: what only the arm would use goes (I151; it
        // was kept, a list the arm read never freed).
        const armOnly = drops(keep, new Set(), after, d);
        within(keep, (l) => {
          label = l;
          const v = ex(e.body, lines, d, keep);
          if (!armOnly.length) { lines.push(give(v)); return; }
          const given = temp(e.t);
          lines.push(`${d}${given} = ${v};`, ...armOnly, give(given));
        });
        if (to !== "return") lines.push(`${d}goto ${done};`);
        lines.push(...at(d, label), `${d}if (lab_st != ${2 + (e.esc ?? 0)}) {`, ...out(d + "  ", keep), `${d}}`, ...(fuel ? [`${d}lab_fuel = ${local(e.save)};`] : []));
        lines.push(`${d}lab_st = 0;`, `${d}${local(e.reason)} = lab_reason;`, `${d}lab_reason = 0;`);
        lines.push(...drops(keep, free(e.arm), after, d), ...block(e.arm, to, d, after));
        if (to !== "return") lines.push(`${d}${done}:;`);
        return [...pre, ...lines];
      }
      if (e.k === "released") {
        // A handler's release (L213a6): the body; then the release, and its
        // answer. Ended with no answer or an Abort (any status), the
        // release runs with the status put aside, then out as before.
        const keep = union(after, free(e.release));
        const done = `L${labels++}`, given = temp(e.t), st = temp("i32"), why = temp("text");
        const lines: string[] = [];
        let label = "";
        within(keep, (l) => {
          label = l;
          lines.push(`${d}${given} = ${ex(e.body, lines, d, keep)};`);
        });
        lines.push(...block(e.release, { set: temp(typeOf(e.release, f.locals)) }, d, union(after, new Set())), give(given));
        if (to !== "return") lines.push(`${d}goto ${done};`);
        lines.push(...at(d, label), `${d}${st} = lab_st;`, `${d}${why} = lab_reason;`, `${d}lab_st = 0;`);
        lines.push(...block(e.release, { set: temp(typeOf(e.release, f.locals)) }, d, after));
        lines.push(`${d}lab_st = ${st};`, `${d}lab_reason = ${why};`, ...out(d, after));
        if (to !== "return") lines.push(`${d}${done}:;`);
        return [...pre, ...lines];
      }
      if (e.k === "attempt" && lowered.int32) {
        // The plain profile's search (C166): no answer inside is the flag
        // lab_none, saved and cleared around the body, as a shader's.
        const was = temp("i32"), got = temp("i32");
        const lines = [`${d}${was} = lab_none;`, `${d}lab_none = 0;`];
        lines.push(`${d}${local(e.res)} = ${ex(e.body, lines, d, union(after, free(e.ok), free(e.otherwise)))};`);
        lines.push(`${d}${got} = lab_none;`, `${d}lab_none = ${was};`, `${d}if (${got}) {`, ...block(e.otherwise, to, d + "  ", after), `${d}} else {`, ...block(e.ok, to, d + "  ", after), `${d}}`);
        return [...pre, ...lines];
      }
      if (e.k === "attempt" || (e.k === "budget" && fails(e.body, funcs))) {
        // body; then ok with its answer, or with none (status 1), otherwise.
        // A budget is one whose body runs on its own fuel.
        const budget = e.k === "budget" ? { s: temp("f64"), n: e.n } : null;
        const res = e.k === "attempt" ? e.res : -1;
        const keep = union(after, free(e.otherwise));
        const okFree = e.k === "attempt" ? without(free(e.ok), res) : new Set<number>();
        const done = `L${labels++}`;
        const lines: string[] = [];
        let label = "", given = "";
        if (budget) lines.push(`${d}${budget.s} = lab_fuel;`, `${d}lab_fuel = ${num(budget.n)};`);
        within(keep, (l) => {
          label = l;
          const v = ex(e.body, lines, d, union(keep, okFree));
          if (budget) lines.push(`${d}lab_fuel = ${budget.s};`);
          if (e.k === "attempt") lines.push(`${d}${local(res)} = ${v};`);
          else { given = temp(typeOf(e.body, f.locals)); lines.push(`${d}${given} = ${v};`); }
        });
        // On with an answer: what only otherwise would use goes.
        lines.push(...drops(free(e.otherwise), okFree, after, d));
        const okLines = e.k === "attempt" ? block(e.ok, to, d, after) : [give(given)];
        lines.push(...okLines);
        if (to !== "return") lines.push(`${d}goto ${done};`);
        lines.push(...at(d, label), ...(budget ? [`${d}lab_fuel = ${budget.s};`] : []));
        lines.push(`${d}if (lab_st != 1) {`, ...out(d + "  ", keep), `${d}}`, `${d}lab_st = 0;`);
        lines.push(...drops(keep, free(e.otherwise), after, d), ...block(e.otherwise, to, d, after));
        if (to !== "return") lines.push(`${d}${done}:;`);
        return [...pre, ...lines];
      }
      if (e.k === "budget") {
        const s = temp("f64"), t = to === "return" ? temp(e.t) : to.set;
        pre.push(`${d}${s} = lab_fuel;`, `${d}lab_fuel = ${num(e.n)};`, ...block(e.body, { set: t }, d, union(after, free(e.otherwise))));
        pre.push(`${d}if (lab_fuel < 0) {`, ...block(e.otherwise, { set: t }, d + "  ", after), `${d}} else {`, ...drops(free(e.otherwise), new Set(), after, d + "  "), `${d}}`, `${d}lab_fuel = ${s};`);
        return to === "return" ? [...pre, `${d}return ${t};`] : pre;
      }
      if (to === "return" && e.k === "call" && e.fn === i && e.tail) {
        // The loop's next round: every new value computed before any is set.
        const xs = args(e.args, pre, d, after);
        const ts = xs.map((x, j) => (x === `p${j}` ? null : { t: temp(f.params[j]), x, j }));
        for (const t of ts) if (t) pre.push(`${d}${t.t} = ${t.x};`);
        for (const t of ts) if (t) pre.push(`${d}p${t.j} = ${t.t};`);
        return [...pre, `${d}continue;`];
      }
      // A tail call of something with one answer or none, from one: its
      // status is this function's.
      if (to === "return" && f.partial && targets.length === 0 && ((e.k === "call" && e.tail && funcs[e.fn].partial && !lent.has(e.fn)) || (e.k === "apply" && e.tail && e.t.partial))) {
        const c = e.k === "call"
          ? `${names.get(e.fn)}(${args(e.args, pre, d, after).join(", ")})`
          : (() => { const [fn, ...xs] = args([e.fn, ...e.args], pre, d, after); const t = temp(e.t); pre.push(`${d}${t} = ${fn};`); return `((${fname.get(e.t.key)})((lab_closure *)${t})->code)(${[t, ...xs].join(", ")})`; })();
        return [...pre, `${d}return ${c};`];
      }
      const x = ex(e, pre, d, after);
      return [...pre, give(x)];
    }

    // One from the budget per call, and per round of the loop: running out
    // is no answer, in a function that may have none.
    const spend = (d: string) => (f.spends ? [`${d}lab_fuel -= 1;`, `${d}if (lab_fuel < 0) {`, ...(f.partial ? [...f.params.flatMap((t, j) => (isCounted(j) ? [`${d}  ${drop(t, `p${j}`)}`] : [])), `${d}  lab_st = 1;`] : []), `${d}  return ${zero(f.result)};`, `${d}}`] : []);
    // Inputs the body never reads are dropped as it starts.
    const unread = (d: string) => f.params.map((t, j) => (isCounted(j) && !free(f.body).has(j) ? `${d}${drop(t, `p${j}`)}` : "")).filter(Boolean);
    const body = loops
      ? ["  for (;;) {", ...spend("    "), ...unread("    "), ...block(f.body, "return", "    ", new Set()), "  }"]
      : [...spend("  "), ...unread("  "), ...block(f.body, "return", "  ", new Set())];
    // Only the locals the body uses (the lowering's own for budgets aren't).
    const words = new Set(body.join("\n").match(/\w+/g)), named = decls.filter((x) => words.has(/(\w+);$/.exec(x)![1]));
    const text = [`// ${f.name.replace(/\n/g, " ")}`, `${header(i, !!mine)} {`, ...named, ...body, "}"].join("\n");
    if (!mine) return text;
    // The one the host and closures call: it owns its inputs.
    const ps = f.params.map((_, j) => `p${j}`);
    return [text, `${header(i)} {`, `  ${ty(f.result)} r = ${bnames.get(i)}(${ps.join(", ")});`, ...[...mine].map((j) => `  ${drop(f.params[j], `p${j}`)}`), "  return r;", "}"].join("\n");
  }

  // The type of e's value.
  function typeOf(e: SExpr, locals: LType[]): LType {
    switch (e.k) {
      case "local": return locals[e.i];
      case "bool": case "tag": return "i32";
      case "op": return OPS[e.op].t;
      case "new": case "list": return e.t;
      case "field": return e.t.cases[e.c].fields[e.i].t;
      case "get": return e.t.fields[e.i].t;
      case "make": case "zero": return e.t;
      case "call": return funcs[e.fn].result;
      case "let": case "set": return typeOf(e.k === "let" ? e.body : e.then, locals);
      case "if": case "budget": case "attempt": case "handle": case "released": return e.t;
      case "int": return lowered.int32 ? "int32" : "int";
      case "text": return "text";
      case "rt": return isPerform(e.fn) || isStack(e.fn) || isFiber(e.fn) || isPar(e.fn) || isSplit(e.fn) ? e.host!.t : rtType(e.fn);
      case "world": return e.t;
      case "case": return e.result;
      case "closure": return shapes[e.shape].t;
      case "cap": return shapes[e.shape].caps[e.i];
      case "apply": return e.t.result;
      default: return "f64";
    }
  }

  // A value that stands for none: what a function gives with no answer,
  // and what a box holds before a search sets it.
  function zero(t: LType): string {
    return t === "f64" || t === "i32" || t === "int32" || t === "i64" ? "0" : t === "int" ? "LAB_SMALL(0)" : cell(t) ? "((lab_cell *)0)" : `((${ty(t)}){ ${(t as RType).fields.map((x) => zero(x.t)).join(", ") || "0"} })`;
  }

  // std's Array (C66b), as in runtime.js and WebAssembly: a view (a
  // counted cell: its buffer, start and length) on a buffer with free room
  // at both ends, which keeps its lowest and highest used slots and owns
  // the items between them. A push writes into the slot past the view's end
  // when no other view has taken it, and copies the view's items (dup'd)
  // into a new buffer otherwise; a view nobody else holds is reused for the
  // longer one. Ersagun's two-ended array list; prior art: deques as ring
  // buffers, gap buffers, Go's slices, and Perceus's reuse of a cell whose
  // count is 1 (Reinking, Xie, de Moura and Leijen, PLDI 2021).
  // std's Table (C63h, docs/design/data/IN-PLACE.md "Step 2 on WebAssembly
  // and C"): Map as a hash table, open addressing with linear probing, its
  // slots malloc'd beside the counted cells of its versions. A put or
  // remove changes it in place when nobody else holds it (Perceus's reuse,
  // as `array.replaceAt`); otherwise the version it was given becomes the
  // change back from the new one, as std.ts's Table in JavaScript (C71), so
  // every version stays a value and a map read again after a change pays
  // only for the changes it walks back over, not a copy. Keys are Ints (hashed by value, or by limbs when big) or Texts
  // (FNV-1a over their bytes); entries come out sorted by compare's order,
  // so its meaning is the sorted Map. Prior art: Knuth's linear probing
  // (TAOCP vol. 3, 6.4); Fowler, Noll and Vo's FNV hash; Reinking, Xie,
  // de Moura and Leijen, Perceus (PLDI 2021); Baker's shallow binding
  // ("Shallow binding makes functional arrays fast", 1991), as Conchon and
  // Filliâtre's persistent arrays (2007).
  function tableC(t: TType): string[] {
    const fns = [...arrayFns].filter((f) => TABLE_FN.exec(f) && Number(TABLE_FN.exec(f)![2]) === t.index);
    if (!fns.length) return [];
    const i = t.index, T = `lab_Table_t${i}`, S = `lab_Store_t${i}`, tn = tnum.get(`table ${t.key}`)!, V = ty(t.value);
    // A key is an Int, a Text, or a record (a tuple) of them (C63k): its
    // parts in order, `leaves`, hashed, compared and ordered one by one.
    const kt = t.keyT, int = kt === "int", K = ty(kt);
    // A Float64 key is one nothing fixes: none is ever made.
    const leaves = (x: LType, at: string): ["int" | "text" | "f64", string][] => (x === "int" || x === "text" || x === "f64" ? [[x, at]] : (x as RType).fields.flatMap((f, j) => leaves(f.t, `${at}.f${j}`)));
    const parts = (at: string) => leaves(kt, at);
    const kinds = new Set(parts("").map(([x]) => x));
    const dupK = (x: string) => (counted(kt) ? dup(kt, x) : x), dropK = (x: string) => (counted(kt) ? drop(kt, x) : "");
    const dupV = (x: string) => (counted(t.value) ? dup(t.value, x) : x), dropV = (x: string) => (counted(t.value) ? drop(t.value, x) : "");
    const has = (op: string) => arrayFns.has(`table.${op}.t${i}`);
    const leafHelpers = [...(kinds.has("int") ? [`static inline uint64_t lab__hi_t${i}(lab_int k) {
  uint64_t h;
  if (LAB_IS_SMALL(k)) h = (uint64_t)LAB_VAL(k);
  else { lab_big *b = LAB_BIG(k); h = b->neg ? 0x9e3779b97f4a7c15u : 0; for (uint32_t j = 0; j < b->n; j++) h = (h ^ b->d[j]) * 0x100000001b3u; }
  h ^= h >> 30; h *= 0xbf58476d1ce4e5b9u; h ^= h >> 27; h *= 0x94d049bb133111ebu; h ^= h >> 31;
  return h;
}
static inline int lab__ei_t${i}(lab_int a, lab_int b) {
  if (LAB_IS_SMALL(a) || LAB_IS_SMALL(b)) return a == b;
  return LAB_BIG(a)->neg == LAB_BIG(b)->neg && lab__cmp(LAB_BIG(a)->d, LAB_BIG(a)->n, LAB_BIG(b)->d, LAB_BIG(b)->n) == 0;
}`] : []), ...(kinds.has("text") ? [`static inline uint64_t lab__ht_t${i}(lab_cell *k) {
  uint64_t h = 0xcbf29ce484222325u;
  for (uint32_t j = 0; j < LAB_TN(k); j++) h = (h ^ LAB_TB(k)[j]) * 0x100000001b3u;
  return h ^ (h >> 32);
}
static inline int lab__et_t${i}(lab_cell *a, lab_cell *b) { return LAB_TN(a) == LAB_TN(b) && memcmp(LAB_TB(a), LAB_TB(b), LAB_TN(a)) == 0; }`] : []), ...(kinds.has("f64") ? [`static inline uint64_t lab__hf_t${i}(double k) { uint64_t h; memcpy(&h, &k, 8); return h * 0x9e3779b97f4a7c15u; }
static inline int lab__ef_t${i}(double a, double b) { return a == b; }`] : [])];
    const out = [`// ${t.set ? `Hash set ${i}: ${int ? "Int" : typeof kt === "string" ? kt : "tuple"} items` : `Table ${i}: ${int ? "Int" : typeof kt === "string" ? kt : "tuple"} keys, ${V} values`}.
${leafHelpers.join("\n")}
static inline uint64_t lab__hash_t${i}(${K} k) {
  uint64_t h = 0;
${parts("k").map(([x, at]) => `  h = (h ^ lab__h${x[0]}_t${i}(${at})) * 0x100000001b3u;`).join("\n")}
  return h ^ (h >> 29);
}
static inline int lab__eq_t${i}(${K} a, ${K} b) {
  return ${parts("").map(([x, at]) => `lab__e${x[0]}_t${i}(a${at}, b${at})`).join(" && ")};
}
// The slot holding k, or the free one where it would go (a removed one
// first), with *found saying which.
static inline uint32_t lab__find_t${i}(${S} *t, ${K} k, int *found) {
  uint32_t m = t->cap - 1, j = (uint32_t)lab__hash_t${i}(k) & m, free_at = UINT32_MAX;
  for (;; j = (j + 1) & m) {
    if (t->st[j] == 0) { *found = 0; return free_at != UINT32_MAX ? free_at : j; }
    if (t->st[j] == 2) { if (free_at == UINT32_MAX) free_at = j; continue; }
    if (lab__eq_t${i}(t->ks[j], k)) { *found = 1; return j; }
  }
}
static inline ${S} *lab__store_t${i}(uint32_t cap) {
  ${S} *t = malloc(sizeof(${S}));
  if (!t) lab_oom();
  t->n = 0; t->used = 0; t->cap = cap;
  t->st = calloc(cap, 1); t->ks = malloc(cap * sizeof(${K})); t->vs = malloc(cap * sizeof(${V}));
  if (!t->st || !t->ks || !t->vs) lab_oom();
  return t;
}
static inline ${T} *lab__made_t${i}(${S} *s) {
  ${T} *t = lab_new(sizeof(${T}), ${tn}, 0);
  t->cur = s; t->next = 0; t->had = 0;
  return t;
}
// Room for one more, at most 3/4 used: the full slots moved into twice
// the room (or the same, when removed ones took it).
static inline void lab__grow_t${i}(${S} *t) {
  if ((uint64_t)(t->used + 1) * 4 <= (uint64_t)t->cap * 3) return;
  uint32_t cap = (uint64_t)(t->n + 1) * 2 > t->cap ? t->cap * 2 : t->cap;
  if (cap < t->cap) lab_oom();
  uint8_t *st = t->st; ${K} *ks = t->ks; ${V} *vs = t->vs; uint32_t old = t->cap;
  t->st = calloc(cap, 1); t->ks = malloc(cap * sizeof(${K})); t->vs = malloc(cap * sizeof(${V}));
  if (!t->st || !t->ks || !t->vs) lab_oom();
  t->cap = cap; t->used = t->n;
  for (uint32_t j = 0; j < old; j++) if (st[j] == 1) { int f; uint32_t at = lab__find_t${i}(t, ks[j], &f); t->st[at] = 1; t->ks[at] = ks[j]; t->vs[at] = vs[j]; }
  free(st); free(ks); free(vs);
}
// Make t the newest version (std.ts reroot): undo, from the newest back,
// each change between it and t, each undone one becoming the change that
// redoes it. The newer of two holds no count on the older.
static void lab__reroot_t${i}(${T} *t) {
  if (t->cur) return;
  uint32_t n = 0, room = 16;
  ${T} **path = malloc(room * sizeof *path), *x = t;
  if (!path) lab_oom();
  while (!x->cur) {
    if (n == room) { room *= 2; path = realloc(path, room * sizeof *path); if (!path) lab_oom(); }
    path[n++] = x; x = (${T} *)x->next;
  }
  while (n-- > 0) {
    ${T} *y = path[n];
    ${S} *m = x->cur;
    lab__grow_t${i}(m);
    int f; uint32_t j = lab__find_t${i}(m, y->key, &f);
    ${V} old = f ? m->vs[j] : ${zero(t.value)};
    if (y->had && f) m->vs[j] = y->old;
    else if (y->had) { if (m->st[j] == 0) m->used++; m->st[j] = 1; m->ks[j] = ${dupK("y->key")}; m->vs[j] = y->old; m->n++; }
    else if (f) { ${dropK("m->ks[j]")} m->st[j] = 2; m->n--; }
    x->cur = 0; x->key = y->key; x->had = f; x->old = old;
    x->next = lab_dup((lab_cell *)y);
    y->cur = m; y->next = 0;
    lab_drop((lab_cell *)x);
    x = y;
  }
  free(path);
}
// A put (set) or remove: changed in place when nobody else holds t, else
// a new newest version, t becoming the change back to it (std.ts change).
static lab_cell *lab__change_t${i}(lab_cell *c, ${K} k, int set, ${V} v) {
  ${T} *t = (${T} *)c;
  lab__reroot_t${i}(t);
  ${S} *m = t->cur;
  if (set) lab__grow_t${i}(m);
  int f; uint32_t j = lab__find_t${i}(m, k, &f);
  if (!set && !f) { ${dropK("k")} return c; }
  if (t->h.rc == 1) {
    if (set && f) { ${V} old = m->vs[j]; m->vs[j] = v; ${dropV("old")} (void)old; ${dropK("k")} }
    else if (set) { if (m->st[j] == 0) m->used++; m->st[j] = 1; m->ks[j] = k; m->vs[j] = v; m->n++; }
    else { ${dropK("m->ks[j]")} ${dropV("m->vs[j]")} m->st[j] = 2; m->n--; ${dropK("k")} }
    return c;
  }
  ${T} *nv = lab__made_t${i}(m);
  t->cur = 0; t->had = f; t->old = f ? m->vs[j] : ${zero(t.value)}; t->key = k;
  if (set && f) m->vs[j] = v;
  else if (set) { if (m->st[j] == 0) m->used++; m->st[j] = 1; m->ks[j] = ${dupK("k")}; m->vs[j] = v; m->n++; }
  else { ${dropK("m->ks[j]")} m->st[j] = 2; m->n--; }
  t->next = (lab_cell *)nv;
  lab_dup((lab_cell *)nv);
  lab_drop(c);
  return (lab_cell *)nv;
}`];
    if (has("empty")) out.push(`static lab_cell *lab_table_empty_t${i}(void) { return (lab_cell *)lab__made_t${i}(lab__store_t${i}(8)); }`);
    if (has("put")) out.push(`static lab_cell *lab_table_put_t${i}(lab_cell *c, ${K} k, ${V} v) { return lab__change_t${i}(c, k, 1, v); }`);
    if (has("remove")) out.push(`static lab_cell *lab_table_remove_t${i}(lab_cell *c, ${K} k) { return lab__change_t${i}(c, k, 0, ${zero(t.value)}); }`);
    if (has("has")) out.push(`static int32_t lab_table_has_t${i}(lab_cell *c, ${K} k) {
  lab__reroot_t${i}((${T} *)c);
  int f; lab__find_t${i}(((${T} *)c)->cur, k, &f);
  ${dropK("k")} lab_drop(c);
  return f;
}`);
    if (has("size")) out.push(`static lab_int lab_table_size_t${i}(lab_cell *c) { lab__reroot_t${i}((${T} *)c); lab_int n = LAB_SMALL(((${T} *)c)->cur->n); lab_drop(c); return n; }`);
    // No answer for a key it doesn't have.
    if (has("at")) out.push(`static ${V} lab_table_at_t${i}(lab_cell *c, ${K} k) {
  lab__reroot_t${i}((${T} *)c);
  ${S} *m = ((${T} *)c)->cur;
  int f; uint32_t j = lab__find_t${i}(m, k, &f);
  ${dropK("k")}
  if (!f) { lab_drop(c); lab_st = 1; return ${zero(t.value)}; }
  ${V} x = ${dupV("m->vs[j]")};
  lab_drop(c);
  return x;
}`);
    const lists = t.entries.map((d, j) => ({ d, j })).filter(({ j }) => arrayFns.has(`table.entries.t${i}.e${j}`));
    // compare's order: a tuple part by part.
    if (lists.length) out.push(`static ${S} *lab__sort_t${i};
${kinds.has("int") ? `static inline int lab__ci_t${i}(lab_int a, lab_int b) {
  if (LAB_IS_SMALL(a) && LAB_IS_SMALL(b)) return LAB_VAL(a) < LAB_VAL(b) ? -1 : LAB_VAL(a) > LAB_VAL(b);
  lab__mag p, q;
  lab__mag_of(a, &p); lab__mag_of(b, &q);
  if (p.neg != q.neg) return p.neg ? -1 : 1;
  return p.neg ? lab__cmp(q.d, q.n, p.d, p.n) : lab__cmp(p.d, p.n, q.d, q.n);
}` : ""}
${kinds.has("f64") ? `static inline int lab__cf_t${i}(double a, double b) { return a < b ? -1 : a > b; }` : ""}
${kinds.has("text") ? `static inline int lab__ct_t${i}(lab_cell *a, lab_cell *b) {
  uint32_t n = LAB_TN(a) < LAB_TN(b) ? LAB_TN(a) : LAB_TN(b);
  int r = memcmp(LAB_TB(a), LAB_TB(b), n);
  return r ? (r < 0 ? -1 : 1) : LAB_TN(a) < LAB_TN(b) ? -1 : LAB_TN(a) > LAB_TN(b);
}` : ""}
static int lab__cmp_t${i}(const void *x, const void *y) {
  ${K} a = lab__sort_t${i}->ks[*(const uint32_t *)x];
  ${K} b = lab__sort_t${i}->ks[*(const uint32_t *)y];
  int r = 0;
${parts("").map(([x, at]) => `  if ((r = lab__c${x[0]}_t${i}(a${at}, b${at}))) return r;`).join("\n")}
  return r;
}`);
    for (const { d, j } of lists) {
      const tag = d.cases.findIndex((c) => c.fields.length > 0), head = d.cases[tag].fields.findIndex((x) => x.t !== d);
      const cons = cname(d, tag), nil = cname(d, 1 - tag), item = d.cases[tag].fields[head].t;
      // A set's items are its keys; a map's entries, pairs.
      const same = (x: LType) => x === kt || (isRecord(x) && isRecord(kt) && x.key === kt.key);
      const made = t.set ? (same(item) ? dupK("t->ks[ix[j]]") : zero(item))
        : `(${ty(item)}){ ${same((item as RType).fields[0].t) ? dupK("t->ks[ix[j]]") : zero((item as RType).fields[0].t)}, ${dupV("t->vs[ix[j]]")} }`;
      // A key nothing ever fixed (an empty map nothing is put in) is held
      // as an Int, its entries' as another type: none are ever made.
      out.push(`// The entries as a list of ${t.set ? "items" : "pairs"}, in compare's order of their keys.
static lab_cell *lab_table_entries_t${i}_e${j}(lab_cell *c) {
  lab__reroot_t${i}((${T} *)c);
  ${S} *t = ((${T} *)c)->cur;
  uint32_t *ix = malloc((t->n ? t->n : 1) * sizeof(uint32_t)), n = 0;
  if (!ix) lab_oom();
  for (uint32_t j = 0; j < t->cap; j++) if (t->st[j] == 1) ix[n++] = j;
  lab__sort_t${i} = t;
  qsort(ix, n, sizeof(uint32_t), lab__cmp_t${i});
  lab_cell *acc = &${nil};
  for (uint32_t j = n; j-- > 0;) {
    ${cons} *e = lab_new(sizeof(${cons}), ${tnum.get(d.key)}, ${tag});
    e->f${head} = ${made};
    e->f${1 - head} = acc; acc = (lab_cell *)e;
  }
  free(ix);
  lab_drop(c);
  return acc;
}`);
    }
    return out;
  }
  // A map on threads (L101, scalar.ts `par:map`): its items and its
  // function, which only computes, given; the array of what it gives, or
  // nothing with lab_st set. The items are run from the last, as the
  // library's map runs them, on this thread till they have taken a
  // millisecond; the rest are then shared out (lab_pool_run), the function
  // and the items marked shared first. One that failed on another thread
  // (an abort, a stop, Int32 arithmetic that overflowed) is run again here
  // in its turn, as are the rest when nothing may be shared, so the map
  // fails as it would have in order: at the last item that fails.
  // A together on threads (C201, scalar.ts `par:together`): its list of
  // actions, each of nothing, which only compute; the list of what they
  // give, or nothing with lab_st set. As parC's items, but in the list's
  // order, as the evaluator runs them, and the together fails at the first
  // action that does. Its actions are few and each may be long, so they
  // are all shared out at once, unless the together took under a
  // millisecond the last time (lab_together_quick): then they run here
  // from the first till they have taken one.
  function togetherC(p: { n: number; ti: DType; to: DType }, stops: boolean, fuelled: boolean): string {
    const { n, ti, to } = p, J = `lab_together_job_${n}`;
    const shape = (d: DType) => { const tag = d.cases.findIndex((c) => c.fields.length > 0), head = d.cases[tag].fields.findIndex((x) => x.t !== d); return { cons: cname(d, tag), nil: cname(d, 1 - tag), type: tnum.get(d.key)!, tag, head, rest: 1 - head, t: d.cases[tag].fields[head].t }; };
    const i = shape(ti), o = shape(to), tf = i.t as FType, To = ty(o.t);
    const failed = `lab_st${fuelled ? " || lab_fuel != INFINITY" : ""}`;
    return `typedef struct { lab_cell **in; ${To} *out; char *bad; int64_t next, n; } ${J};
static void lab_together_one_${n}(${J} *j, int64_t k) {
  lab_cell *f = lab_dup(j->in[k]);
  j->out[k] = ((${fname.get(tf.key)})((lab_closure *)f)->code)(f);
}
static void lab_together_work_${n}(void *p) {
  ${J} *j = p;
  volatile int64_t k;${stops ? `
  jmp_buf here, *was = lab_stop_at;
  if (setjmp(here)) lab_st = 0;
  lab_stop_at = &here;` : ""}
  while ((k = __atomic_fetch_add(&j->next, 1, __ATOMIC_RELAXED)) < j->n) {
    lab_together_one_${n}(j, k);
    if (${failed}) { if (lab_st >= 2) { lab_drop(lab_reason); lab_reason = 0; } lab_st = 0;${fuelled ? " lab_fuel = INFINITY;" : ""} }
    else { j->bad[k] = 0; if (lab_on_pool) __atomic_fetch_add(&lab_par_items, 1, __ATOMIC_RELAXED); }
  }${stops ? `
  lab_stop_at = was;` : ""}
}
static int lab_together_quick_${n} = 0;
static lab_cell *lab_par_together_${n}(lab_cell *l) {
  int64_t n = 0, left = 0, k = 0;
  int quick = __atomic_load_n(&lab_together_quick_${n}, __ATOMIC_RELAXED);
  lab_cell *p;
  for (p = l; p->tag == ${i.tag}; p = ((${i.cons} *)p)->f${i.rest}) n++;
  ${J} j = { malloc((size_t)(n ? n : 1) * sizeof(lab_cell *)), malloc((size_t)(n ? n : 1) * sizeof(${To})), malloc((size_t)(n ? n : 1)), 0, n };
  struct timespec t0;
  if (!j.in || !j.out || !j.bad) lab_oom();
  for (p = l; p->tag == ${i.tag}; p = ((${i.cons} *)p)->f${i.rest}) j.in[k++] = lab_dup(((${i.cons} *)p)->f${i.head});
  lab_drop(l);
  memset(j.bad, 1, (size_t)n);
  clock_gettime(CLOCK_MONOTONIC, &t0);
  while (quick && left < n) {
    lab_together_one_${n}(&j, left);
    if (lab_st) { k = left; goto failed; }
    j.bad[left++] = 0;
    if (left < n && lab_par_worth(&t0)) break;
  }
  if (left < n${fuelled ? " && lab_fuel == INFINITY" : ""} && lab_pool_ready()) {
    lab_share_no = 0;
    for (k = left; k < n; k++) lab_share(j.in[k]);
    lab_shared();
    if (!lab_share_no) { j.next = left; lab_pool_run(lab_together_work_${n}, &j); }
  }
  for (k = left; k < n; k++) {
    if (!j.bad[k]) continue;
    lab_together_one_${n}(&j, k);
    if (lab_st) goto failed;
    j.bad[k] = 0;
  }
  __atomic_store_n(&lab_together_quick_${n}, !lab_par_worth(&t0), __ATOMIC_RELAXED);
  lab_cell *r = (lab_cell *)&${o.nil};
  for (k = n; k-- > 0;) { ${o.cons} *c = lab_new(sizeof(${o.cons}), ${o.type}, ${o.tag}); c->f${o.head} = j.out[k]; c->f${o.rest} = r; r = (lab_cell *)c; }
  for (k = 0; k < n; k++) lab_drop(j.in[k]);
  free(j.in); free(j.out); free(j.bad);
  return r;
failed:
  ${counted(o.t) ? `for (int64_t m = 0; m < n; m++) if (m != k && !j.bad[m]) ${drop(o.t, "j.out[m]")}\n  ` : ""}for (int64_t m = 0; m < n; m++) lab_drop(j.in[m]);
  free(j.in); free(j.out); free(j.bad);
  return 0;
}`;
  }

  // A keep on threads (C202, scalar.ts `par:keep`) likewise, its tests'
  // answers kept, then the items that passed, in order, in an array. The
  // library's keep tests its items from the first, so they are held last
  // first: run from the back of that, the keep fails at the first item
  // that fails, as in order.
  // all pass and any pass (C202b) likewise from the first item, the
  // answer the first test that decides (fails for all, passes for any),
  // or one that fails before it the failure.
  // The split a thread's search takes the item of at its first choice (-1:
  // all of them), and how many that choice had, then each list type's
  // split: the list of that one item, or none past the last.
  function splitC(TL: string): string {
    return [`static ${TL}int64_t lab_split = -1, lab_seen = -1;
static double lab_split_hold(void) { double j = (double)lab_split; lab_split = -1; return j; }
static double lab_split_give(double j) { lab_split = (int64_t)j; return 0; }`, ...[...splitLists.values()].map(({ n, t }) => {
      const c = t.cases.findIndex((x) => x.fields.length > 0), nil = `(&${cname(t, 1 - c)})`, C = cname(t, c);
      const ri = t.cases[c].fields.findIndex((x) => x.t === t), hi = 1 - ri, h = t.cases[c].fields[hi].t;
      return `static lab_cell *lab_split_${n}(lab_cell *l) {
  if (lab_split < 0) return l;
  int64_t j = lab_split, m = 0;
  lab_cell *got = ${nil}, *p;
  lab_split = -1;
  for (p = l; p->tag == ${c}; p = ((${C} *)p)->f${ri}) if (m++ == j) { got = lab_new(sizeof(${C}), ${tnum.get(t.key)}, ${c}); ((${C} *)got)->f${hi} = ${dup(h, `((${C} *)p)->f${hi}`)}; ((${C} *)got)->f${ri} = ${nil}; }
  lab_seen = m;
  lab_drop(l);
  return got;
}`;
    })].join("\n");
  }
  // A count of a search split by its first choice (C203), as compiled
  // JavaScript's (branches-rt.ts searchPure): the run keeping the first
  // item here, which says how many there are, then, when that took a
  // millisecond, the others on the threads, each count added. An abort is
  // the first in order's, as each run that failed runs again here in turn.
  function countC(p: { n: number; tf: FType; how: SearchHow }, stops: boolean, fuelled: boolean): string {
    if (p.how === "first") return firstSearchC(p, stops, fuelled);
    const { n, tf, how } = p, J = `lab_par_cjob_${n}`, call = (f: string) => `((${fname.get(tf.key)})((lab_closure *)${f})->code)(${f})`;
    const t = tf.result, T = ty(t), drop1 = (x: string) => drop(t, x);
    // An all's lists joined in order: each list's cells copied onto the
    // ones after it, from the last.
    let join = "", joined = "";
    if (how === "all") {
      const d = t as DType, c = d.cases.findIndex((x) => x.fields.length > 0), C = cname(d, c);
      const ri = d.cases[c].fields.findIndex((x) => x.t === d), hi = 1 - ri, h = d.cases[c].fields[hi].t;
      join = `static lab_cell *lab_par_join_${n}(lab_cell *a, lab_cell *b) {
  lab_cell *r = b, *last = 0, *p;
  for (p = a; p->tag == ${c}; p = ((${C} *)p)->f${ri}) {
    lab_cell *x = lab_new(sizeof(${C}), ${tnum.get(d.key)}, ${c});
    ((${C} *)x)->f${hi} = ${dup(h, `((${C} *)p)->f${hi}`)}; ((${C} *)x)->f${ri} = b;
    if (last) ((${C} *)last)->f${ri} = x; else r = x;
    last = x;
  }
  lab_drop(a);
  return r;
}
`;
      joined = `  for (k = n - 1; k-- > 0;) j.out[n - 1] = lab_par_join_${n}(j.out[k], j.out[n - 1]);
  r = lab_par_join_${n}(r, j.out[n - 1]);`;
    } else joined = "  for (k = 0; k < n; k++) r = lab_int_add(r, j.out[k]);";
    return `${join}typedef struct { lab_cell *f; ${T} *out; char *bad; int64_t next; } ${J};
static void lab_par_cone_${n}(${J} *j, int64_t k) {
  lab_cell *f = lab_dup(j->f);
  lab_split = k + 1; lab_seen = -1;
  j->out[k] = ${call("f")};
  lab_split = -1;
}
static void lab_par_cwork_${n}(void *p) {
  ${J} *j = p;
  volatile int64_t k;${stops ? `
  jmp_buf here, *was = lab_stop_at;
  if (setjmp(here)) lab_st = 0;
  lab_stop_at = &here;` : ""}
  while ((k = __atomic_sub_fetch(&j->next, 1, __ATOMIC_RELAXED)) >= 0) {
    lab_par_cone_${n}(j, k);
    if (lab_st${fuelled ? " || lab_fuel != INFINITY" : ""}) { if (lab_st >= 2) { lab_drop(lab_reason); lab_reason = 0; } lab_st = 0;${fuelled ? " lab_fuel = INFINITY;" : ""} }
    else { j->bad[k] = 0; if (lab_on_pool) __atomic_fetch_add(&lab_par_items, 1, __ATOMIC_RELAXED); }
  }
  lab_split = -1;${stops ? `
  lab_stop_at = was;` : ""}
}
static ${T} lab_par_search_${n}(lab_cell *f) {
  int64_t was = lab_split, outer = lab_seen, n, k;
  struct timespec t0;
  lab_cell *g = lab_dup(f);
  ${T} r;
  clock_gettime(CLOCK_MONOTONIC, &t0);
  lab_split = 0; lab_seen = -1;
  r = ${call("g")};
  n = lab_seen - 1; lab_split = was; lab_seen = outer;
  if (lab_st) { lab_drop(f); return 0; }
  if (n <= 0) { lab_drop(f); return r; }
  ${J} j = { f, malloc((size_t)n * sizeof(${T})), malloc((size_t)n), 0 };
  if (!j.out || !j.bad) lab_oom();
  memset(j.bad, 1, (size_t)n);
  if (lab_par_worth(&t0)${fuelled ? " && lab_fuel == INFINITY" : ""} && lab_pool_ready()) {
    lab_share_no = 0;
    lab_share(f);
    lab_shared();
    if (!lab_share_no) { j.next = n; lab_pool_run(lab_par_cwork_${n}, &j); }
  }
  for (k = 0; k < n; k++) {
    if (!j.bad[k]) continue;
    lab_par_cone_${n}(&j, k);
    if (lab_st) goto failed;
    j.bad[k] = 0;
  }
${joined}
  free(j.out); free(j.bad);
  lab_drop(f);
  return r;
failed:
  ${drop1("r")}
  for (int64_t m = 0; m < n; m++) if (m != k && !j.bad[m]) ${drop1("j.out[m]")}
  free(j.out); free(j.bad);
  lab_drop(f);
  return 0;
}`;
  }
  // A first of a search split by its first choice (C203c), as compiled
  // JavaScript's (branches-rt.ts searchPure with first): the run keeping
  // the first item here, then the others from the front on the threads, a
  // thread taking none past the first with an answer (stop). Here, in
  // order, the first run with an answer is the answer, one that aborted or
  // wasn't run running again here first; none with an answer fails (1),
  // for the default. bad: 1 not run or aborted, 2 no answer, 0 answered.
  function firstSearchC(p: { n: number; tf: FType }, stops: boolean, fuelled: boolean): string {
    const { n, tf } = p, J = `lab_par_fjob_${n}`, call = (f: string) => `((${fname.get(tf.key)})((lab_closure *)${f})->code)(${f})`;
    const t = tf.result, T = ty(t);
    const free = `${counted(t) ? `for (int64_t m = 0; m < n; m++) if (m != k && !j.bad[m]) ${drop(t, "j.out[m]")}
  ` : ""}free(j.out); free(j.bad);
  lab_drop(f);`;
    return `typedef struct { lab_cell *f; ${T} *out; char *bad; int64_t next, stop, n; } ${J};
static void lab_par_fone_${n}(${J} *j, int64_t k) {
  lab_cell *f = lab_dup(j->f);
  lab_split = k + 1; lab_seen = -1;
  j->out[k] = ${call("f")};
  lab_split = -1;
}
static void lab_par_fwork_${n}(void *p) {
  ${J} *j = p;
  volatile int64_t k;${stops ? `
  jmp_buf here, *was = lab_stop_at;
  if (setjmp(here)) lab_st = 0;
  lab_stop_at = &here;` : ""}
  while ((k = __atomic_fetch_add(&j->next, 1, __ATOMIC_RELAXED)) < j->n) {
    if (k > __atomic_load_n(&j->stop, __ATOMIC_RELAXED)) break;
    lab_par_fone_${n}(j, k);
    if (lab_st >= 2${fuelled ? " || lab_fuel != INFINITY" : ""}) { if (lab_st >= 2) { lab_drop(lab_reason); lab_reason = 0; } lab_st = 0;${fuelled ? " lab_fuel = INFINITY;" : ""} }
    else if (lab_st) { lab_st = 0; j->bad[k] = 2; if (lab_on_pool) __atomic_fetch_add(&lab_par_items, 1, __ATOMIC_RELAXED); }
    else {
      int64_t s = __atomic_load_n(&j->stop, __ATOMIC_RELAXED);
      j->bad[k] = 0; if (lab_on_pool) __atomic_fetch_add(&lab_par_items, 1, __ATOMIC_RELAXED);
      while (s > k && !__atomic_compare_exchange_n(&j->stop, &s, k, 0, __ATOMIC_RELAXED, __ATOMIC_RELAXED));
    }
  }
  lab_split = -1;${stops ? `
  lab_stop_at = was;` : ""}
}
static ${T} lab_par_search_${n}(lab_cell *f) {
  int64_t was = lab_split, outer = lab_seen, n, k;
  struct timespec t0;
  lab_cell *g = lab_dup(f);
  ${T} r;
  clock_gettime(CLOCK_MONOTONIC, &t0);
  lab_split = 0; lab_seen = -1;
  r = ${call("g")};
  n = lab_seen - 1; lab_split = was; lab_seen = outer;
  if (lab_st != 1 || n <= 0) { lab_drop(f); return r; }
  lab_st = 0;
  ${J} j = { f, malloc((size_t)n * sizeof(${T})), malloc((size_t)n), 0, n, n };
  if (!j.out || !j.bad) lab_oom();
  memset(j.bad, 1, (size_t)n);
  if (lab_par_worth(&t0)${fuelled ? " && lab_fuel == INFINITY" : ""} && lab_pool_ready()) {
    lab_share_no = 0;
    lab_share(f);
    lab_shared();
    if (!lab_share_no) lab_pool_run(lab_par_fwork_${n}, &j);
  }
  for (k = 0; k < n; k++) {
    if (j.bad[k] == 2) continue;
    if (j.bad[k] == 1) {
      lab_par_fone_${n}(&j, k);
      if (lab_st == 1) { lab_st = 0; j.bad[k] = 2; continue; }
      if (lab_st) goto failed;
      j.bad[k] = 0;
    }
    r = j.out[k];
    ${free}
    return r;
  }
  k = -1;
  ${free}
  lab_st = 1;
  return 0;
failed:
  ${free}
  return 0;
}`;
  }
  function parC(p: { n: number; ta: AType; tf: FType; to: AType; job: "map" | "keep" | "all" | "any" | "first" | "add" | "max" | "min" }, stops: boolean, fuelled: boolean): string {
    const { n, ta, tf, to, job } = p, keep = job !== "map", fold = folds(job), tests = job === "all" || job === "any" || job === "first", J = `lab_par_job_${n}`, Ti = ty(ta.item), out = keep ? tf.result : to.item, To = ty(out);
    const decides = (x: string) => (job === "all" ? `!${x}` : x);
    const vi = aname.get(ta.key)!, vo = aname.get(to.key)!;
    const rd = ta.item === "int" ? `lab__rd_a${ta.index}(b, v->s + (uint32_t)k)` : `b->it[v->s + (uint32_t)k]`;
    const failed = `lab_st${fuelled ? " || lab_fuel != INFINITY" : ""}`;
    // A test that decides (C202c) says so in stop, the highest such slot,
    // the first in order: a thread past it takes no more items.
    return `typedef struct { lab_cell *f; ${Ti} *in; ${To} *out; char *bad; int64_t next${tests ? ", stop" : ""}; } ${J};
static void lab_par_one_${n}(${J} *j, int64_t k) {
  lab_cell *f = lab_dup(j->f);
  j->out[k] = ((${fname.get(tf.key)})((lab_closure *)f)->code)(f, ${dup(ta.item, "j->in[k]")});
}
static void lab_par_work_${n}(void *p) {
  ${J} *j = p;
  volatile int64_t k;${stops ? `
  jmp_buf here, *was = lab_stop_at;
  if (setjmp(here)) lab_st = 0;
  lab_stop_at = &here;` : ""}
  while ((k = __atomic_sub_fetch(&j->next, 1, __ATOMIC_RELAXED)) >= 0) {${tests ? `
    if (k < __atomic_load_n(&j->stop, __ATOMIC_RELAXED)) break;` : ""}
    lab_par_one_${n}(j, k);
    if (${failed}) { if (lab_st >= 2) { lab_drop(lab_reason); lab_reason = 0; } lab_st = 0;${fuelled ? " lab_fuel = INFINITY;" : ""} }
    else {
      j->bad[k] = 0; if (lab_on_pool) __atomic_fetch_add(&lab_par_items, 1, __ATOMIC_RELAXED);${tests ? `
      if (${decides("j->out[k]")}) { int64_t s = __atomic_load_n(&j->stop, __ATOMIC_RELAXED); while (s < k && !__atomic_compare_exchange_n(&j->stop, &s, k, 0, __ATOMIC_RELAXED, __ATOMIC_RELAXED)); }` : ""}
    }
  }${stops ? `
  lab_stop_at = was;` : ""}
}
static ${(tests && job !== "first") || fold ? `${ty(tf.result)} ` : "lab_cell *"}lab_par_map_${n}(lab_cell *xs, lab_cell *f${fold ? ", lab_int z" : ""}) {
  ${vi.view} *v = (${vi.view} *)xs;
  ${vi.buf} *b = (${vi.buf} *)v->b;
  int64_t n = v->n, left = n, k;
  ${J} j = { f, malloc((size_t)(n ? n : 1) * sizeof(${Ti})), malloc((size_t)(n ? n : 1) * sizeof(${To})), malloc((size_t)(n ? n : 1)), 0${tests ? ", -1" : ""} };
  struct timespec t0;
  if (!j.in || !j.out || !j.bad) lab_oom();
  for (k = 0; k < n; k++) j.in[${keep && !fold ? "n - 1 - k" : "k"}] = ${dup(ta.item, rd)};
  lab_drop(xs);
  memset(j.bad, 1, (size_t)n);
  clock_gettime(CLOCK_MONOTONIC, &t0);
  while (left > 0) {
    lab_par_one_${n}(&j, left - 1);
    if (lab_st) { k = left - 1; goto failed; }
    j.bad[--left] = 0;${tests ? `
    if (${decides("j.out[left]")}) { k = left; goto found; }` : ""}
    if (left > 0 && lab_par_worth(&t0)) break;
  }
  if (left > 0${fuelled ? " && lab_fuel == INFINITY" : ""} && lab_pool_ready()) {
    lab_share_no = 0;
    lab_share(f);
    for (k = 0; k < left; k++) ${share(ta.item, "j.in[k]")}
    lab_shared();
    if (!lab_share_no) { j.next = left; lab_pool_run(lab_par_work_${n}, &j); }
  }
${tests ? `  for (k = left - 1; k >= 0; k--) {
    if (j.bad[k]) {
      lab_par_one_${n}(&j, k);
      if (lab_st) goto failed;
      j.bad[k] = 0;
    }
    if (${decides("j.out[k]")}) goto found;
  }
found:${job === "first" ? `
  ${vo.buf} *r = lab__buf_a${to.index}(k >= 0 ? 1 : 0, 0);
  if (k >= 0) r->it[r->lo] = ${dup(ta.item, "j.in[k]")};` : ""}
  ${counted(ta.item) ? `for (int64_t m = 0; m < n; m++) ${drop(ta.item, "j.in[m]")}\n  ` : ""}free(j.in); free(j.out); free(j.bad);
  lab_drop(f);
  return ${job === "first" ? `lab__view_a${to.index}((lab_cell *)r, r->lo, k >= 0 ? 1 : 0)` : job === "all" ? "k < 0" : "k >= 0"};` : `  for (k = left - 1; k >= 0; k--) {
    if (!j.bad[k]) continue;
    lab_par_one_${n}(&j, k);
    if (lab_st) goto failed;
    j.bad[k] = 0;
  }
${fold ? `  for (k = n; k-- > 0;) z = ${job === "add" ? "lab_int_add(z, j.out[k])" : `lab_int_less(lab_int_dup(${job === "max" ? "z" : "j.out[k]"}), lab_int_dup(${job === "max" ? "j.out[k]" : "z"})) ? (lab_int_drop(z), j.out[k]) : (lab_int_drop(j.out[k]), z)`};
  ${counted(ta.item) ? `for (k = 0; k < n; k++) ${drop(ta.item, "j.in[k]")}\n  ` : ""}free(j.in); free(j.out); free(j.bad);
  lab_drop(f);
  return z;` : `${keep ? `  int64_t m = 0;
  for (k = 0; k < n; k++) if (j.out[k]) m++;
  ${vo.buf} *r = lab__buf_a${to.index}((uint32_t)m, 0);
  m = 0;
  for (k = n; k-- > 0;) if (j.out[k]) { r->it[r->lo + (uint32_t)m] = ${dup(ta.item, "j.in[k]")}; m++; }` : `  ${vo.buf} *r = lab__buf_a${to.index}((uint32_t)n, 0);
  for (k = 0; k < n; k++) r->it[r->lo + (uint32_t)k] = j.out[k];`}
  ${counted(ta.item) ? `for (k = 0; k < n; k++) ${drop(ta.item, "j.in[k]")}\n  ` : ""}free(j.in); free(j.out); free(j.bad);
  lab_drop(f);
  return lab__view_a${to.index}((lab_cell *)r, r->lo, (uint32_t)${keep ? "m" : "n"});`}`}
failed:${fold ? `
  lab_int_drop(z);` : ""}
  ${counted(out) ? `for (int64_t m = 0; m < n; m++) if (m != k && !j.bad[m]) ${drop(out, "j.out[m]")}\n  ` : ""}${counted(ta.item) ? `for (int64_t m = 0; m < n; m++) ${drop(ta.item, "j.in[m]")}\n  ` : ""}free(j.in); free(j.out); free(j.bad);
  lab_drop(f);
  return 0;
}`;
  }

  function arrayC(a: AType): string[] {
    const fns = [...arrayFns].filter((f) => ARRAY_FN.test(f) && Number(ARRAY_FN.exec(f)![2]) === a.index);
    if (!fns.length) return [];
    const { view: V, buf: B } = aname.get(a.key)!, T = ty(a.item), i = a.index;
    const tv = tnum.get(`array ${a.key}`), tb = tnum.get(`buf ${a.key}`);
    const cp = (x: string) => (counted(a.item) ? dup(a.item, x) : x);
    const l = a.list && (() => { const d = a.list!, tag = d.cases.findIndex((c) => c.fields.length > 0); return { cons: cname(d, tag), nil: cname(d, 1 - tag), type: tnum.get(d.key)!, tag, head: d.cases[tag].fields.findIndex((x) => x.t !== d) }; })();
    // Ints a byte a slot (L189f2): 16 or more Ints all 0 to 255 are kept as
    // bytes, and a buffer of them is copied wide when an Int that isn't a
    // byte goes in. Read (rd) and written (wr) through these; other arrays
    // as plain slots.
    const bytes = a.item === "int";
    const rd = (b: string, k: string) => (bytes ? `lab__rd_a${i}(${b}, ${k})` : `${b}->it[${k}]`);
    const wr = (b: string, k: string, x: string) => (bytes ? `lab__wr_a${i}(${b}, ${k}, ${x});` : `${b}->it[${k}] = ${x};`);
    // In place only where x fits the buffer.
    const fits = (b: string, x: string) => (bytes ? ` && (!${b}->bytes || LAB_IS_BYTE(${x}))` : "");
    const out = [`// Array ${i}: of ${T}.
static lab_cell *lab__view_a${i}(lab_cell *b, uint32_t s, uint32_t n) { ${V} *v = lab_new(sizeof(${V}), ${tv}, 0); v->b = b; v->s = s; v->n = n; return (lab_cell *)v; }${bytes ? `
#define LAB_IS_BYTE(x) (LAB_IS_SMALL(x) && LAB_VAL(x) >= 0 && LAB_VAL(x) <= 255)
static inline lab_int lab__rd_a${i}(${B} *b, uint32_t k) { return b->bytes ? LAB_SMALL(((uint8_t *)b->it)[k]) : b->it[k]; }
static inline void lab__wr_a${i}(${B} *b, uint32_t k, lab_int x) { if (b->bytes) ((uint8_t *)b->it)[k] = (uint8_t)LAB_VAL(x); else b->it[k] = x; }` : ""}
// A buffer of n slots in its middle, with room for as many again on each
// side${bytes ? ", a byte each when `small`" : ""}.
static ${B} *lab__buf_a${i}(uint32_t n, int small) {
  uint32_t room = n > 4 ? n : 4;
  if ((uint64_t)n + 2 * (uint64_t)room > UINT32_MAX) lab_oom();
  ${B} *b = lab_new(sizeof(${B}) + ((size_t)n + 2 * (size_t)room) * (small ? 1 : sizeof(${T})), ${tb}, 0);
  b->lo = room; b->hi = room + n; b->cap = n + 2 * room;${bytes ? "\n  b->bytes = (uint8_t)small;" : "\n  (void)small;"}
  return b;
}
// A copy of n items of buffer src from s (bytes still if \`small\`).
static lab_cell *lab__copy_a${i}(${B} *src, uint32_t s, uint32_t n, int small) {
  ${B} *b = lab__buf_a${i}(n, small);
  for (uint32_t k = 0; k < n; k++) ${wr("b", "b->lo + k", cp(rd("src", "s + k")))}
  return lab__view_a${i}((lab_cell *)b, b->lo, n);
}`];
    const has = (op: string) => arrayFns.has(`array.${op}.a${i}`);
    const keep = (b: string) => (bytes ? `${b}->bytes` : "0");
    if (has("empty")) out.push(`static lab_cell *lab_array_empty_a${i}(void) { return lab__view_a${i}((lab_cell *)lab__buf_a${i}(0, 0), 4, 0); }`);
    if (has("of")) out.push(`static lab_cell *lab_array_of_a${i}(lab_cell *l) {
  uint32_t n = 0;
  int small = 1;
  for (lab_cell *p = l; p->tag == ${l!.tag}; p = ((${l!.cons} *)p)->f${1 - l!.head}) { n++;${bytes ? ` if (!LAB_IS_BYTE(((${l!.cons} *)p)->f${l!.head})) small = 0;` : ""} }
  ${B} *b = lab__buf_a${i}(n, ${bytes ? "small && n >= 16" : "0"});
  (void)small;
  uint32_t k = b->lo;
  for (lab_cell *p = l; p->tag == ${l!.tag}; p = ((${l!.cons} *)p)->f${1 - l!.head}) { ${wr("b", "k", cp(`((${l!.cons} *)p)->f${l!.head}`))} k++; }
  lab_cell *a = lab__view_a${i}((lab_cell *)b, b->lo, n);
  lab_drop(l);
  return a;
}`);
    if (has("items")) out.push(`static lab_cell *lab_array_items_a${i}(lab_cell *a) {
  ${V} *v = (${V} *)a;
  ${B} *b = (${B} *)v->b;
  lab_cell *acc = &${l!.nil};
  for (uint32_t k = v->n; k-- > 0;) { ${l!.cons} *c = lab_new(sizeof(${l!.cons}), ${l!.type}, ${l!.tag}); c->f${l!.head} = ${cp(rd("b", "v->s + k"))}; c->f${1 - l!.head} = acc; acc = (lab_cell *)c; }
  lab_drop(a);
  return acc;
}`);
    // The item at k replaced (C93c): in place when nobody else holds the
    // view or its buffer (Perceus's reuse), else in a copy; the array as it
    // is outside it.
    const dropX = (x: string) => (counted(a.item) ? drop(a.item, x) : "");
    if (has("replaceAt")) out.push(`static lab_cell *lab_array_replaceAt_a${i}(lab_cell *a, lab_int k, ${T} x) {
  ${V} *v = (${V} *)a;
  if (!LAB_IS_SMALL(k) || LAB_VAL(k) < 0 || LAB_VAL(k) >= (int64_t)v->n) { lab_int_drop(k); ${dropX("x")} return a; }
  uint32_t at = (uint32_t)LAB_VAL(k);
  ${B} *b = (${B} *)v->b;
  if (a->rc == 1 && v->b->rc == 1${fits("b", "x")}) { ${T} old = ${rd("b", "v->s + at")}; ${wr("b", "v->s + at", "x")} ${dropX("old")} (void)old; return a; }
  lab_cell *r = lab__copy_a${i}(b, v->s, v->n, ${bytes ? "b->bytes && LAB_IS_BYTE(x)" : "0"});
  ${V} *w = (${V} *)r;
  ${B} *c = (${B} *)w->b;
  ${T} old = ${rd("c", "w->s + at")};
  ${wr("c", "w->s + at", "x")}
  ${dropX("old")} (void)old;
  lab_drop(a);
  return r;
}`);
    if (has("length")) out.push(`static lab_int lab_array_length_a${i}(lab_cell *a) { lab_int n = LAB_SMALL(((${V} *)a)->n); lab_drop(a); return n; }`);
    // No answer past the end.
    if (has("at")) out.push(`static ${T} lab_array_at_a${i}(lab_cell *a, lab_int k) {
  ${V} *v = (${V} *)a;
  if (!LAB_IS_SMALL(k) || LAB_VAL(k) < 0 || LAB_VAL(k) >= (int64_t)v->n) { lab_int_drop(k); lab_drop(a); lab_st = 1; return ${zero(a.item)}; }
  ${T} x = ${cp(rd(`((${B} *)v->b)`, "v->s + LAB_VAL(k)"))};
  lab_drop(a);
  return x;
}`);
    // Item k where k is known to be in the array (equal and compare's loop).
    if (has("get")) out.push(`static ${T} lab_array_get_a${i}(lab_cell *a, lab_int k) {
  ${T} x = ${cp(rd(`((${B} *)((${V} *)a)->b)`, `((${V} *)a)->s + LAB_VAL(k)`))};
  lab_drop(a);
  return x;
}`);
    // The first item; none when empty (C30d).
    if (has("first")) out.push(`static ${T} lab_array_first_a${i}(lab_cell *a) {
  ${V} *v = (${V} *)a;
  if (v->n == 0) { lab_drop(a); lab_st = 1; return ${zero(a.item)}; }
  ${T} x = ${cp(rd(`((${B} *)v->b)`, "v->s"))};
  lab_drop(a);
  return x;
}`);
    // The items after the first, on the same buffer; the view itself
    // moves on when nobody else holds it.
    if (has("rest")) out.push(`static lab_cell *lab_array_rest_a${i}(lab_cell *a) {
  ${V} *v = (${V} *)a;
  if (v->n == 0) return a;
  if (a->rc == 1) { v->s++; v->n--; return a; }
  lab_cell *r = lab__view_a${i}(lab_dup(v->b), v->s + 1, v->n - 1);
  lab_drop(a);
  return r;
}`);
    // push at the front: into the free slot before the start when no other
    // view has taken it, else a copy with room on both sides.
    if (has("pushFront")) out.push(`static lab_cell *lab_array_pushFront_a${i}(lab_cell *a, ${T} x) {
  ${V} *v = (${V} *)a;
  ${B} *b = (${B} *)v->b;
  lab_cell *r;
  if (v->s == b->lo && v->s > 0${fits("b", "x")}) {
    --b->lo; ${wr("b", "b->lo", "x")}
    if (a->rc == 1) { v->s--; v->n++; return a; }
    r = lab__view_a${i}(lab_dup(v->b), v->s - 1, v->n + 1);
  } else {
    r = lab__copy_a${i}(b, v->s, v->n, ${bytes ? "b->bytes && LAB_IS_BYTE(x)" : "0"});
    ${V} *w = (${V} *)r;
    ${B} *c = (${B} *)w->b;
    --c->lo; ${wr("c", "c->lo", "x")} w->s--; w->n++;
  }
  lab_drop(a);
  return r;
}`);
    if (has("push")) out.push(`static lab_cell *lab_array_push_a${i}(lab_cell *a, ${T} x) {
  ${V} *v = (${V} *)a;
  ${B} *b = (${B} *)v->b;
  uint32_t end = v->s + v->n;
  lab_cell *r;
  if (end == b->hi && end < b->cap${fits("b", "x")}) {
    ${wr("b", "end", "x")} b->hi++;
    if (a->rc == 1) { v->n++; return a; }
    r = lab__view_a${i}(lab_dup(v->b), v->s, v->n + 1);
  } else {
    r = lab__copy_a${i}(b, v->s, v->n, ${bytes ? "b->bytes && LAB_IS_BYTE(x)" : "0"});
    ${V} *w = (${V} *)r;
    ${B} *c = (${B} *)w->b;
    ${wr("c", "c->hi", "x")} c->hi++; w->n++;
  }
  lab_drop(a);
  return r;
}`);
    void keep;
    return out;
  }

  function harness(): string {
    if (ints) rts.add("int.read");
    // A reader and a printer for each type an input or an answer has.
    const io: string[] = [];
    const done = new Set<string>();
    const rd = (t: LType): string => {
      if (t === "f64") return "lab_in()";
      if (t === "i32") return "(int32_t)lab_bits()";
      if (t === "int32") return "lab_i32()";
      if (t === "i64") return "(int64_t)lab_bits()";
      if (t === "int") return "lab_int_read(lab_word())";
      if (t === "text") return "lab_hex()";
      const key = (t as RType | DType).key;
      if (!done.has(key)) {
        done.add(key);
        if (isRecord(t)) {
          const n = sname.get(t.key)!;
          io.push(`static ${n} lab_read_${n}(void) { ${n} r = ${zero(t)}; ${t.fields.map((x, j) => `r.f${j} = ${rd(x.t)};`).join(" ")} return r; }`,
            `static void lab_print_${n}(${n} r) { ${t.fields.map((x, j) => `${pr(x.t, `r.f${j}`)}`).join(" ")} }`);
        } else {
          const d = t as DType, n = dname.get(d.key)!;
          // Along the last field while it is the same type, with a loop.
          const self = (j: number) => d.cases[j].fields.length > 0 && d.cases[j].fields.at(-1)!.t === d;
          const reads = d.cases.map((c, j) => {
            if (!c.fields.length) return `case ${j}: *at = &${cname(d, j)}; return top;`;
            const fs = c.fields.map((x, k) => (self(j) && k === c.fields.length - 1 ? "" : `((${cname(d, j)} *)v)->f${k} = ${rd(x.t)};`)).join(" ");
            return `case ${j}: { lab_cell *v = lab_new(sizeof(${cname(d, j)}), ${tnum.get(d.key)}, ${j}); ${fs} *at = v; ${self(j) ? `at = &((${cname(d, j)} *)v)->f${c.fields.length - 1}; break;` : "return top;"} }`;
          });
          const prints = d.cases.map((c, j) => `case ${j}: ${c.fields.map((x, k) => (self(j) && k === c.fields.length - 1 ? "" : pr(x.t, `((${cname(d, j)} *)c)->f${k}`))).join(" ")} ${self(j) ? `c = ((${cname(d, j)} *)c)->f${c.fields.length - 1}; break;` : "return;"}`);
          io.push(`static lab_cell *lab_read_${n}(void) { lab_cell *top = 0, **at = &top; for (;;) switch ((int)lab_bits()) { ${reads.join(" ")} default: exit(4); } }`,
            `static void lab_print_${n}(lab_cell *c) { for (;;) { printf(" %d", (int)c->tag); switch (c->tag) { ${prints.join(" ")} } } }`);
        }
      }
      return `lab_read_${isRecord(t) ? sname.get(t.key) : dname.get(key)}()`;
    };
    function pr(t: LType, v: string): string {
      if (t === "f64") return `lab_out(${v});`;
      if (t === "i32" || t === "int32") return `printf(" %d", (int)${v});`;
      if (t === "i64") return `printf(" %llu", (unsigned long long)${v});`;
      if (t === "int") return `{ size_t n; char *s = lab__show(${v}, &n); printf(" %s", s); free(s); }`;
      if (t === "text") return `{ printf(" x"); for (uint32_t k = 0; k < LAB_TN(${v}); k++) printf("%02x", LAB_TB(${v})[k]); }`;
      rd(t);
      return `lab_print_${isRecord(t) ? sname.get((t as RType).key) : dname.get((t as DType).key)}(${v});`;
    }
    const plain = (t: LType, seen = new Set<string>()): boolean => t === "f64" || t === "i32" || t === "int32" || t === "i64" || t === "int" || t === "text" || (typeof t === "object" && seen.has(t.key))
      || (isRecord(t) && !t.mutable && (seen.add(t.key), t.fields.every((x) => plain(x.t, seen))))
      || (isData(t) && (seen.add(t.key), t.cases.every((c) => c.fields.every((x) => plain(x.t, seen)))));
    const cases = kept.map((i) => {
      const f = funcs[i];
      if (f.inner || !plain(f.result) || !f.params.every((t) => plain(t))) return "";
      // Read in order: C doesn't say in which order a call's arguments run.
      const ins = f.params.map((t, j) => `${ty(t)} a${j} = ${rd(t)};`);
      const after = counted(f.result) ? drop(f.result, "r") : "";
      // An answer given back to the host is a boundary: an overflow in it
      // stops there (L125c2), before any of it is printed.
      const res = f.result, overflowed = res === "f64" ? ["r"] : isRecord(res) ? res.fields.flatMap((x, j) => (x.t === "f64" ? [`r.f${j}`] : [])) : [];
      const check = overflowed.length ? `if (${overflowed.map((v) => `${v} - ${v} != 0`).join(" || ")}) lab_stop(${STOPS.length - 1}); ` : "";
      const show = f.partial
        ? `if (lab_st == 1) { printf(" ?"); lab_st = 0; } else if (lab_st) { printf(" !"); if (lab_st == 2) { ${pr("text", "lab_reason")} } lab_drop(lab_reason); lab_reason = 0; lab_st = 0; } else { ${check}${pr(f.result, "r")} ${after} }`
        : `${check}${pr(f.result, "r")} ${after}`;
      return `    case ${i}: { ${ins.join(" ")} ${ty(f.result)} r = ${names.get(i)}(${f.params.map((_, j) => `a${j}`).join(", ")}); ${show} break; }`;
    }).filter(Boolean);
    // Prototypes first: a reader may use one made after it.
    const protos = io.map((x) => `${x.slice(0, x.indexOf("{")).trim()};`);
    return `#include <string.h>
static uint64_t lab_bits(void) { unsigned long long u = 0; if (scanf("%llx", &u) != 1) return 0; return u; }
static double lab_in(void) { uint64_t u = lab_bits(); double d; memcpy(&d, &u, 8); return d; }
static int32_t lab_i32(void) { int v = 0; if (scanf("%d", &v) != 1) return 0; return (int32_t)v; }
static void lab_out(double d) { uint64_t u; memcpy(&u, &d, 8); printf(" %016llx", (unsigned long long)u); }
${ints ? `// A word, and a Text as x then its bytes in hex.
static int lab_hexd(int c) { return c <= '9' ? c - '0' : (c | 32) - 'a' + 10; }
static lab_cell *lab_token(int hex) {
  int c;
  while ((c = getchar()) == ' ' || c == '\\n');
  size_t n = 0, cap = 16;
  char *s = malloc(cap);
  for (;;) {
    int a = hex ? getchar() : c;
    if (a == EOF || a == ' ' || a == '\\n') { if (a == '\\n') ungetc(a, stdin); break; }
    if (n == cap) { s = realloc(s, cap *= 2); if (!s) lab_oom(); }
    s[n++] = (char)(hex ? lab_hexd(a) << 4 | lab_hexd(getchar()) : a);
    if (!hex) c = getchar();
  }
  lab_cell *t = lab__text_of(s, n);
  free(s);
  return t;
}
static lab_cell *lab_word(void) { return lab_token(0); }
static lab_cell *lab_hex(void) { return lab_token(1); }` : ""}
${[...protos, ...io].join("\n")}
int main(void) {
  int i;
  // A stop (L125c2) is that call's answer: "!" and its reason, as an
  // abort's; the cells it held aren't counted.
  jmp_buf at;
  lab_stop_at = &at;
  while (scanf("%d", &i) == 1) {
    if (setjmp(at)) { const char *w = lab_stopped < 0 ? lab_stop_why : lab_stops[lab_stopped % ${SITES}]; printf(" ! x"); for (size_t j = 0; lab_stopped < 0 ? j < lab_stop_n : w[j] != 0; j++) printf("%02x", (unsigned char)w[j]); printf(" ;0\\n"); lab_memo_clear(); ${cells ? "lab_live = 0; " : ""}continue; }
    switch (i) {
${cases.join("\n")}
    }
    lab_memo_clear();
    printf(" ;%lld\\n", (long long)${cells ? "lab_live" : "0"});
  }
  return 0;
}`;
  }
}

// A number as C reads it back exactly: JavaScript's shortest digits are
// enough for strtod too.
function num(v: number): string {
  if (Number.isNaN(v)) return "NAN";
  if (!Number.isFinite(v)) return v > 0 ? "INFINITY" : "(-INFINITY)";
  if (Object.is(v, -0)) return "(-0.0)";
  const s = String(v);
  const lit = /[.e]/.test(s) ? s : `${s}.0`;
  return v < 0 ? `(${lit})` : lit;
}

// Every expression in e.
function walk(e: SExpr): SExpr[] {
  return [e, ...kids(e).flatMap(walk)];
}

function calls(e: SExpr): Extract<SExpr, { k: "call" }>[] {
  return walk(e).filter((x): x is Extract<SExpr, { k: "call" }> => x.k === "call");
}

// A record given to a call and afterwards only read field by field has
// those fields read before the call, so the call is given the record
// itself and not a copy whose counts it shares (C94: machine's `stepped`
// read `m.pc` after `executed(…, m)`, so every list in the machine had two
// holders while an instruction ran, and none was ever changed in place).
// Borrowing in Perceus (Reinking, Xie, de Moura and Leijen, PLDI 2021)
// does this for a parameter; here it is the fields still needed that are
// taken first.
function readFirst(f: SFunc, funcs: SFunc[]): SExpr {
  const occurs = (e: SExpr, x: number): number => (e.k === "local" && e.i === x ? 1 : 0) + kids(e).reduce((n, k) => n + occurs(k, x), 0);
  const fieldReads = (e: SExpr, x: number): number => (e.k === "get" && e.rec.k === "local" && e.rec.i === x ? 1 : 0) + kids(e).reduce((n, k) => n + fieldReads(k, x), 0);
  const given = (e: SExpr, out: Set<number>): Set<number> => {
    if (e.k === "call" || e.k === "apply") for (const a of e.args) if (a.k === "local") out.add(a.i);
    for (const k of kids(e)) given(k, out);
    return out;
  };
  const go = (e: SExpr): SExpr => {
    e = mapKids(e, go);
    if (e.k !== "let") return e;
    let body = e.body;
    const lets: { i: number; value: SExpr }[] = [];
    for (const x of given(e.value, new Set())) {
      const t = f.locals[x];
      if (x === e.i || !isRecord(t) || t.mutable) continue;
      const n = occurs(body, x);
      if (!n || fieldReads(body, x) !== n) continue;
      const taken = new Map<number, number>();
      const swap = (b: SExpr): SExpr => {
        if (b.k === "get" && b.rec.k === "local" && b.rec.i === x) {
          if (!taken.has(b.i)) { const l = f.locals.push(t.fields[b.i].t) - 1; taken.set(b.i, l); lets.push({ i: l, value: b }); }
          return { k: "local", i: taken.get(b.i)! };
        }
        return mapKids(b, swap);
      };
      body = swap(body);
    }
    return lets.reduceRight<SExpr>((inner, l) => ({ k: "let", i: l.i, value: l.value, body: inner }), { ...e, body });
  };
  // At the end of the function, where nothing comes after: a record
  // parameter read field by field while something there changes one of its
  // fields (machine's `stored`: `replace at(m.memory, …)` among the others)
  // has every field read first, so the record is gone and each field has
  // one holder when it is changed. A call there given the whole record
  // before anything else happens is made first.
  const lets = (inner: SExpr, ls: { i: number; value: SExpr }[]) => ls.reduceRight<SExpr>((b, l) => ({ k: "let", i: l.i, value: l.value, body: b }), inner);
  const tail = (e: SExpr): SExpr => {
    switch (e.k) {
      case "let": return { ...e, body: tail(e.body) };
      case "if": return { ...e, then: tail(e.then), else: tail(e.else) };
      case "case": return { ...e, arms: e.arms.map((a) => (a ? tail(a) : a)) };
      case "make": case "call": case "new": case "rt": break;
      default: return e;
    }
    let t: SExpr = e;
    for (let x = 0; x < f.params.length; x++) {
      const rt = f.locals[x];
      if (!isRecord(rt) || rt.mutable || !occurs(t, x)) continue;
      // Calls given x whole that come first, in the order things happen.
      const first: SExpr[] = [];
      let pure = true;
      const order = (n: SExpr) => {
        if (!pure) return;
        // Only through plain expressions: a call inside a search, a budget
        // or a handler stays where its failure is caught.
        if (!["make", "call", "new", "rt", "op", "get", "local", "num", "int", "text", "bool"].includes(n.k)) { pure = false; return; }
        if (n.k === "call" && n.args.some((a) => a.k === "local" && a.i === x) && n.args.every((a) => a.k === "local" || !kids(a).length)) { first.push(n); return; }
        for (const k of kids(n)) order(k);
        if (n.k === "call" || n.k === "apply" || n.k === "world" || n.k === "fail" || (n.k === "rt" && (isPerform(n.fn) || isStack(n.fn) || isFiber(n.fn) || runtime(n.fn).partial))) pure = false;
      };
      order(t);
      const ls: { i: number; value: SExpr }[] = [];
      for (const c of first) {
        const l = f.locals.push(funcs[(c as Extract<SExpr, { k: "call" }>).fn].result) - 1;
        ls.push({ i: l, value: c });
        const put = (n: SExpr): SExpr => (n === c ? { k: "local", i: l } : mapKids(n, put));
        t = put(t);
      }
      const n = occurs(t, x);
      if (!n || fieldReads(t, x) !== n || !walk(t).some((y) => y.k === "call" || y.k === "rt")) { t = lets(t, ls); continue; }
      const taken = new Map<number, number>();
      const swap = (b: SExpr): SExpr => {
        if (b.k === "get" && b.rec.k === "local" && b.rec.i === x) {
          if (!taken.has(b.i)) { const l = f.locals.push(rt.fields[b.i].t) - 1; taken.set(b.i, l); ls.push({ i: l, value: b }); }
          return { k: "local", i: taken.get(b.i)! };
        }
        return mapKids(b, swap);
      };
      t = lets(swap(t), ls);
    }
    return t;
  };
  return tail(go(f.body));
}

