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
