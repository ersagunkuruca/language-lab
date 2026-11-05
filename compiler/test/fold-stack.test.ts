// A fold run as a loop keeps its stack (scalar.ts framesOf) as a
// JavaScript array on the core IR (C137d21): pushed on the way down and
// popped on the way up, not a frame object per value. That every example
// whose main lowers still agrees with the evaluator is core-js.test.ts's.

import { test } from "node:test";
import assert from "node:assert/strict";
import { load } from "../src/program.ts";
import { emitCoreJs, lowerCore } from "../src/core-js.ts";

test("a fold's stack is an array, pushed and popped (C137d21)", () => {
  const p = load("chapters"), main = p.named("main");
  const { js } = emitCoreJs(lowerCore(p.code, p.info, p.pres.names, [main]));
  assert.match(js, /\(l\d+\.push\(l\d+\), l\d+\)/);
  assert.match(js, /\(l\d+\.pop\(\), l\d+\)/);
  assert.doesNotMatch(js, /\.frames\.(frame|done)"/);
});

// A function giving several answers goes on from the same stack for each
// answer after the first, so its folds keep frame objects: countdown's
// permutations on the core IR give every answer the hand-written one does.
test("a fold in a function with several answers keeps its frames, and countdown gives every answer (C137d21)", async () => {
  const { ways } = await import("../gaps/countdown.ts");
  const w = await ways();
  for (const [numbers, target] of [[[2, 3, 5, 7, 11], 100], [[1, 3, 7, 10, 25, 50], 765]] as [number[], number][]) assert.deepEqual(w.core(numbers, target), w.ideal(numbers, target));
});
