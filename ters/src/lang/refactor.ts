// Type-aware edits. These are the gestures that make whole classes of error
// impossible rather than reported: a hole is filled only from fillings()
// (so with something of the right type and arity), a case analysis is
// created with exactly one arm per variant, and adding a variant to a type
// adds a hole arm to every case analysis that needs one.

import type { Code, Id, Node, NodeData, NodeOf } from "../model.ts";
import { children, freshId, ownerOfTypeParts } from "../model.ts";
import type { Names } from "../presentation.ts";
import type { Filling } from "./infer.ts";
import { INT, NUMBER, STRING, type Type } from "./types.ts";
import { TRUE } from "./std.ts";

export interface Edit { code: Code; names: Names }

// `into`, given, is a copy of code's nodes to write in instead of making
// one (a palette checking one offer after another: infer.ts fillings);
// `made` lists what was added, so it can be taken out again.
function adder(code: Code, into?: Record<Id, Node>) {
  const nodes = into ?? { ...code.nodes };
  const made: Id[] = [];
  const add = (n: NodeData): Id => {
    const id = freshId();
    nodes[id] = { id, ...n } as Node;
    made.push(id);
    return id;
  };
  return { nodes, add, made };
}

const variantsOf = (code: Code, def: Id) => {
  const td = code.nodes[(code.nodes[def] as NodeOf<"def">).body!] as NodeOf<"typedef">;
  return td.variants;
};

// True if field `f` of type `def` holds the type itself, directly or in a
// container (a rose tree's List Tree): a fold folds it.
function recursiveField(code: Code, def: Id, f: Id): boolean {
  const mentions = (tid: Id): boolean => {
    const t = code.nodes[tid];
    return t.kind === "tref" && (t.target === def || t.args.some(mentions));
  };
  return mentions((code.nodes[f] as NodeOf<"field">).type);
}

// Arms for every variant of `def`, each with fresh binders named after the
// fields and a hole for a body. A field's name is the program's or else the
// library's (`library`), which the program doesn't store.
// `taken`: names already visible where the arms go, so a match inside
// another match on a list gets `head 2`, not a second `head`.
function makeArms(code: Code, add: (n: NodeData) => Id, names: Names, def: Id, variants: Id[], fold: boolean, library: Names = {}, taken = new Set<string>()): Id[] {
  const fieldName = (f: Id) => unique(names[f] ?? library[f] ?? "field", taken);
  return variants.map((v) => {
    const fields = (code.nodes[v] as NodeOf<"variant">).fields;
    const binds = fields.map((f) => { const b = add({ kind: "binder" }); names[b] = fieldName(f); return b; });
    const results = fields.map((f) => {
      if (!fold || !recursiveField(code, def, f)) return null;
      const r = add({ kind: "binder" });
      names[r] = `${fieldName(f)}′`;
      return r;
    });
    return add({ kind: "arm", variant: v, binds, results, body: add({ kind: "hole" }) });
  });
}

// `name`, or `name 2`, `name 3`… if a binder in view has it already.
// A new function's parameter, named for what it takes: x for a Float64, n
// for an Int, the type's own name for the rest (event, chapter), so a
// handler reads (event) => □ instead of (input 1) => □.
export function paramName(t: Type | undefined, names: Names): string {
  if (t?.t === "fn") return "f";
  if (t?.t !== "con") return "value";
  const fixed: Record<string, string> = { [NUMBER]: "x", [INT]: "n", [STRING]: "text", "std.list": "items" };
  const nm = fixed[t.id] ?? names[t.id];
  return nm ? nm.toLowerCase() : "value";
}

function unique(name: string, taken: Set<string>): string {
  if (!taken.has(name)) return name;
  let i = 2;
  while (taken.has(`${name} ${i}`)) i++;
  return `${name} ${i}`;
}

// The names of the binders `hole` can see: those of every node around it
// that binds (a definition's lambda, a match's arms, a solve).
function namesInScope(code: Code, names: Names, hole: Id): Set<string> {
  const out = new Set<string>();
  const path: Id[] = [];
  const find = (id: Id): boolean => {
    if (id === hole) return true;
    const n = code.nodes[id];
    if (!n) return false;
    path.push(id);
    for (const c of children(n)) if (find(c)) return true;
    path.pop();
    return false;
  };
  for (const d of code.defs) {
    if (!find(d)) continue;
    for (const id of path) for (const c of children(code.nodes[id])) if (code.nodes[c]?.kind === "binder" && names[c]) out.add(names[c]);
    break;
  }
  return out;
}

// With `into` (a copy of code's nodes), the filling is written there, and
// `undo` puts the copy back as it was (BACKLOG E133a).
export function fillHole(code: Code, names: Names, hole: Id, f: Filling, library: Names = {}, into?: Record<Id, Node>): Edit & { undo: () => void } {
  const { nodes, add, made } = adder(code, into);
  const nn: Names = { ...names };
  const holes = (k: number) => Array.from({ length: k }, () => add({ kind: "hole" }));
  let data: NodeData;
  switch (f.kind) {
    case "ref": data = { kind: "ref", target: f.target }; break;
    case "call": data = { kind: "call", fn: add({ kind: "ref", target: f.target }), args: holes(f.arity) }; break;
    case "lit": data = f.of === "int" ? { kind: "lit", value: 0, of: INT } : { kind: "lit", value: f.of === "number" ? 0 : "" }; break;
    case "lambda": {
      const taken = namesInScope(code, names, hole);
      const params = Array.from({ length: f.arity }, (_, i) => {
        const b = add({ kind: "binder" });
        nn[b] = unique(paramName(f.params?.[i], { ...library, ...names }), taken);
        taken.add(nn[b]);
        return b;
      });
      data = { kind: "lambda", params, body: add({ kind: "hole" }) };
      break;
    }
    // A use of a definition with results (RESULTS.md): `x, y = polar(□, □)`,
    // its inputs holes, its results bound by their names in a body still
    // to write.
    case "use": {
      const d = code.nodes[f.target] as NodeOf<"def">;
      const params = (code.nodes[d.body!] as NodeOf<"lambda">).params, results = d.results ?? [];
      const taken = namesInScope(code, names, hole);
      const given: Record<string, Id> = Object.fromEntries(params.filter((p) => !results.includes(p)).map((p) => [p, add({ kind: "hole" })]));
      given.out = add({ kind: "ref", target: TRUE });
      const binds = Object.fromEntries(results.map((r) => {
        const b = add({ kind: "binder" });
        nn[b] = unique({ ...library, ...names }[r] ?? "result", taken);
        taken.add(nn[b]);
        return [r, b];
      }));
      data = { kind: "solve", fn: f.target, given, binds, body: add({ kind: "hole" }) };
      break;
    }
    case "match":
    case "fold": {
      const scrutinee = add(f.on ? { kind: "ref", target: f.on } : { kind: "hole" });
      const arms = makeArms({ ...code, nodes }, add, nn, f.type, variantsOf(code, f.type), f.kind === "fold", library, namesInScope(code, names, hole));
      data = f.kind === "match" ? { kind: "match", scrutinee, arms, otherwise: null } : { kind: "fold", scrutinee, arms };
      break;
    }
  }
  const was = nodes[hole];
  nodes[hole] = { ...data, id: hole } as Node;
  return { code: { nodes, defs: code.defs }, names: nn, undo: () => { for (const id of made) delete nodes[id]; nodes[hole] = was; } };
}

// Add a case to a data type. Every match and fold over that type that
// covers cases one by one gets an arm for it, with a hole for its body: the
// program has new holes to fill, but never a missing case.
export function addVariant(code: Code, names: Names, def: Id, name: string, fields: { name: string; type: Id }[] = []): Edit & { variant: Id } {
  const { nodes, add } = adder(code);
  const nn: Names = { ...names };
  const fids = fields.map((f) => { const id = add({ kind: "field", type: f.type }); nn[id] = f.name; return id; });
  const variant = add({ kind: "variant", fields: fids });
  nn[variant] = name;
  const tdId = (code.nodes[def] as NodeOf<"def">).body!;
  const td = nodes[tdId] as NodeOf<"typedef">;
  nodes[tdId] = { ...td, variants: [...td.variants, variant] };
  const next: Code = { nodes, defs: code.defs };
  const owner = ownerOfTypeParts(next);
  for (const n of Object.values(code.nodes)) {
    if (n.kind !== "match" && n.kind !== "fold") continue;
    if (n.kind === "match" && n.otherwise) continue;
    const first = n.arms[0] ? (code.nodes[n.arms[0]] as NodeOf<"arm">).variant : null;
    if (!first || owner.get(first) !== def) continue;
    const [arm] = makeArms(next, add, nn, def, [variant], n.kind === "fold");
    nodes[n.id] = { ...n, arms: [...n.arms, arm] };
  }
  return { code: next, names: nn, variant };
}
