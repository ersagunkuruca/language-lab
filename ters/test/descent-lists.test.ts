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
});
