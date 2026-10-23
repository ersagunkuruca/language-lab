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
// read by its fields or by a match with one arm. WebAssembly doesn't take
// them yet (it would need multiple results), so wasm.ts lowers without.
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
import { B } from "../../projectional/src/prelude.ts";
import { BOOL, FALSE, S, TRUE } from "../../projectional/src/lang/std.ts";
import { fieldIndex } from "../../projectional/src/lang/records.ts";
import { expandDerivatives, recordVariant } from "../../projectional/src/lang/derive.ts";
import { infer } from "../../projectional/src/lang/infer.ts";

export type SType = "f64" | "i32"; // Number, Bool (0 or 1)
// A record: a data type with one case, at particular type arguments.
export interface RType { key: string; name: string; def: Id; variant: Id; fields: { name: string; t: LType }[] }
export type LType = SType | RType;

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
  sqrt: { t: "f64" }, abs: { t: "f64" }, floor: { t: "f64" },
  sin: { t: "f64", host: true }, cos: { t: "f64", host: true }, tan: { t: "f64", host: true },
  exp: { t: "f64", host: true }, log: { t: "f64", host: true }, pow: { t: "f64", host: true }, atan2: { t: "f64", host: true }, mod: { t: "f64", host: true },
  less: { t: "i32" }, equal: { t: "i32" }, beq: { t: "i32" }, and: { t: "i32" }, or: { t: "i32" }, not: { t: "i32" },
} as const satisfies Record<string, { t: SType; host?: boolean }>;

const BUILTIN: Record<Id, Op> = {
  [B.add]: "add", [B.sub]: "sub", [B.mul]: "mul", [B.div]: "div", [B.neg]: "neg", [B.sqrt]: "sqrt",
  [B.sin]: "sin", [B.cos]: "cos", [B.tan]: "tan", [B.exp]: "exp", [B.log]: "log", [B.pow]: "pow", [B.atan2]: "atan2",
  [S.abs]: "abs", [S.floor]: "floor", [S.mod]: "mod", [S.less]: "less", [S.and]: "and", [S.or]: "or", [S.not]: "not",
};

// `spends`: each call spends one from the budget (the checker couldn't see
// it end). `budgeted`: its type has Diverge, so it may only be called under
// a budget, never from outside.
export interface SFunc { def: Id; name: string; params: LType[]; result: LType; locals: LType[]; body: SExpr; spends: boolean; budgeted: boolean }
// `code` and `info` are the program that was lowered: the one given, or
// a copy with its derivatives generated, where funcs[i].def lives.
export interface Lowered { funcs: SFunc[]; refused: Map<Id, string>; records: RType[]; code: Code; info: Info }

class Refused extends Error {}

// The largest budget: counts are kept in f32 on a GPU, whole up to 2^24.
export const MAX_FUEL = 2 ** 24;
const BUDGET = "first(() => with fuel(n, () => …), () => …)";
const MAY_NOT_FINISH = `may not finish (its type has Diverge): on a GPU that hangs the page, so run it under a budget, ${BUDGET}`;

export function lowerScalar(code: Code, info: Info, names: Names, roots: Id[], opts: { records?: boolean } = {}): Lowered {
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
  const OTHER = opts.records ? "something other than Number, Bool or a record of them" : "something other than Number or Bool";

  // The profile's type for t, or null if t isn't in it.
  function stype(t: Type, inside: Id[] = []): LType | null {
    if (t.t !== "con") return null;
    if (t.id === NUMBER) return "f64";
    if (t.id === BOOL) return "i32";
    if (!opts.records || inside.includes(t.id)) return null;
    const td = code.nodes[(code.nodes[t.id] as NodeOf<"def"> | undefined)?.body ?? ""];
    if (td?.kind !== "typedef" || td.effect || td.variants.length !== 1) return null;
    const key = `${t.id}<${t.args.map(show).join(",")}>`;
    if (records.has(key)) return records.get(key)!;
    // The fields' types, with the type's parameters replaced by t's arguments.
    const args = new Map(td.params.map((p, i) => [p, t.args[i]] as const));
    const te = (tid: Id): Type | null => {
      const n = code.nodes[tid];
      if (n?.kind !== "tref") return null;
      if (args.has(n.target)) return args.get(n.target)!;
      const xs = n.args.map(te);
      return xs.every((x) => x) ? { t: "con", id: n.target, args: xs as Type[] } : null;
    };
    const variant = code.nodes[td.variants[0]] as NodeOf<"variant">;
    const fields: RType["fields"] = [];
    for (const f of variant.fields) {
      const ft = te((code.nodes[f] as NodeOf<"field">).type);
      const lt = ft && stype(info.subst.zonk(ft), [...inside, t.id]);
      if (!lt) return null;
      fields.push({ name: nm(f), t: lt });
    }
    if (!fields.length) return null;
    const r: RType = { key, name: nm(t.id), def: t.id, variant: td.variants[0], fields };
    records.set(key, r);
    return r;
  }
  // Why t isn't in the profile, when records are: the first reason found.
  function whyNot(t: Type, inside: Id[] = []): string {
    if (t.t === "fn") return "a function (that needs closures)";
    if (t.t === "var") return "a value of any type";
    const td = code.nodes[(code.nodes[t.id] as NodeOf<"def"> | undefined)?.body ?? ""];
    if (inside.includes(t.id)) return `${nm(t.id)}, which contains itself (that needs a heap)`;
    if (td?.kind !== "typedef" || td.effect) return nm(t.id);
    if (td.variants.length !== 1) return `${nm(t.id)}, which has ${td.variants.length} cases (only one-case records fit)`;
    const ft = (code.nodes[td.variants[0]] as NodeOf<"variant">).fields.map((f) => code.nodes[(code.nodes[f] as NodeOf<"field">).type]);
    if (ft.some((n) => n?.kind === "tref" && (n.target === t.id || inside.includes(n.target)))) return `${nm(t.id)}, which contains itself (that needs a heap)`;
    return `${nm(t.id)}, which has a field that isn't a Number, Bool or record`;
  }
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
    if (!underBudget && diverges(t)) throw new Refused(`calls ${nm(def)}, which ${MAY_NOT_FINISH}`);
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
    const effs = info.subst.resolveRow(ft.eff).effs.filter((e) => e !== DIVERGE);
    if (effs.length) fail(`has effects (${effs.map(nm).join(", ")})`);
    const budgeted = diverges(ft);

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
          if (t !== "f64" && t !== "i32") throw new Refused("compares values that aren't Numbers or Bools");
          if (t === "i32") return { k: "op", op: "beq", args: args() };
          // The evaluator's rule (run.ts sameNumber): two whole numbers
          // exactly, any other pair within 1e-9 relative to their size.
          // Each side once: a local if it isn't one already.
          const lets: { i: number; value: SExpr }[] = [];
          const [x, y] = args().map((value): SExpr => {
            if (value.k === "local" || value.k === "num") return value;
            const i = f.locals.push("f64") - 1;
            lets.push({ i, value });
            return { k: "local", i };
          });
          const op = (o: Op, ...xs: SExpr[]): SExpr => ({ k: "op", op: o, args: xs });
          const num = (v: number): SExpr => ({ k: "num", v });
          const whole = (e: SExpr) => op("equal", op("floor", e), e);
          const diff = op("abs", op("sub", x, y)), tol = op("mul", num(1e-9), op("add", op("add", num(1), op("abs", x)), op("abs", y)));
          const same = op("or", op("equal", x, y), op("and", op("not", op("and", whole(x), whole(y))), op("or", op("less", diff, tol), op("equal", diff, tol))));
          return lets.reduceRight<SExpr>((body, l) => ({ k: "let", i: l.i, value: l.value, body }), same);
        }
        if (BUILTIN[target]) return { k: "op", op: BUILTIN[target], args: args() };
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
        if (opts.records && t?.kind === "variant") {
          // A record built by its case.
          const r = stype(zonk(id));
          if (!r || typeof r === "string" || r.variant !== target) throw new Refused(`builds ${nm(target)}, which isn't a record of Numbers and Bools`);
          return { k: "make", t: r, args: args() };
        }
        if (opts.records && t?.kind === "field" && n.args.length === 1) {
          const r = stype(zonk(n.args[0]));
          if (!r || typeof r === "string") throw new Refused(`takes ${nm(target)} of something that isn't a record of Numbers and Bools`);
          return { k: "get", rec: expr(n.args[0], env, f, false), t: r, i: fieldIndex(code, target) };
        }
        throw new Refused(`uses ${nm(target)}, which isn't in the scalar profile`);
      }
      case "match": {
        const arms = n.arms.map((a) => code.nodes[a] as NodeOf<"arm">);
        const st = opts.records ? stype(zonk(n.scrutinee)) : null;
        if (st && typeof st !== "string" && arms.length === 1 && arms[0].variant === st.variant) {
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
      case "fold": throw new Refused("folds over data (needs a heap)");
      case "solve": throw new Refused("solves a relation (not in this profile yet)");
      case "hole": throw new Refused("has a hole");
      default: throw new Refused(`has a ${n.kind}`);
    }
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
    const amount = code.nodes[inner.args[0]], body = thunk(inner.args[1]);
    if (!body) throw new Refused(`uses with fuel, which a shader takes ${shape}`);
    if (amount?.kind !== "lit" || typeof amount.value !== "number") throw new Refused("has a budget that isn't a number written down (a shader's bound is fixed when it's built)");
    const v = amount.value;
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
    if (t !== "f64" && (!t || typeof t === "string" || t.fields.some((x) => x.t !== "f64"))) throw new Refused(`takes the parts of something that isn't a record of Numbers`);
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
        if (fnNode.kind === "ref" && BUILTIN[fnNode.target]) return { k: "op", op: BUILTIN[fnNode.target], args: xs };
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
  return { funcs, refused: new Map([...refused].filter(([k]) => !k.includes("|"))), records: [...records.values()], code, info };
}
