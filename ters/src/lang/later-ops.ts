// The operations answered later (ANSWERED-LATER.md, L54a, L229e): those
// declared `later`, and those a case anywhere takes the rest of (one more
// binder than the operation has inputs), as the steps of an effect's
// generated handler does (steps.ts). The rest is a value either way; an
// operation nobody takes the rest of is answered at once, and costs
// nothing kept (Koka's `ctl` beside its `fun`).

import { derived, nodesWhere, type Code, type Id, type Node, type NodeOf, nodeIds, nodeValues } from "../model.ts";

const cache = new WeakMap<Code["nodes"], { size: number; ops: Set<Id> }>();

const picked = (n: Node) => (n.kind === "variant" && !!n.later && !!n.returns) || n.kind === "arm";
export function laterOps(code: Code): Set<Id> {
  const nodes = code.nodes;
  // A program on its layer (being checked, model.ts scanningOnLayer): the
  // layer's cases and operations, found once, and its own (L266: each
  // check counted and walked every node, the library's ~45,000).
  if (derived.has(code)) return opsIn(nodes, nodesWhere(code, "later ops", picked).map((id) => nodes[id]));
  const size = nodeIds(nodes).length, had = cache.get(nodes);
  if (had && had.size === size) return had.ops;
  const ops = opsIn(nodes, nodeValues(nodes));
  cache.set(nodes, { size, ops });
  return ops;
}
function opsIn(nodes: Code["nodes"], ns: Iterable<Node>): Set<Id> {
  const ops = new Set<Id>();
  for (const n of ns) {
    if (n.kind === "variant" && n.later && n.returns) ops.add(n.id);
    if (n.kind !== "arm") continue;
    const v = nodes[n.variant];
    if (v?.kind === "variant" && v.returns && n.binds.length === (v as NodeOf<"variant">).fields.length + 1) ops.add(v.id);
  }
  return ops;
}
