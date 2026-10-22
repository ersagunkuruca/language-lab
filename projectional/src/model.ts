// The semantic core. A program is a flat map of nodes keyed by opaque IDs.
// Nothing in here knows about names, glyphs, comments, layout or text.

import type { Unit } from "./units.ts";

export type Id = string;

export type Node =
  // `of` names the literal's type when it isn't the usual one for its value
  // (Number for a number, Text for a string): an Int is `of: "type.int"`,
  // with its digits in a string when they don't fit a safe integer.
  | { id: Id; kind: "lit"; value: number | string; of?: Id }
  // A binder is the identity of a variable. It has no name; names live in the
  // presentation layer, keyed by this id. A unit, if given, is its type.
  | { id: Id; kind: "binder"; unit?: Unit }
  // A reference points at a binder, a def or a builtin by id. Never by name.
  | { id: Id; kind: "ref"; target: Id }
  | { id: Id; kind: "call"; fn: Id; args: Id[] }
  | { id: Id; kind: "lambda"; params: Id[]; body: Id }
  // A top-level definition. body === null declares an extern (an opaque value
  // or function we can talk about but not look inside).
  | { id: Id; kind: "def"; body: Id | null }
  | { id: Id; kind: "builtin"; op: string }
  // A hole: an expression not written yet. Programs with holes still render,
  // hash and can be edited; they just can't be evaluated through the hole.
  | { id: Id; kind: "hole" }
  // A network is a function without a direction: external ports (params),
  // internal wires, and parts wired to them. Which ports are inputs is decided
  // when it is used, by a solver. Params and wires are binders.
  | { id: Id; kind: "network"; params: Id[]; wires: Id[]; parts: Id[] }
  // One node in a network: a builtin, relation or def, with each of its ports
  // bound to a wire. fn === null makes it a constant with `value` (and `unit`).
  | { id: Id; kind: "part"; fn: Id | null; value?: number; unit?: Unit; bind: Record<string, Id> }
  // Data types (src/lang/). A typedef is a def body: a sum of variants, each a
  // product of fields. Variant and field ids are the tags and labels, so a
  // ref to a variant is its constructor and a ref to the field of a
  // one-variant type is its projection. Names are presentation, as always.
  | { id: Id; kind: "typedef"; params: Id[]; variants: Id[] }
  | { id: Id; kind: "variant"; fields: Id[] }
  | { id: Id; kind: "field"; type: Id }
  // Type expressions, used for fields. target is a typedef's def, a builtin
  // type (type.number, type.string) or one of the typedef's param binders.
  | { id: Id; kind: "tref"; target: Id; args: Id[] }
  | { id: Id; kind: "tfun"; params: Id[]; result: Id }
  // Case analysis. There is one arm per variant (the editor makes them from
  // the type), or arms for some and `otherwise` for the rest, so a missing
  // case can't be written down.
  | { id: Id; kind: "match"; scrutinee: Id; arms: Id[]; otherwise: Id | null }
  // Structural recursion: like match, but each recursive field also gets the
  // already-folded result (a paramorphism). Always terminates.
  | { id: Id; kind: "fold"; scrutinee: Id; arms: Id[] }
  // binds: one binder per field. results (fold only): a binder for each
  // recursive field's folded value, null for the others.
  | { id: Id; kind: "arm"; variant: Id; binds: Id[]; results: (Id | null)[]; body: Id }
  // A relation used in one direction inside an expression (src/lang/solve.ts):
  // `given` ports get their values from expressions, `binds` ports are solved
  // for and bound to binders in scope in `body`. Choice when not unique.
  | { id: Id; kind: "solve"; fn: Id; given: Record<string, Id>; binds: Record<string, Id>; body: Id };

export type Kind = Node["kind"];
type DistOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
export type NodeData = DistOmit<Node, "id">;
export type NodeOf<K extends Kind> = Extract<Node, { kind: K }>;

// What gets stored on disk as code.json. `defs` is the list of top-level
// definitions; there are no modules, imports or files, just reachable defs.
export interface Code {
  nodes: Record<Id, Node>;
  defs: Id[];
}

// 130 random bits, as 26 base-32 characters (digits and a to v). At that
// size two programs of a billion nodes each share an id with a chance of
// about 1 in 10^21, so ids from different authors can be mixed freely.
// Older programs have 8-character ids; both kinds live side by side.
// What a generated id looks like, for finding ids inside text (comment
// references, solver variable names). Longer form first.
export const ID_PATTERN = "[0-9a-v]{26}|[0-9a-f]{8}";
export function freshId(): Id {
  const b = crypto.getRandomValues(new Uint8Array(26));
  return Array.from(b, (x) => (x & 31).toString(32)).join("");
}

export function get<K extends Kind>(code: Code, id: Id, kind?: K): NodeOf<K> {
  const n = code.nodes[id];
  if (!n) throw new Error(`no node ${id}`);
  if (kind && n.kind !== kind) throw new Error(`node ${id} is ${n.kind}, expected ${kind}`);
  return n as NodeOf<K>;
}

export function children(n: Node): Id[] {
  switch (n.kind) {
    case "call": return [n.fn, ...n.args];
    case "lambda": return [...n.params, n.body];
    case "def": return n.body ? [n.body] : [];
    case "network": return [...n.params, ...n.wires, ...n.parts];
    case "typedef": return [...n.params, ...n.variants];
    case "variant": return n.fields;
    case "field": return [n.type];
    case "tref": return n.args;
    case "tfun": return [...n.params, n.result];
    case "match": return [n.scrutinee, ...n.arms, ...(n.otherwise ? [n.otherwise] : [])];
    case "fold": return [n.scrutinee, ...n.arms];
    case "arm": return [...n.binds, ...n.results.filter((r): r is Id => r !== null), n.body];
    case "solve": return [...Object.values(n.given), ...Object.values(n.binds), n.body];
    default: return [];
  }
}

// Every node id under `root`, in pre-order. Does not follow refs.
export function subtree(code: Code, root: Id): Id[] {
  const out: Id[] = [];
  const walk = (id: Id) => {
    out.push(id);
    for (const c of children(code.nodes[id])) walk(c);
  };
  walk(root);
  return out;
}

// Defs and builtins that `root` reaches through refs, transitively. This is
// all a "package" is: the closure of what a definition depends on.
export function dependencies(code: Code, root: Id): Id[] {
  const seen = new Set<Id>();
  const owner = ownerOfTypeParts(code);
  const visit = (id: Id) => {
    for (const n of subtree(code, id)) {
      const node = code.nodes[n];
      let target = node.kind === "ref" ? node.target : node.kind === "part" || node.kind === "solve" ? node.fn : node.kind === "tref" ? node.target : node.kind === "arm" ? node.variant : null;
      if (target && owner.has(target)) target = owner.get(target)!;
      if (!target || seen.has(target)) continue;
      const t = code.nodes[target];
      if (t.kind === "def" || t.kind === "builtin") {
        seen.add(target);
        visit(target);
      }
    }
  };
  visit(root);
  return [...seen];
}

// Variants and fields are referred to directly (constructors, projections);
// this finds the def whose typedef they belong to.
export function ownerOfTypeParts(code: Code): Map<Id, Id> {
  const out = new Map<Id, Id>();
  for (const n of Object.values(code.nodes)) {
    if (n.kind !== "def" || !n.body || code.nodes[n.body]?.kind !== "typedef") continue;
    for (const v of (code.nodes[n.body] as NodeOf<"typedef">).variants) {
      out.set(v, n.id);
      for (const f of (code.nodes[v] as NodeOf<"variant">).fields) out.set(f, n.id);
    }
  }
  return out;
}

// Semantic edit: swap the node at `id` for a new subtree, keeping the id so
// everything attached to it (names, comments, hints, layout) stays attached.
export function replace(code: Code, id: Id, build: (code: Code) => NodeData): Code {
  const next: Code = { nodes: { ...code.nodes }, defs: code.defs };
  next.nodes[id] = { ...build(next), id } as Node;
  return next;
}

// Where `id` hangs in the tree: its parent and the slot it occupies.
export function parentOf(code: Code, id: Id): { parent: Id; slot: string; index?: number } | null {
  for (const n of Object.values(code.nodes)) {
    if (n.kind === "call") {
      if (n.fn === id) return { parent: n.id, slot: "fn" };
      const i = n.args.indexOf(id);
      if (i >= 0) return { parent: n.id, slot: "args", index: i };
    } else if (n.kind === "lambda" && n.body === id) return { parent: n.id, slot: "body" };
    else if ((n.kind === "match" || n.kind === "fold") && n.scrutinee === id) return { parent: n.id, slot: "scrutinee" };
    else if (n.kind === "match" && n.otherwise === id) return { parent: n.id, slot: "otherwise" };
    else if ((n.kind === "arm" || n.kind === "solve") && n.body === id) return { parent: n.id, slot: "body" };
    else if (n.kind === "def" && n.body === id) return { parent: n.id, slot: "body" };
  }
  return null;
}

// Semantic edit: put a different node in the slot `id` occupies. The old
// subtree keeps its ids (so it can be moved elsewhere, e.g. into a wrapper).
export function swapIn(code: Code, id: Id, replacement: Id): Code {
  const at = parentOf(code, id);
  if (!at) throw new Error(`${id} has no parent`);
  const next: Code = { nodes: { ...code.nodes }, defs: code.defs };
  const p = { ...next.nodes[at.parent] } as Record<string, unknown>;
  if (at.slot === "args") {
    const args = [...(p.args as Id[])];
    args[at.index!] = replacement;
    p.args = args;
  } else p[at.slot] = replacement;
  next.nodes[at.parent] = p as unknown as Node;
  return next;
}

// Drop nodes no def or builtin can reach (after deletes and replacements).
export function collect(code: Code): Code {
  const keep = new Set<Id>();
  for (const n of Object.values(code.nodes)) if (n.kind === "builtin") keep.add(n.id);
  for (const d of code.defs) for (const id of subtree(code, d)) keep.add(id);
  return { nodes: Object.fromEntries(Object.entries(code.nodes).filter(([id]) => keep.has(id))), defs: code.defs };
}

export class MergeClash extends Error {
  ids: Id[];
  constructor(ids: Id[]) {
    super(`these ids name different nodes in the programs being merged: ${ids.slice(0, 5).join(", ")}${ids.length > 5 ? ` and ${ids.length - 5} more` : ""}`);
    this.ids = ids;
  }
}

// Put programs together. The same node in two of them (a shared library)
// is fine; two different nodes under one id is refused, never overwritten.
export function merge(...codes: Code[]): Code {
  const nodes: Record<Id, Node> = {};
  const clashes: Id[] = [];
  for (const c of codes) {
    for (const [id, n] of Object.entries(c.nodes)) {
      const old = nodes[id];
      if (old && old !== n && !sameNode(old, n)) clashes.push(id);
      nodes[id] = n;
    }
  }
  if (clashes.length) throw new MergeClash(clashes);
  return { nodes, defs: [...new Set(codes.flatMap((c) => c.defs))] };
}

const sameNode = (a: Node, b: Node) => JSON.stringify(a) === JSON.stringify(b);
