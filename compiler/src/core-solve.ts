// The evaluator's solver for printed programs (C137d1): derivative and
// gradient, a relation run some way, and `for some`. Kept out of
// core-rt.ts because it carries the library (run.ts's preparation, the
// prelude): a printed program imports this only when it solves, and the
// program hands core-rt.ts these (useSolver).

import { META, makeRunner, solveAnswers } from "../../ters/src/lang/run.ts";
import type { Runtime } from "../../ters/src/lang/run.ts";
import type { Info } from "../../ters/src/lang/infer.ts";
import { satisfiable } from "../../ters/src/lang/relate.ts";
import { givenInOrder } from "../../ters/src/lang/ports.ts";
import { CONS, NIL } from "../../ters/src/lang/std.ts";
import { ownerOfTypeParts, useTarget, type Code, type Id, type Use } from "../../ters/src/model.ts";
import { FAIL, Unsupported, inn, useSolver, type Solver } from "./core-rt.ts";

// derivative(f) or gradient(f) of a function value (C137c20, scalar.ts):
// the evaluator's, on the program's code, which looks inside f (a printed
// closure carries its lambda and captures, RUNTIME.closure's src). What
// it gives is the evaluator's function, a stream of answers: called here
// for its one, and carrying its node so it can be looked inside again (a
// second derivative). Without the checker's info (a module or a page),
// the evaluator runs on what compiled JS's $loadProgram gives it.
export function deriveFn(id: Id, code?: Code, info?: Info, rt?: Runtime): (...xs: unknown[]) => unknown {
  if (!code) return () => { throw new Unsupported(`${id} without the program`); };
  let runner: ReturnType<typeof makeRunner> | undefined;
  const plain = (g: (...xs: unknown[]) => Iterable<unknown>) => {
    const p = (...xs: unknown[]) => { for (const v of g(...xs.map(inn))) return v; throw FAIL; };
    return Object.assign(p, { [META]: (g as unknown as Record<symbol, unknown>)[META] });
  };
  return (f) => {
    runner ??= makeRunner(code, info ?? ({ divergent: new Set(), owner: ownerOfTypeParts(code) } as unknown as Info), rt ?? { print: () => {} });
    for (const g of (runner.value(id) as (f: unknown) => Iterable<unknown>)(f)) return plain(g as (...xs: unknown[]) => Iterable<unknown>);
    throw new Error(`no ${id}`);
  };
}
// A relation run some way with one answer (C137c11, scalar.ts solveUse):
// the evaluator's solve on the program's code, its first answer's values.
// `spend`: one step of the printed program's budget, as the evaluator's
// solve spends its innermost fuel; false ends the search there.
export function solveFn(id: Id, code?: Code, all = false, spend?: () => boolean): (...xs: unknown[]) => unknown {
  if (!code) return () => { throw new Unsupported(`solve ${id} without the program`); };
  const n = code.nodes[id] as Use, keys = givenInOrder(code, n);
  const answers = (xs: unknown[]) => solveAnswers(code, n, Object.fromEntries(keys.map((k, i) => [k, inn(xs[i])])), { spend });
  // Every answer, a List of them (`solveAll`) made as it is read: a
  // periodic solution (an angle) has no end, and `one of` it stops at the
  // first that the rest of the search takes, as the evaluator's does.
  if (all) return (...xs) => lazyList(answers(xs));
  return (...xs) => {
    for (const bound of answers(xs)) return bound;
    throw new Error(`solving ${useTarget(code.nodes, n)} this way gives exactly one answer, and it gave none`);
  };
}
class LazyCell {
  private cell?: { tag: Id; fields: unknown[] };
  private it: Iterator<unknown>;
  constructor(it: Iterator<unknown>) { this.it = it; }
  private get forced() { if (!this.cell) { const r = this.it.next(); this.cell = r.done ? { tag: NIL, fields: [] } : { tag: CONS, fields: [r.value, new LazyCell(this.it)] }; } return this.cell; }
  get tag() { return this.forced.tag; }
  get fields() { return this.forced.fields; }
}
const lazyList = (it: Iterator<unknown>) => new LazyCell(it);
export const solver: Solver = { derive: deriveFn, solve: solveFn, exists: (code, f) => satisfiable(code, f as never) };
useSolver(solver);
