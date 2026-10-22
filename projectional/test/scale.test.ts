// Real-sized data: the limits REVIEW.md §2 found, pinned at sizes well past
// them. The evaluator keeps its continuation on the heap, so a list is as
// long as memory allows, whichever way it is walked.

import { test } from "node:test";
import assert from "node:assert/strict";
import { freshId, merge, MergeClash, type Code, type Id } from "../src/model.ts";
import { Lang } from "../src/lang/dsl.ts";
import { infer } from "../src/lang/infer.ts";
import { base, baseNames } from "../src/lang/load.ts";
import { equal, runMain, toList } from "../src/lang/run.ts";
import { CONS, NIL, S } from "../src/lang/std.ts";
import { B } from "../src/prelude.ts";

function printed(build: (k: Lang) => Id): string[] {
  const k = new Lang();
  const main = build(k);
  const code = base(k.code), names = baseNames(k.names);
  const info = infer(code, names);
  assert.deepEqual(info.errors, []);
  const out: string[] = [];
  runMain(code, info, main, { print: (s) => out.push(s) });
  return out;
}

const N = 200_000;
const sum = (n: number) => String((n * (n - 1)) / 2);
const showMain = (k: Lang, value: () => Id) => {
  const main = k.def("main");
  k.define(main, k.thunk(() => k.call(S.print, k.call(S.show, value()))));
  return main;
};

test(`fold over a list of ${N.toLocaleString("en")} numbers`, () => {
  assert.deepEqual(printed((k) => {
    const total = k.def("total");
    k.define(total, k.fn(["xs"], (xs) => k.fold(xs, [
      { variant: NIL, names: [], body: () => k.lit(0) },
      { variant: CONS, names: ["h", "t"], results: [null, "r"], body: ([h], [, r]) => k.call(B.add, h, r!) },
    ])));
    return showMain(k, () => k.call(total, k.call(S.range, k.lit(N))));
  }), [sum(N)]);
});

test(`plain (not tail) recursion over ${N.toLocaleString("en")} numbers`, () => {
  assert.deepEqual(printed((k) => {
    const total = k.def("total");
    k.define(total, k.fn(["xs"], (xs) => k.match(xs, [
      { variant: NIL, names: [], body: () => k.lit(0) },
      { variant: CONS, names: ["h", "t"], body: ([h, t]) => k.call(B.add, h, k.call(total, t)) },
    ])));
    return showMain(k, () => k.call(total, k.call(S.range, k.lit(N))));
  }), [sum(N)]);
});

test("a recursive map that builds a long list, then counts it", () => {
  assert.deepEqual(printed((k) => {
    const double = k.def("double all");
    k.define(double, k.fn(["xs"], (xs) => k.match(xs, [
      { variant: NIL, names: [], body: () => NIL },
      { variant: CONS, names: ["h", "t"], body: ([h, t]) => k.call(CONS, k.call(B.mul, h, k.lit(2)), k.call(double, t)) },
    ])));
    const len = k.def("length");
    k.define(len, k.fn(["xs"], (xs) => k.fold(xs, [
      { variant: NIL, names: [], body: () => k.lit(0) },
      { variant: CONS, names: ["h", "t"], results: [null, "r"], body: (_, [, r]) => k.call(B.add, k.lit(1), r!) },
    ])));
    return showMain(k, () => k.call(len, k.call(double, k.call(S.range, k.lit(N)))));
  }), [String(N)]);
});

test("Choice over a long list: count, all and first", () => {
  assert.deepEqual(printed((k) => {
    const main = k.def("main");
    const pick = () => k.thunk(() => k.call(S.oneOf, k.call(S.range, k.lit(N))));
    const evens = () => k.thunk(() => k.let("x", k.call(S.oneOf, k.call(S.range, k.lit(N))), (x) =>
      k.if(k.call(S.equal, k.call(S.mod, x, k.lit(2)), k.lit(0)), x, k.call(S.fail))));
    k.define(main, k.thunk(() => k.seq(
      k.call(S.print, k.call(S.show, k.call(S.count, evens()))),
      k.call(S.print, k.call(S.show, k.call(S.count, k.thunk(() => k.call(S.oneOf, k.call(S.all, pick())))))),
      // the last element, found by failing through all the others
      k.call(S.print, k.call(S.show, k.call(S.first, k.thunk(() => k.let("x", k.call(S.oneOf, k.call(S.range, k.lit(N))), (x) =>
        k.if(k.call(S.equal, x, k.lit(N - 1)), x, k.call(S.fail)))), k.thunk(() => k.lit(-1))))),
    )));
    return main;
  }), [String(N / 2), String(N), String(N - 1)]);
});

test("equal compares long lists without the JS stack", () => {
  const xs = toList(Array.from({ length: 1_000_000 }, (_, i) => i));
  const ys = toList(Array.from({ length: 1_000_000 }, (_, i) => i));
  assert.ok(equal(xs, ys));
  assert.ok(!equal(xs, toList(Array.from({ length: 1_000_000 }, (_, i) => (i === 999_999 ? 0 : i)))));
});

test("ids are 130 bits, and fresh ones don't repeat", () => {
  const ids = new Set(Array.from({ length: 100_000 }, freshId));
  assert.equal(ids.size, 100_000);
  for (const id of [...ids].slice(0, 100)) assert.match(id, /^[0-9a-v]{26}$/);
});

test("merge refuses two different nodes under one id, and allows the same node twice", () => {
  const a: Code = { nodes: { x: { id: "x", kind: "lit", value: 1 } }, defs: [] };
  const same: Code = { nodes: { x: { id: "x", kind: "lit", value: 1 } }, defs: [] };
  const other: Code = { nodes: { x: { id: "x", kind: "lit", value: 2 } }, defs: [] };
  assert.equal(merge(a, same).nodes.x.kind, "lit");
  assert.throws(() => merge(a, other), (e) => e instanceof MergeClash && e.ids[0] === "x");
});

test("the printer is a parser at real sizes: show numbers read back from 1,000 numbers", async () => {
  const { relate, toValue } = await import("../src/lang/relate.ts");
  const { fromList } = await import("../src/lang/run.ts");
  const { library } = await import("../src/lang/programs.ts");
  const k = new Lang();
  const lib = library(k);
  const code = base(k.code);
  const numbers = Array.from({ length: 1000 }, (_, i) => i * 7);
  const t = performance.now();
  // Every answer: the search also has to rule out every other reading.
  const answers = [...relate(code, lib.showNumbers, { out: numbers.join(" ") })];
  assert.equal(answers.length, 1);
  const xs = Object.values(answers[0].values).map((v) => toValue(v)).find((v) => typeof v === "object");
  assert.deepEqual(fromList(xs!), numbers);
  // It was cubic: 400 numbers took four minutes. Now about linear.
  assert.ok(performance.now() - t < 5000, `took ${performance.now() - t} ms`);
});
