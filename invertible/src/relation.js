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
  if (e.k === 'var') return [{ expr: simplify(target), params: [], guards: [], free: [] }];
  const i = e.args.findIndex((a) => countVar(a, x) > 0);
  const out = [];
  for (const br of FN[e.f].inv[i](target, e.args, fresh)) {
    for (const inner of peel(e.args[i], br.expr, x, fresh)) {
      out.push({
        expr: inner.expr,
        params: [...br.params, ...inner.params],
        guards: [...br.guards.map(simplify), ...inner.guards],
        free: [...br.free, ...inner.free],
      });
    }
  }
  return out;
}

function isolate(eq, x, fresh) {
  eq = { ...eq, lhs: simplify(eq.lhs), rhs: simplify(eq.rhs) };
  const inL = countVar(eq.lhs, x), inR = countVar(eq.rhs, x);
  if (inL + inR === 1) {
    const [e, target] = inL ? [eq.lhs, eq.rhs] : [eq.rhs, eq.lhs];
    return peel(e, target, x, fresh);
  }
  const lin = solveLinear([eq], [x]);
  return lin ? [{ expr: simplify(lin[x]), params: [], guards: [], free: [] }] : null;
}

function* combinations(arr, k, start = 0, acc = []) {
  if (acc.length === k) { yield acc; return; }
  for (let i = start; i < arr.length; i++) yield* combinations(arr, k, i + 1, [...acc, arr[i]]);
}

// Build a plan for computing every variable of `rel` from the `known` ports.
// Strategy, in order of preference:
//   1. an equation with one unknown: isolate it (closed form, maybe branches)
//   2. a square block of equations, linear in its unknowns: eliminate exactly
//   3. a square nonlinear block that can be torn: guess one unknown, solve
//      the rest from it in closed form, root-find the one leftover equation
//      by scanning (finds every root in range, on every branch)
//   4. any other square nonlinear block: Newton with symbolic derivatives
// Equations whose variables are all known become checks, which is how
// redundant equations pick the right branch of a multi-valued inverse.
export function plan(rel, known, { numeric = true } = {}) {
  const K = new Set(known);
  let rem = rel.eqs.slice();
  const steps = [];
  let kCount = 0;
  let tCount = 0;
  const unknownsIn = (eq, S) => [...vars(eq.rhs, vars(eq.lhs))].filter((n) => !S.has(n));
  const unknownsOf = (eq) => unknownsIn(eq, K);

  // the cheapest equation with exactly one unknown (w.r.t. S) to isolate
  function bestIsolation(eqs, S) {
    let best = null;
    for (const eq of eqs) {
      const u = unknownsIn(eq, S);
      if (u.length !== 1) continue;
      const t0 = tCount;
      const branches = isolate(eq, u[0], () => `#t${tCount++}`);
      if (!branches) continue;
      const score = branches.length * 10 + (tCount - t0) * 5 + (eq.law ? 1 : 0);
      if (!best || score < best.score) best = { score, eq, x: u[0], branches };
    }
    return best;
  }

  // turn a chosen isolation into a step, giving branch parameters stable names k1, k2, ...
  function solveStep(best) {
    const names = {};
    const fix = (e) => {
      for (const n of vars(e)) if (n.startsWith('#t') && !(n in names)) names[n] = v(`#k${++kCount}`);
      return substitute(e, names);
    };
    const branches = best.branches.map((b) => ({
      expr: fix(b.expr),
      guards: b.guards.map(fix),
      free: (b.free ?? []).map((g) => g.map(fix)),
      params: b.params.map((p) => names[p]?.name ?? p),
    }));
    return { type: 'solve', x: best.x, eq: best.eq, branches };
  }

  // Tearing: guess one unknown of the block, compute the others from it in
  // closed form, and leave a single residual equation to root-find in 1-D.
  function tear(eqs, us) {
    let best = null;
    for (const x of us) {
      const S = new Set([...K, x]);
      let left = eqs.slice();
      const inner = [];
      for (let pick; (pick = bestIsolation(left, S));) {
        inner.push(pick);
        S.add(pick.x);
        left = left.filter((e) => e !== pick.eq);
      }
      if (left.length !== 1 || !us.every((u) => S.has(u))) continue;
      const cost = inner.reduce((c, p) => c * p.branches.length, 1);
      if (!best || cost < best.cost) best = { cost, x, inner, residual: left[0] };
    }
    if (!best) return null;
    return {
      type: 'tear', xs: us, eqs, tear: best.x, residual: best.residual,
      inner: best.inner.map(solveStep),
    };
  }

  for (;;) {
    rem = rem.filter((eq) => {
      if (unknownsOf(eq).length) return true;
      steps.push({ type: 'check', eq });
      return false;
    });
    if (rel.vars.every((n) => K.has(n))) break;

    const best = bestIsolation(rem, K);
    if (best) {
      steps.push(solveStep(best));
      K.add(best.x);
      rem = rem.filter((e) => e !== best.eq);
      continue;
    }

    let block = null;
    outer: for (const mode of numeric ? ['linear', 'tear', 'newton'] : ['linear']) {
      // Laws are redundant with the defining equations, so they never count
      // towards a square block (that would fake an extra degree of freedom).
      const defining = rem.filter((eq) => !eq.law);
      // (a single equation can be torn too: x·sin(x) = y has one unknown
      // that can't be isolated, so guess it and scan)
      for (let size = mode === 'tear' ? 1 : 2; size <= Math.min(defining.length, 6); size++) {
        for (const eqs of combinations(defining, size)) {
          const us = [...new Set(eqs.flatMap(unknownsOf))];
          if (us.length !== size) continue;
          if (mode === 'linear') {
            const sol = solveLinear(eqs, us);
            if (sol) { block = { type: 'linear', xs: us, eqs, exprs: sol }; break outer; }
          } else if (mode === 'tear') {
            block = tear(eqs, us);
            if (block) break outer;
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

// Every combination of inner branches (and k values) is its own 1-D function
// of the tear variable. Scan each over [−range, range] on a sinh-spaced grid
// (dense near 0, sparse far out), bisect every sign change, and keep the
// roots whose residual is actually ~0 (sign changes across poles are not roots).
function tearRoots(s, env, ks, tol, range, maxRoots) {
  const combos = [[]];
  for (const st of s.inner) {
    const next = [];
    for (const c of combos) st.branches.forEach((b, bi) => {
      for (const a of assignments(b.params, ks)) next.push([...c, { bi, a }]);
    });
    combos.splice(0, combos.length, ...next);
  }
  const out = [];
  for (const combo of combos) {
    const f = (x) => {
      const e = { ...env, [s.tear]: x };
      for (let j = 0; j < s.inner.length; j++) {
        const st = s.inner[j], b = st.branches[combo[j].bi];
        const ee = { ...e, ...combo[j].a };
        const val = evaluate(b.expr, ee);
        if (!Number.isFinite(val) || !b.guards.every((g) => evaluate(g, ee) >= -tol)) return { r: NaN };
        e[st.x] = val;
      }
      const l = evaluate(s.residual.lhs, e), r = evaluate(s.residual.rhs, e);
      return { r: l - r, scale: 1 + Math.abs(l) + Math.abs(r), e };
    };
    const roots = [];
    const accept = (x) => {
      const fx = f(x);
      if (Number.isFinite(fx.r) && Math.abs(fx.r) <= 1e-7 * fx.scale &&
          !roots.some((r) => Math.abs(r.x - x) <= 1e-7 * (1 + Math.abs(x)))) {
        roots.push({ x, env: fx.e, path: combo.map((c, j) => ({ x: s.inner[j].x, branch: c.bi, ...c.a })) });
      }
    };
    const umax = Math.asinh(range), N = 1600;
    const xs = Array.from({ length: N + 1 }, (_, n) => Math.sinh(-umax + (2 * umax * n) / N));
    const fs = xs.map((x) => f(x).r);
    // residual identically zero (0·t + 0·t² = 0): every value works, so the
    // block's unknowns are free rather than an endless list of roots
    const finite = xs.map((x, n) => [x, fs[n]]).filter(([, r]) => Number.isFinite(r));
    if (finite.length > N / 2 && finite.every(([x, r]) => Math.abs(r) <= 1e-12 * f(x).scale)) {
      return [{ env, path: [], freeVars: s.xs }];
    }
    for (let n = 0; n < N; n++) {
      const [x0, x1, f0, f1] = [xs[n], xs[n + 1], fs[n], fs[n + 1]];
      if (!Number.isFinite(f0) || !Number.isFinite(f1)) continue;
      if (f0 === 0) { accept(x0); continue; }
      if (f0 * f1 < 0) {
        // sign change: bisect
        let a = x0, b = x1, fa = f0;
        for (let it = 0; it < 200 && a !== b; it++) {
          const m = (a + b) / 2, fm = f(m).r;
          if (!Number.isFinite(fm)) break;
          if (fm === 0) { a = b = m; break; }
          if (fa * fm < 0) b = m; else { a = m; fa = fm; }
          if (Math.abs(b - a) <= 1e-15 * (1 + Math.abs(a))) break;
        }
        accept((a + b) / 2);
      } else if (n > 0 && Number.isFinite(fs[n - 1]) && Math.abs(f0) < Math.abs(fs[n - 1]) && Math.abs(f0) <= Math.abs(f1)) {
        // no sign change but |f| dips: a double root (t² = 0) touches zero
        // without crossing it. Minimise |f| around the dip and keep it if it
        // reaches zero.
        let a = xs[n - 1], b = x1;
        const g = 0.6180339887498949;
        for (let it = 0; it < 200 && b - a > 1e-300; it++) {
          const c = b - g * (b - a), d = a + g * (b - a);
          const fc = Math.abs(f(c).r), fd = Math.abs(f(d).r);
          if (!(fc <= fd)) a = c; else b = d;
        }
        accept((a + b) / 2);
      }
    }
    if (fs[N] === 0) accept(xs[N]);
    // closest to zero first; periodic residuals have endless roots, keep a few
    out.push(...roots.sort((p, q) => Math.abs(p.x) - Math.abs(q.x)).slice(0, maxRoots));
  }
  return out;
}

const clean = (x) => {
  if (Math.abs(x) < 1e-12) return 0;
  return +x.toPrecision(12);
};

// Execute a plan on concrete values. Branch parameters k are enumerated over
// 0, 1, −1, ..., ±window. Every complete, consistent assignment is a solution;
// the first one found (canonical branch of every step, k = 0 where possible)
// is the canonical solution.
export function run(rel, p, values, { window = 1, limit = 64, tol = 1e-9, guess = {}, tearRange = 1000, maxRoots = 8 } = {}) {
  const ks = kOrder(window);
  const seen = new Set();
  const solutions = [];
  const ok = (x) => Number.isFinite(x);

  // `free` holds variables the equations leave unconstrained (0·x = 0).
  // Anything computed from a free variable is free too, and checks that
  // involve one are satisfiable, so they pass.
  const touches = (e, free) => free.size > 0 && [...vars(e)].some((n) => free.has(n));

  function go(i, env, path, free) {
    if (solutions.length >= limit) return;
    if (i === p.steps.length) {
      const ports = rel.ports.filter((n) => n in env || free.has(n));
      const sol = Object.fromEntries(ports.map((n) => [n, free.has(n) ? null : clean(env[n])]));
      const key = Object.values(sol).map((x) => (x === null ? 'free' : Math.round(x * 1e8))).join();
      if (!seen.has(key)) {
        seen.add(key);
        solutions.push({ values: sol, env, path, free: ports.filter((n) => free.has(n)) });
      }
      return;
    }
    const s = p.steps[i];
    const withFree = (x) => new Set([...free, x]);
    if (s.type === 'check') {
      if (touches(s.eq.lhs, free) || touches(s.eq.rhs, free)) return go(i + 1, env, path, free);
      const l = evaluate(s.eq.lhs, env), r = evaluate(s.eq.rhs, env);
      if (ok(l) && ok(r) && Math.abs(l - r) <= tol * (1 + Math.abs(l) + Math.abs(r))) go(i + 1, env, path, free);
    } else if (s.type === 'solve') {
      for (const [bi, b] of s.branches.entries()) {
        const isFree = touches(b.expr, free) || b.free.some((g) =>
          g.every((e) => !touches(e, free) && Math.abs(evaluate(e, env)) <= tol));
        if (isFree) {
          go(i + 1, env, [...path, { x: s.x, branch: bi, free: true }], withFree(s.x));
          return; // one free answer covers every branch
        }
        for (const a of assignments(b.params, ks)) {
          const e = { ...env, ...a };
          const x = evaluate(b.expr, e);
          if (!ok(x) || !b.guards.every((g) => evaluate(g, e) >= -tol)) continue;
          go(i + 1, { ...env, [s.x]: x }, [...path, { x: s.x, branch: bi, ...a }], free);
        }
      }
    } else if (s.type === 'linear') {
      const e = { ...env };
      let f = free;
      for (const x of s.xs) {
        if (touches(s.exprs[x], free)) f = new Set([...f, x]);
        else e[x] = evaluate(s.exprs[x], env);
      }
      if (s.xs.every((x) => f.has(x) || ok(e[x]))) go(i + 1, e, path, f);
    } else if (s.type === 'tear') {
      for (const r of tearRoots(s, env, ks, tol, tearRange, maxRoots)) {
        go(i + 1, r.env, [...path, ...r.path], r.freeVars ? new Set([...free, ...r.freeVars]) : free);
      }
    } else if (s.type === 'newton') {
      const x = newton(s, env, guess);
      if (x) go(i + 1, { ...env, ...Object.fromEntries(s.xs.map((u, j) => [u, x[j]])) }, path, free);
    }
  }

  go(0, { ...values }, [], new Set());
  return solutions;
}

// All solutions as a lazy, ordered, possibly infinite stream: Verse/Icon
// style multiple results. Order is canonical first, then by growing |k|
// (k = 0, then ±1, then ±2 …), so every solution of a periodic family is
// reached eventually and a consumer takes as many as it wants. An empty
// stream is failure. The stream ends when a level adds nothing new.
export function* stream(rel, p, values, opts = {}) {
  const branchesOf = (s) => s.branches ?? (s.inner ?? []).flatMap((i) => i.branches);
  const periodic = p.steps.some((s) => branchesOf(s).some((b) => b.params.length));
  const seen = new Set();
  for (let level = 0; ; level++) {
    let fresh = 0;
    for (const sol of run(rel, p, values, { ...opts, window: level, limit: Infinity })) {
      const key = Object.values(sol.values).map((x) => (x === null ? 'free' : Math.round(x * 1e8))).join();
      if (seen.has(key)) continue;
      seen.add(key);
      fresh++;
      yield sol;
    }
    if (!periodic || (level > 0 && !fresh) || level >= (opts.maxLevel ?? 1e4)) return;
  }
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
    if (s.type === 'tear') {
      const inner = s.inner.map((st) => `${st.x} = ${st.branches.map((b) => show(b.expr)).join('  or  ')}`);
      return {
        kind: 'tear', xs: s.xs, tear: s.tear,
        text: `guess ${s.tear}; ${inner.join('; ')}\nscan ${s.tear} for roots of ${showEq(s.residual)}`,
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
