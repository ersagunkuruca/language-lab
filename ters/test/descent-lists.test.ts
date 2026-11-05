// A list read item by item between separators (L72b): a printer that
// writes `join all(map(xs, f), sep)` reads back by descent, each item by
// f backwards, the separators between them, none too.

import { test } from "node:test";
import assert from "node:assert/strict";
import { Lang } from "../src/lang/dsl.ts";
import { LIBRARY } from "../src/lang/library.ts";
import { infer } from "../src/lang/infer.ts";
import { makeRunner, showValue, type Value } from "../src/lang/run.ts";
import { descentReader } from "../src/lang/descent.ts";
import { INT_OPS, LIST, S } from "../src/lang/std.ts";
import { INT } from "../src/lang/types.ts";

const L = (name: string) => Object.keys(LIBRARY.names).find((d) => LIBRARY.names[d] === name && ["def", "builtin"].includes(LIBRARY.code.nodes[d]?.kind ?? ""))!;

// Trees of whole numbers printed as nested lists: [1,[2,3],[]].
const k = new Lang(LIBRARY.code);
const Tree = k.type("Tree", [], [["leaf", [["n", () => k.tref(INT)]]], ["node", [["kids", (self) => k.tref(LIST, k.tref(self))]]]]);
const printer = k.def("tree text");
k.define(printer, k.fn(["tree"], (t) => k.match(t, [
  { variant: Tree.v.leaf, names: ["n"], body: ([n]) => k.call(INT_OPS.show, n) },
  { variant: Tree.v.node, names: ["kids"], body: ([kids]) => k.call(S.concat, k.lit("["), k.call(S.concat, k.call(L("join all"), k.call(L("map"), kids, k.x(printer)), k.lit(",")), k.lit("]"))) },
])));
const code = { nodes: { ...LIBRARY.code.nodes, ...k.code.nodes }, defs: [...LIBRARY.code.defs, ...k.code.defs.filter((d) => !LIBRARY.code.defs.includes(d))] };
const names = { ...LIBRARY.names, ...k.names };
const r = makeRunner(code, infer(code, names), { print: () => {}, names });
const shown = (v: Value) => showValue(v, code, names);
const read = descentReader(code, printer, names);

test("nested lists read back by descent, empty ones too (L72b)", () => {
  for (const line of ["1", "[]", "[1]", "[1,2,3]", "[[],[[]]]", "[1,[2,3],[],4]", "[-5,[[6]]]"]) {
    const v = read(line, 0);
    assert.ok(v !== null, line);
    const back = [...(r.call(r.value(printer), v) as Iterable<Value>)][0];
    assert.equal(back, line, `${line} read as ${shown(v)}`);
  }
});

test("a list with a separator and no item after it, or no closing bracket, has no reading (L72b)", () => {
  for (const line of ["[1,]", "[,1]", "[1", "[1,,2]", "[1 2]", "1]"]) assert.equal(read(line, 0), null, line);
});

// The reader written as a definition (reader.ts, L72b2): the same
// readings, run by the evaluator, as compiled targets run it.
test("the written reader reads the nested lists as descent does (L72b2)", async () => {
  const { writeReader } = await import("../src/lang/reader.ts");
  const w = writeReader(code, printer, names);
  const all = { nodes: { ...code.nodes, ...w.code.nodes }, defs: [...code.defs, ...w.code.defs.filter((d) => !code.defs.includes(d))] }, allNames = { ...names, ...w.names };
  const info = infer(all, allNames);
  assert.deepEqual(info.errors.map((e) => e.message), []);
  const rr = makeRunner(all, info, { print: () => {}, names: allNames });
  for (const line of ["1", "[]", "[1]", "[1,2,3]", "[[],[[]]]", "[1,[2,3],[],4]", "[1,]", "[1", "[1,,2]", "1]"]) {
    const got = [...(rr.call(rr.value(w.line), line) as Iterable<Value>)][0];
    const want = read(line, 0);
    assert.equal(showValue(got, all, allNames), want === null ? "none" : `some(${shown(want)})`, line);
  }
});

// Float64s as show writes them (L72c): read back to the number whose show
// is that text, as the search reads them.
test("Float64s read back by descent as show writes them (L72c)", async () => {
  const { NUMBER } = await import("../src/lang/types.ts");
  const k2 = new Lang(LIBRARY.code);
  const V = k2.type("Values", [], [["one", [["x", () => k2.tref(NUMBER)]]], ["many", [["items", (self) => k2.tref(LIST, k2.tref(self))]]]]);
  const pr = k2.def("values text");
  k2.define(pr, k2.fn(["v"], (v) => k2.match(v, [
    { variant: V.v.one, names: ["x"], body: ([x]) => k2.call(S.show, x) },
    { variant: V.v.many, names: ["items"], body: ([items]) => k2.call(S.concat, k2.lit("("), k2.call(S.concat, k2.call(L("join all"), k2.call(L("map"), items, k2.x(pr)), k2.lit(" ")), k2.lit(")"))) },
  ])));
  const c2 = { nodes: { ...LIBRARY.code.nodes, ...k2.code.nodes }, defs: [...LIBRARY.code.defs, ...k2.code.defs.filter((d) => !LIBRARY.code.defs.includes(d))] }, n2 = { ...LIBRARY.names, ...k2.names };
  const r2 = makeRunner(c2, infer(c2, n2), { print: () => {}, names: n2 });
  const rd = descentReader(c2, pr, n2);
  for (const line of ["1", "-2.5", "0.3", "(1 2.25 (-0.5) ())", "1e-12", "(3 1e-7)"]) {
    const v = rd(line, 0);
    assert.ok(v !== null, line);
    assert.equal([...(r2.call(r2.value(pr), v) as Iterable<Value>)][0], line, line);
  }
  // Spellings show doesn't write have no reading.
  for (const line of ["1.0", "+1", "0.30", ".5", "1e3", "(1  2)"]) assert.equal(rd(line, 0), null, line);
  // The written reader (reader.ts, L72c2) reads them the same.
  const { writeReader } = await import("../src/lang/reader.ts");
  const w = writeReader(c2, pr, n2);
  const all = { nodes: { ...c2.nodes, ...w.code.nodes }, defs: [...c2.defs, ...w.code.defs.filter((d) => !c2.defs.includes(d))] }, allNames = { ...n2, ...w.names };
  const info = infer(all, allNames);
  assert.deepEqual(info.errors.map((e) => e.message), []);
  const rr = makeRunner(all, info, { print: () => {}, names: allNames });
  for (const line of ["1", "-2.5", "0.3", "(1 2.25 (-0.5) ())", "1e-12", "(3 1e-7)", "1.0", "+1", "0.30", ".5", "1e3", "(1  2)"]) {
    const got = [...(rr.call(rr.value(w.line), line) as Iterable<Value>)][0];
    const want = rd(line, 0);
    assert.equal(showValue(got, all, allNames), want === null ? "none" : `some(${showValue(want, c2, n2)})`, line);
  }
});

// A Text's characters each written by a function of one character
// (L72d): json quoted's escapes read back.
test("json quoted text reads back by descent, its escapes too (L72d)", async () => {
  const { STRING } = await import("../src/lang/types.ts");
  const k3 = new Lang(LIBRARY.code);
  const Q = k3.type("Quoted", [], [["quoted", [["t", () => k3.tref(STRING)]]]]);
  const pr = k3.def("quoted text");
  k3.define(pr, k3.fn(["q"], (q) => k3.match(q, [{ variant: Q.v.quoted, names: ["t"], body: ([t]) => k3.call(L("json quoted"), t) }])));
  const c3 = { nodes: { ...LIBRARY.code.nodes, ...k3.code.nodes }, defs: [...LIBRARY.code.defs, ...k3.code.defs.filter((d) => !LIBRARY.code.defs.includes(d))] }, n3 = { ...LIBRARY.names, ...k3.names };
  const r3 = makeRunner(c3, infer(c3, n3), { print: () => {}, names: n3 });
  const rd = descentReader(c3, pr, n3);
  const print = (t: string) => [...(r3.call(r3.value(pr), { tag: Q.v.quoted, fields: [t] }) as Iterable<Value>)][0] as string;
  for (const t of ["", "abc", 'say "hi"', "back\\slash", "two\nlines", "tab\there", "\u0001", "çağ 🙂"]) {
    const line = print(t), v = rd(line, 0) as { fields: Value[] } | null;
    assert.equal(v?.fields[0], t, line);
  }
  for (const line of ['"a', 'a"', '"\\q"', '"a"b"']) assert.equal(rd(line, 0), null, line);
});

// The prelude's `json printed` read backwards by descent (L72d): what
// `json read` reads, for the compact text json printed writes.
test("json printed reads back by descent as json read reads it (L72d)", () => {
  const jp = L("json printed"), jr = L("json read");
  const rl = makeRunner(LIBRARY.code, infer(LIBRARY.code, LIBRARY.names), { print: () => {}, names: LIBRARY.names });
  const rd = descentReader(LIBRARY.code, jp, LIBRARY.names);
  for (const t of ["null", "true", "[]", "{}", '[1,2.5,"a\\"b"]', '{"a":[1,{"b":null}],"c":false}', '"tab\\u0009there \\n\\u0001"', "-0.125"]) {
    const v = rd(t, 0);
    assert.ok(v !== null, t);
    const back = [...(rl.call(rl.value(jp), v) as Iterable<Value>)][0];
    assert.equal(back, t, t);
    const viaRead = [...(rl.call(rl.value(jr), t) as Iterable<Value>)][0];
    assert.equal(showValue(v, LIBRARY.code, LIBRARY.names), showValue(viaRead, LIBRARY.code, LIBRARY.names), t);
  }
  for (const t of ["[1,]", "{\"a\"}", "nul", "[1 2]"]) assert.equal(rd(t, 0), null, t);
});
