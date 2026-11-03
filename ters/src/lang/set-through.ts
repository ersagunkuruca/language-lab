// `set` through a general function (BACKLOG L20, LANGUAGE.md "Updating a
// record"): `set((r) ↦ r.width · 2, box, 10)` is the box whose width,
// doubled, is 10, with every other field kept. It is the function run
// backwards with the rest of the record given, so it may have no answer
// (Choice), or several, as running backwards may.
//
// Written out before anything runs, as set-several.ts writes several
// fields: the fields the function reads become the path, and the function
// of those fields is run backwards with `inverse`:
//
//   set((r) ↦ r.width · 2, box, 10)
//     = (w ↦ set((q) ↦ q.width, box, w))(inverse((r) ↦ r · 2, 10))
//   set((r) ↦ show(r.width) ++ "x" ++ show(r.height), box, "4x5")
//     = (t ↦ set((q) ↦ (q.width, q.height), box, t))(inverse((r) ↦ show(r.first) ++ "x" ++ show(r.second), "4x5"))
//
// so the evaluator, relate.ts and every compiler target see the `set` and
// the `inverse` they already run. The function's own lambda is kept, its
// parameter now standing for the fields read (one, or a tuple of them).
//
// Prior art: lenses whose put runs the get backwards (Foster, Greenwald,
// Moore, Pierce and Schmitt, "Combinators for bidirectional tree
// transformations", POPL 2005; the putback-based view of Fischer, Hu and
// Pacheco), here derived from the function by the relational interpreter
// rather than written.

import type { Code, Id, Node, NodeOf } from "../model.ts";
import { freshId, isCall, type Call } from "../model.ts";
import type { Names } from "../presentation.ts";
import { preludeDef } from "./arith.ts";
import { infer, type Info } from "./infer.ts";
import { readPaths } from "./records.ts";
import { SET, tuplePart, tupleVariant } from "./std.ts";

type Bare = Node extends infer N ? (N extends Node ? Omit<N, "id"> : never) : never;

const throughAt = (code: Code, n: Node) => {
  if (!isCall(n) || n.args.length !== 3) return null;
  const fn = code.nodes[n.fn];
  return fn?.kind === "ref" && fn.target === SET ? readPaths(code, n.args[0]) : null;
};

export const usesSetThrough = (code: Code) => Object.values(code.nodes).some((n) => throughAt(code, n));

export function setThrough(code: Code, info: Info, names: Names): { code: Code; info: Info; names: Names } {
  const calls = Object.values(code.nodes).flatMap((n) => { const r = throughAt(code, n); return r ? [{ id: n.id, ...r }] : []; });
  const inverse = preludeDef("inverse");
  if (!calls.length || !inverse || !code.nodes[inverse]) return { code, info, names };
  const nodes: Record<Id, Node> = { ...code.nodes };
  const add = (n: Bare): Id => { const id = freshId(); nodes[id] = { ...n, id } as Node; return id; };
  const ref = (target: Id) => add({ kind: "ref", target });
  const out: Names = { ...names };
  for (const { id, paths, uses } of calls) {
    const n = nodes[id] as Call;
    const f = nodes[n.args[0]] as NodeOf<"lambda">, p = f.params[0];
    const size = paths.length;
    // Each read of a field is now the parameter, or its part.
    for (const u of uses) {
      nodes[u.node] = size === 1 ? { id: u.node, kind: "ref", target: p } : { id: u.node, kind: "call", fn: ref(tuplePart(size, u.path)), args: [ref(p)] };
    }
    // The path: q ↦ q.a.b, or q ↦ (q.a, q.b) for several (set-several.ts
    // takes it from there).
    const q = add({ kind: "binder" });
    out[q] = out[p] ?? "it";
    const one = (path: Id[]) => path.reduce<Id>((e, fld) => add({ kind: "call", fn: ref(fld), args: [e] }), ref(q));
    const body = size === 1 ? one(paths[0]) : add({ kind: "call", fn: ref(tupleVariant(size)), args: paths.map(one) });
    const path = add({ kind: "lambda", params: [q], body });
    // The parts found first, then set: (parts ↦ set(path, record, parts))(inverse(f, value)),
    // so the set itself has one answer and only the search may have none.
    const parts = add({ kind: "binder" });
    out[parts] = "parts";
    const set = add({ kind: "call", fn: n.fn, args: [path, n.args[1], ref(parts)] });
    nodes[id] = { id, kind: "call", fn: add({ kind: "lambda", params: [parts], body: set }), args: [add({ kind: "call", fn: ref(inverse), args: [n.args[0], n.args[2]] })] };
  }
  const next: Code = { ...code, nodes };
  return { code: next, info: infer(next, out, undefined, info.options), names: out };
}
