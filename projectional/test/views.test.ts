import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { root } from "../src/io.ts";
import { loadProgram } from "../src/lang/load.ts";
import { renderLet } from "../src/render/letseq.ts";
import { renderNested } from "../src/render/nested.ts";

// A main of actions (print this, then that) reads as its steps in the
// Steps and Nested views too (BACKLOG E78): a step nothing reads has no
// name, and in Nested the steps follow one another with ;.
test("the steps of an action read as steps, not as unused names", () => {
  const q = loadProgram(join(root, "examples", "queens"));
  const steps = renderLet(q.code, q.pres, q.named("main"));
  assert.doesNotMatch(steps, /_₁|_ =/);
  assert.match(steps, /^ {2}print\("all solutions for 6:"\)$/m);
  assert.match(steps, /^ {2}t1 = first\(/m);
  const nested = renderNested(q.code, q.pres, q.named("main"));
  assert.doesNotMatch(nested, /_₁|\(_/);
  assert.match(nested, /\); print\("all solutions for 6:"\); ‹for each›/);
});
