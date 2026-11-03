// A solve of a definition with results, in the direction it declares,
// becomes a call per result it binds, before compiling (C55), or one call
// for the results it binds together when they share work (C55b). Such a
// definition is a predicate whose body says each result equals something
// of its inputs, `x = r · cos(t) and y = r · sin(t)` (RESULTS.md,
// POLAR.md). Read that way it is a function per result, so
// `_, y = polar(1, t)` is `y = polar's y(1, t)`: sin alone, with no cos
// computed for the x nobody reads. Before this, such a direction at a Dual,
// a Fixed or a type of the program's own ran in the relational
// interpreter on every call.
//
// Only bodies that are exactly that are opened up: a conjunction of
// equations, one per result, each a result on one side and on the other
// something that reads no result, which the evaluator already runs forward
// (directions.ts computedForward). Anything else (a check that can fail, a
// result read by another) keeps its solve, and so does a direction the
// numeric solver plans (Float64's), compiled from its plan as before. The function of a result is a
// definition of its own, made once per definition and result, named
// "polar's y". The source still says the solve; the evaluator still runs
// it as a relation.
//
// Prior art: Mercury compiles each mode of a predicate as its own
// procedure, and drops outputs no caller reads (Somogyi, Henderson and
// Conway, 1996); dead-result elimination is the same idea in any optimiser.

import type { Code, Id, Node, NodeOf } from "../../ters/src/model.ts";
import { isUse, useTarget, isCall, type Call } from "../../ters/src/model.ts";
import { freshId, mapIds, subtree } from "../../ters/src/model.ts";
import type { Names } from "../../ters/src/presentation.ts";
import { PAIR_V, TRUE } from "../../ters/src/lang/std.ts";
import { computedForward, givenBy } from "../../ters/src/lang/directions.ts";
import { planSolve } from "../../ters/src/lang/solve.ts";
import { COMMUTES } from "../../ters/src/lang/modules.ts";

export function solvesAsCalls(code: Code, names: Names): { code: Code; names: Names; expanded: Id[] } {
  const out: Code = { nodes: { ...code.nodes }, defs: [...code.defs] };
  const more: Names = {};
  const add = (n: Omit<Node, "id">) => { const id = freshId(); out.nodes[id] = { id, ...n } as Node; return id; };
  const refTo = (id: Id) => { const n = code.nodes[id]; return n?.kind === "ref" ? n.target : null; };
  // Each result's expression, or null when the body isn't one equation
  // per result (directions.ts givenBy, which the evaluator reads too).
  const shapes = new Map<Id, Map<Id, Id> | null>();
  const shapeOf = (d: Id): Map<Id, Id> | null => {
    if (shapes.has(d)) return shapes.get(d)!;
    const def = code.nodes[d];
    const lam = def?.kind === "def" && def.results?.length && def.body ? code.nodes[def.body] : null;
    const es = lam?.kind === "lambda" && def?.kind === "def" ? givenBy(code, lam.body, def.results!) : null;
    const got = es ? new Map(def!.kind === "def" ? def!.results!.map((r, i) => [r, es[i]] as const) : []) : null;
    shapes.set(d, got);
    return got;
  };
  // The definition giving result r of d from d's inputs: d's lambda with
  // the inputs only, its body r's expression, every node copied.
  const made = new Map<string, Id | null>();
  const resultFn = (d: Id, r: Id): Id => {
    const key = `${d} ${r}`;
    if (made.has(key)) return made.get(key)!;
    const def = code.nodes[d] as NodeOf<"def">, lam = code.nodes[def.body!] as NodeOf<"lambda">;
    const inputs = lam.params.filter((p) => !def.results!.includes(p));
    const expr = shapeOf(d)!.get(r)!;
    const fresh = new Map<Id, Id>();
    const inside = new Set([...inputs, ...subtree(code, expr)]);
    const f = (id: Id) => (inside.has(id) ? (fresh.get(id) ?? (fresh.set(id, freshId()), fresh.get(id)!)) : id);
    for (const id of inside) {
      out.nodes[f(id)] = mapIds(code.nodes[id], f);
      if (names[id] !== undefined) more[f(id)] = names[id];
    }
    const body = add({ kind: "lambda", params: inputs.map(f), body: f(expr) } as Omit<Node, "id">);
    const nd = add({ kind: "def", body } as Omit<Node, "id">);
    more[nd] = `${names[d] ?? d}'s ${names[r] ?? r}`;
    out.defs.push(nd);
    made.set(key, nd);
    return nd;
  };
  // Results that share work, given together (C55b): when a solve binds
  // several results, their expressions are walked side by side from the
  // top, as far as they agree on what runs first: a match on the same
  // thing, a let of the same value. That much runs once, in one function
  // whose answer is the bound results in pairs, (length, angle); where they
  // part, each result's own rest is a component of the pair. Fixed's
  // unpolar runs CORDIC's vectoring once for both length and angle that
  // way. Parts are only taken where the value is the answer (a match's
  // arm, a let's body), so a pair is never fed to anything else.
  const pair = (xs: Id[]): Id => xs.length === 1 ? xs[0] : add({ kind: "call", fn: add({ kind: "ref", target: PAIR_V } as Omit<Node, "id">), args: [xs[0], pair(xs.slice(1))] } as Omit<Node, "id">);
  // A copy of e with its own binders fresh and the context's binders read
  // through sub.
  // `shared`: parts read from a value worked out before, by its binder.
  const copy = (e: Id, sub: Map<Id, Id>, shared?: Map<Id, Id>): Id => {
    const inside = new Set(subtree(code, e)), fresh = new Map<Id, Id>();
    const f = (id: Id) => (inside.has(id) ? (fresh.get(id) ?? (fresh.set(id, freshId()), fresh.get(id)!)) : (sub.get(id) ?? id));
    for (const id of inside) {
      const b = shared?.get(id);
      out.nodes[f(id)] = b ? { id: f(id), kind: "ref", target: b } as Node : mapIds(code.nodes[id], f);
      if (names[id] !== undefined && !b) more[f(id)] = names[id];
    }
    return f(e);
  };
  // a and b do the same, b's binders standing for a's (m, then the
  // context's subA and subB).
  const commutes = (f: Id) => { const r = code.nodes[f], t = r?.kind === "ref" ? code.nodes[r.target] : undefined; return t?.kind === "builtin" && COMMUTES.has(t.op); };
  const same = (a: Id, b: Id, subA: Map<Id, Id>, subB: Map<Id, Id>, m = new Map<Id, Id>()): boolean => {
    const x = code.nodes[a], y = code.nodes[b];
    if (!x || !y || x.kind !== y.kind) return a === b;
    const binds = (ps: (Id | null)[], qs: (Id | null)[]) => ps.length === qs.length && ps.every((p, i) => (p === null) === (qs[i] === null) && (p === null || (m.set(qs[i]!, p), true)));
    const all = (ps: Id[], qs: Id[]) => ps.length === qs.length && ps.every((p, i) => same(p, qs[i], subA, subB, m));
    switch (x.kind) {
      case "lit": { const z = y as typeof x; return x.value === z.value && JSON.stringify(x.unit) === JSON.stringify(z.unit) && x.of === z.of; }
      case "ref": { const t = (y as typeof x).target; return (subA.get(x.target) ?? x.target) === (m.get(t) ?? subB.get(t) ?? t); }
      case "call": {
        const z = y as typeof x;
        if (!same(x.fn, z.fn, subA, subB, m)) return false;
        if (x.args.length !== 2 || !commutes(x.fn)) return all(x.args, z.args);
        // Operands of an operation that commutes, in either order (C69):
        // `a·a + b·b` and `b·b + a·a` are one value.
        const tried = new Map(m);
        if (all(x.args, z.args)) return true;
        m.clear();
        tried.forEach((v, k) => m.set(k, v));
        return all(x.args, [z.args[1], z.args[0]]);
      }
      case "lambda": { const z = y as typeof x; return binds(x.params, z.params) && same(x.body, z.body, subA, subB, m); }
      case "match": { const z = y as typeof x; return same(x.scrutinee, z.scrutinee, subA, subB, m) && all(x.arms, z.arms) && (x.otherwise === null ? z.otherwise === null : z.otherwise !== null && same(x.otherwise, z.otherwise, subA, subB, m)); }
      case "fold": { const z = y as typeof x; return same(x.scrutinee, z.scrutinee, subA, subB, m) && all(x.arms, z.arms); }
      case "arm": { const z = y as typeof x; return x.variant === z.variant && binds(x.binds, z.binds) && binds(x.results, z.results) && same(x.body, z.body, subA, subB, m); }
      default: return a === b;
    }
  };
  // es (one per result) walked together where each is the answer; shared
  // counts the steps that run once.
  const together = (es: Id[], subs: Map<Id, Id>[], shared: { n: number }): Id => {
    const ns = es.map((e) => code.nodes[e]);
    const agree = (f: (k: number) => boolean) => es.every((_, k) => k === 0 || f(k));
    const fresh = (ps: (Id | null)[], each: (k: number) => (Id | null)[]) => ps.map((p, i) => {
      if (p === null) return null;
      const b = add({ kind: "binder" } as Omit<Node, "id">);
      if (names[p] !== undefined) more[b] = names[p];
      es.forEach((_, k) => subs[k].set(each(k)[i]!, b));
      return b;
    });
    const n0 = ns[0];
    if (n0?.kind === "match" && ns.every((n) => n?.kind === "match" && n.arms.length === n0.arms.length && (n.otherwise === null) === (n0.otherwise === null))
      && agree((k) => same(n0.scrutinee, (ns[k] as typeof n0).scrutinee, subs[0], subs[k]))) {
      const arms = n0.arms.map((a, i) => es.map((_, k) => code.nodes[(ns[k] as typeof n0).arms[i]] as NodeOf<"arm">));
      if (arms.every((as) => as.every((a) => a.variant === as[0].variant && a.binds.length === as[0].binds.length))) {
        shared.n++;
        const scrutinee = copy(n0.scrutinee, subs[0]);
        const made = arms.map((as) => {
          const binds = fresh(as[0].binds, (k) => as[k].binds) as Id[];
          return add({ kind: "arm", variant: as[0].variant, binds, results: binds.map(() => null), body: together(as.map((a) => a.body), subs, shared) } as Omit<Node, "id">);
        });
        const otherwise = n0.otherwise === null ? null : together(ns.map((n) => (n as typeof n0).otherwise!), subs, shared);
        return add({ kind: "match", scrutinee, arms: made, otherwise } as Omit<Node, "id">);
      }
    }
    const lets = ns.map((n) => isCall(n) ? code.nodes[n.fn] : undefined);
    const l0 = lets[0], c0 = n0 as Call;
    if (l0?.kind === "lambda" && lets.every((l, k) => l?.kind === "lambda" && l.params.length === l0.params.length && (ns[k] as Call).args.length === c0.args.length)
      && agree((k) => c0.args.every((a, i) => same(a, (ns[k] as Call).args[i], subs[0], subs[k])))) {
      shared.n++;
      const args = c0.args.map((a) => copy(a, subs[0]));
      const params = fresh(l0.params, (k) => (lets[k] as typeof l0).params) as Id[];
      const body = together(lets.map((l) => (l as typeof l0).body), subs, shared);
      return add({ kind: "call", fn: add({ kind: "lambda", params, body } as Omit<Node, "id">), args } as Omit<Node, "id">);
    }
    return sharedBelow(es, subs, shared);
  };
  // Where the results part, a value more than one of them works out the
  // same way (a Dual's x² + y², under the length's square root and as the
  // angle's slope's divisor) is worked out once, before the pair, and each
  // reads it (C55c): common subexpressions, as any optimiser shares them
  // (Cocke, 1970). Only values each result surely works out (an argument
  // of a call, a let's value or body, a match's scrutinee: not inside a
  // case or a function), reading nothing bound inside the result.
  const sharedBelow = (es: Id[], subs: Map<Id, Id>[], shared: { n: number }): Id => {
    const sure = (e: Id): Id[] => {
      const out: Id[] = [];
      const walk = (id: Id) => {
        const n = code.nodes[id];
        if (isCall(n)) {
          out.push(id);
          n.args.forEach(walk);
          const f = code.nodes[n.fn];
          if (f?.kind === "lambda") walk(f.body);
        } else if (n?.kind === "match") walk(n.scrutinee);
      };
      walk(e);
      return out;
    };
    const local = es.map((e) => {
      const bound = new Set<Id>();
      for (const id of subtree(code, e)) {
        const n = code.nodes[id];
        if (n?.kind === "lambda") n.params.forEach((p) => bound.add(p));
        if (n?.kind === "arm") n.binds.forEach((b) => b !== null && bound.add(b));
      }
      return bound;
    });
    // Candidates, the largest first, with the result each is in.
    const cands = es.flatMap((e, k) => sure(e).filter((id) => {
      const n = code.nodes[id] as Call;
      if (code.nodes[n.fn]?.kind !== "ref" || !n.args.length) return false;
      return subtree(code, id).every((x) => { const r = code.nodes[x]; return r?.kind !== "ref" || !local[k].has(r.target); });
    }).map((id) => ({ id, k, size: subtree(code, id).length })));
    cands.sort((a, b) => b.size - a.size);
    const repl = es.map(() => new Map<Id, Id>()), within = es.map(() => new Set<Id>());
    const values: Id[] = [], binders: Id[] = [];
    for (let i = 0; i < cands.length; i++) {
      const a = cands[i];
      if (within[a.k].has(a.id)) continue;
      const alike = cands.filter((b, j) => j > i && !within[b.k].has(b.id) && b.size === a.size && same(a.id, b.id, subs[a.k], subs[b.k]));
      if (!alike.length) continue;
      const b = add({ kind: "binder" } as Omit<Node, "id">);
      more[b] = "shared";
      values.push(copy(a.id, subs[a.k]));
      binders.push(b);
      for (const c of [a, ...alike]) {
        repl[c.k].set(c.id, b);
        for (const x of subtree(code, c.id)) within[c.k].add(x);
      }
    }
    const parts = es.map((e, k) => copy(e, subs[k], repl[k]));
    if (!values.length) return pair(parts);
    shared.n++;
    return add({ kind: "call", fn: add({ kind: "lambda", params: binders, body: pair(parts) } as Omit<Node, "id">), args: values } as Omit<Node, "id">);
  };
  // The definition giving results rs of d together, or null when they
  // share nothing.
  const togetherFn = (d: Id, rs: Id[]): Id | null => {
    const key = `${d} ${rs.join(" ")}`;
    if (made.has(key)) return made.get(key)!;
    const def = code.nodes[d] as NodeOf<"def">, lam = code.nodes[def.body!] as NodeOf<"lambda">;
    const inputs = lam.params.filter((p) => !def.results!.includes(p));
    const gs = inputs.map((p) => { const b = add({ kind: "binder" } as Omit<Node, "id">); if (names[p] !== undefined) more[b] = names[p]; return b; });
    const subs = rs.map(() => new Map(inputs.map((p, i) => [p, gs[i]] as const)));
    const shared = { n: 0 };
    const body = together(rs.map((r) => shapeOf(d)!.get(r)!), subs, shared);
    if (!shared.n) { made.set(key, null as never); return null; }
    const nd = add({ kind: "def", body: add({ kind: "lambda", params: gs, body } as Omit<Node, "id">) } as Omit<Node, "id">);
    more[nd] = `${names[d] ?? d}'s ${rs.map((r) => names[r] ?? r).join(" and ")}`;
    out.defs.push(nd);
    made.set(key, nd);
    return nd;
  };
  const isTrue = (id: Id | undefined) => id === undefined || refTo(id) === TRUE || (isCall(code.nodes[id]) && refTo((code.nodes[id] as Call).fn) === TRUE && (code.nodes[id] as Call).args.length === 0);
  const expanded: Id[] = [];
  for (const n of Object.values(code.nodes)) {
    // Only what the relational interpreter would run: a direction the
    // numeric solver plans is compiled from its plan already, rounded as the
    // evaluator's solver rounds it.
    if (!isUse(n) || !computedForward(code, n) || planSolve(code, n).mode !== "relational" || !shapeOf(useTarget(code.nodes, n))) continue;
    const def = code.nodes[useTarget(code.nodes, n)] as NodeOf<"def">, lam = code.nodes[def.body!] as NodeOf<"lambda">;
    const inputs = lam.params.filter((p) => !def.results!.includes(p));
    const given = Object.keys(n.given).filter((k) => k !== "out");
    const bound = Object.keys(n.binds);
    if (!isTrue(n.given.out) || given.length !== inputs.length || !inputs.every((p) => n.given[p] !== undefined) || !bound.length || !bound.every((p) => def.results!.includes(p))) continue;
    // let g… = given in let b… = (r's function)(g…) in body, so each given
    // is worked out once however many results are bound.
    const gs = inputs.map((p) => { const b = add({ kind: "binder" } as Omit<Node, "id">); more[b] = names[p] ?? "given"; return b; });
    const callR = (r: Id) => add({ kind: "call", fn: add({ kind: "ref", target: resultFn(useTarget(code.nodes, n), r) } as Omit<Node, "id">), args: gs.map((g) => add({ kind: "ref", target: g } as Omit<Node, "id">)) } as Omit<Node, "id">);
    // Two or more results that share work come from one function, as pairs
    // taken apart again (C55b).
    const both = bound.length > 1 ? togetherFn(useTarget(code.nodes, n), def.results!.filter((r) => bound.includes(r))) : null;
    let lets: Id;
    if (both) {
      const rs = def.results!.filter((r) => bound.includes(r));
      const apart = (v: Id, i: number): Id => {
        if (i === rs.length - 1) return add({ kind: "call", fn: add({ kind: "lambda", params: [n.binds[rs[i]]], body: n.body } as Omit<Node, "id">), args: [v] } as Omit<Node, "id">);
        const rest = add({ kind: "binder" } as Omit<Node, "id">);
        more[rest] = "the others";
        const arm = add({ kind: "arm", variant: PAIR_V, binds: [n.binds[rs[i]], rest], results: [null, null], body: apart(add({ kind: "ref", target: rest } as Omit<Node, "id">), i + 1) } as Omit<Node, "id">);
        return add({ kind: "match", scrutinee: v, arms: [arm], otherwise: null } as Omit<Node, "id">);
      };
      lets = apart(add({ kind: "call", fn: add({ kind: "ref", target: both } as Omit<Node, "id">), args: gs.map((g) => add({ kind: "ref", target: g } as Omit<Node, "id">)) } as Omit<Node, "id">), 0);
    } else {
      const inner = add({ kind: "lambda", params: bound.map((p) => n.binds[p]), body: n.body } as Omit<Node, "id">);
      lets = add({ kind: "call", fn: inner, args: bound.map(callR) } as Omit<Node, "id">);
    }
    const outer = add({ kind: "lambda", params: gs, body: lets } as Omit<Node, "id">);
    out.nodes[n.id] = { id: n.id, kind: "call", fn: outer, args: inputs.map((p) => n.given[p]) } as Node;
    expanded.push(n.id);
  }
  return expanded.length ? { code: out, names: { ...names, ...more }, expanded } : { code, names, expanded };
}
