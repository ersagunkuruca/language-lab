// machine's lists in groups, each with the representation its own
// definitions would choose (C93 s2, REPRESENTATION-PER-VALUE-2026-11-05.md):
// a report. The whole program picks trees; its step loop alone picks
// arrays, and its assembler cons lists, with crossings between them.

import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { loadProgram } from "../../ters/src/lang/load.ts";
import { listGroups } from "../../ters/src/lang/rep-groups.ts";

test("machine's list groups: trees for the whole, arrays for the step loop, cons lists for the assembler (C93 s2)", () => {
  const p = loadProgram(join(import.meta.dirname, "../gaps/machine"));
  const r = listGroups(p.code, p.named("main"), p.own.defs);
  const groupOf = (name: string) => r.groups.find((g) => g.defs.includes(p.named(name)))!;
  assert.equal(r.whole, "tree of List");
  for (const step of ["stepped", "executed", "loaded", "stored"]) assert.equal(groupOf(step).rep, "array of List", step);
  assert.equal(groupOf("code of").rep, "List as written");
  // Each crossing joins two groups that chose differently.
  assert.ok(r.crossings.length > 0);
  for (const c of r.crossings) assert.notEqual(c.fromRep, c.toRep);
});
