// Differentiating a function by walking its graph.
//
// A function here is not a black box: it's a lambda node and the nodes
// under it. So its derivative is another function, built by reading the
// first one, the way JAX's `grad` transforms a program. The result is
// ordinary code (calls, lets, cases, folds) that the editor can show and
// the evaluator can run like anything else.
//
// The rules, per node:
//   number, unrelated variable   0
//   the variable                 1
//   arithmetic                   the chain rule, with each operation's
//                                partial derivatives taken from the solver's
//                                primitive table, where its evaluation and
//                                inverses live too (arithmetic is defined
//                                once)
//   let (a dot on a wire)        a let of the value and its derivative
//   call of a definition         the chain rule through a generated
//                                definition of its derivative (g′, or ∂g/∂a
//                                for several inputs); recursion is fine,
//                                since g′ can call g′
//   call of a function value     derivative(f)(u) · u′, at run time
//   if / match                   the same case analysis, each arm
//                                differentiated: piecewise, the way AD
//                                treats branches
//   fold                         a fold that carries each partial result
//                                together with its derivative, as a pair
//                                (forward-mode AD written in the language
//                                itself), then takes the derivative part
//   fail                         fail: where f has no value, neither has f′
//   a record of Float64s          a record: each part's derivative (a point
//                                moving has a velocity); reading a part,
//                                or taking the record apart, reads that
//                                part's; map parts, zip parts and total
//                                part by part. A definition that takes or
//                                returns one is differentiated where it's
//                                called, as if written there
//
// gradient(f), for f of one record of Float64s, is f's derivative along
// each part in turn, as a record: one forward pass per part, seeded with
// that direction (the way forward-mode AD computes a gradient).
//
// Not differentiable: a case analysis that takes apart data with several
// cases built from the variable, comparisons and text as results, and
// solve nodes (implicit differentiation would do it; not yet).
// Generating a derivative as a definition (the editor's gesture) refuses
// those with NotDifferentiable. At run time, `derivative` can't refuse, so
// it reads what it can and puts `fail` where it can't: no slope there,
// which is why derivative's result may fail (Choice). Only the part that
// needs the missing slope fails; a piecewise function keeps the slopes of
// its other pieces. When f is written right where derivative is applied
// and every slope can be read (smoothDerivative, below), the checker drops
// the Choice, and compilers generate the derivative ahead of time.

import { FN } from "../../../invertible/src/expr.js";
import type { Code, Id, Node, NodeData, NodeOf } from "../model.ts";
import { children, freshId, ownerOfTypeParts } from "../model.ts";
import { fieldShapes } from "./nested.ts";
import type { Names } from "../presentation.ts";
import { impl } from "../prelude.ts";
import { ARITH, FIRST, PAIR_V, S, SECOND } from "./std.ts";
import { NUMBER } from "./types.ts";

export class NotDifferentiable extends Error {}

// A derivative under construction: a constant, or a recipe that builds
// fresh nodes each time it is placed (a node can't have two parents).
// `neg` and `recip` remember −y and 1/y, so a + (−y) prints as a − y and
// a · (1/y) as a / y.
// A record of Float64s has a derivative part by part: `rec` holds each
// part's, and a `build` whose `variant` is set builds a whole record.
type E = { k: "num"; v: number } | { k: "build"; build: () => Id; neg?: E; recip?: E; variant?: Id } | { k: "none" }
  | { k: "rec"; variant: Id; parts: E[] };
const numE = (v: number): E => ({ k: "num", v });
const NONE: E = { k: "none" };
const isNum = (e: E, v?: number) => e.k === "num" && (v === undefined || e.v === v);
const variantOf = (e: E): Id | null => (e.k === "rec" ? e.variant : e.k === "build" ? e.variant ?? null : null);

interface Ctx {
  // binder → how to refer to it in the new code
  sub: Map<Id, () => Id>;
  // binder → its derivative, for binders that depend on the variable
  d: Map<Id, E>;
  // binder → its record's variant, for binders holding a record of Float64s
  shape: Map<Id, Id>;
}

interface SolverTree { k: "num" | "var" | "call"; v?: number; name?: string; f?: string; args?: SolverTree[] }
const PRIMS = FN as unknown as Record<string, { d: ((args: SolverTree[]) => SolverTree)[] }>;
const NUMBER_OPS: Record<Id, string> = { ...Object.fromEntries(Object.keys(impl).map((op) => [`builtin.${op}`, op])), [S.abs]: "abs" };
const BUILTIN: Record<string, Id> = Object.fromEntries(Object.entries(NUMBER_OPS).map(([id, op]) => [op, id]));
// The one generic + − · −x < (std.ts ARITH) differentiate as Float64's: a
// slope is a Float64, and arith.ts resolves them only after this.
const OPS: Record<Id, string> = { ...NUMBER_OPS, ...Object.fromEntries(Object.entries(ARITH).filter(([op]) => op in impl).map(([op, id]) => [id, op])) };

// lenient: put `fail` where the slope can't be read, instead of refusing.
export function deriver(code: Code, names: Names = {}, lenient = false) {
  // New nodes go into code.nodes itself, so they can be run right away.
  const nodes = code.nodes;
  const outNames: Names = {};
  const defs: Id[] = [];
  const partials = new Map<string, Id>();
  const nm = (id: Id) => outNames[id] ?? names[id] ?? "";

  const add = (n: NodeData): Id => {
    const id = freshId();
    nodes[id] = { id, ...n } as Node;
    return id;
  };
  const binder = (name: string) => { const id = add({ kind: "binder" }); if (name) outNames[id] = name; return id; };
  const ref = (target: Id) => add({ kind: "ref", target });
  const callN = (fn: Id, ...args: Id[]) => add({ kind: "call", fn, args });
  const place = (e: E): Id => (e.k === "num" ? add({ kind: "lit", value: e.v, of: NUMBER }) : e.k === "none" ? callN(ref(S.fail))
    : e.k === "rec" ? callN(ref(e.variant), ...e.parts.map(place)) : e.build());
  const cant = (why: string): E => {
    if (!lenient) throw new NotDifferentiable(why);
    return NONE;
  };

  // Records of Float64s. A record's derivative is a record: each part's
  // derivative, so a point moving along a curve has a velocity, and the
  // gradient of a function of a point is its derivative along each part
  // in turn. Only records (one case); data with several cases has no
  // derivative.
  let owners: Map<Id, Id> | null = null;
  const owner = (part: Id) => (owners ??= ownerOfTypeParts(code)).get(part);
  const record = (variant: Id): boolean => {
    const t = nodes[(nodes[owner(variant) ?? ""] as NodeOf<"def"> | undefined)?.body ?? ""];
    return t?.kind === "typedef" && !t.effect && t.variants.length === 1 && t.variants[0] === variant;
  };
  const fieldsOf = (variant: Id) => (nodes[variant] as NodeOf<"variant">).fields;
  // A zero where a record is expected is a record of zeros.
  const placeAs = (e: E, variant: Id | null): Id =>
    variant && e.k === "num" && e.v === 0 ? place({ k: "rec", variant, parts: fieldsOf(variant).map(() => numE(0)) }) : place(e);
  // Part `field` of a record's derivative.
  function partOf(e: E, field: Id): E {
    if (e.k === "rec") {
      const j = fieldsOf(e.variant).indexOf(field);
      return j < 0 ? cant("a part of the wrong record") : e.parts[j];
    }
    if (e.k === "build") return { k: "build", build: () => callN(ref(field), place(e)) };
    return e;
  }
  // The variant of the record expression `id` evaluates to, when it is
  // one of Float64s, read off the code (no types here): a record built
  // right there, a binder known to hold one, or what a function returns.
  function shapeOf(id: Id, ctx: Ctx, seen = new Set<Id>()): Id | null {
    const n = nodes[id];
    if (n.kind === "ref") return ctx.shape.get(n.target) ?? null;
    if (n.kind === "match") {
      for (const a of n.arms) { const v = shapeOf((nodes[a] as NodeOf<"arm">).body, ctx, seen); if (v) return v; }
      return null;
    }
    if (n.kind !== "call") return null;
    const head = nodes[n.fn];
    const inner = (lam: NodeOf<"lambda">) => {
      const shape = new Map(ctx.shape);
      lam.params.forEach((p, i) => { const v = n.args[i] && shapeOf(n.args[i], ctx, seen); if (v) shape.set(p, v); });
      return shapeOf(lam.body, { ...ctx, shape }, seen);
    };
    if (head.kind === "lambda") return inner(head);
    if (head.kind !== "ref") return null;
    if (head.target === S.mapParts || head.target === S.zipParts) return n.args[1] ? shapeOf(n.args[1], ctx, seen) : null;
    const t = nodes[head.target];
    if (t?.kind === "variant") return record(head.target) ? head.target : null;
    if (t?.kind === "field") {
      const tr = nodes[(t as NodeOf<"field">).type];
      const td = tr?.kind === "tref" ? nodes[(nodes[tr.target] as NodeOf<"def"> | undefined)?.body ?? ""] : null;
      return td?.kind === "typedef" && td.variants.length === 1 && record(td.variants[0]) ? td.variants[0] : null;
    }
    if (t?.kind === "def" && t.body && nodes[t.body].kind === "lambda" && !seen.has(head.target)) {
      seen.add(head.target);
      const v = inner(nodes[t.body] as NodeOf<"lambda">);
      seen.delete(head.target);
      return v;
    }
    return null;
  }
  // map parts, zip parts and total, differentiated part by part: part j of
  // map parts(f, v) is f(v.j), so its derivative is that call's.
  function partsD(n: NodeOf<"call">, which: Id, ctx: Ctx): E {
    const records = which === S.total ? n.args : n.args.slice(1);
    const variant = shapeOf(records[0], ctx);
    if (!variant) {
      // A Float64 is a record of one part, itself: map parts(f, x) is f(x).
      // A Float64's slope is a Float64; a record's would be one.
      const ds = records.map((r) => D(r, ctx));
      if (ds.every((d) => isNum(d, 0)) || ds.some(variantOf)) return cant("can't tell which record these parts are of");
      return D(which === S.total ? records[0] : add({ kind: "call", fn: n.args[0], args: records }), ctx);
    }
    const parts = fieldsOf(variant).map((field) => {
      const at = records.map((r) => add({ kind: "call", fn: add({ kind: "ref", target: field }), args: [r] }));
      return D(which === S.total ? at[0] : add({ kind: "call", fn: n.args[0], args: at }), ctx);
    });
    if (which !== S.total) return { k: "rec", variant, parts };
    return parts.reduce((a, b) => op("add", a, b), numE(0));
  }

  // Arithmetic on derivatives, simplifying as it goes so the result reads
  // like something a person would write.
  function op(name: string, ...xs: E[]): E {
    if (xs.some((x) => x.k === "none")) return NONE;
    if (xs.every((x) => x.k === "num")) {
      const r = (impl as Record<string, (...a: number[]) => number>)[name]?.(...xs.map((x) => (x as { v: number }).v)) ?? (name === "abs" ? Math.abs((xs[0] as { v: number }).v) : NaN);
      if (Number.isFinite(r)) return numE(r);
    }
    const [a, b] = xs;
    const neg = (e: E) => (e.k === "build" ? e.neg : e.k === "num" && e.v < 0 ? numE(-e.v) : undefined);
    const recip = (e: E) => (e.k === "build" ? e.recip : undefined);
    switch (name) {
      case "add":
        if (isNum(a, 0)) return b;
        if (isNum(b, 0)) return a;
        if (neg(b)) return op("sub", a, neg(b)!);
        if (neg(a)) return op("sub", b, neg(a)!);
        break;
      case "sub": if (isNum(b, 0)) return a; if (isNum(a, 0)) return op("neg", b); break;
      case "mul":
        if (isNum(a, 0) || isNum(b, 0)) return numE(0);
        if (isNum(a, 1)) return b;
        if (isNum(b, 1)) return a;
        if (isNum(a, -1)) return op("neg", b);
        if (isNum(b, -1)) return op("neg", a);
        if (a.k === "build" && a.neg) return op("neg", op("mul", a.neg, b));
        if (b.k === "build" && b.neg) return op("neg", op("mul", a, b.neg));
        if (recip(b)) return op("div", a, recip(b)!);
        if (recip(a)) return op("div", b, recip(a)!);
        break;
      case "neg": if (a.k === "build" && a.neg) return a.neg; break;
      case "div": if (isNum(b, 1)) return a; if (isNum(a, 0)) return numE(0); break;
      case "pow": if (isNum(b, 1)) return a; if (isNum(b, 0)) return numE(1); break;
    }
    const e: E = { k: "build", build: () => callN(ref(BUILTIN[name]), ...xs.map(place)) };
    if (name === "neg") e.neg = a;
    if (name === "div" && isNum(a, 1)) e.recip = b;
    return e;
  }

  const copyE = (id: Id, ctx: Ctx): E => {
    const n = nodes[id];
    return n.kind === "lit" && typeof n.value === "number" ? numE(n.value) : { k: "build", build: () => copy(id, ctx) };
  };

  // A deep copy with fresh ids. Binders introduced inside get fresh binders
  // too; references to binders outside follow ctx.sub.
  function copy(id: Id, ctx: Ctx): Id {
    const n = nodes[id];
    const fresh = (bs: Id[], sub: Map<Id, () => Id>) => bs.map((b) => { const nb = binder(nm(b)); sub.set(b, () => ref(nb)); return nb; });
    switch (n.kind) {
      case "lit": return add({ kind: "lit", value: n.value, ...(n.of ? { of: n.of } : {}) });
      case "hole": return add({ kind: "hole" });
      case "ref": return ctx.sub.has(n.target) ? ctx.sub.get(n.target)!() : ref(n.target);
      case "call": return add({ kind: "call", fn: copy(n.fn, ctx), args: n.args.map((a) => copy(a, ctx)) });
      case "lambda": {
        const sub = new Map(ctx.sub);
        const params = fresh(n.params, sub);
        return add({ kind: "lambda", params, body: copy(n.body, { ...ctx, sub }) });
      }
      case "match": case "fold": {
        const arms = n.arms.map((a) => {
          const arm = nodes[a] as NodeOf<"arm">;
          const sub = new Map(ctx.sub);
          const binds = fresh(arm.binds, sub);
          const results = arm.results.map((r) => (r === null ? null : fresh([r], sub)[0]));
          return add({ kind: "arm", variant: arm.variant, binds, results, body: copy(arm.body, { ...ctx, sub }) });
        });
        const scrutinee = copy(n.scrutinee, ctx);
        return n.kind === "fold" ? add({ kind: "fold", scrutinee, arms })
          : add({ kind: "match", scrutinee, arms, otherwise: n.otherwise ? copy(n.otherwise, ctx) : null });
      }
      case "solve": {
        const sub = new Map(ctx.sub);
        const given = Object.fromEntries(Object.entries(n.given).map(([k, e]) => [k, copy(e, ctx)]));
        const binds = Object.fromEntries(Object.entries(n.binds).map(([k, b]) => [k, fresh([b], sub)[0]]));
        return add({ kind: "solve", fn: n.fn, given, binds, body: copy(n.body, { ...ctx, sub }) });
      }
      default: throw new NotDifferentiable(`can't copy a ${n.kind}`);
    }
  }

  // Does expression `id` depend on any binder in `dep`? Lets pass the
  // dependence on to their binders; a fold's results are assumed to.
  function depends(id: Id, dep: Set<Id>): boolean {
    const n = nodes[id];
    if (n.kind === "ref") return dep.has(n.target);
    if (n.kind === "call" && nodes[n.fn].kind === "lambda") {
      const lam = nodes[n.fn] as NodeOf<"lambda">;
      const inner = new Set(dep);
      n.args.forEach((a, i) => { if (depends(a, dep)) inner.add(lam.params[i]); });
      return depends(lam.body, inner);
    }
    if (n.kind === "fold" && depends(n.scrutinee, dep)) return true;
    if (n.kind === "fold") {
      const inner = new Set(dep);
      for (const a of n.arms) for (const r of (nodes[a] as NodeOf<"arm">).results) if (r) inner.add(r);
      return n.arms.some((a) => depends((nodes[a] as NodeOf<"arm">).body, inner));
    }
    return children(n).some((c) => nodes[c].kind !== "binder" && depends(c, dep));
  }

  const isFail = (id: Id) => {
    const n = nodes[id];
    return n.kind === "call" && nodes[n.fn].kind === "ref" && (nodes[n.fn] as NodeOf<"ref">).target === S.fail;
  };

  // The derivative of expression `id`, given the derivatives of the
  // binders it can see.
  function D(id: Id, ctx: Ctx): E {
    if (isFail(id)) return { k: "build", build: () => copy(id, ctx) };
    if (!depends(id, new Set(ctx.d.keys()))) return numE(0);
    const n = nodes[id];
    switch (n.kind) {
      case "ref": return ctx.d.get(n.target) ?? numE(0);
      case "call": {
        const head = nodes[n.fn];
        if (head.kind === "lambda") return letD(n, head, ctx);
        if (head.kind === "ref") {
          const t = nodes[head.target];
          // A generic + − · −x on records is Float64's part by part, as
          // arith.ts resolves it: differentiated as that.
          if (Object.values(ARITH).includes(head.target) && OPS[head.target] && shapeOf(n.args[0], ctx)) {
            const parts = n.args.length === 1 ? S.mapParts : S.zipParts;
            const call = add({ kind: "call", fn: add({ kind: "ref", target: parts }), args: [add({ kind: "ref", target: BUILTIN[OPS[head.target]] }), ...n.args] });
            return partsD(nodes[call] as NodeOf<"call">, parts, ctx);
          }
          if (OPS[head.target]) return chain(OPS[head.target], n.args, ctx);
          // floor and mod jump (at whole numbers, at multiples of b), so
          // there they have no slope, and a slope that's 0 between jumps
          // would hide that: they aren't differentiated.
          // Rounding to Float32 stands for the number itself (the job of
          // every operation in the Float32 representation, NUMBERS.md), so
          // its slope is the slope of what it rounds.
          if (head.target === S.float32) return D(n.args[0], ctx);
          if (head.target === S.floor || head.target === S.mod) return cant(`${names[head.target] ?? head.target} jumps, so it has no slope where it does`);
          if (head.target === S.mapParts || head.target === S.zipParts || head.target === S.total) return partsD(n, head.target, ctx);
          if (t.kind === "variant") {
            if (!record(head.target)) return cant("data with several cases has no derivative");
            const parts = n.args.map((a) => D(a, ctx));
            return parts.every((p) => isNum(p, 0)) ? numE(0) : { k: "rec", variant: head.target, parts };
          }
          if (t.kind === "field") return partOf(D(n.args[0], ctx), head.target);
          if (t.kind === "def" && t.body && nodes[t.body].kind === "lambda") return defD(n, head.target, ctx);
          if (t.kind === "binder") return unknownD(n, ctx);
          return cant(`the derivative goes through ${names[head.target] ?? head.target}, which isn't arithmetic`);
        }
        return unknownD(n, ctx);
      }
      case "match": return matchD(n, ctx);
      case "fold": return foldD(n, ctx);
      default: return cant(`can't differentiate through a ${n.kind}`);
    }
  }

  // Σ ∂op/∂aᵢ · aᵢ′, with ∂op/∂aᵢ from the solver's primitive table.
  function chain(name: string, args: Id[], ctx: Ctx): E {
    const vals = args.map((a) => copyE(a, ctx));
    const holes = args.map((_, i): SolverTree => ({ k: "var", name: `#${i}` }));
    const fromTree = (t: SolverTree): E =>
      t.k === "num" ? numE(t.v!) : t.k === "var" ? vals[+t.name!.slice(1)] : op(t.f!, ...t.args!.map(fromTree));
    let sum: E = numE(0);
    args.forEach((a, i) => {
      const da = D(a, ctx);
      if (isNum(da, 0)) return;
      if (variantOf(da)) { sum = cant("arithmetic is on Float64s, not records"); return; }
      sum = op("add", sum, op("mul", fromTree(PRIMS[name].d[i](holes)), da));
    });
    return sum;
  }

  // A let: the value and its derivative, both bound, then the body's
  // derivative in terms of them.
  // The body's derivative is worked out first (so it's known whether it
  // is a record's); the binders it refers to are made each time it's
  // placed.
  function letD(n: NodeOf<"call">, lam: NodeOf<"lambda">, ctx: Ctx): E {
    const sub = new Map(ctx.sub), d = new Map(ctx.d), shape = new Map(ctx.shape);
    const slots = lam.params.map((p, i) => {
      const slot = { p, np: "", dp: "", dv: D(n.args[i], ctx), bound: false };
      sub.set(p, () => ref(slot.np));
      const v = shapeOf(n.args[i], ctx) ?? variantOf(slot.dv);
      if (v) shape.set(p, v);
      const dv = slot.dv;
      if (isNum(dv, 0)) return slot;
      if (dv.k === "none") { d.set(p, NONE); return slot; }
      // A record whose parts' derivatives are all constants (a direction
      // to differentiate along) needs no binder.
      if (dv.k === "rec" && dv.parts.every((x) => x.k === "num")) { d.set(p, dv); return slot; }
      slot.bound = true;
      const whole: E = { k: "build", build: () => ref(slot.dp), variant: variantOf(dv) ?? undefined };
      d.set(p, dv.k === "rec" ? { k: "rec", variant: dv.variant, parts: dv.parts.map((x, j) => (x.k === "num" ? x : partOf(whole, fieldsOf(dv.variant)[j]))) } : whole);
      return slot;
    });
    const dBody = D(lam.body, { sub, d, shape });
    // A constant (a direction, part by part) needs none of the let.
    if (dBody.k === "num" || (dBody.k === "rec" && dBody.parts.every((x) => x.k === "num"))) return dBody;
    return {
      k: "build", variant: variantOf(dBody) ?? undefined, build: () => {
        const params: Id[] = [], args: Id[] = [];
        const dParams: Id[] = [], dArgs: Id[] = [];
        for (const [i, slot] of slots.entries()) {
          slot.np = binder(nm(slot.p));
          params.push(slot.np);
          args.push(copy(n.args[i], ctx));
          if (!slot.bound) continue;
          slot.dp = binder(`${nm(slot.p)}′`);
          dParams.push(slot.dp);
          dArgs.push(place(slot.dv));
        }
        const body = place(dBody);
        return add({ kind: "call", fn: add({ kind: "lambda", params: [...params, ...dParams], body }), args: [...args, ...dArgs] });
      },
    };
  }

  // Through a call of another definition: its own derivative, generated
  // once and reused (and able to call itself, for recursion).
  // A definition that takes or returns a record is differentiated where
  // it's called, as if its body were written there: its partials would be
  // records, and a generic one (the vectors module's) has no one record.
  const inlining = new Set<Id>();
  function defD(n: NodeOf<"call">, def: Id, ctx: Ctx): E {
    const args = n.args;
    const ds = args.map((a) => D(a, ctx));
    if (ds.some(variantOf) || shapeOf(n.id, ctx)) {
      if (inlining.has(def)) return cant(`${nm(def)} calls itself with a record, which isn't differentiated yet`);
      inlining.add(def);
      try { return letD(n, nodes[(nodes[def] as NodeOf<"def">).body!] as NodeOf<"lambda">, ctx); } finally { inlining.delete(def); }
    }
    let sum: E = numE(0);
    args.forEach((a, i) => {
      const da = ds[i];
      if (isNum(da, 0)) return;
      const p = partial(def, i);
      const at: E = { k: "build", build: () => callN(ref(p), ...args.map((x) => copy(x, ctx))) };
      sum = op("add", sum, op("mul", at, da));
    });
    return sum;
  }

  function partial(def: Id, i: number): Id {
    const key = `${def}/${i}`;
    if (partials.has(key)) return partials.get(key)!;
    const lam = nodes[(nodes[def] as NodeOf<"def">).body!] as NodeOf<"lambda">;
    const id = add({ kind: "def", body: null });
    outNames[id] = lam.params.length === 1 ? `${nm(def)}′` : `∂${nm(def)}/∂${nm(lam.params[i])}`;
    partials.set(key, id);
    defs.push(id);
    nodes[id] = { id, kind: "def", body: lambda(lam.id, i) };
    return id;
  }

  // A function value we can't see statically: ask for its derivative when
  // the program runs.
  function unknownD(n: NodeOf<"call">, ctx: Ctx): E {
    if (n.args.length !== 1) return cant("only functions of one number can be differentiated at run time");
    if (depends(n.fn, new Set(ctx.d.keys()))) return cant("the function being called depends on the variable itself");
    const du = D(n.args[0], ctx);
    if (variantOf(du)) return cant("only functions of one number can be differentiated at run time");
    const at: E = { k: "build", build: () => callN(callN(ref(S.derivative), copy(n.fn, ctx)), copy(n.args[0], ctx)) };
    return op("mul", at, du);
  }

  function matchD(n: NodeOf<"match">, ctx: Ctx): E {
    const arms = n.arms.map((a) => nodes[a] as NodeOf<"arm">);
    // Taking apart a record of Float64s built from the variable: each part
    // has its derivative.
    let ds: E = numE(0);
    if (depends(n.scrutinee, new Set(ctx.d.keys())) && arms.some((a) => a.binds.length)) {
      ds = D(n.scrutinee, ctx);
      if (arms.length !== 1 || n.otherwise || !(isNum(ds, 0) || variantOf(ds))) return cant("this case analysis takes apart data built from the variable");
    }
    const each = arms.map((arm) => {
      const sub = new Map(ctx.sub), d = new Map(ctx.d), shape = new Map(ctx.shape);
      const binds = arm.binds.map((b) => ({ b, nb: "" }));
      for (const [j, x] of binds.entries()) {
        sub.set(x.b, () => ref(x.nb));
        const dj = partOf(ds, fieldsOf(arm.variant)[j]);
        if (!isNum(dj, 0)) d.set(x.b, dj);
      }
      return { arm, binds, body: D(arm.body, { sub, d, shape }) };
    });
    const other = n.otherwise ? D(n.otherwise, ctx) : null;
    const variant = [...each.map((a) => a.body), ...(other ? [other] : [])].map(variantOf).find(Boolean) ?? null;
    return {
      k: "build", variant: variant ?? undefined, build: () => add({
        kind: "match", scrutinee: copy(n.scrutinee, ctx),
        arms: each.map(({ arm, binds, body }) => {
          for (const x of binds) x.nb = binder(nm(x.b));
          return add({ kind: "arm", variant: arm.variant, binds: binds.map((x) => x.nb), results: arm.results.map(() => null), body: placeAs(body, variant) });
        }),
        otherwise: other ? placeAs(other, variant) : null,
      }),
    };
  }

  // A fold over data that doesn't depend on the variable (a list of
  // coefficients, say), whose cases compute numbers that do. Each folded
  // value becomes a pair (value, derivative).
  function foldD(n: NodeOf<"fold">, ctx: Ctx): E {
    if (depends(n.scrutinee, new Set(ctx.d.keys()))) return cant("this fold takes apart data built from the variable");
    // Folded values of nested data (a rose tree's List R) would need pairs
    // inside the container; not yet.
    if (n.arms.some((a) => {
      const arm = nodes[a] as NodeOf<"arm">;
      const shapes = fieldShapes(code, ownerOfTypeParts(code).get(arm.variant)!, arm.variant);
      return arm.results.some((r, i) => r && shapes[i] === "nested");
    })) return cant("this fold goes through nested data (a container of the type), which isn't differentiated yet");
    return {
      k: "build", build: () => {
        const arms = n.arms.map((a) => {
          const arm = nodes[a] as NodeOf<"arm">;
          const sub = new Map(ctx.sub), d = new Map(ctx.d);
          const binds = arm.binds.map((b) => { const nb = binder(nm(b)); sub.set(b, () => ref(nb)); return nb; });
          const results = arm.results.map((r) => {
            if (r === null) return null;
            const nr = binder(`${nm(r)} & slope`);
            sub.set(r, () => callN(ref(FIRST), ref(nr)));
            d.set(r, { k: "build", build: () => callN(ref(SECOND), ref(nr)) });
            return nr;
          });
          const inner = { sub, d, shape: ctx.shape };
          const body = callN(ref(PAIR_V), copy(arm.body, inner), place(D(arm.body, inner)));
          return add({ kind: "arm", variant: arm.variant, binds, results, body });
        });
        return callN(ref(SECOND), add({ kind: "fold", scrutinee: copy(n.scrutinee, ctx), arms }));
      },
    };
  }

  // The derivative of a lambda with respect to its i-th input, as a new
  // lambda with the same inputs.
  function lambda(lamId: Id, i: number): Id {
    const lam = nodes[lamId] as NodeOf<"lambda">;
    const sub = new Map<Id, () => Id>();
    const params = lam.params.map((p) => { const np = binder(nm(p)); sub.set(p, () => ref(np)); return np; });
    const d = new Map<Id, E>([[lam.params[i], numE(1)]]);
    const ctx = { sub, d, shape: new Map<Id, Id>() };
    return add({ kind: "lambda", params, body: placeAs(D(lam.body, ctx), shapeOf(lam.body, ctx)) });
  }

  // The gradient of a function of one record of Float64s, as a new lambda:
  // the record of its derivatives along each part, one forward pass per
  // part (forward-mode AD, seeded with each direction in turn).
  function gradient(lamId: Id, variant: Id): Id {
    const lam = nodes[lamId] as NodeOf<"lambda">;
    const [p] = lam.params;
    const np = binder(nm(p));
    const sub = new Map<Id, () => Id>([[p, () => ref(np)]]);
    const fields = fieldsOf(variant);
    const parts = fields.map((_, j) => {
      const seed: E = { k: "rec", variant, parts: fields.map((_, i) => numE(i === j ? 1 : 0)) };
      return D(lam.body, { sub, d: new Map([[p, seed]]), shape: new Map([[p, variant]]) });
    });
    if (parts.some(variantOf)) throw new NotDifferentiable("gradient needs a function whose result is a Float64");
    return add({ kind: "lambda", params: [np], body: place({ k: "rec", variant, parts }) });
  }

  return { lambda, gradient, partial, names: outNames, defs };
}

// f′ as a new definition next to f (and any helpers it needs, like g′ for
// a g that f calls). Returns the code with them added, and their names.
export function differentiate(code: Code, names: Names, def: Id, wrt = 0): { code: Code; names: Names; def: Id; defs: Id[] } {
  const out: Code = { nodes: { ...code.nodes }, defs: [...code.defs] };
  const d = deriver(out, names);
  const id = d.partial(def, wrt);
  out.defs.push(...d.defs);
  return { code: out, names: d.names, def: id, defs: d.defs };
}

// For the evaluator: the derivative of a function value as a lambda,
// written into `code` (cached, so asking twice is free). The function is a
// lambda of the program, or a builtin (sqrt), read as x ↦ sqrt(x). Never
// refuses: where a slope can't be read, the lambda fails.
const cache = new WeakMap<object, Map<Id, Id>>();
export function derivativeLambda(code: Code, fn: { lambda: Id } | { prim: Id }): Id {
  let c = cache.get(code.nodes);
  if (!c) cache.set(code.nodes, (c = new Map()));
  const key = "lambda" in fn ? fn.lambda : fn.prim;
  if (!c.has(key)) {
    let lambda = key;
    if ("prim" in fn) {
      const x = freshId(), r = freshId(), body = freshId();
      lambda = freshId();
      code.nodes[x] = { id: x, kind: "binder" };
      code.nodes[r] = { id: r, kind: "ref", target: x };
      const head = freshId();
      code.nodes[head] = { id: head, kind: "ref", target: fn.prim };
      code.nodes[body] = { id: body, kind: "call", fn: head, args: [r] };
      code.nodes[lambda] = { id: lambda, kind: "lambda", params: [x], body };
    }
    c.set(key, deriver(code, {}, true).lambda(lambda, 0));
  }
  return c.get(key)!;
}

// `derivative(f)` where f is written right there: a lambda, a definition,
// or an arithmetic builtin. Then the derivative can be generated before the
// program runs (by the checker and the compilers), not only by the
// evaluator. Returns the lambda to differentiate, writing a wrapper into
// `code` for a builtin.
function knownFunction(code: Code, arg: Id): Id | null {
  const n = code.nodes[arg];
  if (n?.kind === "lambda") return n.params.length === 1 ? arg : null;
  if (n?.kind !== "ref") return null;
  const t = code.nodes[n.target];
  if (t?.kind === "def") {
    const body = t.body ? code.nodes[t.body] : null;
    return body?.kind === "lambda" && body.params.length === 1 ? body.id : null;
  }
  if (!OPS[n.target]) return null;
  const x = freshId(), r = freshId(), head = freshId(), body = freshId(), lambda = freshId();
  code.nodes[x] = { id: x, kind: "binder" };
  code.nodes[r] = { id: r, kind: "ref", target: x };
  code.nodes[head] = { id: head, kind: "ref", target: n.target };
  code.nodes[body] = { id: body, kind: "call", fn: head, args: [r] };
  code.nodes[lambda] = { id: lambda, kind: "lambda", params: [x], body };
  return lambda;
}

// The one case of a record type (a typedef with one variant), whose
// gradient is a record of the same type.
export function recordVariant(code: Code, type: Id): Id | null {
  const t = code.nodes[(code.nodes[type] as NodeOf<"def"> | undefined)?.body ?? ""];
  return t?.kind === "typedef" && !t.effect && t.variants.length === 1 ? t.variants[0] : null;
}

// gradient(f) where f is a lambda or a definition of one input, and
// derive.ts can read every slope along every part of `variant`.
function knownLambda(code: Code, arg: Id): Id | null {
  const n = code.nodes[arg];
  const lam = n?.kind === "lambda" ? n : n?.kind === "ref" && code.nodes[n.target]?.kind === "def" ? code.nodes[(code.nodes[n.target] as NodeOf<"def">).body ?? ""] : null;
  return lam?.kind === "lambda" && lam.params.length === 1 ? lam.id : null;
}
export function smoothGradient(code: Code, arg: Id, variant: Id): boolean {
  const scratch: Code = { nodes: { ...code.nodes }, defs: code.defs };
  try {
    const lam = knownLambda(scratch, arg);
    if (!lam) return false;
    const before = new Set(Object.keys(scratch.nodes));
    deriver(scratch).gradient(lam, variant);
    return !Object.values(scratch.nodes).some((n) => !before.has(n.id) && n.kind === "ref" && (n.target === S.derivative || n.target === S.gradient));
  } catch {
    return false;
  }
}

// For the evaluator: gradient(f) at a record of `variant`, as a lambda
// (cached like derivativeLambda). Never refuses: where a slope can't be
// read, it fails.
export function gradientLambda(code: Code, fn: { lambda: Id }, variant: Id): Id {
  let c = cache.get(code.nodes);
  if (!c) cache.set(code.nodes, (c = new Map()));
  const key = `${fn.lambda}∇${variant}`;
  if (!c.has(key)) c.set(key, deriver(code, {}, true).gradient(fn.lambda, variant));
  return c.get(key)!;
}

const derivativeCall = (code: Code, id: Id, which: Id = S.derivative): id is Id => {
  const n = code.nodes[id];
  return n?.kind === "call" && n.args.length === 1 && code.nodes[n.fn]?.kind === "ref" && (code.nodes[n.fn] as NodeOf<"ref">).target === which;
};

// Does derivative(arg) have a slope everywhere f has a value? It does when
// f is known and every node on the way is one derive.ts can read: then
// the derivative never fails where f doesn't, and the checker types it
// without Choice. A function value passed in (unknown until run time), or
// floor, or data with several cases taken apart, keeps Choice.
export function smoothDerivative(code: Code, arg: Id): boolean {
  const scratch: Code = { nodes: { ...code.nodes }, defs: code.defs };
  try {
    const lam = knownFunction(scratch, arg);
    if (!lam) return false;
    const before = new Set(Object.keys(scratch.nodes));
    deriver(scratch).lambda(lam, 0);
    // A call of a function value inside asks `derivative` again at run time.
    return !Object.values(scratch.nodes).some((n) => !before.has(n.id) && n.kind === "ref" && n.target === S.derivative);
  } catch {
    return false;
  }
}

// A copy of the program where each smooth `derivative(f)` is replaced by
// the lambda it stands for, with the partial derivatives it calls added as
// definitions (∂blend/∂a …, shared between calls). This is what a compiler
// that can't run the evaluator inside it (the GPU's) compiles: the same
// code the evaluator would generate at run time, generated ahead of it.
// The source keeps saying derivative(f), so editing f changes the slope.
//
// gradient(f) the same way, given `variants`: the record a gradient call
// is over (the checker knows it; the code alone doesn't).
export function expandDerivatives(code: Code, names: Names, variants: (call: Id) => Id | null = () => null): { code: Code; names: Names; expanded: Id[] } {
  const arg = (id: Id) => (code.nodes[id] as NodeOf<"call">).args[0];
  const grads = new Map<Id, Id>();
  for (const id of Object.keys(code.nodes)) {
    const v = derivativeCall(code, id, S.gradient) ? variants(id) : null;
    if (v && smoothGradient(code, arg(id), v)) grads.set(id, v);
  }
  const calls = Object.keys(code.nodes).filter((id) => grads.has(id) || (derivativeCall(code, id) && smoothDerivative(code, arg(id))));
  if (!calls.length) return { code, names, expanded: [] };
  const out: Code = { nodes: { ...code.nodes }, defs: [...code.defs] };
  const d = deriver(out, names);
  for (const id of calls) {
    const f = (out.nodes[id] as NodeOf<"call">).args[0];
    const lam = grads.has(id) ? d.gradient(knownLambda(out, f)!, grads.get(id)!) : d.lambda(knownFunction(out, f)!, 0);
    // The call node itself becomes the lambda, so whatever points at it
    // (the call that applies it, usually) now applies the derivative.
    out.nodes[id] = { ...out.nodes[lam], id } as Node;
  }
  out.defs.push(...d.defs);
  return { code: out, names: { ...names, ...d.names }, expanded: calls };
}
