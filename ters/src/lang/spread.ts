// One tuple given for several inputs, taken apart before anything runs
// (PORTS-2026-11-01.md §1, BACKLOG L128).
//
// The checker lets `f(p)` stand for `f(x, y)` when p is an (x, y): a
// function's inputs are one tuple (infer.ts, `info.spread`). Nothing
// downstream needs to know: this code → code pass gives each such call its
// parts, `f(p.first, p.second)`, so the evaluator, relate.ts and every
// compiler target see an ordinary call. When the tuple is anything but a
// name it is named first, `(t ↦ f(t.first, t.second))(p)`, so it is worked
// out once. Like lift-lets.ts, the program comes back unchanged when it has
// none, and the nodes the person wrote keep their ids.

import type { Code, Id, Node, NodeOf } from "../model.ts";
import { freshId } from "../model.ts";
import type { Names } from "../presentation.ts";
import { infer, type Info } from "./infer.ts";
import { tuplePart } from "./std.ts";

// A node without its id, kind by kind.
type Bare = Node extends infer N ? (N extends Node ? Omit<N, "id"> : never) : never;

export function spreadTuples(code: Code, info: Info, names: Names): { code: Code; info: Info; names: Names } {
  const calls = [...(info.spread ?? [])].filter((id) => code.nodes[id]?.kind === "call");
  if (!calls.length) return { code, info, names };
  const nodes: Record<Id, Node> = { ...code.nodes };
  const add = (n: Bare): Id => { const id = freshId(); nodes[id] = { ...n, id } as Node; return id; };
  for (const id of calls) {
    const n = nodes[id] as NodeOf<"call">;
    const t = info.typeOf.get(n.args[0]), r = t && info.subst.resolve(t);
    const size = r?.t === "con" ? r.args.length : 0;
    if (size < 2) continue;
    const given = nodes[n.args[0]];
    const parts = (target: Id) => Array.from({ length: size }, (_, i) => add({ kind: "call", fn: add({ kind: "ref", target: tuplePart(size, i) }), args: [add({ kind: "ref", target })] }));
    if (given?.kind === "ref") {
      // A name already: read its parts where it was.
      delete nodes[n.args[0]];
      nodes[id] = { ...n, args: parts(given.target) };
      continue;
    }
    // Anything else is worked out once, then taken apart: the call keeps
    // its id, as the let it becomes, and its function moves inside.
    const whole = add({ kind: "binder" });
    const inner = add({ kind: "call", fn: n.fn, args: parts(whole) });
    nodes[id] = { ...n, fn: add({ kind: "lambda", params: [whole], body: inner }), args: [n.args[0]] };
  }
  const spread: Code = { ...code, nodes };
  return { code: spread, info: infer(spread, names, undefined, info.options), names };
}
