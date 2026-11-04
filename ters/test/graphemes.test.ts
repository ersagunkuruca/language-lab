// Graphemes beside characters (BACKLOG L214c, TEXT-2026-11-03.md §3):
// `graphemes` gives what a reader sees as characters, `grapheme count`
// how many; `characters` and `length` stay code points. Evaluated and
// compiled the same.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { compile } from "../../compiler/src/compile.ts";
import { Lang } from "../src/lang/dsl.ts";
import { infer } from "../src/lang/infer.ts";
import { base, baseNames } from "../src/lang/load.ts";
import { runMain } from "../src/lang/run.ts";
import { SHOW_ANY, TEXT_OPS } from "../src/lang/std.ts";

const runtime = pathToFileURL(join(import.meta.dirname, "../../compiler/src/runtime.js")).href;

test("graphemes: a flag, a thumb with a skin tone and an accented e are one each", async () => {
  // "é" written as e and a combining accent, so NFC would join it, but here
  // the text is built from pieces and not normalized.
  const text = "a🇹🇷👍🏽é!";
  const k = new Lang();
  const main = k.def("main");
  k.define(main, k.thunk(() => k.call(SHOW_ANY, k.listOf(
    k.call(SHOW_ANY, k.call(TEXT_OPS.graphemes, k.lit(text))),
    k.call(SHOW_ANY, k.call(TEXT_OPS.graphemeCount, k.lit(text))),
    k.call(SHOW_ANY, k.call(TEXT_OPS.length, k.lit(text))),
    k.call(SHOW_ANY, k.call(TEXT_OPS.graphemeCount, k.lit("")))))));
  const code = base(k.code), names = baseNames(k.names);
  const info = infer(code, names);
  assert.deepEqual(info.errors.map((e) => e.message), []);
  const want = JSON.stringify([JSON.stringify(["a", "🇹🇷", "👍🏽", "é", "!"]).replace(/,/g, ", "), "5", "8", "0"]).replace(/","/g, '", "');
  const ran = runMain(code, info, main, { print: () => {}, names });
  assert.equal(ran, want);
  const path = join(mkdtempSync(join(tmpdir(), "graphemes-")), "main.mjs");
  writeFileSync(path, compile(code, info, names, { runtime, exports: ["main"] }));
  const defs = (await import(pathToFileURL(path).href)).defs as Record<string, () => unknown>;
  assert.equal(typeof defs.main === "function" ? defs.main() : defs.main, want);
});
