import test from 'node:test';
import assert from 'node:assert/strict';
import { site } from '../src/syntax.js';

const samples = [
  { route: 'home' },
  { route: 'user', id: 42 },
  { route: 'post', year: 2024, slug: 'hello world', page: 1, sort: 'new' },
  { route: 'post', year: 1999, slug: 'héllo/wörld?', page: 3, sort: 'top' },
];

test('parse ∘ print = id: the canonical URL reads back as the same value', () => {
  for (const v of samples) assert.deepEqual(site.parse(site.print(v)), v);
});

test('every spelling the printer lists parses back to the same value', () => {
  for (const v of samples) {
    const all = site.variants(v);
    assert.ok(all.length > 1);
    for (const s of all) assert.deepEqual(site.parse(s), v, s);
  }
});

test('lenient parsing, canonical printing', () => {
  const cases = {
    '/index.html': '/',
    '/USERS/042/': '/users/42',
    'https://example.com/u/42#top': '/users/42',
    '/blog/2024/hello%20world/?SORT=top&page=1&utm_source=x': '/blog/2024/hello%20world?sort=top',
  };
  for (const [input, canonical] of Object.entries(cases)) assert.equal(site.canonicalize(input), canonical, input);
});

test('canonicalize is idempotent', () => {
  for (const v of samples) for (const s of site.variants(v)) {
    const c = site.canonicalize(s);
    assert.equal(site.canonicalize(c), c);
  }
});

test('values outside the domain have no spelling; bad URLs have no reading', () => {
  assert.equal(site.print({ route: 'user', id: -1 }), null);
  assert.equal(site.print({ route: 'post', year: 2024, slug: '', page: 1, sort: 'new' }), null);
  assert.equal(site.parse('/blog/2024/a?page=abc'), null);
  assert.equal(site.parse('/nope'), null);
});
