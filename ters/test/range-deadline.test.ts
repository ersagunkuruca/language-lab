// A builtin that makes many items looks at a page's deadline while it
// makes them (E319i, over.ts): under a budget whose deadline has passed it
// stops as one out of steps does, and with none it makes them all.
import { test } from "node:test";
import assert from "node:assert/strict";
import { OutOfSteps, PAGE_STEPS, withSteps } from "../src/lang/run.ts";
import { rangeArray } from "../src/lang/array-view.ts";
import { int$range } from "../src/lang/std-run.ts";

const N = 1_000_000;
const late = () => true;

test("range's items stop at a page's deadline", () => {
  assert.throws(() => withSteps(PAGE_STEPS, () => rangeArray(N), late), OutOfSteps);
  assert.throws(() => withSteps(PAGE_STEPS, () => int$range(BigInt(N) as never), late), OutOfSteps);
});

test("range's items with no deadline, or one not passed, are all made", () => {
  assert.equal(rangeArray(N).n, N);
  assert.equal(withSteps(PAGE_STEPS, () => rangeArray(N), () => false).n, N);
  assert.equal(withSteps(PAGE_STEPS, () => rangeArray(1000), late).n, 1000);
  // The deadline is the budget's own: after it, none.
  withSteps(PAGE_STEPS, () => 0, late);
  assert.equal(rangeArray(N).n, N);
});
