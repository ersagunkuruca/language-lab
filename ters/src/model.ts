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
  // A call (L130d): `fn` is any expression, a def or field by a ref to it.
  // With `args` it gives every input by position. With `given` it is a use
  // of a relation in one direction (src/lang/solve.ts): `given` ports get
  // their values from expressions, `binds` ports are solved for and bound
  // to binders in scope in `body`, Choice when not unique. Read the two
  // through isCall/Call and isUse/Use.
  | { id: Id; kind: "call"; fn: Id; args: Id[]; given?: undefined; binds?: undefined; body?: undefined }
  | { id: Id; kind: "call"; fn: Id; args?: undefined; given: Record<string, Id>; binds?: Record<string, Id>; body?: Id }
  // `results`: binders naming the function's result ports, when it gives
  // several (PORTS-2026-11-01.md, L128b): its body gives a tuple of that
  // many, and each binder names one part. Names only: nothing refers to
  // them, a use reads a part by position.
  | { id: Id; kind: "lambda"; params: Id[]; body: Id; results?: Id[] }
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
  // `ports` (an interface's field with results, POLAR.md, L128d3): its
  // type is a function and these name its inputs, then its results.
  // `same`: another case's field of the same type that this one is (L168,
  // SHARED-FIELDS-2026-11-02.md), so `x.to` reads it on every case that
  // has it. It names the first case's field, which names none.
  | { id: Id; kind: "field"; type: Id; ports?: string[]; same?: Id }
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
  // An arm names the case it handles (`variant`), or, in a match on plain
  // values (L164c), the value: `value` is its own literal child, and
  // `variant` is the same id, with nothing bound.
  | { id: Id; kind: "arm"; variant: Id; value?: Id; binds: Id[]; results: (Id | null)[]; body: Id };

export type Kind = Node["kind"];
type DistOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
export type NodeData = DistOmit<Node, "id">;
export type NodeOf<K extends Kind> = Extract<Node, { kind: K }>;

// A use of a relation in one direction: a call with some ports given by
// name, the rest bound for its body (PORTS-2026-11-01.md "The merge, step
// by step", L130).
export type Use = Extract<NodeOf<"call">, { given: Record<string, Id> }>;
// A use's binds and body (L211b): a use may come without them, giving its
// produced ports as one value. A load keeps it so (L211h): each engine takes
// it as it is, and the passes that work on binders read the copy ports.ts
// `filled` makes, with each port bound and given back.
export const bindsOf = (n: Use): Record<string, Id> => n.binds ?? {};
export function bodyOf(n: Use): Id {
  if (n.body === undefined) throw new Error(`a use whose ports aren't known gives its ports as one value (${n.id})`);
  return n.body;
}
// A use's given expressions and its body when it has one, as a pass that
// walks every expression reads them (L211d).
export const useKids = (n: Use): Id[] => (n.body === undefined ? Object.values(n.given) : [...Object.values(n.given), n.body]);
// A function's ports (BACKLOG L225): its inputs and its results, in order,
// read the same way whichever form it is written in. A definition with
// results is a condition over all its parameters, some of them results
// (RESULTS.md, `condition`); a lambda with results gives them, its body a
// tuple of them in order (L128b). Every reader of either goes through this,
// so the two forms can become one stored form without the readers changing.
export interface Ports { inputs: Id[]; results: Id[]; condition: boolean }
export function portsOf(nodes: Record<Id, Node>, id: Id): Ports | null {
  const n = nodes[id];
  if (n?.kind === "def") {
    const lam = n.body === null ? undefined : nodes[n.body];
    if (lam?.kind !== "lambda") return null;
    if (n.results?.length) { const rs = n.results; return { inputs: lam.params.filter((p) => !rs.includes(p)), results: rs, condition: true }; }
    return lam.results?.length ? { inputs: lam.params, results: lam.results, condition: false } : null;
  }
  if (n?.kind === "lambda" && n.results?.length) return { inputs: n.params, results: n.results, condition: false };
  return null;
}
export const isUse = (n: Node | undefined | null): n is Use => n?.kind === "call" && n.given !== undefined;
export const useOf = (n: Node | undefined | null): Use | null => (isUse(n) ? n : null);
// A call that gives every input by position.
export type Call = Extract<NodeOf<"call">, { args: Id[] }>;
export const isCall = (n: Node | undefined | null): n is Call => n?.kind === "call" && n.given === undefined;
// The relation a use runs: a definition, a field or a builtin, which its
// `fn` refers to.
export const useTarget = (nodes: Record<Id, Node>, u: Use): Id => {
  const f = nodes[u.fn];
  return f?.kind === "ref" ? f.target : u.fn;
};
// A new use of `target`: adds the ref to it through `add`.
export const useNode = (add: (n: NodeData) => Id, target: Id, given: Record<string, Id>, binds: Record<string, Id>, body: Id): Omit<Use, "id"> =>
  ({ kind: "call", fn: add({ kind: "ref", target }), given, binds, body });
// An interface's field with results (POLAR.md, L97c): a field whose type
// is a function and whose ports are named, its inputs first and then its
// results (L128d3). Which positions are its inputs and which its results;
// null for any other field.
export const fieldPorts = (nodes: Record<Id, Node>, f: NodeOf<"field">): { ins: number[]; outs: number[] } | null => {
  const t = nodes[f.type];
  if (!f.ports || t?.kind !== "tfun" || f.ports.length <= t.params.length) return null;
  const at = (from: number, to: number) => Array.from({ length: to - from }, (_, i) => from + i);
  return { ins: at(0, t.params.length), outs: at(t.params.length, f.ports.length) };
};
// A saved program's nodes as today's (L130d): a use was its own kind,
// `solve`, naming its relation directly; it is a call whose `fn` is a ref.
// The ref's id comes from the use's, so loading the same file twice gives
// the same nodes.
function upgradeUses(nodes: Record<Id, unknown>): void {
  for (const [id, n] of Object.entries(nodes)) {
    const o = n as { kind?: string; fn?: Id };
    if (o?.kind !== "solve" || typeof o.fn !== "string") continue;
    const ref = `${id}.fn`;
    nodes[ref] = { id: ref, kind: "ref", target: o.fn };
    nodes[id] = { ...o, kind: "call", fn: ref };
  }
}

// Every change to the shape of saved nodes, in order (L184). A program
// saved at shape n has the steps after the nth run on its nodes when it
// opens; one saved before shapes were numbered has them all run, so each
// step leaves nodes already in its shape alone. A change to the shape adds
// a step at the end; an old step is never edited.
// Trig's unpolar was a predicate over (length, angle, x, y); it is the
// function (x, y) → length, angle now, its ports numbered in that order.
function unpolarInOrder(nodes: Record<Id, unknown>): void {
  const swap: Record<string, string> = { 0: "2", 1: "3", 2: "0", 3: "1" };
  const re = (r: Record<string, Id>) => Object.fromEntries(Object.entries(r).map(([k, v]) => [swap[k] ?? k, v]));
  for (const [id, x] of Object.entries(nodes)) {
    const n = x as { kind?: string; fn?: Id; given?: Record<string, Id>; binds?: Record<string, Id> };
    const f = n.fn !== undefined ? (nodes[n.fn] as { kind?: string; target?: Id } | undefined) : undefined;
    if (n.kind === "call" && n.given && n.binds && f?.kind === "ref" && f.target === "std.trig.trig.unpolar") nodes[id] = { ...n, given: re(n.given), binds: re(n.binds) };
  }
}
// A step that needs to know the library's definitions (a use's ports) is
// given them here by src/lang/library.ts once the library is built; until
// then it leaves the nodes as they are, which is a shape it still reads.
export const shapeHooks: { usesGiveTheirPorts?: (nodes: Record<Id, unknown>) => void } = {};
export const SHAPE_STEPS: { what: string; step: (nodes: Record<Id, unknown>) => void }[] = [
  { what: "a use is a call whose fn is a ref (L130d)", step: upgradeUses },
  { what: "unpolar's ports in the order of its function, (x, y) → length, angle (L128d3)", step: unpolarInOrder },
  { what: "a use gives its produced ports, its body a let of them (L211g)", step: (nodes) => shapeHooks.usesGiveTheirPorts?.(nodes) },
];
export const SHAPE = SHAPE_STEPS.length;
export const toTodaysShape = (nodes: Record<Id, unknown>, from = 0): void => { for (const s of SHAPE_STEPS.slice(from)) s.step(nodes); };

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
    case "call": return n.given ? { ...n, id: f(n.id), fn: f(n.fn), given: rec(n.given), ...(n.binds && { binds: rec(n.binds) }), ...(n.body !== undefined && { body: f(n.body) }) } : { ...n, id: f(n.id), fn: f(n.fn), args: n.args.map(f) };
    case "lambda": return { ...n, id: f(n.id), params: n.params.map(f), body: f(n.body), ...(n.results ? { results: n.results.map(f) } : {}) };
    case "def": return { ...n, id: f(n.id), body: n.body === null ? null : f(n.body), ...(n.results ? { results: n.results.map(f) } : {}), ...(n.direction ? { direction: f(n.direction) } : {}) };
    case "typedef": return { ...n, id: f(n.id), params: n.params.map(f), variants: n.variants.map(f), ...(n.row ? { row: n.row.map(f) } : {}) };
    case "variant": return { ...n, id: f(n.id), fields: n.fields.map(f), ...(n.params ? { params: n.params.map(f) } : {}) };
    case "field": return { ...n, id: f(n.id), type: f(n.type), ...(n.same ? { same: f(n.same) } : {}) };
    case "tref": return { ...n, id: f(n.id), target: f(n.target), args: n.args.map(f) };
    case "tfun": return { ...n, id: f(n.id), params: n.params.map(f), result: f(n.result), ...(n.effects ? { effects: n.effects.map(f) } : {}) };
    case "match": return { ...n, id: f(n.id), scrutinee: f(n.scrutinee), arms: n.arms.map(f), otherwise: n.otherwise === null ? null : f(n.otherwise) };
    case "fold": return { ...n, id: f(n.id), scrutinee: f(n.scrutinee), arms: n.arms.map(f) };
    case "arm": return { ...n, id: f(n.id), variant: f(n.variant), ...(n.value ? { value: f(n.value) } : {}), binds: n.binds.map(f), results: n.results.map((r) => (r === null ? null : f(r))), body: f(n.body) };
  }
}

export function get<K extends Kind>(code: Code, id: Id, kind?: K): NodeOf<K> {
  const n = code.nodes[id];
  if (!n) throw new Error(`no node ${id}`);
  if (kind && n.kind !== kind) throw new Error(`node ${id} is ${n.kind}, expected ${kind}`);
  return n as NodeOf<K>;
}

// Every attribute of every kind of node, said once (L178b,
// FOUNDATIONS-2026-11-03.md §1): a child slot (nodes under this one, in
// the order walkers visit them), a reference to a node elsewhere, an
// attribute that is part of the meaning (the hash must cover it, hash.ts),
// or one that only shapes how it is shown. The type makes it complete: a
// new attribute on a kind that isn't listed here doesn't typecheck.
export type Slot = "child" | "ref" | "meaning" | "presentation";
type Schema = { [K in Kind]: { readonly [A in Exclude<keyof Extract<Node, { kind: K }>, "id" | "kind">]-?: Slot } };
export const SCHEMA: Schema = {
  lit: { value: "meaning", unit: "meaning", of: "meaning" },
  binder: { unit: "meaning" },
  ref: { target: "ref" },
  // A plain call's args, or a use's given, binds and body.
  call: { fn: "child", args: "child", given: "child", binds: "child", body: "child" },
  // `results` names the parts of the tuple the body gives: binders, so
  // children, which the hash leaves out (the body's tuple says how many).
  lambda: { params: "child", body: "child", results: "child" },
  def: { body: "child", way: "ref", results: "meaning", cost: "meaning", direction: "ref" },
  builtin: { op: "meaning" },
  hole: {},
  typedef: { params: "child", variants: "child", effect: "meaning", interface: "meaning", unique: "meaning", row: "ref" },
  variant: { params: "child", fields: "child", returns: "child", later: "meaning", private: "meaning" },
  field: { type: "child", ports: "meaning", same: "ref" },
  tref: { target: "ref", args: "child" },
  tfun: { params: "child", result: "child", effects: "ref" },
  match: { scrutinee: "child", arms: "child", otherwise: "child" },
  fold: { scrutinee: "child", arms: "child" },
  arm: { value: "child", variant: "ref", binds: "child", results: "child", body: "child" },
};

// The ids in one attribute's value: an id, a list of ids (nulls skipped),
// or a record of them.
const idsIn = (v: unknown): Id[] =>
  typeof v === "string" ? [v] : Array.isArray(v) ? v.filter((x): x is Id => typeof x === "string") : v && typeof v === "object" ? (Object.values(v) as Id[]) : [];

// The nodes under n, in the order its kind's child slots are listed.
export function children(n: Node): Id[] {
  const slots = SCHEMA[n.kind] as Record<string, Slot> | undefined;
  if (!slots) return [];
  const out: Id[] = [];
  for (const [a, slot] of Object.entries(slots)) if (slot === "child") out.push(...idsIn((n as Record<string, unknown>)[a]));
  return out;
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
      const target = node.kind === "ref" ? node.target : node.kind === "tref" ? node.target : node.kind === "arm" ? node.variant : null;
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
// A solve's given value hangs under its port's name (`key`, slot "given").
export function parentOf(code: Code, id: Id): { parent: Id; slot: string; index?: number; key?: string } | null {
  for (const n of Object.values(code.nodes)) {
    if (isCall(n)) {
      if (n.fn === id) return { parent: n.id, slot: "fn" };
      const i = n.args.indexOf(id);
      if (i >= 0) return { parent: n.id, slot: "args", index: i };
    } else if (n.kind === "lambda" && n.body === id) return { parent: n.id, slot: "body" };
    else if ((n.kind === "match" || n.kind === "fold") && n.scrutinee === id) return { parent: n.id, slot: "scrutinee" };
    else if (n.kind === "match" && n.otherwise === id) return { parent: n.id, slot: "otherwise" };
    else if ((n.kind === "arm" || isUse(n)) && n.body === id) return { parent: n.id, slot: "body" };
    else if (isUse(n)) {
      if (n.fn === id) return { parent: n.id, slot: "fn" };
      const key = Object.keys(n.given).find((k) => n.given[k] === id); if (key !== undefined) return { parent: n.id, slot: "given", key };
    }
    else if (n.kind === "def" && n.body === id) return { parent: n.id, slot: "body" };
  }
  return null;
}

// parentOf for a version of the code nothing changes any more (the
// editor's: each edit makes a new Code): one scan indexes every node's
// parent, then each look-up is constant (BACKLOG E200). parentOf itself
// scans every time, since an edit in progress changes its nodes in place.
type Parent = NonNullable<ReturnType<typeof parentOf>>;
const parentIndex = new WeakMap<Code, Map<Id, Parent>>();
export function parentAt(code: Code, id: Id): Parent | null {
  let m = parentIndex.get(code);
  if (!m) {
    const at = new Map<Id, Parent>();
    const put = (child: Id | null | undefined, p: Parent) => { if (child != null && !at.has(child)) at.set(child, p); };
    for (const n of Object.values(code.nodes)) {
      if (isCall(n)) { put(n.fn, { parent: n.id, slot: "fn" }); n.args.forEach((a, i) => put(a, { parent: n.id, slot: "args", index: i })); }
      else if (n.kind === "lambda" || n.kind === "arm" || n.kind === "def") put(n.body, { parent: n.id, slot: "body" });
      else if (n.kind === "match" || n.kind === "fold") { put(n.scrutinee, { parent: n.id, slot: "scrutinee" }); if (n.kind === "match") put(n.otherwise, { parent: n.id, slot: "otherwise" }); }
      else if (isUse(n)) { put(n.fn, { parent: n.id, slot: "fn" }); put(n.body, { parent: n.id, slot: "body" }); for (const key of Object.keys(n.given)) put(n.given[key], { parent: n.id, slot: "given", key }); }
    }
    parentIndex.set(code, (m = at));
  }
  return m.get(id) ?? null;
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
  } else if (at.slot === "given") p.given = { ...(p.given as Record<string, Id>), [at.key!]: replacement };
  else p[at.slot] = replacement;
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

// A program made from another by changing a few nodes (the palette's
// filled programs, BACKLOG E133b), and those nodes: what is found by
// scanning every node can start from the other program's.
// `stable`: a node not changed is the base's own object, and so is every
// node it reaches, so what was picked of it stands (a program on its layer).
// `same`: only that a node not changed is the base's own object and none
// is gone, so a scan keeps the base's picks but for the changed (a
// palette's filled program, written into a copy of the base's nodes).
export const derived = new WeakMap<Code, { base: Code; changed: Set<Id>; stable?: boolean; same?: boolean }>();
export function derivedFrom(code: Code, base: Code, changed: Iterable<Id>, same = false) { derived.set(code, { base, changed: new Set(changed), ...(same ? { same } : {}) }); }
const picked = new WeakMap<Code, Map<string, Id[]>>();
// The picks but the changed ones: a copy, and the few changed among them
// taken out by their positions, not a test of each pick (I167c: a filled
// program's scans each read the thousands of the base's).
const positions = new WeakMap<Id[], Map<Id, number>>();
function without(picks: Id[], changed: Set<Id>): Id[] {
  if (changed.size > 64) return picks.filter((id) => !changed.has(id));
  let at = positions.get(picks);
  if (!at) positions.set(picks, (at = new Map(picks.map((id, i) => [id, i]))));
  const drop: number[] = [];
  for (const id of changed) { const i = at.get(id); if (i !== undefined) drop.push(i); }
  const out = picks.slice();
  if (drop.length) { drop.sort((a, b) => b - a); for (const i of drop) out.splice(i, 1); }
  return out;
}
const picksOf = (code: Code, kind: string, keep: (n: Node) => boolean): Id[] => {
  let all = picked.get(code);
  if (!all) picked.set(code, (all = new Map()));
  let out = all.get(kind);
  if (!out) all.set(kind, (out = nodesWhere(code, kind, keep)));
  return out;
};
// A program put on a layer of code under it, the library (load.ts base,
// L217). `scanningOnLayer` reads it, for one step that doesn't change it,
// as derived from the layer by the nodes that aren't the layer's own (the
// same object): each scan in the step reads the layer's picks, scanned
// once per process, and looks only at the rest. Which nodes those are is
// asked again at each step, since a program may be changed in place
// between. A pick must depend only on the node and the nodes it reaches,
// which on the layer are the layer's.
const layers = new WeakMap<Code, Code>();
export function onLayer(code: Code, layer: Code): Code { layers.set(code, layer); return code; }
export const layerOf = (code: Code): Code | undefined => layers.get(code);
// The nodes of a program on its layer that aren't the layer's, while
// `scanningOnLayer` reads it so.
export const offLayer = (code: Code): Set<Id> | undefined => { const d = derived.get(code); return d?.stable ? d.changed : undefined; };
export function scanningOnLayer<T>(code: Code, step: () => T): T {
  const layer = layers.get(code);
  if (!layer || derived.has(code)) return step();
  const under = layer.nodes, changed = new Set<Id>();
  for (const id in code.nodes) if (code.nodes[id] !== under[id]) changed.add(id);
  for (const id in under) if (!(id in code.nodes)) changed.add(id);
  derived.set(code, { base: layer, changed, stable: true });
  try { return step(); } finally { derived.delete(code); }
}

// Each node's parent, as a lookup. For a derived program, its base's
// parents, found once, beside those of the nodes changed.
const parentsKept = new WeakMap<Code, Map<Id, Id>>();
const parentsIn = (code: Code): Map<Id, Id> => {
  const m = new Map<Id, Id>();
  for (const n of Object.values(code.nodes)) for (const c of children(n)) m.set(c, n.id);
  return m;
};
export function parentLookup(code: Code): (id: Id) => Id | undefined {
  const from = derived.get(code);
  if (!from) { const m = parentsIn(code); return (id) => m.get(id); }
  let under = parentsKept.get(from.base);
  if (!under) parentsKept.set(from.base, (under = parentsIn(from.base)));
  const mine = new Map<Id, Id>();
  for (const id of from.changed) { const n = code.nodes[id]; if (n) for (const c of children(n)) mine.set(c, id); }
  const below = under;
  return (id) => { if (mine.has(id)) return mine.get(id); const p = below.get(id); return p !== undefined && !from.changed.has(p) ? p : undefined; };
}
// The ids of the nodes `keep` picks, `kind` naming the pick. For a derived
// program: its base's (scanned once), those still there and still picked,
// and the changed nodes picked (E103d: a whole check of each palette offer
// scanned the ~10,000 nodes twice).
export function nodesWhere(code: Code, kind: string, keep: (n: Node) => boolean): Id[] {
  const from = derived.get(code);
  if (!from) return Object.values(code.nodes).filter(keep).map((n) => n.id);
  const base = picksOf(from.base, kind, keep);
  const out = from.stable || from.same ? without(base, from.changed) : base.filter((id) => !from.changed.has(id) && code.nodes[id] && keep(code.nodes[id]));
  for (const id of from.changed) if (code.nodes[id] && keep(code.nodes[id])) out.push(id);
  return out;
}
