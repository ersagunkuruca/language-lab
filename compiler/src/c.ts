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
import { STOPS } from "./stops.ts";
import { fails, isArray, isTable, isData, isFn, isRecord, kids, mapKids, OPS, type AType, type TType, type DType, type FType, type LType, type Lowered, type Op, type RType, type SExpr, type SFunc } from "./scalar.ts";

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
// std's Array's runtime functions, one copy per item type (scalar.ts).
const ARRAY_FN = /^array\.(\w+)\.a(\d+)$/;
// std's Table's runtime functions, one copy per table type (C63h).
const TABLE_FN = /^table\.(\w+)\.t(\d+)(?:\.e(\d+))?$/;
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
  const used = new Set<string>(["new", "free", "unused", "block", "block_end", "dup", "dec", "drop", "fields", "oom", "live", "st", "reason", "fuel", "mod", "in", "out", "bits", "run", "code", "argc", "argv", "hex", "hexd", "word", "token", ...RESERVED, ...lowered.arrays.flatMap((_, i) => ["empty", "of", "items", "length", "at", "push", "first", "rest", "pushFront", "get", "replaceAt"].map((op) => `array_${op}_a${i}`)), ...lowered.tables.flatMap((t, i) => [...["empty", "put", "remove", "has", "size", "at"].map((op) => `table_${op}_t${i}`), ...t.entries.map((_, j) => `table_entries_t${i}_e${j}`), `Table_t${i}`, `Store_t${i}`, ...["find", "change", "grow", "hash", "eq", "cmp", "sort", "made", "store", "reroot"].map((h) => `_${h}_t${i}`)])]);
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
    : isArray(t) ? why(t.item)
    : isTable(t) ? why(t.value)
    : [...(t as FType).params, (t as FType).result].map(why).find(Boolean) ?? null;
  funcs.forEach((f, i) => {
    const t = [...f.locals, f.result].map(why).find(Boolean);
    if (t) return refused.set(i, t);
    const k = walk(f.body).find((e) => !PRINTED.has(e.k) || (e.k === "rt" && !RT_C.has(e.fn) && !ARRAY_FN.test(e.fn) && !TABLE_FN.test(e.fn)) || (e.k === "world" && !RT_C.has(`world.${e.op}`)));
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
      if (e.k === "rt" && !a && !tb) {
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
  const ty = (t: LType): string => (t === "f64" ? "double" : t === "i32" ? "int32_t" : t === "int" ? "lab_int" : isRecord(t) && !t.mutable ? sname.get(t.key)! : "lab_cell *");
  // Whether a value of t is a cell, or holds counts (an Int may be a cell).
  const cell = (t: LType) => t === "text" || isData(t) || isFn(t) || isArray(t) || isTable(t) || (isRecord(t) && !!t.mutable);
  const counted = (t: LType): boolean => cell(t) || t === "int" || (isRecord(t) && t.fields.some((x) => counted(x.t)));
  const dup = (t: LType, x: string) => (cell(t) ? `lab_dup(${x})` : t === "int" ? `lab_int_dup(${x})` : isRecord(t) && counted(t) ? `${sname.get(t.key)}_dup(${x})` : x);
  const drop = (t: LType, x: string) => (cell(t) ? `lab_drop(${x});` : t === "int" ? `lab_int_drop(${x});` : `${sname.get((t as RType).key)}_drop(${x});`);
  const dec = (t: LType, x: string) => (cell(t) ? `lab_dec(${x});` : t === "int" ? `lab_int_dec(${x});` : `${sname.get((t as RType).key)}_dec(${x});`);
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
    const d = data.get(fn === "world.readLine" ? OPTION_TEXT : fn.startsWith("world.") ? LIST_TEXT : runtime(fn).list ?? LIST_TEXT)!;
    const tag = d.cases.findIndex((c) => c.fields.length > 0);
    return { cons: cname(d, tag), nil: cname(d, 1 - tag), type: tnum.get(d.key)!, tag, head: d.cases[tag].fields.findIndex((x) => x.t !== d) };
  };
  // Text and big Int constants, as static cells that are never counted;
  // and the runtime functions called.
  const statics = new Map<string, { name: string; decl: string }>(), rts = new Set<string>(), arrayFns = new Set<string>();
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
  const math = kept.some((i) => walk(funcs[i].body).some((e) => e.k === "op" && e.op in FDLIBM));
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
    const made = new Set(walk(f.body).flatMap((e) => (e.k === "make" || e.k === "new" ? [e.t.key] : [])));
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
  const ints = opts.main !== undefined || rts.size > 0 || arrayFns.size > 0 || statics.size > 0 || kept.some((i) => [...funcs[i].params, ...funcs[i].locals, funcs[i].result].some((t) => mentions(t)));
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
    types.push(`typedef struct { lab_cell h; uint32_t lo, hi, cap; ${ty(a.item)} it[]; } ${n.buf}; // an array's buffer: items lo..hi used`,
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
  for (const a of arrays.values()) {
    const n = aname.get(a.key)!;
    fieldsOf.push(`case ${tnum.get(`array ${a.key}`)}: lab_dec(((${n.view} *)c)->b); break;`);
    if (counted(a.item)) fieldsOf.push(`case ${tnum.get(`buf ${a.key}`)}: { ${n.buf} *b = (${n.buf} *)c; for (uint32_t k = b->lo; k < b->hi; k++) ${dec(a.item, "b->it[k]")} } break;`);
  }
  for (const t of tables.values()) {
    const T = `lab_Table_t${t.index}`, k = counted(t.keyT) ? dec(t.keyT, "b->ks[j]") : "";
    const v = (x: string) => (counted(t.value) ? dec(t.value, x) : "");
    fieldsOf.push(`case ${tnum.get(`table ${t.key}`)}: { ${T} *v = (${T} *)c; lab_Store_t${t.index} *b = v->cur; if (b) { for (uint32_t j = 0; j < b->cap; j++) if (b->st[j] == 1) { ${k} ${v("b->vs[j]")} } free(b->st); free(b->ks); free(b->vs); free(b); } else { ${k.replace("b->ks[j]", "v->key")} if (v->had) { ${v("v->old")} } lab_dec(v->next); } } break;`);
  }
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
    // A Float64 with no answer or too big (L125c2, stops.ts): the reason
    // to standard error and exit 1, as an Abort nothing handled does.
    ...(text.some((t) => t.includes("lab_stop(")) || opts.harness ? [`static const char *lab_stops[] = { ${STOPS.map((x) => JSON.stringify(x)).join(", ")} };`, "#include <setjmp.h>",
      // The test harness goes on to its next call instead (lab_stop_at).
      "static jmp_buf *lab_stop_at = 0; static int lab_stopped = 0;",
      "static double lab_stop(double i) { if (lab_stop_at) { lab_stopped = (int)i; longjmp(*lab_stop_at, 1); } fflush(stdout); fprintf(stderr, \"%s\\n\", lab_stops[(int)i]); exit(1); }"] : []),
    ...[...statics.values()].map((x) => x.decl),
    ...(rts.size ? ["", runtimeC(rts, listNames)] : []),
    ...[...arrays.values()].flatMap((a) => arrayC(a)),
    ...[...tables.values()].flatMap((t) => tableC(t)),
    "",
    ...kept.map((i) => `${header(i)};`),
    ...[...lent.keys()].map((i) => `${header(i, true)};`),
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
          const ps = lent.get(e.fn);
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
          if (e.op === "stop") return `lab_stop(${xs[0]})`;
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
    const all = body.join("\n"), named = decls.filter((x) => new RegExp(`\\b${/(\w+);$/.exec(x)![1]}\\b`).test(all));
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
    const leaves = (x: LType, at: string): ["int" | "text", string][] => (x === "int" || x === "text" ? [[x, at]] : (x as RType).fields.flatMap((f, j) => leaves(f.t, `${at}.f${j}`)));
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
static inline int lab__et_t${i}(lab_cell *a, lab_cell *b) { return LAB_TN(a) == LAB_TN(b) && memcmp(LAB_TB(a), LAB_TB(b), LAB_TN(a)) == 0; }`] : [])];
    const out = [`// ${t.set ? `Hash set ${i}: ${int ? "Int" : kt === "text" ? "Text" : "tuple"} items` : `Table ${i}: ${int ? "Int" : kt === "text" ? "Text" : "tuple"} keys, ${V} values`}.
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
  function arrayC(a: AType): string[] {
    const fns = [...arrayFns].filter((f) => ARRAY_FN.test(f) && Number(ARRAY_FN.exec(f)![2]) === a.index);
    if (!fns.length) return [];
    const { view: V, buf: B } = aname.get(a.key)!, T = ty(a.item), i = a.index;
    const tv = tnum.get(`array ${a.key}`), tb = tnum.get(`buf ${a.key}`);
    const cp = (x: string) => (counted(a.item) ? dup(a.item, x) : x);
    const l = a.list && (() => { const d = a.list!, tag = d.cases.findIndex((c) => c.fields.length > 0); return { cons: cname(d, tag), nil: cname(d, 1 - tag), type: tnum.get(d.key)!, tag, head: d.cases[tag].fields.findIndex((x) => x.t !== d) }; })();
    const out = [`// Array ${i}: of ${T}.
static lab_cell *lab__view_a${i}(lab_cell *b, uint32_t s, uint32_t n) { ${V} *v = lab_new(sizeof(${V}), ${tv}, 0); v->b = b; v->s = s; v->n = n; return (lab_cell *)v; }
// A buffer holding a copy of n items in its middle, with room for as many again on each side.
static lab_cell *lab__copy_a${i}(${T} *xs, uint32_t n) {
  uint32_t room = n > 4 ? n : 4;
  if ((uint64_t)n + 2 * (uint64_t)room > UINT32_MAX) lab_oom();
  ${B} *b = lab_new(sizeof(${B}) + ((size_t)n + 2 * (size_t)room) * sizeof(${T}), ${tb}, 0);
  b->lo = room; b->hi = room + n; b->cap = n + 2 * room;
  for (uint32_t k = 0; k < n; k++) b->it[room + k] = ${cp("xs[k]")};
  return lab__view_a${i}((lab_cell *)b, room, n);
}`];
    const has = (op: string) => arrayFns.has(`array.${op}.a${i}`);
    if (has("empty")) out.push(`static lab_cell *lab_array_empty_a${i}(void) { return lab__copy_a${i}(0, 0); }`);
    if (has("of")) out.push(`static lab_cell *lab_array_of_a${i}(lab_cell *l) {
  uint32_t n = 0;
  for (lab_cell *p = l; p->tag == ${l!.tag}; p = ((${l!.cons} *)p)->f${1 - l!.head}) n++;
  uint32_t room = n > 4 ? n : 4, k = room;
  ${B} *b = lab_new(sizeof(${B}) + ((size_t)n + 2 * (size_t)room) * sizeof(${T}), ${tb}, 0);
  b->lo = room; b->hi = room + n; b->cap = n + 2 * room;
  for (lab_cell *p = l; p->tag == ${l!.tag}; p = ((${l!.cons} *)p)->f${1 - l!.head}) b->it[k++] = ${cp(`((${l!.cons} *)p)->f${l!.head}`)};
  lab_cell *a = lab__view_a${i}((lab_cell *)b, room, n);
  lab_drop(l);
  return a;
}`);
    if (has("items")) out.push(`static lab_cell *lab_array_items_a${i}(lab_cell *a) {
  ${V} *v = (${V} *)a;
  ${T} *it = ((${B} *)v->b)->it + v->s;
  lab_cell *acc = &${l!.nil};
  for (uint32_t k = v->n; k-- > 0;) { ${l!.cons} *c = lab_new(sizeof(${l!.cons}), ${l!.type}, ${l!.tag}); c->f${l!.head} = ${cp("it[k]")}; c->f${1 - l!.head} = acc; acc = (lab_cell *)c; }
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
  if (a->rc == 1 && v->b->rc == 1) { ${B} *b = (${B} *)v->b; ${T} old = b->it[v->s + at]; b->it[v->s + at] = x; ${dropX("old")} (void)old; return a; }
  lab_cell *r = lab__copy_a${i}(((${B} *)v->b)->it + v->s, v->n);
  ${V} *w = (${V} *)r;
  ${B} *c = (${B} *)w->b;
  ${T} old = c->it[w->s + at];
  c->it[w->s + at] = x;
  ${dropX("old")} (void)old;
  lab_drop(a);
  return r;
}`);
    if (has("length")) out.push(`static lab_int lab_array_length_a${i}(lab_cell *a) { lab_int n = LAB_SMALL(((${V} *)a)->n); lab_drop(a); return n; }`);
    // No answer past the end.
    if (has("at")) out.push(`static ${T} lab_array_at_a${i}(lab_cell *a, lab_int k) {
  ${V} *v = (${V} *)a;
  if (!LAB_IS_SMALL(k) || LAB_VAL(k) < 0 || LAB_VAL(k) >= (int64_t)v->n) { lab_int_drop(k); lab_drop(a); lab_st = 1; return ${zero(a.item)}; }
  ${T} x = ${cp(`((${B} *)v->b)->it[v->s + LAB_VAL(k)]`)};
  lab_drop(a);
  return x;
}`);
    // Item k where k is known to be in the array (equal and compare's loop).
    if (has("get")) out.push(`static ${T} lab_array_get_a${i}(lab_cell *a, lab_int k) {
  ${T} x = ${cp(`((${B} *)((${V} *)a)->b)->it[((${V} *)a)->s + LAB_VAL(k)]`)};
  lab_drop(a);
  return x;
}`);
    // The first item; none when empty (C30d).
    if (has("first")) out.push(`static ${T} lab_array_first_a${i}(lab_cell *a) {
  ${V} *v = (${V} *)a;
  if (v->n == 0) { lab_drop(a); lab_st = 1; return ${zero(a.item)}; }
  ${T} x = ${cp(`((${B} *)v->b)->it[v->s]`)};
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
  if (v->s == b->lo && v->s > 0) {
    b->it[--b->lo] = x;
    if (a->rc == 1) { v->s--; v->n++; return a; }
    r = lab__view_a${i}(lab_dup(v->b), v->s - 1, v->n + 1);
  } else {
    r = lab__copy_a${i}(b->it + v->s, v->n);
    ${V} *w = (${V} *)r;
    ${B} *c = (${B} *)w->b;
    c->it[--c->lo] = x; w->s--; w->n++;
  }
  lab_drop(a);
  return r;
}`);
    if (has("push")) out.push(`static lab_cell *lab_array_push_a${i}(lab_cell *a, ${T} x) {
  ${V} *v = (${V} *)a;
  ${B} *b = (${B} *)v->b;
  uint32_t end = v->s + v->n;
  lab_cell *r;
  if (end == b->hi && end < b->cap) {
    b->it[end] = x; b->hi++;
    if (a->rc == 1) { v->n++; return a; }
    r = lab__view_a${i}(lab_dup(v->b), v->s, v->n + 1);
  } else {
    r = lab__copy_a${i}(b->it + v->s, v->n);
    ${V} *w = (${V} *)r;
    ${B} *c = (${B} *)w->b;
    c->it[c->hi++] = x; w->n++;
  }
  lab_drop(a);
  return r;
}`);
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
    if (setjmp(at)) { const char *w = lab_stops[lab_stopped]; printf(" ! x"); for (; *w; w++) printf("%02x", (unsigned char)*w); printf(" ;0\\n"); ${cells ? "lab_live = 0; " : ""}continue; }
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
        if (n.k === "call" || n.k === "apply" || n.k === "world" || n.k === "fail" || (n.k === "rt" && runtime(n.fn).partial)) pure = false;
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

