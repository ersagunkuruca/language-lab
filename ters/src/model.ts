// The semantic core. A program is a flat map of nodes keyed by opaque IDs.
// Nothing in here knows about names, glyphs, comments, layout or text.

import type { Unit } from "./units.ts";

export type Id = string;

export type Node =
  // A number may carry a unit (9.81 m/s²); without one it is a plain number.
  // `of` names the literal's type when it isn't the usual one for its value
  // (Float64 for a number, Text for a string): an Int is `of: "type.int"`,
  // with its digits in a string when they don't fit a safe integer.
  | { id: Id; kind: "lit"; value: number | string; unit?: Unit; of?: Id }
  // A binder is the identity of a variable. It has no name; names live in the
  // presentation layer, keyed by this id. A unit, if given, is its type.
  | { id: Id; kind: "binder"; unit?: Unit }
  // A reference points at a binder, a def or a builtin by id. Never by name.
  | { id: Id; kind: "ref"; target: Id }
  | { id: Id; kind: "call"; fn: Id; args: Id[] }
  | { id: Id; kind: "lambda"; params: Id[]; body: Id }
  // A top-level definition. body === null declares an extern (an opaque value
  // or function we can talk about but not look inside).
  // `way`: this definition is one way to compute that interface field
  // (WAYS.md), used for an implementation that leaves it `by its ways`.
  // `results`: the parameters it gives, in order, when given the others
  // (RESULTS.md): a predicate read as a function with several results.
  // `cost`: a way's own declared cost (WAYS.md "Costs"), 1 when not given.
  // `direction`: this definition, with results, computes another direction
  // of that one (POLAR.md): the same ports in the same order, so a solve of
  // that one given this one's inputs is a solve of this one.
  | { id: Id; kind: "def"; body: Id | null; way?: Id; results?: Id[]; cost?: number; direction?: Id }
  | { id: Id; kind: "builtin"; op: string }
  // A hole: an expression not written yet. Programs with holes still render,
  // hash and can be edited; they just can't be evaluated through the hole.
  | { id: Id; kind: "hole" }
  // Data types (src/lang/). A typedef is a def body: a sum of variants, each a
  // product of fields. Variant and field ids are the tags and labels, so a
  // ref to a variant is its constructor and a ref to the field of a
  // one-variant type is its projection. Names are presentation, as always.
  //
  // An effect is declared the same way (LANGUAGE.md, "Effects you define"):
  // a typedef with `effect: true`, whose variants are its operations and
  // whose fields are what each operation is given. Calling an operation
  // performs it; `returns` is the type a handler answers it with, and an
  // operation without one never returns (it ends the handled computation).
  // `later`: the handler may answer it later, at most once; its case is
  // given the rest of the computation as a function (ANSWERED-LATER.md).
  // `private`: a constructor only the library that keeps its type's rule
  // may call (a set sorted with no item twice, a fraction in lowest
  // terms); everyone else builds one with the library's functions. Taking
  // a value apart with a match is open to all (LANGUAGE.md "Private
  // constructors"; OCaml's private types are the prior art).
  //
  // An interface is declared the same way too (INTERFACES.md): a typedef
  // with `interface: true`, one type parameter and one case, a record of
  // functions whose fields are its operations. A ref to one of its fields
  // is that operation, at whatever type the use needs; an implementation
  // is an ordinary definition of the record at one type, and the checker
  // and arith.ts resolve each use to it before anything runs.
  //
  // `unique`: a name that keeps the type apart from another of the same
  // shape when they are hashed (src/hash.ts); Unison's `unique type`.
  //
  // `row` (HOSTS.md, L58): a named row, no variants, standing for these
  // effects wherever a function type lists it (`() -[View]-> Text`).
  | { id: Id; kind: "typedef"; params: Id[]; variants: Id[]; effect?: true; interface?: true; unique?: string; row?: Id[] }
  // An operation's own type variables (BACKLOG L71a, ANSWERED-LATER.md):
  // binders its fields and result may name besides its effect's, fresh at
  // each call and rigid in the case that handles it. `await(ticket: Ticket
  // a) → a` has its own a.
  | { id: Id; kind: "variant"; fields: Id[]; returns?: Id; later?: true; private?: true; params?: Id[] }
  // `results` (an interface's field, POLAR.md): the positions of the
  // ports it gives, when its type is a predicate over its ports read as a
  // function with several results; `ports` names them for the text.
  | { id: Id; kind: "field"; type: Id; results?: number[]; ports?: string[] }
  // Type expressions, used for fields. target is a typedef's def, a builtin
  // type (type.number, type.string) or one of the typedef's param binders.
  | { id: Id; kind: "tref"; target: Id; args: Id[] }
  // A function type. `effects` (effect defs or the builtin effects) is its
  // row, closed: a function type with none listed is pure.
  | { id: Id; kind: "tfun"; params: Id[]; result: Id; effects?: Id[] }
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
// Published code (src/lang/modules.ts) is named by its content hash instead:
// a def is `@` and its 26-character hash, and the nodes inside it are that
// and their place in it (`@…:3`).
// What a generated id looks like, for finding ids inside text (comment
// references, solver variable names). Longer form first.
export const ID_PATTERN = "@[0-9a-v]{26}(?::[0-9]+)?|[0-9a-v]{26}|[0-9a-f]{8}";
export const isPublished = (id: Id) => id.startsWith("@");
// "{3fa2c19e}" inside a comment is a reference to that node, shown by name.
export const resolveRefs = (text: string, name: (id: Id) => string) =>
  text.replace(new RegExp(`\\{(${ID_PATTERN})\\}`, "g"), (_, ref) => name(ref));
// 26 random base-32 digits. The random bytes come from a pool filled 64 KB
// at a time: asking the system for 26 bytes per id was an eighth of
// compiling Bounce (C67), where staging makes hundreds of thousands.
const DIGITS = "0123456789abcdefghijklmnopqrstuv";
const pool = new Uint8Array(26 * 2520);
let at = pool.length;
export function freshId(): Id {
  if (at + 26 > pool.length) { crypto.getRandomValues(pool); at = 0; }
  let id = "";
  for (let i = 0; i < 26; i++) id += DIGITS[pool[at++] & 31];
  return id;
}

// The same node with every id in it passed through f: its own, its
// children's, and the ones it points at. Record keys that are ids (a solve's
// ports) are renamed too, and kept in a fixed order.
export function mapIds(n: Node, f: (id: Id) => Id): Node {
  const rec = (r: Record<string, Id>) => Object.fromEntries(Object.entries(r).map(([k, v]) => [f(k), f(v)] as const).sort(([a], [b]) => (a < b ? -1 : 1)));
  switch (n.kind) {
    case "lit": return n.of ? { ...n, id: f(n.id), of: f(n.of) } : { ...n, id: f(n.id) };
    case "binder": case "builtin": case "hole": return { ...n, id: f(n.id) };
    case "ref": return { ...n, id: f(n.id), target: f(n.target) };
    case "call": return { ...n, id: f(n.id), fn: f(n.fn), args: n.args.map(f) };
    case "lambda": return { ...n, id: f(n.id), params: n.params.map(f), body: f(n.body) };
    case "def": return { ...n, id: f(n.id), body: n.body === null ? null : f(n.body), ...(n.results ? { results: n.results.map(f) } : {}), ...(n.direction ? { direction: f(n.direction) } : {}) };
    case "typedef": return { ...n, id: f(n.id), params: n.params.map(f), variants: n.variants.map(f), ...(n.row ? { row: n.row.map(f) } : {}) };
    case "variant": return { ...n, id: f(n.id), fields: n.fields.map(f), ...(n.params ? { params: n.params.map(f) } : {}) };
    case "field": return { ...n, id: f(n.id), type: f(n.type) };
    case "tref": return { ...n, id: f(n.id), target: f(n.target), args: n.args.map(f) };
    case "tfun": return { ...n, id: f(n.id), params: n.params.map(f), result: f(n.result), ...(n.effects ? { effects: n.effects.map(f) } : {}) };
    case "match": return { ...n, id: f(n.id), scrutinee: f(n.scrutinee), arms: n.arms.map(f), otherwise: n.otherwise === null ? null : f(n.otherwise) };
    case "fold": return { ...n, id: f(n.id), scrutinee: f(n.scrutinee), arms: n.arms.map(f) };
    case "arm": return { ...n, id: f(n.id), variant: f(n.variant), binds: n.binds.map(f), results: n.results.map((r) => (r === null ? null : f(r))), body: f(n.body) };
    case "solve": return { ...n, id: f(n.id), fn: f(n.fn), given: rec(n.given), binds: rec(n.binds), body: f(n.body) };
  }
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
    case "typedef": return [...n.params, ...n.variants];
    case "variant": return [...(n.params ?? []), ...n.fields, ...(n.returns ? [n.returns] : [])];
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
      const target = node.kind === "ref" ? node.target : node.kind === "solve" ? node.fn : node.kind === "tref" ? node.target : node.kind === "arm" ? node.variant : null;
      for (let t of [target, ...(node.kind === "tfun" ? node.effects ?? [] : []), ...(node.kind === "typedef" ? node.row ?? [] : [])]) {
        if (t && owner.has(t)) t = owner.get(t)!;
        if (!t || seen.has(t)) continue;
        const d = code.nodes[t];
        if (d.kind === "def" || d.kind === "builtin") {
          seen.add(t);
          visit(t);
        }
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
  // Every def is a top-level one, so the defs list is enough: a scan of
  // every node made it the slow part of checking a palette's offers.
  for (const d of code.defs) {
    const n = code.nodes[d];
    if (n?.kind !== "def" || !n.body || code.nodes[n.body]?.kind !== "typedef") continue;
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
