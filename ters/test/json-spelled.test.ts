// JSON as one relation (L72e1): `json spelled` gives every text that spells
// a value, the one json printed writes first; run backwards by descent it
// reads JSON with blanks between the tokens and escaped characters.

import { test } from "node:test";
import assert from "node:assert/strict";
import { LIBRARY } from "../src/lang/library.ts";
import { infer } from "../src/lang/infer.ts";
import { makeRunner, showValue, type Value } from "../src/lang/run.ts";
import { descentReader } from "../src/lang/descent.ts";

const L = (name: string) => Object.keys(LIBRARY.names).find((d) => LIBRARY.names[d] === name && ["def", "builtin"].includes(LIBRARY.code.nodes[d]?.kind ?? ""))!;
const code = LIBRARY.code, names = LIBRARY.names;
const r = makeRunner(code, infer(code, names), { print: () => {}, names });
const first = (f: string, ...xs: Value[]) => (r.call(r.value(L(f)), ...xs) as Iterable<Value>)[Symbol.iterator]().next().value;
const shown = (v: Value | null) => (v === null ? "none" : showValue(v, code, names));
const read = descentReader(code, L("json spelled"), names);
const jsonRead = (t: string) => shown(first("json read", t));

const lines = ["null", "true", "[]", "[1,2.5,-3]", "{\"a\":[1,null],\"b\":\"x\\\"y\"}", "\"tab\\u0009 and \\\\\"", "[[],{},[{\"k\":false}]]"];

test("json spelled's first spelling is json printed (L72e1)", () => {
  for (const line of lines) {
    const v = first("json read", line);
    assert.equal(first("json spelled", v), first("json printed", v), line);
  }
});

test("json spelled read backwards reads blanks and escapes as json read does (L72e1)", () => {
  const spaced = ["  [ 1 , 2.5 ,\n -3 ]", "[1.0, 1e3, -0.5E+2, 2.50]", "{ \"a\" : [ 1 ,null ] ,\t\"b\":\"x\\\"y\" }", "\"tab\\t \\u0041\\u00e9 \\/ \\u004A\"", "[ ]", "{\r\n}", "[\"\\b\\f\\n\\r\"]"];
  for (const line of [...lines, ...spaced]) {
    const want = jsonRead(line), got = read(line.trim(), 0);
    
    assert.equal(shown(got), want, line);
  }
  for (const bad of ["[1,]", "{\"a\" 1}", "[1 2]", "\"\\x\"", "nul"]) assert.equal(read(bad, 0), null, bad);
});

// json spelled's written reader (reader.ts, L72e2b): what compiled targets
// run, the same readings as descent.
test("json spelled's written reader reads as descent does (L72e2b)", async () => {
  const { writeReader } = await import("../src/lang/reader.ts");
  const w = writeReader(code, L("json spelled"), names);
  const all = { nodes: { ...code.nodes, ...w.code.nodes }, defs: [...code.defs, ...w.code.defs.filter((d) => !code.defs.includes(d))] }, allNames = { ...names, ...w.names };
  const info = infer(all, allNames);
  assert.deepEqual(info.errors.map((e) => e.message), []);
  const rr = makeRunner(all, info, { print: () => {}, names: allNames });
  for (const line of [...lines, "\"\\u00e9\\u65E5\"", "[1.0, 1e3, -0.5E+2]", "[ 1 , 2.5 ,\n -3 ]", "{ \"a\" : [ 1 ,null ] ,\t\"b\":\"x\\\"y\" }", "\"tab\\t \\u0041 \\/\"", "[ ]", "[1,]", "{\"a\" 1}"]) {
    const got = [...(rr.call(rr.value(w.line), line) as Iterable<Value>)][0];
    const want = read(line, 0);
    assert.equal(showValue(got, all, allNames), want === null ? "none" : `some(${shown(want)})`, JSON.stringify(line));
  }
});
