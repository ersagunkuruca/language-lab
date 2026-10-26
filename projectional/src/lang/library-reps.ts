// Library representations chosen without the program asking (BACKLOG C47,
// C48; DATA-STRUCTURES.md step 2). A program that uses std's Map or Set
// gets the representation the chooser picks from the costs of the jobs it
// uses: the sorted entries or items as defined, or the library's
// weight-balanced tree (LIBRARY.reps, from the trees module, C51). A
// representations.json row for the type (lab, #97) still wins.
//
// A tree isn't a canonical spelling, so equal, show and compare on one
// are its row's `byType`, which go through its meaning (the sorted list).
// Where the type sits inside another value (a list of maps, a map's keys,
// main's answer) that wouldn't reach it, so such a program keeps the
// definition (C52).

import { freshId, subtree, type Code, type Id, type Node } from "../model.ts";
import type { Names } from "../presentation.ts";
import type { Info } from "./infer.ts";
import { LIBRARY } from "./library.ts";
import { choose, represent, uses, type Representation } from "./represent.ts";
import { COMPARE, S, SHOW_ANY } from "./std.ts";
import type { Type } from "./types.ts";

// What equal, show and compare see of a value: these, given a stored one,
// are its row's (byType), which go through its meaning.
const BY_VALUE: Record<Id, "equal" | "show" | "compare"> = { [S.equal]: "equal", [SHOW_ANY]: "show", [COMPARE]: "compare" };

// `insiders`: the representations' definitions, which may call the
// private constructors they represent (infer.ts Options). The library's
// own are insiders already (load.ts checkOptions).
export interface Chosen { code: Code; names: Names; chosen: string[]; insiders: Id[] }

// `defs`: the program's own definitions, which the rewrite changes;
// `asked`: rows from a representations.json, whose types are left alone.
export function withLibraryRepresentations(code: Code, info: Info, names: Names, main: Id, defs: Id[], asked: Representation[] = []): Chosen {
  const chosen: Representation[] = [];
  for (const tree of LIBRARY.reps.filter((r) => r.byType)) {
    const spec = LIBRARY.reps.find((r) => r.of === tree.of && r.canonical)!;
    if (asked.some((r) => r.of === tree.of) || !code.nodes[tree.type]) continue;
    if (!uses(code, main, [spec, tree]).length || choose(code, main, [spec, tree]).rep !== tree || inside(info, defs, code, main, tree.of)) continue;
    chosen.push(tree);
  }
  if (!chosen.length) return { code, names, chosen: [], insiders: [] };
  // equal, show and compare on a stored value: the row's own, through its meaning.
  const nodes: Record<Id, Node> = { ...code.nodes };
  const rowOf = (id: Id) => { const t = info.typeOf.get(id) && info.subst.zonk(info.typeOf.get(id)!); return t?.t === "con" ? chosen.find((r) => r.of === t.id) : undefined; };
  for (const d of defs) for (const id of subtree(code, d)) {
    const n = code.nodes[id];
    if (n.kind !== "call") continue;
    const f = code.nodes[n.fn];
    const job = f?.kind === "ref" ? BY_VALUE[f.target] : undefined;
    const row = job && n.args[0] ? rowOf(n.args[0]) : undefined;
    if (!job || !row) continue;
    const r = freshId();
    nodes[r] = { id: r, kind: "ref", target: row.byType![job] };
    nodes[id] = { ...n, fn: r };
  }
  const out = chosen.reduce((c, rep) => represent(c, defs, rep), { ...code, nodes });
  return { code: out, names, chosen: chosen.map((r) => `${names[r.of] ?? LIBRARY.names[r.of]} as ${r.name}`), insiders: [] };
}

const isCon = (t: Type, id: Id) => t.t === "con" && t.id === id;
// The type anywhere but at the top of a value's type (a list of maps, a
// map with maps for keys), or in main's type.
function inside(info: Info, defs: Id[], code: Code, main: Id, MAP: Id): boolean {
  const deep = (t: Type, top: boolean): boolean => {
    if (t.t === "con") return (!top && t.id === MAP) || t.args.some((a) => deep(info.subst.zonk(a), false));
    if (t.t === "fn") return [...t.params, t.ret].some((x) => deep(info.subst.zonk(x), true));
    return false;
  };
  const any = (t: Type): boolean => (t.t === "con" ? t.id === MAP || t.args.some((a) => any(info.subst.zonk(a))) : t.t === "fn" ? [...t.params, t.ret].some((x) => any(info.subst.zonk(x))) : false);
  const mt = info.typeOf.get(main);
  if (mt && any(info.subst.zonk(mt))) return true;
  return defs.some((d) => subtree(code, d).some((id) => { const t = info.typeOf.get(id); return !!t && deep(info.subst.zonk(t), true); }));
}
