// T18d: what injections.ts makes of an injection's outcome, and its entries
// are well formed. (Running them is the Nightly's: two minutes and more.)

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pickedFrom, problemsOf, type Meta } from "./injections.ts";

const meta: Meta = { bug: "#1", what: "x", tests: ["ters/test/a.test.ts", "compiler/test/b.test.ts"] };

test("an injection is fine when a named test fails and the pre-merge set picks it", () => {
  assert.deepEqual(problemsOf({ id: "x", applies: true, failed: ["compiler/test/b.test.ts"], picked: ["compiler/test/b.test.ts"] }, meta, false), []);
  assert.match(problemsOf({ id: "x", applies: true, failed: [], picked: [] }, meta, false)[0], /^no test caught it/);
  assert.match(problemsOf({ id: "x", applies: true, failed: ["ters/test/a.test.ts"], picked: ["ters/test/c.test.ts"] }, meta, false)[0], /^affected\.ts before a merge picks none/);
  assert.match(problemsOf({ id: "x", applies: false, failed: [], picked: [] }, meta, true)[0], /doesn't apply/);
  assert.deepEqual(problemsOf({ id: "x", applies: true, failed: [], picked: [] }, meta, true), []);
});

test("the tests affected.ts would run, read off its --list --why lines", () => {
  const listing = "3 files changed since HEAD\n  ters: 1 of 324 test files\n    ters/test/a.test.ts (12 s): ran src/x.ts:4\n    compiler/test/b.test.ts (3 s): new or edited\n";
  assert.deepEqual(pickedFrom(listing), ["ters/test/a.test.ts", "compiler/test/b.test.ts"]);
});

test("every entry has a patch and names tests that exist", () => {
  const here = join(import.meta.dirname, "injections"), top = join(import.meta.dirname, "../..");
  for (const id of readdirSync(here)) {
    assert.ok(existsSync(join(here, id, "injection.patch")), id);
    const m = JSON.parse(readFileSync(join(here, id, "meta.json"), "utf8")) as Meta;
    assert.ok(m.bug && m.what && m.tests.length, id);
    for (const t of m.tests) assert.ok(existsSync(join(top, t)), `${id}: ${t}`);
    assert.ok(!/^\+\+\+ b\/.*\/test\//m.test(readFileSync(join(here, id, "injection.patch"), "utf8")), `${id} touches a test`);
  }
});
