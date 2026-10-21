// The semantic core. A program is a flat map of nodes keyed by opaque IDs.
// Nothing in here knows about names, glyphs, comments, layout or text.

import { randomBytes } from "node:crypto";

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
  | { id: Id; kind: "builtin"; op: string };

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
  return randomBytes(4).toString("hex");
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

export function merge(...codes: Code[]): Code {
  return {
    nodes: Object.assign({}, ...codes.map((c) => c.nodes)),
    defs: codes.flatMap((c) => c.defs),
  };
}
