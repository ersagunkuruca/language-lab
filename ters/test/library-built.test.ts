// The library kept in library/*.json is what its sources build (I244): a
// change to a source, or to a pass a module is built through (#2548's
// first-arms.ts), without `node library/build.ts` left cases.json's ids
// behind what a rebuild gives. The build is deterministic, so any
// difference is a rebuild not run.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildModules } from "../library/modules.ts";
import { printSaved } from "../src/saved.ts";

test("every library module kept is what its source builds (node library/build.ts)", () => {
  const stale = buildModules().filter((b) => readFileSync(join(import.meta.dirname, "../library", `${b.name}.json`), "utf8") !== printSaved(b.module)).map((b) => b.name);
  assert.deepEqual(stale, [], "run node library/build.ts and commit what it writes");
});
