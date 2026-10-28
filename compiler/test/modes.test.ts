// Relational solves whose mode has one answer or none compile to their
// plan written out (src/modes.ts, MODES.md step 5): the same answers as
// the evaluator, and no relational interpreter in the module.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { fromList, makeRunner, toList, type Value } from "../../projectional/src/lang/run.ts";
import type { Id, NodeOf } from "../../projectional/src/model.ts";
import { infer } from "../../projectional/src/lang/infer.ts";
import { Lang } from "../../projectional/src/lang/dsl.ts";
import { base, baseNames } from "../../projectional/src/lang/load.ts";
import { CONS, INT_OPS, NIL, PAIR_V, S, SHOW_ANY } from "../../projectional/src/lang/std.ts";
import { B } from "../../projectional/src/prelude.ts";
import { compile } from "../src/compile.ts";
import { compileProgram } from "../src/program.ts";
import { $fromList, $toList } from "../src/runtime.js";

const runtime = pathToFileURL(join(import.meta.dirname, "../src/runtime.js")).href;
const dir = mkdtempSync(join(tmpdir(), "modes-"));
const paramsOf = (k: Lang, def: Id) => (k.code.nodes[(k.code.nodes[def] as NodeOf<"def">).body!] as NodeOf<"lambda">).params;

test("det and semidet solves are plain functions, with the evaluator's answers", async () => {
  const k = new Lang();
  // A Pair taken apart: det, a variant's fields.
  const make = k.def("make");
  k.define(make, k.fn(["a", "b"], (a, b) => k.call(PAIR_V, a, b)));
  const [a, b] = paramsOf(k, make);
  k.define(k.def("sum of"), k.fn(["p"], (p) => k.solve(make, { out: p }, { [a]: "a", [b]: "b" }, ({ [a]: x, [b]: y }) => k.call(INT_OPS.add, x, y))));
  // A prefix taken off: semidet. Through a definition run in the same
  // mode: twice greeted is greeted greeted.
  const greet = k.def("greet");
  k.define(greet, k.fn(["who"], (who) => k.text(k.lit("hello, "), who)));
  const twice = k.def("twice");
  k.define(twice, k.fn(["who"], (who) => k.call(greet, k.call(greet, who))));
  const [who] = paramsOf(k, greet), [who2] = paramsOf(k, twice);
  const nameIn = (rel: Id, port: Id, title: string) => k.define(k.def(title), k.fn(["t"], (t) =>
    k.call(S.first, k.thunk(() => k.solve(rel, { out: t }, { [port]: "who" }, ({ [port]: w }) => w)), k.thunk(() => k.lit("nobody")))));
  nameIn(greet, who, "name in");
  nameIn(twice, who2, "name twice in");
  // Whole numbers: one side from the other two, and a known input with
  // the result known (a test).
  const shift = k.def("shift");
  k.define(shift, k.fn(["n", "by"], (n, by) => k.call(INT_OPS.sub, k.call(INT_OPS.add, n, by), k.int(1))));
  const [n, by] = paramsOf(k, shift);
  k.define(k.def("unshift"), k.fn(["y"], (y) => k.solve(shift, { out: y, [by]: k.int(10) }, { [n]: "n" }, ({ [n]: v }) => v)));
  // A choice of arms on a value given: its arm, run in the same mode.
  const mark = k.def("mark");
  k.define(mark, k.fn(["loud", "t"], (loud, t) => k.if(loud, k.text(t, k.lit("!")), t)));
  const [loud, tp] = paramsOf(k, mark);
  k.define(k.def("unmark"), k.fn(["l", "t"], (l, t) => k.call(S.first, k.thunk(() => k.solve(mark, { [loud]: l, out: t }, { [tp]: "t" }, ({ [tp]: v }) => v)), k.thunk(() => k.lit("?")))));
  // Two arms that give different texts, but the analysis can't tell them
  // apart: several answers, so this one stays with the interpreter.
  const label = k.def("label");
  k.define(label, k.fn(["b"], (bv) => k.if(bv, k.lit("yes"), k.lit("no"))));
  const [bp] = paramsOf(k, label);
  k.define(k.def("which"), k.fn(["t"], (t) => k.call(S.first, k.thunk(() => k.call(SHOW_ANY, k.solve(label, { out: t }, { [bp]: "b" }, ({ [bp]: v }) => v))), k.thunk(() => k.lit("neither")))));
  const code = base(k.code);
  const names = { ...baseNames(), ...k.names };
  const info = infer(code, names);
  assert.deepEqual(info.errors, []);
  const exports = ["sum of", "name in", "name twice in", "unshift", "unmark", "which"];
  const source = compile(code, info, names, { runtime, exports });
  writeFileSync(join(dir, "modes.js"), source);
  const defs = (await import(pathToFileURL(join(dir, "modes.js")).href)).defs as Record<string, (...a: unknown[]) => unknown>;
  // Without label's solve, the module has no interpreter, and functions
  // are plain ones (no metadata for it to read).
  const plain = compile(code, info, names, { runtime, exports: exports.filter((x) => x !== "which") });
  assert.doesNotMatch(plain, /\$relate|\$program|\$meta\(/);
  // Only label's solve goes to the interpreter.
  assert.equal(source.match(/\$relate\(\$program/g)?.length, 1);
  assert.match(source, /label, run backwards by the relational interpreter/);
  assert.match(source, /function greet\$mode\d+\(/);

  const r = makeRunner(code, info, { print: () => {} });
  const ev = (name: string, ...args: Value[]) => [...r.call(r.value(Object.keys(names).find((d) => names[d] === name && code.nodes[d]?.kind === "def")!), ...args)][0];
  const pair = [...r.call(r.value(PAIR_V), 1, 2)][0];
  assert.equal(defs["sum of"](pair), ev("sum of", pair));
  for (const t of ["hello, Ada", "hello, ", "goodbye"]) assert.equal(defs["name in"](t), ev("name in", t));
  for (const t of ["hello, hello, Ada", "hello, Ada"]) assert.equal(defs["name twice in"](t), ev("name twice in", t));
  for (const y of [0, 15, -3]) assert.equal(defs.unshift(y), ev("unshift", y));
  for (const [l, t] of [[true, "hi!"], [false, "hi!"], [true, "hi"]] as const) {
    const lv = r.value(l ? "std.bool.true" : "std.bool.false");
    assert.equal(defs.unmark(lv, t), ev("unmark", lv, t));
  }
  for (const t of ["yes", "no", "maybe"]) assert.equal(defs.which(t), ev("which", t));
  assert.equal(defs["name twice in"]("hello, hello, Ada"), "Ada");
  assert.equal(defs.unmark(r.value("std.bool.true"), "hi"), "?");
});

test("backwards: greet runs as a function, the searches with several answers stay with the interpreter", () => {
  const source = compileProgram("backwards", ["main"], runtime);
  assert.match(source, /greet, run backwards \(semidet\)/);
  assert.match(source, /\$relate\(/);
});

// Haar's split in lifting steps (Sweldens): each step has one unknown run
// backwards, so the join is arithmetic. No two arms build the list of
// bands with the same case, and an odd sample out fails: one answer or
// none, though the list given isn't the one examined.
test("a split written as lifting steps runs backwards as arithmetic, with the evaluator's answers", async () => {
  const k = new Lang();
  const split = k.def("split");
  k.define(split, k.fn(["xs"], (xs) => k.match(xs, [
    { variant: NIL, names: [], body: () => k.list() },
    { variant: CONS, names: ["a", "rest"], body: ([a, rest]) => k.match(rest, [
      { variant: NIL, names: [], body: () => k.call(S.fail) },
      { variant: CONS, names: ["b", "more"], body: ([b, more]) => k.let("fast", k.call(B.sub, a, b), (fast) =>
        k.call(CONS, k.call(PAIR_V, k.call(B.add, b, k.call(B.div, fast, k.lit(2))), fast), k.call(split, more))) },
    ]) },
  ])));
  const [xs] = paramsOf(k, split);
  k.define(k.def("join"), k.fn(["bands"], (bs) => k.call(S.first, k.thunk(() => k.solve(split, { out: bs }, { [xs]: "xs" }, ({ [xs]: v }) => v)), k.thunk(() => k.list()))));
  const code = base(k.code), names = { ...baseNames(), ...k.names };
  const info = infer(code, names);
  assert.deepEqual(info.errors, []);
  const source = compile(code, info, names, { runtime, exports: ["split", "join"] });
  assert.match(source, /split, run backwards \(semidet\)/);
  assert.doesNotMatch(source, /\$relate|\$program/);
  writeFileSync(join(dir, "haar.js"), source);
  const defs = (await import(pathToFileURL(join(dir, "haar.js")).href)).defs as Record<string, (...a: unknown[]) => unknown>;
  const r = makeRunner(code, info, { print: () => {} });
  const ev = (name: string, ...args: Value[]) => [...r.call(r.value(Object.keys(names).find((d) => names[d] === name && code.nodes[d]?.kind === "def")!), ...args)][0];
  for (const samples of [[], [3, 1], [0.5, -0.25, 1, 7]]) {
    // split may fail (Choice), so it gives its answers in turn.
    const [bands] = defs.split($toList(samples)) as Iterable<unknown>;
    assert.deepEqual($fromList(defs.join(bands)), samples);
    assert.deepEqual(fromList(ev("join", ev("split", toList(samples)))), samples);
  }
  assert.deepEqual([...(defs.split($toList([1, 2, 3])) as Iterable<unknown>)], []);
});

// C30: a mode whose unknown is a list built front to back (Haar's join run
// backwards, in the pedal) pushes it onto an array, and a definition that
// only takes the list apart walks that array. The same answers as the
// evaluator.
test("a list a written-out mode builds is pushed onto an array where it's only taken apart", async () => {
  const k = new Lang();
  const pairs = k.def("pairs"), total = k.def("total");
  k.define(pairs, k.fn(["xs"], (xs) => k.match(xs, [
    { variant: NIL, names: [], body: () => k.x(NIL) },
    { variant: CONS, names: ["a", "rest"], body: ([a, rest]) => k.match(rest, [
      { variant: NIL, names: [], body: () => k.call(S.fail) },
      { variant: CONS, names: ["b", "more"], body: ([b, more]) => k.call(CONS, k.call(PAIR_V, a, k.call(B.sub, a, b)), k.call(pairs, more)) },
    ]) },
  ])));
  k.define(total, k.fn(["xs"], (xs) => k.match(xs, [
    { variant: NIL, names: [], body: () => k.lit(0) },
    { variant: CONS, names: ["x", "rest"], body: ([x, rest]) => k.call(B.add, x, k.call(total, rest)) },
  ])));
  const [xs] = paramsOf(k, pairs);
  k.define(k.def("samples total"), k.fn(["ps"], (ps) => k.call(total,
    k.call(S.first, k.thunk(() => k.solve(pairs, { out: ps }, { [xs]: "xs" }, ({ [xs]: v }) => v)), k.thunk(() => k.list(k.lit(-1)))))));
  const code = base(k.code);
  const names = { ...baseNames(), ...k.names };
  const info = infer(code, names);
  assert.deepEqual(info.errors, []);
  const source = compile(code, info, names, { runtime, exports: ["samples total"] });
  assert.match(source, /function pairs\$mode\d+\$into\(/);
  assert.match(source, /total\$arr\(/);
  writeFileSync(join(dir, "modes-into.js"), source);
  const defs = (await import(pathToFileURL(join(dir, "modes-into.js")).href)).defs as Record<string, (...a: unknown[]) => unknown>;
  const r = makeRunner(code, info, { print: () => {} });
  const main = Object.keys(names).find((d) => names[d] === "samples total" && code.nodes[d]?.kind === "def")!;
  const pair = (a: number, b: number) => [...r.call(r.value(PAIR_V), a, b)][0];
  for (const ps of [[], [pair(3, 1), pair(5, 7)]]) assert.equal(defs["samples total"](toList(ps)), [...r.call(r.value(main), toList(ps))][0]);
});
