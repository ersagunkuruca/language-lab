// A Choice read back (L72e2): a printer may write several texts, the one
// it prints first; descent reads each alternative of the piece and keeps
// the one that reads farthest, so a blank reads any run of spaces and
// line ends greedily, and the printer's own text still reads.

import { test } from "node:test";
import assert from "node:assert/strict";
import { Lang } from "../src/lang/dsl.ts";
import { LIBRARY } from "../src/lang/library.ts";
import { infer } from "../src/lang/infer.ts";
import { makeRunner, type Value } from "../src/lang/run.ts";
import { descentReader } from "../src/lang/descent.ts";
import { INT_OPS, S } from "../src/lang/std.ts";
import { INT } from "../src/lang/types.ts";

// blank: "" first, or a space, tab or line end and a blank after it.
// pair text(a, b): "[a,b]" first, with any blank around each number, and
// "," or ";" between them.
const k = new Lang(LIBRARY.code);
const cat = (...xs: string[]): string => xs.reduce((a, b) => k.call(S.concat, a, b));
const blank = k.def("blank");
k.define(blank, k.fn([], () => k.if(k.call(S.oneOf, k.list(k.false, k.true)), k.call(S.concat, k.call(S.oneOf, k.list(k.lit(" "), k.lit("\t"), k.lit("\n"))), k.call(blank)), k.lit(""))));
const Pair = k.type("Pair", [], [["pair", [["a", () => k.tref(INT)], ["b", () => k.tref(INT)]]]]);
const printer = k.def("pair text");
k.define(printer, k.fn(["p"], (p) => k.match(p, [{ variant: Pair.v.pair, names: ["a", "b"], body: ([a, b]) => cat(k.lit("["), k.call(blank), k.call(INT_OPS.show, a), k.call(blank), k.call(S.oneOf, k.list(k.lit(","), k.lit(";"))), k.call(blank), k.call(INT_OPS.show, b), k.call(blank), k.lit("]")) }])));
const code = { nodes: { ...LIBRARY.code.nodes, ...k.code.nodes }, defs: [...LIBRARY.code.defs, ...k.code.defs.filter((d) => !LIBRARY.code.defs.includes(d))] };
const names = { ...LIBRARY.names, ...k.names };
const r = makeRunner(code, infer(code, names), { print: () => {}, names });
const read = descentReader(code, printer, names);

test("the printer's first text is its blanks left out (L72e2)", () => {
  const first = (r.call(r.value(printer), { tag: Pair.v.pair, fields: [1, 2] }) as Iterable<Value>)[Symbol.iterator]().next().value;
  assert.equal(first, "[1,2]");
});

test("a Choice piece reads by its alternatives, blanks greedily (L72e2)", () => {
  for (const line of ["[1,2]", "[ 1 , 2 ]", "[\n\t1;2\n]", "[-1;  20]"]) assert.deepEqual((read(line, 0) as { fields?: Value[] } | null)?.fields, line.includes("-") ? [-1, 20] : [1, 2], JSON.stringify(line));
  for (const line of ["[1 2]", "[1,,2]", "[ 1,2", " [1,2]"]) assert.equal(read(line, 0), null, JSON.stringify(line));
});

// The reader written as a definition (reader.ts, L72e2b): a recursive
// piece (blank) gets a reader of its own, its Choices keeping the reading
// that goes farther, so compiled targets read as descent does.
test("the written reader reads a Choice piece as descent does (L72e2b)", async () => {
  const { writeReader } = await import("../src/lang/reader.ts");
  const { showValue } = await import("../src/lang/run.ts");
  const w = writeReader(code, printer, names);
  const all = { nodes: { ...code.nodes, ...w.code.nodes }, defs: [...code.defs, ...w.code.defs.filter((d) => !code.defs.includes(d))] }, allNames = { ...names, ...w.names };
  const info = infer(all, allNames);
  assert.deepEqual(info.errors.map((e) => e.message), []);
  const rr = makeRunner(all, info, { print: () => {}, names: allNames });
  for (const line of ["[1,2]", "[ 1 , 2 ]", "[\n\t1;2\n]", "[-1;  20]", "[1 2]", "[1,,2]", "[ 1,2", " [1,2]"]) {
    const got = [...(rr.call(rr.value(w.line), line) as Iterable<Value>)][0];
    const want = read(line, 0);
    assert.equal(showValue(got, all, allNames), want === null ? "none" : `some(${showValue(want, code, names)})`, JSON.stringify(line));
  }
});
