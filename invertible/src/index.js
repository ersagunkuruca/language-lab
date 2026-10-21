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

import { relation, plan, run, describe, shortfall, showEq } from './relation.js';
import { show, evaluate as evalExpr } from './expr.js';

export { show, showEq };
export * as examples from './examples.js';

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
  const solutions = run(rel, a.plan, values, opts).map(({ values: v, path }) => ({ values: v, path }));
  return { ...a, canonical: solutions[0]?.values ?? null, solutions };
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
