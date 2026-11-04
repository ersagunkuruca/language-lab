// The evaluator's solver for printed programs (C137d1): derivative and
// gradient, a relation run some way, and `for some`. Kept out of
// core-rt.ts because it carries the library (run.ts's preparation, the
// prelude): a printed program imports this only when it solves, and the
// program hands core-rt.ts these (useSolver).

import { META, equal, makeRunner, resolvedFor, solveAnswers, type Value } from "../../ters/src/lang/run.ts";
import type { Runtime } from "../../ters/src/lang/run.ts";
import type { Info } from "../../ters/src/lang/infer.ts";
import { satisfiable } from "../../ters/src/lang/relate.ts";
import { answerKeys, filled, givenInOrder } from "../../ters/src/lang/ports.ts";
import { needsResolving } from "../../ters/src/lang/arith.ts";
import { infer } from "../../ters/src/lang/infer.ts";
import { add as intAdd, intLit, neg as intNeg, sub as intSub } from "../../ters/src/lang/int.ts";
import { INT } from "../../ters/src/lang/types.ts";
import { modeCompiler, type ModeEmit } from "./modes.ts";
import { compileSolve } from "./relation.ts";
import { planSolve } from "../../ters/src/lang/solve.ts";
import { bindsOf } from "./uses.ts";
import { $FN, $clean, $close, $key, $ok, $planned, $solveRuntime, plans } from "./plan-rt.js";
import { ownerOfTypeParts, useTarget, type Code, type Id, type NodeOf, type Use } from "../../ters/src/model.ts";
import { FAIL, Unsupported, inn, lazyList, usePlans, useSolver, type Solver } from "./core-rt.ts";

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
  let written: ((...xs: unknown[]) => Iterable<Value[]>) | null | undefined;
  const answers = (xs: unknown[]) => {
    if (written === undefined) written = planWritten(code, id);
    return written ? written(...xs.map(inn)) : solveAnswers(code, n, Object.fromEntries(keys.map((k, i) => [k, inn(xs[i])])), { spend });
  };
  // Every answer, a List of them (`solveAll`) made as it is read: a
  // periodic solution (an angle) has no end, and `one of` it stops at the
  // first that the rest of the search takes, as the evaluator's does.
  if (all) return (...xs) => lazyList(answers(xs)[Symbol.iterator]());
  return (...xs) => {
    for (const bound of answers(xs)) return bound;
    throw new Error(noAnswer(code, id));
  };
}
// A solve's plan written out once as a JavaScript function, as compile.ts's
// modules have it, rather than worked out again on every call (C137d8):
// the pedal solves twice a sample. Numbers solved by equations are the
// solver's plan (relation.ts compileSolve); a relational solve whose mode
// has one answer or none (det, semidet: MODES.md), the mode's plan
// (modes.ts), a call in it run forward the evaluator's, on the program's
// code. Null when the plan can't be written out: the evaluator's solve
// runs it (solveAnswers). `given`'s ports come in givenInOrder's order;
// the function gives the answers' binds in answerKeys's.
function planWritten(given: Code, id: Id): ((...xs: unknown[]) => Iterable<Value[]>) | null {
  try {
    const code = filled(needsResolving(given) ? resolvedFor(given, infer(given), undefined).code : given);
    const n = code.nodes[id] as Use | undefined;
    if (!n) return null;
    const binds = Object.keys(bindsOf(n));
    if (binds.join() !== answerKeys(given, given.nodes[id] as Use).join()) return null;
    const p = planSolve(code, n);
    if (p.mode === "solver") {
      const w = solverPlan(given, id);
      if (!w) return null;
      return new Function(...PLAN_NAMES, `"use strict";\n${w}`)($planned, $solveRuntime, $ok, $clean, $key, $close, $FN) as (...xs: unknown[]) => Iterable<Value[]>;
    }
    let runner: ReturnType<typeof makeRunner> | undefined;
    const fns: ((...xs: Value[]) => unknown)[] = [], consts: unknown[] = [];
    const NO = Symbol("no answer");
    // A function the evaluator runs forward: its first answer, or none.
    const forward = (target: Id) => (...xs: Value[]) => {
      runner ??= makeRunner(code, { divergent: new Set(), owner: ownerOfTypeParts(code) } as unknown as Info, { print: () => {} });
      for (const v of (runner.value(target) as (...a: Value[]) => Iterable<Value>)(...xs)) return v;
      return NO;
    };
    const emit: ModeEmit = {
      value(v) {
        const x = code.nodes[v];
        if (x.kind === "lit") {
          // A number written in the program as itself, as modes.ts reads a
          // product or quotient by one backwards.
          const val = x.of === INT ? intLit(x.value) : x.value;
          if (typeof val === "number" && Number.isFinite(val) && !Object.is(val, -0)) return val < 0 ? `(${val})` : String(val);
          consts.push(val);
          return `K[${consts.length - 1}]`;
        }
        if (x.kind === "ref" && code.nodes[x.target]?.kind === "variant" && !(code.nodes[x.target] as NodeOf<"variant">).fields.length) return `{ tag: ${JSON.stringify(x.target)}, fields: [] }`;
        return null;
      },
      forward(c, args) {
        const f = code.nodes[c.fn];
        const t = f?.kind === "ref" ? code.nodes[f.target] : undefined;
        if (f?.kind !== "ref" || (t?.kind !== "builtin" && t?.kind !== "def")) return null;
        fns.push(forward(f.target));
        return { js: `F[${fns.length - 1}](${args.join(", ")})`, partial: true };
      },
      tag: (v) => JSON.stringify(v),
    };
    const modes = modeCompiler(code, {});
    if (!modes.solver(n, "solve$", emit)) return null;
    const make = new Function("$no", "$eq", "$int", "F", "K", `"use strict";\n${modes.code.join("\n")}\nreturn solve$;`);
    return make(NO, equal, { add: intAdd, sub: intSub, neg: intNeg }, fns, consts) as (...xs: unknown[]) => Value[][];
  } catch {
    return null;
  }
}
// What a written-out plan calls, from plan-rt.js (core-rt.ts RUNTIME.plans).
export const PLAN_NAMES = ["$planned", "$solveRuntime", "$ok", "$clean", "$key", "$close", "$FN"] as const;
// A solve the equations' solver plans (relation.ts compileSolve, C137d8)
// as a function body over PLAN_NAMES, returning the function from the
// solve's givens (givenInOrder) to its answers' binds (answerKeys): the
// plan core-js.ts prints, so the program's nodes needn't be shipped
// (C167a). Null when the solve isn't one the solver plans.
export function solverPlan(given: Code, id: Id): string | null {
  try {
    const code = filled(needsResolving(given) ? resolvedFor(given, infer(given), undefined).code : given);
    const n = code.nodes[id] as Use | undefined;
    if (!n) return null;
    const binds = Object.keys(bindsOf(n));
    if (binds.join() !== answerKeys(given, given.nodes[id] as Use).join()) return null;
    const p = planSolve(code, n);
    if (p.mode !== "solver" || p.status !== "solved") return null;
    const order = givenInOrder(given, given.nodes[id] as Use), known = [...p.known].sort((a, b) => order.indexOf(a) - order.indexOf(b));
    const c = compileSolve("solve$", p.rel as never, known, binds);
    const at = known.map((k) => order.indexOf(k));
    return `${c.code}\nreturn (...xs) => solve$(${at.map((i) => `xs[${i}]`).join(", ")});`;
  } catch {
    return null;
  }
}
// What a solve's error says when it gives no answer and must give one.
export const noAnswer = (code: Code, id: Id) => `solving ${useTarget(code.nodes, code.nodes[id] as Use)} this way gives exactly one answer, and it gave none`;
// Whether this solve's plan is written out (above), rather than run by the
// evaluator's solver on every call (C137d9: a sound that solves that way
// is too slow for the audio thread).
export const writtenOut = (code: Code, id: Id): boolean => planWritten(code, id) !== null;
export const solver: Solver = { derive: deriveFn, solve: solveFn, exists: (code, f) => satisfiable(code, f as never) };
useSolver(solver);
usePlans(plans);
