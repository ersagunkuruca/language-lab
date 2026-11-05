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
