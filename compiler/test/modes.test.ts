// Relational solves whose mode has one answer or none compile to their
// plan written out (src/modes.ts, MODES.md step 5): the same answers as
// the evaluator, and no relational interpreter in the module.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { makeRunner, type Value } from "../../projectional/src/lang/run.ts";
import type { Id, NodeOf } from "../../projectional/src/model.ts";
import { infer } from "../../projectional/src/lang/infer.ts";
import { Lang } from "../../projectional/src/lang/dsl.ts";
import { base, baseNames } from "../../projectional/src/lang/load.ts";
import { INT_OPS, PAIR_V, S, SHOW_ANY } from "../../projectional/src/lang/std.ts";
import { compile } from "../src/compile.ts";
import { compileProgram } from "../src/program.ts";

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
