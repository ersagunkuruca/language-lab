// A change of representation (projectional/NUMBERS.md) produces an ordinary
// program, so it compiles like any other.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { runMain } from "../../projectional/src/lang/run.ts";
import { infer } from "../../projectional/src/lang/infer.ts";
import { represent, type Representation } from "../../projectional/src/lang/represent.ts";
import { compile } from "../src/compile.ts";
import { examples, load } from "../src/program.ts";
import { $setPrint } from "../src/runtime.js";

test("numbers: the binary representation compiles and prints what the evaluator prints", async () => {
  const p = load("numbers");
  const reps: Representation[] = JSON.parse(readFileSync(join(examples, "numbers/representations.json"), "utf8"));
  const entries = [p.named("main"), p.named("small")];
  const code = represent(p.code, entries, reps.find((r) => r.name === "binary")!);
  const info = infer(code, p.pres.names);
  assert.deepEqual(info.errors, []);
  const file = join(mkdtempSync(join(tmpdir(), "represented-")), "numbers.js");
  writeFileSync(file, compile(code, info, p.pres.names, { runtime: pathToFileURL(join(import.meta.dirname, "../src/runtime.js")).href, exports: ["main", "small"] }));
  const defs = (await import(pathToFileURL(file).href)).defs as Record<string, () => void>;
  for (const name of ["small", "main"]) {
    const want: string[] = [], got: string[] = [];
    runMain(code, info, p.named(name), { print: (s) => want.push(s) });
    $setPrint((s: string) => got.push(s));
    defs[name]();
    assert.deepEqual(got, want);
  }
});
