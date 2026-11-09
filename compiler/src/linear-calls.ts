// Linear functions composed (MATRICES.md layer 1, L44; C30b's, which went
// with compile.ts): a call of a linear definition on a call of another,
// f(g(x)), is one matrix A·B and offset A·b + a, folded now and written as
// unrolled multiply-adds, when that is fewer of them than f's and g's
// together. A chain f(g(h(x))) folds all the way down.
//
// linear.ts reads each definition's matrix from the program; only
// Float64s and records of Float64s take part, so a generic `a + a` called
// on Ints stays a call. The folded constants are rounded once instead of
// at each step, so a result may differ from the evaluator's in its last
// bits, as any compiler's reassociation does.
//
// Prior art: constant folding of affine maps (LLVM's and MLIR's affine
// analysis); the product rule is the textbook matrix of a composition.

import type { Id, NodeOf } from "../../ters/src/model.ts";
import { fieldWayOf } from "../../ters/src/model.ts";
import { composeLinear, linearMap, type LinearMap } from "../../ters/src/lang/linear.ts";
import { mapKids, type CoreIR, type DType, type LType, type RType, type SExpr, type SFunc } from "./scalar.ts";

type Rec = RType | DType;
const isRec = (t: LType): t is Rec => typeof t === "object" && t !== null && ("variant" in t || ("cases" in t && t.cases.length === 1));
const variantOf = (t: Rec) => ("variant" in t ? t.variant : t.cases[0].variant);
const fieldsOf = (t: Rec) => ("variant" in t ? t.fields : t.cases[0].fields);

export function linearCalls(ir: CoreIR): number {
  const code = ir.code, maps = new Map<Id, LinearMap | null>();
  let n = 0;
  // A Float64, or a record of Float64s and nothing else, of the shape the
  // map takes or gives.
  const fits = (shape: Id | "number" | null, t: LType): boolean => {
    if (shape === "number") return t === "f64";
    if (shape === null || !isRec(t) || variantOf(t) !== shape) return false;
    return fieldsOf(t).every((f) => f.t === "f64") && fieldsOf(t).length === (code.nodes[shape] as NodeOf<"variant">).fields.length;
  };
  // A call of a linear definition, with the inputs it reads; its own
  // argument folded in too when that is a linear call that pays.
  const linearOf = (e: SExpr): { map: LinearMap; args: SExpr[]; argTs: LType[]; result: LType } | null => {
    if (e.k !== "call" || e.cps) return null;
    const g = ir.funcs[e.fn];
    if (!g || g.inner || g.spends || g.budgeted || g.partial || g.multi || fieldWayOf(code.nodes, g.def)) return null;
    const def = code.nodes[g.def] as NodeOf<"def"> | undefined;
    if (def?.kind !== "def" || !def.body || code.nodes[def.body]?.kind !== "lambda") return null;
    if (!maps.has(g.def)) maps.set(g.def, linearMap(code, g.def));
    const map = maps.get(g.def);
    if (!map || map.params.length !== e.args.length || g.params.length !== e.args.length || map.params.some((p) => p === null)) return null;
    if (!fits(map.output ?? "number", g.result) || !map.params.every((p, i) => fits(p, g.params[i]))) return null;
    if (e.args.length === 1) {
      const inner = linearOf(e.args[0]);
      const both = inner && map.params[0] === (inner.map.output ?? "number") ? composeLinear(map, inner.map) : null;
      if (inner && both && [...both.matrix.flat(), ...both.offset].every(Number.isFinite) && madds(both) < madds(map) + madds(inner.map)) return { map: both, args: inner.args, argTs: inner.argTs, result: g.result };
    }
    return { map, args: e.args, argTs: g.params, result: g.result };
  };
  const madds = (m: LinearMap) => m.matrix.flat().filter((x) => x !== 0).length + m.offset.filter((x) => x !== 0).length;

  const emit = (f: SFunc, l: { map: LinearMap; args: SExpr[]; argTs: LType[]; result: LType }): SExpr => {
    const m = l.map, binds: { i: number; value: SExpr }[] = [];
    const vals = l.args.map((a, i) => {
      if (a.k === "local") return a;
      const at = f.locals.length;
      f.locals.push(l.argTs[i]);
      binds.push({ i: at, value: a });
      return { k: "local", i: at } as SExpr;
    });
    const input = m.inputs.map((c): SExpr => {
      const v = vals[c.param], t = l.argTs[c.param];
      if (c.field === null || !isRec(t)) return v;
      const i = (code.nodes[variantOf(t)] as NodeOf<"variant">).fields.indexOf(c.field);
      return "variant" in t ? { k: "get", rec: v, t, i } : { k: "field", rec: v, t, c: 0, i };
    });
    const num = (x: number): SExpr => ({ k: "num", v: x + 0 });
    const rows = m.matrix.map((row, i) => {
      const terms: SExpr[] = row.flatMap((a, j) => (a === 0 ? [] : [a === 1 ? input[j] : { k: "op", op: "mul", args: [num(a), input[j]] } as SExpr]));
      if (m.offset[i] !== 0) terms.push(num(m.offset[i]));
      return terms.length ? terms.reduce((s, x) => ({ k: "op", op: "add", args: [s, x] })) : num(0);
    });
    const t = l.result;
    const out: SExpr = m.output === null || !isRec(t) ? rows[0] : "variant" in t ? { k: "make", t, args: rows } : { k: "new", t, c: 0, args: rows };
    return binds.reduceRight<SExpr>((body, b) => ({ k: "let", i: b.i, value: b.value, body }), out);
  };

  for (const f of ir.funcs) {
    const go = (e: SExpr): SExpr => {
      const x = mapKids(e, go);
      const l = x.k === "call" && x.args.length === 1 ? linearOf(x) : null;
      if (!l || l.args === (x as { args: SExpr[] }).args) return x;
      n++;
      return emit(f, l);
    };
    f.body = go(f.body);
  }
  return n;
}
