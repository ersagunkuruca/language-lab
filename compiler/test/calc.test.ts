// calc (projectional/examples/calc), the program of GAPS.md round 1: the
// evaluator, the compiled code and the hand-written ideal must print the
// same thing on every session.

import { test } from "node:test";
import assert from "node:assert/strict";
import { session, ways } from "../gaps/calc.ts";

const w = await ways();

test("calc: definitions, every operator, how it parses, and the errors", () => {
  const input = [
    "1 + 2 * 3", "(1 + 2) * 3", "let x = 2 ^ 100", "x * x - 1", "? -2 ^ 2 + 3 * (4 - 5) / 6", "-7 / 2", "-7 % 2",
    "7 / 0", "y + 1", "1 +", "(1 + 2", "", "let = 3", "1 2", "2 ^ -1", "007", "let x = x + 1", "x",
  ].join("\n");
  const want = {
    out: ["7", "9", "x = 1267650600228229401496703205376", "1606938044258990275541962092341162602522202993782792835301375",
      "((-(2 ^ 2)) + ((3 * (4 - 5)) / 6))", "-4", "1", "x = 1267650600228229401496703205377", "1267650600228229401496703205377"],
    err: ["calc: line 8: division by zero", "calc: line 9: unknown name y",
      "calc: line 10: expected a number, a name or “(”, got the end of the line", "calc: line 11: expected “)”, got the end of the line",
      "calc: line 13: let needs a name, got “=”", "calc: line 14: expected an operator or the end of the line, got 2",
      "calc: line 15: negative power", "calc: line 16: not a number: 007"],
    code: 1,
  };
  for (const [way, run] of Object.entries(w)) assert.deepEqual(run(input), want, way);
});

test("calc: random sessions agree three ways", () => {
  for (const seed of [1, 2, 3]) {
    const input = session(200, seed);
    const want = w.evaluator(input);
    assert.deepEqual(w.compiled(input), want);
    assert.deepEqual(w.ideal(input), want);
  }
});
