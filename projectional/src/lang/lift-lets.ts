// Recursive lets as definitions (BACKLOG L84), before anything runs.
//
// A let is `(name ↦ body)(value)`, and when the value is a function it may
// call itself by the name (infer.ts recursiveLet). Nothing downstream needs
// to know: this code → code pass lifts each such function out into a
// definition of its own (lambda lifting, Johnsson 1985) that takes the
// let's free variables first and its own inputs after, so the evaluator,
// relate.ts and every compiler target see ordinary recursion between
// definitions. At the let the value becomes that definition, given the
// free variables: `(xs) ↦ helper(a, b, xs)`, or just `helper` when there are
// none. Inside, each call `name(xs)` becomes `helper(a, b, xs)`.
//
// The let's body keeps its node ids and so do the function's, so a trace
// or a value shown in the editor still points at what the person wrote.
// Like arith.ts, the program comes back unchanged when it has none.

import type { Code, Id, Node, NodeOf } from "../model.ts";
import { freshId, subtree } from "../model.ts";
import type { Names } from "../presentation.ts";
import { infer, recursiveLet, type Info } from "./infer.ts";

function find(code: Code): { call: NodeOf<"call">; i: number; p: Id } | null {
  for (const n of Object.values(code.nodes)) {
    if (n.kind !== "call" || code.nodes[n.fn]?.kind !== "lambda") continue;
    for (let i = 0; i < n.args.length; i++) {
      const p = recursiveLet(code, n, i);
      if (p) return { call: n, i, p };
    }
  }
  return null;
}

export const hasRecursiveLet = (code: Code) => find(code) !== null;

export function liftLets(code: Code, info: Info, names: Names = {}): { code: Code; info: Info; names: Names } {
  if (!hasRecursiveLet(code)) return { code, info, names };
  const nodes: Record<Id, Node> = { ...code.nodes };
  const defs = [...code.defs];
  const out: Names = { ...names };
  const work = () => ({ nodes, defs });
  for (let site = find(work()); site; site = find(work())) {
    const { call, i, p } = site;
    const fn = nodes[call.args[i]] as NodeOf<"lambda">;
    const inside = subtree(work(), fn.id);
    const bound = new Set(inside.filter((x) => nodes[x]?.kind === "binder"));
    // The variables it uses from around the let, in the order it uses them.
    const free = [...new Set(inside.flatMap((x) => {
      const n = nodes[x];
      return n?.kind === "ref" && n.target !== p && nodes[n.target]?.kind === "binder" && !bound.has(n.target) ? [n.target] : [];
    }))];
    const helper = freshId();
    const outer = free.map((b): Id => { const id = freshId(); nodes[id] = { ...(nodes[b] as NodeOf<"binder">), id }; out[id] = names[b] ?? out[b] ?? "x"; return id; });
    const along = new Map(free.map((b, k) => [b, outer[k]]));
    const ref = (target: Id): Id => { const id = freshId(); nodes[id] = { id, kind: "ref", target }; return id; };
    // `helper` given the free variables (`given`) and then `params`, as a
    // function of those inputs.
    const wrapper = (id: Id, given: Id[]) => {
      const params = fn.params.map((q) => { const b = freshId(); nodes[b] = { ...(nodes[q] as NodeOf<"binder">), id: b }; out[b] = names[q] ?? out[q] ?? "x"; return b; });
      const body = freshId();
      nodes[body] = { id: body, kind: "call", fn: ref(helper), args: [...given.map(ref), ...params.map(ref)] };
      nodes[id] = { id, kind: "lambda", params, body };
    };
    const callers = new Map<Id, NodeOf<"call">>();
    for (const x of inside) { const n = nodes[x]; if (n?.kind === "call") callers.set(n.fn, n); }
    for (const x of inside) {
      const n = nodes[x];
      if (n?.kind !== "ref") continue;
      if (along.has(n.target)) nodes[x] = { ...n, target: along.get(n.target)! };
      else if (n.target === p) {
        const c = callers.get(x);
        if (c) {
          // name(xs) is helper(free…, xs)
          nodes[x] = { ...n, target: helper };
          nodes[c.id] = { ...(nodes[c.id] as NodeOf<"call">), args: [...outer.map(ref), ...(nodes[c.id] as NodeOf<"call">).args] };
        } else if (free.length) wrapper(x, outer);
        else nodes[x] = { ...n, target: helper };
      }
    }
    const lam = freshId();
    nodes[lam] = { id: lam, kind: "lambda", params: [...outer, ...fn.params], body: fn.body };
    nodes[helper] = { id: helper, kind: "def", body: lam };
    defs.push(helper);
    out[helper] = names[p] ?? "helper";
    // At the let: the definition, given what it uses from around it.
    if (free.length) wrapper(fn.id, free);
    else nodes[fn.id] = { id: fn.id, kind: "ref", target: helper };
  }
  const lifted = { nodes, defs };
  return { code: lifted, info: infer(lifted, out, undefined, info.options), names: out };
}
