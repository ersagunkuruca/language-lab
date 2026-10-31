// Linear maps read from functions (MATRICES.md layer 1, BACKLOG L44c).
//
// A program writes a transform as a function on its own records, such as
// shear = (v) ↦ vec3(v.x + 0.5 · v.y, v.y, v.z). When every part of the
// result is a sum of the inputs' parts times constants, plus a constant,
// the function is an affine map, and the compiler may store and run it as
// a matrix and an offset: on a GPU `mat3x3f * v + b`, elsewhere unrolled
// multiply-adds, and two such functions composed are one matrix product.
// Which form pays is the compiler's choice (no explicit selection); this
// file only reads the function, the way derive.ts reads its slopes.
//
// The reading is an abstract evaluation: each value is a linear form (a
// coefficient per input part, and a constant), a record of values, or a
// function. Allowed: + − · / and negate, as builtins or the one generic
// ARITH ops, where · and / have a constant on one side; records built,
// read part by part, taken apart by a one-case match, added, negated and
// multiplied by a constant; lets, lambdas applied, definitions inlined;
// any builtin of constants, folded (so cos(π/6) is a number). Anything
// else, a comparison, an if, a fold over data, `fail` (Choice), an effect's
// operation or an action, makes the function not linear: `linearMap`
// answers null, so a map it returns has no effects.
//
// Prior art: reading a matrix out of a straight-line program is what
// compilers for linear algebra and shaders do when they fold affine code
// (e.g. Halide's and LLVM's affine analysis, MLIR's affine maps); the
// matrix of a linear map is the textbook one, column j the image of the
// j-th basis vector.

import type { Code, Id, NodeOf } from "../model.ts";
import { impl, type Op } from "../prelude.ts";
import { ARITH } from "./std.ts";
import { NUMBER } from "./types.ts";

// One input coordinate: parameter `param`'s part `field`, or the parameter
// itself when it is a Float64 (field null).
export interface Column { param: number; field: Id | null }

export interface LinearMap {
  // Each parameter: the record variant it is taken as, "number" for a
  // Float64, or null when the function never reads it.
  params: (Id | "number" | null)[];
  inputs: Column[];
  // The record variant the function builds, or null for a Float64.
  output: Id | null;
  // matrix[i][j]: how much input j adds to output part i.
  matrix: number[][];
  offset: number[];
}

class NotLinear extends Error {}

type Form = { k: "form"; c: Map<string, number>; k0: number };
type V = Form
  | { k: "rec"; variant: Id; parts: V[] }
  | { k: "param"; index: number }
  | { k: "closure"; lambda: NodeOf<"lambda">; env: Map<Id, V> }
  | { k: "ctor"; variant: Id }
  | { k: "part"; field: Id }
  | { k: "op"; op: string };

const num = (k0: number): Form => ({ k: "form", c: new Map(), k0 });
const isConst = (v: V): v is Form => v.k === "form" && [...v.c.values()].every((x) => x === 0);
const key = (param: number, field: Id | null) => `${param}:${field ?? ""}`;

const ARITH_OP: Record<Id, string> = { [ARITH.add]: "add", [ARITH.sub]: "sub", [ARITH.mul]: "mul", [ARITH.neg]: "neg" };

export function linearMap(code: Code, fn: Id): LinearMap | null {
  try {
    return read(code, fn);
  } catch (e) {
    if (e instanceof NotLinear) return null;
    throw e;
  }
}

function read(code: Code, fn: Id): LinearMap {
  const nodes = code.nodes;
  const no = (): never => { throw new NotLinear(); };
  let top = nodes[fn] as (typeof nodes)[Id] | undefined;
  if (top?.kind === "def") top = top.body ? nodes[top.body] : undefined;
  if (top?.kind !== "lambda") no();
  const lambda = top as NodeOf<"lambda">;

  // Which variant each record part belongs to.
  const partOwner = new Map<Id, Id>();
  for (const d of code.defs) {
    const def = nodes[d];
    const t = def?.kind === "def" && def.body ? nodes[def.body] : undefined;
    if (t?.kind !== "typedef" || t.effect) continue;
    for (const v of t.variants) for (const f of (nodes[v] as NodeOf<"variant">).fields) partOwner.set(f, v);
  }
  const fieldsOf = (variant: Id) => (nodes[variant] as NodeOf<"variant">).fields;

  // What each parameter turned out to be: a record of this variant, or a number.
  const shape: (Id | "number" | undefined)[] = lambda.params.map(() => undefined);
  const learn = (i: number, s: Id | "number") => { if (shape[i] !== undefined && shape[i] !== s) no(); shape[i] = s; };
  const paramAsRecord = (i: number, variant: Id): V => {
    learn(i, variant);
    return { k: "rec", variant, parts: fieldsOf(variant).map((f) => ({ k: "form", c: new Map([[key(i, f), 1]]), k0: 0 }) as Form) };
  };
  // A value used as a number.
  const form = (v: V): Form => {
    if (v.k === "form") return v;
    if (v.k === "param") { learn(v.index, "number"); return { k: "form", c: new Map([[key(v.index, null), 1]]), k0: 0 }; }
    return no();
  };
  const isRecord = (v: V) => v.k === "rec";

  const plus = (a: Form, b: Form, s: number): Form => {
    const c = new Map(a.c);
    for (const [x, y] of b.c) c.set(x, (c.get(x) ?? 0) + s * y);
    return { k: "form", c, k0: a.k0 + s * b.k0 };
  };
  const times = (w: number, v: V): V => {
    if (v.k === "rec") return { ...v, parts: v.parts.map((p) => times(w, p)) };
    const f = form(v);
    return { k: "form", c: new Map([...f.c].map(([x, y]) => [x, w * y])), k0: w * f.k0 };
  };
  const sum = (a: V, b: V, s: number): V => {
    if (a.k === "rec" || b.k === "rec") {
      if (a.k !== "rec" || b.k !== "rec" || a.variant !== b.variant) return no();
      return { ...a, parts: a.parts.map((p, i) => sum(p, b.parts[i], s)) };
    }
    return plus(form(a), form(b), s);
  };

  const arith = (op: string, args: V[]): V => {
    if (op === "add" && args.length === 2) return sum(args[0], args[1], 1);
    if (op === "sub" && args.length === 2) return sum(args[0], args[1], -1);
    if (op === "neg" && args.length === 1) return times(-1, args[0]);
    if (op === "mul" && args.length === 2) {
      const [a, b] = args;
      if (!isRecord(a) && isConst(form(a))) return times(form(a).k0, b);
      if (!isRecord(b) && isConst(form(b))) return times(form(b).k0, a);
      return no();
    }
    if (op === "div" && args.length === 2) {
      const b = form(args[1]);
      if (!isConst(b) || b.k0 === 0) return no();
      return times(1 / b.k0, args[0]);
    }
    // Any other builtin, of constants only.
    if (!(op in impl)) return no();
    const xs = args.map((a) => form(a));
    if (!xs.every(isConst)) return no();
    return num(impl[op as Op](...xs.map((x) => x.k0)));
  };

  let depth = 0;
  const apply = (f: V, args: V[]): V => {
    switch (f.k) {
      case "closure": {
        if (f.lambda.params.length !== args.length) return no();
        if (++depth > 64) return no();
        const env = new Map(f.env);
        f.lambda.params.forEach((p, i) => env.set(p, args[i]));
        const out = ev(f.lambda.body, env);
        depth--;
        return out;
      }
      case "ctor":
        if (args.length !== fieldsOf(f.variant).length) return no();
        return { k: "rec", variant: f.variant, parts: args };
      case "part": {
        const variant = partOwner.get(f.field);
        if (!variant || args.length !== 1) return no();
        let r = args[0];
        if (r.k === "param") r = paramAsRecord(r.index, variant);
        if (r.k !== "rec" || r.variant !== variant) return no();
        return r.parts[fieldsOf(variant).indexOf(f.field)];
      }
      case "op":
        return arith(f.op, args);
      default:
        return no();
    }
  };

  const defValues = new Map<Id, V>();
  function ev(id: Id, env: Map<Id, V>): V {
    const n = nodes[id];
    if (!n) return no();
    switch (n.kind) {
      case "lit":
        if (typeof n.value !== "number" || (n.of !== undefined && n.of !== NUMBER) || n.unit) return no();
        return num(n.value);
      case "lambda":
        return { k: "closure", lambda: n, env };
      case "call":
        return apply(ev(n.fn, env), n.args.map((a) => ev(a, env)));
      case "match": {
        if (n.arms.length !== 1 || n.otherwise) return no();
        const arm = nodes[n.arms[0]] as NodeOf<"arm">;
        let s = ev(n.scrutinee, env);
        if (s.k === "param") s = paramAsRecord(s.index, arm.variant);
        if (s.k !== "rec" || s.variant !== arm.variant) return no();
        const inner = new Map(env);
        arm.binds.forEach((b, i) => inner.set(b, (s as { parts: V[] }).parts[i]));
        return ev(arm.body, inner);
      }
      case "ref": {
        const t = nodes[n.target];
        if (env.has(n.target)) return env.get(n.target)!;
        if (ARITH_OP[n.target]) return { k: "op", op: ARITH_OP[n.target] };
        if (!t) return no();
        if (t.kind === "builtin") return { k: "op", op: t.op };
        if (t.kind === "variant") return { k: "ctor", variant: n.target };
        if (t.kind === "field") return { k: "part", field: n.target };
        if (t.kind === "def" && t.body && !t.way) {
          if (defValues.has(n.target)) return defValues.get(n.target)!;
          if (++depth > 64) return no();
          const v = ev(t.body, new Map());
          depth--;
          defValues.set(n.target, v);
          return v;
        }
        return no();
      }
      default:
        return no();
    }
  }

  const env = new Map<Id, V>(lambda.params.map((p, i) => [p, { k: "param", index: i }]));
  const out = ev(lambda.body, env);
  const rows: Form[] = out.k === "rec" ? out.parts.map((p) => form(p)) : [form(out)];
  const inputs: Column[] = shape.flatMap((s, param): Column[] =>
    s === undefined ? [] : s === "number" ? [{ param, field: null }] : fieldsOf(s).map((field) => ({ param, field })));
  return {
    params: shape.map((s) => s ?? null),
    inputs,
    output: out.k === "rec" ? out.variant : null,
    matrix: rows.map((r) => inputs.map((c) => (r.c.get(key(c.param, c.field)) ?? 0) + 0)),
    offset: rows.map((r) => r.k0 + 0), // + 0 turns −0 into 0
  };
}

// The map's value at the input coordinates `x` (in `inputs`' order).
export function applyLinear(m: LinearMap, x: number[]): number[] {
  return m.matrix.map((row, i) => row.reduce((s, a, j) => s + a * x[j], m.offset[i]));
}

// a after b, when b's outputs are a's inputs in order: one matrix and one
// offset, A·(Bx + b) + a = (AB)x + (Ab + a).
export function composeLinear(a: LinearMap, b: LinearMap): LinearMap | null {
  if (a.inputs.length !== b.matrix.length) return null;
  return {
    params: b.params,
    inputs: b.inputs,
    output: a.output,
    matrix: a.matrix.map((row) => b.inputs.map((_, j) => row.reduce((s, x, k) => s + x * b.matrix[k][j], 0))),
    offset: applyLinear(a, b.offset),
  };
}
