// std.ts split for pages (C251): its ids kept as plain constants in
// std-ids.ts, written from std.ts, and what its builtins run kept in
// std-run.ts, so a page's runtime carries neither the library's nodes nor
// its signatures.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { stdIdsText } from "../library/std-ids.ts";
import { SIGS } from "../src/lang/std.ts";
import { STD_IMPL, STD_MANY } from "../src/lang/std-impl.ts";

test("std-ids.ts is what std.ts's ids are (else run node library/std-ids.ts)", () => {
  assert.equal(readFileSync(join(import.meta.dirname, "../src/lang/std-ids.ts"), "utf8"), stdIdsText());
});

test("every builtin std-run.ts runs is one std.ts types, with one answer or several, not both", () => {
  for (const id of [...Object.keys(STD_IMPL), ...Object.keys(STD_MANY)]) assert.ok(SIGS[id], `${id} has a signature`);
  for (const id of Object.keys(STD_IMPL)) assert.ok(!STD_MANY[id], `${id} isn't in both`);
});

test("a page's prebuilt runtime carries no builtin's signature or name", async () => {
  const { corePageRuntime } = await import("../cli/web.ts");
  const plain = await corePageRuntime(true);
  // A name only std.ts's signatures give.
  assert.ok(!plain.includes("round to Float32"), "std.ts isn't bundled");
});
