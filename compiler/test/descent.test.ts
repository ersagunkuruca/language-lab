// calc's printer read backwards by recursive descent (C110 s3,
// GRAMMAR-DESCENT-2026-11-05.md): each line without a binary operator
// reads to what relate.ts's search reads it to, in one pass. The binary
// arm is left recursion, which step 4 reads, so a line with an operator
// has no reading here yet.

import { test } from "node:test";
import assert from "node:assert/strict";
import { load } from "../src/program.ts";
import { descentReader } from "../src/descent.ts";
import { makeRunner, showValue, type Value } from "../../ters/src/lang/run.ts";

const p = load("calc");
const r = makeRunner(p.code, p.info, { print: () => {} });
const shown = (v: Value) => showValue(v, p.code, p.pres.names);
const searched = (line: string) => [...r.call(r.value(p.named("read expression")), line)].map(shown);
const descent = descentReader(p.code, p.named("expression text"), p.pres.names);
const read = (line: string) => { const v = descent(line, 0); return v === null ? [] : [shown(v)]; };

test("calc's lines without an operator read by descent as the search reads them (C110 s3)", () => {
  for (const line of ["12", "x", "abc", "-2", "--x", "(-x)", "((1))", "-(-x)", "(x)", "-(12)"]) assert.deepEqual(read(line), searched(line), line);
});

test("a line that isn't an expression has no reading by descent either (C110 s3)", () => {
  for (const line of ["", "-", "(1", "1)", "x1", "1x", "( 1)"]) assert.deepEqual(read(line), searched(line), line);
});

test("a line with an operator waits for step 4: the binary arm is left recursion (C110 s3)", () => {
  assert.deepEqual(read("1 + 2"), []);
  assert.notDeepEqual(searched("1 + 2"), []);
});
