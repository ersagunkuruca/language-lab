// Steps handled or matched on read as steps, not as a function applied
// (Ersagun 2026-11-22: chapters' main read
// `handle ((_) => 0)(‹split book›(path, folder))`, then "what does it even
// mean?" of each step and its result on lines of their own): a short run
// reads on one line, each step then `;`, then what it gives.
import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { root } from "../src/io.ts";
import { loadProgram } from "../src/lang/load.ts";
import { blocksOf, blocksText } from "../src/lang/render.ts";

test("a short run of steps handled, or after a case's arrow, reads on one line", () => {
  const p = loadProgram(join(root, "examples", "chapters"));
  const text = blocksText(blocksOf(p.code, p.pres, null, p.named("main"), { pane: true })).join("\n");
  assert.doesNotMatch(text, /=>/);
  assert.match(text, /\n( +)match \{ ‹split book›\(path, folder\); 0 \}\n\1  abort\(why\) → \{ ‹print error›\("chapters: " \+\+ why\); 1 \}\n/);
  assert.match(text, /otherwise → \{ ‹print error›\("usage: chapters book\.md folder"\); 2 \}$/);
});
