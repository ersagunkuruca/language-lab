// Edits above the expression level: definitions, their parameters, data
// types, their cases and fields. With these a program can be written from
// nothing in the editor, not only filled in.
//
// Each edit keeps every place that depends on what it changes in step, the
// same way adding a case adds an arm to every match:
//   a new parameter gives every call a hole for it,
//   a new field gives every constructor call a hole and every arm a binder,
//   a removed parameter or field drops the argument everywhere.
// What can't be kept in step is refused with the reason (a parameter still
// used in the body, a definition something else calls). The editor then
// re-infers the program and refuses anything that adds a type error, like
// any other edit.

import type { Code, Id, Node, NodeData, NodeOf } from "../model.ts";
import { collect, freshId, ownerOfTypeParts, replace, subtree } from "../model.ts";
import type { Names } from "../presentation.ts";

export type Top = { ok: true; code: Code; names: Names; select: Id; note: string } | { ok: false; reason: string };

// A field's type, before it becomes tref nodes: a type (builtin, data type
// or one of the type's parameters) applied to arguments.
export interface TypeSpec { target: Id; args: TypeSpec[] }

function builder(code: Code) {
  const nodes = { ...code.nodes };
  const add = (n: NodeData): Id => { const id = freshId(); nodes[id] = { id, ...n } as Node; return id; };
  return { nodes, add };
}

const trim = (s: string) => s.trim().replace(/\s+/g, " ");
const nameOf = (names: Names, id: Id) => names[id] ?? "it";

function nameTaken(code: Code, names: Names, name: string, except?: Id): boolean {
  return code.defs.some((d) => d !== except && names[d] === name);
}

const refsTo = (code: Code, target: Id) => Object.values(code.nodes).filter((n): n is NodeOf<"ref"> => n.kind === "ref" && n.target === target);
const callsOf = (code: Code, target: Id) => Object.values(code.nodes).filter((n): n is NodeOf<"call"> => {
  if (n.kind !== "call") return false;
  const f = code.nodes[n.fn];
  return f?.kind === "ref" && f.target === target;
});

// The def each node belongs to, for saying where something is used.
function defOwners(code: Code): Map<Id, Id> {
  const out = new Map<Id, Id>();
  for (const d of code.defs) for (const id of subtree(code, d)) out.set(id, d);
  return out;
}

const list = (xs: string[]) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`);

// ---------------------------------------------------------------- definitions

export type Shape =
  | { kind: "function"; params: string[] }
  | { kind: "value" }
  | { kind: "type"; firstCase: string };

export function newDefinition(code: Code, names: Names, rawName: string, shape: Shape): Top {
  const name = trim(rawName);
  if (!name) return { ok: false, reason: "a definition needs a name" };
  if (nameTaken(code, names, name)) return { ok: false, reason: `there is already a definition named ${name}` };
  const { nodes, add } = builder(code);
  const nn: Names = { ...names };
  let body: Id;
  let select: Id;
  if (shape.kind === "function") {
    const params = shape.params.map((p, i) => { const b = add({ kind: "binder" }); nn[b] = trim(p) || `input ${i + 1}`; return b; });
    body = add({ kind: "lambda", params, body: (select = add({ kind: "hole" })) });
  } else if (shape.kind === "value") {
    body = select = add({ kind: "hole" });
  } else {
    const first = trim(shape.firstCase) || name.toLowerCase();
    const variant = add({ kind: "variant", fields: [] });
    nn[variant] = first;
    body = add({ kind: "typedef", params: [], variants: [variant] });
    select = variant;
  }
  const def = add({ kind: "def", body });
  nn[def] = name;
  const what = shape.kind === "type" ? "a data type with one case" : shape.kind === "value" ? "a value: fill its hole" : `a function of ${shape.params.length || "no"} input${shape.params.length === 1 ? "" : "s"}: fill its hole`;
  return { ok: true, code: { nodes, defs: [...code.defs, def] }, names: nn, select: shape.kind === "type" ? def : select, note: `New definition ${name}, ${what}.` };
}

// Everything outside `def` that points into it: calls, uses as a value,
// constructors, cases matched, field types, relation uses.
export function usesOfDefinition(code: Code, def: Id): Id[] {
  const own = new Set(subtree(code, def));
  const owner = ownerOfTypeParts(code);
  const into = (t: Id | null | undefined) => !!t && (t === def || owner.get(t) === def);
  return Object.values(code.nodes).filter((n) => {
    if (own.has(n.id)) return false;
    switch (n.kind) {
      case "ref": case "tref": return into(n.target);
      case "arm": return into(n.variant);
      case "part": case "solve": return into(n.fn);
      default: return false;
    }
  }).map((n) => n.id);
}

export function deleteDefinition(code: Code, names: Names, def: Id): Top {
  if (!code.defs.includes(def)) return { ok: false, reason: "that isn't a definition" };
  const uses = usesOfDefinition(code, def);
  if (uses.length) {
    const owners = defOwners(code);
    const where = [...new Set(uses.map((u) => owners.get(u)).filter((d): d is Id => !!d))].map((d) => nameOf(names, d));
    return { ok: false, reason: `${nameOf(names, def)} is used by ${list(where) || "other code"}; change those first` };
  }
  const defs = code.defs.filter((d) => d !== def);
  const next = collect({ nodes: code.nodes, defs });
  const nn = Object.fromEntries(Object.entries(names).filter(([id]) => next.nodes[id]));
  return { ok: true, code: next, names: nn, select: defs.find((d) => !d.startsWith("std.") && !d.startsWith("builtin")) ?? defs[0], note: `Deleted ${nameOf(names, def)}. Nothing used it.` };
}

// ---------------------------------------------------------------- parameters

const lambdaOf = (code: Code, def: Id): NodeOf<"lambda"> | null => {
  const d = code.nodes[def];
  const b = d?.kind === "def" && d.body ? code.nodes[d.body] : null;
  return b?.kind === "lambda" ? b : null;
};

export function addParameter(code: Code, names: Names, def: Id, rawName: string): Top {
  const d = code.nodes[def] as NodeOf<"def">;
  const name = trim(rawName) || "input";
  const lam = lambdaOf(code, def);
  const { nodes, add } = builder(code);
  const nn: Names = { ...names };
  const b = add({ kind: "binder" });
  nn[b] = name;
  if (!lam) {
    // A value becomes a function of one input; only possible while nothing
    // uses it as a value.
    if (!d.body) return { ok: false, reason: "this definition has no body" };
    if (code.nodes[d.body].kind === "typedef") return { ok: false, reason: "a data type has cases and fields, not inputs" };
    if (refsTo(code, def).length) return { ok: false, reason: `${nameOf(names, def)} is used as a value; a function would need to be called there` };
    nodes[def] = { ...d, body: add({ kind: "lambda", params: [b], body: d.body }) };
    return { ok: true, code: { nodes, defs: code.defs }, names: nn, select: b, note: `${nameOf(names, def)} is now a function of ${name}.` };
  }
  nodes[lam.id] = { ...lam, params: [...lam.params, b] };
  const calls = callsOf(code, def);
  for (const c of calls) nodes[c.id] = { ...c, args: [...c.args, add({ kind: "hole" })] };
  return { ok: true, code: { nodes, defs: code.defs }, names: nn, select: b,
    note: `Added the input ${name}.${calls.length ? ` ${calls.length} call${calls.length === 1 ? "" : "s"} got a hole for it, so none is missing an argument.` : ""}` };
}

export function removeParameter(code: Code, names: Names, def: Id, param: Id): Top {
  const lam = lambdaOf(code, def);
  const i = lam ? lam.params.indexOf(param) : -1;
  if (!lam || i < 0) return { ok: false, reason: "that isn't one of this definition's inputs" };
  const uses = refsTo(code, param).length;
  if (uses) return { ok: false, reason: `${nameOf(names, param)} is used ${uses === 1 ? "once" : `${uses} times`} in the body; clear those first` };
  const nodes = { ...code.nodes };
  nodes[lam.id] = { ...lam, params: lam.params.filter((p) => p !== param) };
  const calls = callsOf(code, def);
  for (const c of calls) nodes[c.id] = { ...c, args: c.args.filter((_, j) => j !== i) };
  const next = collect({ nodes, defs: code.defs });
  const nn = { ...names };
  delete nn[param];
  return { ok: true, code: next, names: nn, select: def,
    note: `Removed the input ${nameOf(names, param)}.${calls.length ? ` Its argument was dropped from ${calls.length} call${calls.length === 1 ? "" : "s"}.` : ""}` };
}

export function moveParameter(code: Code, names: Names, def: Id, param: Id, by: -1 | 1): Top {
  const lam = lambdaOf(code, def);
  const i = lam ? lam.params.indexOf(param) : -1;
  const j = i + by;
  if (!lam || i < 0) return { ok: false, reason: "that isn't one of this definition's inputs" };
  if (j < 0 || j >= lam.params.length) return { ok: false, reason: by < 0 ? "it's already first" : "it's already last" };
  const swap = <T>(xs: T[]) => { const ys = [...xs]; [ys[i], ys[j]] = [ys[j], ys[i]]; return ys; };
  const nodes = { ...code.nodes };
  nodes[lam.id] = { ...lam, params: swap(lam.params) };
  const calls = callsOf(code, def);
  for (const c of calls) nodes[c.id] = { ...c, args: swap(c.args) };
  return { ok: true, code: { nodes, defs: code.defs }, names, select: param,
    note: `Moved ${nameOf(names, param)} ${by < 0 ? "earlier" : "later"}.${calls.length ? ` ${calls.length} call${calls.length === 1 ? "" : "s"} swapped their arguments to match.` : ""}` };
}

// ---------------------------------------------------------------- data types

const typedefOf = (code: Code, type: Id) => code.nodes[(code.nodes[type] as NodeOf<"def">).body!] as NodeOf<"typedef">;

function buildType(add: (n: NodeData) => Id, t: TypeSpec): Id {
  return add({ kind: "tref", target: t.target, args: t.args.map((a) => buildType(add, a)) });
}

const isRecursive = (code: Code, type: Id, t: TypeSpec) => t.target === type && t.args.length === typedefOf(code, type).params.length;

export function removeCase(code: Code, names: Names, type: Id, variant: Id): Top {
  const td = typedefOf(code, type);
  if (!td.variants.includes(variant)) return { ok: false, reason: "that isn't a case of this type" };
  if (td.variants.length === 1) return { ok: false, reason: "a type needs at least one case" };
  const made = refsTo(code, variant).length;
  if (made) return { ok: false, reason: `${nameOf(names, variant)} is made in ${made} place${made === 1 ? "" : "s"}; change those first` };
  const nodes = { ...code.nodes };
  nodes[td.id] = { ...td, variants: td.variants.filter((v) => v !== variant) };
  let arms = 0;
  for (const n of Object.values(code.nodes)) {
    if (n.kind !== "match" && n.kind !== "fold") continue;
    const keep = n.arms.filter((a) => (code.nodes[a] as NodeOf<"arm">).variant !== variant);
    if (keep.length === n.arms.length) continue;
    arms += n.arms.length - keep.length;
    nodes[n.id] = { ...n, arms: keep };
  }
  const next = collect({ nodes, defs: code.defs });
  return { ok: true, code: next, names, select: type,
    note: `Removed the case ${nameOf(names, variant)}.${arms ? ` ${arms} arm${arms === 1 ? "" : "s"} for it went too; nothing could reach ${arms === 1 ? "it" : "them"}.` : ""}` };
}

export function addField(code: Code, names: Names, type: Id, variant: Id, rawName: string, t: TypeSpec): Top {
  const v = code.nodes[variant] as NodeOf<"variant">;
  if (!typedefOf(code, type).variants.includes(variant)) return { ok: false, reason: "that isn't a case of this type" };
  const name = trim(rawName) || "field";
  const { nodes, add } = builder(code);
  const nn: Names = { ...names };
  const field = add({ kind: "field", type: buildType(add, t) });
  nn[field] = name;
  nodes[variant] = { ...v, fields: [...v.fields, field] };
  // Every place that makes this case gets a hole for the new field.
  const calls = callsOf(code, variant);
  for (const c of calls) nodes[c.id] = { ...c, args: [...c.args, add({ kind: "hole" })] };
  let made = calls.length;
  const asCall = new Set(calls.map((c) => c.fn));
  if (!v.fields.length) {
    // A case without fields is a constant; with one it becomes a call. The
    // call keeps the constant's id, so what's attached to it stays.
    for (const r of refsTo(code, variant)) {
      if (asCall.has(r.id)) continue;
      nodes[r.id] = { id: r.id, kind: "call", fn: add({ kind: "ref", target: variant }), args: [add({ kind: "hole" })] };
      made++;
    }
  }
  // Every arm for this case gets a binder for it (and a folded one if the
  // field holds the type itself).
  const recursive = isRecursive(code, type, t);
  let arms = 0;
  for (const n of Object.values(code.nodes)) {
    if (n.kind !== "arm" || n.variant !== variant) continue;
    const b = add({ kind: "binder" });
    nn[b] = name;
    const inFold = Object.values(code.nodes).some((m) => m.kind === "fold" && m.arms.includes(n.id));
    let r: Id | null = null;
    if (inFold && recursive) { r = add({ kind: "binder" }); nn[r] = `${name}′`; }
    nodes[n.id] = { ...n, binds: [...n.binds, b], results: [...n.results, r] };
    arms++;
  }
  const parts = [made && `${made} place${made === 1 ? "" : "s"} making ${nameOf(names, variant)} got a hole for it`, arms && `${arms} arm${arms === 1 ? "" : "s"} got a name for it`].filter(Boolean);
  return { ok: true, code: { nodes, defs: code.defs }, names: nn, select: field, note: `Added the field ${name} to ${nameOf(names, variant)}.${parts.length ? ` ${parts.join("; ")}.` : ""}` };
}

export function removeField(code: Code, names: Names, variant: Id, field: Id): Top {
  const v = code.nodes[variant] as NodeOf<"variant">;
  const i = v.fields.indexOf(field);
  if (i < 0) return { ok: false, reason: "that isn't a field of this case" };
  if (refsTo(code, field).length) return { ok: false, reason: `${nameOf(names, field)} is read directly somewhere; change that first` };
  const arms = Object.values(code.nodes).filter((n): n is NodeOf<"arm"> => n.kind === "arm" && n.variant === variant);
  const used = arms.filter((a) => [a.binds[i], a.results[i]].some((b) => b && refsTo(code, b).length)).length;
  if (used) return { ok: false, reason: `${used} arm${used === 1 ? " uses" : "s use"} ${nameOf(names, field)}; clear those uses first` };
  const nodes = { ...code.nodes };
  nodes[variant] = { ...v, fields: v.fields.filter((f) => f !== field) };
  for (const a of arms) nodes[a.id] = { ...a, binds: a.binds.filter((_, j) => j !== i), results: a.results.filter((_, j) => j !== i) };
  const calls = callsOf(code, variant);
  for (const c of calls) nodes[c.id] = { ...c, args: c.args.filter((_, j) => j !== i) };
  let next: Code = { nodes, defs: code.defs };
  // The last field gone: calls of the case become the constant again.
  if (v.fields.length === 1) for (const c of calls) next = replace(next, c.id, () => ({ kind: "ref", target: variant }));
  next = collect(next);
  const nn = Object.fromEntries(Object.entries(names).filter(([id]) => next.nodes[id]));
  return { ok: true, code: next, names: nn, select: variant,
    note: `Removed the field ${nameOf(names, field)}.${calls.length ? ` Its value was dropped from ${calls.length} place${calls.length === 1 ? "" : "s"} making ${nameOf(names, variant)}.` : ""}` };
}

export function setFieldType(code: Code, names: Names, field: Id, t: TypeSpec): Top {
  const f = code.nodes[field] as NodeOf<"field">;
  const { nodes, add } = builder(code);
  nodes[field] = { ...f, type: buildType(add, t) };
  return { ok: true, code: collect({ nodes, defs: code.defs }), names, select: field, note: `Changed the type of ${nameOf(names, field)}.` };
}

// Data types a field can hold, for a picker: the builtin types, every data
// type without parameters, and the type being edited (recursion).
export function fieldTypes(code: Code, type: Id): TypeSpec[] {
  const simple = (target: Id): TypeSpec => ({ target, args: [] });
  const out: TypeSpec[] = [simple("type.number"), simple("type.string")];
  for (const d of code.defs) {
    const n = code.nodes[d];
    const b = n?.kind === "def" && n.body ? code.nodes[n.body] : null;
    if (b?.kind === "typedef" && b.params.length === 0) out.push(simple(d));
  }
  const list = code.defs.find((d) => d === "std.list");
  return list ? [...out, ...out.map((t) => ({ target: list, args: [t] }))] : out;
}
