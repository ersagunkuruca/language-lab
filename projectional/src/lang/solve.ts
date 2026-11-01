// Running a function in one direction, inside a typed program. A `solve`
// node calls a function with some of its ports given by expressions and the
// others solved for and bound to binders the body can use. The ports of a
// function are its parameters and its result, "out". A predicate (a
// function returning Bool, built from equal, and, for some) is solved from
// out = true: that is how a network is used. All of a solution's ports are
// bound together, so several outputs stay consistent with each other.
//
// When the function reads as equations (equations.ts), the solver plans the
// direction before the program runs, and the effect follows from the plan:
// exactly one answer that can't fail (linear elimination, a single
// unguarded inverse) is pure. Otherwise (several answers, or possibly none)
// it has the Choice effect and enumerates the solutions, canonical first,
// the same stream the solver's `results` produces. `first` picks the
// canonical solution; `all` collects them (don't, for a periodic inverse:
// that stream is infinite).
//
// Any other function (it has cases, folds, text, data, or calls a builtin
// like `join text`) is run backwards by the relational interpreter
// (relate.ts). That direction is always Choice, and Diverge when its mode
// may not end (modes.ts; the checker asks it).

import { direction, results } from "../../../invertible/src/index.js";
import type { Code, Id, NodeOf } from "../model.ts";
import { relationFor, type Relation } from "./equations.ts";
import { SIGS, TRUE } from "./std.ts";

export interface SolvePlan {
  // "solver": equations for the relation solver. "relational": run by the
  // relational interpreter, through cases, folds and text.
  mode: "solver" | "relational";
  rel: Relation | null;
  // The ports handed to the solver as known: the given ones, less a
  // predicate's out = true.
  known: string[];
  // Solved from out = true (a predicate), rather than out = an expression.
  predicate: boolean;
  status: "solved" | "underdetermined";
  needMore: number;
  // From the solver's static view of this direction: several answers
  // (branches, periods) and/or possibly none (guards, checks, a search).
  many: boolean;
  canFail: boolean;
  // Pure exactly when there's always one answer; otherwise Choice.
  unique: boolean;
}

type Direction =
  | { kind: "function"; multiplicity: "one" | "many"; canFail: boolean }
  | { kind: "underdetermined"; need: number };

// Solves the checker found are in whole numbers (L38): a given port is an
// Int, so the generic + − · in the function are Int's, and the relational
// interpreter solves them as Ints; the equation solver is Float64's. The
// checker marks them from the types, before anything plans or runs them.
const whole = new WeakMap<Code, Set<Id>>();
export function solvesInWholeNumbers(code: Code, solve: Id): void {
  let s = whole.get(code);
  if (!s) whole.set(code, (s = new Set()));
  s.add(solve);
}

export function planSolve(code: Code, n: NodeOf<"solve">): SolvePlan {
  const relational = (): SolvePlan => {
    if (!runsBackwards(code, n.fn)) throw new Error(`${n.fn} can't be run backwards`);
    return { mode: "relational", rel: null, known: Object.keys(n.given), predicate: false, status: "solved", needMore: 0, many: true, canFail: true, unique: false };
  };
  if (whole.get(code)?.has(n.id) && runsBackwards(code, n.fn)) return relational();
  let r: ReturnType<typeof relationFor>;
  try { r = relationFor(code, n.fn); } catch { return relational(); }
  // A predicate reads as equations only when it is asked to be true.
  const outTrue = isTrue(code, n.given.out);
  if (r.predicate && (!outTrue || "out" in n.binds)) return relational();
  const known = Object.keys(n.given).filter((k) => !(r.predicate && k === "out"));
  const base = { mode: "solver" as const, rel: r.rel, known, predicate: r.predicate };
  const d = direction(r.rel as never, known) as Direction;
  if (d.kind === "underdetermined") return { ...base, status: "underdetermined", needMore: d.need, many: false, canFail: false, unique: false };
  const many = d.multiplicity === "many";
  return { ...base, status: "solved", needMore: 0, many, canFail: d.canFail, unique: !many && !d.canFail };
}

const isTrue = (code: Code, id: Id | undefined) => { const x = id ? code.nodes[id] : null; return x?.kind === "ref" && x.target === TRUE; };

// Functions the relational interpreter can run in any direction: defs with
// a body, and builtins that are functions (join text, show, less, …).
export function runsBackwards(code: Code, fn: Id): boolean {
  const t = code.nodes[fn];
  if (t?.kind === "def") return !!t.body && code.nodes[t.body].kind === "lambda";
  return t?.kind === "builtin" && !!SIGS[fn];
}

export function* solutions(rel: Relation, values: Record<string, number>): Generator<Record<string, number | null>> {
  for (const r of results(rel as never, values) as Iterable<{ values: Record<string, number | null> }>) yield r.values;
}
