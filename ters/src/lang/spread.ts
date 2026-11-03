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
import { freshId, isCall, type Call } from "../model.ts";
import type { Names } from "../presentation.ts";
import { infer, type Info } from "./infer.ts";
import { tuplePart, tupleVariant } from "./std.ts";

// A node without its id, kind by kind.
type Bare = Node extends infer N ? (N extends Node ? Omit<N, "id"> : never) : never;

export function spreadTuples(code: Code, info: Info, names: Names): { code: Code; info: Info; names: Names } {
  const calls = [...(info.spread ?? [])].filter((id) => isCall(code.nodes[id]));
  const reshaped = [...(info.reshape ?? [])].filter(([id]) => code.nodes[id]);
  if (!calls.length && !reshaped.length) return { code, info, names };
  const nodes: Record<Id, Node> = { ...code.nodes };
  const add = (n: Bare): Id => { const id = freshId(); nodes[id] = { ...n, id } as Node; return id; };
  // A function given at the other shape (L137) gets a wrapper where it is
  // given: the input keeps its id, as the wrapper, and what was there moves
  // inside. Given the parts where a tuple comes: p ↦ f(p.first, p.second).
  // Given a tuple where the parts come: (x, y) ↦ f(tuple(x, y)).
  for (const [id, { size, tupled }] of reshaped) {
    const inner = add({ ...(nodes[id] as Bare) });
    const ref = (target: Id) => add({ kind: "ref", target });
    if (tupled) {
      const p = add({ kind: "binder" });
      const parts = Array.from({ length: size }, (_, i) => add({ kind: "call", fn: ref(tuplePart(size, i)), args: [ref(p)] }));
      nodes[id] = { id, kind: "lambda", params: [p], body: add({ kind: "call", fn: inner, args: parts }) } as Node;
    } else {
      const xs = Array.from({ length: size }, () => add({ kind: "binder" }));
      const whole = add({ kind: "call", fn: ref(tupleVariant(size)), args: xs.map(ref) });
      nodes[id] = { id, kind: "lambda", params: xs, body: add({ kind: "call", fn: inner, args: [whole] }) } as Node;
    }
  }
  for (const id of calls) {
    const n = nodes[id] as Call;
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
