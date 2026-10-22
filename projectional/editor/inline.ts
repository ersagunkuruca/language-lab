// Show inline: a call drawn with the callee's body in place, so a function
// isn't a black box. It is the language's own meaning of a call: f(a, b)
// is ((x, y) => body)(a, b), and a lambda called on the spot is a let, so the
// graph draws the arguments flowing into dots named x and y and on through
// the body, with nothing new to learn.
//
// It's a view, rebuilt for each render and never saved: which calls are
// shown inline is a list in layout.json. The body is a copy whose ids are
// "<original>~<call>", so it can't be edited by accident, and a call inside
// it can be shown inline too.

import { subtree, type Code, type Id, type Node } from "../src/model.ts";
import type { Names } from "../src/presentation.ts";

export interface InlineView {
  code: Code;
  names: Names;
  // Every node that's part of a view, and the definition it shows.
  from: Map<Id, Id>;
}

// The definition a call can be shown from: a call of a definition whose
// body is a function.
export function inlinable(code: Code, call: Id): Id | null {
  const c = code.nodes[call];
  if (c?.kind !== "call") return null;
  const f = code.nodes[c.fn];
  if (f?.kind !== "ref") return null;
  const d = code.nodes[f.target];
  if (d?.kind !== "def" || !d.body) return null;
  return code.nodes[d.body]?.kind === "lambda" ? d.id : null;
}

export function inlineView(code: Code, names: Names, calls: Id[]): InlineView {
  const nodes: Record<Id, Node> = { ...code.nodes };
  const out: Names = { ...names };
  const from = new Map<Id, Id>();
  for (const call of calls) {
    const view = { nodes, defs: code.defs };
    const def = inlinable(view, call);
    if (!def) continue;
    const lam = (nodes[def] as { body: Id }).body;
    const ids = new Map(subtree(view, lam).map((id) => [id, `${id}~${call}`]));
    const map = (x: unknown): unknown =>
      typeof x === "string" ? ids.get(x) ?? x
      : Array.isArray(x) ? x.map(map)
      : x && typeof x === "object" ? Object.fromEntries(Object.entries(x).map(([k, v]) => [k, map(v)]))
      : x;
    for (const [id, copy] of ids) {
      nodes[copy] = { ...(map(nodes[id]) as Node), id: copy };
      if (names[id] !== undefined) out[copy] = names[id];
      from.set(copy, def);
    }
    const c = nodes[call] as Extract<Node, { kind: "call" }>;
    nodes[call] = { ...c, fn: ids.get(lam)! };
    from.set(call, def);
  }
  return { code: { nodes, defs: code.defs }, names: out, from };
}
