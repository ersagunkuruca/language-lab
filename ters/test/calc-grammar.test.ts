// calc's grammar written once, as the printer `expression text`, and read
// back by running it backwards (L70b, GRAMMARS-2026-11-02): it reads
// every line the hand parser does, to the same expression.
import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { root } from "../src/io.ts";
import { infer } from "../src/lang/infer.ts";
import { loadProgram } from "../src/lang/load.ts";
import { makeRunner, showValue, type Value } from "../src/lang/run.ts";

const p = loadProgram(join(root, "examples", "calc"));
const r = makeRunner(p.code, infer(p.code, p.pres.names), { print: () => {} });
const call = (name: string, ...xs: Value[]) => [...r.call(r.value(p.named(name)), ...xs)];
const shown = (v: Value) => showValue(v, p.code, p.pres.names);
const parsed = (line: string) => { try { return call("whole expression", call("tokens", line)[0]).map(shown); } catch { return []; } };
const read = (line: string) => call("read expression", line).map(shown);

const lines = [
  "12", "x", "1 + 2", "1+2*x", "1 + 2 * 3", "(1 + 2) * 3", "1 - 2 - 3", "1 - (2 - 3)", "2 ^ 3 ^ 2", "(2 ^ 3) ^ 2",
  "-2 ^ 2", "-(1 + 2)", "--x", "((1))", "a * (b + c) / d", "1 + 2 * 3 - 4 / x ^ 2 + (y - 1) * -z",
];

test("calc's printer read backwards gives what the hand parser gives (L70b)", () => {
  for (const line of lines) assert.deepEqual(read(line), parsed(line), line);
});

test("a line that isn't an expression has no reading (L70b)", () => {
  for (const line of ["1 +", "(1 + 2", "1 2", "+", ""]) assert.deepEqual(read(line), [], line);
});

test("printing an expression read back gives the fewest parentheses (L70b)", () => {
  const e = call("read expression", "((1 + 2)) * (3)")[0];
  assert.deepEqual(call("expression text", e, 0), ["(1 + 2) * 3"]);
  assert.deepEqual(call("parenthesized", e), ["((1 + 2) * 3)"]);
});

// Where a line that has no reading stopped (L70c, relate.ts Reading): the
// furthest character any try read to or looked for something at, and
// what it looked for there. The editor marks it in the text.
test("a line with no reading says where it stopped and what was expected (L70c)", async () => {
  const { stuckReading } = await import("../src/lang/relate.ts");
  let last: Parameters<typeof stuckReading>[0] | null = null;
  const rs = makeRunner(p.code, infer(p.code, p.pres.names), { print: () => {}, stuck: (x) => { last = x; } });
  const stuck = (line: string) => { last = null; assert.deepEqual([...rs.call(rs.value(p.named("read expression")), line)], [], line); return last as { at: number; expected: Set<string> } | null; };
  assert.deepEqual([stuck("1 +")!.at, [...stuck("1 +")!.expected]], [3, ["a whole number", '"-"']]);
  assert.deepEqual([stuck("(1 + 2")!.at, [...stuck("(1 + 2")!.expected]], [6, ['")"']]);
  assert.equal(stuck("1 + x)")!.at, 5);
  assert.equal(stuckReading(stuck("1 + x)") as never), `the text can't be read back: it stops after "1 + x", before ")"`);
  assert.equal(stuckReading(stuck("(1 + 2") as never), `the text can't be read back: it stops after "(1 + 2" (the end): expected ")"`);
  // A line that reads says nothing.
  last = null;
  assert.equal([...rs.call(rs.value(p.named("read expression")), "1 + 2")].length, 1);
  assert.equal(last, null);
});
