// A page's step budget with a deadline (run.ts withSteps `over`, I310):
// the editor's seeds run gives the page back on time even where a search
// spends steps without calling a lambda the editor times.

import { test } from "node:test";
import assert from "node:assert/strict";
import { OutOfSteps, spendStep, withSteps } from "../src/lang/run.ts";

test("a budget runs out when its deadline says so, asked every 1024 steps", () => {
  let asked = 0, spent = 0;
  assert.throws(() => withSteps(1e9, () => { for (;;) { spendStep(); spent++; } }, () => ++asked === 3), OutOfSteps);
  assert.equal(asked, 3);
  assert.ok(spent < 4 * 1024, `${spent} steps`);
});

test("without one, only the count runs out", () => {
  let spent = 0;
  assert.throws(() => withSteps(5000, () => { for (;;) { spendStep(); spent++; } }), OutOfSteps);
  assert.equal(spent, 5000);
});
