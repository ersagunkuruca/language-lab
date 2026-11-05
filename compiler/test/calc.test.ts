// calc (ters/examples/calc), the program of GAPS.md round 1: the
// evaluator, the compiled code and the hand-written ideal must print the
// same thing on every session.

import { test } from "node:test";
import assert from "node:assert/strict";
import { deep, session, ways } from "../gaps/calc.ts";

const w = await ways();

test("calc: definitions, every operator, how it parses, and the errors", () => {
  const input = [
    "1 + 2 * 3", "(1 + 2) * 3", "let x = 2 ^ 100", "x * x - 1", "? -2 ^ 2 + 3 * (4 - 5) / 6", "-7 / 2", "-7 % 2",
    "7 / 0", "y + 1", "1 +", "(1 + 2", "", "let = 3", "1 2", "2 ^ (-1)", "007", "let x = x + 1", "x",
  ].join("\n");
  const want = {
    out: ["7", "9", "x = 1267650600228229401496703205376", "1606938044258990275541962092341162602522202993782792835301375",
      "((-(2 ^ 2)) + ((3 * (4 - 5)) / 6))", "-4", "1", "x = 1267650600228229401496703205377", "1267650600228229401496703205377"],
    err: ["calc: line 8: division by zero", "calc: line 9: unknown name y",
      // A line read with `read expression` (C110 s5) that has no reading is one error.
      "calc: line 10: not an expression: 1 +", "calc: line 11: not an expression: (1 + 2",
      "calc: line 13: let needs a name, got “=”", "calc: line 14: not an expression: 1 2",
      "calc: line 15: negative power", "calc: line 16: not an expression: 007"],
    code: 1,
  };
  for (const [way, run] of Object.entries(w)) assert.deepEqual(run(input), want, way);
});

test("calc: random sessions agree four ways (the core IR's too)", () => {
  for (const seed of [1, 2, 3]) {
    // compile.ts's way reads a line with `read expression` in about a
    // second (C110 s5), so the random sessions are the other three ways;
    // the lines above are all four.
    const input = session(200, seed);
    const want = w.evaluator(input);
    assert.deepEqual(w.ideal(input), want);
    assert.deepEqual(w.core(input), want);
  }
});

test("calc: parentheses 100,000 deep, and an error 5,000 deep, on the default stack (C21)", () => {
  // JavaScript's stack holds about 1,500 of them: the core IR's written
  // reader keeps its depth on the heap (C110 s5b).
  assert.deepEqual(w.core(deep(100_000)), { out: ["1"], err: [], code: 0 });
  const bad = "(".repeat(5000) + "1 +" + ")".repeat(5000);
  const input = [deep(5000), bad, "7 / 0", "1 + 1"].join("\n");
  // The evaluator's descent recurses on JavaScript's stack, so the answer is written out.
  assert.deepEqual(w.core(input), { out: ["1", "2"], err: [`calc: line 2: not an expression: ${bad}`, "calc: line 3: division by zero"], code: 1 });
});
