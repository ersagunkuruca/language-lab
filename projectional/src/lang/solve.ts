// Relations inside typed programs. A `solve` node uses a relation (a network
// def, an expression def, a relation or variadic builtin, or a numeric
// builtin read as `out = f(…)`) in one direction: the ports in `given` are
// computed by ordinary expressions, the ports in `binds` are solved for and
// bound to binders the body can use. All of a solution's ports are bound
// together, so several outputs stay consistent with each other.
//
// The effect follows from the solver's `direction`: exactly one answer that
// can't fail (linear elimination, a single unguarded inverse) is pure.
// Otherwise (several answers, or possibly none) it has the Choice effect and enumerates the solutions, canonical
// first, the same stream the solver's `results` produces. `first` picks the
// canonical solution; `all` collects them (don't, for a periodic inverse:
// that stream is infinite).

import { defineRelation, direction, results } from "../../../invertible/src/index.js";
import { call, v } from "../../../invertible/src/expr.js";
import type { Code, Id, NodeOf } from "../model.ts";
import { impl } from "../prelude.ts";
import { defRelation, RELATIONS, VARIADIC } from "../relational.ts";

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
  rel: Relation;
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

export function planSolve(code: Code, n: NodeOf<"solve">): SolvePlan {
  const ports = [...Object.keys(n.given), ...Object.keys(n.binds)];
  const rel = relationFor(code, n.fn, ports);
  const d = direction(rel as never, Object.keys(n.given)) as Direction;
  if (d.kind === "underdetermined") return { rel, status: "underdetermined", needMore: d.need, many: false, canFail: false, unique: false };
  const many = d.multiplicity === "many";
  return { rel, status: "solved", needMore: 0, many, canFail: d.canFail, unique: !many && !d.canFail };
}

export function* solutions(rel: Relation, values: Record<string, number>): Generator<Record<string, number | null>> {
  for (const r of results(rel as never, values) as Iterable<{ values: Record<string, number | null> }>) yield r.values;
}
