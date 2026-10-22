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
//
// Not differentiable: a case analysis that takes apart data built from the
// variable (it would need derivatives of data), comparisons and text as
// results, and solve nodes (implicit differentiation would do it; not yet).
// Generating a derivative as a definition (the editor's gesture) refuses
// those with NotDifferentiable. At run time, `derivative` can't refuse, so
// it reads what it can and puts `fail` where it can't: no slope there,
// which is why derivative's result may fail (Choice). Only the part that
// needs the missing slope fails; a piecewise function keeps the slopes of
// its other pieces.

import { FN } from "../../../invertible/src/expr.js";
import type { Code, Id, Node, NodeData, NodeOf } from "../model.ts";
import { children, freshId, ownerOfTypeParts } from "../model.ts";
import { fieldShapes } from "./nested.ts";
import type { Names } from "../presentation.ts";
import { impl } from "../prelude.ts";
import { FIRST, PAIR_V, S, SECOND } from "./std.ts";

export class NotDifferentiable extends Error {}

// A derivative under construction: a constant, or a recipe that builds
// fresh nodes each time it is placed (a node can't have two parents).
// `neg` and `recip` remember −y and 1/y, so a + (−y) prints as a − y and
// a · (1/y) as a / y.
type E = { k: "num"; v: number } | { k: "build"; build: () => Id; neg?: E; recip?: E } | { k: "none" };
const numE = (v: number): E => ({ k: "num", v });
const NONE: E = { k: "none" };
const isNum = (e: E, v?: number) => e.k === "num" && (v === undefined || e.v === v);

interface Ctx {
  // binder → how to refer to it in the new code
  sub: Map<Id, () => Id>;
  // binder → its derivative, for binders that depend on the variable
  d: Map<Id, E>;
}

interface SolverTree { k: "num" | "var" | "call"; v?: number; name?: string; f?: string; args?: SolverTree[] }
const PRIMS = FN as unknown as Record<string, { d: ((args: SolverTree[]) => SolverTree)[] }>;
const OPS: Record<Id, string> = { ...Object.fromEntries(Object.keys(impl).map((op) => [`builtin.${op}`, op])), [S.abs]: "abs" };
const BUILTIN: Record<string, Id> = Object.fromEntries(Object.entries(OPS).map(([id, op]) => [op, id]));

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
  const place = (e: E): Id => (e.k === "num" ? add({ kind: "lit", value: e.v }) : e.k === "none" ? callN(ref(S.fail)) : e.build());
  const cant = (why: string): E => {
    if (!lenient) throw new NotDifferentiable(why);
    return NONE;
  };

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
      case "lit": return add({ kind: "lit", value: n.value });
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
          if (OPS[head.target]) return chain(OPS[head.target], n.args, ctx);
          if (t.kind === "def" && t.body && nodes[t.body].kind === "lambda") return defD(head.target, n.args, ctx);
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
      sum = op("add", sum, op("mul", fromTree(PRIMS[name].d[i](holes)), da));
    });
    return sum;
  }

  // A let: the value and its derivative, both bound, then the body's
  // derivative in terms of them.
  function letD(n: NodeOf<"call">, lam: NodeOf<"lambda">, ctx: Ctx): E {
    return {
      k: "build", build: () => {
        const sub = new Map(ctx.sub), d = new Map(ctx.d);
        const params: Id[] = [], args: Id[] = [];
        const dParams: Id[] = [], dArgs: Id[] = [];
        lam.params.forEach((p, i) => {
          const np = binder(nm(p));
          sub.set(p, () => ref(np));
          params.push(np);
          args.push(copy(n.args[i], ctx));
          const dv = D(n.args[i], ctx);
          if (isNum(dv, 0)) return;
          if (dv.k === "none") { d.set(p, NONE); return; }
          const dp = binder(`${nm(p)}′`);
          d.set(p, { k: "build", build: () => ref(dp) });
          dParams.push(dp);
          dArgs.push(place(dv));
        });
        const body = place(D(lam.body, { sub, d }));
        return add({ kind: "call", fn: add({ kind: "lambda", params: [...params, ...dParams], body }), args: [...args, ...dArgs] });
      },
    };
  }

  // Through a call of another definition: its own derivative, generated
  // once and reused (and able to call itself, for recursion).
  function defD(def: Id, args: Id[], ctx: Ctx): E {
    let sum: E = numE(0);
    args.forEach((a, i) => {
      const da = D(a, ctx);
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
    const at: E = { k: "build", build: () => callN(callN(ref(S.derivative), copy(n.fn, ctx)), copy(n.args[0], ctx)) };
    return op("mul", at, du);
  }

  function matchD(n: NodeOf<"match">, ctx: Ctx): E {
    const arms = n.arms.map((a) => nodes[a] as NodeOf<"arm">);
    if (depends(n.scrutinee, new Set(ctx.d.keys())) && arms.some((a) => a.binds.length)) {
      return cant("this case analysis takes apart data built from the variable");
    }
    return {
      k: "build", build: () => add({
        kind: "match", scrutinee: copy(n.scrutinee, ctx),
        arms: arms.map((arm) => {
          const sub = new Map(ctx.sub);
          const binds = arm.binds.map((b) => { const nb = binder(nm(b)); sub.set(b, () => ref(nb)); return nb; });
          return add({ kind: "arm", variant: arm.variant, binds, results: arm.results.map(() => null), body: place(D(arm.body, { ...ctx, sub })) });
        }),
        otherwise: n.otherwise ? place(D(n.otherwise, ctx)) : null,
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
          const inner = { sub, d };
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
    return add({ kind: "lambda", params, body: place(D(lam.body, { sub, d })) });
  }

  return { lambda, partial, names: outNames, defs };
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
