// The compiler is a second implementation of the language, so the
// evaluator is its test oracle: every example program must print exactly
// the same lines both ways.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { runMain, makeRunner, fromList, toList, type Value } from "../../projectional/src/lang/run.ts";
import type { Id } from "../../projectional/src/model.ts";
import { infer } from "../../projectional/src/lang/infer.ts";
import { Lang } from "../../projectional/src/lang/dsl.ts";
import { base, baseNames } from "../../projectional/src/lang/load.ts";
import { CONS, NIL, S } from "../../projectional/src/lang/std.ts";
import { B } from "../../projectional/src/prelude.ts";
import { compile } from "../src/compile.ts";
import { compileProgram, load } from "../src/program.ts";
import { $setPrint } from "../src/runtime.js";

const runtime = pathToFileURL(join(import.meta.dirname, "../src/runtime.js")).href;
const dir = mkdtempSync(join(tmpdir(), "compiled-"));

async function compiled(name: string, exports: string[]) {
  const file = join(dir, `${name}-${exports.join("-").replace(/\W/g, "")}.js`);
  writeFileSync(file, compileProgram(name, exports, runtime));
  return (await import(pathToFileURL(file).href)).defs as Record<string, (...a: unknown[]) => unknown>;
}

function printed(run: () => void, setPrint: (p: (s: string) => void) => void): string[] {
  const lines: string[] = [];
  setPrint((s) => lines.push(s));
  run();
  return lines;
}

for (const name of ["queens", "algebra", "relations", "backwards", "calculus", "physics"]) {
  test(`${name}: compiled main prints what the evaluator prints`, async () => {
    const p = load(name);
    const want: string[] = [];
    runMain(p.code, p.info, p.named("main"), { print: (s) => want.push(s) });
    const defs = await compiled(name, ["main"]);
    const got = printed(() => defs.main(), $setPrint);
    assert.deepEqual(got, want);
    assert.ok(want.length > 3);
  });
}

test("queens: a Choice function compiles to a generator with the same stream of answers", async () => {
  const p = load("queens");
  const defs = await compiled("queens", ["queens"]);
  const r = makeRunner(p.code, p.info, { print: () => {} });
  const want = [...r.call(r.value(p.named("queens")), 6)].map((b) => fromList(b));
  const got = [...(defs.queens(6) as Iterable<Value>)].map((b) => fromList(b));
  assert.deepEqual(got, want);
  assert.equal(got.length, 4);
});

test("relations: solved directions give the solver's answers, in its order", async () => {
  const p = load("relations");
  const defs = await compiled("relations", ["split", "to polar", "square roots"]);
  const r = makeRunner(p.code, p.info, { print: () => {} });
  // Some directions have infinitely many answers (an angle plus 2πk), so
  // compare the first few.
  const take = (xs: Iterable<Value>, n = 6) => { const out: Value[] = []; for (const x of xs) if (out.push(x) >= n) break; return out; };
  const ev = (name: string, ...args: Value[]) => take(r.call(r.value(p.named(name)), ...args));
  // split is pure: a plain function. to polar has Choice: a generator.
  assert.deepEqual(defs.split(10, 4), ev("split", 10, 4)[0]);
  for (const [x, y] of [[0, 2], [3, 4], [-1, 0], [0, 0]]) {
    assert.deepEqual(take(defs["to polar"](x, y) as Iterable<Value>), ev("to polar", x, y));
  }
  for (const y of [9, 2, 0, -1]) assert.deepEqual(defs["square roots"](y), ev("square roots", y)[0]);
});

test("an effect-polymorphic function gets one copy per calling convention", async () => {
  // map(list, change): pure when change is pure, Choice when change is.
  const k = new Lang();
  const map = k.def("map");
  k.define(map, k.fn(["list", "change"], (xs, f) => k.match(xs, [
    { variant: NIL, names: [], body: () => NIL },
    { variant: CONS, names: ["item", "rest"], body: ([h, t]) => k.call(CONS, k.call(f, h), k.call(map, t, f)) },
  ])));
  const plain = k.def("plain");
  k.define(plain, k.thunk(() => k.call(map, k.call(S.range, k.lit(4)), k.fn(["x"], (x) => k.call(B.mul, x, x)))));
  const choices = k.def("choices");
  k.define(choices, k.thunk(() => k.call(S.all, k.thunk(() => k.call(map, k.call(S.range, k.lit(3)),
    k.fn(["x"], (x) => k.call(S.oneOf, k.list(x, k.call(B.add, x, k.lit(10))))))))));
  const code = base(k.code);
  const names = { ...baseNames(), ...k.names };
  const info = infer(code, names);
  assert.deepEqual(info.errors, []);

  const source = compile(code, info, names, { runtime, exports: ["plain", "choices"] });
  assert.match(source, /^function map\(/m);
  assert.match(source, /^function\* map\$choice\(/m);
  const file = join(dir, "poly.js");
  writeFileSync(file, source);
  const defs = (await import(pathToFileURL(file).href)).defs;

  const r = makeRunner(code, info, { print: () => {} });
  for (const name of ["plain", "choices"]) {
    const def = code.defs.find((d) => names[d] === name)!;
    assert.deepEqual(defs[name](), [...r.call(r.value(def))][0]);
  }
  assert.equal(fromList(defs.choices()).length, 8);
});

// Real-sized data: a fold without Choice is a loop, so it needs no JS stack
// per item, for chains (lists) and for trees.
async function compiledDefs(k: Lang, exports: string[], file: string) {
  const code = base(k.code);
  const names = { ...baseNames(), ...k.names };
  const info = infer(code, names);
  assert.deepEqual(info.errors, []);
  const path = join(dir, file);
  writeFileSync(path, compile(code, info, names, { runtime, exports }));
  return { code, info, names, defs: (await import(pathToFileURL(path).href)).defs as Record<string, (...a: unknown[]) => unknown> };
}

test("a fold over a million items compiles to a loop", async () => {
  const k = new Lang();
  const total = k.def("total");
  k.define(total, k.fn(["xs"], (xs) => k.fold(xs, [
    { variant: NIL, names: [], body: () => k.lit(0) },
    { variant: CONS, names: ["h", "t"], results: [null, "r"], body: ([h], [, r]) => k.call(B.add, h, r!) },
  ])));
  const big = k.def("big");
  k.define(big, k.thunk(() => k.call(total, k.call(S.range, k.lit(1_000_000)))));
  const { defs } = await compiledDefs(k, ["big", "total"], "bigfold.js");
  assert.equal(defs.big(), 499999500000);
});

test("a fold over a deep tree compiles to a loop with its own stack, children first", async () => {
  const k = new Lang();
  const tree = k.type("tree", [], [["leaf", [["n", () => k.tref("type.number")]]], ["node", [["l", (self) => k.tref(self)], ["r", (self) => k.tref(self)]]]]);
  // show(tree): the order of the text says the children are folded left to right, before the parent.
  const render = k.def("render");
  k.define(render, k.fn(["t"], (t) => k.fold(t, [
    { variant: tree.v.leaf, names: ["n"], body: ([n]) => k.call(S.show, n) },
    { variant: tree.v.node, names: ["l", "r"], results: ["L", "R"], body: (_, [L, R]) => k.text(k.lit("("), L!, k.lit(" "), R!, k.lit(")")) },
  ])));
  const size = k.def("size");
  k.define(size, k.fn(["t"], (t) => k.fold(t, [
    { variant: tree.v.leaf, names: ["n"], body: () => k.lit(1) },
    { variant: tree.v.node, names: ["l", "r"], results: ["L", "R"], body: (_, [L, R]) => k.call(B.add, L!, R!) },
  ])));
  const { defs, code, info } = await compiledDefs(k, ["render", "size"], "treefold.js");
  const leaf = (n: number) => ({ tag: tree.v.leaf, fields: [n] });
  const node = (l: unknown, r: unknown) => ({ tag: tree.v.node, fields: [l, r] });
  const small = node(node(leaf(1), leaf(2)), leaf(3));
  const r = makeRunner(code, info, { print: () => {} });
  assert.equal(defs.render(small), "((1 2) 3)");
  assert.equal(defs.render(small), [...r.call(r.value(code.defs.find((d) => k.names[d] === "render")!), small as Value)][0]);
  // A tree 100,000 deep on the left.
  let deep: unknown = leaf(0);
  for (let i = 1; i < 100_000; i++) deep = node(deep, leaf(i));
  assert.equal(defs.size(deep), 100_000);
});

test("a rose tree (children in a list) folds the same compiled, with and without Choice", async () => {
  const k = new Lang();
  const tree = k.type("rose", [], [["node", [["value", () => k.tref("type.number")], ["kids", (self) => k.tref("std.list", k.tref(self))]]]]);
  const listFold = (name: string, f: (h: Id, r: Id) => Id) => {
    const d = k.def(name);
    k.define(d, k.fn(["xs"], (xs) => k.fold(xs, [
      { variant: NIL, names: [], body: () => k.lit(0) },
      { variant: CONS, names: ["h", "t"], results: [null, "r"], body: ([h], [, r]) => f(h, r!) },
    ])));
    return d;
  };
  const sum = listFold("sum", (h, r) => k.call(B.add, h, r));
  // total of the values
  const total = k.def("total");
  k.define(total, k.fn(["t"], (t) => k.fold(t, [
    { variant: tree.v.node, names: ["v", "ks"], results: [null, "totals"], body: ([v], [, ts]) => k.call(B.add, v, k.call(sum, ts!)) },
  ])));
  // with Choice: each node may count or not
  const some = k.def("some");
  k.define(some, k.fn(["t"], (t) => k.fold(t, [
    { variant: tree.v.node, names: ["v", "ks"], results: [null, "totals"], body: ([v], [, ts]) => k.call(B.add, k.call(S.oneOf, k.list(k.lit(0), v)), k.call(sum, ts!)) },
  ])));
  const { defs, code, info } = await compiledDefs(k, ["total", "some"], "rosefold.js");
  const node = (v: number, ...kids: unknown[]) => ({ tag: tree.v.node, fields: [v, toList(kids as Value[])] });
  const t = node(1, node(2), node(3, node(4)));
  const r = makeRunner(code, info, { print: () => {} });
  const ev = (name: string) => [...r.call(r.value(code.defs.find((d) => k.names[d] === name)!), t as Value)];
  assert.equal(defs.total(t), 10);
  assert.deepEqual([...(defs.some(t) as Iterable<number>)], ev("some"));
  assert.equal(ev("some").length, 16);
  const wide = node(0, ...Array.from({ length: 100_000 }, (_, i) => node(i)));
  assert.equal(defs.total(wide), 4999950000);
});

test("$eq compares long lists without the JS stack", async () => {
  const { $eq, $range } = await import("../src/runtime.js");
  assert.ok($eq($range(1_000_000), $range(1_000_000)));
  assert.ok(!$eq($range(1_000_000), $range(999_999)));
});
