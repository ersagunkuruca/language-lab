// The order on plain data (BACKLOG L66, LANGUAGE-NEEDS-2026-10-24 §2):
// `compare` answers before, same or after for any two values of one plain
// type: numbers by value, text by code point, cases in the order their type
// declares them, then fields left to right. `sort` is a merge sort over it
// that surely finishes. Evaluated and compiled the same.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { Lang } from "../src/lang/dsl.ts";
import { infer } from "../src/lang/infer.ts";
import { makeRunner, type Value } from "../src/lang/run.ts";
import { base, baseNames, checkOptions } from "../src/lang/load.ts";
import { LIBRARY } from "../src/lang/library.ts";
import { COMPARE, NONE, SHOW_ANY, SOME } from "../src/lang/std.ts";
import { NUMBER, RATIONAL_TYPE, STRING, showType } from "../src/lang/types.ts";
import { subtree, type Id } from "../src/model.ts";
import { B } from "../src/prelude.ts";
import { compile } from "../../compiler/src/compile.ts";

const runtime = pathToFileURL(join(import.meta.dirname, "../../compiler/src/runtime.js")).href;
const lib = (name: string) => LIBRARY.modules.flatMap((m) => m.exports).find((d) => LIBRARY.names[d] === name)!;

function program() {
  const k = new Lang(LIBRARY.code);
  const def = (name: string, body: () => Id) => { const d = k.def(name); k.define(d, body()); return d; };
  // Declared low, medium, high: that is their order, whatever their names.
  const Level = k.type("Level", [], [["low", []], ["medium", []], ["high", []]]);
  const Point = k.type("Point", [], [["point", [["x", () => k.tref(NUMBER)], ["label", () => k.tref(STRING)]]]]);
  const sort = lib("sort");
  const show = (x: Id) => k.call(SHOW_ANY, x);
  const cmp = (a: Id, b: Id) => show(k.call(COMPARE, a, b));
  const p = (x: number, l: string) => k.call(Point.v.point, k.lit(x), k.lit(l));
  const xOf = () => k.fn(["point"], (q) => k.match(q, [{ variant: Point.v.point, names: ["x", "label"], body: ([x]) => x }]));
  const defs = {
    numbers: def("numbers", () => k.list(cmp(k.lit(1), k.lit(2)), cmp(k.lit(2), k.lit(2)), cmp(k.int("9007199254740993"), k.int(3)), cmp(k.lit(0.1 + 0.2), k.lit(0.3)), cmp(k.lit(-0), k.lit(0)))),
    texts: def("texts", () => k.list(cmp(k.lit("apple"), k.lit("banana")), cmp(k.lit("b"), k.lit("ab")), cmp(k.lit("ab"), k.lit("abc")))),
    fractions: def("fractions", () => k.list(cmp(k.at(RATIONAL_TYPE, "1/2"), k.at(RATIONAL_TYPE, "1/3")), cmp(k.at(RATIONAL_TYPE, "2/4"), k.at(RATIONAL_TYPE, "1/2")))),
    cases: def("cases", () => k.list(cmp(k.x(Level.v.high), k.x(Level.v.low)), cmp(k.x(NONE), k.call(SOME, k.lit(0))), cmp(p(1, "b"), p(1, "a")))),
    lists: def("lists", () => k.list(cmp(k.list(), k.list(k.lit(0))), cmp(k.list(k.lit(1), k.lit(2)), k.list(k.lit(1), k.lit(3))), cmp(k.list(k.lit(2)), k.list(k.lit(1), k.lit(9))))),
    sortedNumbers: def("sorted numbers", () => show(k.call(sort, k.list(...[5, 3, 9, 1, 3, 7, 2, 8, 0, 6, 4].map((n) => k.lit(n)))))),
    sortedTexts: def("sorted texts", () => show(k.call(sort, k.list(k.lit("pear"), k.lit("apple"), k.lit("fig"))))),
    sortedLevels: def("sorted levels", () => show(k.call(sort, k.list(k.x(Level.v.high), k.x(Level.v.low), k.x(Level.v.medium), k.x(Level.v.low))))),
    sortedEmpty: def("sorted empty", () => show(k.call(sort, k.list()))),
    // sort by (L104): by x alone, so the labels keep the list's order on a
    // tie (stable); by −x for the largest first.
    sortedByX: def("sorted by x", () => show(k.call(lib("sort by"), k.list(p(3, "c"), p(1, "z"), p(2, "b"), p(1, "a"), p(3, "a"), p(1, "m")), xOf()))),
    sortedByMinusX: def("sorted by minus x", () => show(k.call(lib("sort by"), k.list(p(1, "a"), p(3, "b"), p(2, "c"), p(3, "a")), k.fn(["point"], (q) => k.call(B.neg, k.call(xOf(), q)))))),
    sortedByEmpty: def("sorted by empty", () => show(k.call(lib("sort by"), k.list(), xOf()))),
    // Functions can't be compared, as they can't be told equal.
    functions: def("functions", () => k.call(COMPARE, k.fn(["x"], (x) => x), k.fn(["x"], (x) => x))),
  };
  const code = base(k.code), names = baseNames(k.names);
  return { code, names, info: infer(code, names, undefined, checkOptions), defs };
}

const NAMES = ["numbers", "texts", "fractions", "cases", "lists", "sorted numbers", "sorted texts", "sorted levels", "sorted empty", "sorted by x", "sorted by minus x", "sorted by empty"];
const items = (v: Value): Value[] => { const out: Value[] = []; let l = v as { fields: Value[] }; while (l.fields.length) { out.push(l.fields[0]); l = l.fields[1] as { fields: Value[] }; } return out; };

test("compare: numbers by value, text by code point, cases in declared order, then fields; functions are refused", () => {
  const p = program();
  const errs = (d: Id) => p.info.errors.filter((e) => subtree(p.code, d).includes(e.id)).map((e) => e.message);
  for (const n of NAMES) assert.deepEqual(errs(p.code.defs.find((d) => p.names[d] === n)!), [], n);
  assert.ok(errs(p.defs.functions).length > 0);
  const r = makeRunner(p.code, p.info, { print: () => {}, names: p.names });
  const v = (d: Id) => r.value(d);
  // Float64s exactly (0.1 + 0.2 is after 0.3, though equal to it), −0 the
  // same as 0. No NaN to place: every Float64 is finite (L125a).
  assert.deepEqual(items(v(p.defs.numbers)), ["before", "same", "after", "after", "same"]);
  assert.deepEqual(items(v(p.defs.texts)), ["before", "after", "before"]);
  assert.deepEqual(items(v(p.defs.fractions)), ["after", "same"]);
  assert.deepEqual(items(v(p.defs.cases)), ["after", "before", "after"]);
  assert.deepEqual(items(v(p.defs.lists)), ["before", "before", "after"]);
  assert.equal(v(p.defs.sortedNumbers), "[0, 1, 2, 3, 3, 4, 5, 6, 7, 8, 9]");
  assert.equal(v(p.defs.sortedTexts), '["apple", "fig", "pear"]');
  assert.equal(v(p.defs.sortedLevels), "[low, low, medium, high]");
  assert.equal(v(p.defs.sortedEmpty), "[]");
  assert.equal(v(p.defs.sortedByX), '[point(1, "z"), point(1, "a"), point(1, "m"), point(2, "b"), point(3, "c"), point(3, "a")]');
  assert.equal(v(p.defs.sortedByMinusX), '[point(3, "b"), point(3, "a"), point(2, "c"), point(1, "a")]');
  assert.equal(v(p.defs.sortedByEmpty), "[]");
});

test("sort surely finishes: its type has no Diverge, and it takes any plain data", () => {
  const p = program();
  const sc = p.info.schemes.get(lib("sort"))!;
  assert.equal(showType(sc.type, p.names), "(List a) -> List a");
  assert.equal(showType(p.info.schemes.get(lib("sort by"))!.type, p.names), "(List a, (a) -[e]-> b) -[e]-> List a");
});

test("compiled JavaScript gives the evaluator's answers", async () => {
  const p = program();
  const ok = new Set(NAMES.map((n) => p.code.defs.find((d) => p.names[d] === n)!));
  const clean = { ...p.info, errors: p.info.errors.filter((e) => [...ok].some((d) => subtree(p.code, d).includes(e.id))) };
  const r = makeRunner(p.code, p.info, { print: () => {}, names: p.names });
  const path = join(mkdtempSync(join(tmpdir(), "order-")), "order.js");
  writeFileSync(path, compile(p.code, clean, p.names, { runtime, exports: NAMES }));
  const defs = (await import(pathToFileURL(path).href)).defs as Record<string, unknown>;
  for (const n of NAMES) {
    const c = typeof defs[n] === "function" ? (defs[n] as () => Value)() : defs[n];
    assert.deepEqual(c, r.value(p.code.defs.find((d) => p.names[d] === n)!), n);
  }
});

// REVIEW-2026-10-26.md §1.1: an order a set relies on has to be one. With
// nearness, a, a + d and a + 2d (each within 1e-9 of the next, the ends
// not) made a set of 2 or of 1 depending on the order they came in.
test("a set of Float64s is the same whatever order its items come in", () => {
  const k = new Lang(LIBRARY.code);
  const a = 1000.5, d = 1.5e-6;
  const set = (xs: Id[]) => k.call(lib("as set"), k.list(...xs));
  const show = (x: Id) => k.call(SHOW_ANY, x);
  const defs = [
    ...[[a, a + d, a + 2 * d], [a + d, a, a + 2 * d], [a, a + 2 * d, a + d]].map((xs, i) => { const x = k.def(`order ${i}`); k.define(x, show(k.call(lib("set size"), set(xs.map((n) => k.lit(n)))))); return x; }),
  ];
  const code = base(k.code), names = baseNames(k.names), info = infer(code, names, undefined, checkOptions);
  assert.deepEqual(info.errors, []);
  const r = makeRunner(code, info, { print: () => {}, names });
  assert.deepEqual(defs.map((x) => r.value(x)), ["3", "3", "3"]);
});
