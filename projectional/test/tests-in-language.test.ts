// Tests in the language (TESTS-IN-THE-LANGUAGE.md, BACKLOG T7a): a test is
// a definition that performs Check's `expect`. It runs on its saved inputs,
// then on small values of its inputs' types, smallest first, and every
// failing expect is reported with the inputs it failed on.

import { test } from "node:test";
import assert from "node:assert/strict";
import { Lang } from "../src/lang/dsl.ts";
import { infer } from "../src/lang/infer.ts";
import { base, baseNames } from "../src/lang/load.ts";
import { LIBRARY } from "../src/lang/library.ts";
import { bool } from "../src/lang/run.ts";
import { CHECK_OP, INT_OPS, LIST } from "../src/lang/std.ts";
import { bySize, runTests, savedFrom, smallValues, testsIn } from "../src/lang/tests.ts";
import { INT, NUMBER } from "../src/lang/types.ts";
import type { Id } from "../src/model.ts";

const lib = (name: string) => LIBRARY.modules.flatMap((m) => m.exports).find((d) => LIBRARY.names[d] === name)!;

function program() {
  const k = new Lang(LIBRARY.code);
  const def = (name: string, params: string[], body: (...xs: Id[]) => Id) => { const d = k.def(name); k.define(d, k.fn(params, body)); return d; };
  const expect = (holds: Id, what: string) => k.call(CHECK_OP, holds, k.lit(what));
  const P = k.type("Point", [], [["point", [["x", () => k.tref(INT)], ["y", () => k.tref(INT)]]]]);
  const defs = {
    twice: def("reverse twice", ["xs"], (xs) => expect(k.equal(k.call(lib("reverse"), k.call(lib("reverse"), xs)), xs), "reverse twice is the list")),
    short: def("lists are short", ["xs"], (xs) => expect(k.call(INT_OPS.less, k.call(lib("length"), xs), k.int(3)), "shorter than 3")),
    both: def("two expects", ["n"], (n) => k.let("a", expect(k.call(INT_OPS.less, n, k.int(2)), "n < 2"), () => expect(k.call(INT_OPS.less, k.int(-2), n), "−2 < n"))),
    swap: def("itself", ["x"], (x) => expect(k.equal(x, x), "a value is itself")),
    plain: def("not a test", ["n"], (n) => k.call(INT_OPS.add, n, k.int(1))),
  };
  // Typed: the lists hold Ints.
  const code = base(k.code), names = { ...baseNames(), ...k.names }, info = infer(code, names);
  return { code, names, info, defs, P };
}

test("a test is a definition whose row has Check, and nothing else marks it", () => {
  const p = program();
  assert.deepEqual(p.info.errors.map((e) => e.message), []);
  assert.deepEqual(testsIn(p.info, Object.values(p.defs)).sort(), [p.defs.twice, p.defs.short, p.defs.both, p.defs.swap].sort());
});

test("lab test: every failure, with the smallest inputs first; a law that holds passes", () => {
  const p = program();
  const results = new Map(runTests(p.code, p.info, p.names, Object.values(p.defs)).map((r) => [r.def, r]));
  assert.equal(results.get(p.defs.plain), undefined);
  const twice = results.get(p.defs.twice)!;
  assert.deepEqual(twice.failures, []);
  assert.ok(twice.cases > 10, `${twice.cases}`);
  // Lists of up to three small Ints: the first too long is three zeros.
  const short = results.get(p.defs.short)!;
  assert.deepEqual(short.failures[0], { inputs: ["[0, 0, 0]"], what: ["shorter than 3"] });
  // Both expects run, and each failing one is reported.
  const both = results.get(p.defs.both)!;
  assert.deepEqual(both.failures.map((f) => [f.inputs[0], f.what]), [["2", ["n < 2"]], ["-2", ["−2 < n"]], ["3", ["n < 2"]], ["-3", ["−2 < n"]]]);
  // A law for any type runs at Int.
  assert.deepEqual(results.get(p.defs.swap)!.failures, []);
  assert.equal(results.get(p.defs.swap)!.cases, 7);
});

test("saved inputs run first", () => {
  const p = program();
  const [r] = runTests(p.code, p.info, p.names, [p.defs.short], { [p.defs.short]: [{ inputs: ["[5, 6, 7, 8]"] }] });
  assert.deepEqual(r.failures[0], { inputs: ["[5, 6, 7, 8]"], what: ["shorter than 3"] });
});

test("an accepted answer makes any definition a test (T7b)", () => {
  const p = program();
  const d = p.defs.plain;
  const [ok] = runTests(p.code, p.info, p.names, [d], { [d]: [{ inputs: ["2"], answer: "3" }] });
  assert.deepEqual([ok.cases, ok.failures], [1, []]);
  const [bad] = runTests(p.code, p.info, p.names, [d], { [d]: [{ inputs: ["2"], answer: "4" }, { inputs: ["oops"], answer: "1" }] });
  assert.deepEqual(bad.failures, [
    { inputs: ["2"], what: ["gives 3, accepted 4"] },
    { inputs: ["oops"], what: ["its saved inputs don't read as values any more"] },
  ]);
  // Inputs without an answer don't make a plain definition a test.
  assert.deepEqual(runTests(p.code, p.info, p.names, [d], { [d]: [{ inputs: ["2"] }] }), []);
});

test("examples.json: the old form reads as inputs, the new form keeps answers", () => {
  assert.deepEqual(savedFrom({ a: ["1", "2"], b: [{ inputs: ["3"], answer: "4" }, { inputs: ["5"] }, { nope: 1 }] }), {
    a: [{ inputs: ["1", "2"] }],
    b: [{ inputs: ["3"], answer: "4" }, { inputs: ["5"] }],
  });
});

test("small values: smallest first, and records from their fields", () => {
  const p = program();
  assert.deepEqual(smallValues({ t: "con", id: NUMBER, args: [] }, p.code), [0, 1, -1, 0.5, 1e-9, 1e9]);
  const lists = smallValues({ t: "con", id: LIST, args: [{ t: "con", id: INT, args: [] }] }, p.code)!;
  assert.equal(lists.length, 1 + 3 + 9 + 27);
  const points = smallValues({ t: "con", id: p.P.def, args: [] }, p.code)!;
  assert.deepEqual(points.slice(0, 3).map((v) => (v as { fields: number[] }).fields), [[0, 0], [0, 1], [1, 0]]);
  assert.deepEqual(bySize([[1, 2], [bool(false), bool(true)]], 3), [[1, bool(false)], [1, bool(true)], [2, bool(false)]]);
});
