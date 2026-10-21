import test from 'node:test';
import assert from 'node:assert/strict';
import { sum, product, negate, reciprocal, balance, view, evaluate, results, first, only, take, defineRelation, examples } from '../src/index.js';

const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} ≠ ${b}`);

test('one balance node is +, − and negate depending on which port is unknown', () => {
  const s = sum(2);
  assert.deepEqual(view(s, ['a', 'b']), { total: { symbol: '+', text: 'a + b' } });
  assert.deepEqual(view(s, ['total', 'b']), { a: { symbol: '−', text: 'total − b' } });
  assert.deepEqual(view(negate, ['x']), { y: { symbol: 'neg', text: '−x' } });
  assert.deepEqual(view(s, ['a']), {}); // two unknowns: the node can't decide yet
  close(first(s, { total: 10, b: 4 }).a, 6);
});

test('balances are variadic: any n − 1 ports determine the last', () => {
  const s = sum(4);
  const all = { a: 1, b: 2, c: 3, d: 4, total: 10 };
  for (const missing of s.ports) {
    const known = Object.fromEntries(Object.entries(all).filter(([k]) => k !== missing));
    close(only(s, known)[missing], all[missing]);
  }
  // a two-sided balance: a + b = c + d
  assert.deepEqual(view(balance(['a', 'b'], ['c', 'd']), ['a', 'c', 'd']), { b: { symbol: '−', text: 'c + d − a' } });
});

test('ratio is the multiplicative atom: ×, ÷ and reciprocal', () => {
  assert.deepEqual(view(product(2), ['product', 'b']), { a: { symbol: '÷', text: 'product / b' } });
  assert.deepEqual(view(reciprocal, ['y']), { x: { symbol: '1/x', text: '1/y' } });
  close(first(product(3), { a: 2, c: 5, product: 30 }).b, 3);
});

test('0 · x = 0 leaves x free; 0 · x = 5 has no solution', () => {
  const r = evaluate(product(2), { b: 0, product: 0 });
  assert.equal(r.solutions.length, 1);
  assert.deepEqual(r.solutions[0].free, ['a']);
  assert.equal(r.solutions[0].values.a, null);
  assert.equal(evaluate(product(2), { b: 0, product: 5 }).solutions.length, 0);
});

test('discriminant built only from atoms runs in every direction', () => {
  const d = examples.discriminant;
  close(only(d, { a: 1, b: 3, c: 2 }).D, 1);
  close(only(d, { a: 1, b: 3, D: 1 }).c, 2);
  close(only(d, { b: 3, c: 2, D: 1 }).a, 1);
  assert.deepEqual([...results(d, { a: 1, c: 2, D: 1 })].map((r) => r.values.b), [3, -3]);
});

test('results are a lazy ordered stream: canonical first, infinite for periodic inverses', () => {
  const xs = take(results(examples.sine, { y: 0.5 }), 50).map((r) => r.values.x);
  assert.equal(xs.length, 50);
  close(xs[0], Math.asin(0.5));
  for (const x of xs) close(Math.sin(x), 0.5);
  assert.equal(new Set(xs.map((x) => x.toFixed(9))).size, 50);
  // failure is the empty stream; first() is null, only() needs exactly one
  assert.equal(first(examples.square, { y: -1 }), null);
  assert.equal(only(examples.square, { y: 9 }), null);
  assert.deepEqual(only(examples.square, { y: 0 }), { x: 0, y: 0 });
});

test('a single equation that cannot be isolated is torn and scanned', () => {
  const r = defineRelation({ name: 'xexp', ports: ['x', 'y'], eqs: ['y = x * exp(x)'] });
  close(first(r, { y: Math.E }).x, 1);
});

test('fall: distance = speed·t + ½·g·t² solved for t, including the degenerate cases', () => {
  const fall = defineRelation({
    name: 'fall', ports: ['distance', 'speed', 'gravity', 'time'], eqs: ['half = 0.5'],
    uses: [
      { rel: product(2), bind: { a: 'speed', b: 'time', product: 'drift' } },
      { rel: product(4), bind: { a: 'half', b: 'gravity', c: 'time', d: 'time', product: 'drop' } },
      { rel: sum(2), bind: { a: 'drift', b: 'drop', total: 'distance' } },
    ],
  });
  const times = (v) => [...results(fall, v)].map((r) => r.values.time).sort((a, b) => a - b);
  assert.deepEqual(times({ distance: 1, speed: 0, gravity: 0.5 }), [-2, 2]); // speed exactly 0
  assert.deepEqual(times({ distance: 0, speed: 0, gravity: 9.81 }), [0]); // double root at 0
  const [t] = times({ distance: -2, speed: 2, gravity: 1 }); // double root at −2
  assert.ok(Math.abs(t + 2) < 1e-6);
  // nothing moves: every time works, so time is free, not a list of roots
  const all = [...results(fall, { distance: 0, speed: 0, gravity: 0 })];
  assert.equal(all.length, 1);
  assert.ok(all[0].free.includes('time'));
});
