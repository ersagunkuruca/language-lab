// The scalar profile: the part of the language that needs no heap.
//
// A definition is in it when its inputs and result are Number or Bool, and
// its body uses only arithmetic, comparisons, `if`, lets, and calls to other
// definitions in the profile. No data, no closures, no Choice, no world
// effects, and nothing that might not finish. That's exactly what a GPU or
// plain WebAssembly can run without a garbage collector, so this one
// lowering feeds both: wasm.ts prints it as a WebAssembly module, and a
// shader backend would print it as WGSL (see projectional/COMPILER.md).
//
// With `records`, the profile also takes records of those: a data type
// with one case whose fields are Numbers, Bools or records again (a
// point, a colour, a ray). They need no heap either, since their size is
// known; a shader has them as structs (or vectors, wgsl.ts). A record is built by its case,
// read by its fields or by a match with one arm. WebAssembly has them as
// WasmGC structs (wasm.ts).
//
// With `data` (WebAssembly only, which has a garbage collector), the
// profile also takes data types with several cases and types that
// contain themselves: lists, expression trees, Optional. They're built by
// their cases, taken apart by a match or by their fields, and their values
// live on the heap (DType). Something that may not finish is allowed too,
// as in the JS backend, since a module that loops is a program that
// loops, not a hung GPU; a budget still counts the same way.
//
// The lowering is to a tiny expression tree with numbered locals. A
// definition outside the profile is refused with the reason, the way a
// type error is reported, so "can this run on the GPU / in WASM" is a
// question with an answer you can show in the editor.
//
// Diverge, like every other effect, has to be handled before it gets here.
// On a GPU a loop that never ends doesn't throw: it hangs the tab or
// resets the device. So a definition whose type says it might not finish
// is refused, unless it runs under a budget, the language's own handler
// for Diverge written the way a shader needs it:
//
//   first(() => with fuel(1000, () => trace(x, y, time)), () => fallback)
//
// `with fuel(n, …)` allows n calls to possibly-divergent definitions and
// then fails; `first` turns the failure into the fallback. The result has
// no Diverge in its type, and the lowering keeps the same count the
// evaluator keeps (one per call into a definition the checker couldn't
// see end, a loop's rounds included), so the GPU gives the evaluator's
// answer, fallback and all. n is a number written down, so the bound is
// known when the shader is built.

import { resolveArithmetic } from "../../projectional/src/lang/arith.ts";
import type { Code, Id, NodeOf } from "../../projectional/src/model.ts";
import type { Names } from "../../projectional/src/presentation.ts";
import type { Info } from "../../projectional/src/lang/infer.ts";
import { CHOICE, CONSOLE, DIVERGE, FILES, INT, NUMBER, STRING, type Row, type Type } from "../../projectional/src/lang/types.ts";
import { ABORT, ABORT_OP, BOOL, COMPARE, CONS, FALSE, INT_OPS, IO, NIL, NONE, ORDER_V, PAIR_V, RATIO, S, SOME, TEXT_OPS, TRUE } from "../../projectional/src/lang/std.ts";
import { fieldIndex } from "../../projectional/src/lang/records.ts";
import { expandDerivatives, recordVariant } from "../../projectional/src/lang/derive.ts";
import { infer } from "../../projectional/src/lang/infer.ts";
import { discharge } from "../../projectional/src/lang/ledger.ts";
import { scalarOp, TARGETS } from "./builtins.ts";
import { runtime } from "./wasm-rt.ts";

// A shader (or a ray marcher's loop) may call what might not finish only
// under a literal with fuel; the rest of its type must be empty.
// Builtins on Int and Text that are runtime functions (`data`).
const RT: Record<Id, string> = {
  [INT_OPS.add]: "int.add", [INT_OPS.sub]: "int.sub", [INT_OPS.mul]: "int.mul", [INT_OPS.neg]: "int.neg", [INT_OPS.abs]: "int.abs",
  [INT_OPS.less]: "int.less", [INT_OPS.show]: "int.show", [INT_OPS.toNumber]: "int.toNumber",
  [S.concat]: "text.concat", [S.show]: "number.show", [S.range]: "number.range", [INT_OPS.range]: "int.range",
  [TEXT_OPS.length]: "text.length", [TEXT_OPS.slice]: "text.slice", [TEXT_OPS.characters]: "text.characters",
  [TEXT_OPS.split]: "text.split", [TEXT_OPS.joinAll]: "text.joinAll", [TEXT_OPS.less]: "text.less",
  // No answer or one (Choice): runtime functions that give a status too.
  [INT_OPS.quotient]: "int.quotient", [INT_OPS.remainder]: "int.remainder", [INT_OPS.power]: "int.power",
  [INT_OPS.read]: "int.read", [INT_OPS.wholePart]: "int.wholePart",
  [TEXT_OPS.find]: "text.find", [TEXT_OPS.code]: "text.code", [TEXT_OPS.fromCode]: "text.fromCode",
};

// What a partial function (`data`) may do besides answer: have no answer,
// not finish (running out of a budget), or abort.
const PARTIAL: Id[] = [CHOICE, DIVERGE, ABORT];
// The world (`data`): the console and files, through the host's World
// (wasm.ts imports them). `aborts`: it can fail, with a reason.
export const WORLD_OPS: Record<Id, { op: string; aborts: boolean }> = {
  [S.print]: { op: "print", aborts: false }, [IO.printError]: { op: "printError", aborts: false },
  [IO.readInput]: { op: "readInput", aborts: true }, [IO.readLine]: { op: "readLine", aborts: true },
  [IO.readFile]: { op: "readFile", aborts: true }, [IO.writeFile]: { op: "writeFile", aborts: true }, [IO.appendFile]: { op: "appendFile", aborts: true },
  [IO.fileExists]: { op: "fileExists", aborts: false }, [IO.listFolder]: { op: "listFolder", aborts: true },
};
// Effects a function in WebAssembly may have: the partial ones and the world's.
const ALLOWED: Id[] = [...PARTIAL, CONSOLE, FILES];
const BUDGETED = discharge("a shader", [DIVERGE], "only under a literal with fuel, which gives each pixel a step budget");

export type SType = "f64" | "i32"; // Number, Bool (0 or 1)
// A record: a data type with one case, at particular type arguments.
// `mutable`: a box the lowering makes (W4d), whose one field a search sets.
export interface RType { key: string; name: string; def: Id; variant: Id; case?: string; fields: { name: string; t: LType }[]; mutable?: true }
// A data type with several cases, or one that contains itself (`data`).
// A case's fields are in the order written.
// `inner`: made by the lowering (a fold's stack), not the program's.
export interface DType { key: string; name: string; def: Id; cases: { variant: Id; name: string; fields: { name: string; t: LType }[] }[]; inner?: boolean }
// A function as a value (`data`): a closure, called through its code.
// `partial`: it may have no answer (Choice, or a budget running out), so
// its code gives a status after its answer, as a partial SFunc does.
export interface FType { key: string; params: LType[]; result: LType; partial?: boolean }
// What a generic definition's type variables stand for, and its effect
// rows (by their tail variable: the effects added).
type At = Map<number, Type | Row>;
// Int and Text (`data`): an i31 or a $big (W5), and UTF-8 bytes
// (wasm-rt.ts).
export type WType = "int" | "text";
export type LType = SType | WType | RType | DType | FType;
export const isData = (t: LType): t is DType => typeof t === "object" && "cases" in t;
export const isRecord = (t: LType): t is RType => typeof t === "object" && "variant" in t;
export const isFn = (t: LType): t is FType => typeof t === "object" && "result" in t;
// A closure's own struct: the function type it has and what it captured.
export interface Shape { t: FType; caps: LType[] }
// For a printer of a target without a heap (WGSL, the JS fallback for
// shaders), which is never given data.
export const noData = (e: SExpr): never => { throw new Error(`${e.k} needs a heap: lower without \`data\``); };
// Whether e can end with no answer or abort: it fails or aborts, or calls
// something partial.
export function fails(e: SExpr, funcs: SFunc[]): boolean {
  switch (e.k) {
    case "fail": case "abort": return true;
    case "world": return e.aborts || e.args.some((a) => fails(a, funcs));
    case "call": return !!funcs[e.fn]?.partial || e.args.some((a) => fails(a, funcs));
    case "rt": return !!runtime(e.fn).partial || e.args.some((a) => fails(a, funcs));
    case "apply": return !!e.t.partial || kids(e).some((a) => fails(a, funcs));
    // An abort goes on through first and budgets, so their bodies count.
    case "attempt": case "budget": return kids(e).some((a) => fails(a, funcs));
    default: return kids(e).some((a) => fails(a, funcs));
  }
}
// The expressions directly inside e.
export function kids(e: SExpr): SExpr[] {
  switch (e.k) {
    case "op": case "call": case "make": case "new": case "rt": case "world": return e.args;
    case "if": return [e.cond, e.then, e.else];
    case "let": return [e.value, e.body];
    case "get": case "field": case "tag": return [e.rec];
    case "case": return [e.scrut, ...e.arms.filter((a): a is SExpr => !!a)];
    case "budget": return [e.body, e.otherwise];
    case "closure": return e.caps;
    case "apply": return [e.fn, ...e.args];
    case "attempt": return [e.body, e.ok, e.otherwise];
    case "abort": return [e.reason];
    case "handle": return [e.body, e.arm];
    case "choose": return [e.list];
    case "search": return [e.body, ...(e.dflt ? [e.dflt] : [])];
    case "set": return [e.rec, e.value, e.then];
    default: return [];
  }
}
// e with its kids (in kids' order) replaced by f's.
export function mapKids(e: SExpr, f: (x: SExpr) => SExpr): SExpr {
  switch (e.k) {
    case "op": case "call": case "make": case "new": case "rt": case "world": return { ...e, args: e.args.map(f) } as SExpr;
    case "if": return { ...e, cond: f(e.cond), then: f(e.then), else: f(e.else) };
    case "let": return { ...e, value: f(e.value), body: f(e.body) };
    case "get": case "field": case "tag": return { ...e, rec: f(e.rec) } as SExpr;
    case "case": { const scrut = f(e.scrut); return { ...e, scrut, arms: e.arms.map((a) => a && f(a)) }; }
    case "budget": return { ...e, body: f(e.body), otherwise: f(e.otherwise) };
    case "closure": return { ...e, caps: e.caps.map(f) };
    case "apply": { const fn = f(e.fn); return { ...e, fn, args: e.args.map(f) }; }
    case "attempt": return { ...e, body: f(e.body), ok: f(e.ok), otherwise: f(e.otherwise) };
    case "abort": return { ...e, reason: f(e.reason) };
    case "handle": return { ...e, body: f(e.body), arm: f(e.arm) };
    case "choose": return { ...e, list: f(e.list) };
    case "search": { const body = f(e.body); return { ...e, body, ...(e.dflt ? { dflt: f(e.dflt) } : {}) }; }
    case "set": { const rec = f(e.rec), value = f(e.value); return { ...e, rec, value, then: f(e.then) }; }
    default: return e;
  }
}
// e with every local it reads or sets renumbered by m.
export function mapLocals(e: SExpr, m: (i: number) => number): SExpr {
  const r = mapKids(e, (x) => mapLocals(x, m));
  switch (r.k) {
    case "local": return { k: "local", i: m(r.i) };
    case "let": return { ...r, i: m(r.i) };
    case "case": return { ...r, s: m(r.s) };
    case "attempt": case "search": return { ...r, res: m(r.res) };
    case "apply": return { ...r, tmp: m(r.tmp) };
    case "handle": return { ...r, reason: m(r.reason), save: m(r.save) };
    case "budget": return { ...r, save: m(r.save), res: m(r.res) };
    default: return r;
  }
}
// The locals e reads that it doesn't set itself, in the order first read.
function freeLocals(e: SExpr): number[] {
  const read: number[] = [], set = new Set<number>();
  const walk = (x: SExpr) => {
    switch (x.k) {
      case "local": if (!read.includes(x.i)) read.push(x.i); break;
      case "let": set.add(x.i); break;
      case "case": set.add(x.s); break;
      case "attempt": case "search": set.add(x.res); break;
      case "apply": set.add(x.tmp); break;
      case "handle": set.add(x.reason); set.add(x.save); break;
      case "budget": set.add(x.save); set.add(x.res); break;
    }
    kids(x).forEach(walk);
  };
  walk(e);
  return read.filter((i) => !set.has(i));
}

export type SExpr =
  | { k: "num"; v: number }
  | { k: "int"; v: bigint }
  | { k: "text"; v: string }
  // A function of the runtime (wasm-rt.ts) by name.
  | { k: "rt"; fn: string; args: SExpr[] }
  | { k: "bool"; v: boolean }
  | { k: "local"; i: number }
  | { k: "op"; op: Op; args: SExpr[] }
  | { k: "if"; cond: SExpr; then: SExpr; else: SExpr; t: LType }
  | { k: "let"; i: number; value: SExpr; body: SExpr }
  // `cps`: a call of a function with several answers (W4d), the rest of
  // the search passed as its last input.
  | { k: "call"; fn: number; args: SExpr[]; tail: boolean; cps?: true }
  | { k: "make"; t: RType; args: SExpr[] }
  | { k: "get"; rec: SExpr; t: RType; i: number }
  // A value of case c of t, and field i of one (it is that case: the
  // checker says so, or the match just looked).
  | { k: "new"; t: DType; c: number; args: SExpr[] }
  | { k: "field"; rec: SExpr; t: DType; c: number; i: number }
  // The number of a value's case, from 0 in the order written.
  | { k: "tag"; rec: SExpr; t: DType }
  // A function as a value: `fn` takes the closure, then t's inputs, and
  // reads what it captured (in shapes[shape]) with cap.
  | { k: "closure"; t: FType; fn: number; shape: number; caps: SExpr[] }
  | { k: "cap"; t: FType; shape: number; i: number }
  // Calling a closure: it goes into local tmp, then its code is called
  // with it and the inputs.
  | { k: "apply"; fn: SExpr; t: FType; args: SExpr[]; tail: boolean; tmp: number }
  // A match on t: scrut goes into local s, then the arm for its case
  // runs (null: no arm, which the checker rules out).
  | { k: "case"; scrut: SExpr; s: number; t: DType; arms: (SExpr | null)[]; result: LType }
  // first(() => with fuel(n, () => body), () => otherwise): body with n
  // calls to spend, or otherwise if it ran out. `save` is a Number local
  // for the budget around this one, `res` one for body's value.
  | { k: "budget"; n: number; body: SExpr; otherwise: SExpr; t: LType; save: number; res: number }
  // No answer here (Choice, `data`): the nearest attempt gives its
  // otherwise, or the function, being partial, says it has none.
  | { k: "fail" }
  // first, optional, all and count over a search with one answer or none:
  // body's answer goes into local res and ok is the value; if it has
  // none, otherwise is.
  | { k: "attempt"; body: SExpr; res: number; ok: SExpr; otherwise: SExpr; t: LType }
  // abort(reason) (`data`): the computation ends, out to the nearest
  // handler of Abort, which gets the reason in local `reason` and gives
  // arm's value instead (a match on Abort).
  | { k: "abort"; reason: SExpr }
  // An operation on the world (WORLD_OPS), with its result's type.
  | { k: "world"; op: string; aborts: boolean; args: SExpr[]; t: LType }
  | { k: "handle"; body: SExpr; reason: number; arm: SExpr; t: LType; save: number }
  // W4d, gone after lowering: `one of` a list (t), anywhere, and a
  // handler's search (first, optional, all, count) to be made into code
  // once it's known whether it has several answers.
  | { k: "choose"; list: SExpr; t: DType }
  | { k: "search"; kind: "first" | "optional" | "all" | "count"; body: SExpr; res: number; t: LType; bt: LType; dflt?: SExpr }
  // Field i of the box rec set to value, then `then`; and the zero of t
  // (what a box starts as, before a search sets it).
  | { k: "set"; rec: SExpr; t: RType; i: number; value: SExpr; then: SExpr }
  | { k: "zero"; t: LType };

// Operations the targets provide. `host` ones (sin, pow, …) aren't
// WebAssembly instructions; a WASM module imports them, a shader has them
// built in.
export type Op = keyof typeof OPS;
export const OPS = {
  add: { t: "f64" }, sub: { t: "f64" }, mul: { t: "f64" }, div: { t: "f64" }, neg: { t: "f64" },
  sqrt: { t: "f64" }, abs: { t: "f64" }, floor: { t: "f64" }, float32: { t: "f64" },
  sin: { t: "f64", host: true }, cos: { t: "f64", host: true }, tan: { t: "f64", host: true },
  exp: { t: "f64", host: true }, log: { t: "f64", host: true }, pow: { t: "f64", host: true }, atan2: { t: "f64", host: true }, mod: { t: "f64", host: true },
  less: { t: "i32" }, equal: { t: "i32" }, beq: { t: "i32" }, and: { t: "i32" }, or: { t: "i32" }, not: { t: "i32" },
} as const satisfies Record<string, { t: SType; host?: boolean }>;


// `spends`: each call spends one from the budget (the checker couldn't see
// it end). `budgeted`: its type has Diverge, so it may only be called under
// a budget, never from outside. `inner`: made by the lowering (a fold
// is a function of its own), so not something to call from outside either.
// `partial`: it has one answer or none (Choice, `data`), so it gives a
// status with its answer (wasm.ts).
// `multi`: it has several answers (W4d): it takes the rest of the search
// as its last input and gives what that gives; `answer` is the type of
// its answers.
export interface SFunc { def: Id; name: string; params: LType[]; result: LType; locals: LType[]; body: SExpr; spends: boolean; budgeted: boolean; inner?: boolean; partial?: boolean; multi?: true; answer?: LType }
// `code` and `info` are the program that was lowered: the one given, or
// a copy with its derivatives generated, where funcs[i].def lives.
export interface Lowered { funcs: SFunc[]; refused: Map<Id, string>; records: RType[]; data: DType[]; fns: FType[]; shapes: Shape[]; code: Code; info: Info }

class Refused extends Error {}

// The largest budget: counts are kept in f32 on a GPU, whole up to 2^24.
export const MAX_FUEL = 2 ** 24;
const BUDGET = "first(() => with fuel(n, () => …), () => …)";
const MAY_NOT_FINISH = `may not finish (its type has Diverge): on a GPU that hangs the page, so run it under a budget, ${BUDGET}`;

export function lowerScalar(code: Code, info: Info, names: Names, roots: Id[], opts: { records?: boolean; data?: boolean } = {}): Lowered {
  // The generic + resolved to each type's own operation first
  // (projectional/src/lang/arith.ts): nothing here sees a generic one.
  ({ code, info, names } = resolveArithmetic(code, info, names));
  if (opts.data) opts = { ...opts, records: true };
  // derivative(f) of a function written right there becomes the code of
  // its derivative (derive.ts), checked again, so the GPU gets exact
  // slopes as plain arithmetic. The partials it calls (∂scene/∂x …) are
  // definitions like any other.
  // gradient(f) too, over the record f's type says it takes.
  const x = expandDerivatives(code, names, (call) => {
    const f = info.subst.zonk(info.typeOf.get((code.nodes[call] as NodeOf<"call">).args[0]) ?? { t: "var", v: -1 });
    return f.t === "fn" && f.params[0]?.t === "con" ? recordVariant(code, f.params[0].id) : null;
  });
  if (x.expanded.length) {
    code = x.code;
    names = x.names;
    info = infer(code, names);
  }
  // A generic definition (the vectors module's plus, for any record of
  // Numbers) is lowered once per set of types it's called at, the way a
  // C++ template or a Rust generic is: `at` is what its type variables
  // stand for in the one being lowered, and what its effect rows do (keep
  // with a test that may have no answer is a search itself).
  let at: At = new Map();
  const put = (t: Type, m: At): Type => {
    if (t.t === "var") { const x = m.get(t.v); return x && "t" in x ? x : t; }
    if (t.t === "con") return { ...t, args: t.args.map((a) => put(a, m)) };
    const x = t.eff.tail === null ? undefined : m.get(t.eff.tail);
    const eff = x && "effs" in x ? { effs: [...new Set([...t.eff.effs, ...x.effs])].sort(), tail: x.tail } : t.eff;
    return { ...t, params: t.params.map((p) => put(p, m)), ret: put(t.ret, m), eff };
  };
  const zonk = (id: Id): Type => put(info.subst.zonk(info.typeOf.get(id) ?? { t: "var", v: -1 }), at);
  const nm = (id: Id) => names[id] ?? id;
  const records = new Map<string, RType>();
  const datas = new Map<string, DType>();
  const fns = new Map<string, FType>();
  const shapes: Shape[] = [];
  const OTHER = opts.data ? "something other than Number, Bool or data of them" : opts.records ? "something other than Number, Bool or a record of them" : "something other than Number or Bool";

  // The profile's type for t, or null if t isn't in it.
  function stype(t: Type, inside: Id[] = []): LType | null {
    if (t.t === "fn" && opts.data) {
      // A function that may not finish, have no answer or abort is fine
      // here (a partial one, giving a status); one with other effects isn't yet.
      const effs = info.subst.resolveRow(t.eff).effs;
      if (effs.some((e) => !ALLOWED.includes(e))) return null;
      const params = t.params.map((p) => stype(p, inside)), result = stype(t.ret, inside);
      if (params.some((p) => !p) || !result) return null;
      const partial = effs.some((e) => PARTIAL.includes(e));
      const key = `fn(${(params as LType[]).map(keyOf).join(",")})>${keyOf(result)}${partial ? "!" : ""}`;
      if (!fns.has(key)) fns.set(key, { key, params: params as LType[], result, ...(partial ? { partial } : {}) });
      return fns.get(key)!;
    }
    if (t.t !== "con") return null;
    if (t.id === NUMBER) return "f64";
    if (t.id === BOOL) return "i32";
    if (opts.data && t.id === INT) return "int";
    if (opts.data && t.id === STRING) return "text";
    if (!opts.records) return null;
    const key = `${t.id}<${t.args.map(show).join(",")}>`;
    if (records.has(key)) return records.get(key)!;
    if (datas.has(key)) return datas.get(key)!;
    // A type inside itself at other arguments (List (List Tree)) is
    // another type; one that grows each level (non-regular) never ends.
    if (inside.filter((x) => x === t.id).length >= 8) return null;
    const td = code.nodes[(code.nodes[t.id] as NodeOf<"def"> | undefined)?.body ?? ""];
    if (td?.kind !== "typedef" || td.effect) return null;
    const self = (v: Id) => (code.nodes[v] as NodeOf<"variant">).fields.some((f) => mentions((code.nodes[f] as NodeOf<"field">).type, t.id));
    const many = td.variants.length !== 1 || self(td.variants[0]);
    if (many && !opts.data) return null;
    // The fields' types, with the type's parameters replaced by t's arguments.
    const args = new Map(td.params.map((p, i) => [p, t.args[i]] as const));
    const te = (tid: Id): Type | null => {
      const n = code.nodes[tid];
      if (n?.kind !== "tref") return null;
      if (args.has(n.target)) return args.get(n.target)!;
      const xs = n.args.map(te);
      return xs.every((x) => x) ? { t: "con", id: n.target, args: xs as Type[] } : null;
    };
    const fieldsOf = (v: Id): RType["fields"] | null => {
      const fields: RType["fields"] = [];
      for (const f of (code.nodes[v] as NodeOf<"variant">).fields) {
        const ft = te((code.nodes[f] as NodeOf<"field">).type);
        const lt = ft && stype(info.subst.zonk(ft), [...inside, t.id]);
        if (!lt) return null;
        fields.push({ name: nm(f), t: lt });
      }
      return fields;
    };
    if (many) {
      // Registered first, so a field of the type itself finds it.
      const d: DType = { key, name: nm(t.id), def: t.id, cases: [] };
      const had = new Set([...datas.keys(), ...records.keys()]);
      datas.set(key, d);
      for (const v of td.variants) {
        const fields = fieldsOf(v);
        if (!fields) {
          // Not in the profile, nor is anything made since that holds it.
          for (const k of [...datas.keys(), ...records.keys()]) if (!had.has(k)) { datas.delete(k); records.delete(k); }
          return null;
        }
        d.cases.push({ variant: v, name: nm(v), fields });
      }
      return d;
    }
    const fields = fieldsOf(td.variants[0]);
    if (!fields || (!fields.length && !opts.data)) return null;
    const r: RType = { key, name: nm(t.id), def: t.id, variant: td.variants[0], case: nm(td.variants[0]), fields };
    records.set(key, r);
    return r;
  }
  // Why t isn't in the profile, when records are: the first reason found.
  function whyNot(t: Type, inside: Id[] = []): string {
    if (t.t === "fn") {
      if (!opts.data) return "a function (that needs closures)";
      const bad = [...t.params, t.ret].find((p) => !stype(p, inside));
      return bad ? `a function of ${whyNot(bad, inside)}` : `a function with effects (${info.subst.resolveRow(t.eff).effs.filter((e) => e !== DIVERGE).map(nm).join(", ")})`;
    }
    if (t.t === "var") return "a value of any type";
    const td = code.nodes[(code.nodes[t.id] as NodeOf<"def"> | undefined)?.body ?? ""];
    if (td?.kind !== "typedef" || td.effect) return nm(t.id);
    if (opts.data) {
      const arg = t.args.find((a) => !stype(a));
      return arg ? `${nm(t.id)} of ${whyNot(arg, [...inside, t.id])}` : `${nm(t.id)}, which has a field that isn't a Number, Bool or data of them`;
    }
    if (inside.includes(t.id)) return `${nm(t.id)}, which contains itself (that needs a heap)`;
    if (td.variants.length !== 1) return `${nm(t.id)}, which has ${td.variants.length} cases (only one-case records fit)`;
    const ft = (code.nodes[td.variants[0]] as NodeOf<"variant">).fields.map((f) => code.nodes[(code.nodes[f] as NodeOf<"field">).type]);
    if (ft.some((n) => n?.kind === "tref" && (n.target === t.id || inside.includes(n.target)))) return `${nm(t.id)}, which contains itself (that needs a heap)`;
    return `${nm(t.id)}, which has a field that isn't a Number, Bool or record`;
  }
  // Whether a type written in the program mentions `target`.
  const mentions = (tid: Id, target: Id): boolean => {
    const n = code.nodes[tid];
    return n?.kind === "tref" && (n.target === target || n.args.some((a) => mentions(a, target)));
  };
  const vars = (t: Type): number[] => (t.t === "var" ? [t.v] : t.t === "con" ? t.args.flatMap(vars) : [...t.params.flatMap(vars), ...vars(t.ret), ...(t.eff.tail === null ? [] : [t.eff.tail])]);
  const keyOf = (t: LType): string => (typeof t === "string" ? t : t.key);
  const show = (t: Type): string => (t.t === "con" ? `${t.id}<${t.args.map(show).join(",")}>` : t.t === "var" ? `?${t.v}` : `fn(${t.params.map(show).join(",")})>${show(t.ret)}`);

  const funcs: SFunc[] = [];
  const index = new Map<Id, number>();
  const refused = new Map<Id, string>();
  const inProgress = new Set<Id>();
  // Whether what's being lowered runs under a budget, so a call to
  // something that might not finish is allowed: inside a budget's body, or
  // inside a definition that itself may only be called under one.
  let underBudget = false;
  const diverges = (t: Type | undefined) => !!t && t.t === "fn" && info.subst.resolveRow(t.eff).effs.includes(DIVERGE);

  // The function index for `def` at these types, lowering it (and what it
  // calls) first.
  function func(def: Id, types: At = new Map()): number {
    const raw = info.typeOf.get(def) && info.subst.zonk(info.typeOf.get(def)!);
    const t = raw && put(raw, types);
    if (!opts.data && !underBudget && diverges(t)) throw new Refused(`calls ${nm(def)}, which ${MAY_NOT_FINISH}`);
    const used = raw ? [...new Set(vars(raw))].filter((v) => types.has(v)).sort((a, b) => a - b) : [];
    const bound = (x: Type | Row) => ("t" in x ? show(x) : `{${x.effs.join(",")}}`);
    const key = used.length ? `${def}|${used.map((v) => `${v}=${bound(types.get(v)!)}`).join(",")}` : def;
    if (index.has(key)) return index.get(key)!;
    if (refused.has(key)) throw new Refused(`calls ${nm(def)}, which ${refused.get(key)}`);
    const d = code.nodes[def] as NodeOf<"def">;
    const lam = d?.body ? code.nodes[d.body] : null;
    const fail = (why: string): never => { refused.set(key, why); throw new Refused(`calls ${nm(def)}, which ${why}`); };
    // A constant (`data`): a function of no inputs, computed where it's used.
    const constant = !!opts.data && !!t && t.t !== "fn" && !!lam && !["lambda", "typedef", "builtin"].includes(lam.kind);
    if (!constant && (!t || t.t !== "fn" || lam?.kind !== "lambda")) fail("is not a function written in the program");
    const ft = (constant ? { t: "fn", params: [], ret: t, eff: null } : t) as Extract<Type, { t: "fn" }>;
    // An input that can be anything is one the body never looks at (∂f/∂x
    // of a function that has an input the slope doesn't depend on, say).
    // It's taken as a Number, and calls must pass one.
    const free = new Set(vars(ft.ret));
    const params = ft.params.map((p) => (p.t === "var" && !free.has(p.v) ? "f64" : stype(p))), result = stype(ft.ret);
    if (params.some((p) => !p) || !result) {
      const bad = [...ft.params, ft.ret][[...params, result].findIndex((x) => !x)];
      fail(opts.records ? `takes or gives ${whyNot(info.subst.zonk(bad))}` : `takes or gives ${OTHER}`);
    }
    // With `data`, a search with one answer or none (no `one of`, which
    // is refused where it's used) is a partial function, and so is one
    // that spends from a budget: running out is having no answer there,
    // which the nearest handler sees, as in the evaluator.
    const all = constant ? [] : info.subst.resolveRow(ft.eff).effs;
    const partial = !!opts.data && (all.includes(CHOICE) || all.includes(ABORT) || (!constant && info.divergent.has(def)));
    const effs = all.filter((e) => !BUDGETED.includes(e) && !(partial && PARTIAL.includes(e)) && !(opts.data && (e === CONSOLE || e === FILES)));
    if (effs.length) fail(`has effects (${effs.map(nm).join(", ")})`);
    const budgeted = !constant && !opts.data && diverges(ft);

    // Reserve the index now, so recursion finds it.
    const i = funcs.length;
    index.set(key, i);
    inProgress.add(def);
    const f: SFunc = { def, name: nm(def), params: params as LType[], result: result!, locals: [...params as LType[]], body: { k: "num", v: 0 }, spends: info.divergent.has(def), budgeted, ...(partial ? { partial } : {}) };
    funcs.push(f);
    const outer = underBudget, outerAt = at, shaped = shapes.length;
    try {
      const l = lam as NodeOf<"lambda">;
      const env = new Map(constant ? [] : l.params.map((p, j) => [p, j]));
      underBudget = budgeted;
      // The body's own type variables can differ from the definition's
      // (a library definition is a copy of its module's): what they are
      // here, from the body's type against the one being lowered.
      at = new Map(types);
      const bt = info.typeOf.get(d.body!) && info.subst.zonk(info.typeOf.get(d.body!)!);
      if (bt && t) bindVars(bt, t, at);
      f.body = expr(constant ? d.body! : l.body, env, f, true);
    } catch (e) {
      underBudget = outer;
      at = outerAt;
      // Undo: this definition and anything lowered after it.
      funcs.splice(i);
      shapes.splice(shaped);
      for (const [d2, j] of index) if (j >= i) index.delete(d2);
      inProgress.delete(def);
      if (e instanceof Refused) { refused.set(key, e.message); throw new Refused(`calls ${nm(def)}, which ${e.message}`); }
      throw e;
    }
    underBudget = outer;
    at = outerAt;
    inProgress.delete(def);
    return i;
  }

  function expr(id: Id, env: Map<Id, number>, f: SFunc, tail: boolean): SExpr {
    const n = code.nodes[id];
    switch (n.kind) {
      case "lit": {
        const t = stype(zonk(id));
        if (t === "int") return { k: "int", v: BigInt(n.value) };
        if (t === "text" && typeof n.value === "string") return { k: "text", v: n.value };
        if (typeof n.value !== "number" || t !== "f64") throw new Refused(opts.data ? "uses a value that isn't a Number, Int or Text" : "uses a value that isn't a Number");
        return { k: "num", v: n.value };
      }
      case "ref": {
        if (n.target === TRUE || n.target === FALSE) return { k: "bool", v: n.target === TRUE };
        if (env.has(n.target)) return { k: "local", i: env.get(n.target)! };
        const later = inlined.get(n.target);
        if (later) return { ...later, tail };
        // A case with no fields (empty, nothing) written alone.
        if (opts.data && code.nodes[n.target]?.kind === "variant") return build(n.target, zonk(id), []);
        if (opts.data && code.nodes[n.target]?.kind === "def") {
          const t = stype(zonk(id));
          if (t && isFn(t)) return named(n.target, id, t);
          // A constant of a type with variables (empty map) is made at the
          // type it has here.
          const types: At = new Map(), ct = info.typeOf.get(n.target) && info.subst.zonk(info.typeOf.get(n.target)!);
          if (ct) bindVars(ct, zonk(id), types);
          return { k: "call", fn: func(n.target, types), args: [], tail };
        }
        throw new Refused(`uses ${nm(n.target)} as a value (functions and data need a heap)`);
      }
      case "call": {
        const head = code.nodes[n.fn];
        if (head.kind === "lambda") {
          // A let: each argument goes into a new local.
          if (head.params.length !== n.args.length) throw new Refused("applies a function to the wrong number of inputs");
          let inner = new Map(env);
          const lets: { i: number; value: SExpr }[] = [];
          head.params.forEach((p, j) => {
            const t = stype(zonk(p));
            if (!t) throw new Refused(`lets ${nm(p)} be ${OTHER}`);
            const value = expr(n.args[j], env, f, false);
            const i = f.locals.push(t) - 1;
            inner = new Map(inner).set(p, i);
            lets.push({ i, value });
          });
          return lets.reduceRight<SExpr>((body, l) => ({ k: "let", i: l.i, value: l.value, body }), expr(head.body, inner, f, tail));
        }
        // A function computed or passed in: called through its closure.
        if (opts.data && (head.kind !== "ref" || env.has(head.target) || inlined.has(head.target) || (code.nodes[head.target]?.kind === "def" && (code.nodes[(code.nodes[head.target] as NodeOf<"def">).body ?? ""]?.kind !== "lambda")))) {
          const t = stype(zonk(n.fn));
          if (!t || !isFn(t)) throw new Refused(`calls a function of ${whyNot(zonk(n.fn))}`);
          return { k: "apply", fn: expr(n.fn, env, f, false), t, args: n.args.map((a) => expr(a, env, f, false)), tail, tmp: f.locals.push(t) - 1 };
        }
        if (head.kind !== "ref") throw new Refused("calls a computed function (that needs closures)");
        const args = () => n.args.map((a) => expr(a, env, f, false));
        const target = head.target;
        if (target === S.equal) {
          const t = stype(zonk(n.args[0]));
          if (!t || (typeof t !== "string" && !opts.data)) throw new Refused("compares values that aren't Numbers or Bools");
          const [x, y] = args();
          return same(x, y, t, f, tail);
        }
        if (opts.data && target === COMPARE) {
          // compare (run.ts compareValues) as −1, 0 or 1 from the type's
          // own order, then the Order case.
          const t = stype(zonk(n.args[0])), o = stype(zonk(id));
          if (!t || !o || !isData(o)) throw new Refused(`compares ${whyNot(zonk(n.args[0]))}`);
          const [x, y] = args(), [lx, ly] = [f.locals.push(t) - 1, f.locals.push(t) - 1], c = f.locals.push("f64") - 1, at: SExpr = { k: "local", i: c };
          const order = (v: Id): SExpr => build(v, zonk(id), []);
          const num = (v: number): SExpr => ({ k: "num", v });
          return { k: "let", i: lx, value: x, body: { k: "let", i: ly, value: y, body: { k: "let", i: c, value: compared({ k: "local", i: lx }, { k: "local", i: ly }, t, f, false), body: { k: "if", cond: { k: "op", op: "less", args: [at, num(0)] }, then: order(ORDER_V.before), else: { k: "if", cond: { k: "op", op: "equal", args: [at, num(0)] }, then: order(ORDER_V.same), else: order(ORDER_V.after), t: o }, t: o } } } };
        }
        if (opts.data && target === INT_OPS.lowestTerms) {
          // int.ts's lowest terms from the runtime's gcd and exact division:
          // both over their gcd, both negated if the bottom is below 0.
          const t = stype(zonk(id));
          if (!t) throw new Refused(`uses ${nm(target)} on ${whyNot(zonk(id))}`);
          const [a, b] = args(), at = (i: number): SExpr => ({ k: "local", i }), rt = (fn: string, ...xs: SExpr[]): SExpr => ({ k: "rt", fn, args: xs });
          const [x, y, g, p, q] = [0, 0, 0, 0, 0].map(() => f.locals.push("int") - 1);
          const both = (u: SExpr, v: SExpr) => build(PAIR_V, zonk(id), [u, v]);
          const lets: [number, SExpr][] = [[x, a], [y, b], [g, rt("int.gcd", at(x), at(y))], [p, rt("int.exact", at(x), at(g))], [q, rt("int.exact", at(y), at(g))]];
          const body: SExpr = { k: "if", cond: rt("int.less", at(y), { k: "int", v: 0n }), then: both(rt("int.neg", at(p)), rt("int.neg", at(q))), else: both(at(p), at(q)), t };
          return lets.reduceRight<SExpr>((e, [i, value]) => ({ k: "let", i, value, body: e }), body);
        }
        if (opts.data && RT[target]) {
          // What it takes and gives in, so List Text is one of the module's types.
          for (const a of [...n.args, id]) if (!stype(zonk(a))) throw new Refused(`uses ${nm(target)} on ${whyNot(zonk(a))}`);
          return { k: "rt", fn: RT[target], args: args() };
        }
        if (scalarOp(target)) return { k: "op", op: scalarOp(target)!, args: args() };
        if (target === S.mapParts || target === S.zipParts || target === S.total) return parts(n, env, f);
        if (target === S.fail && opts.data) return { k: "fail" };
        if (target === ABORT_OP && opts.data && n.args.length === 1) return { k: "abort", reason: expr(n.args[0], env, f, false) };
        if (opts.data && WORLD_OPS[target]) {
          const t = stype(zonk(id));
          if (!t) throw new Refused(`uses ${nm(target)} on ${whyNot(zonk(id))}`);
          return { k: "world", ...WORLD_OPS[target], args: args(), t };
        }
        if (target === S.valueOf && opts.data) return valueOf(n, id, env, f);
        if (target === S.oneOf && opts.data && n.args.length === 1) {
          const lt = stype(zonk(n.args[0]));
          if (!lt || !isData(lt) || !lt.cases.some((c) => c.variant === CONS)) throw new Refused(`chooses one of ${whyNot(zonk(n.args[0]))}`);
          return { k: "choose", list: expr(n.args[0], env, f, false), t: lt };
        }
        if (opts.data && [S.first, S.optional, S.all, S.count].includes(target) && !isBudget(n)) return attempt(n, id, env, f);
        if (target === S.first || target === S.fuel) return budget(n, id, env, f);
        const t = code.nodes[target];
        if (t?.kind === "def") {
          // What the callee's type variables and rows are here.
          const types: At = new Map();
          const ct = info.typeOf.get(target) && info.subst.zonk(info.typeOf.get(target)!);
          if (ct?.t === "fn") { ct.params.forEach((p, j) => n.args[j] && bindVars(p, zonk(n.args[j]), types)); bindVars(ct.ret, zonk(id), types); }
          const fn = func(target, types);
          n.args.forEach((a, j) => {
            if (stype(zonk(a)) !== funcs[fn].params[j]) throw new Refused(`passes ${nm(target)} something other than ${nm(target)} takes there`);
          });
          return { k: "call", fn, args: args(), tail };
        }
        if (opts.records && t?.kind === "variant") return build(target, zonk(id), args());
        if (opts.records && t?.kind === "field" && n.args.length === 1) {
          const r = stype(zonk(n.args[0]));
          if (r && isData(r)) {
            const c = r.cases.findIndex((x) => (code.nodes[x.variant] as NodeOf<"variant">).fields.includes(target));
            return { k: "field", rec: expr(n.args[0], env, f, false), t: r, c, i: fieldIndex(code, target) };
          }
          if (!r || !isRecord(r)) throw new Refused(`takes ${nm(target)} of something that isn't a record of Numbers and Bools`);
          return { k: "get", rec: expr(n.args[0], env, f, false), t: r, i: fieldIndex(code, target) };
        }
        const why = TARGETS[target]?.scalar;
        throw new Refused(`uses ${nm(target)}, which isn't in the scalar profile${why && typeof why === "object" && "no" in why ? `: it ${why.no}` : ""}`);
      }
      case "match": {
        const arms = n.arms.map((a) => code.nodes[a] as NodeOf<"arm">);
        if (opts.data && arms.length === 1 && arms[0].variant === ABORT_OP) {
          // A handler of Abort: the scrutinee is the computation.
          const t = stype(zonk(id));
          if (!t) throw new Refused(`handles Abort with a value that is ${OTHER}`);
          const reason = f.locals.push("text") - 1, save = f.locals.push("f64") - 1;
          const body = expr(n.scrutinee, env, f, false);
          const arm = expr(arms[0].body, new Map(env).set(arms[0].binds[0], reason), f, false);
          return { k: "handle", body, reason, arm, t, save };
        }
        const st = opts.records ? stype(zonk(n.scrutinee)) : null;
        if (st && isData(st)) {
          // Each case's arm, its fields as lets read from the scrutinee's local.
          const s = f.locals.push(st) - 1;
          const result = stype(zonk(id));
          if (!result) throw new Refused(`has a match whose value is ${OTHER}`);
          const arms2 = st.cases.map((c, ci): SExpr | null => {
            const a = arms.find((x) => x.variant === c.variant);
            if (!a) return n.otherwise ? expr(n.otherwise, env, f, tail) : null;
            let inner = new Map(env);
            const lets: { i: number; value: SExpr }[] = [];
            a.binds.forEach((b, j) => {
              const i = f.locals.push(c.fields[j].t) - 1;
              inner = new Map(inner).set(b, i);
              lets.push({ i, value: { k: "field", rec: { k: "local", i: s }, t: st, c: ci, i: j } });
            });
            return lets.reduceRight<SExpr>((body, l) => ({ k: "let", i: l.i, value: l.value, body }), expr(a.body, inner, f, tail));
          });
          return { k: "case", scrut: expr(n.scrutinee, env, f, false), s, t: st, arms: arms2, result };
        }
        if (st && isRecord(st) && arms.length === 1 && arms[0].variant === st.variant) {
          // Taking a record apart: its fields are lets.
          const r = f.locals.push(st) - 1;
          let inner = new Map(env);
          const lets: { i: number; value: SExpr }[] = [];
          arms[0].binds.forEach((b, j) => {
            const i = f.locals.push(st.fields[j].t) - 1;
            inner = new Map(inner).set(b, i);
            lets.push({ i, value: { k: "get", rec: { k: "local", i: r }, t: st, i: j } });
          });
          const body = lets.reduceRight<SExpr>((body, l) => ({ k: "let", i: l.i, value: l.value, body }), expr(arms[0].body, inner, f, tail));
          return { k: "let", i: r, value: expr(n.scrutinee, env, f, false), body };
        }
        // Otherwise only `if`: a match on Bool.
        if (!arms.every((a) => a.variant === TRUE || a.variant === FALSE)) throw new Refused("matches on data (needs a heap)");
        const arm = (v: Id) => arms.find((a) => a.variant === v)?.body ?? n.otherwise!;
        const t = stype(zonk(id));
        if (!t) throw new Refused(`has an if whose value is ${OTHER}`);
        return { k: "if", cond: expr(n.scrutinee, env, f, false), then: expr(arm(TRUE), env, f, tail), else: expr(arm(FALSE), env, f, tail), t };
      }
      case "fold": {
        if (!opts.data) throw new Refused("folds over data (needs a heap)");
        return fold(n, id, env, f, tail);
      }
      case "solve": throw new Refused("solves a relation (not in this profile yet)");
      case "lambda": {
        if (!opts.data) throw new Refused("makes a function (that needs closures)");
        const t = stype(zonk(id));
        if (!t || !isFn(t)) throw new Refused(`makes a function of ${whyNot(zonk(id))}`);
        return lambda(n, t, env, f);
      }
      case "hole": throw new Refused("has a hole");
      default: throw new Refused(`has a ${n.kind}`);
    }
  }

  // equal on values of type t, by the evaluator's rule (run.ts equal).
  function same(x: SExpr, y: SExpr, t: LType, f: SFunc, tail: boolean): SExpr {
    if (t === "i32") return { k: "op", op: "beq", args: [x, y] };
    if (isFn(t)) throw new Refused("compares functions");
    if (t === "int") return { k: "rt", fn: "int.equal", args: [x, y] };
    if (t === "text") return { k: "rt", fn: "text.equal", args: [x, y] };
    if (t !== "f64") return { k: "call", fn: equality(t), args: [x, y], tail };
    // Two Numbers within 1e-9 relative to their size (run.ts sameNumber).
    // Each side once: a local if it isn't one already.
    const lets: { i: number; value: SExpr }[] = [];
    const [a, b] = [x, y].map((value): SExpr => {
      if (value.k === "local" || value.k === "num") return value;
      const i = f.locals.push("f64") - 1;
      lets.push({ i, value });
      return { k: "local", i };
    });
    const op = (o: Op, ...xs: SExpr[]): SExpr => ({ k: "op", op: o, args: xs });
    const num = (v: number): SExpr => ({ k: "num", v });
    // Near on every Number, whole or not: an Int is its own type here.
    const diff = op("abs", op("sub", a, b)), tol = op("mul", num(1e-9), op("add", op("add", num(1), op("abs", a)), op("abs", b)));
    // Only a finite gap is near (run.ts close): diff − diff is NaN for ∞.
    const finite = op("equal", op("sub", diff, diff), num(0));
    const near = op("or", op("equal", a, b), op("and", finite, op("or", op("less", diff, tol), op("equal", diff, tol))));
    return lets.reduceRight<SExpr>((body, l) => ({ k: "let", i: l.i, value: l.value, body }), near);
  }
  // compare's order (run.ts compareValues) as −1, 0 or 1: numbers by
  // value (exactly), Bools and cases in the order their type declares them, text by
  // code point, fractions by value, then fields left to right.
  function compared(x: SExpr, y: SExpr, t: LType, f: SFunc, tail: boolean): SExpr {
    const num = (v: number): SExpr => ({ k: "num", v });
    const pick = (eq: SExpr, lt: SExpr): SExpr => ({ k: "if", cond: eq, then: num(0), else: { k: "if", cond: lt, then: num(-1), else: num(1), t: "f64" }, t: "f64" });
    if (isFn(t)) throw new Refused("compares functions");
    if (t === "f64") {
      // Exactly, with NaN after every other Number (run.ts numberOrder).
      const op = (o: Op, ...args: SExpr[]): SExpr => ({ k: "op", op: o, args });
      const nan = (e: SExpr) => op("not", op("equal", e, e));
      return pick(op("or", op("equal", x, y), op("and", nan(x), nan(y))), op("or", op("less", x, y), op("and", nan(y), op("not", nan(x)))));
    }
    if (t === "i32") return pick({ k: "op", op: "beq", args: [x, y] }, { k: "op", op: "not", args: [x] });
    if (t === "int") return pick({ k: "rt", fn: "int.equal", args: [x, y] }, { k: "rt", fn: "int.less", args: [x, y] });
    if (t === "text") return pick({ k: "rt", fn: "text.equal", args: [x, y] }, { k: "rt", fn: "text.less", args: [x, y] });
    return { k: "call", fn: ordering(t), args: [x, y], tail };
  }
  // compared on a record or data type, a function of its own (recursive
  // for a type that contains itself): different cases by their places,
  // the same case field by field, the last a tail call, so two long lists
  // compare in constant stack.
  function ordering(t: RType | DType): number {
    const key = `<${t.key}`;
    if (index.has(key)) return index.get(key)!;
    const g: SFunc = { def: t.def, name: `${t.name}.compare`, params: [t, t], result: "f64", locals: [t, t], body: { k: "num", v: 0 }, spends: false, budgeted: false, inner: true };
    index.set(key, funcs.push(g) - 1);
    const a: SExpr = { k: "local", i: 0 }, b: SExpr = { k: "local", i: 1 };
    const num = (v: number): SExpr => ({ k: "num", v });
    const all = (pairs: [SExpr, SExpr, LType][]): SExpr => {
      if (!pairs.length) return num(0);
      const [x, y, ft] = pairs[pairs.length - 1];
      return pairs.slice(0, -1).reduceRight<SExpr>((rest, [x2, y2, t2]) => {
        const c = g.locals.push("f64") - 1, at: SExpr = { k: "local", i: c };
        return { k: "let", i: c, value: compared(x2, y2, t2, g, false), body: { k: "if", cond: { k: "op", op: "equal", args: [at, num(0)] }, then: rest, else: at, t: "f64" } };
      }, compared(x, y, ft, g, true));
    };
    if (isRecord(t) ? t.variant === RATIO : t.cases.length === 1 && t.cases[0].variant === RATIO) {
      // A fraction by value: top · other bottom against other top · bottom.
      const part = (r: SExpr, j: number): SExpr => (isRecord(t) ? { k: "get", rec: r, t, i: j } : { k: "field", rec: r, t, c: 0, i: j });
      const times = (u: SExpr, v: SExpr): SExpr => ({ k: "rt", fn: "int.mul", args: [u, v] });
      const [l, r] = [g.locals.push("int") - 1, g.locals.push("int") - 1];
      g.body = { k: "let", i: l, value: times(part(a, 0), part(b, 1)), body: { k: "let", i: r, value: times(part(b, 0), part(a, 1)), body: compared({ k: "local", i: l }, { k: "local", i: r }, "int", g, true) } };
    } else if (isRecord(t)) g.body = all(t.fields.map((x, j) => [{ k: "get", rec: a, t, i: j }, { k: "get", rec: b, t, i: j }, x.t]));
    else {
      const arms = t.cases.map((c, ci) => all(c.fields.map((x, j) => [{ k: "field", rec: a, t, c: ci, i: j }, { k: "field", rec: b, t, c: ci, i: j }, x.t])));
      // Different cases: a's place against b's.
      const apart: SExpr = { k: "case", scrut: a, s: 0, t, result: "f64", arms: t.cases.map((_, i) => ({ k: "case", scrut: b, s: 1, t, result: "f64", arms: t.cases.map((_, j) => num(i < j ? -1 : i > j ? 1 : 0)) })) };
      g.body = { k: "if", cond: { k: "op", op: "beq", args: [{ k: "tag", rec: a, t }, { k: "tag", rec: b, t }] }, then: { k: "case", scrut: a, s: 0, t, arms, result: "f64" }, else: apart, t: "f64" };
    }
    return index.get(key)!;
  }
  // Structural equality on a record or data type, a function of its own
  // (recursive for a type that contains itself): the same case, then each
  // field in order, stopping at the first that differs, the last a tail
  // call, so two long lists compare in constant stack.
  function equality(t: RType | DType): number {
    const key = `=${t.key}`;
    if (index.has(key)) return index.get(key)!;
    const g: SFunc = { def: t.def, name: `${t.name}.equal`, params: [t, t], result: "i32", locals: [t, t], body: { k: "bool", v: true }, spends: false, budgeted: false, inner: true };
    index.set(key, funcs.push(g) - 1);
    const a: SExpr = { k: "local", i: 0 }, b: SExpr = { k: "local", i: 1 };
    const all = (pairs: [SExpr, SExpr, LType][]): SExpr => {
      if (!pairs.length) return { k: "bool", v: true };
      const [x, y, ft] = pairs[pairs.length - 1];
      return pairs.slice(0, -1).reduceRight<SExpr>((rest, [x2, y2, t2]) => ({ k: "if", cond: same(x2, y2, t2, g, false), then: rest, else: { k: "bool", v: false }, t: "i32" }), same(x, y, ft, g, true));
    };
    if (isRecord(t)) g.body = all(t.fields.map((x, j) => [{ k: "get", rec: a, t, i: j }, { k: "get", rec: b, t, i: j }, x.t]));
    else {
      const arms = t.cases.map((c, ci) => all(c.fields.map((x, j) => [{ k: "field", rec: a, t, c: ci, i: j }, { k: "field", rec: b, t, c: ci, i: j }, x.t])));
      g.body = { k: "if", cond: { k: "op", op: "beq", args: [{ k: "tag", rec: a, t }, { k: "tag", rec: b, t }] }, then: { k: "case", scrut: a, s: 0, t, arms, result: "i32" }, else: { k: "bool", v: false }, t: "i32" };
    }
    return index.get(key)!;
  }

  // A function written in place, as a closure: its code is a function of
  // its own taking the closure and then the inputs, which starts by
  // reading what it captured into locals.
  function lambda(n: NodeOf<"lambda">, t: FType, env: Map<Id, number>, f: SFunc): SExpr {
    const free = [...new Set(refsIn(n.body))].filter((b) => env.has(b) || inlined.has(b));
    if (free.some((b) => inlined.has(b))) throw new Refused("makes a function inside a fold that uses the fold's result (not in WebAssembly yet)");
    const caps = free.map((b) => f.locals[env.get(b)!]);
    const shape = shapes.push({ t, caps }) - 1;
    const g: SFunc = { def: n.id, name: `${f.name}.λ`, params: [t, ...t.params], result: t.result, locals: [t, ...t.params], body: { k: "num", v: 0 }, spends: false, budgeted: false, inner: true, ...(t.partial ? { partial: true } : {}) };
    const gi = funcs.push(g) - 1;
    closureCode.add(gi);
    let inner = new Map(n.params.map((p, j) => [p, j + 1]));
    const lets = free.map((b, j) => { const i = g.locals.push(caps[j]) - 1; inner = new Map(inner).set(b, i); return { i, value: { k: "cap", t, shape, i: j } as SExpr }; });
    g.body = lets.reduceRight<SExpr>((body, l) => ({ k: "let", i: l.i, value: l.value, body }), expr(n.body, inner, g, true));
    return { k: "closure", t, fn: gi, shape, caps: free.map((b): SExpr => ({ k: "local", i: env.get(b)! })) };
  }
  // A definition used as a value: a closure that calls it, made once.
  function named(def: Id, id: Id, t: FType): SExpr {
    const key = `&${def}|${t.key}`;
    if (!index.has(key)) {
      const shape = shapes.push({ t, caps: [] }) - 1;
      const g: SFunc = { def, name: `${nm(def)}.value`, params: [t, ...t.params], result: t.result, locals: [t, ...t.params], body: { k: "num", v: 0 }, spends: false, budgeted: false, inner: true, ...(t.partial ? { partial: true } : {}) };
      index.set(key, funcs.push(g) - 1);
      closureCode.add(index.get(key)!);
      // What its type variables are, from the type it's used at.
      const types: At = new Map();
      const dt = info.typeOf.get(def) && info.subst.zonk(info.typeOf.get(def)!);
      if (dt) bindVars(dt, zonk(id), types);
      g.body = { k: "call", fn: func(def, types), args: t.params.map((_, j): SExpr => ({ k: "local", i: j + 1 })), tail: true };
      shapeOfNamed.set(key, shape);
    }
    return { k: "closure", t, fn: index.get(key)!, shape: shapeOfNamed.get(key)!, caps: [] };
  }
  const shapeOfNamed = new Map<string, number>();

  // A fold's result binder used once, by the call that computes it.
  const inlined = new Map<Id, Extract<SExpr, { k: "call" }>>();
  // A fold is a recursive function of its own: the value folded is its
  // first input, then the locals its arms use from around it. Each arm
  // calls it on the fields of the type itself, before its body, which
  // gets those results (structural recursion, as written).
  function fold(n: NodeOf<"fold">, id: Id, env: Map<Id, number>, f: SFunc, tail: boolean): SExpr {
    const st = stype(zonk(n.scrutinee)), result = stype(zonk(id));
    if (!st || !isData(st)) throw new Refused(`folds over ${st ? "a record (a match takes it apart)" : OTHER}`);
    if (!result) throw new Refused(`has a fold whose value is ${OTHER}`);
    const arms = n.arms.map((a) => code.nodes[a] as NodeOf<"arm">);
    const free = [...new Set(arms.flatMap((a) => refsIn(a.body)))].filter((b) => env.has(b));
    // A field holding the type inside another (a rose tree's List Tree):
    // its folded value is that container with each one folded.
    const nested = arms.some((a) => a.results.some((r, j) => r && st.cases.find((x) => x.variant === a.variant)!.fields[j].t !== st));
    const outside = free.map((b): SExpr => ({ k: "local", i: env.get(b)! }));
    if (!nested && arms.every((a) => a.results.filter((r) => r).length <= 1)) {
      const s = expr(n.scrutinee, env, f, false);
      const fused = s.k === "rt" && s.fn === "text.characters" ? characters(st, result, arms, free, env, f) : null;
      if (fused && s.k === "rt") {
        const tl = f.locals.push("text") - 1, t: SExpr = { k: "local", i: tl };
        return { k: "let", i: tl, value: s.args[0], body: { k: "call", fn: fused.fn, args: [t, { k: "rt", fn: "text.size", args: [t] }, fused.start, ...outside], tail } };
      }
      return { k: "call", fn: loop(st, result, arms, free, env, f), args: [s, { k: "new", t: framesOf(st), c: 0, args: [] }, ...outside], tail };
    }
    const params = [st, ...free.map((b) => f.locals[env.get(b)!])];
    const g: SFunc = { def: id, name: `${f.name}.fold`, params, result, locals: [...params], body: { k: "num", v: 0 }, spends: false, budgeted: false, inner: true };
    const gi = funcs.push(g) - 1;
    const captured: SExpr[] = free.map((_, j) => ({ k: "local", i: j + 1 }));
    const genv = new Map(free.map((b, j) => [b, j + 1]));
    const scrut: SExpr = { k: "local", i: 0 };
    // The fold mapped over a container type of st, made once per type:
    // a function of a container and what the fold captured, rebuilding it
    // case by case with each st in it folded (nested.ts, what Coq does
    // for nested inductive types).
    const maps = new Map<string, number>();
    const holds = (t: LType, seen = new Set<string>()): boolean =>
      t === st || (isData(t) && !seen.has(t.key) && (seen.add(t.key), t.cases.some((c) => c.fields.some((x) => holds(x.t, seen)))));
    const mapped = (t: LType, to: LType, v: SExpr, caps: SExpr[]): SExpr => {
      if (t === st) return { k: "call", fn: gi, args: [v, ...caps], tail: false };
      if (!holds(t)) return v;
      if (!isData(t) || !isData(to) || t.cases.length !== to.cases.length) throw new Refused(`folds over data inside ${isData(t) ? t.name : OTHER} (a nested fold)`);
      return { k: "call", fn: mapper(t, to), args: [v, ...caps], tail: false };
    };
    const mapper = (t: DType, to: DType): number => {
      const key = `${t.key}>${to.key}`;
      if (maps.has(key)) return maps.get(key)!;
      const ps = [t, ...params.slice(1)];
      const m: SFunc = { def: id, name: `${f.name}.fold.${t.name}`, params: ps, result: to, locals: [...ps], body: { k: "num", v: 0 }, spends: false, budgeted: false, inner: true };
      maps.set(key, funcs.push(m) - 1);
      const x: SExpr = { k: "local", i: 0 }, caps = free.map((_, j): SExpr => ({ k: "local", i: j + 1 }));
      m.body = { k: "case", scrut: x, s: 0, t, result: to, arms: t.cases.map((c, ci): SExpr =>
        ({ k: "new", t: to, c: ci, args: c.fields.map((y, j) => mapped(y.t, to.cases[ci].fields[j].t, { k: "field", rec: x, t, c: ci, i: j }, caps)) })) };
      return maps.get(key)!;
    };
    const bodies = st.cases.map((c, ci): SExpr | null => {
      const a = arms.find((x) => x.variant === c.variant);
      if (!a) return null;
      let inner = new Map(genv);
      const lets: { i: number; value: SExpr }[] = [];
      const bind = (b: Id, t: LType, value: SExpr) => { const i = g.locals.push(t) - 1; inner = new Map(inner).set(b, i); lets.push({ i, value }); };
      a.binds.forEach((b, j) => bind(b, c.fields[j].t, { k: "field", rec: scrut, t: st, c: ci, i: j }));
      a.results.forEach((r, j) => {
        if (!r) return;
        if (c.fields[j].t !== st) {
          const to = stype(zonk(r));
          if (!to) throw new Refused(`has a fold whose value is ${OTHER}`);
          return bind(r, to, mapped(c.fields[j].t, to, { k: "field", rec: scrut, t: st, c: ci, i: j }, captured));
        }
        const call: Extract<SExpr, { k: "call" }> = { k: "call", fn: gi, args: [{ k: "field", rec: scrut, t: st, c: ci, i: j }, ...captured], tail: false };
        // A result used once is computed where it's used, so an arm that
        // doesn't need it (insert, once it found the place) stops there.
        // Outside a budget nothing can tell; under one, the evaluator's
        // order is kept, so the count is the same.
        // (Not from inside a fold in the arm: that's a function of its own.)
        const uses = refsIn(a.body).filter((x) => x === r).length;
        if (!underBudget && uses <= 1 && refsIn(a.body, false).filter((x) => x === r).length === uses) inlined.set(r, call);
        else bind(r, result, call);
      });
      return lets.reduceRight<SExpr>((body, l) => ({ k: "let", i: l.i, value: l.value, body }), expr(a.body, inner, g, true));
    });
    g.body = { k: "case", scrut, s: 0, t: st, arms: bodies, result };
    // Partial when anything in it fails, the mappers' calls of it included.
    for (let more = true; more;) {
      more = false;
      for (const h of [g, ...[...maps.values()].map((i) => funcs[i])]) if (!h.partial && fails(h.body, funcs)) more = h.partial = true;
    }
    return { k: "call", fn: gi, args: [expr(n.scrutinee, env, f, false), ...outside], tail };
  }
  // The stack of a fold run as a loop: the values on the way down, newest
  // first. A data type of the lowering's own, which the host never sees.
  function framesOf(st: DType): DType {
    const key = `${st.key}.frames`;
    if (datas.has(key)) return datas.get(key)!;
    const d: DType = { key, name: `${st.name}.frames`, def: st.def, cases: [], inner: true };
    d.cases.push({ variant: `${key}.done`, name: "done", fields: [] }, { variant: `${key}.frame`, name: "frame", fields: [{ name: "value", t: st }, { name: "next", t: d }] });
    datas.set(key, d);
    return d;
  }
  // A fold whose arms each fold at most one child (a list, a chain) as a
  // loop, the evaluator's own order: `down` walks to the end, keeping
  // each value it passes on a stack, and computes the arm that folds
  // nothing; `up` takes the stack back, giving each value's arm the
  // result so far. Both are tail calls, so a list of any length folds in
  // constant stack, as in the evaluator and the JS backend.
  function loop(st: DType, result: LType, arms: NodeOf<"arm">[], free: Id[], env: Map<Id, number>, f: SFunc): number {
    const frames = framesOf(st);
    const caps = free.map((b) => f.locals[env.get(b)!]);
    const mk = (suffix: string, params: LType[]): [SFunc, number] => {
      const g: SFunc = { def: arms[0]?.id ?? st.def, name: `${f.name}.fold.${suffix}`, params, result, locals: [...params], body: { k: "num", v: 0 }, spends: false, budgeted: false, inner: true };
      return [g, funcs.push(g) - 1];
    };
    const [down, di] = mk("down", [st, frames, ...caps]), [up, ui] = mk("up", [frames, result, ...caps]);
    const capsIn = (at: number): SExpr[] => free.map((_, j) => ({ k: "local", i: at + j }));
    // An arm's body for the value in local v of g, with the result so far
    // in local acc (when it folds a child).
    const arm = (g: SFunc, a: NodeOf<"arm">, ci: number, v: number, acc: number | null): SExpr => {
      let inner = new Map(free.map((b, j) => [b, 2 + j]));
      const lets: { i: number; value: SExpr }[] = [];
      a.binds.forEach((b, j) => {
        const i = g.locals.push(st.cases[ci].fields[j].t) - 1;
        inner = new Map(inner).set(b, i);
        lets.push({ i, value: { k: "field", rec: { k: "local", i: v }, t: st, c: ci, i: j } });
      });
      const r = a.results.find((x) => x);
      if (r && acc !== null) inner = new Map(inner).set(r, acc);
      return lets.reduceRight<SExpr>((body, l) => ({ k: "let", i: l.i, value: l.value, body }), expr(a.body, inner, g, false));
    };
    const armOf = (ci: number) => arms.find((x) => x.variant === st.cases[ci].variant);
    down.body = {
      k: "case", scrut: { k: "local", i: 0 }, s: 0, t: st, result,
      arms: st.cases.map((_, ci): SExpr | null => {
        const a = armOf(ci);
        if (!a) return null;
        const j = a.results.findIndex((x) => x);
        if (j < 0) return { k: "call", fn: ui, args: [{ k: "local", i: 1 }, arm(down, a, ci, 0, null), ...capsIn(2)], tail: true };
        const deeper: SExpr = { k: "field", rec: { k: "local", i: 0 }, t: st, c: ci, i: j };
        return { k: "call", fn: di, args: [deeper, { k: "new", t: frames, c: 1, args: [{ k: "local", i: 0 }, { k: "local", i: 1 }] }, ...capsIn(2)], tail: true };
      }),
    };
    // up: the stack's top value, then its arm with the result so far.
    const v = up.locals.push(st) - 1;
    up.body = {
      k: "case", scrut: { k: "local", i: 0 }, s: 0, t: frames, result,
      arms: [
        { k: "local", i: 1 },
        {
          k: "let", i: v, value: { k: "field", rec: { k: "local", i: 0 }, t: frames, c: 1, i: 0 },
          body: {
            k: "call", fn: ui, tail: true,
            args: [
              { k: "field", rec: { k: "local", i: 0 }, t: frames, c: 1, i: 1 },
              { k: "case", scrut: { k: "local", i: v }, s: v, t: st, result, arms: st.cases.map((_, ci) => { const a = armOf(ci); return a && a.results.some((x) => x) ? arm(up, a, ci, v, 1) : null; }) },
              ...capsIn(2),
            ],
          },
        },
      ],
    };
    if (fails(down.body, funcs) || fails(up.body, funcs)) down.partial = up.partial = true;
    return di;
  }
  // A fold over `characters(t)` whose arms don't use the rest of the list
  // itself: no list, and no stack. Its result is the arm for the end,
  // then each character's arm from the last to the first, the order the
  // loop above takes them; one function, t and the byte position of the
  // characters still to go, a tail call per character. (Fusion: Wadler's
  // deforestation, as the JS backend does with G16.)
  function characters(st: DType, result: LType, arms: NodeOf<"arm">[], free: Id[], env: Map<Id, number>, f: SFunc): { fn: number; start: SExpr } | null {
    const nil = arms.find((a) => !a.results.some((x) => x)), cons = arms.find((a) => a.results.some((x) => x));
    if (!nil || !cons || arms.length !== 2) return null;
    const ci = st.cases.findIndex((c) => c.variant === cons.variant), c = st.cases[ci];
    const head = c.fields.findIndex((x) => x.t !== st), tail = c.fields.findIndex((x) => x.t === st);
    if (head < 0 || tail < 0 || st.cases.length !== 2) return null;
    if (cons.binds[tail] && refsIn(cons.body).includes(cons.binds[tail]!)) return null;
    const caps = free.map((b) => f.locals[env.get(b)!]);
    const params: LType[] = ["text", "i32", result, ...caps];
    const g: SFunc = { def: cons.id, name: `${f.name}.fold.characters`, params, result, locals: [...params], body: { k: "num", v: 0 }, spends: false, budgeted: false, inner: true };
    const gi = funcs.push(g) - 1;
    let inner = new Map(free.map((b, j) => [b, 3 + j]));
    const from = g.locals.push("i32") - 1, x = g.locals.push("text") - 1;
    if (cons.binds[head]) inner = new Map(inner).set(cons.binds[head]!, x);
    inner = new Map(inner).set(cons.results[tail]!, 2);
    const t: SExpr = { k: "local", i: 0 }, at: SExpr = { k: "local", i: 1 };
    g.body = {
      k: "if", t: result, cond: { k: "op", op: "not", args: [at] }, then: { k: "local", i: 2 },
      else: {
        k: "let", i: from, value: { k: "rt", fn: "text.before", args: [t, at] },
        body: {
          k: "let", i: x, value: { k: "rt", fn: "text.bytes", args: [t, { k: "local", i: from }, at] },
          body: { k: "call", fn: gi, args: [t, { k: "local", i: from }, expr(cons.body, inner, g, false), ...free.map((_, j): SExpr => ({ k: "local", i: 3 + j }))], tail: true },
        },
      },
    };
    if (fails(g.body, funcs)) g.partial = true;
    // The end's arm, where the fold is (it binds nothing of the list's).
    return { fn: gi, start: expr(nil.body, env, f, false) };
  }
  // What p's type variables stand for, where c is p at known types.
  function bindVars(p: Type, c: Type, types: At) {
    if (p.t === "var") { if (c.t !== "var" && !types.has(p.v)) types.set(p.v, c); }
    else if (p.t === "con" && c.t === "con") p.args.forEach((a, j) => c.args[j] && bindVars(a, c.args[j], types));
    else if (p.t === "fn" && c.t === "fn") { p.params.forEach((a, j) => c.params[j] && bindVars(a, c.params[j], types)); bindVars(p.ret, c.ret, types); bindRow(p.eff, c.eff, types); }
  }
  // p's row variable stands for the effects c has beyond p's own.
  function bindRow(p: Row, c: Row, types: At) {
    const r = info.subst.resolveRow(p);
    if (r.tail === null || types.has(r.tail)) return;
    const cr = info.subst.resolveRow(c);
    const effs = cr.effs.filter((e) => !r.effs.includes(e));
    if (effs.length) types.set(r.tail, { effs, tail: null });
  }
  // The binders a piece of the program refers to (inside its folds too, or not).
  function refsIn(id: Id, folds = true): Id[] {
    const n = code.nodes[id], all = (ids: Id[]) => ids.flatMap((x) => refsIn(x, folds));
    switch (n?.kind) {
      case "ref": return [n.target];
      case "call": return all([n.fn, ...n.args]);
      case "lambda": case "arm": return all([n.body]);
      case "match": return all([n.scrutinee, ...n.arms, ...(n.otherwise ? [n.otherwise] : [])]);
      case "fold": return all(folds ? [n.scrutinee, ...n.arms] : [n.scrutinee]);
      case "solve": return all([...Object.values(n.given), n.body]);
      default: return [];
    }
  }

  // A value of `variant` at type t, from its fields' values.
  function build(variant: Id, t: Type, args: SExpr[]): SExpr {
    const r = stype(t);
    if (r && isData(r)) {
      const c = r.cases.findIndex((x) => x.variant === variant);
      if (c >= 0) return { k: "new", t: r, c, args };
    }
    if (r && isRecord(r) && r.variant === variant) return { k: "make", t: r, args };
    throw new Refused(`builds ${nm(variant)}, which isn't ${opts.data ? "data" : "a record"} of Numbers and Bools`);
  }

  // Whether a call of first is first(() => with fuel(…), …), a budget.
  function isBudget(n: NodeOf<"call">): boolean {
    const a = n.args[0] ? code.nodes[n.args[0]] : undefined;
    const body = a?.kind === "lambda" && !a.params.length ? code.nodes[a.body] : null;
    return (code.nodes[n.fn] as NodeOf<"ref">).target === S.first && body?.kind === "call" && code.nodes[body.fn]?.kind === "ref" && (code.nodes[body.fn] as NodeOf<"ref">).target === S.fuel;
  }
  // first, optional, all and count of a search written in place: the
  // search, lowered with `one of` where it chooses, and what the handler
  // makes of its answers. Once everything it calls is lowered, the pass
  // below (several) makes it code.
  function attempt(n: NodeOf<"call">, id: Id, env: Map<Id, number>, f: SFunc): SExpr {
    const target = (code.nodes[n.fn] as NodeOf<"ref">).target;
    const thunk = (x: Id | undefined) => { const l = x && code.nodes[x]; return l && l.kind === "lambda" && !l.params.length ? l.body : null; };
    const search = thunk(n.args[0]), dflt = target === S.first ? thunk(n.args[1]) : null;
    if (!search || (target === S.first && !dflt)) throw new Refused(`uses ${nm(target)} on a search that isn't written in place (as () => …)`);
    const t = stype(zonk(id)), bt = stype(zonk(search));
    if (!t || !bt) throw new Refused(`searches for ${whyNot(zonk(t ? search : id))}`);
    const kind = target === S.first ? "first" : target === S.optional ? "optional" : target === S.all ? "all" : "count";
    const body = expr(search, env, f, false);
    return { k: "search", kind, body, res: f.locals.push(bt) - 1, t, bt, ...(dflt ? { dflt: expr(dflt, env, f, false) } : {}) };
  }

  // ---- searches with several answers (projectional/WASM.md, W4d)
  //
  // A function that chooses (`one of`), or calls one that does, outside
  // a handler, has several answers. It's lowered as the JS backend's `$k`
  // copies are (COMPILER.md, "Searches in continuation-passing style"),
  // which is how Mercury's high-level C backend compiles nondeterministic
  // code (Henderson and Somogyi, CC 2002): it takes the rest of the search,
  // k, as one more input, and calls it on each answer in turn. k gives
  // "stop" as an answer, or "go on" as no answer (status 1), so a choice
  // is a loop that tries k on each item until one stops, and `fail` is
  // just going on. A handler's k puts each answer in a box it made: first
  // stops at the first, all keeps going and adds each one.
  //
  // The rest of a search (Cont.gen) is code, made where the answer is,
  // into the function at hand; when it has to go into a loop, a closure
  // or a join of its own, it's moved there (its locals renumbered), taking
  // the locals it reads as inputs or captures.
  type Cont = { gen: (v: SExpr, tail: boolean) => SExpr; direct?: SExpr };
  const closureCode = new Set<number>();
  const kOf = (t: LType): FType => {
    const key = `fn(${keyOf(t)})>i32!`;
    if (!fns.has(key)) fns.set(key, { key, params: [t], result: "i32", partial: true });
    return fns.get(key)!;
  };
  const boxOf = (t: LType): RType => {
    const key = `box:${keyOf(t)}`;
    if (!records.has(key)) records.set(key, { key, name: "Box", def: key, variant: key, fields: [{ name: "value", t }], mutable: true });
    return records.get(key)!;
  };
  const local = (i: number): SExpr => ({ k: "local", i });
  // Whether e has several answers: it chooses, or calls a function that
  // does, outside a handler (whose search, and its default, are its own).
  function several(e: SExpr): boolean {
    if (e.k === "choose") return true;
    if (e.k === "call" && !e.cps && funcs[e.fn].multi) return true;
    if (e.k === "search") return !!e.dflt && several(e.dflt);
    if (e.k === "budget" && several(e.body)) throw new Refused("chooses among several answers under a budget (not in WebAssembly yet)");
    if (e.k === "handle" && several(e.body)) throw new Refused("handles Abort around a search with several answers (not in WebAssembly yet)");
    return kids(e).some(several);
  }
  // A tail call inside e isn't one once e is a value in the rest of a search.
  const untail = (e: SExpr): SExpr => { const r = mapKids(e, untail); return r.k === "call" || r.k === "apply" ? { ...r, tail: false } : r; };
  const trivial = (e: SExpr) => ["local", "num", "int", "bool", "text"].includes(e.k);
  // The type of e's value, in g.
  function typeIn(e: SExpr, g: SFunc): LType {
    switch (e.k) {
      case "local": return g.locals[e.i];
      case "num": return "f64";
      case "int": return "int";
      case "bool": case "tag": return "i32";
      case "text": return "text";
      case "op": return OPS[e.op].t;
      case "call": return funcs[e.fn].multi ? "i32" : funcs[e.fn].result;
      case "make": case "new": case "closure": case "world": case "if": case "attempt": case "handle": case "budget": case "search": case "choose": case "zero": return e.k === "choose" ? e.t.cases.find((c) => c.variant === CONS)!.fields[0].t : e.t;
      case "get": return e.t.fields[e.i].t;
      case "field": return e.t.cases[e.c].fields[e.i].t;
      case "apply": return e.t.result;
      case "case": return e.result;
      case "let": return typeIn(e.body, g);
      case "set": return typeIn(e.then, g);
      case "rt": { const r = runtime(e.fn).result; if (r === "i32" || r === "int" || r === "f64" || r === "text") return r; break; }
    }
    throw new Refused("chooses after a value it can't keep (not in WebAssembly yet)");
  }
  // code, made in g, moved into h: `fixed` says where the locals it reads
  // from g are in h; the ones it sets get new locals there.
  function move(e: SExpr, g: SFunc, h: SFunc, fixed: Map<number, number>): SExpr {
    const m = new Map(fixed);
    return mapLocals(e, (i) => { if (!m.has(i)) m.set(i, h.locals.push(g.locals[i]) - 1); return m.get(i)!; });
  }
  // A function of its own for the rest of a search, given what it reads:
  // `first` its first inputs, then those locals.
  function apart(g: SFunc, name: string, first: LType[], code: SExpr, bound: number[]) {
    const free = freeLocals(code).filter((i) => !bound.includes(i));
    const params = [...first, ...free.map((i) => g.locals[i])];
    const h: SFunc = { def: g.def, name: `${g.name.replace(/\.(choose|k|join)$/, "")}.${name}`, params, result: "i32", locals: [...params], body: { k: "num", v: 0 }, spends: false, budgeted: false, inner: true, partial: true };
    const hi = funcs.push(h) - 1;
    return { h, hi, free, fixed: new Map(free.map((i, j) => [i, first.length + j] as const)), passed: free.map(local) };
  }
  // The rest of the search for v of type t: k itself, or a join that
  // takes v, made once, for the arms of a match or an if.
  function join(k: Cont, t: LType, g: SFunc, uses: number): Cont {
    if (k.direct || uses <= 1) return k;
    const v = g.locals.push(t) - 1;
    const code = k.gen(local(v), true);
    const j = apart(g, "join", [t], code, [v]);
    j.fixed.set(v, 0);
    j.h.body = move(code, g, j.h, j.fixed);
    return { gen: (x, tail) => ({ k: "call", fn: j.hi, args: [x, ...j.passed], tail }) };
  }
  // `one of` list: a loop over it that tries the rest of the search on
  // each item until that stops.
  function choose(list: SExpr, lt: DType, k: Cont, tail: boolean, g: SFunc): SExpr {
    const cons = lt.cases.findIndex((c) => c.variant === CONS), et = lt.cases[cons].fields[0].t;
    const x = g.locals.push(et) - 1;
    const code = k.gen(local(x), false);
    const l = apart(g, "choose", [lt], code, [x]);
    const head = l.h.locals.push(et) - 1, rest = l.h.locals.push(lt) - 1, res = l.h.locals.push("i32") - 1;
    l.fixed.set(x, head);
    const moved = move(code, g, l.h, l.fixed);
    const scrut = local(0);
    const again: SExpr = { k: "call", fn: l.hi, args: [local(rest), ...l.free.map((_, j) => local(1 + j))], tail: true };
    l.h.body = {
      k: "case", scrut, s: 0, t: lt, result: "i32",
      arms: lt.cases.map((_, c): SExpr => (c !== cons ? { k: "fail" } : {
        k: "let", i: head, value: { k: "field", rec: scrut, t: lt, c, i: 0 },
        body: { k: "let", i: rest, value: { k: "field", rec: scrut, t: lt, c, i: 1 }, body: { k: "attempt", body: moved, res, ok: local(res), otherwise: again, t: "i32" } },
      })),
    };
    return { k: "call", fn: l.hi, args: [list, ...l.passed], tail };
  }
  // A call of a function with several answers: the rest of the search as
  // a closure (or the caller's own k, when the call is all that's left).
  function callSeveral(fn: number, args: SExpr[], k: Cont, tail: boolean, g: SFunc): SExpr {
    const t = funcs[fn].answer!, kt = kOf(t);
    let kv = k.direct;
    if (!kv) {
      const v = g.locals.push(t) - 1;
      const code = k.gen(local(v), true);
      const free = freeLocals(code).filter((i) => i !== v);
      const shape = shapes.push({ t: kt, caps: free.map((i) => g.locals[i]) }) - 1;
      const c: SFunc = { def: g.def, name: `${g.name.replace(/\.(choose|k|join)$/, "")}.k`, params: [kt, t], result: "i32", locals: [kt, t], body: { k: "num", v: 0 }, spends: false, budgeted: false, inner: true, partial: true };
      const ci = funcs.push(c) - 1;
      const fixed = new Map([[v, 1]]);
      const lets = free.map((i, j) => { const l = c.locals.push(g.locals[i]) - 1; fixed.set(i, l); return { i: l, value: { k: "cap", t: kt, shape, i: j } as SExpr }; });
      c.body = lets.reduceRight<SExpr>((body, l) => ({ k: "let", i: l.i, value: l.value, body }), move(code, g, c, fixed));
      kv = { k: "closure", t: kt, fn: ci, shape, caps: free.map(local) };
    }
    return { k: "call", fn, args: [...args, kv], tail, cps: true };
  }
  // es in order, then done with their values: those before one with
  // several answers go into locals first, so they're computed once, first.
  function inOrder(es: SExpr[], done: (vs: SExpr[], tail: boolean) => SExpr, tail: boolean, g: SFunc): SExpr {
    const m = es.findIndex(several);
    if (m < 0) return done(es.map(untail), tail);
    const lets: { i: number; value: SExpr }[] = [];
    const before = es.slice(0, m).map((e) => {
      if (trivial(e)) return e;
      const i = g.locals.push(typeIn(e, g)) - 1;
      lets.push({ i, value: untail(e) });
      return local(i);
    });
    const rest = cps(es[m], { gen: (v, tl) => inOrder(es.slice(m + 1), (ws, tl2) => done([...before, v, ...ws], tl2), tl, g) }, tail, g);
    return lets.reduceRight<SExpr>((body, l) => ({ k: "let", i: l.i, value: l.value, body }), rest);
  }
  // e, with k on each of its answers: code giving what k gives.
  function cps(e: SExpr, k: Cont, tail: boolean, g: SFunc): SExpr {
    if (!several(e)) return k.gen(untail(e), tail);
    const arms = (xs: (SExpr | null)[]) => xs.filter((x) => x && x.k !== "fail").length;
    switch (e.k) {
      case "choose": return inOrder([e.list], ([l], tl) => choose(l, e.t, k, tl, g), tail, g);
      case "call": if (funcs[e.fn].multi && !e.cps) return inOrder(e.args, (vs, tl) => callSeveral(e.fn, vs, k, tl, g), tail, g); break;
      case "let":
        if (several(e.value)) return cps(e.value, { gen: (v, tl) => ({ k: "let", i: e.i, value: v, body: cps(e.body, k, tl, g) }) }, tail, g);
        return { k: "let", i: e.i, value: untail(e.value), body: cps(e.body, k, tail, g) };
      case "if": {
        if (several(e.cond)) return cps(e.cond, { gen: (c, tl) => cps({ ...e, cond: c }, k, tl, g) }, tail, g);
        const j = join(k, e.t, g, arms([e.then, e.else]));
        return { k: "if", cond: e.cond, then: cps(e.then, j, tail, g), else: cps(e.else, j, tail, g), t: "i32" };
      }
      case "case": {
        if (several(e.scrut)) return cps(e.scrut, { gen: (v, tl) => cps({ ...e, scrut: v }, k, tl, g) }, tail, g);
        const j = join(k, e.result, g, arms(e.arms));
        return { ...e, arms: e.arms.map((a) => a && cps(a, j, tail, g)), result: "i32" };
      }
      case "attempt": {
        if (several(e.body)) break;
        const j = join(k, e.t, g, arms([e.ok, e.otherwise]));
        return { ...e, ok: cps(e.ok, j, tail, g), otherwise: cps(e.otherwise, j, tail, g), t: "i32" };
      }
    }
    if (["op", "call", "make", "new", "rt", "world", "get", "field", "tag", "apply", "abort"].includes(e.k)) {
      return inOrder(kids(e), (vs, tl) => { let j = 0; return k.gen(untail(mapKids(e, () => vs[j++])), tl); }, tail, g);
    }
    throw new Refused("chooses among several answers where WebAssembly can't yet");
  }
  // A handler's search, now that it's known whether it has several answers.
  function handled(e: Extract<SExpr, { k: "search" }>, g: SFunc): SExpr {
    const caseOf = (d: LType, v: Id) => (isData(d) ? d.cases.findIndex((c) => c.variant === v) : -1);
    const d = e.t as DType;
    const made = (v: Id, args: SExpr[]): SExpr => ({ k: "new", t: d, c: caseOf(d, v), args });
    const dflt = (): SExpr => e.dflt ?? { k: "fail" };
    if (!several(e.body)) {
      // One answer or none.
      const answer = local(e.res);
      const [ok, otherwise]: [SExpr, SExpr] = e.kind === "first" ? [answer, dflt()] : e.kind === "count" ? [{ k: "num", v: 1 }, { k: "num", v: 0 }]
        : e.kind === "optional" ? [made(SOME, [answer]), made(NONE, [])] : [made(CONS, [answer, made(NIL, [])]), made(NIL, [])];
      return { k: "attempt", body: e.body, res: e.res, ok, otherwise, t: e.t };
    }
    const acc: LType = e.kind === "count" ? "f64" : e.kind === "all" ? e.t : e.bt, box = boxOf(acc);
    const b = g.locals.push(box) - 1, got: SExpr = { k: "get", rec: local(b), t: box, i: 0 };
    const set = (value: SExpr, then: SExpr): SExpr => ({ k: "set", rec: local(b), t: box, i: 0, value, then });
    const keep: Cont["gen"] = e.kind === "first" || e.kind === "optional" ? (v) => set(v, { k: "bool", v: true })
      : e.kind === "all" ? (v) => set(made(CONS, [v, got]), { k: "fail" })
      // count: the answer is still computed, since it may turn out to be none.
      : (v) => ({ k: "let", i: g.locals.push(e.bt) - 1, value: v, body: set({ k: "op", op: "add", args: [got, { k: "num", v: 1 }] }, { k: "fail" }) });
    const start: SExpr = e.kind === "count" ? { k: "num", v: 0 } : e.kind === "all" ? made(NIL, []) : { k: "zero", t: acc };
    const run = cps(e.body, { gen: keep }, false, g), r = g.locals.push("i32") - 1;
    const back: SExpr = { k: "call", fn: e.kind === "all" ? reverse(d) : -1, args: [got, made(NIL, [])], tail: false };
    const [ok, otherwise]: [SExpr, SExpr] = e.kind === "first" ? [got, dflt()] : e.kind === "optional" ? [made(SOME, [got]), made(NONE, [])] : e.kind === "all" ? [back, back] : [got, got];
    return { k: "let", i: b, value: { k: "make", t: box, args: [start] }, body: { k: "attempt", body: run, res: r, ok, otherwise, t: e.t } };
  }
  // The handlers' searches in e made code, innermost first.
  const handle = (e: SExpr, g: SFunc): SExpr => { const r = mapKids(e, (x) => handle(x, g)); return r.k === "search" ? handled(r, g) : r; };
  // After a root and what it calls are lowered: which have several
  // answers, then their code, and every handler's.
  function several_(from: number) {
    const end = funcs.length;
    for (let changed = true; changed;) {
      changed = false;
      for (let i = from; i < end; i++) if (!funcs[i].multi && several(funcs[i].body)) { funcs[i].multi = true; funcs[i].answer = funcs[i].result; changed = true; }
    }
    for (let i = from; i < end; i++) {
      const g = funcs[i];
      if (!g.multi) { g.body = handle(g.body, g); continue; }
      if (closureCode.has(i)) throw new Refused("makes a function that chooses among several answers (not in WebAssembly yet)");
      const p = g.params.length, kt = kOf(g.answer!);
      const body = mapLocals(g.body, (j) => (j < p ? j : j + 1));
      g.locals = [...g.locals.slice(0, p), kt, ...g.locals.slice(p)];
      g.params = [...g.params, kt];
      g.result = "i32";
      g.partial = true;
      g.inner = true;
      const k: Cont = { direct: local(p), gen: (v, tail) => ({ k: "apply", fn: local(p), t: kt, args: [v], tail, tmp: g.locals.push(kt) - 1 }) };
      g.body = cps(handle(body, g), k, true, g);
    }
  }
  // A function whose answer, somewhere it ends, is cons(x, itself(…))
  // (ledger's entries) recurses once per item, so a long list runs out of
  // stack. Instead it keeps the items so far, newest first, in one more
  // input, so each such end is a tail call, and every other end gives
  // them turned round onto its answer: the same list, built in the same
  // order. (Tail recursion modulo cons, done by reversing rather than
  // filling holes, since WasmGC cells are immutable; the JS backend
  // fills holes, G22.)
  function modCons(from: number) {
    const end = funcs.length;
    for (let i = from; i < end; i++) {
      const g = funcs[i], t = g.result;
      if (g.multi || g.spends || g.budgeted || closureCode.has(i) || !isData(t)) continue;
      const cons = t.cases.findIndex((c) => c.variant === CONS), nil = t.cases.findIndex((c) => c.variant === NIL);
      if (cons < 0 || nil < 0) continue;
      const self = (e: SExpr): e is Extract<SExpr, { k: "new" }> => {
        if (e.k !== "new" || e.t.key !== t.key || e.c !== cons) return false;
        const last = e.args[e.args.length - 1];
        return last.k === "call" && last.fn === i && !last.cps;
      };
      const ends = (e: SExpr): boolean =>
        self(e) || (e.k === "let" && ends(e.body)) || (e.k === "if" && (ends(e.then) || ends(e.else))) || (e.k === "case" && e.arms.some((a) => a !== null && ends(a)));
      if (!ends(g.body)) continue;
      const p = g.params.length;
      const h: SFunc = { ...g, name: `${g.name}.onto`, params: [...g.params, t], locals: [...g.locals.slice(0, p), t, ...g.locals.slice(p)], inner: true, body: { k: "num", v: 0 } };
      const hi = funcs.push(h) - 1, acc: SExpr = { k: "local", i: p };
      const onto = (e: SExpr): SExpr => {
        switch (e.k) {
          case "let": return { ...e, body: onto(e.body) };
          case "if": return { ...e, then: onto(e.then), else: onto(e.else) };
          case "case": return { ...e, arms: e.arms.map((a) => (a === null ? null : onto(a))) };
          case "fail": case "abort": return e;
          case "call": if (e.fn === i && e.tail) return { ...e, fn: hi, args: [...e.args, acc] }; break;
          case "new": if (self(e)) {
            // Its other fields first, as written, then the call's inputs.
            const xs = e.args.slice(0, -1).map((x) => ({ i: h.locals.push(typeIn(x, h)) - 1, value: x }));
            const call = e.args[e.args.length - 1] as Extract<SExpr, { k: "call" }>;
            const body: SExpr = { k: "call", fn: hi, tail: true, args: [...call.args, { k: "new", t, c: cons, args: [...xs.map((x): SExpr => ({ k: "local", i: x.i })), acc] }] };
            return xs.reduceRight<SExpr>((b, x) => ({ k: "let", i: x.i, value: x.value, body: b }), body);
          }
        }
        return { k: "call", fn: reverse(t), tail: true, args: [acc, e] };
      };
      h.body = onto(mapLocals(g.body, (j) => (j < p ? j : j + 1)));
      g.body = { k: "call", fn: hi, tail: true, args: [...g.params.map((_, j): SExpr => ({ k: "local", i: j })), { k: "new", t, c: nil, args: [] }] };
    }
  }
  // A list turned round onto another, a loop.
  function reverse(d: DType): number {
    const key = `reverse:${d.key}`;
    if (index.has(key)) return index.get(key)!;
    const g: SFunc = { def: d.def, name: `${d.name}.reverse`, params: [d, d], result: d, locals: [d, d], body: { k: "num", v: 0 }, spends: false, budgeted: false, inner: true };
    const gi = funcs.push(g) - 1;
    index.set(key, gi);
    const cons = d.cases.findIndex((c) => c.variant === CONS), l: SExpr = { k: "local", i: 0 };
    g.body = { k: "case", scrut: l, s: 0, t: d, result: d, arms: d.cases.map((_, k): SExpr => (k !== cons ? { k: "local", i: 1 } : {
      k: "call", fn: gi, tail: true, args: [{ k: "field", rec: l, t: d, c: k, i: 1 }, { k: "new", t: d, c: k, args: [{ k: "field", rec: l, t: d, c: k, i: 0 }, { k: "local", i: 1 }] }],
    })) };
    return gi;
  }
  // value of(o): o's value if it's some, no answer if it's none.
  function valueOf(n: NodeOf<"call">, id: Id, env: Map<Id, number>, f: SFunc): SExpr {
    const d = stype(zonk(n.args[0])), t = stype(zonk(id));
    if (!d || !isData(d) || !t) throw new Refused(`takes the value of ${whyNot(zonk(d ? id : n.args[0]))}`);
    const s = f.locals.push(d) - 1, some = d.cases.findIndex((c) => c.variant === SOME);
    return { k: "case", scrut: expr(n.args[0], env, f, false), s, t: d, result: t, arms: d.cases.map((_, ci): SExpr => (ci === some ? { k: "field", rec: { k: "local", i: s }, t: d, c: ci, i: 0 } : { k: "fail" })) };
  }

  // first(() => with fuel(n, () => body), () => otherwise), and nothing
  // else made of those two.
  function budget(n: NodeOf<"call">, id: Id, env: Map<Id, number>, f: SFunc): SExpr {
    const thunk = (x: Id | undefined) => { const l = x && code.nodes[x]; return l && l.kind === "lambda" && !l.params.length ? l.body : null; };
    const action = thunk(n.args[0]), otherwise = thunk(n.args[1]);
    const inner = action ? code.nodes[action] : null;
    const head = inner?.kind === "call" ? code.nodes[inner.fn] : null;
    const shape = `only as a budget, ${BUDGET}`;
    if ((code.nodes[n.fn] as NodeOf<"ref">).target !== S.first || !action || !otherwise || inner?.kind !== "call" || head?.kind !== "ref" || head.target !== S.fuel || inner.args.length !== 2)
      throw new Refused(`uses first or with fuel, which a shader takes ${shape}`);
    // A number written down, rounded to Float32 maybe (NUMBERS.md).
    const rounded = code.nodes[inner.args[0]];
    const under = rounded?.kind === "call" && code.nodes[rounded.fn]?.kind === "ref" && (code.nodes[rounded.fn] as NodeOf<"ref">).target === S.float32 && rounded.args.length === 1;
    const amount = under ? code.nodes[(rounded as NodeOf<"call">).args[0]] : rounded, body = thunk(inner.args[1]);
    if (!body) throw new Refused(`uses with fuel, which a shader takes ${shape}`);
    if (amount?.kind !== "lit" || typeof amount.value !== "number") throw new Refused("has a budget that isn't a number written down (a shader's bound is fixed when it's built)");
    const v = under ? Math.fround(amount.value) : amount.value;
    if (!(v >= 0 && v <= MAX_FUEL && Math.fround(v) === v)) throw new Refused(`has a budget of ${v} (a shader's is a number from 0 to ${MAX_FUEL})`);
    const t = stype(zonk(id));
    if (!t) throw new Refused(`has a budget whose value is ${OTHER}`);
    const save = f.locals.push("f64") - 1, res = f.locals.push(t) - 1;
    const outer = underBudget;
    underBudget = true;
    let inside: SExpr;
    try { inside = expr(body, env, f, false); } finally { underBudget = outer; }
    return { k: "budget", n: v, body: inside, otherwise: expr(otherwise, env, f, false), t, save, res };
  }

  // A root that may not finish is refused as a place to start, even when
  // it was lowered to be called from under a budget.
  const unstarted = new Map<Id, string>();
  // map parts, zip parts and total: the function applied to each part, as
  // the record's fields would be written by hand. A part that is already
  // an expression (the record was just built) is used as it is; otherwise
  // the record goes in a local first, so it's computed once.
  function parts(n: NodeOf<"call">, env: Map<Id, number>, f: SFunc): SExpr {
    const target = (code.nodes[n.fn] as NodeOf<"ref">).target;
    const recs = target === S.total ? n.args : n.args.slice(1);
    const t = stype(zonk(recs[0]));
    if (t !== "f64" && (!t || !isRecord(t) || t.fields.some((x) => x.t !== "f64"))) throw new Refused(`takes the parts of something that isn't a record of Numbers`);
    const lets: { i: number; value: SExpr }[] = [];
    const partsOf = (id: Id): SExpr[] => {
      const e = expr(id, env, f, false);
      if (t === "f64") return [e];
      if (e.k === "make") return e.args;
      let rec = e;
      if (e.k !== "local") { const i = f.locals.push(t) - 1; lets.push({ i, value: e }); rec = { k: "local", i }; }
      return t.fields.map((_, j) => ({ k: "get", rec, t, i: j }));
    };
    const ps = recs.map(partsOf);
    const width = ps[0].length;
    let out: SExpr;
    if (target === S.total) out = ps[0].reduce((a, b) => ({ k: "op", op: "add", args: [a, b] }));
    else {
      const fnId = n.args[0], fnNode = code.nodes[fnId];
      const each = (j: number): SExpr => {
        const xs = ps.map((p) => p[j]);
        if (fnNode.kind === "lambda") {
          if (fnNode.params.length !== xs.length) throw new Refused("applies a function to the wrong number of inputs");
          let inner = new Map(env);
          const ls = fnNode.params.map((p, k) => { const i = f.locals.push("f64") - 1; inner = new Map(inner).set(p, i); return { i, value: xs[k] }; });
          return ls.reduceRight<SExpr>((body, l) => ({ k: "let", i: l.i, value: l.value, body }), expr(fnNode.body, inner, f, false));
        }
        if (fnNode.kind === "ref" && scalarOp(fnNode.target)) return { k: "op", op: scalarOp(fnNode.target)!, args: xs };
        if (fnNode.kind === "ref" && code.nodes[fnNode.target]?.kind === "def") return { k: "call", fn: func(fnNode.target), args: xs, tail: false };
        throw new Refused("takes the parts with a function that isn't written here (that needs closures)");
      };
      const results = Array.from({ length: width }, (_, j) => each(j));
      out = t === "f64" ? results[0] : { k: "make", t, args: results };
    }
    return lets.reduceRight<SExpr>((body, l) => ({ k: "let", i: l.i, value: l.value, body }), out);
  }

  for (const r of roots) {
    const from = funcs.length, shaped = shapes.length;
    try { func(r); several_(from); modCons(from); } catch (e) {
      if (!(e instanceof Refused)) throw e;
      if (funcs.length > from && index.get(r) !== undefined && index.get(r)! >= from) {
        // Refused making its searches: undo it, and what was lowered with it.
        funcs.splice(from);
        shapes.splice(shaped);
        for (const [d2, j] of index) if (j >= from) index.delete(d2);
        for (const j of closureCode) if (j >= from) closureCode.delete(j);
        refused.set(r, e.message);
      } else if (!refused.has(r)) unstarted.set(r, e.message.replace(`calls ${nm(r)}, which `, ""));
    }
  }
  for (const [r, why] of unstarted) if (!refused.has(r)) refused.set(r, why);
  // Refusals by definition; those of one specialization stay inside.
  return { funcs, refused: new Map([...refused].filter(([k]) => !k.includes("|"))), records: [...records.values()], data: [...datas.values()], fns: [...fns.values()], shapes, code, info };
}
