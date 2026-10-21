// The semantic core. A program is a flat map of nodes keyed by opaque IDs.
// Nothing in here knows about names, glyphs, comments, layout or text.

export type Id = string;

export type Node =
  | { id: Id; kind: "lit"; value: number | string }
  // A binder is the identity of a variable. It has no name; names live in the
  // presentation layer, keyed by this id.
  | { id: Id; kind: "binder" }
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
  | { id: Id; kind: "hole" };

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

export function freshId(): Id {
  const b = crypto.getRandomValues(new Uint8Array(4));
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
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
  const visit = (id: Id) => {
    for (const n of subtree(code, id)) {
      const node = code.nodes[n];
      if (node.kind !== "ref" || seen.has(node.target)) continue;
      const t = code.nodes[node.target];
      if (t.kind === "def" || t.kind === "builtin") {
        seen.add(node.target);
        visit(node.target);
      }
    }
  };
  visit(root);
  return [...seen];
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

export function merge(...codes: Code[]): Code {
  return {
    nodes: Object.assign({}, ...codes.map((c) => c.nodes)),
    defs: codes.flatMap((c) => c.defs),
  };
}
