// calc's printer read backwards by recursive descent (C110 s3 and s4,
// GRAMMAR-DESCENT-2026-11-05.md): each line reads to what relate.ts's
// search reads it to, in one pass.

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

// The binary arm starts with the printer itself: read by precedence
// climbing from its own condition for parentheses and the levels it
// prints its operands at (C110 s4). calc-grammar.test.ts's lines.
test("calc's lines with operators read by precedence climbing as the search reads them (C110 s4)", () => {
  for (const line of ["1 + 2", "1+2*x", "1 + 2 * 3", "(1 + 2) * 3", "1 - 2 - 3", "1 - (2 - 3)", "2 ^ 3 ^ 2", "(2 ^ 3) ^ 2",
    "-2 ^ 2", "-(1 + 2)", "a * (b + c) / d", "1 + 2 * 3 - 4 / x ^ 2 + (y - 1) * -z", "((1 + 2)) * (3)", "2 ^ -3"]) assert.deepEqual(read(line), searched(line), line);
  for (const line of ["1 +", "(1 + 2", "1 2", "+", "1 + + 2", "(1 + 2))"]) assert.deepEqual(read(line), searched(line), line);
});

// Random expressions printed by calc's printer read back to themselves
// (C110 s4): the printer and its reading by descent agree, which the
// search, at about a second a line, is too slow to check at this size.
test("calc's printer, read back by descent, gives each of 300 random expressions back (C110 s4)", () => {
  // The printer's arms, one per case: literal, variable, negative, binary.
  const printer = p.code.nodes[(p.code.nodes[p.named("expression text")] as { body: string }).body] as { body: string };
  const [lit, vari, neg, bin] = (p.code.nodes[printer.body] as { arms: string[] }).arms.map((a) => (p.code.nodes[a] as { variant: string }).variant);
  let seed = 7;
  const rand = (n: number) => ((seed = (seed * 1103515245 + 12345) % 2147483648), seed % n);
  const make = (depth: number): Value => {
    const k = depth === 0 ? rand(2) : rand(4);
    if (k === 0) return { tag: lit, fields: [rand(100)] };
    if (k === 1) return { tag: vari, fields: [["x", "y", "ab"][rand(3)]] };
    if (k === 2) return { tag: neg, fields: [make(depth - 1)] };
    return { tag: bin, fields: [["+", "-", "*", "/", "^"][rand(5)], make(depth - 1), make(depth - 1)] };
  };
  const print = (e: Value) => [...r.call(r.value(p.named("expression text")), e, 0)][0] as string;
  for (let i = 0; i < 300; i++) {
    const e = make(4), line = print(e);
    assert.equal(read(line)[0], shown(e), line);
  }
});
