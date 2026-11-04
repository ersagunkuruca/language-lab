// The problem table (L187, src/lang/problems.ts): the smallest program that
// shows each problem, whose message is that row's and no other's, so a
// message that changes or can no longer be reached fails here.
import { test } from "node:test";
import assert from "node:assert/strict";
import { Lang } from "../src/lang/dsl.ts";
import { infer } from "../src/lang/infer.ts";
import { base, baseNames, checkOptions } from "../src/lang/load.ts";
import { LIBRARY } from "../src/lang/library.ts";
import { PROBLEMS, problemOf } from "../src/lang/problems.ts";
import { NUMBER } from "../src/lang/types.ts";
import { ARITH, DIVIDE, FALSE, FIELDS, INT_OPS, JSON_OPS, LOG_OP, S, RELEASE_V, SHOWN_V, SOME, TRIG_OPS, TRUE } from "../src/lang/std.ts";

const bools = (k: Lang, b: string, extra: Parameters<Lang["match"]>[1] = []) =>
  k.match(b, [{ variant: TRUE, names: [], body: () => k.lit(1) }, { variant: FALSE, names: [], body: () => k.lit(2) }, ...extra]);

// An effect with two operations, and a handler's cases for both.
const ask = (k: Lang) => k.effect("Ask", [["ask", [], () => k.tref("type.number")], ["tell", [["n", () => k.tref("type.number")]], () => k.tref("std.unit")]]);
const answered = (k: Lang, a: ReturnType<typeof ask>, answer: () => string): Parameters<Lang["match"]>[1] =>
  [{ variant: a.op.ask, names: [], body: answer }, { variant: a.op.tell, names: ["n"], body: () => k.x("std.unit.unit") }];

// A definition's nth input: the port a solve gives or asks by.
const param = (k: Lang, f: string, i: number): string => { const d = k.code.nodes[f]; const l = d?.kind === "def" && d.body ? k.code.nodes[d.body] : undefined; return l?.kind === "lambda" ? l.params[i] : ""; };

const SMALLEST: Record<string, (k: Lang) => void> = {
  "wrong-type": (k) => {
    k.define(k.def("p"), k.call(S.not, k.lit("a")));
    const t = k.type("Colour", [], [["red", []]]);
    k.define(k.def("q"), k.thunk(() => k.handle(k.call(S.print, k.lit("a")), [{ variant: t.v.red, names: [], body: () => k.x("std.unit.unit") }])));
  },
  "wrong-count": (k) => k.define(k.def("p"), k.call(S.not, k.x(TRUE), k.x(TRUE))),
  "not-a-function": (k) => { const v = k.def("v"); k.define(v, k.lit("a")); k.define(k.def("p"), k.call(v, k.lit(1))); },
  "fraction-at-int": (k) => k.define(k.def("p"), k.call(INT_OPS.add, k.int(1), k.lit(1.5))),
  "missing-case": (k) => k.define(k.def("p"), k.fn(["b"], (b) => k.match(b, [{ variant: TRUE, names: [], body: () => k.lit(1) }]))),
  "case-twice": (k) => k.define(k.def("p"), k.fn(["b"], (b) => bools(k, b, [{ variant: TRUE, names: [], body: () => k.lit(3) }]))),
  "not-a-case": (k) => k.define(k.def("p"), k.fn(["b"], (b) => bools(k, b, [{ variant: SOME, names: ["x"], body: () => k.lit(3) }]))),
  "fields-bound": (k) => k.define(k.def("p"), k.fn(["b"], (b) => k.match(b, [{ variant: TRUE, names: ["x"], body: () => k.lit(1) }, { variant: FALSE, names: [], body: () => k.lit(2) }]))),
  "recursive-value": (k) => { const d = k.def("d"); k.define(d, k.call(S.not, k.x(d))); },
  "out-of-scope": (k) => { let a = ""; k.define(k.def("f"), k.fn(["a"], (x) => (a = x))); k.define(k.def("g"), k.x(a)); },
  "acts-under-choice": (k) => k.define(k.def("p"), k.thunk(() => k.call(S.first,
    k.thunk(() => k.seq(k.call(S.print, k.lit("a")), k.call(S.oneOf, k.list(k.lit(1), k.lit(2))))), k.thunk(() => k.lit(0))))),
  "number-not-wanted": (k) => k.define(k.def("p"), k.call(ARITH.add, k.lit("a"), k.lit(1))),
  "one-tuple-or-inputs": (k) => { const f = k.def("f"); k.define(f, k.fn(["a", "b"], (a) => k.call(S.not, a))); k.define(k.def("p"), k.call(f, k.x(TRUE))); },
  "not-an-operation": (k) => { const a = ask(k); k.define(k.def("p"), k.thunk(() => k.handle(k.call(a.op.ask), [...answered(k, a, () => k.lit(1)), { variant: LOG_OP, names: ["l"], body: () => k.lit(1) }]))); },
  "answer-not-one": (k) => { const a = ask(k); k.define(k.def("p"), k.thunk(() => k.handle(k.call(a.op.ask), answered(k, a, () => k.call(S.oneOf, k.list(k.lit(1), k.lit(2))))))); },
  "no-implementation": (k) => { const t = k.type("Colour", [], [["red", []], ["blue", []]]); k.define(k.def("p"), k.call(ARITH.add, k.x(t.v.red), k.x(t.v.blue))); k.define(k.def("q"), k.call(S.equal, k.x(t.v.red), k.lit(1))); k.define(k.def("r"), k.call(TRIG_OPS.sin, k.x(t.v.red))); },
  "type-as-value": (k) => k.define(k.def("p"), k.x(NUMBER)),
  "fields-type-unknown": (k) => k.define(k.def("p"), k.fn(["v"], (v) => k.call(FIELDS.listed, v))),
  "json-type-unknown": (k) => k.define(k.def("p"), k.fn(["v"], (v) => k.call(JSON_OPS.of, v))),
  "private-to-library": (k) => k.define(k.def("p"), k.x("std.rational.ratio")),
  "unhandled-effect": (k) => { const a = ask(k); k.define(k.def("p"), k.call(a.op.ask)); },
  "no-cases": (k) => k.define(k.def("p"), k.fn(["b"], (b) => k.match(b, []))),
  "functions-in-data": (k) => k.define(k.def("p"), k.call(S.equal, k.fn(["x"], (x) => x), k.fn(["x"], (x) => x))),
  "no-port": (k) => { const f = k.def("f"); k.define(f, k.fn(["a"], (a) => k.call(ARITH.add, a, k.lit(1)))); k.define(k.def("p"), k.solve(f, { nope: k.lit(1), out: k.lit(3) }, { [param(k, f, 0)]: "x" }, (b) => b[param(k, f, 0)])); },
  "needs-more-ports": (k) => { const f = k.def("f"); k.define(f, k.fn(["a", "b"], (a, b) => k.call(ARITH.add, a, b))); k.define(k.def("p"), k.solve(f, {}, { [param(k, f, 0)]: "x", [param(k, f, 1)]: "y" }, (b) => b[param(k, f, 0)])); },
  "not-backwards": (k) => { const v = k.def("v"); k.define(v, k.lit(1)); k.define(k.def("p"), k.solve(v, { out: k.lit(3) }, {}, () => k.lit(0))); },
  "field-of-one-case": (k) => { const t = k.type("Shape", [], [["dot", []], ["disc", [["r", () => k.tref(NUMBER)]]]]); k.define(k.def("p"), k.fn(["s"], (s) => k.call(t.f["disc.r"], s))); },
  "not-folded": (k) => { const t = k.type("Disc", [], [["disc", [["r", () => k.tref(NUMBER)]]]]); k.define(k.def("p"), k.fn(["s"], (s) => k.fold(s, [{ variant: t.v.disc, names: ["r"], results: ["rr"], body: (b) => b[0] }]))); },
  "effect-folded": (k) => { const a = ask(k); k.define(k.def("p"), k.thunk(() => k.fold(k.call(a.op.ask), answered(k, a, () => k.lit(1))))); },
  "too-many-results": (k) => k.define(k.def("p"), k.gives(["a"], ["r1", "r2", "r3", "r4", "r5", "r6", "r7", "r8", "r9"], (a) => a)),
  "results-not-predicate": (k) => { const f = k.def("f"); k.define(f, k.fn(["a", "b"], (a, b) => k.call(ARITH.add, a, b))); k.results(f, "b"); },
  "takes-itself": (k) => { k.type("Bad", [], [["bad", [["f", (self) => k.tfun([k.tref(self)], k.tref(NUMBER))]]]]); },
  "not-an-effect": (k) => { const t = k.type("Colour", [], [["red", []]]); k.type("Box", [], [["box", [["f", () => k.tfun([], k.tref(NUMBER), [t.def])]]]]); },
  "one-row-parameter": (k) => { k.type("Box", ["e", "r"], [["box", [["f", (_self, ps) => k.tfun([], k.tref(NUMBER), ps)]]]]); },
  "case-never-runs": (k) => k.define(k.def("p"), k.fn(["b"], (b) => k.match(b, [{ variant: TRUE, names: [], body: () => k.lit(1) }, { variant: FALSE, names: [], body: () => k.lit(2) }], k.lit(3)))),
  "needs-otherwise": (k) => k.define(k.def("p"), k.fn(["x"], (x) => k.byValue(x, [[k.lit(1), k.lit(2)]]))),
  "one-implementation": (k) => { const t = k.type("Colour", [], [["red", []]]); for (const n of ["shown at colour", "shown at colour again"]) k.define(k.def(n), k.call(SHOWN_V, k.fn(["c"], (c) => k.match(c, [{ variant: t.v.red, names: [], body: () => k.lit("red") }])))); },
  "int-divide": (k) => k.define(k.def("p"), k.thunk(() => k.call(S.first, k.thunk(() => k.call(DIVIDE, k.int(1), k.int(2))), k.thunk(() => k.int(0))))),
  "value-case-not-value": (k) => k.define(k.def("p"), k.fn(["x"], (x) => k.byValue(x, [[k.x(TRUE), k.lit(1)]], k.lit(2)))),
  "release-given-something": (k) => { const a = ask(k); k.define(k.def("p"), k.thunk(() => k.match(k.call(a.op.ask), [...answered(k, a, () => k.lit(1)), { variant: RELEASE_V, names: ["x"], body: () => k.x("std.unit.unit") }]))); },
  "release-acts": (k) => { const a = ask(k); k.define(k.def("p"), k.thunk(() => k.handle(k.call(a.op.ask), answered(k, a, () => k.lit(1)), undefined, () => k.call(S.print, k.lit("a"))))); },
  "resumed-twice": (k) => { const a = k.effect("Wait", [["wait", [], () => k.tref(NUMBER), "later"]]); k.define(k.def("p"), k.thunk(() => k.handle(k.call(a.op.wait), [{ variant: a.op.wait, names: ["go"], body: ([go]) => k.seq(k.call(go, k.lit(1)), k.call(go, k.lit(2))) }]))); },
  "not-a-number": (k) => k.define(k.def("p"), k.fn(["b"], (b) => k.match(b, [{ variant: TRUE, names: [], body: () => k.lit(1) }, { variant: FALSE, names: [], body: () => k.lit("a") }]))),
};

test("every problem has its smallest program, and its message is that row's alone", () => {
  assert.deepEqual(PROBLEMS.map((p) => p.id).sort(), Object.keys(SMALLEST).sort());
  assert.equal(new Set(PROBLEMS.map((p) => p.id)).size, PROBLEMS.length);
  for (const p of PROBLEMS) {
    const k = new Lang(LIBRARY.code);
    SMALLEST[p.id](k);
    const code = base(k.code), names = baseNames(k.names);
    const messages = infer(code, names, undefined, checkOptions).errors.map((e) => e.message);
    assert.ok(messages.length, `${p.id}: no problem`);
    for (const m of messages) {
      assert.deepEqual(PROBLEMS.filter((q) => q.says.test(m)).map((q) => q.id), [p.id], `${p.id}: "${m}"`);
      assert.equal(problemOf(m)?.id, p.id);
    }
  }
});
