import test from 'node:test';
import assert from 'node:assert/strict';
import { defineRelation, analyze, evaluate, directions, checkWiring, examples } from '../src/index.js';

test('analyze returns the derived program as text and trees', () => {
  const a = analyze(examples.sumDiff, ['c', 'd']);
  assert.equal(a.status, 'solved');
  assert.equal(a.steps[0].kind, 'linear');
  assert.equal(a.steps[0].raw.exprs.a.k, 'call');
  assert.equal(analyze(examples.polar, ['θ']).needMore, 1);
});

test('evaluate gives canonical and all solutions', () => {
  const r = evaluate(examples.polar, { x: 3, y: 4 });
  assert.equal(r.canonical.r, 5);
  assert.ok(r.solutions.length > 1);
  assert.equal(evaluate(examples.polar, { θ: 1 }).canonical, null);
});

test('directions lists minimal sufficient port sets', () => {
  assert.equal(directions(examples.polar).length, 6);
  assert.ok(directions(examples.polar).every((d) => d.length === 2));
  assert.deepEqual(directions(examples.sine), [['x'], ['y']]);
});

test('checkWiring: inputs wired in, outputs wired out', () => {
  assert.deepEqual(checkWiring(examples.polar, ['x', 'r'], ['θ']), { ok: true, undetermined: [], conflicting: [] });
  assert.equal(checkWiring(examples.polar, ['x'], ['θ']).ok, false);
  assert.equal(checkWiring(examples.polar, ['x', 'y'], ['x']).ok, false);
});

test('a graph of nodes is a relation and solves in any direction', () => {
  // f(a, b) = polar(x: a + b, y: a − b).r — inverted from (r, θ) back to (a, b)
  const g = defineRelation({
    name: 'graph',
    ports: ['a', 'b', 'len', 'ang'],
    eqs: ['u = a + b', 'w = a - b'],
    uses: [{ rel: examples.polar, bind: { x: 'u', y: 'w', r: 'len', θ: 'ang' } }],
  });
  const fwd = evaluate(g, { a: 3, b: 1 }).canonical;
  const back = evaluate(g, { len: fwd.len, ang: fwd.ang }).canonical;
  assert.ok(Math.abs(back.a - 3) < 1e-9 && Math.abs(back.b - 1) < 1e-9);
});
