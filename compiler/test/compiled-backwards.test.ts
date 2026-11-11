// backwards compiled runs (I206, REVIEW-2026-11-11 §1): since C42a its
// module names its functions for the worker threads, and it named a
// relation's mode too, which is printed inside `R.moded`'s body and isn't
// in scope there: the module threw on load (f5057927$mode0 is not
// defined). Compiled, it prints what the evaluator prints.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ters = join(import.meta.dirname, "../../ters");
const cli = join(ters, "cli/ters.ts");

test("backwards compiled prints what ters run prints", () => {
  const out = join(mkdtempSync(join(tmpdir(), "backwards-")), "backwards.mjs");
  const made = spawnSync(process.execPath, [cli, "compile", join(ters, "examples/backwards"), "-o", out], { encoding: "utf8" });
  assert.equal(made.status, 0, made.stderr);
  const compiled = spawnSync(process.execPath, [out], { encoding: "utf8", input: "" });
  const evaluated = spawnSync(process.execPath, [cli, "run", join(ters, "examples/backwards")], { encoding: "utf8", input: "" });
  assert.equal(compiled.stderr, "");
  assert.equal(compiled.status, 0);
  assert.equal(compiled.stdout, evaluated.stdout);
  assert.match(compiled.stdout, /who was greeted\("hello, Ada"\) = Ada/);
});
