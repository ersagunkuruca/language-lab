// Record updates. A field of a one-case type is its projection; `set` runs a
// projection (or a path of them, p ↦ p.address.city) backwards, keeping
// every other field of the record it's given. That is a lens, derived from
// the projections rather than written (REVIEW.md §5.3). The checker accepts
// only a field or a path of fields, so every update has exactly one answer.

import { ownerOfTypeParts, type Code, type Id, type NodeOf } from "../model.ts";

// The fields `id` reads, outermost first, if it is a field or a lambda of
// one parameter that only takes fields of it; otherwise null.
export function fieldPath(code: Code, id: Id): Id[] | null {
  const n = code.nodes[id];
  if (n?.kind === "ref" && code.nodes[n.target]?.kind === "field") return [n.target];
  if (n?.kind !== "lambda" || n.params.length !== 1) return null;
  const path: Id[] = [];
  let e = code.nodes[n.body];
  while (e?.kind === "call" && e.args.length === 1) {
    const head = code.nodes[e.fn];
    if (head?.kind !== "ref" || code.nodes[head.target]?.kind !== "field") return null;
    path.unshift(head.target);
    e = code.nodes[e.args[0]];
  }
  return path.length && e?.kind === "ref" && e.target === n.params[0] ? path : null;
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
