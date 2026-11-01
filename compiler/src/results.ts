// A solve of a definition with results, in the direction it declares,
// becomes a call per result it binds, before compiling (C55). Such a
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

import type { Code, Id, Node, NodeOf } from "../../projectional/src/model.ts";
import { freshId, mapIds, subtree } from "../../projectional/src/model.ts";
import type { Names } from "../../projectional/src/presentation.ts";
import { TRUE } from "../../projectional/src/lang/std.ts";
import { computedForward, givenBy } from "../../projectional/src/lang/directions.ts";
import { planSolve } from "../../projectional/src/lang/solve.ts";

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
  const made = new Map<string, Id>();
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
  const isTrue = (id: Id | undefined) => id === undefined || refTo(id) === TRUE || (code.nodes[id]?.kind === "call" && refTo((code.nodes[id] as NodeOf<"call">).fn) === TRUE && (code.nodes[id] as NodeOf<"call">).args.length === 0);
  const expanded: Id[] = [];
  for (const n of Object.values(code.nodes)) {
    // Only what the relational interpreter would run: a direction the
    // numeric solver plans is compiled from its plan already, rounded as the
    // evaluator's solver rounds it.
    if (n.kind !== "solve" || !computedForward(code, n) || planSolve(code, n).mode !== "relational" || !shapeOf(n.fn)) continue;
    const def = code.nodes[n.fn] as NodeOf<"def">, lam = code.nodes[def.body!] as NodeOf<"lambda">;
    const inputs = lam.params.filter((p) => !def.results!.includes(p));
    const given = Object.keys(n.given).filter((k) => k !== "out");
    const bound = Object.keys(n.binds);
    if (!isTrue(n.given.out) || given.length !== inputs.length || !inputs.every((p) => n.given[p] !== undefined) || !bound.length || !bound.every((p) => def.results!.includes(p))) continue;
    // let g… = given in let b… = (r's function)(g…) in body, so each given
    // is worked out once however many results are bound.
    const gs = inputs.map((p) => { const b = add({ kind: "binder" } as Omit<Node, "id">); more[b] = names[p] ?? "given"; return b; });
    const callR = (r: Id) => add({ kind: "call", fn: add({ kind: "ref", target: resultFn(n.fn, r) } as Omit<Node, "id">), args: gs.map((g) => add({ kind: "ref", target: g } as Omit<Node, "id">)) } as Omit<Node, "id">);
    const inner = add({ kind: "lambda", params: bound.map((p) => n.binds[p]), body: n.body } as Omit<Node, "id">);
    const lets = add({ kind: "call", fn: inner, args: bound.map(callR) } as Omit<Node, "id">);
    const outer = add({ kind: "lambda", params: gs, body: lets } as Omit<Node, "id">);
    out.nodes[n.id] = { id: n.id, kind: "call", fn: outer, args: inputs.map((p) => n.given[p]) } as Node;
    expanded.push(n.id);
  }
  return expanded.length ? { code: out, names: { ...names, ...more }, expanded } : { code, names, expanded };
}
