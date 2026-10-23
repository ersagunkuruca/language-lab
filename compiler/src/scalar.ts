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
import { DIVERGE, NUMBER, type Type } from "../../projectional/src/lang/types.ts";
import { BOOL, FALSE, S, TRUE } from "../../projectional/src/lang/std.ts";
import { fieldIndex } from "../../projectional/src/lang/records.ts";
import { expandDerivatives, recordVariant } from "../../projectional/src/lang/derive.ts";
import { infer } from "../../projectional/src/lang/infer.ts";
import { discharge } from "../../projectional/src/lang/ledger.ts";
import { scalarOp, TARGETS } from "./builtins.ts";

// A shader (or a ray marcher's loop) may call what might not finish only
// under a literal with fuel; the rest of its type must be empty.
const BUDGETED = discharge("a shader", [DIVERGE], "only under a literal with fuel, which gives each pixel a step budget");

export type SType = "f64" | "i32"; // Number, Bool (0 or 1)
// A record: a data type with one case, at particular type arguments.
export interface RType { key: string; name: string; def: Id; variant: Id; fields: { name: string; t: LType }[] }
// A data type with several cases, or one that contains itself (`data`).
// A case's fields are in the order written.
// `inner`: made by the lowering (a fold's stack), not the program's.
export interface DType { key: string; name: string; def: Id; cases: { variant: Id; name: string; fields: { name: string; t: LType }[] }[]; inner?: boolean }
export type LType = SType | RType | DType;
export const isData = (t: LType): t is DType => typeof t === "object" && "cases" in t;
export const isRecord = (t: LType): t is RType => typeof t === "object" && !("cases" in t);
// For a printer of a target without a heap (WGSL, the JS fallback for
// shaders), which is never given data.
export const noData = (e: SExpr): never => { throw new Error(`${e.k} needs a heap: lower without \`data\``); };

export type SExpr =
  | { k: "num"; v: number }
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
  // A match on t: scrut goes into local s, then the arm for its case
  // runs (null: no arm, which the checker rules out).
  | { k: "case"; scrut: SExpr; s: number; t: DType; arms: (SExpr | null)[]; result: LType }
  // first(() => with fuel(n, () => body), () => otherwise): body with n
  // calls to spend, or otherwise if it ran out. `save` is a Number local
  // for the budget around this one, `res` one for body's value.
  | { k: "budget"; n: number; body: SExpr; otherwise: SExpr; t: LType; save: number; res: number };

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
export interface SFunc { def: Id; name: string; params: LType[]; result: LType; locals: LType[]; body: SExpr; spends: boolean; budgeted: boolean; inner?: boolean }
// `code` and `info` are the program that was lowered: the one given, or
// a copy with its derivatives generated, where funcs[i].def lives.
export interface Lowered { funcs: SFunc[]; refused: Map<Id, string>; records: RType[]; data: DType[]; code: Code; info: Info }

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
  // stand for in the one being lowered.
  let at = new Map<number, Type>();
  const put = (t: Type, m: Map<number, Type>): Type =>
    t.t === "var" ? m.get(t.v) ?? t : t.t === "con" ? { ...t, args: t.args.map((a) => put(a, m)) } : { ...t, params: t.params.map((p) => put(p, m)), ret: put(t.ret, m) };
  const zonk = (id: Id): Type => put(info.subst.zonk(info.typeOf.get(id) ?? { t: "var", v: -1 }), at);
  const nm = (id: Id) => names[id] ?? id;
  const records = new Map<string, RType>();
  const datas = new Map<string, DType>();
  const OTHER = opts.data ? "something other than Number, Bool or data of them" : opts.records ? "something other than Number, Bool or a record of them" : "something other than Number or Bool";

  // The profile's type for t, or null if t isn't in it.
  function stype(t: Type, inside: Id[] = []): LType | null {
    if (t.t !== "con") return null;
    if (t.id === NUMBER) return "f64";
    if (t.id === BOOL) return "i32";
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
    const r: RType = { key, name: nm(t.id), def: t.id, variant: td.variants[0], fields };
    records.set(key, r);
    return r;
  }
  // Why t isn't in the profile, when records are: the first reason found.
  function whyNot(t: Type, inside: Id[] = []): string {
    if (t.t === "fn") return "a function (that needs closures)";
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
  const vars = (t: Type): number[] => (t.t === "var" ? [t.v] : t.t === "con" ? t.args.flatMap(vars) : [...t.params.flatMap(vars), ...vars(t.ret)]);
  const show = (t: Type): string => (t.t === "con" ? `${t.id}<${t.args.map(show).join(",")}>` : t.t === "var" ? `?${t.v}` : "fn");

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
  function func(def: Id, types = new Map<number, Type>()): number {
    const raw = info.typeOf.get(def) && info.subst.zonk(info.typeOf.get(def)!);
    const t = raw && put(raw, types);
    if (!opts.data && !underBudget && diverges(t)) throw new Refused(`calls ${nm(def)}, which ${MAY_NOT_FINISH}`);
    const used = raw ? [...new Set(vars(raw))].filter((v) => types.has(v)).sort((a, b) => a - b) : [];
    const key = used.length ? `${def}|${used.map((v) => `${v}=${show(types.get(v)!)}`).join(",")}` : def;
    if (index.has(key)) return index.get(key)!;
    if (refused.has(key)) throw new Refused(`calls ${nm(def)}, which ${refused.get(key)}`);
    const d = code.nodes[def] as NodeOf<"def">;
    const lam = d?.body ? code.nodes[d.body] : null;
    const fail = (why: string): never => { refused.set(key, why); throw new Refused(`calls ${nm(def)}, which ${why}`); };
    if (!t || t.t !== "fn" || lam?.kind !== "lambda") fail("is not a function written in the program");
    const ft = t as Extract<Type, { t: "fn" }>;
    // An input that can be anything is one the body never looks at (∂f/∂x
    // of a function that has an input the slope doesn't depend on, say).
    // It's taken as a Number, and calls must pass one.
    const free = new Set(vars(ft.ret));
    const params = ft.params.map((p) => (p.t === "var" && !free.has(p.v) ? "f64" : stype(p))), result = stype(ft.ret);
    if (params.some((p) => !p) || !result) {
      const bad = [...ft.params, ft.ret][[...params, result].findIndex((x) => !x)];
      fail(opts.records ? `takes or gives ${whyNot(info.subst.zonk(bad))}` : `takes or gives ${OTHER}`);
    }
    const effs = info.subst.resolveRow(ft.eff).effs.filter((e) => !BUDGETED.includes(e));
    if (effs.length) fail(`has effects (${effs.map(nm).join(", ")})`);
    const budgeted = !opts.data && diverges(ft);

    // Reserve the index now, so recursion finds it.
    const i = funcs.length;
    index.set(key, i);
    inProgress.add(def);
    const f: SFunc = { def, name: nm(def), params: params as LType[], result: result!, locals: [...params as LType[]], body: { k: "num", v: 0 }, spends: info.divergent.has(def), budgeted };
    funcs.push(f);
    const outer = underBudget, outerAt = at;
    try {
      const l = lam as NodeOf<"lambda">;
      const env = new Map(l.params.map((p, j) => [p, j]));
      underBudget = budgeted;
      at = types;
      f.body = expr(l.body, env, f, true);
    } catch (e) {
      underBudget = outer;
      at = outerAt;
      // Undo: this definition and anything lowered after it.
      funcs.splice(i);
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
      case "lit":
        if (typeof n.value !== "number" || stype(zonk(id)) !== "f64") throw new Refused("uses a value that isn't a Number");
        return { k: "num", v: n.value };
      case "ref": {
        if (n.target === TRUE || n.target === FALSE) return { k: "bool", v: n.target === TRUE };
        if (env.has(n.target)) return { k: "local", i: env.get(n.target)! };
        const later = inlined.get(n.target);
        if (later) return { ...later, tail };
        // A case with no fields (empty, nothing) written alone.
        if (opts.data && code.nodes[n.target]?.kind === "variant") return build(n.target, zonk(id), []);
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
        if (head.kind !== "ref") throw new Refused("calls a computed function (that needs closures)");
        const args = () => n.args.map((a) => expr(a, env, f, false));
        const target = head.target;
        if (target === S.equal) {
          const t = stype(zonk(n.args[0]));
          if (!t || (typeof t !== "string" && !opts.data)) throw new Refused("compares values that aren't Numbers or Bools");
          const [x, y] = args();
          return same(x, y, t, f, tail);
        }
        if (scalarOp(target)) return { k: "op", op: scalarOp(target)!, args: args() };
        if (target === S.mapParts || target === S.zipParts || target === S.total) return parts(n, env, f);
        if (target === S.first || target === S.fuel) return budget(n, id, env, f);
        const t = code.nodes[target];
        if (t?.kind === "def") {
          // What the callee's type variables are here.
          const types = new Map<number, Type>();
          const match = (p: Type, c: Type) => {
            if (p.t === "var") { if (c.t !== "var") types.set(p.v, c); }
            else if (p.t === "con" && c.t === "con") p.args.forEach((a, j) => c.args[j] && match(a, c.args[j]));
            else if (p.t === "fn" && c.t === "fn") { p.params.forEach((a, j) => c.params[j] && match(a, c.params[j])); match(p.ret, c.ret); }
          };
          const ct = info.typeOf.get(target) && info.subst.zonk(info.typeOf.get(target)!);
          if (ct?.t === "fn") { ct.params.forEach((p, j) => n.args[j] && match(p, zonk(n.args[j]))); match(ct.ret, zonk(id)); }
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
      case "hole": throw new Refused("has a hole");
      default: throw new Refused(`has a ${n.kind}`);
    }
  }

  // equal on values of type t, by the evaluator's rule (run.ts equal).
  function same(x: SExpr, y: SExpr, t: LType, f: SFunc, tail: boolean): SExpr {
    if (t === "i32") return { k: "op", op: "beq", args: [x, y] };
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
    return di;
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
  return { funcs, refused: new Map([...refused].filter(([k]) => !k.includes("|"))), records: [...records.values()], data: [...datas.values()], code, info };
}
