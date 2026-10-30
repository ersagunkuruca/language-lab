// C for the lowering wasm.ts, wgsl.ts and js-scalar.ts print (scalar.ts),
// printed as C: native programs (docs/design/targets/NATIVE.md). Float64 is
// `double`, Bool is an `int32_t` 0 or 1, a record is a struct passed by
// value, a let is a local, and `if` and a match are statements. Lower with
// `{ records: true }` to have records, `{ data: true }` for data too.
//
// The numbers are the evaluator's, bit for bit, on any C compiler that
// keeps IEEE 754's rules: + − × ÷, sqrt and floor are exact in C as in
// JavaScript, `mod` is fmod twice (as runtime.js's `$mod`), and sin, cos,
// tan, exp, log, pow and atan2 are V8's fdlibm translated to C (c-math.ts),
// which is what Node's Math runs. What a compiler may do to that, it must
// be told not to: contract a·b + c into one fused step (GCC does on
// aarch64 unless -ffp-contract=off), or keep x87's extra bits on 32-bit
// x86 (-msse2 -mfpmath=sse). CFLAGS has the flags.
//
// Data (N2) is a pointer to a cell: a count, the cell's type and case,
// then the fields, one C struct per case. A case with no fields is one
// static cell whose count is 0, which means it is never counted or freed.
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
import { BASE, cName, POSIX, RESERVED, RT_C, runtimeC, WORLD_H, type ListNames } from "./c-rt.ts";
import { runtime } from "./wasm-rt.ts";
import { fails, isData, isFn, isRecord, kids, mapKids, OPS, type DType, type FType, type LType, type Lowered, type Op, type RType, type SExpr, type SFunc } from "./scalar.ts";

// What a C compiler needs to keep the evaluator's numbers. -fwrapv: fdlibm
// shifts signed ints past their top bit (pow's test for an odd exponent).
export const CFLAGS = ["-std=c99", "-O2", "-ffp-contract=off", "-fwrapv"];

// and, or: both sides, as WebAssembly's i32.and (a side may hold cells
// its call owns, which skipping it would leak), on Bools that are 0 or 1.
const INFIX: Partial<Record<Op, string>> = {
  add: "+", sub: "-", mul: "*", div: "/", less: "<", equal: "==", beq: "==", and: "&", or: "|",
};
const LIBM: Partial<Record<Op, string>> = { sqrt: "sqrt", abs: "fabs", floor: "floor" };
const FDLIBM: Partial<Record<Op, string>> = {
  sin: "lab_fdlibm_sin", cos: "lab_fdlibm_cos", tan: "lab_fdlibm_tan", exp: "lab_fdlibm_exp", log: "lab_fdlibm_log", pow: "lab_fdlibm_pow", atan2: "lab_fdlibm_atan2",
};
const PRINTED = new Set<SExpr["k"]>([
  "num", "bool", "local", "let", "if", "op", "call", "make", "get", "budget", "new", "field", "tag", "case",
  "closure", "cap", "apply", "fail", "attempt", "set", "zero", "int", "text", "rt", "abort", "handle", "world",
]);
const LIST_TEXT = "std.list<type.string<>>", OPTION_TEXT = "std.optional<type.string<>>";

// The runtime of counted cells. A null cell (a box's value before the
// search sets it) is never counted.
const CELLS = `typedef struct lab_cell { uint32_t rc; uint16_t type; uint8_t tag, size; } lab_cell;
typedef struct { lab_cell h; void (*code)(void); } lab_closure;
static int lab_st = 0; // 1: no answer, 2: aborted, with lab_reason
static lab_cell *lab_reason = 0;
static int64_t lab_live = 0;
static lab_cell **lab_dead = 0;
static size_t lab_dead_n = 0, lab_dead_cap = 0;
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
static void *lab_unused[LAB_SIZES + 1];
static char *lab_block = 0, *lab_block_end = 0;
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
static inline lab_cell *lab_dup(lab_cell *c) { if (c && c->rc) c->rc++; return c; }
// One count fewer; a cell that has none left waits on lab_dead.
static inline void lab_dec(lab_cell *c) {
  if (c && c->rc && --c->rc == 0) {
    if (lab_dead_n == lab_dead_cap) { lab_dead_cap = lab_dead_cap ? 2 * lab_dead_cap : 64; lab_dead = realloc(lab_dead, lab_dead_cap * sizeof *lab_dead); if (!lab_dead) lab_oom(); }
    lab_dead[lab_dead_n++] = c;
  }
}
static void lab_fields(lab_cell *c);
static void lab_drop(lab_cell *c) {
  if (!c || !c->rc || --c->rc) return;
  size_t base = lab_dead_n;
  lab_fields(c);
  lab_free(c);
  while (lab_dead_n > base) { lab_cell *d = lab_dead[--lab_dead_n]; lab_fields(d); lab_free(d); }
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
export function emitC(lowered: Lowered, opts: { harness?: boolean; main?: string } = {}): CProgram {
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
  const used = new Set<string>(["new", "free", "unused", "block", "block_end", "dup", "dec", "drop", "fields", "oom", "live", "st", "reason", "fuel", "mod", "in", "out", "bits", "run", "code", "argc", "argv", "hex", "hexd", "word", "token", ...RESERVED]);
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
    t === "f64" || t === "i32" || t === "int" || t === "text" ? null
    : isRecord(t) ? t.fields.map((x) => why(x.t)).find(Boolean) ?? null
    : isData(t) ? null
    : [...(t as FType).params, (t as FType).result].map(why).find(Boolean) ?? null;
  funcs.forEach((f, i) => {
    const t = [...f.locals, f.result].map(why).find(Boolean);
    if (t) return refused.set(i, t);
    const k = walk(f.body).find((e) => !PRINTED.has(e.k) || (e.k === "rt" && !RT_C.has(e.fn)) || (e.k === "world" && !RT_C.has(`world.${e.op}`)));
    if (k) refused.set(i, k.k === "rt" ? `${k.fn} isn't in C's runtime` : k.k === "world" ? `the world's ${k.op} isn't in C's runtime` : `${k.k} isn't printed as C`);
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

  // Types: every record, data type and function type the kept functions
  // mention, and the shapes of their closures.
  const records = new Map<string, RType>(), data = new Map<string, DType>(), fns = new Map<string, FType>();
  const collect = (t: LType) => {
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
  [...data.keys(), ...boxes.map((b) => b.key), ...[...shaped].map((s) => `shape ${s}`)].forEach((k, j) => tnum.set(k, j));
  const cname = (t: DType, c: number) => `${dname.get(t.key)}_${t.cases[c].name.replace(/[^A-Za-z0-9_]/g, "_")}`;
  const names = new Map(kept.map((i) => [i, `lab_${ident(funcs[i].name)}`]));

  // Cells of the same fields are one size, so one can take the other's place.
  const layout = (fs: { t: LType }[]) => fs.map((x) => ty(x.t)).join(", ");
  const ty = (t: LType): string => (t === "f64" ? "double" : t === "i32" ? "int32_t" : t === "int" ? "lab_int" : isRecord(t) && !t.mutable ? sname.get(t.key)! : "lab_cell *");
  // Whether a value of t is a cell, or holds counts (an Int may be a cell).
  const cell = (t: LType) => t === "text" || isData(t) || isFn(t) || (isRecord(t) && !!t.mutable);
  const counted = (t: LType): boolean => cell(t) || t === "int" || (isRecord(t) && t.fields.some((x) => counted(x.t)));
  const dup = (t: LType, x: string) => (cell(t) ? `lab_dup(${x})` : t === "int" ? `lab_int_dup(${x})` : isRecord(t) && counted(t) ? `${sname.get(t.key)}_dup(${x})` : x);
  const drop = (t: LType, x: string) => (cell(t) ? `lab_drop(${x});` : t === "int" ? `lab_int_drop(${x});` : `${sname.get((t as RType).key)}_drop(${x});`);
  const dec = (t: LType, x: string) => (cell(t) ? `lab_dec(${x});` : t === "int" ? `lab_int_dec(${x});` : `${sname.get((t as RType).key)}_dec(${x});`);
  // The type of a runtime function's answer.
  const rtType = (fn: string): LType => {
    const r = runtime(fn);
    if (r.result !== "list") return r.result as LType;
    const d = data.get(r.list ?? LIST_TEXT);
    if (!d) throw new Error(`${fn}'s list type isn't one the program has`);
    return d;
  };
  // The names a runtime function that makes or reads a list needs.
  const listNames = (fn: string): ListNames => {
    const d = data.get(fn === "world.readLine" ? OPTION_TEXT : fn.startsWith("world.") ? LIST_TEXT : runtime(fn).list ?? LIST_TEXT)!;
    const tag = d.cases.findIndex((c) => c.fields.length > 0);
    return { cons: cname(d, tag), nil: cname(d, 1 - tag), type: tnum.get(d.key)!, tag, head: d.cases[tag].fields.findIndex((x) => x.t !== d) };
  };
  // Text and big Int constants, as static cells that are never counted;
  // and the runtime functions called.
  const statics = new Map<string, { name: string; decl: string }>(), rts = new Set<string>();
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
    return isRecord(t) ? t.fields.some((x) => mentions(x.t, seen)) : isData(t) ? t.cases.some((c) => c.fields.some((x) => mentions(x.t, seen))) : [...(t as FType).params, (t as FType).result].some((x) => mentions(x, seen));
  };

  const header = (i: number) => {
    const f = funcs[i];
    return `${ty(f.result)} ${names.get(i)}(${f.params.map((t, j) => `${ty(t)} p${j}`).join(", ") || "void"})`;
  };
  const fuel = kept.some((i) => funcs[i].spends || walk(funcs[i].body).some((e) => e.k === "budget"));
  const math = kept.some((i) => walk(funcs[i].body).some((e) => e.k === "op" && e.op in FDLIBM));
  const text = kept.map((i) => func(funcs[i], i));
  const ints = opts.main !== undefined || rts.size > 0 || statics.size > 0 || kept.some((i) => [...funcs[i].params, ...funcs[i].locals, funcs[i].result].some((t) => mentions(t)));
  const cells = ints || tnum.size > 0 || kept.some((i) => funcs[i].partial);
  const tests = opts.harness ? harness() : "";

  const types: string[] = [];
  for (const r of records.values()) {
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
  for (const [k, t] of fns) types.push(`typedef ${ty(t.result)} (*${fname.get(k)})(${["lab_cell *", ...t.params.map(ty)].join(", ")});`);
  for (const s of shaped) types.push(`typedef struct { lab_cell h; void (*code)(void); ${shapes[s].caps.map((x, j) => `${ty(x)} c${j};`).join(" ")} } ${shapeName.get(s)};`);
  // Dup and drop for records that hold counts, and each cell type's
  // fields given up when its cell goes.
  const counts: string[] = [];
  for (const r of records.values()) {
    if (!counted(r) || r.mutable) continue;
    const n = sname.get(r.key)!;
    const parts = r.fields.map((x, j) => ({ t: x.t, at: `r.f${j}` })).filter((x) => counted(x.t));
    counts.push(
      `static inline ${n} ${n}_dup(${n} r) { ${parts.map((x) => `${dup(x.t, x.at)};`).join(" ")} return r; }`,
      `static inline void ${n}_drop(${n} r) { ${parts.map((x) => drop(x.t, x.at)).join(" ")} }`,
      `static inline void ${n}_dec(${n} r) { ${parts.map((x) => dec(x.t, x.at)).join(" ")} }`,
    );
  }
  const fieldsOf: string[] = [];
  for (const d of data.values()) {
    const arms = d.cases.map((c, j) => {
      const ks = c.fields.map((x, k) => ({ t: x.t, at: `((${cname(d, j)} *)c)->f${k}` })).filter((x) => counted(x.t));
      return ks.length ? `case ${j}: ${ks.map((x) => dec(x.t, x.at)).join(" ")} break;` : "";
    }).filter(Boolean);
    fieldsOf.push(arms.length ? `case ${tnum.get(d.key)}: switch (c->tag) { ${arms.join(" ")} } break;` : "");
  }
  for (const b of boxes) fieldsOf.push(counted(b.fields[0].t) ? `case ${tnum.get(b.key)}: ${dec(b.fields[0].t, `((${sname.get(b.key)} *)c)->f0`)} break;` : "");
  for (const s of shaped) {
    const ks = shapes[s].caps.map((x, j) => (counted(x) ? dec(x, `((${shapeName.get(s)} *)c)->c${j}`) : "")).filter(Boolean);
    fieldsOf.push(ks.length ? `case ${tnum.get(`shape ${s}`)}: ${ks.join(" ")} break;` : "");
  }

  const world = [...rts].some((x) => x.startsWith("world."));
  const entry = opts.main === undefined ? "" : program(opts.main);
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
    ...(entry ? ["#include <pthread.h>"] : []),
    ...(math ? [FDLIBM_C] : []),
    ...(cells ? [CELLS] : []),
    ...(ints ? [BASE] : []),
    "",
    ...types,
    ...counts,
    ...(cells ? [`static void lab_fields(lab_cell *c) { switch (c->type) { ${fieldsOf.filter(Boolean).join(" ")} default: break; } }`] : []),
    ...(text.some((t) => t.includes("lab_fuel")) ? ["static double lab_fuel = INFINITY; // outside any budget, as much as it takes"] : []),
    ...(text.some((t) => t.includes("lab_mod(")) ? ["static double lab_mod(double a, double b) { return fmod(fmod(a, b) + b, b); }"] : []),
    ...[...statics.values()].map((x) => x.decl),
    ...(rts.size ? ["", runtimeC(rts, listNames)] : []),
    "",
    ...kept.map((i) => `${header(i)};`),
    "",
    text.join("\n\n"),
    ...(opts.harness ? ["", tests] : []),
    ...(entry ? ["", entry] : []),
    "",
  ].join("\n");
  return { c, names, refused };

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
    const isCounted = (j: number) => counted(f.locals[j]);
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
      es.forEach((a, k) => {
        const later = union(after, ...es.slice(k + 1).map(free));
        // The earlier ones go into temps (owned, so a way out drops them)
        // if this one has statements: named before it's printed.
        const held = xs.flatMap((x, j) => (/^(\d[\w.+-]*|\(-?[\d.e+-]+\))$/.test(x) || pending.some((p) => p.v === x) ? [] : [{ j, t: typeOf(es[j], f.locals) }]))
          .map(({ j, t }) => ({ j, t, v: temp(t) }));
        pending.push(...held);
        const mine: string[] = [];
        const x = ex(a, mine, d, later);
        if (mine.length) {
          for (const h of held) { pre.push(`${d}${h.v} = ${xs[h.j]};`); xs[h.j] = h.v; }
          pre.push(...mine);
        } else pending.splice(pending.length - held.length);
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
        case "int": return intLit(e.v);
        case "text": return textLit(e.v);
        case "rt": {
          rts.add(e.fn);
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
        case "if": case "case": case "attempt": case "budget": case "handle": {
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
        case "get": return borrow(e.rec, e.t.fields[e.i].t, (r) => (e.t.mutable ? `((${sname.get(e.t.key)} *)${r})->f${e.i}` : `${r}.f${e.i}`), pre, d, after);
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
        case "field": return borrow(e.rec, e.t.cases[e.c].fields[e.i].t, (r) => `((${cname(e.t, e.c)} *)${r})->f${e.i}`, pre, d, after);
        case "tag": return borrow(e.rec, "i32", (r) => `(int32_t)${r}->tag`, pre, d, after);
        case "call": {
          const c = `${names.get(e.fn)}(${args(e.args, pre, d, after).join(", ")})`;
          return funcs[e.fn].partial ? checked(c, funcs[e.fn].result, pre, d, after) : stated(c, funcs[e.fn].result, pre, d);
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
        case "zero": return zero(e.t);
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
          return `${LIBM[e.op] ?? FDLIBM[e.op]}(${xs.join(", ")})`;
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
        r.alive = false;
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
        `${d}  if (${local(s)}->rc) ${local(s)}->rc--;`,
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
        within(keep, (l) => {
          label = l;
          lines.push(give(ex(e.body, lines, d, keep)));
        });
        if (to !== "return") lines.push(`${d}goto ${done};`);
        lines.push(`${d}${label}:`, `${d}if (lab_st != ${2 + (e.esc ?? 0)}) {`, ...out(d + "  ", keep), `${d}}`, ...(fuel ? [`${d}lab_fuel = ${local(e.save)};`] : []));
        lines.push(`${d}lab_st = 0;`, `${d}${local(e.reason)} = lab_reason;`, `${d}lab_reason = 0;`);
        lines.push(...drops(keep, free(e.arm), after, d), ...block(e.arm, to, d, after));
        if (to !== "return") lines.push(`${d}${done}:;`);
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
        lines.push(`${d}${label}:`, ...(budget ? [`${d}lab_fuel = ${budget.s};`] : []));
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
      if (to === "return" && f.partial && targets.length === 0 && ((e.k === "call" && e.tail && funcs[e.fn].partial) || (e.k === "apply" && e.tail && e.t.partial))) {
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
    const spend = (d: string) => (f.spends ? [`${d}lab_fuel -= 1;`, `${d}if (lab_fuel < 0) {`, ...(f.partial ? [...f.params.flatMap((t, j) => (counted(t) ? [`${d}  ${drop(t, `p${j}`)}`] : [])), `${d}  lab_st = 1;`] : []), `${d}  return ${zero(f.result)};`, `${d}}`] : []);
    // Inputs the body never reads are dropped as it starts.
    const unread = (d: string) => f.params.map((t, j) => (counted(t) && !free(f.body).has(j) ? `${d}${drop(t, `p${j}`)}` : "")).filter(Boolean);
    const body = loops
      ? ["  for (;;) {", ...spend("    "), ...unread("    "), ...block(f.body, "return", "    ", new Set()), "  }"]
      : [...spend("  "), ...unread("  "), ...block(f.body, "return", "  ", new Set())];
    // Only the locals the body uses (the lowering's own for budgets aren't).
    const all = body.join("\n"), named = decls.filter((x) => new RegExp(`\\b${/(\w+);$/.exec(x)![1]}\\b`).test(all));
    return [`// ${f.name.replace(/\n/g, " ")}`, `${header(i)} {`, ...named, ...body, "}"].join("\n");
  }

  // The type of e's value.
  function typeOf(e: SExpr, locals: LType[]): LType {
    switch (e.k) {
      case "local": return locals[e.i];
      case "bool": case "tag": return "i32";
      case "op": return OPS[e.op].t;
      case "new": return e.t;
      case "field": return e.t.cases[e.c].fields[e.i].t;
      case "get": return e.t.fields[e.i].t;
      case "make": case "zero": return e.t;
      case "call": return funcs[e.fn].result;
      case "let": case "set": return typeOf(e.k === "let" ? e.body : e.then, locals);
      case "if": case "budget": case "attempt": case "handle": return e.t;
      case "int": return "int";
      case "text": return "text";
      case "rt": return rtType(e.fn);
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
    return t === "f64" || t === "i32" ? "0" : t === "int" ? "LAB_SMALL(0)" : cell(t) ? "((lab_cell *)0)" : `((${ty(t)}){ ${(t as RType).fields.map((x) => zero(x.t)).join(", ") || "0"} })`;
  }

  function harness(): string {
    if (ints) rts.add("int.read");
    // A reader and a printer for each type an input or an answer has.
    const io: string[] = [];
    const done = new Set<string>();
    const rd = (t: LType): string => {
      if (t === "f64") return "lab_in()";
      if (t === "i32") return "(int32_t)lab_bits()";
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
      if (t === "i32") return `printf(" %d", (int)${v});`;
      if (t === "int") return `{ size_t n; char *s = lab__show(${v}, &n); printf(" %s", s); free(s); }`;
      if (t === "text") return `{ printf(" x"); for (uint32_t k = 0; k < LAB_TN(${v}); k++) printf("%02x", LAB_TB(${v})[k]); }`;
      rd(t);
      return `lab_print_${isRecord(t) ? sname.get((t as RType).key) : dname.get((t as DType).key)}(${v});`;
    }
    const plain = (t: LType, seen = new Set<string>()): boolean => t === "f64" || t === "i32" || t === "int" || t === "text" || (typeof t === "object" && seen.has(t.key))
      || (isRecord(t) && !t.mutable && (seen.add(t.key), t.fields.every((x) => plain(x.t, seen))))
      || (isData(t) && (seen.add(t.key), t.cases.every((c) => c.fields.every((x) => plain(x.t, seen)))));
    const cases = kept.map((i) => {
      const f = funcs[i];
      if (f.inner || !plain(f.result) || !f.params.every((t) => plain(t))) return "";
      // Read in order: C doesn't say in which order a call's arguments run.
      const ins = f.params.map((t, j) => `${ty(t)} a${j} = ${rd(t)};`);
      const after = counted(f.result) ? drop(f.result, "r") : "";
      const show = f.partial
        ? `if (lab_st == 1) { printf(" ?"); lab_st = 0; } else if (lab_st) { printf(" !"); if (lab_st == 2) { ${pr("text", "lab_reason")} } lab_drop(lab_reason); lab_reason = 0; lab_st = 0; } else { ${pr(f.result, "r")} ${after} }`
        : `${pr(f.result, "r")} ${after}`;
      return `    case ${i}: { ${ins.join(" ")} ${ty(f.result)} r = ${names.get(i)}(${f.params.map((_, j) => `a${j}`).join(", ")}); ${show} break; }`;
    }).filter(Boolean);
    // Prototypes first: a reader may use one made after it.
    const protos = io.map((x) => `${x.slice(0, x.indexOf("{")).trim()};`);
    return `#include <string.h>
static uint64_t lab_bits(void) { unsigned long long u = 0; if (scanf("%llx", &u) != 1) return 0; return u; }
static double lab_in(void) { uint64_t u = lab_bits(); double d; memcpy(&d, &u, 8); return d; }
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
  while (scanf("%d", &i) == 1) {
    switch (i) {
${cases.join("\n")}
    }
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
