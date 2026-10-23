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

import type { Code, Id, NodeOf } from "../../projectional/src/model.ts";
import type { Names } from "../../projectional/src/presentation.ts";
import type { Info } from "../../projectional/src/lang/infer.ts";
import { CHOICE, CONSOLE, DIVERGE, FILES, INT, NUMBER, STRING, type Row, type Type } from "../../projectional/src/lang/types.ts";
import { ABORT, ABORT_OP, BOOL, CONS, FALSE, INT_OPS, IO, NIL, NONE, S, SOME, TEXT_OPS, TRUE } from "../../projectional/src/lang/std.ts";
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
export interface RType { key: string; name: string; def: Id; variant: Id; case?: string; fields: { name: string; t: LType }[] }
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
// Int and Text (`data`): an i64, and UTF-8 bytes (wasm-rt.ts).
export type WType = "i64" | "text";
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
    default: return [];
  }
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
  | { k: "call"; fn: number; args: SExpr[]; tail: boolean }
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
  | { k: "handle"; body: SExpr; reason: number; arm: SExpr; t: LType; save: number };

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
export interface SFunc { def: Id; name: string; params: LType[]; result: LType; locals: LType[]; body: SExpr; spends: boolean; budgeted: boolean; inner?: boolean; partial?: boolean }
// `code` and `info` are the program that was lowered: the one given, or
// a copy with its derivatives generated, where funcs[i].def lives.
export interface Lowered { funcs: SFunc[]; refused: Map<Id, string>; records: RType[]; data: DType[]; fns: FType[]; shapes: Shape[]; code: Code; info: Info }

class Refused extends Error {}

// The largest budget: counts are kept in f32 on a GPU, whole up to 2^24.
export const MAX_FUEL = 2 ** 24;
const BUDGET = "first(() => with fuel(n, () => …), () => …)";
const MAY_NOT_FINISH = `may not finish (its type has Diverge): on a GPU that hangs the page, so run it under a budget, ${BUDGET}`;

export function lowerScalar(code: Code, info: Info, names: Names, roots: Id[], opts: { records?: boolean; data?: boolean } = {}): Lowered {
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
    if (opts.data && t.id === INT) return "i64";
    if (opts.data && t.id === STRING) return "text";
    if (!opts.records) return null;
    const key = `${t.id}<${t.args.map(show).join(",")}>`;
    if (records.has(key)) return records.get(key)!;
    if (datas.has(key)) return datas.get(key)!;
    if (inside.includes(t.id)) return null;
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
        if (t === "i64") return { k: "int", v: BigInt(n.value) };
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
          return { k: "call", fn: func(n.target), args: [], tail };
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
    if (t === "i64") return { k: "rt", fn: "int.equal", args: [x, y] };
    if (t === "text") return { k: "rt", fn: "text.equal", args: [x, y] };
    if (t !== "f64") return { k: "call", fn: equality(t), args: [x, y], tail };
    // Two whole numbers exactly, any other pair within 1e-9 relative to
    // their size (run.ts sameNumber). Each side once: a local if it isn't
    // one already.
    const lets: { i: number; value: SExpr }[] = [];
    const [a, b] = [x, y].map((value): SExpr => {
      if (value.k === "local" || value.k === "num") return value;
      const i = f.locals.push("f64") - 1;
      lets.push({ i, value });
      return { k: "local", i };
    });
    const op = (o: Op, ...xs: SExpr[]): SExpr => ({ k: "op", op: o, args: xs });
    const num = (v: number): SExpr => ({ k: "num", v });
    const whole = (e: SExpr) => op("equal", op("floor", e), e);
    const diff = op("abs", op("sub", a, b)), tol = op("mul", num(1e-9), op("add", op("add", num(1), op("abs", a)), op("abs", b)));
    const near = op("or", op("equal", a, b), op("and", op("not", op("and", whole(a), whole(b))), op("or", op("less", diff, tol), op("equal", diff, tol))));
    return lets.reduceRight<SExpr>((body, l) => ({ k: "let", i: l.i, value: l.value, body }), near);
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
    for (const a of arms) a.results.forEach((r, j) => {
      const c = st.cases.find((x) => x.variant === a.variant)!;
      if (r && c.fields[j].t !== st) throw new Refused("folds over data inside other data (a nested fold isn't in WebAssembly yet)");
    });
    const outside = free.map((b): SExpr => ({ k: "local", i: env.get(b)! }));
    if (arms.every((a) => a.results.filter((r) => r).length <= 1)) return { k: "call", fn: loop(st, result, arms, free, env, f), args: [expr(n.scrutinee, env, f, false), { k: "new", t: framesOf(st), c: 0, args: [] }, ...outside], tail };
    const params = [st, ...free.map((b) => f.locals[env.get(b)!])];
    const g: SFunc = { def: id, name: `${f.name}.fold`, params, result, locals: [...params], body: { k: "num", v: 0 }, spends: false, budgeted: false, inner: true };
    const gi = funcs.push(g) - 1;
    const captured: SExpr[] = free.map((_, j) => ({ k: "local", i: j + 1 }));
    const genv = new Map(free.map((b, j) => [b, j + 1]));
    const scrut: SExpr = { k: "local", i: 0 };
    const bodies = st.cases.map((c, ci): SExpr | null => {
      const a = arms.find((x) => x.variant === c.variant);
      if (!a) return null;
      let inner = new Map(genv);
      const lets: { i: number; value: SExpr }[] = [];
      const bind = (b: Id, t: LType, value: SExpr) => { const i = g.locals.push(t) - 1; inner = new Map(inner).set(b, i); lets.push({ i, value }); };
      a.binds.forEach((b, j) => bind(b, c.fields[j].t, { k: "field", rec: scrut, t: st, c: ci, i: j }));
      a.results.forEach((r, j) => {
        if (!r) return;
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
    if (fails(g.body, funcs)) g.partial = true;
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
  // first, optional, all and count of a search written in place. With no
  // `one of` in the profile, a search has one answer or none, so each is
  // that answer, or what they give for none: first's default, none, an
  // empty list, 0.
  function attempt(n: NodeOf<"call">, id: Id, env: Map<Id, number>, f: SFunc): SExpr {
    const target = (code.nodes[n.fn] as NodeOf<"ref">).target;
    const thunk = (x: Id | undefined) => { const l = x && code.nodes[x]; return l && l.kind === "lambda" && !l.params.length ? l.body : null; };
    const search = thunk(n.args[0]), dflt = target === S.first ? thunk(n.args[1]) : null;
    if (!search || (target === S.first && !dflt)) throw new Refused(`uses ${nm(target)} on a search that isn't written in place (as () => …)`);
    const t = stype(zonk(id)), bt = stype(zonk(search));
    if (!t || !bt) throw new Refused(`searches for ${whyNot(zonk(t ? search : id))}`);
    const caseOf = (d: LType, v: Id) => (isData(d) ? d.cases.findIndex((c) => c.variant === v) : -1);
    const plan = chain(search);
    const choosing = plan.steps.some((x) => x.choose);
    if (choosing && (target === S.all || target === S.count)) return collect(target, search, plan, t, bt, env, f);
    const res = f.locals.push(bt) - 1;
    const body = choosing ? firstOf(search, plan, bt, env, f) : expr(search, env, f, false);
    const answer: SExpr = { k: "local", i: res };
    let ok: SExpr, otherwise: SExpr;
    if (target === S.first) { ok = answer; otherwise = expr(dflt!, env, f, false); }
    else if (target === S.count) { ok = { k: "num", v: 1 }; otherwise = { k: "num", v: 0 }; }
    else {
      const d = t as DType, [yes, no] = target === S.optional ? [SOME, NONE] : [CONS, NIL];
      const none: SExpr = { k: "new", t: d, c: caseOf(d, no), args: [] };
      ok = { k: "new", t: d, c: caseOf(d, yes), args: target === S.optional ? [answer] : [answer, none] };
      otherwise = none;
    }
    return { k: "attempt", body, res, ok, otherwise, t };
  }
  // A search that chooses: lets, some of whose values are `one of` a
  // list, then a body with one answer or none (keep: let item = one of
  // list, item if it passes, else fail). Each choice is a loop of its own
  // over its list, in the evaluator's order, a function taking the list
  // and the locals the rest uses. A `one of` anywhere else stays refused.
  type Plan = { steps: { p: Id; value: Id; choose: boolean }[]; leaf: Id };
  function chain(body: Id): Plan {
    const steps: Plan["steps"] = [];
    for (;;) {
      const n = code.nodes[body];
      const head = n?.kind === "call" ? code.nodes[n.fn] : null;
      if (n?.kind !== "call" || head?.kind !== "lambda" || head.params.length !== n.args.length) return { steps, leaf: body };
      head.params.forEach((p, j) => {
        const v = code.nodes[n.args[j]];
        const choose = v?.kind === "call" && v.args.length === 1 && code.nodes[v.fn]?.kind === "ref" && (code.nodes[v.fn] as NodeOf<"ref">).target === S.oneOf;
        steps.push({ p, value: choose ? (v as NodeOf<"call">).args[0] : n.args[j], choose });
      });
      body = head.body;
    }
  }
  // A choice's loop: a function of the list (and, collecting, what's been
  // collected), then the locals of e the search uses.
  function chooser(search: Id, list: Id, e: Map<Id, number>, g: SFunc, result: LType, acc: LType | null) {
    const lt = stype(zonk(list));
    if (!lt || !isData(lt)) throw new Refused(`chooses one of ${whyNot(zonk(list))}`);
    const used = new Set(refsIn(search));
    if ([...used].some((b) => inlined.has(b))) throw new Refused("chooses inside a fold, using the fold's result (not in WebAssembly yet)");
    const caps = [...e.keys()].filter((b) => used.has(b));
    const capT = caps.map((b) => g.locals[e.get(b)!]);
    const params = [lt, ...(acc ? [acc] : []), ...capT];
    const L: SFunc = { def: list, name: `${f0(g)}.choose`, params, result, locals: [...params], body: { k: "num", v: 0 }, spends: false, budgeted: false, inner: true };
    const li = funcs.push(L) - 1, at0 = acc ? 2 : 1;
    const le = new Map(caps.map((b, j) => [b, at0 + j] as const));
    const cons = lt.cases.findIndex((c) => c.variant === CONS);
    const x = L.locals.push(lt.cases[cons].fields[0].t) - 1, rest = L.locals.push(lt) - 1;
    const call = (args: SExpr[], into: number[], tail: boolean): SExpr => ({ k: "call", fn: li, args: [...args, ...into.map((i): SExpr => ({ k: "local", i }))], tail });
    return { L, li, le, lt, cons, x, rest, call, capsIn: (genv: Map<Id, number>) => caps.map((b) => genv.get(b)!), capsHere: caps.map((b) => e.get(b)!) };
  }
  const f0 = (g: SFunc) => g.name.replace(/\.choose$/, "");
  // first and optional: each choice's loop has the first answer of the
  // rest for some item, or none.
  function firstOf(search: Id, plan: Plan, bt: LType, env: Map<Id, number>, f: SFunc): SExpr {
    const one = (i: number, e: Map<Id, number>, g: SFunc): SExpr => {
      if (i === plan.steps.length) return expr(plan.leaf, e, g, false);
      const s = plan.steps[i];
      if (!s.choose) {
        const t = stype(zonk(s.p));
        if (!t) throw new Refused(`lets ${nm(s.p)} be ${OTHER}`);
        const value = expr(s.value, e, g, false), l = g.locals.push(t) - 1;
        return { k: "let", i: l, value, body: one(i + 1, new Map(e).set(s.p, l), g) };
      }
      const list = expr(s.value, e, g, false);
      const c = chooser(search, s.value, e, g, bt, null);
      c.L.partial = true;
      const res = c.L.locals.push(bt) - 1;
      const inner = one(i + 1, new Map(c.le).set(s.p, c.x), c.L);
      const scrut: SExpr = { k: "local", i: 0 };
      c.L.body = {
        k: "case", scrut, s: 0, t: c.lt, result: bt,
        arms: c.lt.cases.map((_, k): SExpr => (k !== c.cons ? { k: "fail" } : {
          k: "let", i: c.x, value: { k: "field", rec: scrut, t: c.lt, c: k, i: 0 },
          body: { k: "let", i: c.rest, value: { k: "field", rec: scrut, t: c.lt, c: k, i: 1 },
            body: { k: "attempt", body: inner, res, ok: { k: "local", i: res }, otherwise: c.call([{ k: "local", i: c.rest }], c.capsIn(c.le), true), t: bt } },
        })),
      };
      return c.call([list], c.capsHere, false);
    };
    return one(0, env, f);
  }
  // all and count: each choice's loop takes what's been collected and
  // gives it with the rest's answers for each item added, a tail call per
  // item; all collects backwards and turns the list round at the end.
  function collect(target: Id, search: Id, plan: Plan, t: LType, bt: LType, env: Map<Id, number>, f: SFunc): SExpr {
    const accT: LType = target === S.count ? "f64" : t;
    const d = t as DType, nil = target === S.all ? d.cases.findIndex((c) => c.variant === NIL) : -1, cons = target === S.all ? d.cases.findIndex((c) => c.variant === CONS) : -1;
    const add = (acc: number, res: number): SExpr => (target === S.count
      ? { k: "op", op: "add", args: [{ k: "local", i: acc }, { k: "num", v: 1 }] }
      : { k: "new", t: d, c: cons, args: [{ k: "local", i: res }, { k: "local", i: acc }] });
    // The rest from step i, in g, with what's been collected in local acc.
    const many = (i: number, e: Map<Id, number>, g: SFunc, acc: number): SExpr => {
      const kept = (body: SExpr): SExpr => { const r = g.locals.push(accT) - 1; return { k: "attempt", body, res: r, ok: { k: "local", i: r }, otherwise: { k: "local", i: acc }, t: accT }; };
      if (i === plan.steps.length) {
        const res = g.locals.push(bt) - 1;
        return { k: "attempt", body: expr(plan.leaf, e, g, false), res, ok: add(acc, res), otherwise: { k: "local", i: acc }, t: accT };
      }
      const s = plan.steps[i];
      if (!s.choose) {
        const lt = stype(zonk(s.p));
        if (!lt) throw new Refused(`lets ${nm(s.p)} be ${OTHER}`);
        const value = expr(s.value, e, g, false), l = g.locals.push(lt) - 1;
        const body: SExpr = { k: "let", i: l, value, body: many(i + 1, new Map(e).set(s.p, l), g, acc) };
        return fails(value, funcs) ? kept(body) : body;
      }
      const list = expr(s.value, e, g, false);
      const c = chooser(search, s.value, e, g, accT, accT);
      const scrut: SExpr = { k: "local", i: 0 };
      c.L.body = {
        k: "case", scrut, s: 0, t: c.lt, result: accT,
        arms: c.lt.cases.map((_, k): SExpr => (k !== c.cons ? { k: "local", i: 1 } : {
          k: "let", i: c.x, value: { k: "field", rec: scrut, t: c.lt, c: k, i: 0 },
          body: { k: "let", i: c.rest, value: { k: "field", rec: scrut, t: c.lt, c: k, i: 1 },
            body: c.call([{ k: "local", i: c.rest }, many(i + 1, new Map(c.le).set(s.p, c.x), c.L, 1)], c.capsIn(c.le), true) },
        })),
      };
      if (fails(c.L.body, funcs)) c.L.partial = true;
      const call = c.call([list, { k: "local", i: acc }], c.capsHere, false);
      return fails(list, funcs) || c.L.partial ? kept(call) : call;
    };
    const acc = f.locals.push(accT) - 1;
    const start: SExpr = target === S.count ? { k: "num", v: 0 } : { k: "new", t: d, c: nil, args: [] };
    const body = many(0, env, f, acc);
    return { k: "let", i: acc, value: start, body: target === S.count ? body : { k: "call", fn: reverse(d), args: [body, { k: "new", t: d, c: nil, args: [] }], tail: false } };
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
    try { func(r); } catch (e) { if (!(e instanceof Refused)) throw e; if (!refused.has(r)) unstarted.set(r, e.message.replace(`calls ${nm(r)}, which `, "")); }
  }
  for (const [r, why] of unstarted) if (!refused.has(r)) refused.set(r, why);
  // Refusals by definition; those of one specialization stay inside.
  return { funcs, refused: new Map([...refused].filter(([k]) => !k.includes("|"))), records: [...records.values()], data: [...datas.values()], fns: [...fns.values()], shapes, code, info };
}
