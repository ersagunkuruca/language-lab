// A change of representation (docs/design/numbers/NUMBERS.md) produces an ordinary
// program, so it compiles like any other.

import { test } from "node:test";
import assert from "node:assert/strict";
import { runMain } from "../../ters/src/lang/run.ts";
import { infer } from "../../ters/src/lang/infer.ts";
import { represent, representationsIn } from "../../ters/src/lang/represent.ts";
import { compiledDefs } from "../src/core-js.ts";
import { load } from "../src/program.ts";

function compiledAs(rep: string) {
  const p = load("numbers");
  const reps = representationsIn(p.code, p.info, p.pres.names, p.own.defs);
  const entries = [p.named("main"), p.named("small")];
  const code = represent(p.code, entries, reps.find((r) => r.name === rep)!);
  const info = infer(code, p.pres.names);
  assert.deepEqual(info.errors, []);
  for (const name of ["small", "main"]) {
    const want: string[] = [], got: string[] = [];
    runMain(code, info, p.named(name), { print: (s) => want.push(s) });
    compiledDefs(code, info, p.pres.names, [name], { print: (s: string) => got.push(s) })[name]();
    assert.deepEqual(got, want);
  }
}

test("numbers: the binary representation compiles and prints what the evaluator prints", () => {
  compiledAs("binary");
});

// Peano Nat stored as an Int: the program still says zero and succ, and a
// fold over a Nat is a counted loop (`fold Nat (Int)` folds over range(n),
// which the compiler runs on n: NUMBERS.md, "Folds run the way their value
// is stored"). That check read compile.ts's output; here the core IR's
// answers are checked.
test("numbers: Nat as an Int compiles and prints what the evaluator prints", () => {
  compiledAs("int");
});
