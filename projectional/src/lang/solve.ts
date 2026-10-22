// Relations inside typed programs. A `solve` node uses a relation (a network
// def, an expression def, a relation or variadic builtin, or a numeric
// builtin read as `out = f(…)`) in one direction: the ports in `given` are
// computed by ordinary expressions, the ports in `binds` are solved for and
// bound to binders the body can use. All of a solution's ports are bound
// together, so several outputs stay consistent with each other.
//
// A function that isn't plain arithmetic (it has cases, folds, text, data,
// or calls a builtin like `join text`) is run backwards by the relational
// interpreter instead (relate.ts). That direction is always Choice, and
// Diverge too when the function folds or recurses, since unfolding can go
// on forever.
//
// For arithmetic, the effect follows from the solver's `direction`: exactly one answer that
// can't fail (linear elimination, a single unguarded inverse) is pure.
// Otherwise (several answers, or possibly none) it has the Choice effect and enumerates the solutions, canonical
// first, the same stream the solver's `results` produces. `first` picks the
// canonical solution; `all` collects them (don't, for a periodic inverse:
// that stream is infinite).

import { defineRelation, direction, results } from "../../../invertible/src/index.js";
import { call, v } from "../../../invertible/src/expr.js";
import type { Code, Id, NodeOf } from "../model.ts";
import { dependencies, subtree } from "../model.ts";
import { impl } from "../prelude.ts";
import { defRelation, RELATIONS, VARIADIC } from "../relational.ts";
import { SIGS } from "./std.ts";

interface Relation { name: string; ports: string[] }
const define = defineRelation as unknown as (spec: { name: string; ports: string[]; eqs?: unknown[] }) => Relation;

export function relationFor(code: Code, fn: Id, ports: string[]): Relation {
  const t = code.nodes[fn];
  if (t?.kind === "def") return defRelation(code, fn);
  if (t?.kind !== "builtin") throw new Error("not a relation");
  if (t.op in VARIADIC) {
    const { total, make } = VARIADIC[t.op as keyof typeof VARIADIC];
    const terms = ports.filter((p) => p !== total).sort();
    return (make as unknown as (l: string[], r: string[], name: string) => Relation)(terms, [total], `${t.op}${terms.length}`);
  }
  if (RELATIONS[t.op]) return RELATIONS[t.op] as unknown as Relation;
  if (t.op in impl) {
    const n = impl[t.op as keyof typeof impl].length;
    const args = Array.from({ length: n }, (_, i) => String(i));
    return define({ name: t.op, ports: [...args, "out"], eqs: [{ lhs: v("out"), rhs: call(t.op, ...args.map((a) => v(a))) }] });
  }
  throw new Error(`${t.op} is not a relation`);
}

export interface SolvePlan {
  // "solver": equations for the relation solver. "relational": run by the
  // relational interpreter, through cases, folds and text.
  mode: "solver" | "relational";
  rel: Relation | null;
  status: "solved" | "underdetermined";
  needMore: number;
  // From the solver's static view of this direction: several answers
  // (branches, periods) and/or possibly none (guards, checks, a search).
  many: boolean;
  canFail: boolean;
  // Pure exactly when there's always one answer; otherwise Choice.
  unique: boolean;
  // Relational only: the search may unfold forever (Diverge).
  loops: boolean;
}

type Direction =
  | { kind: "function"; multiplicity: "one" | "many"; canFail: boolean }
  | { kind: "underdetermined"; need: number };

export function planSolve(code: Code, n: NodeOf<"solve">): SolvePlan {
  const ports = [...Object.keys(n.given), ...Object.keys(n.binds)];
  let rel: Relation;
  try {
    rel = relationFor(code, n.fn, ports);
  } catch (e) {
    if (!relational(code, n.fn)) throw e;
    return { mode: "relational", rel: null, status: "solved", needMore: 0, many: true, canFail: true, unique: false, loops: mayLoop(code, n.fn) };
  }
  const d = direction(rel as never, Object.keys(n.given)) as Direction;
  if (d.kind === "underdetermined") return { mode: "solver", rel, status: "underdetermined", needMore: d.need, many: false, canFail: false, unique: false, loops: false };
  const many = d.multiplicity === "many";
  return { mode: "solver", rel, status: "solved", needMore: 0, many, canFail: d.canFail, unique: !many && !d.canFail, loops: false };
}

// Functions the relational interpreter can run in any direction: defs with
// a body, and builtins that are functions (join text, show, less, …).
function relational(code: Code, fn: Id): boolean {
  const t = code.nodes[fn];
  if (t?.kind === "def") return !!t.body && code.nodes[t.body].kind === "lambda";
  return t?.kind === "builtin" && !!SIGS[fn];
}

// Does running fn backwards involve unfolding: a fold, or a recursive call?
function mayLoop(code: Code, fn: Id): boolean {
  if (code.nodes[fn].kind !== "def") return false;
  return [fn, ...dependencies(code, fn)].some((d) => code.nodes[d].kind === "def" &&
    (dependencies(code, d).includes(d) || subtree(code, d).some((x) => code.nodes[x].kind === "fold")));
}

export function* solutions(rel: Relation, values: Record<string, number>): Generator<Record<string, number | null>> {
  for (const r of results(rel as never, values) as Iterable<{ values: Record<string, number | null> }>) yield r.values;
}
