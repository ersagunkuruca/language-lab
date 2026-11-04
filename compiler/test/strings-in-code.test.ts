// A "//" inside a text the program writes (an address) isn't a comment:
// the compiler keeps the definitions a line calls after one (L191c found
// `utf8 of` dropped after "http://…", and the run stopped on it).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { Lang } from "../../ters/src/lang/dsl.ts";
import { infer } from "../../ters/src/lang/infer.ts";
import { base, baseNames } from "../../ters/src/lang/load.ts";
import { runMain } from "../../ters/src/lang/run.ts";
import { ARITH, SHOW_ANY, tupleVariant } from "../../ters/src/lang/std.ts";
import { compile } from "../src/compile.ts";

const runtime = pathToFileURL(join(import.meta.dirname, "../src/runtime.js")).href;

test("a call after a text with // in it on the same line is compiled", async () => {
  const k = new Lang();
  const next = k.def("next");
  k.define(next, k.fn(["x"], (x) => k.call(ARITH.add, x, k.lit(1))));
  const main = k.def("main");
  k.define(main, k.thunk(() => k.call(SHOW_ANY, k.call(tupleVariant(2), k.lit("http://example.com/'a'"), k.call(next, k.lit(1))))));
  const code = base(k.code), names = baseNames(k.names), info = infer(code, names);
  assert.deepEqual(info.errors.map((e) => e.message), []);
  const want = runMain(code, info, main, { print: () => {}, names });
  const file = join(mkdtempSync(join(tmpdir(), "strings-in-code-")), "main.mjs");
  writeFileSync(file, compile(code, info, names, { runtime, exports: ["main"] }));
  const defs = (await import(pathToFileURL(file).href)).defs as Record<string, () => unknown>;
  assert.equal(defs.main(), want);
});
