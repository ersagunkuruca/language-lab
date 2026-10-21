import test from 'node:test';
import assert from 'node:assert/strict';
import { ALL, sumDiff, polar, polarNoLaw, sine, square, sineDouble, ohm, rotate, temperature } from '../src/examples.js';
import { solve, plan, describe, run, shortfall, relation } from '../src/relation.js';
import { evaluate } from '../src/expr.js';

const close = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-9, `${msg ?? ''} ${a} ≠ ${b}`);
const closeAll = (got, want) => { for (const k in want) close(got[k], want[k], k); };

test('sum/diff: inverse derived by elimination, printed symbolically', () => {
  const r = solve(sumDiff, { c: 10, d: 4 });
  closeAll(r.canonical, { a: 7, b: 3 });
  const [step] = describe(r.plan, sumDiff);
  assert.equal(step.kind, 'linear');
  assert.equal(step.text, 'a = (c + d) / 2\nb = (c − d) / 2');
});

test('sum/diff: every pair of known ports works', () => {
  const ports = { a: 3, b: 7, c: 10, d: -4 };
  const names = Object.keys(ports);
  for (let i = 0; i < 4; i++) for (let j = i + 1; j < 4; j++) {
    const known = { [names[i]]: ports[names[i]], [names[j]]: ports[names[j]] };
    const r = solve(sumDiff, known);
    assert.equal(r.solutions.length, 1, JSON.stringify(known));
    closeAll(r.canonical, ports);
  }
});

test('polar: (x, y) → (r, θ) gives atan2 as the canonical branch', () => {
  for (const [x, y] of [[3, 4], [3, -4], [-3, 4], [-3, -4], [0, 2], [-1, 0.001]]) {
    const r = solve(polar, { x, y });
    close(r.canonical.r, Math.hypot(x, y));
    close(r.canonical.θ, Math.atan2(y, x), `θ for ${x},${y}`);
    // every reported solution actually satisfies the relation
    for (const s of r.solutions) {
      close(s.values.r * Math.cos(s.values.θ), x);
      close(s.values.r * Math.sin(s.values.θ), y);
    }
  }
});

test('polar: every pair of known ports reproduces the original point', () => {
  const pt = { x: -2, y: 1.5, r: 2.5, θ: Math.atan2(1.5, -2) };
  const names = Object.keys(pt);
  for (let i = 0; i < 4; i++) for (let j = i + 1; j < 4; j++) {
    const known = { [names[i]]: pt[names[i]], [names[j]]: pt[names[j]] };
    const r = solve(polar, known, { window: 1 });
    assert.ok(r.solutions.length >= 1, JSON.stringify(known));
    const hit = r.solutions.some((s) => names.every((n) => Math.abs(s.values[n] - pt[n]) < 1e-9));
    assert.ok(hit, `original point among solutions for ${JSON.stringify(known)}`);
  }
});

test('polar: one known port is underdetermined by exactly one', () => {
  const p = plan(polar, ['θ']);
  assert.deepEqual(p.freePorts.sort(), ['r', 'x', 'y']);
  assert.equal(shortfall(polar, ['θ']), 1);
});

test('polar without the law is torn: guess one unknown, root-find the other equation', () => {
  const r = solve(polarNoLaw, { x: 3, y: -4 });
  assert.equal(describe(r.plan, polarNoLaw)[0].kind, 'tear');
  close(r.canonical.r, 5);
  close(r.canonical.θ, Math.atan2(-4, 3));
  assert.ok(r.solutions.some((s) => Math.abs(s.values.r + 5) < 1e-9)); // the r < 0 family too
  for (const s of r.solutions) {
    close(s.values.r * Math.cos(s.values.θ), 3);
    close(s.values.r * Math.sin(s.values.θ), -4);
  }
});

test('tearing solves a nonlinear chain that Newton cannot start on', () => {
  // quadratic root (−b + sqrt(b² − 4ac)) / 2a as a network, solved for b
  const q = relation({
    name: 'q', ports: ['a', 'b', 'c', 'r'],
    eqs: ['t = -b', 'D = b*b - 4*a*c', 's = sqrt(D)', 't + s = 2*a*r'],
  });
  const r = solve(q, { a: 1, c: 0.5, r: 1 });
  assert.equal(r.solutions.length, 1);
  close(r.canonical.b, -1.5);
  // r = 1 is never the + root when b = −3, c ≥ 0: no solution, not a wrong one
  assert.equal(solve(q, { a: 1, b: -3, r: 1 }).solutions.length, 0);
  // two roots: x² − 5x + 6 = 0 has x = 2, 3; as a relation over (p, x)
  const two = relation({ name: 'two', ports: ['p', 'x'], eqs: ['u = x*x', 'p = u - 5*x + 6'] });
  const xs = solve(two, { p: 0 }).solutions.map((s) => s.values.x).sort();
  assert.deepEqual(xs.map((x) => +x.toFixed(9)), [2, 3]);
});

test('sin: full solution family, asin as the canonical branch', () => {
  const r = solve(sine, { y: 0.5 }, { window: 2 });
  close(r.canonical.x, Math.asin(0.5));
  assert.equal(r.solutions.length, 10); // 2 branches × k ∈ {0, ±1, ±2}
  for (const s of r.solutions) close(Math.sin(s.values.x), 0.5);
  assert.match(describe(r.plan, sine)[0].text, /asin\(y\) \+ 2πk₁ {3}or {3}π − asin\(y\) \+ 2πk₁/);
});

test('sin(2x): period of the inverse is derived (π), not declared', () => {
  const r = solve(sineDouble, { y: 0.3 }, { window: 1 });
  const xs = r.solutions.map((s) => s.values.x).sort((a, b) => a - b);
  for (const x of xs) close(Math.sin(2 * x), 0.3);
  assert.ok(xs.some((x) => Math.abs(x - (Math.asin(0.3) / 2 + Math.PI)) < 1e-9));
});

test('square: ±sqrt, canonical non-negative; no real solution for negatives', () => {
  const r = solve(square, { y: 9 });
  assert.deepEqual(r.solutions.map((s) => s.values.x), [3, -3]);
  assert.equal(solve(square, { y: -1 }).solutions.length, 0);
});

test('ohm: any two of V, I, R, P', () => {
  const truth = { V: 12, I: 3, R: 4, P: 36 };
  const names = Object.keys(truth);
  for (let i = 0; i < 4; i++) for (let j = i + 1; j < 4; j++) {
    const known = { [names[i]]: truth[names[i]], [names[j]]: truth[names[j]] };
    const r = solve(ohm, known);
    closeAll(r.canonical, truth);
  }
});

test('rotate: composed relation runs backwards with no inverse written', () => {
  const fwd = solve(rotate, { x: 1, y: 2, φ: 0.7 }).canonical;
  close(fwd.x2, Math.cos(0.7) * 1 - Math.sin(0.7) * 2);
  close(fwd.y2, Math.sin(0.7) * 1 + Math.cos(0.7) * 2);
  const back = solve(rotate, { x2: fwd.x2, y2: fwd.y2, φ: 0.7 });
  assert.equal(back.solutions.length, 1);
  closeAll(back.canonical, { x: 1, y: 2 });
  // knowing both points recovers the angle
  const ang = solve(rotate, { x: 1, y: 2, x2: fwd.x2, y2: fwd.y2 });
  assert.ok(ang.solutions.some((s) => Math.abs(s.values.φ - 0.7) < 1e-9));
});

test('temperature: linear chain inverted by peeling', () => {
  closeAll(solve(temperature, { F: 212 }).canonical, { C: 100, K: 373.15 });
  closeAll(solve(temperature, { K: 0 }).canonical, { C: -273.15, F: -459.67 });
});

test('overdetermined and inconsistent input has no solutions', () => {
  assert.equal(solve(sumDiff, { a: 1, b: 1, c: 2, d: 5 }).solutions.length, 0);
  assert.equal(solve(sumDiff, { a: 1, b: 1, c: 2, d: 0 }).solutions.length, 1);
});

// Laws are claims the solver trusts. Check every one numerically against the
// defining equations at random points.
test('laws hold wherever the defining equations hold', () => {
  for (const rel of Object.values(ALL)) {
    const laws = rel.eqs.filter((e) => e.law);
    if (!laws.length) continue;
    const defining = { ...rel, eqs: rel.eqs.filter((e) => !e.law) };
    // find a known set of ports that the defining equations alone solve in closed form
    const ports = rel.ports;
    // (closed form preferred, Newton otherwise)
    let known = null;
    for (const numeric of [false, true]) {
      for (let mask = 1; mask < 1 << ports.length && !known; mask++) {
        const ks = ports.filter((_, i) => mask & (1 << i));
        const p = plan(defining, ks, { numeric });
        if (!p.unknown.length) known = { ks, p };
      }
    }
    assert.ok(known, `no direction solves ${rel.name}`);
    for (let t = 0; t < 20; t++) {
      const vals = Object.fromEntries(known.ks.map((k) => [k, 0.5 + Math.random() * 3]));
      for (const s of run(defining, known.p, vals, { window: 0 })) {
        const env = s.env;
        for (const law of laws) close(evaluate(law.lhs, env), evaluate(law.rhs, env), `${rel.name} law`);
      }
    }
  }
});
