// A derivative of a function chosen at run time, compiled (I245,
// CORE-IR.md "A derivative of a function chosen at run time"): calculus's
// `derivative(f)`, f one of its samples. The evaluator reads f's lambda
// when it is asked; a compiled program has no lambdas to read. So each
// function the program makes whose type is one `derivative` is asked of
// gets its derivative made ahead, by derive.ts as the evaluator would
// make it (lenient: `fail` where a slope can't be read), over the same
// captures; scalar.ts gives its closure a maker of that derivative's
// closure, and `derivative(f)` calls f's maker.
//
// Only the first derivative is made. That is enough when no derivative's
// result can reach `derivative` again: each one is applied, or handed to
// a function whose input is only ever applied (newton's slope). Where one
// might reach it, or a derivative made here asks for another, this gives
// up and the evaluator's derive stays (it ships the program's nodes).

import type { Code, Id, Node, NodeOf } from "../../ters/src/model.ts";
import { children, freshId, isCall, subtree, type Call } from "../../ters/src/model.ts";
import type { Names } from "../../ters/src/presentation.ts";
import type { Info } from "../../ters/src/lang/infer.ts";
import { infer } from "../../ters/src/lang/infer.ts";
import { deriver } from "../../ters/src/lang/derive.ts";
import { S } from "../../ters/src/lang/std.ts";
import type { Type } from "../../ters/src/lang/types.ts";

export interface Carried {
  code: Code;
  names: Names;
  info: Info;
  // A lambda of the program → the lambda of its derivative, and the
  // inputs of its definition standing for what the lambda captures.
  derivativeOf: Map<Id, { lambda: Id; stand: Map<Id, Id> }>;
}

// A function type with its effects left out: a lambda that can't fail is
// handed where one that may is taken.
function sig(t: Type): string {
  if (t.t === "var") return "?";
  if (t.t === "con") return t.args.length ? `${t.id}(${t.args.map(sig).join(",")})` : t.id;
  return `fn(${t.params.map(sig).join(",")})>${sig(t.ret)}`;
}

const derivativeCall = (code: Code, id: Id): boolean => {
  const n = code.nodes[id];
  return isCall(n) && n.args.length === 1 && code.nodes[n.fn]?.kind === "ref" && (code.nodes[n.fn] as NodeOf<"ref">).target === S.derivative;
};

export function carriedDerivatives(code: Code, info: Info, names: Names, roots: Id[]): Carried | null {
  const ids = Object.keys(code.nodes);
  const calls = ids.filter((id) => derivativeCall(code, id));
  if (!calls.length) return null;
  const type = (id: Id) => info.subst.zonk(info.typeOf.get(id) ?? { t: "var", v: -1 });
  const sigs = new Set<string>();
  for (const c of calls) {
    const t = type((code.nodes[c] as Call).args[0]);
    if (t.t !== "fn" || t.params.length !== 1) return null;
    sigs.add(sig(t));
  }
  // Each node's parent, and the slot it is in.
  const parent = new Map<Id, Id>();
  for (const id of ids) for (const k of children(code.nodes[id])) parent.set(k, id);
  const refs = new Map<Id, Id[]>();
  for (const id of ids) {
    const n = code.nodes[id];
    if (n.kind === "ref") (refs.get(n.target) ?? refs.set(n.target, []).get(n.target)!).push(id);
  }
  // The lambda a call's head is: written there (a let), or a definition's.
  const lambdaAt = (fn: Id): NodeOf<"lambda"> | null => {
    const n = code.nodes[fn];
    if (n?.kind === "lambda") return n;
    if (n?.kind !== "ref") return null;
    const d = code.nodes[n.target];
    const b = d?.kind === "def" && d.body ? code.nodes[d.body] : null;
    return b?.kind === "lambda" ? b : null;
  };
  // Whether a value put at `id` is only ever applied: as a call's head,
  // or handed to an input that is only ever applied (newton's slope,
  // handed on to newton again: assumed so while it is being asked).
  const asking = new Set<Id>();
  const appliedOnly = (binder: Id): boolean => {
    if (asking.has(binder)) return true;
    asking.add(binder);
    return (refs.get(binder) ?? []).every(onlyApplied);
  };
  const onlyApplied = (id: Id): boolean => {
    const p = parent.get(id), n = p ? code.nodes[p] : undefined;
    if (!isCall(n)) return false;
    if (n.fn === id) return true;
    const j = n.args.indexOf(id), lam = lambdaAt(n.fn);
    return j >= 0 && !!lam && j < lam.params.length && appliedOnly(lam.params[j]);
  };
  if (!calls.every(onlyApplied)) return null;
  // Each lambda of one of those types made as a value (not one applied
  // where it is written, a let), its derivative made ahead. One whose
  // derivative asks for another (of a function it captured) would need
  // that carried too, at the order asked: it is left without, and if its
  // closure is made where `derivative` may be asked of it, scalar.ts
  // lowers the evaluator's derive instead.
  // The binders a lambda captures: read inside, bound outside.
  const captures = (lam: Id): Id[] => {
    const inside = new Set(subtree(code, lam));
    return [...new Set([...inside].flatMap((x) => { const n = code.nodes[x]; return n.kind === "ref" && code.nodes[n.target]?.kind === "binder" && !inside.has(n.target) ? [n.target] : []; }))];
  };
  const out: Code = { nodes: { ...code.nodes }, defs: [...code.defs] };
  const d = deriver(out, names, true), made: Names = {};
  const derivativeOf: Carried["derivativeOf"] = new Map();
  // The lambdas the program reaches from its roots.
  const reached = new Set<Id>(), defs = new Set<Id>(), todo = [...roots];
  while (todo.length) {
    const def = todo.pop()!;
    if (defs.has(def) || code.nodes[def]?.kind !== "def") continue;
    defs.add(def);
    for (const id of subtree(code, def)) {
      const n = code.nodes[id];
      if (n.kind === "lambda") reached.add(id);
      else if (n.kind === "ref" && !defs.has(n.target)) todo.push(n.target);
    }
  }
  for (const id of reached) {
    const n = code.nodes[id] as NodeOf<"lambda">, p = parent.get(id);
    if (n.params.length !== 1 || !sigs.has(sig(type(id)))) continue;
    if (p && isCall(code.nodes[p]) && (code.nodes[p] as Call).fn === id) continue;
    const before = new Set(Object.keys(out.nodes));
    try {
      const dl = d.lambda(id, 0);
      const fresh = Object.keys(out.nodes).filter((x) => !before.has(x));
      if (fresh.some((x) => derivativeCall(out, x))) continue;
      // A definition of its own, so the checker types it: over what the
      // lambda captures, as inputs of its own standing for them, when it
      // captures something (`(c₁, …) => (x) => …`).
      const caps = captures(id), stand = new Map(caps.map((b) => [b, freshId()]));
      for (const [b, c] of stand) { out.nodes[c] = { id: c, kind: "binder" } as Node; if (names[b]) made[c] = names[b]; }
      for (const x of fresh) {
        const n = out.nodes[x];
        if (n.kind === "ref" && stand.has(n.target)) out.nodes[x] = { ...n, target: stand.get(n.target)! };
      }
      // (A node of the lambda's own the derivative shares would still
      // read the captured binder itself: then it is left without.)
      if (subtree(out, dl).some((x) => { const n = out.nodes[x]; return n.kind === "ref" && stand.has(n.target); })) continue;
      let body = dl;
      if (caps.length) {
        body = freshId();
        out.nodes[body] = { id: body, kind: "lambda", params: caps.map((b) => stand.get(b)!), body: dl } as Node;
      }
      const def = freshId();
      out.nodes[def] = { id: def, kind: "def", body } as Node;
      out.defs.push(def);
      const of = parent.get(id), named = of && code.nodes[of]?.kind === "def" ? names[of] : undefined;
      if (named) made[def] = `${named}′`;
      derivativeOf.set(id, { lambda: dl, stand });
    } catch { /* left without one too */ }
  }
  out.defs.push(...d.defs);
  if (!derivativeOf.size) return null;
  const all = { ...names, ...d.names, ...made };
  const checked = infer(out, all);
  if (checked.errors.length > info.errors.length) return null;
  // What a captured value stands for must be known there: a type the
  // definition leaves open (generic) is left without (scalar.ts lowers
  // the evaluator's derive where one is asked of it).
  const open = (t: Type): boolean => t.t === "var" || (t.t === "con" ? t.args.some(open) : t.params.some(open) || open(t.ret));
  for (const [id, c] of derivativeOf) {
    if ([...c.stand.values()].some((b) => open(checked.subst.zonk(checked.typeOf.get(b) ?? { t: "var", v: -1 })))) derivativeOf.delete(id);
  }
  if (!derivativeOf.size) return null;
  return { code: out, names: all, info: checked, derivativeOf };
}
