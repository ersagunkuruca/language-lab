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

export type SType = "f64" | "i32"; // Number, Bool (0 or 1)

export type SExpr =
  | { k: "num"; v: number }
  | { k: "bool"; v: boolean }
  | { k: "local"; i: number }
  | { k: "op"; op: Op; args: SExpr[] }
  | { k: "if"; cond: SExpr; then: SExpr; else: SExpr; t: SType }
  | { k: "let"; i: number; value: SExpr; body: SExpr }
  | { k: "call"; fn: number; args: SExpr[]; tail: boolean };

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

export interface SFunc { def: Id; name: string; params: SType[]; result: SType; locals: SType[]; body: SExpr }
export interface Lowered { funcs: SFunc[]; refused: Map<Id, string> }

class Refused extends Error {}

export function lowerScalar(code: Code, info: Info, names: Names, roots: Id[]): Lowered {
  const zonk = (id: Id): Type => info.subst.zonk(info.typeOf.get(id) ?? { t: "var", v: -1 });
  const nm = (id: Id) => names[id] ?? id;
  const stype = (t: Type): SType | null =>
    t.t === "con" && t.id === NUMBER ? "f64" : t.t === "con" && t.id === BOOL ? "i32" : null;

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
    const params = ft.params.map(stype), result = stype(ft.ret);
    if (params.some((p) => !p) || !result) fail("takes or gives something other than Number or Bool");
    const effs = info.subst.resolveRow(ft.eff).effs.filter((e) => e !== DIVERGE);
    if (effs.length) fail(`has effects (${effs.map(nm).join(", ")})`);

    // Reserve the index now, so recursion finds it.
    const i = funcs.length;
    index.set(def, i);
    inProgress.add(def);
    const f: SFunc = { def, name: nm(def), params: params as SType[], result: result!, locals: [...params as SType[]], body: { k: "num", v: 0 } };
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
            if (!t) throw new Refused(`lets ${nm(p)} be something other than a Number or Bool`);
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
          if (!t) throw new Refused("compares values that aren't Numbers or Bools");
          return { k: "op", op: t === "f64" ? "equal" : "beq", args: args() };
        }
        if (BUILTIN[target]) return { k: "op", op: BUILTIN[target], args: args() };
        const t = code.nodes[target];
        if (t?.kind === "def") return { k: "call", fn: func(target), args: args(), tail };
        throw new Refused(`uses ${nm(target)}, which isn't in the scalar profile`);
      }
      case "match": {
        // Only `if`: a match on Bool.
        const arms = n.arms.map((a) => code.nodes[a] as NodeOf<"arm">);
        if (!arms.every((a) => a.variant === TRUE || a.variant === FALSE)) throw new Refused("matches on data (needs a heap)");
        const arm = (v: Id) => arms.find((a) => a.variant === v)?.body ?? n.otherwise!;
        const t = stype(zonk(id));
        if (!t) throw new Refused("has an if whose value isn't a Number or Bool");
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
  return { funcs, refused };
}
