// Convenience for constructing trees in code (there is no parser, on purpose).
// Ids are random; names go into a separate table as they're given.

import type { Code, Id, Node, NodeData } from "./model.ts";
import { freshId } from "./model.ts";
import type { Names } from "./presentation.ts";

export class Builder {
  code: Code = { nodes: {}, defs: [] };
  names: Names = {};

  private known: Code;

  constructor(known: Code = { nodes: {}, defs: [] }) {
    this.known = known;
  }

  private add(n: NodeData): Id {
    const id = freshId();
    this.code.nodes[id] = { id, ...n } as Node;
    return id;
  }

  private kind(id: Id) {
    return (this.code.nodes[id] ?? this.known.nodes[id])?.kind;
  }

  // Binders, defs and builtins are things you refer to; anything else is
  // already an expression. Each use gets its own ref node.
  x(id: Id): Id {
    const k = this.kind(id);
    if (!k) throw new Error(`unknown id ${id}`);
    return k === "binder" || k === "def" || k === "builtin" ? this.add({ kind: "ref", target: id }) : id;
  }

  lit(value: number | string): Id {
    return this.add({ kind: "lit", value });
  }

  call(fn: Id, ...args: Id[]): Id {
    return this.add({ kind: "call", fn: this.x(fn), args: args.map((a) => this.x(a)) });
  }

  lambda(names: string[], body: (...params: Id[]) => Id): Id {
    const params = names.map((name) => this.named(this.add({ kind: "binder" }), name));
    return this.add({ kind: "lambda", params, body: this.x(body(...params)) });
  }

  // Declare a def; give it a body later with define() so defs can refer to
  // each other in any order. A def with no body is an extern.
  def(name: string): Id {
    const id = this.named(this.add({ kind: "def", body: null }), name);
    this.code.defs.push(id);
    return id;
  }

  define(def: Id, body: Id): Id {
    const k = this.kind(body);
    this.code.nodes[def] = { id: def, kind: "def", body: k === "network" ? body : this.x(body) };
    return def;
  }

  binder(name: string): Id {
    return this.named(this.add({ kind: "binder" }), name);
  }

  // A network: ports and wires are binders, parts bind port keys to them.
  network(params: Id[], wires: Id[], parts: Id[]): Id {
    return this.add({ kind: "network", params, wires, parts });
  }

  part(fn: Id | null, bind: Record<string, Id>, value?: number): Id {
    return this.add(value === undefined ? { kind: "part", fn, bind } : { kind: "part", fn, bind, value });
  }

  named(id: Id, name: string): Id {
    this.names[id] = name;
    return id;
  }
}
