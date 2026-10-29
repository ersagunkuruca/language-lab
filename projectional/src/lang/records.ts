// Record updates. A field of a one-case type is its projection; `set` runs a
// projection (or a path of them, p ↦ p.address.city) backwards, keeping
// every other field of the record it's given. That is a lens, derived from
// the projections rather than written (REVIEW.md §5.3). The checker accepts
// only a field or a path of fields, so every update has exactly one answer.

import { ownerOfTypeParts, type Code, type Id, type NodeOf } from "../model.ts";

// The fields `id` reads, outermost first, if it is a field or a lambda of
// one parameter that only takes fields of it; otherwise null. With
// `unfinished`, holes are allowed where the path isn't written yet.
export function fieldPath(code: Code, id: Id, unfinished = false): Id[] | null {
  const n = code.nodes[id];
  if (unfinished && n?.kind === "hole") return [];
  if (n?.kind === "ref" && code.nodes[n.target]?.kind === "field") return [n.target];
  if (n?.kind !== "lambda" || n.params.length !== 1) return null;
  const path: Id[] = [];
  let e = code.nodes[n.body];
  while (e?.kind === "call" && e.args.length === 1) {
    const head = code.nodes[e.fn];
    if (unfinished && head?.kind === "hole") { e = code.nodes[e.args[0]]; continue; }
    if (head?.kind !== "ref" || code.nodes[head.target]?.kind !== "field") return null;
    path.unshift(head.target);
    e = code.nodes[e.args[0]];
  }
  if (unfinished && e?.kind === "hole") return path;
  return path.length && e?.kind === "ref" && e.target === n.params[0] ? path : null;
}

// A place for `path` (L98): a field or a path of fields as for `set`, or
// the parameter itself, (t) ↦ t, for the whole value ([]).
export function placePath(code: Code, id: Id, unfinished = false): Id[] | null {
  const n = code.nodes[id];
  if (n?.kind === "lambda" && n.params.length === 1) {
    const body = code.nodes[n.body];
    if (body?.kind === "ref" && body.target === n.params[0]) return [];
  }
  return fieldPath(code, id, unfinished);
}

// Whether a field is an interface's operation (INTERFACES.md): `sin(x)`,
// not a field read `x.sin`.
const operations = new WeakMap<Code, Set<Id>>();
export function isOperation(code: Code, field: Id): boolean {
  let ops = operations.get(code);
  if (!ops) {
    ops = new Set();
    for (const n of Object.values(code.nodes)) if (n.kind === "typedef" && n.interface) for (const v of n.variants) for (const f of (code.nodes[v] as NodeOf<"variant">).fields) ops.add(f);
    operations.set(code, ops);
  }
  return ops.has(field);
}

// The operations an interface's record is built from, when `fn` names its
// constructor: an implementation is that call, one argument per operation.
const cases = new WeakMap<Code, Map<Id, Id[]>>();
export function implementationOps(code: Code, fn: Id): Id[] | null {
  const f = code.nodes[fn];
  if (f?.kind !== "ref") return null;
  let m = cases.get(code);
  if (!m) {
    m = new Map();
    for (const n of Object.values(code.nodes)) if (n.kind === "typedef" && n.interface) for (const v of n.variants) m.set(v, (code.nodes[v] as NodeOf<"variant">).fields);
    cases.set(code, m);
  }
  return m.get(f.target) ?? null;
}

// Where each field sits in its record.
const indexes = new WeakMap<Code, Map<Id, number>>();
export function fieldIndex(code: Code, field: Id): number {
  let m = indexes.get(code);
  if (!m) indexes.set(code, (m = new Map()));
  if (!m.has(field)) {
    const def = ownerOfTypeParts(code).get(field)!;
    const variant = (code.nodes[(code.nodes[def] as NodeOf<"def">).body!] as NodeOf<"typedef">).variants[0];
    m.set(field, (code.nodes[variant] as NodeOf<"variant">).fields.indexOf(field));
  }
  return m.get(field)!;
}

// The record with the value at `path` (field positions) replaced. Only the
// records on the path are copied.
export function setPath<D extends { tag: Id; fields: unknown[] }>(record: D, path: number[], value: unknown): D {
  if (!path.length) return value as D;
  const fields = record.fields.slice();
  fields[path[0]] = setPath(fields[path[0]] as D, path.slice(1), value);
  return { ...record, fields };
}
