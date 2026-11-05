// The steps of an effect (BACKLOG L229b, ANSWERED-LATER.md "The steps of
// an effect"): `steps of E(c)` runs the computation c to its first
// operation of E and gives that operation back as data, with its rest, so
// a program that drives fibers doesn't write the effect twice (a Step type
// whose cases are E's operations again, and a handler that only wraps
// them). The shallow handler's view (Hillerström and Lindley, APLAS 2018;
// OCaml 5's Effect.Shallow), made of what the language has: a type derived
// from E and a deep handler whose cases are generated, no new node kind.
//
// For E's operations op_i(fields_i) returns T_i, `Steps of E` has the
// parameters R (what c gives) and ε (what c does besides E, a row), and
//   - a case per operation, op_i(fields_i, rest: (T_i) -[ε]-> Steps of E R ε),
//   - done(value: R), for a computation that ends without performing.
// A rest's row is ε, c's own less E: it runs a piece of c, from one
// operation to the next, so it has no Diverge c doesn't have. The loop
// that drives the steps is the program's own and keeps its own.
//
// E's operations are answered later (`later`): a case of E given the rest
// is what keeps it. E taken by name, so a computation with two effects can
// be stepped over either.

import type { Code, Id, NodeOf } from "../model.ts";
import type { Lang } from "./dsl.ts";

export interface Steps {
  // The type `Steps of E`, its cases by operation, and done.
  type: Id; v: Record<Id, Id>; done: Id;
  // `steps of E`: (() -[E, ε]-> R) -[ε]-> Steps of E R ε.
  steps: Id;
}

// Why E can't be stepped over, or null.
export function cantStep(code: Code, effect: Id): string | null {
  const d = code.nodes[effect];
  const td = d?.kind === "def" && d.body ? code.nodes[d.body] : null;
  if (td?.kind !== "typedef" || !td.effect) return "it isn't an effect";
  if (td.params.length) return "it takes types (not yet)";
  const ops = td.variants.map((v) => code.nodes[v] as NodeOf<"variant">);
  if (!ops.length) return "it has no operations";
  const now = ops.find((o) => !o.later || !o.returns || o.params?.length);
  if (now) return `its operation ${now.id} isn't answered later with an answer`;
  return null;
}

// Steps of E written into k's code: the type and the function, made once.
export function stepsOf(k: Lang, effect: Id): Steps {
  const effectName = k.names[effect] ?? effect, opNames = k.names;
  const why = cantStep(k.code, effect);
  if (why) throw new Error(`can't take the steps of ${effectName}: ${why}`);
  const td = k.code.nodes[(k.code.nodes[effect] as NodeOf<"def">).body!] as NodeOf<"typedef">;
  const ops = td.variants;
  // A type of E's, copied: a node has one place.
  const copy = (t: Id): Id => {
    const n = k.code.nodes[t];
    if (n.kind === "tfun") return k.tfun(n.params.map(copy), copy(n.result), [...(n.effects ?? [])]);
    const r = n as NodeOf<"tref">;
    return k.tref(r.target, ...r.args.map(copy));
  };
  const field = (f: Id) => k.code.nodes[f] as NodeOf<"field">;
  const T = k.type(`Steps of ${effectName}`, ["R", "e"], [
    ...ops.map((op): [string, [string, (self: Id, ps: Id[]) => Id][]] => {
      const o = k.code.nodes[op] as NodeOf<"variant">;
      return [opNames[op], [
        ...o.fields.map((f): [string, (self: Id, ps: Id[]) => Id] => [k.names[f] ?? "x", () => copy(field(f).type)]),
        ["rest", (self, [r, e]) => k.tfun([copy(o.returns!)], k.tref(self, k.tref(r), k.tref(e)), [e])],
      ]];
    }),
    ["done", [["value", (_, [r]) => k.tref(r)]]],
  ]);
  const v: Record<Id, Id> = {};
  ops.forEach((op) => (v[op] = T.v[opNames[op]]));
  const steps = k.def(`steps of ${effectName}`);
  k.define(steps, k.fn(["computation"], (c) => k.handle(k.call(c), ops.map((op) => {
    const o = k.code.nodes[op] as NodeOf<"variant">;
    const names = [...o.fields.map((f) => k.names[f] ?? "x"), "rest"];
    return { variant: op, names, body: (xs: Id[]) => k.call(v[op], ...xs) };
  }), ["value", (x) => k.call(T.v.done, x)])));
  return { type: T.def, v, done: T.v.done, steps };
}
