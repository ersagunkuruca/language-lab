// Case in a language (BACKLOG L214b, TEXT-2026-11-03.md §2): uppercase
// and lowercase take a Locale, so Turkish i goes up to İ and I down to ı,
// and the same text in the same language gives the same answer on every
// machine. Evaluated and compiled the same.

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
import { LIBRARY } from "../src/lang/library.ts";
import { runMain } from "../src/lang/run.ts";
import { LOCALE_V, MY_LOCALE_OP, MY_ZONE_OP, SHOW_ANY, TEXT_OPS } from "../src/lang/std.ts";
import { $main, $setWorld } from "../../compiler/src/runtime.js";

const runtime = pathToFileURL(join(import.meta.dirname, "../../compiler/src/runtime.js")).href;
const lib = (name: string) => LIBRARY.code.defs.find((d) => LIBRARY.names[d] === name)!;

test("uppercase and lowercase in a language: Turkish dotted and dotless i", async () => {
  const k = new Lang(LIBRARY.code);
  const main = k.def("main");
  const loc = (tag: string) => k.call(LOCALE_V, k.lit(tag));
  k.define(main, k.thunk(() => k.call(SHOW_ANY, k.listOf(
    k.call(TEXT_OPS.uppercase, k.lit("istanbul"), loc("tr")),
    k.call(TEXT_OPS.uppercase, k.lit("istanbul"), loc("en")),
    k.call(TEXT_OPS.lowercase, k.lit("DIŞ"), loc("tr")),
    k.call(TEXT_OPS.lowercase, k.lit("DIŞ"), loc("en-GB")),
    k.call(TEXT_OPS.uppercase, k.lit("straße"), loc("de")),
    // A tag that can't be read is the root locale's mapping.
    k.call(TEXT_OPS.uppercase, k.lit("i"), loc("not a tag!")),
    k.call(lib("ascii uppercase"), k.lit("istanbul"))))));
  const code = base(k.code), names = baseNames(k.names);
  const info = infer(code, names);
  assert.deepEqual(info.errors.map((e) => e.message), []);
  const want = '["İSTANBUL", "ISTANBUL", "dış", "diş", "STRASSE", "I", "ISTANBUL"]';
  assert.equal(runMain(code, info, main, { print: () => {}, names }), want);
  const path = join(mkdtempSync(join(tmpdir(), "case-")), "main.mjs");
  writeFileSync(path, compile(code, info, names, { runtime, exports: ["main"] }));
  const defs = (await import(pathToFileURL(path).href)).defs as Record<string, () => unknown>;
  assert.equal(typeof defs.main === "function" ? defs.main() : defs.main, want);
});

// L214d: people's order for text in a language, given to sort with;
// compare and < stay code-point order.
test("collated: Turkish puts ç after c; sort with keeps equal items in order", async () => {
  const k = new Lang(LIBRARY.code);
  const main = k.def("main");
  const loc = (tag: string) => k.call(LOCALE_V, k.lit(tag));
  const words = () => k.listOf(k.lit("dağ"), k.lit("çay"), k.lit("cam"), k.lit("Zeytin"), k.lit("ılık"), k.lit("iç"));
  k.define(main, k.thunk(() => k.call(SHOW_ANY, k.listOf(
    k.call(SHOW_ANY, k.call(lib("sort with"), words(), k.call(lib("collated"), loc("tr")))),
    k.call(SHOW_ANY, k.call(lib("sort"), words())),
    k.call(SHOW_ANY, k.call(TEXT_OPS.collate, k.lit("ä"), k.lit("b"), loc("de"))),
    k.call(SHOW_ANY, k.call(TEXT_OPS.collate, k.lit("ä"), k.lit("b"), loc("sv")))))));
  const code = base(k.code), names = baseNames(k.names);
  const info = infer(code, names);
  assert.deepEqual(info.errors.map((e) => e.message), []);
  const shown = (xs: string[]) => `[${xs.map((x) => JSON.stringify(x)).join(", ")}]`;
  const want = shown([shown(["cam", "çay", "dağ", "ılık", "iç", "Zeytin"]), shown(["Zeytin", "cam", "dağ", "iç", "çay", "ılık"]), "before", "after"]);
  assert.equal(runMain(code, info, main, { print: () => {}, names }), want);
  const path = join(mkdtempSync(join(tmpdir(), "collate-")), "main.mjs");
  writeFileSync(path, compile(code, info, names, { runtime, exports: ["main"] }));
  const defs = (await import(pathToFileURL(path).href)).defs as Record<string, () => unknown>;
  assert.equal(typeof defs.main === "function" ? defs.main() : defs.main, want);
});

// L214b2: my locale() reads the user's language from the world, as now()
// reads the clock; a match answers it.
test("my locale: from the world, or from a handler", async () => {
  const k = new Lang(LIBRARY.code);
  const main = k.def("main");
  const up = () => k.call(TEXT_OPS.uppercase, k.lit("iyi"), k.call(MY_LOCALE_OP));
  k.define(main, k.thunk(() => k.call(SHOW_ANY, k.listOf(
    up(),
    k.handle(up(), [{ variant: MY_LOCALE_OP, names: [], body: () => k.call(LOCALE_V, k.lit("en")) }, { variant: MY_ZONE_OP, names: [], body: () => k.call(MY_ZONE_OP) }])))));
  const code = base(k.code), names = baseNames(k.names);
  const info = infer(code, names);
  assert.deepEqual(info.errors.map((e) => e.message), []);
  const want = '["İYİ", "IYI"]';
  assert.equal(runMain(code, info, main, { print: () => {}, names, world: { locale: () => "tr" } as never }), want);
  const path = join(mkdtempSync(join(tmpdir(), "my-locale-")), "main.mjs");
  writeFileSync(path, compile(code, info, names, { runtime, exports: ["main"] }));
  $setWorld({ locale: () => "tr" });
  try {
    const defs = (await import(pathToFileURL(path).href)).defs as Record<string, () => unknown>;
    assert.equal(await $main(typeof defs.main === "function" ? defs.main() : defs.main), want);
  } finally { $setWorld({}); }
});
