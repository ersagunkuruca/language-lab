import { loadProgram } from "./src/lang/load.ts";
import { analyzer } from "./src/lang/modes.ts";
const p = loadProgram("examples/pedal");
const an = analyzer(p.code, p.pres.names);
const bands = p.named("bands");
const plan = an.planOf({ k: "def", id: bands }, { known: ["out"], spec: [] });
const nm = (id: string) => p.pres.names[id] ?? (p.code.nodes[id] as any)?.kind + ":" + id.slice(0, 4);
const show = (pl: any, d = "") => {
  for (const e of pl.steps) console.log(d + JSON.stringify({ ...e, node: e.node && nm(e.node), value: e.value && nm(e.value), binds: e.binds?.map(nm), a: e.a && nm(e.a), b: e.b && nm(e.b), callee: e.callee, fn: e.node && (p.code.nodes[e.node] as any)?.fn && nm((p.code.nodes[(p.code.nodes[e.node] as any).fn] as any).target) }));
  if (pl.branch) for (const a of pl.branch.arms) { console.log(d + "arm " + (a.variant && nm(a.variant))); show(a.plan, d + "  "); }
};
show(plan);
