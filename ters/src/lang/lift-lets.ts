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
import { freshId, subtree, isCall, type Call } from "../model.ts";
import type { Names } from "../presentation.ts";
import { inferRewritten, recursiveLet, type Info } from "./infer.ts";
import { OverMap, type Scheme, type Type } from "./types.ts";

// `every`: every let whose value is a function, recursive or not, outer
// ones first, so an inner one that calls an outer one calls its
// definition (the GPU, WebAssembly and C have no closures: scalar.ts, C54).
function find(code: Code, every = false, kept = new Set<Id>()): { call: Call; i: number; p: Id } | null {
  const ids = every ? code.defs.flatMap((d) => subtree(code, d)) : Object.keys(code.nodes);
  for (const id of ids) {
    const n = code.nodes[id];
    if (!isCall(n) || code.nodes[n.fn]?.kind !== "lambda") continue;
    for (let i = 0; i < n.args.length; i++) {
      const f = code.nodes[n.fn] as NodeOf<"lambda">;
      const p = every ? (code.nodes[n.args[i]]?.kind === "lambda" && !kept.has(n.args[i]) && f.params.length === n.args.length ? f.params[i] : null) : recursiveLet(code, n, i);
      if (p) return { call: n, i, p };
    }
  }
  return null;
}

export const hasRecursiveLet = (code: Code) => find(code) !== null;

export function liftLets(code: Code, info: Info, names: Names = {}, every = false): { code: Code; info: Info; names: Names } {
  if (!find(code, every)) return { code, info, names };
  const nodes: Record<Id, Node> = { ...code.nodes };
  const defs = [...code.defs];
  const out: Names = { ...names };
  const work = () => ({ nodes, defs });
  // Lets whose name is also used as a value: lifted, but the let stays.
  const kept = new Set<Id>();
  for (let site = find(work(), every, kept); site; site = find(work(), every, kept)) {
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
    const callers = new Map<Id, Call>();
    for (const x of inside) { const n = nodes[x]; if (isCall(n)) callers.set(n.fn, n); }
    for (const x of inside) {
      const n = nodes[x];
      if (n?.kind !== "ref") continue;
      if (along.has(n.target)) nodes[x] = { ...n, target: along.get(n.target)! };
      else if (n.target === p) {
        const c = callers.get(x);
        if (c) {
          // name(xs) is helper(free…, xs)
          nodes[x] = { ...n, target: helper };
          nodes[c.id] = { ...(nodes[c.id] as Call), args: [...outer.map(ref), ...(nodes[c.id] as Call).args] };
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
    if (every) {
      // In the let's body too, name(xs) is helper(free…, xs), and when
      // that's every use of the name, the let has nothing left to bind.
      const around = subtree(work(), (nodes[call.fn] as NodeOf<"lambda">).body);
      const heads = new Map<Id, Id>();
      for (const x of around) { const m = nodes[x]; if (isCall(m)) heads.set(m.fn, m.id); }
      let other = false;
      for (const x of around) {
        const m = nodes[x];
        if (m?.kind !== "ref" || m.target !== p) continue;
        const c = heads.get(x);
        if (!c) { other = true; continue; }
        nodes[x] = { ...m, target: helper };
        nodes[c] = { ...(nodes[c] as Call), args: [...free.map(ref), ...(nodes[c] as Call).args] };
      }
      if (other) kept.add(fn.id);
      else {
        const let_ = nodes[call.fn] as NodeOf<"lambda">, at = nodes[call.id] as Call;
        const params = let_.params.filter((_, k) => k !== i), args = at.args.filter((_, k) => k !== i);
        if (params.length) { nodes[let_.id] = { ...let_, params }; nodes[call.id] = { ...at, args }; }
        else nodes[call.id] = { ...nodes[let_.body], id: call.id };
      }
    }
  }
  const lifted = { nodes, defs };
  // Checked again where it changed: the lets' definitions and the ones it
  // made (infer.ts inferRewritten, I264).
  const changed = Object.keys(nodes).filter((id) => id in code.nodes && nodes[id] !== code.nodes[id]);
  const checked = inferRewritten(code, lifted, out, info, changed, defs.slice(code.defs.length));
  // A library definition arith.ts resolved (pedal's `smaller`, at Float64)
  // keeps its id, and this check reads that id's type from the library's
  // check, generic, under the body it gave a type: as arith.ts left them.
  const typeOf = new OverMap(checked.typeOf), schemes = new Map(checked.schemes);
  typedAsBodies(lifted, typeOf, schemes, new Set(), (t) => checked.subst.zonk(t));
  return { code: lifted, info: { ...checked, typeOf, schemes }, names: out };
}

// Each definition whose body has a type with no variable in it has that
// type, as its scheme (arith.ts, after resolving; liftLets, after its
// check again). `skip`: those left generic on purpose; `zonk`: a
// check's types read through its substitution.
export function typedAsBodies(code: Code, typeOf: Map<Id, Type>, schemes: Map<Id, Scheme>, skip: Set<Id> = new Set(), zonk = (t: Type) => t): void {
  const valueVar = (t: Type): boolean => t.t === "var" || (t.t === "con" ? t.args.some(valueVar) : t.params.some(valueVar) || valueVar(t.ret));
  for (const d of code.defs) {
    const n = code.nodes[d], sc = schemes.get(d);
    if (n?.kind !== "def" || !n.body || !sc || skip.has(d)) continue;
    const got = typeOf.get(n.body), bt = got && zonk(got);
    if (!bt || valueVar(bt) || JSON.stringify(bt) === JSON.stringify(sc.type)) continue;
    schemes.set(d, { ...sc, vars: [], type: bt });
    typeOf.set(d, bt);
  }
}
