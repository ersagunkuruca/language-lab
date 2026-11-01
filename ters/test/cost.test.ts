// One cost scale for the way picker and the representation chooser
// (cost.ts, BACKLOG C30a): steps at each order of the ladder, compared
// from the highest order down.

import { test } from "node:test";
import assert from "node:assert/strict";
import { add, compare, less, NEVER, order, possible, steps } from "../src/lang/cost.ts";

test("one linear step costs more than any number of constant ones", () => {
  assert.ok(less(steps(1000), steps(1, "n")));
  assert.ok(less(add(steps(1, "n"), steps(5)), add(steps(1, "n"), steps(1, "log n"))));
  assert.equal(order(add(steps(3), steps(1, "log n"))), "log n");
});

test("constant steps add up, as the ways' costs did", () => {
  assert.equal(compare(add(steps(1), steps(2)), steps(3)), 0);
  assert.ok(less(steps(2), steps(3)));
});

test("NEVER is worse than anything possible, and stays NEVER when added to", () => {
  assert.ok(less(steps(1, "n²"), NEVER));
  assert.ok(!possible(add(NEVER, steps(1))));
  assert.ok(!possible(steps(Infinity)));
});
