// Named handlers made plain before lowering (L213b, RESOURCES-2026-11-03
// §2): a handler of E with a name handles a copy of E of its own, and an
// operation of E given that name is the copy's operation, given the rest.
// So an operation given no name passes it, as the evaluator's does, and
// the targets see ordinary handlers. A name never leaves its handler
// (L213b2), so every use of it is inside the copy's handler.

import { freshId, mapIds, subtree, type Code, type Id, type NodeOf } from "../../ters/src/model.ts";
import type { Names } from "../../ters/src/presentation.ts";
import { infer, type Info } from "../../ters/src/lang/infer.ts";

export function unnameHandlers(code: Code, info: Info, names: Names): { code: Code; info: Info; names: Names } {
  const named = Object.values(code.nodes).filter((n): n is NodeOf<"match"> => n.kind === "match" && !!n.name);
  if (!named.length) return { code, info, names };
  // Each operation's effect, by its definition.
  const effectOf = new Map<Id, Id>();
  for (const d of code.defs) {
    const def = code.nodes[d], td = def?.kind === "def" && def.body ? code.nodes[def.body] : null;
    if (td?.kind === "typedef" && td.effect) for (const v of td.variants) effectOf.set(v, d);
  }
  const nodes = { ...code.nodes }, defs = [...code.defs], nn = { ...names };
  for (const m of named) {
    const arms = m.arms.map((a) => nodes[a] as NodeOf<"arm">);
    const effect = arms.map((a) => effectOf.get(a.variant)).find((e) => e);
    if (!effect) continue;
    // E copied, with fresh ids.
    const fresh = new Map(subtree(code, effect).map((id) => [id, freshId()] as const));
    for (const id of fresh.keys()) {
      const c = mapIds(code.nodes[id], (x) => fresh.get(x) ?? x);
      nodes[c.id] = c;
      if (names[id] !== undefined) nn[c.id] = id === effect ? `${names[id]} of ${names[m.name!] ?? "a handler"}` : names[id];
    }
    defs.push(fresh.get(effect)!);
    for (const a of arms) if (fresh.has(a.variant)) nodes[a.id] = { ...a, variant: fresh.get(a.variant)! };
    // Its operations given the name: the copy's, without it.
    for (const n of Object.values(nodes)) {
      if (n.kind !== "call" || !n.args?.length) continue;
      const f = nodes[n.fn], first = nodes[n.args[0]];
      if (f?.kind !== "ref" || !fresh.has(f.target) || first?.kind !== "ref" || first.target !== m.name) continue;
      nodes[f.id] = { ...f, target: fresh.get(f.target)! };
      nodes[n.id] = { ...n, args: n.args.slice(1) };
    }
    const { name: _, ...plain } = nodes[m.id] as NodeOf<"match">;
    nodes[m.id] = plain as NodeOf<"match">;
  }
  const next = { ...code, nodes, defs };
  return { code: next, info: infer(next, nn), names: nn };
}
