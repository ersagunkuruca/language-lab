// Record updates. A field of a one-case type is its projection; `set` runs a
// projection (or a path of them, p ↦ p.address.city) backwards, keeping
// every other field of the record it's given. That is a lens, derived from
// the projections rather than written (REVIEW.md §5.3). The checker accepts
// only a field or a path of fields, so every update has exactly one answer.

import { children, ownerOfTypeParts, type Code, type Id, type NodeOf, isCall, type Call } from "../model.ts";

// The fields `id` reads, outermost first, if it is a field or a lambda of
// one parameter that only takes fields of it; otherwise null. With
// `unfinished`, holes are allowed where the path isn't written yet.
export function fieldPath(code: Code, id: Id, unfinished = false): Id[] | null {
  const n = code.nodes[id];
  if (unfinished && n?.kind === "hole") return [];
  if (n?.kind === "ref" && code.nodes[n.target]?.kind === "field") return [n.target];
  if (n?.kind !== "lambda" || n.params.length !== 1) return null;
  return pathFrom(code, n.body, n.params[0], unfinished);
}

// The fields `body` reads from `param`, outermost first: p.address.city is
// [address, city]. Null unless it is only fields of the parameter.
function pathFrom(code: Code, body: Id, param: Id, unfinished: boolean): Id[] | null {
  const path: Id[] = [];
  let e = code.nodes[body];
  while (isCall(e) && e.args.length === 1) {
    const head = code.nodes[e.fn];
    if (unfinished && head?.kind === "hole") { e = code.nodes[e.args[0]]; continue; }
    if (head?.kind !== "ref" || code.nodes[head.target]?.kind !== "field") return null;
    path.unshift(head.target);
    e = code.nodes[e.args[0]];
  }
  if (unfinished && e?.kind === "hole") return path;
  return path.length && e?.kind === "ref" && e.target === param ? path : null;
}

// Several fields changed at once (BACKLOG L167): `set((m) ↦ (m.pc,
// m.registers), machine, (pc, registers))`. The path is a tuple of paths
// from the one parameter, and the value a tuple of as many. No field is
// named twice and none is inside another (m.home and m.home.city), so the
// update still has exactly one answer, whatever order the parts are put
// in. Each path, outermost first; null when it isn't such a tuple.
const TUPLE = /^std\.tuple[2-8]\.tuple$/;
export function fieldPaths(code: Code, id: Id, unfinished = false): Id[][] | null {
  const n = code.nodes[id];
  if (n?.kind !== "lambda" || n.params.length !== 1) return null;
  const body = code.nodes[n.body], head = isCall(body) ? code.nodes[body.fn] : undefined;
  if (!isCall(body) || head?.kind !== "ref" || !TUPLE.test(head.target)) return null;
  const paths = body.args.map((a) => pathFrom(code, a, n.params[0], unfinished));
  if (paths.some((p) => !p)) return null;
  const inside = (a: Id[], b: Id[]) => a.length > 0 && a.length <= b.length && a.every((f, i) => b[i] === f);
  for (let i = 0; i < paths.length; i++) for (let j = 0; j < paths.length; j++)
    if (i !== j && inside(paths[i]!, paths[j]!)) return null;
  return paths as Id[][];
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

// A general function for `set` (BACKLOG L20): a lambda of one parameter
// that reads its parameter only through fields, p ↦ p.width · 2. The paths
// it reads (none inside another: p.a and p.a.b read is p.a), and for each
// use the node that stands for its path's part. Null when the parameter is
// used whole, or not at all, or when the lambda is a path itself.
export function readPaths(code: Code, id: Id): { paths: Id[][]; uses: { node: Id; path: number }[] } | null {
  const n = code.nodes[id];
  if (n?.kind !== "lambda" || n.params.length !== 1 || fieldPath(code, id) || fieldPaths(code, id)) return null;
  const p = n.params[0];
  // A tuple of paths with one twice or inside another is several fields
  // set wrongly, not a function: refused as such.
  const b = code.nodes[n.body], head = isCall(b) ? code.nodes[b.fn] : undefined;
  if (isCall(b) && head?.kind === "ref" && TUPLE.test(head.target) && b.args.every((a) => pathFrom(code, a, p, false))) return null;
  const found: { node: Id; path: Id[] }[] = [];
  let whole = false;
  const walk = (e: Id) => {
    const path = pathFrom(code, e, p, false);
    if (path) { found.push({ node: e, path }); return; }
    const m = code.nodes[e];
    if (!m) return;
    if (m.kind === "ref" && m.target === p) { whole = true; return; }
    for (const c of children(m)) walk(c);
  };
  walk(n.body);
  if (whole || !found.length) return null;
  const prefix = (a: Id[], b: Id[]) => a.length <= b.length && a.every((f, i) => b[i] === f);
  const paths: Id[][] = [];
  for (const { path } of [...found].sort((a, b) => a.path.length - b.path.length)) {
    if (!paths.some((q) => prefix(q, path))) paths.push(path);
  }
  const uses = found.map(({ node, path }) => {
    const i = paths.findIndex((q) => prefix(q, path));
    // The node at the depth of its path's part: p.a.b read with p.a kept is
    // p.a's node, one field call down.
    let at = node;
    for (let d = path.length - paths[i].length; d > 0; d--) at = (code.nodes[at] as Call).args[0];
    return { node: at, path: i };
  });
  return { paths, uses };
}
