// A definition with results called as the function it is (PORTS §3,
// "L128d, step by step", L128d2): rewritten into the use in its declared
// direction before anything runs.
//
// The checker types `sum and difference(5, 1)` as a call of the function
// (s, d) → a, b, and Trig's polar(r, t) as one of (length, angle) → x, y.
// What runs such a definition is its use: the inputs given, the results
// bound, here gathered into the tuple the call gives (one result is its
// value). A definition passed on as a value becomes the function that
// makes that use. Nothing downstream needs to know: the evaluator, relate.ts
// and every compiler target see uses, as they did. The program comes back
// unchanged when it has none, and the nodes the person wrote keep their ids.

import type { Code, Id, Node, NodeOf } from "../model.ts";
import { fieldPorts, freshId, isCall, nodesWhere, parentLookup } from "../model.ts";
import type { Names } from "../presentation.ts";
import { infer, type Info } from "./infer.ts";
import { TRUE, tupleVariant } from "./std.ts";

type Bare = Node extends infer N ? (N extends Node ? Omit<N, "id"> : never) : never;

// Its inputs' and results' port keys, in order, when `target` is a
// definition with results or a field with them; null otherwise.
function portsOf(nodes: Record<Id, Node>, target: Id): { ins: string[]; outs: string[] } | null {
  const t = nodes[target];
  if (t?.kind === "def" && t.results?.length && t.body) {
    const lam = nodes[t.body];
    if (lam?.kind !== "lambda") return null;
    return { ins: lam.params.filter((p) => !t.results!.includes(p)), outs: t.results };
  }
  if (t?.kind === "field") {
    const fp = fieldPorts(nodes, t);
    return fp && { ins: fp.ins.map(String), outs: fp.outs.map(String) };
  }
  return null;
}

// The refs to rewrite: each names a definition (or field) with results
// and is neither the ref a use runs through nor an operation given to an
// interface's record, which stays the definition it names (arith.ts reads
// it there to resolve the field's uses).
function refsToRewrite(code: Code): { ref: NodeOf<"ref">; ports: { ins: string[]; outs: string[] }; parent?: Node }[] {
  const refs = nodesWhere(code, "ref with results", (n) => n.kind === "ref" && !!portsOf(code.nodes, n.target)).map((id) => code.nodes[id] as NodeOf<"ref">);
  if (!refs.length) return [];
  const parentOf = parentLookup(code);
  return refs.flatMap((ref) => {
    const ports = portsOf(code.nodes, ref.target)!;
    const p = parentOf(ref.id), parent = p ? code.nodes[p] : undefined;
    if (parent?.kind === "call" && parent.given !== undefined && parent.fn === ref.id) return [];
    // Given all its ports it is the condition on them, called as it always was.
    if (isCall(parent) && parent.fn === ref.id && parent.args.length === ports.ins.length + ports.outs.length) return [];
    if (isCall(parent) && parent.fn !== ref.id) {
      const callee = code.nodes[parent.fn];
      if (callee?.kind === "ref" && code.nodes[callee.target]?.kind === "variant") return [];
    }
    return [{ ref, ports, parent }];
  });
}

export const usesResultsAsFunction = (code: Code): boolean => refsToRewrite(code).length > 0;

export function resultsAsFunctions(code: Code, info: Info, names: Names): { code: Code; info: Info; names: Names } {
  const todo = refsToRewrite(code);
  if (!todo.length) return { code, info, names };
  const nodes: Record<Id, Node> = { ...code.nodes };
  const add = (n: Bare): Id => { const id = freshId(); nodes[id] = { ...n, id } as Node; return id; };
  // The use of `target` given `args`, its results gathered.
  const use = (target: Id, ports: { ins: string[]; outs: string[] }, args: Id[]): Bare => {
    const binds = Object.fromEntries(ports.outs.map((k) => [k, add({ kind: "binder" })]));
    const outs = ports.outs.map((k) => add({ kind: "ref", target: binds[k] }));
    const body = outs.length === 1 ? outs[0] : add({ kind: "call", fn: add({ kind: "ref", target: tupleVariant(outs.length) }), args: outs });
    const given = { ...Object.fromEntries(ports.ins.map((k, i) => [k, args[i]])), out: add({ kind: "ref", target: TRUE }) };
    return { kind: "call", fn: add({ kind: "ref", target }), given, binds, body };
  };
  for (const { ref: n, ports, parent } of todo) {
    if (isCall(parent) && parent.fn === n.id && parent.args.length === ports.ins.length) {
      // A call: it becomes the use, keeping the call's id.
      delete nodes[n.id];
      nodes[parent.id] = { ...use(n.target, ports, parent.args), id: parent.id } as Node;
      continue;
    }
    // A value: the function that makes the use, in the ref's place.
    const xs = ports.ins.map(() => add({ kind: "binder" }));
    nodes[n.id] = { id: n.id, kind: "lambda", params: xs, body: add(use(n.target, ports, xs.map((x) => add({ kind: "ref", target: x })))) } as NodeOf<"lambda">;
  }
  const out: Code = { ...code, nodes };
  return { code: out, info: infer(out, names, undefined, info.options), names };
}
