// What each arm of calc's printer can print first (C110 s2): the report
// recursive descent will be built on (GRAMMAR-DESCENT-2026-11-05.md).
// literal starts with a digit, variable with what calc's own `letter`
// passes (its guard tests the name's first character, C110 s5a), negative with "-"
// or the "(" its optional parentheses give, and binary with itself (left
// recursion, read by precedence climbing) or "(".

import { test } from "node:test";
import assert from "node:assert/strict";
import { load } from "../src/program.ts";
import { firstSets } from "../../ters/src/lang/first-sets.ts";

test("calc's printer: each arm's first characters, the arms they overlap on, and its left recursion (C110 s2)", () => {
  const p = load("calc");
  const r = firstSets(p.code, p.named("expression text"), p.pres.names);
  assert.deepEqual(r.arms.map((a) => [a.name, a.first]), [
    ["literal", ["digit"]],
    ["variable", [`test:${p.named("letter")}`]],
    ["negative", ["(", "-"]],
    ["binary", ["(", "itself"]],
  ]);
  assert.deepEqual(r.overlaps, [["negative", "binary", ["("]]]);
  assert.deepEqual(r.leftRecursive, ["binary"]);
});

test("a definition whose first input isn't matched on isn't a printer (C110 s2)", () => {
  const p = load("calc");
  assert.throws(() => firstSets(p.code, p.named("spaced"), p.pres.names), /isn't a printer/);
});
