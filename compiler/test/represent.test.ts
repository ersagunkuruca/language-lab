// A change of representation (docs/design/numbers/NUMBERS.md) produces an ordinary
// program, so it compiles like any other.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { runMain } from "../../ters/src/lang/run.ts";
import { infer } from "../../ters/src/lang/infer.ts";
import { represent, representationsIn } from "../../ters/src/lang/represent.ts";
import { compile } from "../src/compile.ts";
import { examples, load } from "../src/program.ts";
import { $setPrint } from "../src/runtime.js";

async function compiledAs(rep: string) {
  const p = load("numbers");
  const reps = representationsIn(p.code, p.info, p.pres.names, p.own.defs);
  const entries = [p.named("main"), p.named("small")];
  const code = represent(p.code, entries, reps.find((r) => r.name === rep)!);
  const info = infer(code, p.pres.names);
  assert.deepEqual(info.errors, []);
  const source = compile(code, info, p.pres.names, { runtime: pathToFileURL(join(import.meta.dirname, "../src/runtime.js")).href, exports: ["main", "small"] });
  const file = join(mkdtempSync(join(tmpdir(), "represented-")), `numbers-${rep}.js`);
  writeFileSync(file, source);
  const defs = (await import(pathToFileURL(file).href)).defs as Record<string, () => void>;
  for (const name of ["small", "main"]) {
    const want: string[] = [], got: string[] = [];
    runMain(code, info, p.named(name), { print: (s) => want.push(s) });
    $setPrint((s: string) => got.push(s));
    defs[name]();
    assert.deepEqual(got, want);
  }
  return source;
}

test("numbers: the binary representation compiles and prints what the evaluator prints", async () => {
  await compiledAs("binary");
});

// Peano Nat stored as an Int: the program still says zero and succ, and a
// fold over a Nat is a counted loop (`fold Nat (Int)` folds over range(n),
// which the compiler runs on n: NUMBERS.md, "Folds run the way their value
// is stored").
test("numbers: Nat as an Int compiles to Int arithmetic and counted loops, with no Nat values left", async () => {
  const source = await compiledAs("int");
  const fold = source.slice(source.indexOf("function fold_Nat_"), source.indexOf("\n}\n", source.indexOf("function fold_Nat_")));
  assert.match(fold, /for \(let i\$\d+ = Number\(n\d*\) - 1;/);
  assert.doesNotMatch(source, /bcabb936|b58105ec/); // zero and succ, as data
});
