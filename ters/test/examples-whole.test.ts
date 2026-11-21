// Every shipped example is whole: no hole left in it. The editor runs a
// program with a hole as a value, not a page, so a hole left by an edit
// (the looper's `going`, I337) showed nothing where the page was, while
// `ters` ran it.

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../examples/", import.meta.url));

test("no shipped example has a hole", () => {
  const holed = readdirSync(root).filter((e) => existsSync(join(root, e, "code.json")) && /"kind": ?"hole"/.test(readFileSync(join(root, e, "code.json"), "utf8")));
  assert.deepEqual(holed, []);
});
