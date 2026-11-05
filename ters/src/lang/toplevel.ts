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

import type { Code, Id, Node, NodeData, NodeOf, Use } from "../model.ts";
import { conditionResults, isUse, useTarget, isCall, type Call, bindsOf } from "../model.ts";
import { children, collect, freshId, ownerOfTypeParts, parentAt, parentOf, replace, subtree } from "../model.ts";
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
const ownerName = (code: Code, names: Names, id: Id) => code.nodes[id]?.kind === "lambda" ? "this function" : nameOf(names, id);

function nameTaken(code: Code, names: Names, name: string, except?: Id): boolean {
  return code.defs.some((d) => d !== except && names[d] === name);
}

// Two things with one name in the same place read ambiguously in every
// view: two definitions in a program, two variables in a definition, two
// cases of a type, two fields of a case. The reason a rename to `name`
// would do that, or null. `_` is "not used", so any number may share it.
export function nameClash(code: Code, names: Names, id: Id, rawName: string): string | null {
  const name = trim(rawName);
  const n = code.nodes[id];
  if (!name || name === "_" || !n) return null;
  if (n.kind === "def") return nameTaken(code, names, name, id) ? `there is already a definition named ${name}` : null;
  const def = ownerOfTypeParts(code).get(id) ?? code.defs.find((d) => subtree(code, d).includes(id));
  if (!def) return null;
  const peers = n.kind === "field"
    ? Object.values(code.nodes).find((v): v is NodeOf<"variant"> => v.kind === "variant" && v.fields.includes(id))?.fields ?? []
    : n.kind === "binder" ? scopesWith(code, def, id)
    : subtree(code, def).filter((o) => code.nodes[o]?.kind === n.kind);
  if (!peers.some((o) => o !== id && names[o] === name)) return null;
  const what = n.kind === "binder" ? "variable" : n.kind === "variant" ? "case" : "field";
  return `${nameOf(names, def)} already has a ${what} named ${name}; two would read the same`;
}

// Every variable that is in scope together with `binder` somewhere in the
// definition. Cases of a match each have their own, so `l` in one case and
// `l` in the next don't meet.
function scopesWith(code: Code, def: Id, binder: Id): Id[] {
  const out = new Set<Id>();
  const walk = (id: Id, scope: Id[]) => {
    const x = code.nodes[id];
    if (!x) return;
    const fresh = x.kind === "lambda" ? x.params
      : x.kind === "arm" ? [...x.binds, ...x.results.filter((r): r is Id => r !== null)]
      : isUse(x) ? Object.values(bindsOf(x))
      : x.kind === "typedef" ? x.params : [];
    const inner = fresh.length ? [...scope, ...fresh] : scope;
    if (inner.includes(binder)) inner.forEach((b) => out.add(b));
    for (const c of children(x)) walk(c, inner);
  };
  walk(def, []);
  return [...out];
}

const refsTo = (code: Code, target: Id) => Object.values(code.nodes).filter((n): n is NodeOf<"ref"> => n.kind === "ref" && n.target === target);
const callsOf = (code: Code, target: Id) => Object.values(code.nodes).filter((n): n is Call => {
  if (!isCall(n)) return false;
  if (n.fn === target) return true;
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
  | { kind: "type"; firstCase: string }
  // An effect is declared like a data type whose cases are its operations
  // (model.ts): the first one takes nothing and answers nothing until said.
  | { kind: "effect"; firstOperation: string }
  // An interface (INTERFACES.md) is a record of operations over one type a:
  // the first one takes an a and gives one back, until its type is changed.
  | { kind: "interface"; firstOperation: string };

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
  } else if (shape.kind === "interface") {
    const a = add({ kind: "binder" });
    nn[a] = "a";
    const op = add({ kind: "field", type: add({ kind: "tfun", params: [add({ kind: "tref", target: a, args: [] })], result: add({ kind: "tref", target: a, args: [] }) }) });
    nn[op] = trim(shape.firstOperation) || "operation";
    const variant = add({ kind: "variant", fields: [op] });
    nn[variant] = name.toLowerCase();
    body = add({ kind: "typedef", params: [a], variants: [variant], interface: true });
    select = op;
  } else {
    const effect = shape.kind === "effect";
    const first = trim(effect ? shape.firstOperation : shape.firstCase) || name.toLowerCase();
    const variant = add({ kind: "variant", fields: [] });
    nn[variant] = first;
    body = add({ kind: "typedef", params: [], variants: [variant], ...(effect ? { effect: true as const } : {}) });
    select = variant;
  }
  const def = add({ kind: "def", body });
  nn[def] = name;
  const what = shape.kind === "interface" ? `an interface with one operation, ${nn[select]}, from an a to an a: a type implements it by saying what each operation does there`
    : shape.kind === "type" ? "a data type with one case"
    : shape.kind === "effect" ? "an effect with one operation: calling it performs it, and a match on what performs it handles it"
    : shape.kind === "value" ? "a value: fill its hole" : `a function of ${shape.params.length || "no"} input${shape.params.length === 1 ? "" : "s"}: fill its hole`;
  return { ok: true, code: { nodes, defs: [...code.defs, def] }, names: nn, select: shape.kind === "type" || shape.kind === "effect" || shape.kind === "interface" ? def : select, note: `New definition ${name}, ${what}.` };
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
  // What's left is worked out when the edit is made, not when its button
  // is drawn: the editor's panel asks for every definition it shows, and
  // collecting the program on the library is ~60 ms (I167).
  let next: Code | undefined, nn: Names | undefined;
  const left = () => (next ??= collect({ nodes: code.nodes, defs }));
  return { ok: true, get code() { return left(); }, get names() { return (nn ??= Object.fromEntries(Object.entries(names).filter(([id]) => left().nodes[id]))); }, select: defs.find((d) => !d.startsWith("std.") && !d.startsWith("builtin")) ?? defs[0], note: `Deleted ${nameOf(names, def)}. Nothing used it.` };
}

// ---------------------------------------------------------------- parameters

// The input edits take a definition, or a function written inside a body
// (a lambda passed to map, say). Its inputs change the same way; what it's
// passed to has to take the new shape, or the type check refuses the edit.
const lambdaOf = (code: Code, def: Id): NodeOf<"lambda"> | null => {
  const d = code.nodes[def];
  if (d?.kind === "lambda") return d;
  const b = d?.kind === "def" && d.body ? code.nodes[d.body] : null;
  return b?.kind === "lambda" ? b : null;
};

// The solves that run `def` backwards.
const solvesOf = (code: Code, def: Id) => Object.values(code.nodes).filter((n): n is Use => isUse(n) && useTarget(code.nodes, n) === def);

export function addParameter(code: Code, names: Names, def: Id, rawName: string): Top {
  const d = code.nodes[def] as NodeOf<"def">;
  const name = trim(rawName) || "input";
  const lam = lambdaOf(code, def);
  if (lam?.params.some((p) => names[p] === name)) return { ok: false, reason: `${ownerName(code, names, def)} already has an input named ${name}` };
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
  // A solve of it is a call run backwards: the new input is given there too,
  // as a hole, so what it solves for stays as determined as it was.
  const solves = solvesOf(code, def);
  for (const sv of solves) nodes[sv.id] = { ...sv, given: { ...sv.given, [b]: add({ kind: "hole" }) } };
  const places = calls.length + solves.length;
  return { ok: true, code: { nodes, defs: code.defs }, names: nn, select: b,
    note: `Added the input ${name}.${places ? ` ${places} ${places === 1 ? "use" : "uses"} got a hole for it, so none is missing an argument.` : ""}` };
}

// A definition with no inputs is an action, () -> T, run where it's
// called; one without a function is a value, computed once (E181). Each
// turns into the other: an action's calls symbols() read symbols, and
// where it was passed whole it's () => symbols; a value's reads become
// calls. Whether the program still checks (an action that does Console
// isn't a value) is the type check's to say.
export function toggleValue(code: Code, names: Names, def: Id): Top {
  const d = code.nodes[def];
  if (d?.kind !== "def" || !d.body) return { ok: false, reason: "that isn't a definition with a body" };
  const body = code.nodes[d.body];
  if (body.kind === "typedef") return { ok: false, reason: "only a value or a function can change" };
  if (body.kind === "lambda" && (body.params.length || body.results?.length)) return { ok: false, reason: `${nameOf(names, def)} has inputs; only one with none can be a value` };
  const { nodes, add } = builder(code);
  const own = new Set(subtree(code, def));
  const calls = Object.values(code.nodes).filter((n): n is Call => isCall(n) && !n.args.length && code.nodes[n.fn]?.kind === "ref" && (code.nodes[n.fn] as NodeOf<"ref">).target === def);
  const called = new Set(calls.map((c) => c.fn));
  if (body.kind === "lambda") {
    nodes[def] = { ...d, body: body.body };
    for (const c of calls) nodes[c.id] = { id: c.id, kind: "ref", target: def };
    for (const r of refsTo(code, def)) if (!called.has(r.id) && !own.has(r.id)) nodes[r.id] = { id: r.id, kind: "lambda", params: [], body: add({ kind: "ref", target: def }) };
    const next = collect({ nodes, defs: code.defs });
    return { ok: true, code: next, names, select: def, note: `${nameOf(names, def)} is a value now, computed once.${calls.length ? ` ${calls.length} call${calls.length === 1 ? " reads" : "s read"} it.` : ""}` };
  }
  nodes[def] = { ...d, body: add({ kind: "lambda", params: [], body: d.body }) };
  const reads = refsTo(code, def).filter((r) => !own.has(r.id));
  for (const r of reads) nodes[r.id] = { id: r.id, kind: "call", fn: add({ kind: "ref", target: def }), args: [] };
  return { ok: true, code: { nodes, defs: code.defs }, names, select: def, note: `${nameOf(names, def)} is an action now, run where it's called.${reads.length ? ` ${reads.length} read${reads.length === 1 ? " calls" : "s call"} it.` : ""}` };
}

// With `leaveHoles`, a used input goes too: each use becomes a hole.
export function removeParameter(code: Code, names: Names, def: Id, param: Id, leaveHoles = false): Top {
  const lam = lambdaOf(code, def);
  const i = lam ? lam.params.indexOf(param) : -1;
  if (!lam || i < 0) return { ok: false, reason: `that isn't one of ${ownerName(code, names, def)}'s inputs` };
  const uses = refsTo(code, param);
  if (uses.length && !leaveHoles) return { ok: false, reason: `${nameOf(names, param)} is used ${uses.length === 1 ? "once" : `${uses.length} times`} in the body; clear those first` };
  const nodes = { ...code.nodes };
  for (const r of uses) nodes[r.id] = { id: r.id, kind: "hole" };
  nodes[lam.id] = { ...lam, params: lam.params.filter((p) => p !== param) };
  const calls = callsOf(code, def);
  for (const c of calls) nodes[c.id] = { ...c, args: c.args.filter((_, j) => j !== i) };
  for (const sv of solvesOf(code, def)) {
    if (param in bindsOf(sv)) return { ok: false, reason: `${nameOf(names, param)} is what a solve of ${nameOf(names, def)} works out; remove that solve first` };
    const { [param]: _, ...given } = sv.given;
    nodes[sv.id] = { ...sv, given };
  }
  // Collected when the edit is made, not when its button is drawn (I167).
  let next: Code | undefined;
  const nn = { ...names };
  delete nn[param];
  return { ok: true, get code() { return (next ??= collect({ nodes, defs: code.defs })); }, names: nn, select: uses[0]?.id ?? def,
    note: `Removed the input ${nameOf(names, param)}.${uses.length ? ` ${uses.length === 1 ? "Its use is a hole now" : `Its ${uses.length} uses are holes now`}.` : ""}${calls.length ? ` Its argument was dropped from ${calls.length} call${calls.length === 1 ? "" : "s"}.` : ""}` };
}

export function moveParameter(code: Code, names: Names, def: Id, param: Id, by: -1 | 1): Top {
  const lam = lambdaOf(code, def);
  const i = lam ? lam.params.indexOf(param) : -1;
  const j = i + by;
  if (!lam || i < 0) return { ok: false, reason: `that isn't one of ${ownerName(code, names, def)}'s inputs` };
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

// An interface's new operation: n inputs of its type a, giving an a or a
// type of its own. Every implementation gets a hole for it.
export function addOperation(code: Code, names: Names, iface: Id, rawName: string, inputs: number, result: Id | null): Top {
  const td = typedefOf(code, iface);
  if (!td.interface) return { ok: false, reason: "only an interface has operations of this kind" };
  const a = td.params[0];
  const r = addField(code, names, iface, td.variants[0], rawName || "operation", (add) => add({ kind: "tfun", params: Array.from({ length: inputs }, () => add({ kind: "tref", target: a, args: [] })), result: add({ kind: "tref", target: result ?? a, args: [] }) }));
  if (!r.ok) return r;
  const made = callsOf(code, td.variants[0]).length;
  return { ...r, note: `Added the operation ${r.names[r.select]} to ${nameOf(names, iface)}.${made ? ` ${made} implementation${made === 1 ? "" : "s"} got a hole for it.` : ""}` };
}

// An operation's inputs and what it gives, changed (BACKLOG E142). What each
// implementation had for it was written for the old type, so it becomes a
// hole there, to write again.
export function setOperation(code: Code, names: Names, iface: Id, field: Id, inputs: number, result: Id | null): Top {
  const td = typedefOf(code, iface);
  if (!td.interface) return { ok: false, reason: "only an interface has operations of this kind" };
  const v = code.nodes[td.variants[0]] as NodeOf<"variant">;
  const at = v.fields.indexOf(field);
  if (at < 0) return { ok: false, reason: "that isn't one of its operations" };
  const a = td.params[0];
  const { nodes, add } = builder(code);
  nodes[field] = { ...(code.nodes[field] as NodeOf<"field">), type: add({ kind: "tfun", params: Array.from({ length: inputs }, () => add({ kind: "tref", target: a, args: [] })), result: add({ kind: "tref", target: result ?? a, args: [] }) }) };
  let redo = 0;
  for (const c of callsOf(code, v.id)) {
    if (code.nodes[c.args[at]]?.kind === "hole") continue;
    nodes[c.id] = { ...c, args: c.args.map((x, i) => (i === at ? add({ kind: "hole" }) : x)) };
    redo++;
  }
  return { ok: true, code: collect({ nodes, defs: code.defs }), names, select: field,
    note: `Changed what ${nameOf(names, field)} takes and gives.${redo ? ` ${redo} implementation${redo === 1 ? "" : "s"} have a hole for it again, to write for the new type.` : ""}` };
}

export function addField(code: Code, names: Names, type: Id, variant: Id, rawName: string, t: TypeSpec | ((add: (n: NodeData) => Id) => Id)): Top {
  const v = code.nodes[variant] as NodeOf<"variant">;
  if (!typedefOf(code, type).variants.includes(variant)) return { ok: false, reason: "that isn't a case of this type" };
  const name = trim(rawName) || "field";
  const { nodes, add } = builder(code);
  const nn: Names = { ...names };
  const field = add({ kind: "field", type: typeof t === "function" ? t(add) : buildType(add, t) });
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
  const recursive = typeof t !== "function" && isRecursive(code, type, t);
  let arms = 0;
  for (const n of Object.values(code.nodes)) {
    if (n.kind !== "arm" || n.variant !== variant) continue;
    const b = add({ kind: "binder" });
    nn[b] = name;
    const inFold = Object.values(code.nodes).some((m) => m.kind === "fold" && m.arms.includes(n.id));
    let r: Id | null = null;
    if (inFold && recursive) { r = add({ kind: "binder" }); nn[r] = `${name}′`; }
    // An operation answered later keeps the rest last (ANSWERED-LATER.md).
    const at = v.later && v.returns && n.binds.length === v.fields.length + 1 ? n.binds.length - 1 : n.binds.length;
    nodes[n.id] = { ...n, binds: n.binds.toSpliced(at, 0, b), results: n.results.toSpliced(at, 0, r) };
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

// What a handler answers an operation with (the value the call gives
// back), or nothing: an operation that never returns ends what it's
// performed in, like abort.
export function setReturns(code: Code, names: Names, variant: Id, t: TypeSpec | null): Top {
  const v = code.nodes[variant];
  if (v?.kind !== "variant") return { ok: false, reason: "that isn't an operation" };
  if (!t && v.later) return { ok: false, reason: `${nameOf(names, variant)} is answered later: make it answered at once first` };
  const { nodes, add } = builder(code);
  const { returns: _, ...rest } = v;
  nodes[variant] = t ? { ...rest, returns: buildType(add, t) } : rest;
  return { ok: true, code: collect({ nodes, defs: code.defs }), names, select: variant, note: t ? `${nameOf(names, variant)} now gives back what its handler answers.` : `${nameOf(names, variant)} now never returns: it ends what performs it.` };
}

// An operation answered later, or at once (ANSWERED-LATER.md): later, a
// handler's case also gets the rest of the computation, after the
// operation's inputs, to resume once, now or later, or drop. Every case
// that handles it gets a name for the rest, or loses it; one that uses its
// rest keeps the operation later.
// A case made private (L79, E209): only the program that declares the
// type builds it (L165), and code that uses the type goes through its
// functions. Data types only: an effect's operations and an interface's
// are performed or implemented, not built.
export function setPrivate(code: Code, names: Names, variant: Id, on: boolean): Top {
  const v = code.nodes[variant];
  if (v?.kind !== "variant") return { ok: false, reason: "that isn't a case of a type" };
  const type = Object.values(code.nodes).find((t) => t.kind === "typedef" && t.variants.includes(variant)) as NodeOf<"typedef"> | undefined;
  if (type?.effect || type?.interface) return { ok: false, reason: `${nameOf(names, variant)} is ${type.effect ? "an operation of an effect" : "an interface's"}: only a data type's cases are private` };
  if (!!v.private === on) return { ok: false, reason: `${nameOf(names, variant)} is ${on ? "private" : "public"} already` };
  const { private: _, ...open } = v;
  return { ok: true, code: { nodes: { ...code.nodes, [variant]: on ? { ...v, private: true } : open }, defs: code.defs }, names, select: variant,
    note: on ? `${nameOf(names, variant)} is private: this program builds it, and a program that uses the type builds one with this program's functions.` : `${nameOf(names, variant)} is public: anyone may build it.` };
}

export function setLater(code: Code, names: Names, variant: Id, on: boolean): Top {
  const v = code.nodes[variant];
  if (v?.kind !== "variant") return { ok: false, reason: "that isn't an operation" };
  if (on && !v.returns) return { ok: false, reason: `${nameOf(names, variant)} never returns, so there is no rest to answer later` };
  if (!!v.later === on) return { ok: false, reason: `${nameOf(names, variant)} is answered ${on ? "later" : "at once"} already` };
  const nodes = { ...code.nodes };
  const nn: Names = { ...names };
  const { later: _, ...now } = v;
  nodes[variant] = on ? { ...v, later: true } : now;
  let arms = 0;
  for (const n of Object.values(code.nodes)) {
    if (n.kind !== "arm" || n.variant !== variant) continue;
    if (on) {
      const b = freshId();
      nodes[b] = { id: b, kind: "binder" };
      nn[b] = "rest";
      nodes[n.id] = { ...n, binds: [...n.binds, b], results: [...n.results, null] };
    } else {
      const rest = n.binds.at(-1)!;
      if (n.binds.length !== v.fields.length + 1) continue;
      if (Object.values(code.nodes).some((m) => m.kind === "ref" && m.target === rest)) return { ok: false, reason: `a case of ${nameOf(names, variant)} uses its rest: take that out first` };
      delete nodes[rest];
      nodes[n.id] = { ...n, binds: n.binds.slice(0, -1), results: n.results.slice(0, -1) };
    }
    arms++;
  }
  const cases = arms ? ` ${arms} case${arms === 1 ? "" : "s"} handling it ${on ? "got a name for the rest" : "lost the rest"}.` : "";
  return { ok: true, code: { nodes, defs: code.defs }, names: nn, select: variant,
    note: on ? `${nameOf(names, variant)} is answered later now: its handler's case gets the rest of the computation, to resume once, now or later, or drop, and gives what the handler gives.${cases}` : `${nameOf(names, variant)} is answered at once now.${cases}` };
}

export function setFieldType(code: Code, names: Names, field: Id, t: TypeSpec): Top {
  const f = code.nodes[field] as NodeOf<"field">;
  const { nodes, add } = builder(code);
  nodes[field] = { ...f, type: buildType(add, t) };
  return { ok: true, code: collect({ nodes, defs: code.defs }), names, select: field, note: `Changed the type of ${nameOf(names, field)}.` };
}

// ------------------------------------------------------------------ ways

// A way of an interface's operation (WAYS.md, BACKLOG E210): an ordinary
// definition marked as one way of computing that operation from the
// others, `differ by equal = (a, b) => not(equal(a, b))`. Added with a
// hole for its body and an input for each of the operation's; the checker
// says what is wrong with one (nothing grounds, the wrong type), so no
// check here. Its cost is the compiler's to weigh against the others.
export function addWay(code: Code, names: Names, iface: Id, field: Id, rawName: string): Top {
  const td = typedefOf(code, iface);
  if (!td.interface) return { ok: false, reason: "only an interface's operations have ways" };
  if (!td.variants.some((v) => (code.nodes[v] as NodeOf<"variant">).fields.includes(field))) return { ok: false, reason: "that isn't one of its operations" };
  const op = nameOf(names, field);
  let name = trim(rawName);
  if (!name) for (let i = 1; !name || nameTaken(code, names, name); i++) name = `${op} by its way${i > 1 ? ` ${i}` : ""}`;
  if (nameTaken(code, names, name)) return { ok: false, reason: `there is already a definition named ${name}` };
  const t = code.nodes[(code.nodes[field] as NodeOf<"field">).type];
  const f = code.nodes[field] as NodeOf<"field">;
  const n = t?.kind === "tfun" ? t.params.length : 0;
  const { nodes, add } = builder(code);
  const nn: Names = { ...names };
  const params = Array.from({ length: n }, (_, i) => { const b = add({ kind: "binder" }); nn[b] = f.ports?.[i] ?? LETTERS[23 + i] ?? `input ${i + 1}`; return b; });
  const hole = add({ kind: "hole" });
  const def = add({ kind: "def", body: add({ kind: "lambda", params, body: hole }), way: field });
  nn[def] = name;
  return { ok: true, code: { nodes, defs: [...code.defs, def] }, names: nn, select: def,
    note: `New way of ${op}, ${name}: write ${op} from ${nameOf(names, iface)}'s other operations in its hole. An implementation can then leave ${op} to its ways.` };
}

// A way's cost (null: the usual, 1 plus what it uses), or a way made an
// ordinary definition again (way: null).
export function setWay(code: Code, names: Names, def: Id, way: { cost: number | null } | null): Top {
  const d = code.nodes[def];
  if (d?.kind !== "def" || !d.way) return { ok: false, reason: "that isn't a way of an operation" };
  if (way?.cost != null && !(Number.isFinite(way.cost) && way.cost >= 0)) return { ok: false, reason: "a cost is a number, 0 or more" };
  const { way: field, cost: _, ...plain } = d;
  const nodes = { ...code.nodes, [def]: way ? { ...plain, way: field, ...(way.cost != null ? { cost: way.cost } : {}) } : plain };
  return { ok: true, code: { nodes, defs: code.defs }, names, select: def,
    note: way ? `${nameOf(names, def)} costs ${way.cost ?? "the usual"}${way.cost != null ? " plus what it uses" : ""}.` : `${nameOf(names, def)} is an ordinary definition now, no longer a way of ${nameOf(names, field)}.` };
}

// A relation's other direction (POLAR.md, BACKLOG E210b): a definition of
// the same ports in the same order, these `results` given from the rest,
// marked `direction` of the relation, with a hole for the predicate. A
// solve of the relation given its inputs then calls it instead of a
// search. `results` are positions among the relation's ports.
export function addDirection(code: Code, names: Names, rel: Id, results: number[], rawName: string): Top {
  const r = code.nodes[rel];
  const lam = r?.kind === "def" && r.body ? code.nodes[r.body] : null;
  const rr = r?.kind === "def" ? conditionResults(code.nodes, rel) : undefined;
  if (r?.kind !== "def" || !rr?.length || lam?.kind !== "lambda") return { ok: false, reason: "only a definition with results has other directions" };
  const rs = [...new Set(results)].filter((i) => i >= 0 && i < lam.params.length).sort((a, b) => a - b);
  if (!rs.length || rs.length === lam.params.length) return { ok: false, reason: "a direction gives some of the ports from the others: pick at least one result and leave one input" };
  if (rs.length === rr.length && rs.every((i) => rr.includes(lam.params[i]))) return { ok: false, reason: `that is ${nameOf(names, rel)}'s own direction` };
  const port = (i: number) => nameOf(names, lam.params[i]);
  let name = trim(rawName);
  if (!name) for (let i = 1; !name || nameTaken(code, names, name); i++) name = `${nameOf(names, rel)} for ${rs.map(port).join(", ")}${i > 1 ? ` ${i}` : ""}`;
  if (nameTaken(code, names, name)) return { ok: false, reason: `there is already a definition named ${name}` };
  const { nodes, add } = builder(code);
  const nn: Names = { ...names };
  const params = lam.params.map((p) => { const b = add({ kind: "binder" }); nn[b] = names[p] ?? "port"; return b; });
  // Its body starts as one equation per result: `length = □ and angle = □`,
  // the hole for how each is worked out from the given ports.
  const eq = (i: number) => add({ kind: "call", fn: add({ kind: "ref", target: "builtin.equal" }), args: [add({ kind: "ref", target: params[i] }), add({ kind: "hole" })] });
  const body = rs.slice(1).reduce((acc, i) => add({ kind: "call", fn: add({ kind: "ref", target: "builtin.and" }), args: [acc, eq(i)] }), eq(rs[0]));
  const def = add({ kind: "def", body: add({ kind: "lambda", params, body, results: rs.map((i) => params[i]) }), direction: rel });
  nn[def] = name;
  return { ok: true, code: { nodes, defs: [...code.defs, def] }, names: nn, select: def,
    note: `New direction of ${nameOf(names, rel)}, ${name}: ${rs.map(port).join(", ")} from ${lam.params.map((_, i) => i).filter((i) => !rs.includes(i)).map(port).join(", ")}. Fill each result's hole with how it is worked out; a solve of ${nameOf(names, rel)} given those then uses it instead of searching.` };
}

// A direction made an ordinary definition again (it keeps its results).
export function dropDirection(code: Code, names: Names, def: Id): Top {
  const d = code.nodes[def];
  if (d?.kind !== "def" || !d.direction) return { ok: false, reason: "that isn't a direction of a relation" };
  const { direction, ...plain } = d;
  return { ok: true, code: { nodes: { ...code.nodes, [def]: plain }, defs: code.defs }, names, select: def,
    note: `${nameOf(names, def)} is an ordinary definition now, no longer a direction of ${nameOf(names, direction)}.` };
}

// ------------------------------------------------------- type parameters

// A data type's or an effect's type parameters (`Stack a`, `State s`), or
// an operation's own (`await : Ticket a → a`, model.ts), added and removed
// the way a function's inputs are (BACKLOG E198). The type's own uses of
// itself, in its fields, get the new parameter as their argument, so
// `Tree` holding a `Tree` becomes `Tree a` holding a `Tree a`. A use in
// another type's field would need an argument nobody chose, so that is
// refused with where; values of the type need nothing, their types are
// inferred.
const LETTERS = "abcdefghijklmnopqrstuvwxyz";
export function addTypeParameter(code: Code, names: Names, type: Id, rawName: string, variant?: Id): Top {
  const td = typedefOf(code, type);
  if (td.interface) return { ok: false, reason: "an interface takes one type, its a" };
  if (td.row) return { ok: false, reason: "a row of effects has no parameters" };
  const v = variant ? code.nodes[variant] : null;
  if (variant && (v?.kind !== "variant" || !td.variants.includes(variant))) return { ok: false, reason: "that isn't one of its operations" };
  const taken = [...td.params, ...((v as NodeOf<"variant"> | null)?.params ?? [])].map((p) => names[p]);
  const name = trim(rawName) || [...LETTERS].find((x) => !taken.includes(x)) || "t";
  if (!/^[a-z][A-Za-z0-9_']*$/.test(name)) return { ok: false, reason: `a type parameter is written in lower case, like a or item (not ${name})` };
  if (taken.includes(name)) return { ok: false, reason: `${nameOf(names, variant ?? type)} already has a type parameter named ${name}` };
  const { nodes, add } = builder(code);
  const nn: Names = { ...names };
  const b = add({ kind: "binder" });
  nn[b] = name;
  if (variant) {
    const op = v as NodeOf<"variant">;
    nodes[variant] = { ...op, params: [...(op.params ?? []), b] };
    return { ok: true, code: { nodes, defs: code.defs }, names: nn, select: variant,
      note: `${nameOf(names, variant)} has its own type ${name} now, fresh at each call: give an input or what it gives back the type ${name}.` };
  }
  const own = new Set(subtree(code, type));
  const uses = Object.values(code.nodes).filter((n): n is NodeOf<"tref"> => n.kind === "tref" && n.target === type);
  const outside = uses.filter((u) => !own.has(u.id));
  if (outside.length) {
    const owners = defOwners(code);
    const where = [...new Set(outside.map((u) => owners.get(u.id)).filter((d): d is Id => !!d))].map((d) => nameOf(names, d));
    return { ok: false, reason: `${nameOf(names, type)} is named in the types of ${list(where) || "other code"}, which would need an argument for ${name}; change those first` };
  }
  nodes[td.id] = { ...td, params: [...td.params, b] };
  for (const u of uses) nodes[u.id] = { ...u, args: [...u.args, add({ kind: "tref", target: b, args: [] })] };
  return { ok: true, code: { nodes, defs: code.defs }, names: nn, select: type,
    note: `${nameOf(names, type)} takes a type ${name} now: a field can hold an ${name}.${uses.length ? ` Its ${uses.length === 1 ? "use" : `${uses.length} uses`} of itself became ${nameOf(names, type)} ${[...td.params, b].map((p) => nn[p] ?? "?").join(" ")}.` : ""}` };
}

export function removeTypeParameter(code: Code, names: Names, type: Id, param: Id): Top {
  const td = typedefOf(code, type);
  const op = td.variants.map((v) => code.nodes[v] as NodeOf<"variant">).find((v) => v.params?.includes(param));
  const at = td.params.indexOf(param);
  if (at < 0 && !op) return { ok: false, reason: "that isn't one of its type parameters" };
  if (td.interface) return { ok: false, reason: "an interface takes one type, its a" };
  // The type's own uses of itself pass it on (`Tree a` in Tree a): those go with it.
  const passed = new Set(at < 0 ? [] : Object.values(code.nodes).flatMap((n) => n.kind === "tref" && n.target === type && n.args[at] ? [n.args[at]] : []));
  const used = Object.values(code.nodes).some((n) => n.kind === "tref" && n.target === param && !passed.has(n.id));
  if (used) return { ok: false, reason: `a type in ${nameOf(names, type)} still names ${nameOf(names, param)}; change it first` };
  const nodes = { ...code.nodes };
  if (op) {
    const rest = op.params!.filter((p) => p !== param);
    const { params: _, ...bare } = op;
    nodes[op.id] = rest.length ? { ...op, params: rest } : bare;
  } else {
    nodes[td.id] = { ...td, params: td.params.filter((p) => p !== param) };
    for (const n of Object.values(code.nodes)) if (n.kind === "tref" && n.target === type && n.args.length > at) nodes[n.id] = { ...n, args: n.args.filter((_, i) => i !== at) };
  }
  const next = collect({ nodes, defs: code.defs });
  const nn = Object.fromEntries(Object.entries(names).filter(([id]) => next.nodes[id]));
  return { ok: true, code: next, names: nn, select: op?.id ?? type, note: `Removed the type parameter ${nameOf(names, param)}.` };
}

// What a field's type can start with, for a picker that then asks for
// each argument the same way: the builtin types, the type's own parameters,
// and every data type with how many arguments it takes (Bool, List, Pair,
// Optional, the program's own, and the type being edited, for recursion).
// An operation (`variant`) adds its own type parameters.
export function typeHeads(code: Code, type: Id, variant?: Id): { target: Id; arity: number }[] {
  const own = variant ? (code.nodes[variant] as NodeOf<"variant"> | undefined)?.params ?? [] : [];
  const out = ["type.number", "type.int", "type.string", ...typedefOf(code, type).params, ...own].map((target) => ({ target, arity: 0 }));
  for (const d of code.defs) {
    const n = code.nodes[d];
    const b = n?.kind === "def" && n.body ? code.nodes[n.body] : null;
    if (b?.kind === "typedef" && !b.effect) out.push({ target: d, arity: b.params.length });
  }
  return out;
}

// ---------------------------------------------------------------- step order

// An action's steps are a chain of lets: do v1, then (b1 bound to its value)
// do v2, …, then the last step, whose value is the action's. The let of a
// value: the call that applies a one-input function to it, if it is one.
// Both read `code` only, so its parent index serves (model.ts parentAt).
function letOf(code: Code, value: Id): { call: Call; lam: NodeOf<"lambda"> } | null {
  const at = parentAt(code, value);
  const call = at?.slot === "args" ? code.nodes[at.parent] : null;
  if (!isCall(call) || call.args.length !== 1) return null;
  const lam = code.nodes[call.fn];
  return lam?.kind === "lambda" && lam.params.length === 1 ? { call, lam } : null;
}
// The let whose function's body is `id`: the step before it.
function letAround(code: Code, id: Id): { call: Call; lam: NodeOf<"lambda"> } | null {
  const at = parentAt(code, id);
  const lam = at?.slot === "body" ? code.nodes[at.parent] : null;
  if (lam?.kind !== "lambda" || lam.params.length !== 1) return null;
  const by = parentAt(code, lam.id);
  const call = by?.slot === "fn" ? code.nodes[by.parent] : null;
  return isCall(call) && call.args.length === 1 ? { call, lam } : null;
}
const mentions = (code: Code, root: Id, b: Id) => subtree(code, root).some((id) => { const n = code.nodes[id]; return n.kind === "ref" && n.target === b; });

// Move a step of an action one place earlier or later. Each value keeps its
// name; a step can't move before the step whose value it uses, or after the
// last one while something uses its own. Whether the action still has its
// type (the last step's value is its value) is the type check's to say.
export function moveStep(code: Code, names: Names, step: Id, by: -1 | 1): Top {
  const self = letOf(code, step);
  // The pair to swap: an outer let and what its function's body does next.
  let outer: { call: Call; lam: NodeOf<"lambda"> } | null;
  if (by < 0) outer = self ? letAround(code, self.call.id) : letAround(code, step);
  else outer = self;
  if (!self && !letAround(code, step)) return { ok: false, reason: "it isn't a step of an action" };
  if (!outer) return { ok: false, reason: by < 0 ? "it's already the first step" : "it's already the last step" };
  const nodes = { ...code.nodes };
  const v0 = outer.call.args[0], b0 = outer.lam.params[0];
  const inner = code.nodes[outer.lam.body];
  const next = isCall(inner) ? letOf(code, inner.args[0] ?? "") : null;
  if (next && next.call.id === inner.id) {
    // Two lets: swap their bindings. The later value can't use the earlier's.
    const v1 = next.call.args[0], b1 = next.lam.params[0];
    if (mentions(code, v1, b0)) return { ok: false, reason: `it uses ${nameOf(names, b0)}, which the step before it makes` };
    nodes[outer.call.id] = { ...outer.call, args: [v1] };
    nodes[outer.lam.id] = { ...outer.lam, params: [b1] };
    nodes[next.call.id] = { ...next.call, args: [v0] };
    nodes[next.lam.id] = { ...next.lam, params: [b0] };
  } else {
    // A let and the last step: the last step's value is the action's, so
    // the let's own value becomes it; nothing may use that value by name.
    if (refsTo(code, b0).length) return { ok: false, reason: `${nameOf(names, b0)} is used after it; the last step's value is the action's` };
    nodes[outer.call.id] = { ...outer.call, args: [outer.lam.body] };
    nodes[outer.lam.id] = { ...outer.lam, body: v0 };
  }
  return { ok: true, code: { nodes, defs: code.defs }, names, select: step, note: `Moved the step ${by < 0 ? "earlier" : "later"}.` };
}
