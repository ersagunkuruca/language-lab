// C for the lowering wasm.ts, wgsl.ts and js-scalar.ts print (scalar.ts),
// printed as C: native programs (projectional/NATIVE.md). Number is
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
// Data (N2) is a pointer to a cell: a count, the data type's number and
// the case's, then the fields, one C struct per case. A case with no
// fields is one static cell whose count is 0, which means it is never
// counted or freed. Values are owned: whoever holds one gives it on (to a
// call, a field, a let) or drops it, so a function owns its inputs. Each
// use of a local is the last one or a `dup`, and a local that one branch
// doesn't use is dropped where that branch starts: the liveness half of
// Koka's Perceus (Reinking, Xie, de Moura and Leijen, PLDI 2021); reuse
// comes in N5. Reading a field borrows the cell and dups the field. A cell
// whose count reaches 0 frees its fields' counts in turn, from a stack of
// cells rather than by recursion, so a million-long list frees in
// constant C stack.
//
// A call to itself as the last step is a loop, as in WGSL; other recursion
// recurses. A budget (with fuel) is one variable, `lab_fuel`, spent as in
// the other targets. A function that has one answer or none, or several,
// or uses closures, text or the world isn't printed yet (NATIVE.md's later
// stages): it is in `refused`, with the stage that brings it, and so is
// anything that calls it.

import { FDLIBM_C } from "./c-math.ts";
import { isData, isRecord, kids, OPS, type DType, type LType, type Lowered, type Op, type RType, type SExpr, type SFunc } from "./scalar.ts";

// What a C compiler needs to keep the evaluator's numbers. -fwrapv: fdlibm
// shifts signed ints past their top bit (pow's test for an odd exponent).
export const CFLAGS = ["-std=c99", "-O2", "-ffp-contract=off", "-fwrapv"];

const INFIX: Partial<Record<Op, string>> = {
  add: "+", sub: "-", mul: "*", div: "/", less: "<", equal: "==", beq: "==", and: "&&", or: "||",
};
const LIBM: Partial<Record<Op, string>> = { sqrt: "sqrt", abs: "fabs", floor: "floor" };
const FDLIBM: Partial<Record<Op, string>> = {
  sin: "lab_fdlibm_sin", cos: "lab_fdlibm_cos", tan: "lab_fdlibm_tan", exp: "lab_fdlibm_exp", log: "lab_fdlibm_log", pow: "lab_fdlibm_pow", atan2: "lab_fdlibm_atan2",
};
const PRINTED = new Set<SExpr["k"]>(["num", "bool", "local", "let", "if", "op", "call", "make", "get", "budget", "new", "field", "tag", "case"]);

// The runtime of counted cells.
const CELLS = `typedef struct lab_cell { uint32_t rc; uint16_t type, tag; } lab_cell;
static int64_t lab_live = 0;
static lab_cell **lab_dead = 0;
static size_t lab_dead_n = 0, lab_dead_cap = 0;
static void lab_oom(void) { fputs("out of memory\\n", stderr); exit(3); }
static void *lab_new(size_t size, uint16_t type, uint16_t tag) {
  lab_cell *c = malloc(size);
  if (!c) lab_oom();
  c->rc = 1; c->type = type; c->tag = tag;
  lab_live++;
  return c;
}
static inline lab_cell *lab_dup(lab_cell *c) { if (c->rc) c->rc++; return c; }
// One count fewer; a cell that has none left waits on lab_dead.
static inline void lab_dec(lab_cell *c) {
  if (c->rc && --c->rc == 0) {
    if (lab_dead_n == lab_dead_cap) { lab_dead_cap = lab_dead_cap ? 2 * lab_dead_cap : 64; lab_dead = realloc(lab_dead, lab_dead_cap * sizeof *lab_dead); if (!lab_dead) lab_oom(); }
    lab_dead[lab_dead_n++] = c;
  }
}
static void lab_fields(lab_cell *c);
static void lab_drop(lab_cell *c) {
  if (!c->rc || --c->rc) return;
  size_t base = lab_dead_n;
  lab_fields(c);
  free(c); lab_live--;
  while (lab_dead_n > base) { lab_cell *d = lab_dead[--lab_dead_n]; lab_fields(d); free(d); lab_live--; }
}`;

export interface CProgram { c: string; names: Map<number, string>; refused: Map<number, string> }

// `harness`: a main that reads calls from standard input, one a line (the
// function's index, then its inputs), and prints each answer the same way,
// then how many cells are left: how the tests compare with the evaluator.
// A Number is its bits in hex, a Bool 0 or 1, a record its fields, data
// its case's number then its fields.
export function emitC(lowered: Lowered, opts: { harness?: boolean } = {}): CProgram {
  const { funcs } = lowered;
  const used = new Set<string>();
  const ident = (hint: string) => {
    const base = hint.normalize("NFKD").replace(/[^A-Za-z0-9_]+/g, "_").replace(/^_+|_+$/g, "") || "f";
    let n = base;
    for (let i = 2; used.has(n); i++) n = `${base}_${i}`;
    used.add(n);
    return n;
  };

  // What can be printed: the kinds above, on Numbers, Bools, records and
  // data, calling only what can be printed.
  const refused = new Map<number, string>();
  const why = (t: LType): string | null =>
    t === "f64" || t === "i32" ? null
    : t === "int" || t === "text" ? `${t === "int" ? "Int" : "Text"} in C comes with NATIVE.md's stage N4`
    : isRecord(t) ? t.fields.map((x) => why(x.t)).find(Boolean) ?? null
    : isData(t) ? null
    : "functions as values in C come with NATIVE.md's stage N3";
  funcs.forEach((f, i) => {
    if (f.partial || f.multi) return refused.set(i, "a function with one answer or none, or several, in C comes with NATIVE.md's stage N3");
    const t = [...f.locals, f.result].map(why).find(Boolean);
    if (t) return refused.set(i, t);
    const k = walk(f.body).find((e) => !PRINTED.has(e.k));
    if (k) refused.set(i, `${k.k} in C comes with NATIVE.md's later stages`);
  });
  for (let changed = true; changed;) {
    changed = false;
    funcs.forEach((f, i) => {
      if (refused.has(i)) return;
      const c = walk(f.body).find((e) => e.k === "call" && refused.has(e.fn)) as Extract<SExpr, { k: "call" }> | undefined;
      if (c) { refused.set(i, `it calls ${funcs[c.fn].name}, which isn't in C yet`); changed = true; }
    });
  }
  const kept = funcs.map((_, i) => i).filter((i) => !refused.has(i));

  // Types: every record and data type the kept functions mention.
  const records = new Map<string, RType>(), data = new Map<string, DType>();
  const collect = (t: LType) => {
    if (isRecord(t) && !records.has(t.key)) { records.set(t.key, t); t.fields.forEach((x) => collect(x.t)); }
    if (isData(t) && !data.has(t.key)) { data.set(t.key, t); t.cases.forEach((c) => c.fields.forEach((x) => collect(x.t))); }
  };
  for (const i of kept) {
    [...funcs[i].params, ...funcs[i].locals, funcs[i].result].forEach(collect);
    walk(funcs[i].body).forEach((e) => { if ("t" in e && typeof e.t === "object") collect(e.t as LType); });
  }
  const sname = new Map([...records.values()].map((r) => [r.key, ident(r.name)]));
  const dnum = new Map([...data.keys()].map((k, j) => [k, j]));
  const dname = new Map([...data.values()].map((d) => [d.key, ident(d.name)]));
  const cname = (t: DType, c: number) => `${dname.get(t.key)}_${t.cases[c].name.replace(/[^A-Za-z0-9_]/g, "_")}`;
  const names = new Map(kept.map((i) => [i, `lab_${ident(funcs[i].name)}`]));

  const ty = (t: LType): string => (t === "f64" ? "double" : t === "i32" ? "int32_t" : isRecord(t) ? sname.get(t.key)! : "lab_cell *");
  // Whether a value of t holds counts.
  const counted = (t: LType): boolean => isData(t) || (isRecord(t) && t.fields.some((x) => counted(x.t)));
  const dup = (t: LType, x: string) => (isData(t) ? `lab_dup(${x})` : isRecord(t) && counted(t) ? `${sname.get(t.key)}_dup(${x})` : x);
  const drop = (t: LType, x: string) => (isData(t) ? `lab_drop(${x});` : `${sname.get((t as RType).key)}_drop(${x});`);

  const header = (i: number) => {
    const f = funcs[i];
    return `${ty(f.result)} ${names.get(i)}(${f.params.map((t, j) => `${ty(t)} p${j}`).join(", ") || "void"})`;
  };
  const math = kept.some((i) => walk(funcs[i].body).some((e) => e.k === "op" && e.op in FDLIBM));
  const text = kept.map((i) => func(funcs[i], i));
  const cells = data.size > 0;

  const types: string[] = [];
  for (const r of records.values()) {
    const n = sname.get(r.key)!;
    types.push(`typedef struct { ${r.fields.map((x, j) => `${ty(x.t)} f${j};`).join(" ")} } ${n}; // ${r.name}: ${r.fields.map((x) => x.name).join(", ")}`);
  }
  for (const d of data.values()) {
    d.cases.forEach((c, j) => {
      const n = cname(d, j);
      types.push(c.fields.length
        ? `typedef struct { lab_cell h; ${c.fields.map((x, k) => `${ty(x.t)} f${k};`).join(" ")} } ${n}; // ${d.name} ${c.name}: ${c.fields.map((x) => x.name).join(", ")}`
        : `static lab_cell ${n} = { 0, ${dnum.get(d.key)}, ${j} }; // ${d.name} ${c.name}`);
    });
  }
  // Dup and drop for records that hold counts, and each data type's
  // fields given up when its cell goes.
  const counts: string[] = [];
  for (const r of records.values()) {
    if (!counted(r)) continue;
    const n = sname.get(r.key)!;
    const parts = r.fields.map((x, j) => ({ t: x.t, at: `r.f${j}` })).filter((x) => counted(x.t));
    counts.push(
      `static inline ${n} ${n}_dup(${n} r) { ${parts.map((x) => `${dup(x.t, x.at)};`).join(" ")} return r; }`,
      `static inline void ${n}_drop(${n} r) { ${parts.map((x) => drop(x.t, x.at)).join(" ")} }`,
      `static inline void ${n}_dec(${n} r) { ${parts.map((x) => dec(x.t, x.at)).join(" ")} }`,
    );
  }
  for (const d of data.values()) {
    const arms = d.cases.map((c, j) => {
      const ks = c.fields.map((x, k) => ({ t: x.t, at: `((${cname(d, j)} *)c)->f${k}` })).filter((x) => counted(x.t));
      return ks.length ? `case ${j}: ${ks.map((x) => dec(x.t, x.at)).join(" ")} break;` : "";
    }).filter(Boolean);
    counts.push(`static void ${dname.get(d.key)}_fields(lab_cell *c) {${arms.length ? ` switch (c->tag) { ${arms.join(" ")} }` : " (void)c;"} }`);
  }
  function dec(t: LType, x: string): string {
    return isData(t) ? `lab_dec(${x});` : `${sname.get((t as RType).key)}_dec(${x});`;
  }

  const c = [
    "// Generated by compiler/src/c.ts from a typed program. Do not edit.",
    "// Build with -ffp-contract=off (and -msse2 -mfpmath=sse on 32-bit x86):",
    "// the numbers are then the evaluator's, bit for bit.",
    "#pragma STDC FP_CONTRACT OFF",
    "#include <stdint.h>",
    "#include <stdio.h>",
    "#include <stdlib.h>",
    "#include <math.h>",
    ...(math ? [FDLIBM_C] : []),
    ...(cells ? [CELLS] : []),
    "",
    ...types,
    ...counts,
    ...(cells ? [`static void lab_fields(lab_cell *c) { switch (c->type) { ${[...data.keys()].map((k, j) => `case ${j}: ${dname.get(k)}_fields(c); break;`).join(" ")} } }`] : []),
    ...(text.some((t) => t.includes("lab_fuel")) ? ["static double lab_fuel = 0;"] : []),
    ...(text.some((t) => t.includes("lab_mod(")) ? ["static double lab_mod(double a, double b) { return fmod(fmod(a, b) + b, b); }"] : []),
    "",
    ...kept.map((i) => `${header(i)};`),
    "",
    text.join("\n\n"),
    ...(opts.harness ? ["", harness()] : []),
    "",
  ].join("\n");
  return { c, names, refused };

  function func(f: SFunc, i: number): string {
    const loops = calls(f.body).some((x) => x.fn === i && x.tail);
    const local = (j: number) => (j < f.params.length ? `p${j}` : `l${j}`);
    let temps = 0;
    const decls: string[] = [];
    const temp = (t: LType) => { const n = `t${temps++}`; decls.push(`  ${ty(t)} ${n};`); return n; };
    // Every local is declared once at the top: a let in one branch of an
    // if is still one variable.
    f.locals.forEach((t, j) => { if (j >= f.params.length) decls.push(`  ${ty(t)} ${local(j)};`); });
    const isCounted = (j: number) => counted(f.locals[j]);
    // The counted locals e reads before setting them.
    const memo = new Map<SExpr, Set<number>>();
    const free = (e: SExpr): Set<number> => {
      let s = memo.get(e);
      if (s) return s;
      s = new Set<number>();
      if (e.k === "local") { if (isCounted(e.i)) s.add(e.i); }
      else if (e.k === "let") { free(e.value).forEach((x) => s!.add(x)); free(e.body).forEach((x) => x !== e.i && s!.add(x)); }
      else if (e.k === "case") { free(e.scrut).forEach((x) => s!.add(x)); e.arms.forEach((a) => a && free(a).forEach((x) => x !== e.s && s!.add(x))); }
      else kids(e).forEach((k) => free(k).forEach((x) => s!.add(x)));
      memo.set(e, s);
      return s;
    };
    const union = (...xs: Set<number>[]) => new Set(xs.flatMap((x) => [...x]));
    // Drops for the locals live here that `rest` and `after` don't use.
    const drops = (live: Set<number>, rest: Set<number>, after: Set<number>, d: string) =>
      [...live].filter((j) => !rest.has(j) && !after.has(j)).map((j) => `${d}${drop(f.locals[j], local(j))}`);

    // The arguments of a call or a constructor, left to right: one whose
    // code needs statements first puts the ones before it in locals, so
    // they are read before those statements run (they may drop a cell).
    function args(es: SExpr[], pre: string[], d: string, after: Set<number>): string[] {
      const out: string[] = [];
      es.forEach((a, k) => {
        const later = union(after, ...es.slice(k + 1).map(free));
        const mine: string[] = [];
        const x = ex(a, mine, d, later);
        if (mine.length) {
          for (let j = 0; j < out.length; j++) if (!/^(\d[\w.+-]*|\(-?[\d.e+-]+\)|t\d+)$/.test(out[j])) { const t = temp(typeOf(es[j], f.locals)); pre.push(`${d}${t} = ${out[j]};`); out[j] = t; }
          pre.push(...mine);
        }
        out.push(x);
      });
      return out;
    }
    // A field of rec (data, or a record): rec is borrowed, the field
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

    // An expression, with the statements it needs first. `after`: the
    // counted locals used after it.
    function ex(e: SExpr, pre: string[], d: string, after: Set<number>): string {
      switch (e.k) {
        case "num": return num(e.v);
        case "bool": return e.v ? "1" : "0";
        case "local": return isCounted(e.i) && after.has(e.i) ? dup(f.locals[e.i], local(e.i)) : local(e.i);
        case "let": {
          const body = free(e.body);
          pre.push(`${d}${local(e.i)} = ${ex(e.value, pre, d, union(after, new Set([...body].filter((x) => x !== e.i))))};`);
          if (isCounted(e.i) && !body.has(e.i) && !after.has(e.i)) pre.push(`${d}${drop(f.locals[e.i], local(e.i))}`);
          return ex(e.body, pre, d, after);
        }
        case "if": case "case": {
          const t = temp(e.k === "if" ? e.t : e.result);
          pre.push(...block(e, { set: t }, d, after));
          return t;
        }
        case "make": return `((${ty(e.t)}){ ${args(e.args, pre, d, after).join(", ")} })`;
        case "get": return borrow(e.rec, e.t.fields[e.i].t, (r) => `${r}.f${e.i}`, pre, d, after);
        case "new": {
          const c = e.t.cases[e.c];
          if (!c.fields.length) return `(&${cname(e.t, e.c)})`;
          const xs = args(e.args, pre, d, after);
          const v = temp(e.t), n = cname(e.t, e.c);
          pre.push(`${d}${v} = lab_new(sizeof(${n}), ${dnum.get(e.t.key)}, ${e.c});`, ...xs.map((x, k) => `${d}((${n} *)${v})->f${k} = ${x};`));
          return v;
        }
        case "field": return borrow(e.rec, e.t.cases[e.c].fields[e.i].t, (r) => `((${cname(e.t, e.c)} *)${r})->f${e.i}`, pre, d, after);
        case "tag": return borrow(e.rec, "i32", (r) => `(int32_t)${r}->tag`, pre, d, after);
        case "call": return `${names.get(e.fn)}(${args(e.args, pre, d, after).join(", ")})`;
        case "budget": {
          const s = temp("f64"), t = temp(e.t);
          pre.push(`${d}${s} = lab_fuel;`, `${d}lab_fuel = ${num(e.n)};`, ...block(e.body, { set: t }, d, union(after, free(e.otherwise))));
          pre.push(`${d}if (lab_fuel < 0) {`, ...block(e.otherwise, { set: t }, d + "  ", after), `${d}} else {`, ...drops(free(e.otherwise), new Set(), after, d + "  "), `${d}}`, `${d}lab_fuel = ${s};`);
          return t;
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
        default: throw new Error(`${e.k} in C comes with NATIVE.md's later stages`);
      }
    }

    // Statements that end by returning e's value, or setting a variable to it.
    function block(e: SExpr, to: { set: string } | "return", d: string, after: Set<number>): string[] {
      const out: string[] = [];
      if (e.k === "let") {
        const body = free(e.body);
        out.push(`${d}${local(e.i)} = ${ex(e.value, out, d, union(after, new Set([...body].filter((x) => x !== e.i))))};`);
        if (isCounted(e.i) && !body.has(e.i) && !after.has(e.i)) out.push(`${d}${drop(f.locals[e.i], local(e.i))}`);
        return [...out, ...block(e.body, to, d, after)];
      }
      if (e.k === "if") {
        const live = union(after, free(e.then), free(e.else));
        const c = ex(e.cond, out, d, live);
        return [
          ...out, `${d}if (${c}) {`, ...drops(live, free(e.then), after, d + "  "), ...block(e.then, to, d + "  ", after),
          `${d}} else {`, ...drops(live, free(e.else), after, d + "  "), ...block(e.else, to, d + "  ", after), `${d}}`,
        ];
      }
      if (e.k === "case") {
        const arms = e.arms.map((a) => (a ? free(a) : new Set<number>()));
        const live = union(after, ...arms);
        const s = ex(e.scrut, out, d, new Set([...live].filter((x) => x !== e.s)));
        if (s !== local(e.s)) out.push(`${d}${local(e.s)} = ${s};`);
        const inLive = union(live, isCounted(e.s) ? new Set([e.s]) : new Set());
        out.push(`${d}switch (${local(e.s)}->tag) {`);
        e.arms.forEach((a, j) => {
          if (!a) return;
          out.push(`${d}case ${j}: { // ${e.t.cases[j].name}`, ...drops(inLive, arms[j], after, d + "  "), ...block(a, to, d + "  ", after), ...(to === "return" ? [] : [`${d}  break;`]), `${d}}`);
        });
        out.push(`${d}default: abort();`, `${d}}`);
        return out;
      }
      if (to === "return" && e.k === "call" && e.fn === i && e.tail) {
        // The loop's next round: every new value computed before any is set.
        const xs = args(e.args, out, d, after);
        const ts = xs.map((x, j) => (x === `p${j}` ? null : { t: temp(f.params[j]), x, j }));
        for (const t of ts) if (t) out.push(`${d}${t.t} = ${t.x};`);
        for (const t of ts) if (t) out.push(`${d}p${t.j} = ${t.t};`);
        return [...out, `${d}continue;`];
      }
      const x = ex(e, out, d, after);
      return [...out, to === "return" ? `${d}return ${x};` : `${d}${to.set} = ${x};`];
    }

    // One from the budget per call, and per round of the loop.
    const spend = (d: string) => (f.spends ? [`${d}lab_fuel -= 1;`, `${d}if (lab_fuel < 0) return ${zero(f.result)};`] : []);
    // Inputs the body never reads are dropped as it starts.
    const unread = (d: string) => f.params.map((t, j) => (counted(t) && !free(f.body).has(j) ? `${d}${drop(t, `p${j}`)}` : "")).filter(Boolean);
    const body = loops
      ? ["  for (;;) {", ...unread("    "), ...spend("    "), ...block(f.body, "return", "    ", new Set()), "  }"]
      : [...unread("  "), ...spend("  "), ...block(f.body, "return", "  ", new Set())];
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
      case "make": return e.t;
      case "call": return funcs[e.fn].result;
      case "let": return typeOf(e.body, locals);
      case "if": case "budget": return e.t;
      case "case": return e.result;
      default: return "f64";
    }
  }

  // What a function that ran out gives, which the budget around it replaces.
  function zero(t: LType): string {
    return t === "f64" || t === "i32" ? "0" : `((${ty(t)}){ ${(t as RType).fields.map((x) => zero(x.t)).join(", ")} })`;
  }

  function harness(): string {
    // A reader and a printer for each type an input or an answer has.
    const io: string[] = [];
    const done = new Set<string>();
    const rd = (t: LType): string => {
      if (t === "f64") return "lab_in()";
      if (t === "i32") return "(int32_t)lab_bits()";
      const key = (t as RType | DType).key;
      if (!done.has(key)) {
        done.add(key);
        if (isRecord(t)) {
          const n = sname.get(t.key)!;
          io.push(`static ${n} lab_read_${n}(void) { ${n} r; ${t.fields.map((x, j) => `r.f${j} = ${rd(x.t)};`).join(" ")} return r; }`,
            `static void lab_print_${n}(${n} r) { ${t.fields.map((x, j) => `${pr(x.t, `r.f${j}`)}`).join(" ")} }`);
        } else {
          const d = t as DType, n = dname.get(d.key)!;
          // Along the last field while it is the same type, with a loop.
          const self = (j: number) => d.cases[j].fields.length > 0 && d.cases[j].fields.at(-1)!.t === d;
          const reads = d.cases.map((c, j) => {
            if (!c.fields.length) return `case ${j}: *at = &${cname(d, j)}; return top;`;
            const fs = c.fields.map((x, k) => (self(j) && k === c.fields.length - 1 ? "" : `((${cname(d, j)} *)v)->f${k} = ${rd(x.t)};`)).join(" ");
            return `case ${j}: { lab_cell *v = lab_new(sizeof(${cname(d, j)}), ${dnum.get(d.key)}, ${j}); ${fs} *at = v; ${self(j) ? `at = &((${cname(d, j)} *)v)->f${c.fields.length - 1}; break;` : "return top;"} }`;
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
      rd(t);
      return `lab_print_${isRecord(t) ? sname.get(t.key) : dname.get((t as DType).key)}(${v});`;
    }
    const cases = kept.map((i) => {
      const f = funcs[i];
      if (f.inner) return "";
      // Read in order: C doesn't say in which order a call's arguments run.
      const ins = f.params.map((t, j) => `${ty(t)} a${j} = ${rd(t)};`);
      const after = counted(f.result) ? drop(f.result, "r") : "";
      return `    case ${i}: { ${ins.join(" ")} ${ty(f.result)} r = ${names.get(i)}(${f.params.map((_, j) => `a${j}`).join(", ")}); ${pr(f.result, "r")} ${after} break; }`;
    }).filter(Boolean);
    // Prototypes first: a reader may use one made after it.
    const protos = io.map((x) => `${x.slice(0, x.indexOf("{")).trim()};`);
    return `#include <string.h>
static uint64_t lab_bits(void) { unsigned long long u = 0; if (scanf("%llx", &u) != 1) return 0; return u; }
static double lab_in(void) { uint64_t u = lab_bits(); double d; memcpy(&d, &u, 8); return d; }
static void lab_out(double d) { uint64_t u; memcpy(&u, &d, 8); printf(" %016llx", (unsigned long long)u); }
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
