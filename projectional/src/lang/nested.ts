// Folds over nested data: a field that holds the type being folded inside
// another type, like a rose tree's `children: List Tree`. Its folded value
// is the container with every tree in it replaced by that tree's folded
// value (List R), which is the fold mapped over the container (what Coq
// does for nested inductive types).
//
// Each fold implementation does it the same way: `spread` lists the trees
// inside the field's value, in order, they are folded like any other
// child, and `rebuild` puts their results back where they were. Both walk
// with explicit stacks, so a list of a million children uses no JS stack.

import type { Code, Id, NodeOf } from "../model.ts";

interface Shaped { tag: Id; fields: unknown[] }
// What a data type's params stand for, at one place inside a field's type.
export type TypeEnv = Map<Id, { tid: Id; env: TypeEnv }>;
type Op = { k: "leaf"; v: unknown } | { k: "child" } | { k: "build"; tag: Id; n: number };

// For each field of a variant of `def`: whether it is the type itself
// ("self"), holds it nested in another type ("nested"), or neither (null).
export function fieldShapes(code: Code, def: Id, variant: Id): ("self" | "nested" | null)[] {
  return (code.nodes[variant] as NodeOf<"variant">).fields.map((f) => {
    const t = code.nodes[(code.nodes[f] as NodeOf<"field">).type];
    if (t.kind === "tref" && t.target === def) return "self";
    return mentions(code, def, t.id, new Map()) ? "nested" : null;
  });
}

export function mentions(code: Code, def: Id, tid: Id, env: TypeEnv): boolean {
  const t = code.nodes[tid];
  if (t.kind !== "tref") return false;
  const bound = env.get(t.target);
  if (bound) return mentions(code, def, bound.tid, bound.env);
  return t.target === def || t.args.some((a) => mentions(code, def, a, env));
}

// The shape of a field's type, as plain data, so compiled code can carry
// it: a table from each container type met (List Tree, with its params
// filled in) to its variants' field shapes. "S" is the type being folded,
// "O" anything without it.
export interface Shape { root: string; table: Record<string, Record<Id, string[]>> }

export function shapeOf(code: Code, def: Id, tid: Id): Shape {
  const table: Shape["table"] = {};
  const keyOf = (at: { tid: Id; env: TypeEnv }, depth: number): string => {
    const place = look(code, def, at.tid, at.env);
    if (place.k !== "container") return place.k === "self" ? "S" : "O";
    if (!(place.key in table)) {
      if (depth > 64) throw new Error("this container grows with each level (a non-regular type), so it can't be folded");
      table[place.key] = {};
      for (const v of place.variants) table[place.key][v] = place.fields(v).map((f) => keyOf(f, depth + 1));
    }
    return place.key;
  };
  return { root: keyOf({ tid, env: new Map() }, 0), table };
}

// The values of type `def` inside value `v` of that shape, in order, and
// how to put their folded results back.
export function spread<V extends Shaped>(shape: Shape, v: unknown): { children: V[]; rebuild: (results: unknown[]) => unknown } {
  const ops: Op[] = [];
  const children: V[] = [];
  const work: ({ key: string; v: unknown } | Op)[] = [{ key: shape.root, v }];
  while (work.length) {
    const w = work.pop()!;
    if ("k" in w) { ops.push(w); continue; }
    if (w.key === "S") { ops.push({ k: "child" }); children.push(w.v as V); continue; }
    if (w.key === "O") { ops.push({ k: "leaf", v: w.v }); continue; }
    // A container holding trees: take it apart, field by field.
    const d = w.v as Shaped;
    const fields = shape.table[w.key][d.tag];
    work.push({ k: "build", tag: d.tag, n: fields.length });
    for (let i = fields.length - 1; i >= 0; i--) work.push({ key: fields[i], v: d.fields[i] });
  }
  const rebuild = (results: unknown[]) => {
    const stack: unknown[] = [];
    let k = 0;
    for (const op of ops) {
      if (op.k === "leaf") stack.push(op.v);
      else if (op.k === "child") stack.push(results[k++]);
      else stack.push({ tag: op.tag, fields: stack.splice(stack.length - op.n, op.n) });
    }
    return stack[0];
  };
  return { children, rebuild };
}

// What a place of type tid holds: the type being folded itself, something
// without it, or a container with it inside, whose fields (per variant)
// have these types.
export function look(code: Code, def: Id, tid: Id, env: TypeEnv):
  | { k: "self" } | { k: "other" } | { k: "container"; key: string; variants: Id[]; fields: (variant: Id) => { tid: Id; env: TypeEnv }[] } {
  for (let t = code.nodes[tid]; t.kind === "tref" && env.has(t.target); t = code.nodes[tid]) ({ tid, env } = env.get(t.target)!);
  const t = code.nodes[tid];
  if (t.kind === "tref" && t.target === def) return { k: "self" };
  if (t.kind !== "tref" || !mentions(code, def, tid, env)) return { k: "other" };
  const td = code.nodes[(code.nodes[t.target] as NodeOf<"def">).body!] as NodeOf<"typedef">;
  const inner: TypeEnv = new Map(td.params.map((p, i) => [p, { tid: t.args[i], env }]));
  return {
    k: "container",
    key: canon(code, def, tid, env),
    variants: td.variants,
    fields: (variant) => (code.nodes[variant] as NodeOf<"variant">).fields.map((f) => ({ tid: (code.nodes[f] as NodeOf<"field">).type, env: inner })),
  };
}

// A type with its params filled in, as text: List Tree is "std.list(S)".
function canon(code: Code, def: Id, tid: Id, env: TypeEnv): string {
  for (let t = code.nodes[tid]; t.kind === "tref" && env.has(t.target); t = code.nodes[tid]) ({ tid, env } = env.get(t.target)!);
  const t = code.nodes[tid];
  if (t.kind !== "tref") return "F";
  if (t.target === def) return "S";
  return t.args.length ? `${t.target}(${t.args.map((a) => canon(code, def, a, env)).join(",")})` : t.target;
}
