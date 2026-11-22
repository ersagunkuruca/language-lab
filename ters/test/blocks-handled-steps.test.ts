// Steps handled or matched on read as steps under the word, in their order,
// not as a function applied (Ersagun 2026-11-22: chapters' main read
// `handle ((_) => 0)(‹split book›(path, folder))`).
import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { root } from "../src/io.ts";
import { loadProgram } from "../src/lang/load.ts";
import { blocksOf, blocksText } from "../src/lang/render.ts";

test("a handled run of steps reads one step a line, under handle", () => {
  const p = loadProgram(join(root, "examples", "chapters"));
  const text = blocksText(blocksOf(p.code, p.pres, null, p.named("main"), { pane: true })).join("\n");
  assert.doesNotMatch(text, /=>/);
  assert.match(text, /\n( +)match\n\1    ‹split book›\(path, folder\)\n\1    0\n\1  abort\(why\) →/);
});
