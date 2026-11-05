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
import { COMPLEX_TYPE, NUMBER, RATIONAL_TYPE } from "../src/lang/types.ts";
import { ARITH, CELL_OPS, DIVIDE, EMBEDDING_V, FALSE, FIELDS, INT_OPS, JSON_OPS, LOG_OP, RELEASE_V, S, SET, SHOWN_V, SOME, TRIG_OPS, TRUE } from "../src/lang/std.ts";
import type { Id, NodeData } from "../src/model.ts";

const bools = (k: Lang, b: string, extra: Parameters<Lang["match"]>[1] = []) =>
  k.match(b, [{ variant: TRUE, names: [], body: () => k.lit(1) }, { variant: FALSE, names: [], body: () => k.lit(2) }, ...extra]);

// An effect with two operations, and a handler's cases for both.
const ask = (k: Lang) => k.effect("Ask", [["ask", [], () => k.tref("type.number")], ["tell", [["n", () => k.tref("type.number")]], () => k.tref("std.unit")]]);
const answered = (k: Lang, a: ReturnType<typeof ask>, answer: () => string): Parameters<Lang["match"]>[1] =>
  [{ variant: a.op.ask, names: [], body: answer }, { variant: a.op.tell, names: ["n"], body: () => k.x("std.unit.unit") }];

// A definition's nth input: the port a solve gives or asks by.
const param = (k: Lang, f: string, i: number): string => { const d = k.code.nodes[f]; const l = d?.kind === "def" && d.body ? k.code.nodes[d.body] : undefined; return l?.kind === "lambda" ? l.params[i] : ""; };

// An entry may give pins: each definition held to the type another
// definition of the program has unpinned.
const SMALLEST: Record<string, (k: Lang) => unknown> = {
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
  "effect-two-types": (k) => { const y = k.effect("Yield", [["yield", [["v", (ps) => k.tref(ps[0])]], () => k.tref("std.unit")]], ["a"]); k.define(k.def("p"), k.thunk(() => k.seq(k.call(y.op.yield, k.x(TRUE)), k.call(y.op.yield, k.lit("hi"))))); },
  "unhandled-effect": (k) => { const a = ask(k); k.define(k.def("p"), k.call(a.op.ask)); },
  "no-cases": (k) => k.define(k.def("p"), k.fn(["b"], (b) => k.match(b, []))),
  "not-float-record": (k) => k.define(k.def("p"), k.call(S.mapParts, k.fn(["x"], (x) => x), k.lit("hi"))),
  "functions-in-data": (k) => k.define(k.def("p"), k.call(S.equal, k.fn(["x"], (x) => x), k.fn(["x"], (x) => x))),
  "no-port": (k) => { const f = k.def("f"); k.define(f, k.fn(["a"], (a) => k.call(ARITH.add, a, k.lit(1)))); k.define(k.def("p"), k.solve(f, { nope: k.lit(1), out: k.lit(3) }, { [param(k, f, 0)]: "x" }, (b) => b[param(k, f, 0)])); },
  // A use with no body gives its produced ports (L211); one given every port has none to give.
  "produces-nothing": (k) => { const f = k.def("f"); k.define(f, k.fn(["a"], (a) => k.call(ARITH.add, a, k.lit(1)))); const add = (n: NodeData) => (k as unknown as { add(n: NodeData): Id }).add(n); k.define(k.def("p"), k.thunk(() => k.call(S.first, k.thunk(() => add({ kind: "call", fn: add({ kind: "ref", target: f }), given: { [param(k, f, 0)]: k.lit(2), out: k.lit(3) } } as NodeData)), k.thunk(() => k.lit(1))))); },
  "too-many-ports": (k) => {
    const ns = ["a", "b", "c", "d", "e", "f", "g", "h", "i"], r = k.def("r");
    k.define(r, k.fn(ns, (...xs) => xs.slice(1).reduce((acc, x) => k.and(acc, k.equal(x, k.lit(1))), k.equal(xs[0], k.lit(1)))));
    const add = (n: NodeData) => (k as unknown as { add(n: NodeData): Id }).add(n);
    k.define(k.def("p"), add({ kind: "call", fn: add({ kind: "ref", target: r }), given: { out: k.x(TRUE) } } as NodeData));
  },
  "needs-more-ports": (k) => { const f = k.def("f"); k.define(f, k.fn(["a", "b"], (a, b) => k.call(ARITH.add, a, b))); k.define(k.def("p"), k.solve(f, {}, { [param(k, f, 0)]: "x", [param(k, f, 1)]: "y" }, (b) => b[param(k, f, 0)])); },
  "not-backwards": (k) => { const v = k.def("v"); k.define(v, k.lit(1)); k.define(k.def("p"), k.solve(v, { out: k.lit(3) }, {}, () => k.lit(0))); },
  "field-of-one-case": (k) => { const t = k.type("Shape", [], [["dot", []], ["disc", [["r", () => k.tref(NUMBER)]]]]); k.define(k.def("p"), k.fn(["s"], (s) => k.call(t.f["disc.r"], s))); },
  "not-folded": (k) => { const t = k.type("Disc", [], [["disc", [["r", () => k.tref(NUMBER)]]]]); k.define(k.def("p"), k.fn(["s"], (s) => k.fold(s, [{ variant: t.v.disc, names: ["r"], results: ["rr"], body: (b) => b[0] }]))); },
  "might-not-finish": (k) => { const loop = k.def("loop"); k.define(loop, k.fn(["v"], (v) => k.call(S.mapParts, loop, v))); },
  "field-must-finish": (k) => {
    const t = k.type("Stream", [], [["node", [["next", (self) => k.tfun([], k.tref(self))]]]]), make = k.def("make");
    k.define(make, k.fn(["u"], (u) => k.call(t.v.node, k.thunk(() => k.match(k.call(make, u), [{ variant: t.v.node, names: ["n"], body: ([n]) => k.call(n) }])))));
  },
  "cant-fold": (k) => { const t = k.type("Stream", [], [["more", [["next", (self) => k.tfun([], k.tref(self))]]]]); k.define(k.def("p"), k.fn(["s"], (s) => k.fold(s, [{ variant: t.v.more, names: ["next"], results: ["rest"], body: (_b, r) => r[0]! }]))); },
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
  "handler-name-not-value": (k) => { const a = ask(k); k.define(k.def("p"), k.thunk(() => k.handleNamed("n", (n) => k.let("kept", k.x(n), () => k.call(a.op.ask, k.x(n))), answered(k, a, () => k.lit(1))))); },
  "handler-name-other-effect": (k) => { const a = ask(k), b = k.effect("Other", [["other", [], () => k.tref(NUMBER)]]); k.define(k.def("p"), k.thunk(() => k.handleNamed("n", (n) => k.call(b.op.other, k.x(n)), answered(k, a, () => k.lit(1))))); },
  "handler-name-out-of-scope": (k) => { const a = ask(k); let kept = ""; k.define(k.def("p"), k.thunk(() => k.seq(k.handleNamed("n", (n) => { kept = n; return k.lit(1); }, answered(k, a, () => k.lit(1))), k.call(a.op.ask, k.x(kept))))); },
  "handler-name-escapes": (k) => { const a = ask(k); k.define(k.def("p"), k.thunk(() => k.handleNamed("n", (n) => k.thunk(() => k.call(a.op.ask, k.x(n))), answered(k, a, () => k.lit(1))))); },
  "name-on-plain-match": (k) => k.define(k.def("p"), k.fn(["b"], (b) => { const m = k.if(b, k.lit(1), k.lit(2)); (k.code.nodes[m] as { name?: string }).name = (k as unknown as { binder: (n: string) => string }).binder("n"); return m; })),
  "named-operation-inputs": (k) => { const a = ask(k); k.define(k.def("p"), k.thunk(() => k.handleNamed("n", (n) => k.call(a.op.ask, k.x(n), k.lit(1)), answered(k, a, () => k.lit(1))))); },
  "release-given-something": (k) => { const a = ask(k); k.define(k.def("p"), k.thunk(() => k.match(k.call(a.op.ask), [...answered(k, a, () => k.lit(1)), { variant: RELEASE_V, names: ["x"], body: () => k.x("std.unit.unit") }]))); },
  "release-acts": (k) => { const a = ask(k); k.define(k.def("p"), k.thunk(() => k.handle(k.call(a.op.ask), answered(k, a, () => k.lit(1)), undefined, () => k.call(S.print, k.lit("a"))))); },
  "resumed-twice": (k) => { const a = k.effect("Wait", [["wait", [], () => k.tref(NUMBER), "later"]]); k.define(k.def("p"), k.thunk(() => k.handle(k.call(a.op.wait), [{ variant: a.op.wait, names: ["go"], body: ([go]) => k.seq(k.call(go, k.lit(1)), k.call(go, k.lit(2))) }]))); },
  "finish-not-function": (k) => { const a = ask(k); k.define(k.def("p"), k.thunk(() => k.match(k.call(a.op.ask), answered(k, a, () => k.lit(1)), k.lit(2)))); },
  "later-case-chooses": (k) => { const a = k.effect("Wait", [["wait", [], () => k.tref(NUMBER), "later"]]); k.define(k.def("p"), k.thunk(() => k.handle(k.call(a.op.wait), [{ variant: a.op.wait, names: ["go"], body: ([go]) => k.call(go, k.call(S.oneOf, k.list(k.lit(1), k.lit(2)))) }]))); },
  "release-lets-choice": (k) => { const a = ask(k); k.define(k.def("p"), k.thunk(() => k.handle(k.seq(k.call(a.op.ask), k.call(S.oneOf, k.list(k.lit(1), k.lit(2)))), answered(k, a, () => k.lit(1)), undefined, () => k.x("std.unit.unit")))); },
  "embedding-open": (k) => k.define(k.def("p"), k.call(EMBEDDING_V, k.fn(["x"], (x) => x))),
  "embedding-not-record": (k) => k.define(k.def("p"), k.let("e", k.call(EMBEDDING_V, k.fn(["x"], (x) => k.call(S.show, x))), (e) => e)),
  "embedding-itself": (k) => k.define(k.def("p"), k.call(EMBEDDING_V, k.fn(["x"], (x) => k.call(INT_OPS.add, x, k.int(0))))),
  // Two ways from A to D, through B and through C, and none straight.
  "embedding-ways": (k) => {
    const t = Object.fromEntries(["a", "b", "c", "d"].map((n) => [n, k.type(n.toUpperCase(), [], [[n, []]]).v[n]]));
    const into = (from: string, to: string) => k.define(k.def(`${from} to ${to}`), k.call(EMBEDDING_V, k.fn(["x"], (x) => k.match(x, [{ variant: t[from], names: [], body: () => k.x(t[to]) }]))));
    into("a", "b"); into("b", "d"); into("a", "c"); into("c", "d");
  },
  "embedding-twice": (k) => k.define(k.def("p"), k.call(EMBEDDING_V, k.x(INT_OPS.toNumber))),
  "implementation-not-record": (k) => { const t = k.type("Colour", [], [["red", []]]); k.define(k.def("p"), k.let("s", k.call(SHOWN_V, k.fn(["c"], (c) => k.match(c, [{ variant: t.v.red, names: [], body: () => k.lit("red") }]))), (s) => s)); },
  "set-not-field": (k) => { k.type("Pt", [], [["pt", [["x", () => k.tref(NUMBER)]]]]); k.define(k.def("p"), k.fn(["r"], (r) => k.call(SET, k.fn(["q"], () => k.lit(1)), r, k.lit(2)))); },
  "path-not-field": (k) => k.define(k.def("p"), k.call(CELL_OPS.path, k.fn(["t"], () => k.lit(1)))),
  "results-unreachable": (k) => { const f = k.def("f"); k.define(f, k.fn(["a", "b"], (a, b) => k.call(ARITH.less, a, b))); k.results(f, "b"); },
  "effect-as-type": (k) => { const a = ask(k); const t = k.type("Box", [], [["box", [["c", () => k.tref(a.def)]]]]); k.define(k.def("p"), k.fn(["b"], (b) => k.call(t.f["box.c"], b))); },
  "interface-shape": (k) => { const d = k.interface("Sized", "a", [["size", (a) => k.tfun([k.tref(a)], k.tref(NUMBER))]]); (k.code.nodes[(k.code.nodes[d.def] as { body: string }).body] as { params: string[] }).params.push(k.binder("b")); },
  "operation-not-function": (k) => { k.interface("Sized", "a", [["size", (a) => k.tref(a)]]); },
  "fraction-literal": (k) => k.define(k.def("p"), k.at(RATIONAL_TYPE, "1/0")),
  "number-literal": (k) => k.define(k.def("p"), k.at(COMPLEX_TYPE, "a")),
  "shared-different-types": (k) => { const t = k.type("Shape", [], [["dot", [["r", () => k.tref(NUMBER)]]], ["disc", [["r", () => k.tref("type.text")]]]]); (k.code.nodes[t.f["disc.r"]] as { same?: string }).same = t.f["dot.r"]; k.define(k.def("p"), k.fn(["s"], (s) => k.call(t.f["dot.r"], s))); },
  "shared-field-wrong": (k) => { const t = k.type("Shape", [], [["dot", [["r", () => k.tref(NUMBER)], ["q", () => k.tref(NUMBER)]]], ["disc", [["r", () => k.tref(NUMBER)]]]]); (k.code.nodes[t.f["dot.q"]] as { same?: string }).same = t.f["dot.r"]; k.define(k.def("p"), k.fn(["s"], (s) => k.call(t.f["dot.r"], s))); },
  "mask-takes-one": (k) => { const t = k.type("Trail", [], [["trail", [["at", () => k.tref("type.vector of")]]]]); k.define(k.def("p"), k.fn(["s"], (s) => k.call(t.f["trail.at"], s))); },
  // A pin is the scheme another definition has (q's), held for p.
  "pinned-type": (k) => { const q = k.def("q"), p = k.def("p"); k.define(q, k.fn(["x"], (x) => k.call(S.not, x))); k.define(p, k.fn(["x"], (x) => k.call(S.show, x))); return { [p]: q }; },
  "search-unhandled": (k) => { const f = k.def("f"); k.define(f, k.fn(["a"], (a) => k.call(ARITH.add, a, k.lit(1)))); k.define(k.def("p"), k.solve(f, { [param(k, f, 0)]: k.lit(1), out: k.lit(2) }, {}, () => k.lit(0))); },
  "results-not-ports": (k) => { const f = k.def("f"); k.define(f, k.fn(["a", "b"], (a, b) => k.call(ARITH.less, a, b))); k.results(f, "b", "b"); },
  "direction-types": (k) => { const r = k.def("r"), d = k.def("d"); k.define(r, k.fn(["a", "b"], (a, b) => k.call(S.equal, b, k.call(ARITH.add, a, k.lit(1))))); k.results(r, "b"); k.define(d, k.fn(["a", "b"], (a, b) => k.call(S.equal, b, k.call(S.show, a)))); k.results(d, "b"); k.direction(d, r); },
  "not-a-number": (k) => k.define(k.def("p"), k.fn(["b"], (b) => k.match(b, [{ variant: TRUE, names: [], body: () => k.lit(1) }, { variant: FALSE, names: [], body: () => k.lit("a") }]))),
};

test("every problem has its smallest program, and its message is that row's alone", () => {
  assert.deepEqual(PROBLEMS.map((p) => p.id).sort(), Object.keys(SMALLEST).sort());
  assert.equal(new Set(PROBLEMS.map((p) => p.id)).size, PROBLEMS.length);
  for (const p of PROBLEMS) {
    const k = new Lang(LIBRARY.code);
    const gave = SMALLEST[p.id](k), held = gave && typeof gave === "object" ? (gave as Record<string, string>) : null;
    const code = base(k.code), names = baseNames(k.names);
    const unpinned = held ? infer(code, names, undefined, checkOptions) : null;
    const opts = held ? { ...checkOptions, pins: { ...checkOptions.pins, ...Object.fromEntries(Object.entries(held).map(([d, like]) => [d, unpinned!.schemes.get(like)!])) } } : checkOptions;
    const messages = infer(code, names, undefined, opts).errors.map((e) => e.message);
    assert.ok(messages.length, `${p.id}: no problem`);
    for (const m of messages) {
      assert.deepEqual(PROBLEMS.filter((q) => q.says.test(m)).map((q) => q.id), [p.id], `${p.id}: "${m}"`);
      assert.equal(problemOf(m)?.id, p.id);
    }
  }
});
