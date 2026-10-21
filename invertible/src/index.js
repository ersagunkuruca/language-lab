// Embedding API. Everything a host editor needs to put relation nodes in a
// graph: define a relation, ask which port choices work, get the derived
// program for one choice, and run it. All returned data is plain JSON
// (expression trees are { k: 'num' | 'var' | 'call', ... }).
//
//   import { defineRelation, analyze, evaluate, directions, checkWiring } from './src/index.js';
//
// In a node editor: ports wired from the enclosing function's inputs are
// `known`; ports wired towards its outputs are `wanted`. A whole graph of
// relation nodes is itself a relation: pass the nodes as `uses` with `bind`
// mapping each node's ports to the graph's wire names, and solve the graph in
// one go. That way inverting the surrounding function inverts every node in it.

import { relation, plan, run, stream, describe, shortfall, showEq } from './relation.js';
import { show, evaluate as evalExpr, vars } from './expr.js';

export { show, showEq };
export * as examples from './examples.js';
export { balance, ratio, sum, product, negate, reciprocal, view } from './atoms.js';

// { name, ports, eqs, laws?, uses? } — eqs/laws are strings like 'x = r * cos(θ)'
// or { lhs, rhs } expression trees. uses: [{ rel, bind: { innerPort: outerWire } }].
export const defineRelation = relation;

// The program the solver derives when `known` ports are inputs.
//   status: 'solved' | 'underdetermined'
//   needMore: how many more ports must become known (0 when solved)
//   steps: [{ kind: 'solve' | 'linear' | 'check' | 'newton', text, from, ... , raw }]
//     raw keeps the expression trees, e.g. raw.branches[i].expr for 'solve'
//     and raw.exprs[x] for 'linear', so a host can render them its own way.
export function analyze(rel, known, opts = {}) {
  const p = plan(rel, known, opts);
  const steps = describe(p, rel).map((d, i) => ({ ...d, raw: p.steps[i] }));
  return {
    status: p.freePorts.length ? 'underdetermined' : 'solved',
    needMore: p.freePorts.length ? shortfall(rel, known, opts) : 0,
    freePorts: p.freePorts,
    // number of equations left over as consistency checks (redundancy)
    checks: p.steps.filter((s) => s.type === 'check').length,
    steps,
    plan: p,
  };
}

// Run with concrete values. `values` maps known ports to numbers.
//   canonical: port values on the canonical branch, or null
//   solutions: every consistent solution in the k-window, canonical first,
//              each with the branch choices (`path`) that produced it
export function evaluate(rel, values, opts = {}) {
  const a = analyze(rel, Object.keys(values), opts);
  if (a.status !== 'solved') return { ...a, canonical: null, solutions: [] };
  const solutions = run(rel, a.plan, values, opts).map(({ values: v, path, free }) => ({ values: v, path, free }));
  return { ...a, canonical: solutions[0]?.values ?? null, solutions };
}

// ---- multiple results, Verse style ----------------------------------------
// A relation solved in some direction is an expression with 0, 1 or many
// results. `results` is the lazy, ordered stream of them (canonical first,
// infinite for periodic inverses); `first` is the function view (the
// canonical branch, or null for failure); `only` succeeds only when there is
// exactly one result. Each result is { values, path, free }: `free` lists
// ports the equations leave unconstrained (their value is null).
export function* results(rel, values, opts = {}) {
  const a = analyze(rel, Object.keys(values), opts);
  if (a.status !== 'solved') return;
  for (const { values: v, path, free } of stream(rel, a.plan, values, opts)) yield { values: v, path, free };
}

export function first(rel, values, opts = {}) {
  for (const r of results(rel, values, opts)) return r.values;
  return null;
}

export function only(rel, values, opts = {}) {
  const it = results(rel, values, opts);
  const a = it.next(), b = it.next();
  return !a.done && b.done ? a.value.values : null;
}

export function take(iterable, n) {
  const out = [];
  if (n <= 0) return out;
  for (const x of iterable) if (out.push(x) >= n) break;
  return out;
}

// ---- one direction as a typed thing ----------------------------------------
// direction(rel, known) answers "what is this relation when these ports are
// inputs?" statically, before any values exist, in terms a type system can use:
//
//   { kind: 'function', inputs, outputs, multiplicity, canFail, run, all }
//       Every output is determined. multiplicity is 'one' when every step
//       has a single branch, else 'many' (sqrt, asin, a torn quadratic): that
//       is a Choice effect. canFail is true when some input values give no
//       result (division, sqrt, log, asin, a consistency check, a numeric
//       search): that is a Fail effect. run(values) is the canonical result
//       (first) or null; all(values) is the lazy results stream.
//
//   { kind: 'underdetermined', inputs, need, completions, with }
//       The known ports don't pin the rest down: `need` more ports must be
//       chosen, a continuum, not a list to enumerate. completions lists the
//       minimal sets of extra ports that would make it a function, and
//       with(extra) returns that direction. A caller that wants Choice here
//       should treat the extra ports as parameters, not enumerate them.
const PARTIAL = new Set(['div', 'sqrt', 'log', 'asin', 'acos', 'pow']);
const partialIn = (e) => e.k === 'call' && (PARTIAL.has(e.f) || e.args.some(partialIn));

export function direction(rel, known, opts = {}) {
  const a = analyze(rel, known, opts);
  const inputs = [...known];
  if (a.status !== 'solved') {
    const free = a.freePorts;
    const completions = [];
    const pick = (start, acc) => {
      if (acc.length === a.needMore) {
        if (!plan(rel, [...known, ...acc], opts).freePorts.length) completions.push(acc);
        return;
      }
      for (let i = start; i < free.length; i++) pick(i + 1, [...acc, free[i]]);
    };
    pick(0, []);
    return { kind: 'underdetermined', inputs, need: a.needMore, completions, with: (extra) => direction(rel, [...known, ...extra], opts) };
  }
  const steps = a.plan.steps;
  const branchy = (s) => (s.type === 'solve' && (s.branches.length > 1 || s.branches.some((b) => b.params.length))) || s.type === 'tear';
  const exprs = steps.flatMap((s) =>
    s.type === 'solve' ? s.branches.map((b) => b.expr)
      : s.type === 'linear' ? Object.values(s.exprs)
        : s.type === 'tear' ? s.inner.flatMap((i) => i.branches.map((b) => b.expr)) : []);
  const canFail = steps.some((s) => s.type === 'check' || s.type === 'tear' || s.type === 'newton' ||
    (s.branches ?? []).some((b) => b.guards.length)) || exprs.some(partialIn);
  return {
    kind: 'function',
    inputs,
    outputs: rel.ports.filter((p) => !known.includes(p)),
    multiplicity: steps.some(branchy) ? 'many' : 'one',
    canFail,
    run: (values) => first(rel, values, opts),
    all: (values) => results(rel, values, opts),
  };
}

// For a node in an editor: are the outputs it is wired to determined by the
// inputs it is wired from? Ports may be left unwired.
export function checkWiring(rel, known, wanted, opts = {}) {
  const both = known.filter((p) => wanted.includes(p));
  const p = plan(rel, known, opts);
  const undetermined = wanted.filter((w) => p.unknown.includes(w));
  return { ok: !both.length && !undetermined.length, undetermined, conflicting: both };
}

// Every minimal set of known ports that determines all the others. Useful
// for showing which port choices make sense before anything is wired.
export function directions(rel, opts = {}) {
  const out = [];
  const n = rel.ports.length;
  const masks = Array.from({ length: (1 << n) - 1 }, (_, i) => i + 1);
  const size = (m) => rel.ports.filter((_, i) => m & (1 << i)).length;
  for (const mask of masks.sort((a, b) => size(a) - size(b) || a - b)) {
    const ks = rel.ports.filter((_, i) => mask & (1 << i));
    if (out.some((d) => d.every((p) => ks.includes(p)))) continue; // not minimal
    if (!plan(rel, ks, opts).freePorts.length) out.push(ks);
  }
  return out;
}

// Evaluate one expression tree (e.g. a derived inverse) with an environment.
export const evaluateExpr = evalExpr;
