// Loose parts (NODE-EDITOR.md, "Loose parts"): pieces lying beside a
// definition, not wired to its result. Each is a definition of its own with
// no name (the Blocks text calls them _1, _2, …), owned by the definition it
// was taken from, type-checked like any other and never run.
//
// In the editor they sit in the code like other definitions, so every edit
// works on them unchanged. On disk they're kept apart: code.json is the
// program without them (its hash, type and compiled form never see them),
// and drafts.json holds them, with the definition each belongs to.
//
// A loose part that used a variable of its definition (`rolls`, bound by a
// step of main) takes it as an input instead: `_1(rolls) = …`. So it stays
// well typed out of place, and wiring it back where `rolls` is in reach
// joins the two again (`home`, the variable each input stands for).
//
// Prior art: Scratch's canvas, where blocks not attached to a script sit
// there and don't run (Resnick, Maloney et al., MIT); unconnected nodes in
// Blender, Unreal Blueprints and Houdini.

import type { Code, Id, Node } from "../src/model.ts";
import { freshId, subtree } from "../src/model.ts";

export interface Drafts {
  // Each loose part, by the id of its definition: the definition it belongs to.
  of: Record<Id, Id>;
  // Its inputs that stand for a variable of that definition: input → variable.
  home: Record<Id, Id>;
  // Their nodes, definitions included.
  nodes: Record<Id, Node>;
}

export const NO_DRAFTS: Drafts = { of: {}, home: {}, nodes: {} };

// The program as code.json has it, and its loose parts as drafts.json does.
// A part whose definition was deleted is in neither.
export function split(code: Code, of: Record<Id, Id>, home: Record<Id, Id> = {}): { code: Code; drafts: Drafts } {
  const all = code.defs.filter((d) => of[d]);
  const loose = all.filter((d) => code.defs.includes(of[d]) && !of[of[d]]);
  const ids = new Set(loose.flatMap((d) => subtree(code, d)));
  const orphans = new Set(all.filter((d) => !loose.includes(d)).flatMap((d) => subtree(code, d)));
  const keep = Object.fromEntries(loose.map((d) => [d, of[d]]));
  return {
    code: { nodes: Object.fromEntries(Object.entries(code.nodes).filter(([id]) => !ids.has(id) && !orphans.has(id))), defs: code.defs.filter((d) => !of[d]) },
    drafts: { of: keep, home: Object.fromEntries(Object.entries(home).filter(([b]) => ids.has(b))), nodes: Object.fromEntries([...ids].map((id) => [id, code.nodes[id]])) },
  };
}

// Back into one code, loose parts after the definitions; a part whose
// definition is gone goes with it.
export function join(code: Code, d: Drafts): Code {
  const loose = Object.keys(d.of).filter((x) => d.nodes[x]?.kind === "def" && code.defs.includes(d.of[x]));
  const ids = new Set(loose.flatMap((x) => subtree({ nodes: d.nodes, defs: loose }, x)));
  return {
    nodes: { ...code.nodes, ...Object.fromEntries([...ids].map((id) => [id, d.nodes[id]])) },
    defs: [...code.defs, ...loose],
  };
}

// A definition's loose parts, in the order they were set loose.
export const looseOf = (code: Code, of: Record<Id, Id>, owner: Id): Id[] => code.defs.filter((d) => of[d] === owner);

// Set the subtree at `root` loose from `owner`: it becomes a definition of
// its own. The nodes move, ids and all; the place it was in is the
// caller's to fill (Delete leaves a hole there). Variables of `owner` it
// uses become its inputs. `scope` is what's in reach at root.
export function setLoose(code: Code, of: Record<Id, Id>, home: Record<Id, Id>, owner: Id, root: Id, scope: Id[]): { code: Code; of: Record<Id, Id>; home: Record<Id, Id>; def: Id } {
  const nodes = { ...code.nodes };
  const inside = new Set(subtree(code, root));
  const outer = new Set(scope);
  const inputs = new Map<Id, Id>();
  for (const id of inside) {
    const n = nodes[id];
    if (n.kind !== "ref" || !outer.has(n.target) || inside.has(n.target)) continue;
    let p = inputs.get(n.target);
    if (!p) { p = freshId(); nodes[p] = { id: p, kind: "binder" }; inputs.set(n.target, p); }
    nodes[id] = { ...n, target: p };
  }
  const def = freshId();
  let body = root;
  if (inputs.size) {
    body = freshId();
    nodes[body] = { id: body, kind: "lambda", params: [...inputs.values()], body: root };
  }
  nodes[def] = { id: def, kind: "def", body } as Node;
  const back = Object.fromEntries([...inputs].map(([v, p]) => [p, v]));
  return { code: { nodes, defs: [...code.defs, def] }, of: { ...of, [def]: owner }, home: { ...home, ...back }, def };
}

// Wire a loose part into a hole of its definition: its nodes go there, and
// it's a loose part no more. Each input that stands for a variable in reach
// at the hole (`scope`) is that variable again; any other becomes a hole.
export function wireIn(code: Code, of: Record<Id, Id>, home: Record<Id, Id>, def: Id, hole: Id, scope: Id[]): { code: Code; of: Record<Id, Id>; home: Record<Id, Id> } | null {
  const d = code.nodes[def];
  if (d?.kind !== "def" || !d.body || code.nodes[hole]?.kind !== "hole") return null;
  const body = code.nodes[d.body];
  // Its inputs, if it has any: a function it is itself goes in whole.
  const lam = body.kind === "lambda" && body.params.length && body.params.every((p) => home[p]) ? body : null;
  const root = lam ? lam.body : d.body;
  const reach = new Set(scope);
  const nodes = { ...code.nodes };
  if (lam) {
    for (const id of subtree(code, root)) {
      const n = nodes[id];
      if (n.kind !== "ref" || !lam.params.includes(n.target)) continue;
      const v = home[n.target];
      nodes[id] = v && reach.has(v) ? { ...n, target: v } : { id, kind: "hole" };
    }
    delete nodes[lam.id];
    for (const p of lam.params) delete nodes[p];
  }
  delete nodes[def];
  // The hole takes the part's root: the root's node, under the hole's id,
  // so whatever pointed at the hole points at it.
  nodes[hole] = { ...nodes[root], id: hole } as Node;
  delete nodes[root];
  const { [def]: _, ...rest } = of;
  const left = Object.fromEntries(Object.entries(home).filter(([p]) => nodes[p]));
  return { code: { nodes, defs: code.defs.filter((x) => x !== def) }, of: rest, home: left };
}

// A new loose part, nothing yet: a hole to fill from the palette, then wire
// in (rule 7). Made on the canvas, it needs no name and no step.
export function newLoose(code: Code, of: Record<Id, Id>, owner: Id): { code: Code; of: Record<Id, Id>; def: Id; hole: Id } {
  const hole = freshId(), def = freshId();
  return {
    code: { nodes: { ...code.nodes, [hole]: { id: hole, kind: "hole" }, [def]: { id: def, kind: "def", body: hole } as Node }, defs: [...code.defs, def] },
    of: { ...of, [def]: owner }, def, hole,
  };
}

// Throw a loose part away.
export function dropLoose(code: Code, of: Record<Id, Id>, home: Record<Id, Id>, def: Id): { code: Code; of: Record<Id, Id>; home: Record<Id, Id> } {
  const gone = new Set(subtree(code, def));
  const { [def]: _, ...rest } = of;
  return {
    code: { nodes: Object.fromEntries(Object.entries(code.nodes).filter(([id]) => !gone.has(id))), defs: code.defs.filter((x) => x !== def) },
    of: rest,
    home: Object.fromEntries(Object.entries(home).filter(([p]) => !gone.has(p))),
  };
}
