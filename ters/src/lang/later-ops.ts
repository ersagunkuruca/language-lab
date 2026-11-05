// The operations answered later (ANSWERED-LATER.md, L54a, L229e): those
// declared `later`, and those a case anywhere takes the rest of (one more
// binder than the operation has inputs), as the steps of an effect's
// generated handler does (steps.ts). The rest is a value either way; an
// operation nobody takes the rest of is answered at once, and costs
// nothing kept (Koka's `ctl` beside its `fun`).

import type { Code, Id, NodeOf } from "../model.ts";

const cache = new WeakMap<Code["nodes"], { size: number; ops: Set<Id> }>();

export function laterOps(code: Code): Set<Id> {
  const nodes = code.nodes, size = Object.keys(nodes).length, had = cache.get(nodes);
  if (had && had.size === size) return had.ops;
  const ops = new Set<Id>();
  for (const n of Object.values(nodes)) {
    if (n.kind === "variant" && n.later && n.returns) ops.add(n.id);
    if (n.kind !== "arm") continue;
    const v = nodes[n.variant];
    if (v?.kind === "variant" && v.returns && n.binds.length === (v as NodeOf<"variant">).fields.length + 1) ops.add(v.id);
  }
  cache.set(nodes, { size, ops });
  return ops;
}

