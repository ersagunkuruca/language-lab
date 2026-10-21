// Relations: functions without a fixed direction.
//
// A relation is a set of ports plus equations that must hold between them.
// There is no "input" or "output" in the definition. When you use it, you say
// which ports you know, and the solver works out a plan (an ordinary,
// directional program) for computing the rest, including every branch of any
// multi-valued inverse it had to take along the way.

import { vars, rename, show, substitute, simplify, countVar, evaluate, derive, FN, v } from './expr.js';
import { parseEquation } from './parse.js';
import { solveLinear } from './linear.js';

let instanceCounter = 0;

// relation({ name, ports, eqs, laws, uses })
//   eqs:  equations that define the relation, as strings or { lhs, rhs }
//   laws: equations that follow from eqs but that the solver can't derive
//         by itself (e.g. x² + y² = r² for polar coordinates). They give the
//         solver more ways in; tests check them numerically against eqs.
//   uses: [{ rel, bind }] embeds other relations, binding their ports to
//         variables here. Their internal variables stay private.
export function relation({ name, ports, eqs = [], laws = [], uses = [] }) {
  const toEq = (e, law) => ({ ...(typeof e === 'string' ? parseEquation(e) : e), law });
  const all = [...eqs.map((e) => toEq(e, false)), ...laws.map((e) => toEq(e, true))];
  for (const { rel, bind } of uses) {
    const prefix = `${rel.name}${++instanceCounter}.`;
    const map = (n) => (n in bind ? bind[n] : prefix + n);
    for (const eq of rel.eqs) all.push({ lhs: rename(eq.lhs, map), rhs: rename(eq.rhs, map), law: eq.law });
  }
  const varSet = new Set(ports);
  for (const eq of all) { vars(eq.lhs, varSet); vars(eq.rhs, varSet); }
  return { name, ports, eqs: all, vars: [...varSet] };
}

export const showEq = (eq) => `${show(eq.lhs)} = ${show(eq.rhs)}`;

// ---- planning --------------------------------------------------------------

// Undo the expression tree around the single occurrence of x, one primitive
// at a time, using each primitive's own inverse table. Multi-valued inverses
// multiply out into branches.
function peel(e, target, x, fresh) {
  if (e.k === 'var') return [{ expr: simplify(target), params: [], guards: [] }];
  const i = e.args.findIndex((a) => countVar(a, x) > 0);
  const out = [];
  for (const br of FN[e.f].inv[i](target, e.args, fresh)) {
    for (const inner of peel(e.args[i], br.expr, x, fresh)) {
      out.push({
        expr: inner.expr,
        params: [...br.params, ...inner.params],
        guards: [...br.guards.map(simplify), ...inner.guards],
      });
    }
  }
  return out;
}

function isolate(eq, x, fresh) {
  const inL = countVar(eq.lhs, x), inR = countVar(eq.rhs, x);
  if (inL + inR === 1) {
    const [e, target] = inL ? [eq.lhs, eq.rhs] : [eq.rhs, eq.lhs];
    return peel(e, target, x, fresh);
  }
  const lin = solveLinear([eq], [x]);
  return lin ? [{ expr: simplify(lin[x]), params: [], guards: [] }] : null;
}

function* combinations(arr, k, start = 0, acc = []) {
  if (acc.length === k) { yield acc; return; }
  for (let i = start; i < arr.length; i++) yield* combinations(arr, k, i + 1, [...acc, arr[i]]);
}

// Build a plan for computing every variable of `rel` from the `known` ports.
// Strategy, in order of preference:
//   1. an equation with one unknown: isolate it (closed form, maybe branches)
//   2. a square block of equations, linear in its unknowns: eliminate exactly
//   3. a square nonlinear block: Newton's method using symbolic derivatives
// Equations whose variables are all known become checks, which is how
// redundant equations pick the right branch of a multi-valued inverse.
export function plan(rel, known, { numeric = true } = {}) {
  const K = new Set(known);
  let rem = rel.eqs.slice();
  const steps = [];
  let kCount = 0;
  const unknownsOf = (eq) => [...vars(eq.rhs, vars(eq.lhs))].filter((n) => !K.has(n));

  for (;;) {
    rem = rem.filter((eq) => {
      if (unknownsOf(eq).length) return true;
      steps.push({ type: 'check', eq });
      return false;
    });
    if (rel.vars.every((n) => K.has(n))) break;

    let best = null;
    for (const eq of rem) {
      const u = unknownsOf(eq);
      if (u.length !== 1) continue;
      let t = 0;
      const branches = isolate(eq, u[0], () => `#t${t++}`);
      if (!branches) continue;
      const score = branches.length * 10 + t * 5 + (eq.law ? 1 : 0);
      if (!best || score < best.score) best = { score, eq, x: u[0], branches };
    }
    if (best) {
      // give the branch parameters stable names k1, k2, ...
      const names = {};
      const fix = (e) => {
        for (const n of vars(e)) if (n.startsWith('#t') && !(n in names)) names[n] = v(`#k${++kCount}`);
        return substitute(e, names);
      };
      const branches = best.branches.map((b) => ({
        expr: fix(b.expr),
        guards: b.guards.map(fix),
        params: b.params.map((p) => names[p]?.name ?? p),
      }));
      steps.push({ type: 'solve', x: best.x, eq: best.eq, branches });
      K.add(best.x);
      rem = rem.filter((e) => e !== best.eq);
      continue;
    }

    let block = null;
    outer: for (const mode of numeric ? ['linear', 'newton'] : ['linear']) {
      // Laws are redundant with the defining equations, so they never count
      // towards a square block (that would fake an extra degree of freedom).
      const defining = rem.filter((eq) => !eq.law);
      for (let size = 2; size <= Math.min(defining.length, 6); size++) {
        for (const eqs of combinations(defining, size)) {
          const us = [...new Set(eqs.flatMap(unknownsOf))];
          if (us.length !== size) continue;
          if (mode === 'linear') {
            const sol = solveLinear(eqs, us);
            if (sol) { block = { type: 'linear', xs: us, eqs, exprs: sol }; break outer; }
          } else {
            const residuals = eqs.map((eq) => simplify({ k: 'call', f: 'sub', args: [eq.lhs, eq.rhs] }));
            const jac = residuals.map((r) => us.map((u) => derive(r, u)));
            block = { type: 'newton', xs: us, eqs, residuals, jac };
            break outer;
          }
        }
      }
    }
    if (!block) break;
    steps.push(block);
    block.xs.forEach((x) => K.add(x));
    rem = rem.filter((e) => !block.eqs.includes(e));
  }

  const unknown = rel.vars.filter((n) => !K.has(n));
  return {
    known: [...known],
    steps,
    unknown,
    // ports we could not determine: the known set is underdetermined
    freePorts: rel.ports.filter((p) => unknown.includes(p)),
  };
}

// ---- running a plan --------------------------------------------------------

function kOrder(window) {
  const ks = [0];
  for (let i = 1; i <= window; i++) ks.push(i, -i);
  return ks;
}

function* assignments(params, ks) {
  if (!params.length) { yield {}; return; }
  const [p, ...rest] = params;
  for (const k of ks) for (const a of assignments(rest, ks)) yield { [p]: k, ...a };
}

function newton(step, env, guess) {
  const x = step.xs.map((u) => guess[u] ?? 1);
  for (let iter = 0; iter < 100; iter++) {
    const e = { ...env };
    step.xs.forEach((u, i) => (e[u] = x[i]));
    const F = step.residuals.map((r) => evaluate(r, e));
    if (F.every((f) => Math.abs(f) < 1e-13)) return x;
    const J = step.jac.map((row) => row.map((d) => evaluate(d, e)));
    // solve J·dx = −F by Gaussian elimination with partial pivoting
    const n = x.length;
    const A = J.map((row, i) => [...row, -F[i]]);
    for (let c = 0; c < n; c++) {
      let p = c;
      for (let r = c + 1; r < n; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
      [A[c], A[p]] = [A[p], A[c]];
      if (Math.abs(A[c][c]) < 1e-300) return null;
      for (let r = 0; r < n; r++) {
        if (r === c) continue;
        const f = A[r][c] / A[c][c];
        for (let j = c; j <= n; j++) A[r][j] -= f * A[c][j];
      }
    }
    for (let i = 0; i < n; i++) x[i] += A[i][n] / A[i][i];
    if (!x.every(Number.isFinite)) return null;
  }
  return null;
}

const clean = (x) => {
  if (Math.abs(x) < 1e-12) return 0;
  return +x.toPrecision(12);
};

// Execute a plan on concrete values. Branch parameters k are enumerated over
// 0, 1, −1, ..., ±window. Every complete, consistent assignment is a solution;
// the first one found (canonical branch of every step, k = 0 where possible)
// is the canonical solution.
export function run(rel, p, values, { window = 1, limit = 64, tol = 1e-9, guess = {} } = {}) {
  const ks = kOrder(window);
  const seen = new Set();
  const solutions = [];
  const ok = (x) => Number.isFinite(x);

  function go(i, env, path) {
    if (solutions.length >= limit) return;
    if (i === p.steps.length) {
      const sol = Object.fromEntries(rel.ports.filter((n) => n in env).map((n) => [n, clean(env[n])]));
      const key = Object.values(sol).map((x) => Math.round(x * 1e8)).join();
      if (!seen.has(key)) { seen.add(key); solutions.push({ values: sol, env, path }); }
      return;
    }
    const s = p.steps[i];
    if (s.type === 'check') {
      const l = evaluate(s.eq.lhs, env), r = evaluate(s.eq.rhs, env);
      if (ok(l) && ok(r) && Math.abs(l - r) <= tol * (1 + Math.abs(l) + Math.abs(r))) go(i + 1, env, path);
    } else if (s.type === 'solve') {
      s.branches.forEach((b, bi) => {
        for (const a of assignments(b.params, ks)) {
          const e = { ...env, ...a };
          const x = evaluate(b.expr, e);
          if (!ok(x) || !b.guards.every((g) => evaluate(g, e) >= -tol)) continue;
          go(i + 1, { ...env, [s.x]: x }, [...path, { x: s.x, branch: bi, ...a }]);
        }
      });
    } else if (s.type === 'linear') {
      const e = { ...env };
      for (const x of s.xs) e[x] = evaluate(s.exprs[x], env);
      if (s.xs.every((x) => ok(e[x]))) go(i + 1, e, path);
    } else if (s.type === 'newton') {
      const x = newton(s, env, guess);
      if (x) go(i + 1, { ...env, ...Object.fromEntries(s.xs.map((u, j) => [u, x[j]])) }, path);
    }
  }

  go(0, { ...values }, []);
  return solutions;
}

// How many more ports must be known before the plan is complete?
export function shortfall(rel, known, opts = {}) {
  const p = plan(rel, known, opts);
  for (let n = 1; n <= p.freePorts.length; n++) {
    for (const extra of combinations(p.freePorts, n)) {
      if (!plan(rel, [...known, ...extra], opts).freePorts.length) return n;
    }
  }
  return 0;
}

export function solve(rel, values, opts = {}) {
  const p = plan(rel, Object.keys(values), opts);
  const solutions = p.freePorts.length ? [] : run(rel, p, values, opts);
  return { plan: p, solutions, canonical: solutions[0]?.values ?? null };
}

// ---- describing a plan -----------------------------------------------------

const paramList = (ps) => ps.map((p) => show(v(p))).join(', ');

export function describe(p, rel) {
  const isPort = (x) => rel.ports.includes(x);
  return p.steps.map((s) => {
    if (s.type === 'check') {
      return { kind: 'check', text: `check ${showEq(s.eq)}`, from: showEq(s.eq) };
    }
    if (s.type === 'solve') {
      const params = [...new Set(s.branches.flatMap((b) => b.params))];
      const alts = s.branches.map((b) => {
        const g = b.guards.length ? `  if ${b.guards.map((x) => `${show(x)} ≥ 0`).join(', ')}` : '';
        return show(b.expr) + g;
      });
      const tail = params.length ? `   (${paramList(params)} ∈ ℤ)` : '';
      return {
        kind: 'solve', internal: !isPort(s.x), x: s.x,
        text: `${s.x} = ${alts.join('   or   ')}${tail}`,
        from: showEq(s.eq), branches: s.branches.length, params: params.length,
      };
    }
    if (s.type === 'linear') {
      return {
        kind: 'linear', xs: s.xs,
        text: s.xs.map((x) => `${x} = ${show(s.exprs[x])}`).join('\n'),
        from: s.eqs.map(showEq).join(' ; '),
      };
    }
    return {
      kind: 'newton', xs: s.xs,
      text: `${s.xs.join(', ')} ≈ root of { ${s.eqs.map(showEq).join(' ; ')} }  (Newton, one branch only)`,
      from: s.eqs.map(showEq).join(' ; '),
    };
  });
}
