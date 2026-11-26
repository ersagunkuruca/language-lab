// The grid's lists (library/near.ts neighbourLists, its hashed cells of
// C348) against every pair compared by the definition's own sum and ≤: on
// a line, in the plane and in space, cells narrower than reach (rings
// out), crowds of more neighbours than the insertion sort takes, places
// on top of each other and negative places.

import { test } from "node:test";
import assert from "node:assert/strict";
import { neighbourLists } from "../library/near.ts";

const brute = (ps: number[][], reach: number) => ps.map((a, i) => ps.flatMap((b, j) => {
  if (j === i) return [];
  let s = (a[0] - b[0]) * (a[0] - b[0]);
  for (let p = 1; p < a.length; p++) s = s + (a[p] - b[p]) * (a[p] - b[p]);
  return reach * reach < s ? [] : [j];
}));

test("the grid's lists are every pair's, smallest first", () => {
  let seed = 11;
  const r = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (const dims of [1, 2, 3]) for (const [n, span, reach, side] of [[300, 50, 3, 3], [400, 20, 4, 1.5], [250, 4, 2, 2], [120, 100, 7, 2]] as const) {
    const ps = Array.from({ length: n }, () => Array.from({ length: dims }, () => (r() - 0.5) * span));
    ps.push(ps[0].slice(), ps[1].slice());
    assert.deepEqual(neighbourLists(ps, reach, side), brute(ps, reach), `${dims} parts, ${n} places, reach ${reach}, side ${side}`);
  }
  assert.deepEqual(neighbourLists([], 1), []);
  assert.equal(neighbourLists([[1, 2, 3, 4]], 1), null);
  assert.equal(neighbourLists([[2 ** 40]], 1), null);
});
