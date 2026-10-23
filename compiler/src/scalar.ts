// The scalar profile: the part of the language that needs no heap.
//
// A definition is in it when its inputs and result are Number or Bool, and
// its body uses only arithmetic, comparisons, `if`, lets, and calls to other
// definitions in the profile. No data, no closures, no Choice, no world
// effects (Diverge is allowed: it just runs). That's exactly what a GPU or
// plain WebAssembly can run without a garbage collector, so this one
// lowering feeds both: wasm.ts prints it as a WebAssembly module, and a
// shader backend would print it as WGSL (see projectional/COMPILER.md).
//
// With `records`, the profile also takes records of those: a data type
// with one case whose fields are Numbers, Bools or records again (a
// point, a colour, a ray). They need no heap either, since their size is
// known; a shader has them as structs. A record is built by its case,
// read by its fields or by a match with one arm. WebAssembly doesn't take
// them yet (it would need multiple results), so wasm.ts lowers without.
//
// The lowering is to a tiny expression tree with numbered locals. A
// definition outside the profile is refused with the reason, the way a
// type error is reported, so "can this run on the GPU / in WASM" is a
// question with an answer you can show in the editor.

import type { Code, Id, NodeOf } from "../../projectional/src/model.ts";
import type { Names } from "../../projectional/src/presentation.ts";
import type { Info } from "../../projectional/src/lang/infer.ts";
import { DIVERGE, NUMBER, type Type } from "../../projectional/src/lang/types.ts";
import { B } from "../../projectional/src/prelude.ts";
import { BOOL, FALSE, S, TRUE } from "../../projectional/src/lang/std.ts";
import { fieldIndex } from "../../projectional/src/lang/records.ts";
import { expandDerivatives } from "../../projectional/src/lang/derive.ts";
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
  | { k: "get"; rec: SExpr; t: RType; i: number };

// Operations the targets provide. `host` ones (sin, pow, …) aren't
// WebAssembly instructions; a WASM module imports them, a shader has them
// built in.
export type Op = keyof typeof OPS;
export const OPS = {
  add: { t: "f64" }, sub: { t: "f64" }, mul: { t: "f64" }, div: { t: "f64" }, neg: { t: "f64" },
  sqrt: { t: "f64" }, abs: { t: "f64" }, floor: { t: "f64" },
  sin: { t: "f64", host: true }, cos: { t: "f64", host: true }, tan: { t: "f64", host: true },
  exp: { t: "f64", host: true }, log: { t: "f64", host: true }, pow: { t: "f64", host: true }, atan2: { t: "f64", host: true },
  less: { t: "i32" }, equal: { t: "i32" }, beq: { t: "i32" }, and: { t: "i32" }, or: { t: "i32" }, not: { t: "i32" },
} as const satisfies Record<string, { t: SType; host?: boolean }>;

const BUILTIN: Record<Id, Op> = {
  [B.add]: "add", [B.sub]: "sub", [B.mul]: "mul", [B.div]: "div", [B.neg]: "neg", [B.sqrt]: "sqrt",
  [B.sin]: "sin", [B.cos]: "cos", [B.tan]: "tan", [B.exp]: "exp", [B.log]: "log", [B.pow]: "pow", [B.atan2]: "atan2",
  [S.abs]: "abs", [S.floor]: "floor", [S.less]: "less", [S.and]: "and", [S.or]: "or", [S.not]: "not",
};

export interface SFunc { def: Id; name: string; params: LType[]; result: LType; locals: LType[]; body: SExpr }
// `code` and `info` are the program that was lowered: the one given, or
// a copy with its derivatives generated, where funcs[i].def lives.
export interface Lowered { funcs: SFunc[]; refused: Map<Id, string>; records: RType[]; code: Code; info: Info }

class Refused extends Error {}

export function lowerScalar(code: Code, info: Info, names: Names, roots: Id[], opts: { records?: boolean } = {}): Lowered {
  // derivative(f) of a function written right there becomes the code of
  // its derivative (derive.ts), checked again, so the GPU gets exact
  // slopes as plain arithmetic. The partials it calls (∂scene/∂x …) are
  // definitions like any other.
  const x = expandDerivatives(code, names);
  if (x.expanded.length) {
    code = x.code;
    names = x.names;
    info = infer(code, names);
  }
  const zonk = (id: Id): Type => info.subst.zonk(info.typeOf.get(id) ?? { t: "var", v: -1 });
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

  // The function index for `def`, lowering it (and what it calls) first.
  function func(def: Id): number {
    if (index.has(def)) return index.get(def)!;
    if (refused.has(def)) throw new Refused(`calls ${nm(def)}, which ${refused.get(def)}`);
    const t = info.typeOf.get(def) && info.subst.zonk(info.typeOf.get(def)!);
    const d = code.nodes[def] as NodeOf<"def">;
    const lam = d?.body ? code.nodes[d.body] : null;
    const fail = (why: string): never => { refused.set(def, why); throw new Refused(`calls ${nm(def)}, which ${why}`); };
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

    // Reserve the index now, so recursion finds it.
    const i = funcs.length;
    index.set(def, i);
    inProgress.add(def);
    const f: SFunc = { def, name: nm(def), params: params as LType[], result: result!, locals: [...params as LType[]], body: { k: "num", v: 0 } };
    funcs.push(f);
    try {
      const l = lam as NodeOf<"lambda">;
      const env = new Map(l.params.map((p, j) => [p, j]));
      f.body = expr(l.body, env, f, true);
    } catch (e) {
      // Undo: this definition and anything lowered after it.
      funcs.splice(i);
      for (const [d2, j] of index) if (j >= i) index.delete(d2);
      inProgress.delete(def);
      if (e instanceof Refused) { refused.set(def, e.message); throw new Refused(`calls ${nm(def)}, which ${e.message}`); }
      throw e;
    }
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
          return { k: "op", op: t === "f64" ? "equal" : "beq", args: args() };
        }
        if (BUILTIN[target]) return { k: "op", op: BUILTIN[target], args: args() };
        const t = code.nodes[target];
        if (t?.kind === "def") {
          const fn = func(target);
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

  for (const r of roots) {
    try { func(r); } catch (e) { if (!(e instanceof Refused)) throw e; }
  }
  return { funcs, refused, records: [...records.values()], code, info };
}
