// The trees module: maps and sets stored as weight-balanced trees
// (map-tree.ts), published like the prelude (library/build.ts writes
// library/trees.json). Nothing in it is offered: a program says Map and
// Set, and the representation rows it carries (LIBRARY.reps) let the
// chooser store them as trees (DATA-STRUCTURES.md, C47). It also carries
// `array of List` (array-list.ts), for the compiler's lists as arrays.

import { merge, type Id } from "../model.ts";
import { prelude } from "../prelude.ts";
import { Lang } from "./dsl.ts";
import { buildTrees } from "./map-tree.ts";
import { buildArrayList } from "./array-list.ts";
import { makeModule, publish, type Module } from "./modules.ts";
import { infer } from "./infer.ts";
import { representationsIn } from "./represent.ts";
import { std } from "./std.ts";

export function buildTreesModule(preludeModule: Module): Module {
  const base = merge(prelude, std, preludeModule.code);
  const k = new Lang(base);
  const byName = (name: string) => preludeModule.code.defs.find((d) => preludeModule.names[d] === name)!;
  const trees = buildTrees(k, byName);
  // Lists as arrays (array-list.ts, L117): after the trees, so their rows
  // keep their places in LIBRARY.reps.
  const arrays = buildArrayList(k, byName);
  const t = { defs: [...trees.defs, ...arrays.defs], representations: [...trees.representations, ...arrays.representations] };
  const p = publish(merge(base, k.code), k.names, t.defs, base);
  if (!p.ok) throw new Error(`the trees can't be published: ${p.reason}`);
  const at = (d: Id) => p.rename.get(d) ?? d;
  // The rows are read off the published representation definitions
  // (REPRESENTATIONS.md, L108b), as a program's own are.
  const published = merge(base, p.code);
  const info = infer(published, p.names, undefined, { insiders: t.defs.map(at) });
  const representations = representationsIn(published, info, p.names, t.representations.map(at));
  const m = makeModule("trees", p.code, p.names, [], p.pins, {}, t.defs.map(at));
  // makeModule takes in what the trees use, the prelude's map, keep and
  // reverse among it; those stay the prelude's.
  const own = (id: Id) => !base.nodes[id];
  const code = { nodes: Object.fromEntries(Object.entries(m.code.nodes).filter(([id]) => own(id))), defs: m.code.defs.filter(own) };
  return { ...m, code, pins: Object.fromEntries(Object.entries(m.pins).filter(([d]) => own(d))), representations };
}
