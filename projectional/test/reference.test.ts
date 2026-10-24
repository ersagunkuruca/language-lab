// LIBRARY.md is printed from the notes (library/reference.ts): it must be
// current, and everything offered must have a note and a place in it.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { offered, reference, SECTIONS } from "../library/reference.ts";
import { LIBRARY } from "../src/lang/library.ts";

test("everything offered has a plain note and one place in LIBRARY.md", () => {
  const placed = SECTIONS.flatMap((s) => s.ids);
  const name = (d: string) => LIBRARY.names[d] ?? d;
  assert.deepEqual(offered().filter((d) => !placed.includes(d)).map(name), [], "offered but in no section of library/reference.ts");
  assert.deepEqual(placed.filter((d, i) => placed.indexOf(d) !== i).map(name), [], "in two sections");
  assert.deepEqual(placed.filter((d) => !LIBRARY.comments[d]).map(name), [], "without a note (src/lang/notes.ts or the module's comments)");
});

test("LIBRARY.md is up to date (node library/reference.ts)", () => {
  assert.equal(readFileSync(new URL("../LIBRARY.md", import.meta.url), "utf8"), reference());
});
