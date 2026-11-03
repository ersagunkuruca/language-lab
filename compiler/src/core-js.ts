// JavaScript printed from the core IR (C137c, docs/design/targets/CORE-IR.md):
// the printer that is to replace compile.ts, which lowers the model a
// second way. Grown in steps, checked by the fuzz test (C101) against the
// evaluator; this first step takes the `data` profile's values and
// control, with Int, Text and Array through the evaluator's own builtins.
//
// Values: a Float64 is a number, a Bool a boolean, an Int the evaluator's
// (a number while small, else a bigint: int.ts), a Text a string, a record
// an array of its fields, a data type's value an array of its case's number
// then its fields, a closure an array of its code then what it captured,
// an Array the evaluator's. No answer (Choice) is the exception `FAIL`,
// caught by the nearest attempt; an abort is an `Aborted`, caught by its
// handler; a budget running out is `OUT`. A runtime function or world
// operation this printer doesn't have yet throws `Unsupported` when it is
// reached, so a program runs as far as it can. Tables and Hash sets are
// the evaluator's (C137c2), Random seeded is random.ts's generator, and
// the world is the evaluator's Runtime (C137c3, runCoreMain).

import { ARRAY_OPS, CONS, HASH_SET_OPS, NIL, NONE, S, SOME, STD_IMPL, STD_MANY, TABLE_OPS, TRUE } from "../../ters/src/lang/std.ts";
import { fromList, toList, type Runtime, type Value, type World } from "../../ters/src/lang/run.ts";
import * as I from "../../ters/src/lang/int.ts";
import * as T from "../../ters/src/lang/text.ts";
import type { Id } from "../../ters/src/model.ts";
import { ARRAY_RT, RT, isData, isRecord, type CoreIR, type LType, type Op, type RType, type SExpr, type SFunc, type TType } from "./scalar.ts";
import { runtime } from "./wasm-rt.ts";
import { STOPS } from "./stops.ts";

export class Unsupported extends Error {}
export class Stopped extends Error {}
export class Aborted { reason: unknown; esc: number; constructor(reason: unknown, esc: number) { this.reason = reason; this.esc = esc; } }
export const FAIL = { fail: true }, OUT = { out: true };

const INFIX: Partial<Record<Op, string>> = { add: "+", sub: "-", mul: "*", div: "/", less: "<", equal: "===", beq: "===", and: "&&", or: "||" };
const MATH: Partial<Record<Op, string>> = { sqrt: "sqrt", abs: "abs", floor: "floor", float32: "fround", sin: "sin", cos: "cos", tan: "tan", exp: "exp", log: "log", pow: "pow", atan2: "atan2" };

// The runtime functions by name: the evaluator's builtin where there is
// one (scalar.ts RT and ARRAY_RT, read backwards), with lists and Bools
// turned between the two forms; the rest written here.
const BUILTIN = new Map<string, Id>([...Object.entries(RT), ...Object.entries(ARRAY_RT), [ARRAY_OPS.replaceAt, "array.replaceAt"]].map(([id, n]) => [n, id]));
const big = (x: I.Int) => BigInt(x);
const listIn = (l: unknown): Value => { const xs: unknown[] = []; let p = l as unknown[]; while (p[0] === 1) { xs.push(p[1]); p = p[2] as unknown[]; } return toList(xs as Value[]); };
const listOut = (v: Value): unknown[] => fromList(v).reduceRight<unknown[]>((tail, x) => [1, x, tail], [0]);
const OWN: Record<string, (...xs: never[]) => unknown> = {
  "int.equal": (a: I.Int, b: I.Int) => a === b,
  "int.less": (a: I.Int, b: I.Int) => a < b,
  "text.equal": (a: string, b: string) => a === b,
  "text.less": (a: string, b: string) => T.less(a, b),
  "text.quoted": (t: string) => JSON.stringify(t),
  "int.exact": (a: I.Int, b: I.Int) => I.norm(big(a) / big(b)),
  "int.gcd": (a: I.Int, b: I.Int) => { let x = big(a) < 0n ? -big(a) : big(a), y = big(b) < 0n ? -big(b) : big(b); while (y) [x, y] = [y, x % y]; return I.norm(x); },
  // run.ts's, which the evaluator has outside std.ts.
  "number.range": (n: number) => Array.from({ length: Math.max(0, n) }, (_, i) => i).reduceRight<unknown[]>((tail, x) => [1, x, tail], [0]),
  "text.size": (t: string) => Buffer.byteLength(t, "utf8"),
  "text.bytes": (t: string, a: number, b: number) => Buffer.from(t, "utf8").subarray(a, b).toString("utf8"),
  // Where the character that ends at byte i (> 0) starts.
  "text.before": (t: string, i: number) => { const b = Buffer.from(t, "utf8"); do i--; while (i > 0 && (b[i] & 0xc0) === 0x80); return i; },
};
// A Table or Hash set (C63h, C63i) is the evaluator's (std.ts Table: a
// Map with Baker's versions), a record key given as the evaluator's
// record and taken back from its entries.
const TABLE = /^table\.(\w+)\.t(\d+)(?:\.e\d+)?$/;
const keyIn = (t: TType["keyT"]) => (typeof t === "object" ? (k: unknown): unknown => recordIn(t, k) : (k: unknown) => k);
const recordIn = (t: RType, k: unknown): unknown => ({ tag: t.variant, fields: t.fields.map((f, i) => (typeof f.t === "object" && isRecord(f.t) ? recordIn(f.t, (k as unknown[])[i]) : (k as unknown[])[i])) });
const recordOut = (k: unknown): unknown => (typeof k === "object" && k !== null && "fields" in k ? (k as { fields: unknown[] }).fields.map(recordOut) : k);
function tableFn(op: string, t: TType): (...xs: unknown[]) => unknown {
  const key = keyIn(t.keyT), bool = (v: unknown) => (v as { tag: Id }).tag === TRUE;
  const impl = (id: Id) => STD_IMPL[id] as (...xs: unknown[]) => unknown;
  switch (op) {
    case "empty": return () => impl(TABLE_OPS.empty)();
    case "put": return (m, k, v) => impl(TABLE_OPS.put)(m, key(k), v);
    case "remove": return (m, k) => impl(TABLE_OPS.remove)(m, key(k));
    case "has": return (m, k) => bool(impl(TABLE_OPS.has)(m, key(k)));
    case "size": return (m) => impl(TABLE_OPS.size)(m);
    case "at": return (m, k) => { const r = STD_MANY[TABLE_OPS.at](m, key(k)); if (!r.length) throw FAIL; return r[0]; };
    case "entries": return t.set
      ? (m) => fromList(impl(HASH_SET_OPS.items)(m) as Value).reduceRight<unknown[]>((tail, x) => [1, recordOut(x), tail], [0])
      : (m) => fromList(impl(TABLE_OPS.entries)(m) as Value).reduceRight<unknown[]>((tail, x) => { const [k, v] = (x as unknown as { fields: unknown[] }).fields; return [1, [recordOut(k), v], tail]; }, [0]);
  }
  return () => { throw new Unsupported(`table.${op}`); };
}
// Random under seeded (C106): random.ts's xoshiro128** seeded by
// SplitMix32, its four words in r, as WebAssembly's globals $r0 to $r3.
function randFns(r: Uint32Array): Record<string, (...xs: never[]) => unknown> {
  const rotl = (x: number, k: number) => (x << k) | (x >>> (32 - k));
  const mix = (z: number) => { let x = z; x = Math.imul(x ^ (x >>> 16), 0x85ebca6b); x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35); return (x ^ (x >>> 16)) >>> 0; };
  const word = () => {
    const [a, b] = [r[0], r[1]], out = Math.imul(rotl(Math.imul(b, 5), 7), 9) >>> 0, t = b << 9;
    r[2] ^= a; r[3] ^= b; r[1] ^= r[2]; r[0] ^= r[3]; r[2] ^= t; r[3] = rotl(r[3], 11);
    return out;
  };
  return {
    "rand.seed": (seed: number) => { let z = Math.floor(seed) >>> 0; for (let i = 0; i < 4; i++) { z = (z + 0x9e3779b9) >>> 0; r[i] = mix(z); } return 0; },
    "rand.next": () => ((word() >>> 5) * 67108864 + (word() >>> 6)) / 9007199254740992,
    "rand.s0": () => r[0], "rand.s1": () => r[1], "rand.s2": () => r[2], "rand.s3": () => r[3],
    "rand.unset": () => !(r[0] | r[1] | r[2] | r[3]),
    "rand.restore": (a: number, b: number, c: number, d: number) => { r.set([a, b, c, d]); return 0; },
  };
}
function rtFn(name: string, ir?: CoreIR, rand?: Record<string, (...xs: never[]) => unknown>): (...xs: unknown[]) => unknown {
  const tm = TABLE.exec(name);
  if (tm && ir) return tableFn(tm[1], ir.tables[Number(tm[2])]);
  if (rand?.[name]) return rand[name] as (...xs: unknown[]) => unknown;
  const base = name.replace(/\.a\d+$/, "");
  if (OWN[base]) return OWN[base] as (...xs: unknown[]) => unknown;
  const id = BUILTIN.get(base === "array.get" ? "array.at" : base);
  const one = id && STD_IMPL[id], many = id && STD_MANY[id];
  if (!one && !many) return () => { throw new Unsupported(name); };
  const meta = runtime(name);
  const ins = meta.params.map(([, t]) => (t === "list" ? listIn : (x: unknown) => x));
  const out = meta.result === "list" ? (v: unknown) => listOut(v as Value) : meta.result === "i32" ? (v: unknown) => (typeof v === "object" && v !== null && "tag" in v ? (v as { tag: Id }).tag === TRUE : v) : (v: unknown) => v;
  // array.get's place is an i32; array.at's an Int.
  const conv = base === "array.get" ? (xs: unknown[]) => [xs[0], I.norm(BigInt(xs[1] as number))] : (xs: unknown[]) => xs.map((x, j) => ins[j](x));
  if (one) return (...xs) => out(one(...conv(xs)));
  return (...xs) => { const r = many!(...conv(xs)); if (!r.length) throw FAIL; return out(r[0]); };
}

export const RUNTIME = {
  FAIL, OUT, Aborted, Unsupported, rt: rtFn,
  fail: (): never => { throw FAIL; },
  stop: (i: number): never => { throw new Stopped(STOPS[i]); },
  mod: (a: number, b: number) => ((a % b) + b) % b,
  unsupported: (what: string): never => { throw new Unsupported(what); },
  int: (s: string) => I.norm(BigInt(s)),
  show: STD_IMPL[S.show],
};

// The source of a function of the runtime giving every function, by name.
// `worlds`: the world's operations it calls, with their results' types,
// which the loader gives as R.worlds in that order.
export function emitCoreJs(ir: CoreIR): { js: string; names: string[]; worlds: [string, LType][] } {
  const names = ir.funcs.map((_, i) => `f${i}`);
  const rts = new Map<string, string>();
  const rtName = (n: string) => { if (!rts.has(n)) rts.set(n, `rt${rts.size}`); return rts.get(n)!; };
  const worlds: [string, LType][] = [];
  const worldName = (op: string, t: LType) => { let i = worlds.findIndex(([o]) => o === op); if (i < 0) i = worlds.push([op, t]) - 1; return `w${i}`; };
  const text = ir.funcs.map((f, i) => func(f, i));
  const js = [
    "let fuel = Infinity;",
    ...[...rts].map(([n, v]) => `const ${v} = R.rt(${JSON.stringify(n)});`),
    ...worlds.map((_, i) => `const w${i} = R.worlds[${i}];`),
    ...text,
    `return { ${names.join(", ")} };`,
  ].join("\n");
  return { js, names, worlds };

  function func(f: SFunc, i: number): string {
    let temps = 0;
    const temp = () => `t${temps++}`;
    const local = (j: number) => `l${j}`;
    const self = (e: SExpr): boolean => (e.k === "call" && e.fn === i && e.tail) || kidsOf(e).some(self);
    const loops = self(f.body);

    // An expression, with the statements it needs first.
    function ex(e: SExpr, pre: string[], d: string): string {
      switch (e.k) {
        case "num": return Object.is(e.v, -0) ? "(-0)" : e.v < 0 ? `(${e.v})` : Number.isFinite(e.v) ? String(e.v) : e.v > 0 ? "Infinity" : e.v < 0 ? "(-Infinity)" : "NaN";
        case "int": { const v = I.norm(e.v); return typeof v === "bigint" ? `(${v}n)` : `(${v})`; }
        case "text": return JSON.stringify(e.v);
        case "bool": return String(e.v);
        case "local": return local(e.i);
        case "zero": if (e.none) return "R.fail()"; return zero(e.t);
        case "op": {
          const xs = e.args.map((a) => ex(a, pre, d));
          if (INFIX[e.op]) return `(${xs[0]} ${INFIX[e.op]} ${xs[1]})`;
          if (e.op === "neg") return `(-${xs[0]})`;
          if (e.op === "not") return `(!${xs[0]})`;
          if (e.op === "mod") return `R.mod(${xs.join(", ")})`;
          if (e.op === "stop") return `R.stop(${xs[0]})`;
          if (MATH[e.op]) return `Math.${MATH[e.op]}(${xs.join(", ")})`;
          return `R.unsupported(${JSON.stringify(`op ${e.op}`)})`;
        }
        case "let": pre.push(`${d}${local(e.i)} = ${ex(e.value, pre, d)};`); return ex(e.body, pre, d);
        case "if": {
          const c = ex(e.cond, pre, d), t = temp();
          pre.push(`${d}let ${t};`, `${d}if (${c}) {`, ...block(e.then, { set: t }, d + "  "), `${d}} else {`, ...block(e.else, { set: t }, d + "  "), `${d}}`);
          return t;
        }
        case "call": {
          // Its inputs computed first: a call's own statements must not
          // come between them.
          const xs = e.args.map((a) => ex(a, pre, d));
          return `${names[e.fn]}(${xs.join(", ")})`;
        }
        case "make": return `[${e.args.map((a) => ex(a, pre, d)).join(", ")}]`;
        case "get": return `${ex(e.rec, pre, d)}[${e.i}]`;
        case "new": return `[${[String(e.c), ...e.args.map((a) => ex(a, pre, d))].join(", ")}]`;
        case "field": return `${ex(e.rec, pre, d)}[${e.i + 1}]`;
        case "tag": return `${ex(e.rec, pre, d)}[0]`;
        case "closure": return `[${[names[e.fn], ...e.caps.map((a) => ex(a, pre, d))].join(", ")}]`;
        case "cap": return `l0[${e.i + 1}]`;
        case "apply": {
          const c = ex(e.fn, pre, d), xs = e.args.map((a) => ex(a, pre, d));
          pre.push(`${d}${local(e.tmp)} = ${c};`);
          return `${local(e.tmp)}[0](${[local(e.tmp), ...xs].join(", ")})`;
        }
        case "case": {
          pre.push(`${d}${local(e.s)} = ${ex(e.scrut, pre, d)};`);
          const t = temp();
          pre.push(`${d}let ${t};`, `${d}switch (${local(e.s)}[0]) {`);
          e.arms.forEach((a, c) => { if (a) pre.push(`${d}  case ${c}: {`, ...block(a, { set: t }, d + "    "), `${d}    break;`, `${d}  }`); });
          pre.push(`${d}}`);
          return t;
        }
        case "rt": {
          const xs = e.args.map((a) => ex(a, pre, d));
          return `${rtName(e.fn)}(${xs.join(", ")})`;
        }
        case "world": { const xs = e.args.map((a) => ex(a, pre, d)); return `${worldName(e.op, e.t)}(${xs.join(", ")})`; }
        case "fail": return "R.fail()";
        case "attempt": {
          const ok = temp(), t = temp();
          pre.push(`${d}let ${ok} = true;`, `${d}try {`, ...block(e.body, { set: local(e.res) }, d + "  "), `${d}} catch (x) {`, `${d}  if (x !== R.FAIL) throw x;`, `${d}  ${ok} = false;`, `${d}}`);
          pre.push(`${d}let ${t};`, `${d}if (${ok}) {`, ...block(e.ok, { set: t }, d + "  "), `${d}} else {`, ...block(e.otherwise, { set: t }, d + "  "), `${d}}`);
          return t;
        }
        case "budget": {
          const s = temp(), out = temp(), t = temp();
          pre.push(`${d}const ${s} = fuel;`, `${d}fuel = ${e.n};`, `${d}let ${t}, ${out} = false;`, `${d}try {`, ...block(e.body, { set: t }, d + "  "), `${d}} catch (x) {`, `${d}  if (x !== R.OUT) { fuel = ${s}; throw x; }`, `${d}  ${out} = true;`, `${d}}`, `${d}fuel = ${s};`);
          pre.push(`${d}if (${out}) {`, ...block(e.otherwise, { set: t }, d + "  "), `${d}}`);
          return t;
        }
        case "abort": return `R.abort(${ex(e.reason, pre, d)}, ${e.esc ?? 0})`;
        case "handle": {
          const t = temp();
          pre.push(`${d}let ${t};`, `${d}try {`, ...block(e.body, { set: t }, d + "  "), `${d}} catch (x) {`, `${d}  if (!(x instanceof R.Aborted) || x.esc !== ${e.esc ?? 0}) throw x;`, `${d}  ${local(e.reason)} = x.reason;`, ...block(e.arm, { set: t }, d + "  "), `${d}}`);
          return t;
        }
        case "set": { const r = ex(e.rec, pre, d); pre.push(`${d}${r}[${e.i}] = ${ex(e.value, pre, d)};`); return ex(e.then, pre, d); }
        case "choose": case "search": throw new Error(`${e.k} is gone after lowering`);
      }
    }

    // Statements that end by returning e's value, or setting a variable to it.
    function block(e: SExpr, to: { set: string } | "return", d: string): string[] {
      const out: string[] = [];
      if (e.k === "let") {
        out.push(`${d}${local(e.i)} = ${ex(e.value, out, d)};`);
        return [...out, ...block(e.body, to, d)];
      }
      if (e.k === "if") {
        const c = ex(e.cond, out, d);
        return [...out, `${d}if (${c}) {`, ...block(e.then, to, d + "  "), `${d}} else {`, ...block(e.else, to, d + "  "), `${d}}`];
      }
      if (to === "return" && e.k === "call" && e.fn === i && e.tail) {
        // The loop's next round: every new value computed before any is set.
        const xs = e.args.map((a) => ex(a, out, d)), ts = xs.map(() => temp());
        xs.forEach((x, j) => out.push(`${d}const ${ts[j]} = ${x};`));
        ts.forEach((t, j) => out.push(`${d}${local(j)} = ${t};`));
        return [...out, `${d}continue;`];
      }
      const x = ex(e, out, d);
      return [...out, to === "return" ? `${d}return ${x};` : `${d}${to.set} = ${x};`];
    }

    // One from the budget per call, and per round of the loop.
    const spend = (d: string) => (f.spends ? [`${d}if (--fuel < 0) throw R.OUT;`] : []);
    const params = f.params.map((_, j) => local(j)), locals = f.locals.map((_, j) => local(f.params.length + j));
    const body = loops ? ["  for (;;) {", ...spend("    "), ...block(f.body, "return", "    "), "  }"] : [...spend("  "), ...block(f.body, "return", "  ")];
    return [`// ${f.name.replace(/\n/g, " ")}`, `function ${names[i]}(${params.join(", ")}) {`, ...(locals.length ? [`  let ${locals.join(", ")};`] : []), ...body, "}"].join("\n");
  }
}

// What a variable starts as.
function zero(t: LType): string {
  if (t === "f64" || t === "int32") return "0";
  if (t === "i32") return "false";
  if (t === "int") return "0";
  if (t === "text") return '""';
  if (typeof t === "object" && isRecord(t)) return `[${t.fields.map((x) => zero(x.t)).join(", ")}]`;
  if (typeof t === "object" && isData(t)) return "null";
  return "null";
}

function kidsOf(e: SExpr): SExpr[] {
  switch (e.k) {
    case "op": case "call": case "make": case "new": case "rt": case "world": return e.args;
    case "if": return [e.cond, e.then, e.else];
    case "let": return [e.value, e.body];
    case "get": case "field": case "tag": return [e.rec];
    case "closure": return e.caps;
    case "apply": return [e.fn, ...e.args];
    case "case": return [e.scrut, ...e.arms.filter((a): a is SExpr => !!a)];
    case "budget": return [e.body, e.otherwise];
    case "attempt": return [e.body, e.ok, e.otherwise];
    case "abort": return [e.reason];
    case "handle": return [e.body, e.arm];
    case "set": return [e.rec, e.value, e.then];
    default: return [];
  }
}

// The world's operations (scalar.ts WORLD_OPS) over the evaluator's
// Runtime, as wasm.ts's worldOf: one that fails aborts with its reason.
function worldFn(op: string, t: LType, rt: Runtime): (...xs: unknown[]) => unknown {
  const w = <K extends keyof World>(k: K): World[K] => {
    const f = rt.world?.[k];
    if (!f) return (() => { throw new Error(`this runtime can't ${k === "error" ? "write to standard error" : k}`); }) as unknown as World[K];
    return f.bind(rt.world) as World[K];
  };
  const tried = <T>(f: () => T): T => { try { return f(); } catch (e) { if (e instanceof Aborted) throw e; throw new Aborted((e as Error).message, 0); } };
  const c = (v: Id) => (isData(t) ? t.cases.findIndex((x) => x.variant === v) : -1);
  switch (op) {
    case "randomSeed": return () => Math.floor(Math.random() * 4294967296);
    case "print": return (s) => { rt.print(s as string); return []; };
    case "printError": return (s) => { w("error")(s as string); return []; };
    case "readInput": return () => tried(() => w("input")());
    case "readLine": return () => tried(() => { const l = w("readLine")(); return l === null ? [c(NONE)] : [c(SOME), l]; });
    case "readFile": return (p) => tried(() => w("readFile")(p as string));
    case "writeFile": return (p, s) => tried(() => { w("writeFile")(p as string, s as string); return []; });
    case "appendFile": return (p, s) => tried(() => { w("appendFile")(p as string, s as string); return []; });
    case "fileExists": return (p) => w("fileExists")(p as string);
    case "listFolder": return (p) => tried(() => w("listFolder")(p as string).reduceRight<unknown[]>((tail, x) => [c(CONS), x, tail], [c(NIL)]));
  }
  return () => { throw new Unsupported(`world ${op}`); };
}

// The functions, by their place in ir.funcs. `rt`: the console and files.
export function loadCoreJs(ir: CoreIR, rt: Runtime = { print: () => {} }): ((...xs: unknown[]) => unknown)[] {
  const { js, names, worlds } = emitCoreJs(ir);
  const rand = randFns(new Uint32Array(4));
  const R = { ...RUNTIME, rt: (n: string) => rtFn(n, ir, rand), worlds: worlds.map(([op, t]) => worldFn(op, t, rt)), abort: (reason: unknown, esc: number): never => { throw new Aborted(reason, esc); } };
  const all = new Function("R", js)(R) as Record<string, (...xs: unknown[]) => unknown>;
  return names.map((n) => all[n]);
}

// Runs main as wasm.ts's runMain does: given the arguments as a List of
// Texts if it takes them; an abort or a stop nobody handles is written to
// standard error, and the exit code is 1.
export function runCoreMain(ir: CoreIR, name: string, args: string[], rt: Runtime): number {
  const fi = ir.funcs.findIndex((g) => g.name === name && !g.inner && !g.budgeted), f = ir.funcs[fi];
  if (!f || f.params.length > 1) throw new Error(`${name}: not compiled, or not a main`);
  const fn = loadCoreJs(ir, rt)[fi], err = rt.world?.error ?? rt.print;
  const list = (t: LType) => { if (!isData(t)) throw new Error("main takes a List of Texts"); const c = (v: Id) => t.cases.findIndex((x) => x.variant === v); return args.reduceRight<unknown[]>((tail, x) => [c(CONS), x, tail], [c(NIL)]); };
  let v: unknown;
  try { v = fn(...(f.params.length ? [list(f.params[0])] : [])); } catch (e) {
    if (e instanceof Aborted) { err(String(e.reason)); return 1; }
    if (e instanceof Stopped) { err(e.message); return 1; }
    if (e === FAIL) throw new Error(`${name} had no answer`);
    throw e;
  }
  return f.result === "f64" ? Number(v) : f.result === "int" ? Number(v) : 0;
}
