// A stop ends the run with its reason, and no handler in the program gets
// it (SPEC §8.4, L221): an overflow and a `stop with` inside a handler of
// Abort stop on the evaluator and in compiled JavaScript alike.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { compile } from "../../compiler/src/compile.ts";
import type { Id } from "../src/model.ts";
import { Lang } from "../src/lang/dsl.ts";
import { infer } from "../src/lang/infer.ts";
import { LIBRARY } from "../src/lang/library.ts";
import { base, baseNames } from "../src/lang/load.ts";
import { runMain } from "../src/lang/run.ts";
import { ABORT_OP, S } from "../src/lang/std.ts";
import { B } from "../src/prelude.ts";

const runtime = pathToFileURL(join(import.meta.dirname, "../../compiler/src/runtime.js")).href;

async function underHandler(inner: (k: Lang) => Id, why: RegExp) {
  const k = new Lang(LIBRARY.code);
  const main = k.def("main");
  k.define(main, k.thunk(() => k.handle(inner(k), [{ variant: ABORT_OP, names: ["why"], body: () => k.lit("caught") }])));
  const code = base(k.code), names = baseNames(k.names), info = infer(code, names);
  assert.deepEqual(info.errors.map((e) => e.message), []);
  assert.throws(() => runMain(code, info, main, { print: () => {}, names }), why);
  const path = join(mkdtempSync(join(tmpdir(), "stops-")), "main.mjs");
  writeFileSync(path, compile(code, info, names, { runtime, exports: ["main"] }));
  const defs = (await import(pathToFileURL(path).href)).defs as Record<string, () => unknown>;
  assert.throws(() => (typeof defs.main === "function" ? defs.main() : defs.main), why);
}

test("an overflow inside a handler of Abort still stops", () =>
  underHandler((k) => k.call(S.show, k.call(B.mul, k.lit(1e308), k.lit(10))), /too big for a Float64/));

test("a stop with a reason inside a handler of Abort still stops", () =>
  underHandler((k) => k.call(S.stop, k.lit("shapes differ")), /shapes differ/));
