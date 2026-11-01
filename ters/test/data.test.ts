// Real-sized primitives: Int (never overflows), text operations, and record
// updates. Each runs in the evaluator; the relational interpreter runs them
// forward too.

import { test } from "node:test";
import assert from "node:assert/strict";
import { type Id } from "../src/model.ts";
import { Lang } from "../src/lang/dsl.ts";
import { infer } from "../src/lang/infer.ts";
import { base, baseNames } from "../src/lang/load.ts";
import { close, runMain } from "../src/lang/run.ts";
import { relate, toValue } from "../src/lang/relate.ts";
import { CONS, INT_OPS as I, NIL, S, SET, SHOW_ANY, TEXT_OPS as T } from "../src/lang/std.ts";
import * as Int from "../src/lang/int.ts";
import { INT, NUMBER, STRING } from "../src/lang/types.ts";
import { B } from "../src/prelude.ts";

function program(build: (k: Lang) => Id) {
  const k = new Lang();
  const main = build(k);
  const code = base(k.code), names = baseNames(k.names);
  const info = infer(code, names);
  const run = () => { const out: string[] = []; runMain(code, info, main, { print: (s) => out.push(s) }); return out; };
  return { k, code, info, main, run };
}
const lines = (k: Lang, ...texts: Id[]) => {
  const main = k.def("main");
  k.define(main, k.thunk(() => k.seq(...texts.map((t) => k.call(S.print, t)))));
  return main;
};
const orNone = (k: Lang, body: () => Id) => k.call(S.first, k.thunk(body), k.thunk(() => k.lit("none")));

test("Int never overflows: 2^64 + 1, 30!, and the step from safe integers to BigInt", () => {
  const p = program((k) => {
    const fact = k.def("factorial");
    // fold over range(n): ∏ (i + 1)
    k.define(fact, k.fn(["n"], (n) => k.fold(k.call(I.range, n), [
      { variant: NIL, names: [], body: () => k.int(1) },
      { variant: CONS, names: ["i", "rest"], results: [null, "r"], body: ([i], [, r]) => k.call(I.mul, k.call(I.add, i, k.int(1)), r!) },
    ])));
    return lines(k,
      orNone(k, () => k.call(I.show, k.call(I.add, k.call(I.power, k.int(2), k.int(64)), k.int(1)))),
      k.call(I.show, k.call(fact, k.int(30))),
      k.call(I.show, k.call(I.add, k.int(9007199254740991), k.int(1))),
      k.call(I.show, k.call(I.sub, k.int("9007199254740992"), k.int(1))),
      k.call(I.show, k.call(I.mul, k.int(-3), k.int("100000000000000000000"))));
  });
  assert.deepEqual(p.info.errors, []);
  assert.deepEqual(p.run(), ["18446744073709551617", "265252859812191058636308480000000", "9007199254740992", "9007199254740991", "-300000000000000000000"]);
});

test("Int division rounds down; dividing by zero and a negative power have no answer", () => {
  const p = program((k) => lines(k,
    orNone(k, () => k.text(k.call(I.show, k.call(I.quotient, k.int(-7), k.int(2))), k.lit(" "), k.call(I.show, k.call(I.remainder, k.int(-7), k.int(2))))),
    orNone(k, () => k.call(I.show, k.call(I.quotient, k.int(1), k.int(0)))),
    orNone(k, () => k.call(I.show, k.call(I.power, k.int(2), k.int(-1)))),
  ));
  assert.deepEqual(p.info.errors, []);
  assert.deepEqual(p.run(), ["-4 1", "none", "none"]);
});

// WHAT-NUMBER-MEANS.md (L86): a plain 2 is some Number, so it is an Int
// where an Int goes; 2.5 isn't one, and an Int's value never becomes a
// Float64 by itself.
test("Int and Float64 don't mix without a conversion, and a plain whole literal is an Int where one goes", () => {
  const two = program((k) => lines(k, k.call(I.show, k.call(I.add, k.int(1), k.lit(2)))));
  assert.deepEqual(two.info.errors, []);
  assert.deepEqual(two.run(), ["3"]);
  const bad = program((k) => lines(k, k.call(I.show, k.call(I.add, k.int(1), k.lit(2.5)))));
  assert.deepEqual(bad.info.errors.map((e) => e.message), ["add needs an Int here, and a number with a fraction part can't be one"]);
  const mixed = program((k) => lines(k, k.call(S.show, k.call(B.add, k.int(1), k.lit(2)))));
  assert.equal(mixed.info.errors.length, 1);
  const ok = program((k) => lines(k,
    orNone(k, () => k.call(I.show, k.call(I.add, k.int(1), k.call(I.wholePart, k.lit(2.7))))),
    k.call(S.show, k.call(I.toNumber, k.int(7))),
    orNone(k, () => k.call(I.show, k.call(I.wholePart, k.call(S.show, k.lit(1)) as never)))));
  assert.equal(ok.info.errors.length, 1);
});

test("text: length, slice, characters, split, join all, find, code, comparison; positions count characters", () => {
  const p = program((k) => lines(k,
    k.call(I.show, k.call(T.length, k.lit("héllo 👋"))),
    k.call(T.slice, k.lit("héllo 👋 world"), k.int(6), k.int(99)),
    k.call(T.joinAll, k.call(T.characters, k.lit("a👋b")), k.lit("|")),
    k.call(T.joinAll, k.call(T.split, k.lit("1,2,,3"), k.lit(",")), k.lit(" ")),
    orNone(k, () => k.call(I.show, k.call(T.find, k.lit("👋 hello"), k.lit("hello")))),
    orNone(k, () => k.call(I.show, k.call(T.find, k.lit("hello"), k.lit("bye")))),
    orNone(k, () => k.call(I.show, k.call(T.code, k.lit("A")))),
    orNone(k, () => k.call(T.fromCode, k.int(128075))),
    k.if(k.call(T.less, k.lit("apple"), k.lit("banana")), k.lit("apple first"), k.lit("banana first")),
    orNone(k, () => k.call(I.show, k.call(I.read, k.lit("-1234567890123456789012")))),
    orNone(k, () => k.call(I.show, k.call(I.read, k.lit("007")))),
  ));
  assert.deepEqual(p.info.errors, []);
  assert.deepEqual(p.run(), ["7", "👋 world", "a|👋|b", "1 2  3", "2", "none", "65", "👋", "apple first", "-1234567890123456789012", "none"]);
});

test("a long text is split, measured and joined at real sizes", () => {
  const p = program((k) => {
    const words = Array.from({ length: 100_000 }, (_, i) => `w${i}`).join(" ");
    return lines(k, k.call(I.show, k.call(T.length, k.call(T.joinAll, k.call(T.split, k.lit(words), k.lit(" ")), k.lit(", ")))));
  });
  const expected = Array.from({ length: 100_000 }, (_, i) => `w${i}`).join(", ").length;
  assert.deepEqual(p.run(), [String(expected)]);
});

function people(k: Lang) {
  const address = k.type("address", [], [["address", [["street", () => k.tref(STRING)], ["city", () => k.tref(STRING)]]]]);
  const person = k.type("person", [], [["person", [["name", () => k.tref(STRING)], ["age", () => k.tref(INT)], ["home", () => k.tref(address.def)]]]]);
  const ada = () => k.call(person.v.person, k.lit("Ada"), k.int(36), k.call(address.v.address, k.lit("St James's Sq"), k.lit("London")));
  const city = (p: Id) => k.call(address.f["address.city"], k.call(person.f["person.home"], p));
  const describe = (p: Id) => k.text(k.call(person.f["person.name"], p), k.lit(", "), k.call(I.show, k.call(person.f["person.age"], p)), k.lit(", "), city(p));
  return { address, person, ada, city, describe };
}

test("set changes one field, or a field at the end of a path, and keeps the others", () => {
  const p = program((k) => {
    const { person, ada, city, describe } = people(k);
    return lines(k,
      k.let("p", ada(), (a) => describe(a)),
      k.let("p", ada(), (a) => describe(k.call(SET, person.f["person.age"], a, k.int(37)))),
      k.let("p", ada(), (a) => describe(k.call(SET, k.fn(["q"], (q) => city(q)), a, k.lit("Paris")))),
    );
  });
  assert.deepEqual(p.info.errors, []);
  assert.deepEqual(p.run(), ["Ada, 36, London", "Ada, 37, London", "Ada, 36, Paris"]);
});

test("set refuses a function that isn't a path of fields, before anything runs", () => {
  const p = program((k) => {
    const { person, ada, describe } = people(k);
    return lines(k, k.let("p", ada(), (a) => describe(k.call(SET, k.fn(["q"], (q) => k.call(I.add, k.call(person.f["person.age"], q), k.int(1))), a, k.int(3)))));
  });
  assert.equal(p.info.errors.length, 1);
  assert.match(p.info.errors[0].message, /path of fields/);
});

test("the relational interpreter runs Int, text and set forward", () => {
  const k = new Lang();
  const { person, ada, city } = people(k);
  const moved = k.def("moved");
  k.define(moved, k.fn(["to"], (to) => k.let("p", ada(), (a) => city(k.call(SET, k.fn(["q"], (q) => city(q)), a, to)))));
  const big = k.def("big");
  k.define(big, k.fn(["n"], (n) => k.call(I.show, k.call(I.mul, n, k.int("1000000000000000000000")))));
  const code = base(k.code);
  const one = (fn: Id, known: Record<string, unknown>) => toValue([...relate(code, fn, known)][0].values.out);
  const param = (fn: Id) => (code.nodes[(code.nodes[fn] as { body: Id }).body] as { params: Id[] }).params[0];
  assert.equal(one(moved, { [param(moved)]: "Paris" }), "Paris");
  assert.equal(one(big, { [param(big)]: 7 }), "7000000000000000000000");
  void person;
});

test("show prints any plain value: lists, cases with the program's names, text, Int", async () => {
  const k = new Lang();
  const shape = k.type("shape", [], [["circle", [["r", () => k.tref(INT)]]], ["dot", []]]);
  const main = lines(k,
    k.call(SHOW_ANY, k.list(k.int(1), k.int(2), k.int(3))),
    k.call(SHOW_ANY, k.list(k.call(shape.v.circle, k.int(2)), k.x(shape.v.dot))),
    k.call(SHOW_ANY, k.lit("text")),
    k.call(SHOW_ANY, k.true));
  const code = base(k.code), names = baseNames(k.names);
  const info = infer(code, names);
  assert.deepEqual(info.errors, []);
  const out: string[] = [];
  runMain(code, info, main, { print: (s) => out.push(s), names });
  assert.deepEqual(out, ["[1, 2, 3]", "[circle(2), dot]", '"text"', "true"]);
  // A function isn't plain data: refused before running.
  const k2 = new Lang();
  const m2 = lines(k2, k2.call(SHOW_ANY, k2.fn(["x"], (x) => x)));
  const c2 = base(k2.code);
  assert.equal(infer(c2, baseNames(k2.names)).errors.length, 1);
  void m2;
});

// REVIEW-2026-10-26.md §1.2 (L80): an Int is a JS number only below 2^28
// and a BigInt beyond, one spelling each, so `equal` can be near on every
// JS number and still exact on Ints.
test("an Int past 2^28 is a BigInt, so equal is exact on Ints and near on Float64s, whole or not", () => {
  assert.equal(Int.norm(2n ** 28n - 1n), 2 ** 28 - 1);
  assert.equal(Int.norm(2n ** 28n), 2n ** 28n);
  assert.equal(Int.norm(-(2n ** 28n) + 1n), -(2 ** 28) + 1);
  assert.equal(Int.add(2 ** 28 - 1, 1), 2n ** 28n);
  assert.equal(Int.sub(2n ** 28n, 1), 2 ** 28 - 1);
  assert.equal(Int.mul(2 ** 14, 2 ** 14), 2n ** 28n);
  assert.equal(Int.intLit(1e12), 10n ** 12n);
  assert.ok(Int.isInt(5) && Int.isInt(2n ** 30n) && !Int.isInt(2 ** 30) && !Int.isInt(5n));
  const p = program((k) => lines(k, ...[
    k.equal(k.int(1000000000000), k.int(1000000000001)), k.equal(k.int(268435455), k.int(268435456)),
    k.equal(k.at(NUMBER, 1e12), k.at(NUMBER, 1e12 + 1)), k.equal(k.call(B.mul, k.call(B.sqrt, k.lit(1e17)), k.call(B.sqrt, k.lit(1e17))), k.lit(1e17)),
  ].map((b) => k.call(SHOW_ANY, b))));
  assert.deepEqual(p.info.errors, []);
  assert.deepEqual(p.run(), ["false", "false", "true", "true"]);
});

// BACKLOG L81: past the largest float the tolerance is itself ∞, so only a
// finite gap is near: ∞ is equal to ∞ alone, not to −∞, 0 or 1e308. Since
// L125a no Float64 is ∞ (it lives in Extended, L125d), but the host's
// nearness keeps the rule.
test("infinities are equal only to themselves", () => {
  assert.deepEqual([[Infinity, -Infinity], [Infinity, 0], [1e308, Infinity], [-1e308, -Infinity], [1e308, -1e308], [NaN, NaN], [Infinity, NaN]].map(([a, b]) => close(a, b)), [false, false, false, false, false, false, false]);
  assert.deepEqual([[Infinity, Infinity], [-Infinity, -Infinity], [1e308, 1e308 * (1 + 1e-12)], [0.1 + 0.2, 0.3]].map(([a, b]) => close(a, b)), [true, true, true, true]);
});

// L125a and L125b (FLOAT-VALUES-2026-11-01.md): Float64 is the finite
// floats. An answer outside them is no answer (x/0, √ of a negative, log of
// 0 or less: a Choice, which all and first see) or an overflow, which stops
// the program with the reason.
test("a Float64 is always finite: no answer is a Choice, and overflow stops the program with the reason", () => {
  const none: ((k: Lang) => Id)[] = [
    (k) => k.call(B.div, k.lit(1), k.lit(0)),
    (k) => k.call(B.div, k.lit(0), k.lit(0)),
    (k) => k.call(B.sqrt, k.lit(-4)),
    (k) => k.call(B.log, k.lit(0)),
  ];
  for (const make of none) assert.deepEqual(program((k) => lines(k, k.call(SHOW_ANY, k.call(S.all, k.thunk(() => make(k)))))).run(), ["[]"]);
  assert.throws(() => program((k) => lines(k, k.call(S.show, k.call(B.mul, k.lit(1e308), k.lit(10))))).run(), /too big for a Float64/);
  assert.deepEqual(program((k) => lines(k, k.call(S.show, k.call(B.mul, k.lit(-0), k.lit(1))))).run(), ["0"]);
});
