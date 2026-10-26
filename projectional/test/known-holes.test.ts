// Holes found by the reviews (REVIEW.md, REVIEW-2026-10-22b.md, then
// REVIEW-2026-10-26.md). Each test states what *should* happen. One still
// open is marked todo, so it runs and reports without failing the suite;
// when a fix lands, the todo is dropped and the test guards it. Every hole
// from the first two reviews is fixed; the open ones are the third
// review's ("R3"), at the end.

import { test } from "node:test";
import assert from "node:assert/strict";
import { get, type Code, type Id, type NodeData } from "../src/model.ts";
import { Lang } from "../src/lang/dsl.ts";
import { infer } from "../src/lang/infer.ts";
import { base, baseNames, checkOptions } from "../src/lang/load.ts";
import { LIBRARY } from "../src/lang/library.ts";
import { relate } from "../src/lang/relate.ts";
import { runMain } from "../src/lang/run.ts";
import { CELL_OPS, COMPARE, CONS, NIL, RATIO, S, SET_V, SHOW_ANY } from "../src/lang/std.ts";
import { DIVERGE, RATIONAL_TYPE } from "../src/lang/types.ts";
import { B } from "../src/prelude.ts";

function program(build: (k: Lang) => Id) {
  const k = new Lang();
  const main = build(k);
  const code = base(k.code), names = baseNames(k.names);
  const info = infer(code, names);
  const run = () => { const out: string[] = []; runMain(code, info, main, { print: (s) => out.push(s) }); return out; };
  const effects = (d: Id) => { const t = info.typeOf.get(d); return t?.t === "fn" ? t.eff.effs : []; };
  return { k, code, info, main, run, effects };
}
const params = (code: Code, def: Id) => get(code, get(code, def, "def").body!, "lambda").params;
const add = (k: Lang, n: NodeData) => (k as unknown as { add: (n: NodeData) => Id }).add(n);

test("§1.1 a data type that contains a function of itself can loop without Diverge (Landin's knot)", () => {
  let apply = "";
  const p = program((k) => {
    const knot = k.type("knot", [], [["wrap", [["f", (self) => add(k, { kind: "tfun", params: [k.tref(self)], result: k.tref("type.number") })]]]]);
    apply = k.def("apply");
    k.define(apply, k.fn(["x"], (x) => k.match(x, [{ variant: knot.v.wrap, names: ["f"], body: ([f]) => k.call(f, x) }])));
    const main = k.def("main");
    k.define(main, k.thunk(() => k.call(S.print, k.call(S.show, k.call(apply, k.call(knot.v.wrap, apply))))));
    return main;
  });
  // Either the type is rejected, or something on the path carries Diverge.
  assert.ok(p.info.errors.length > 0 || p.effects(apply).includes(DIVERGE), "apply(wrap(apply)) never ends, and its type says it's total");
});

test("§1.1 every recursive call shrinks some argument, and it still never ends", () => {
  let ping = "";
  const p = program((k) => {
    ping = k.def("ping");
    k.define(ping, k.fn(["a", "b"], (a, b) => k.match(a, [
      { variant: NIL, names: [], body: () => k.match(b, [
        { variant: NIL, names: [], body: () => k.lit(0) },
        // b shrinks, a grows
        { variant: CONS, names: ["h", "u"], body: ([, u]) => k.call(ping, k.list(k.lit(0), k.lit(0)), u) },
      ]) },
      // a shrinks, b grows
      { variant: CONS, names: ["h", "t"], body: ([, t]) => k.call(ping, t, k.call(CONS, k.lit(0), k.call(CONS, k.lit(0), b))) },
    ])));
    return ping;
  });
  assert.ok(p.effects(ping).includes(DIVERGE), "ping([0], [0]) runs forever, and its type says it's total");
});

test("§1.1 naming the smaller piece with a dot shouldn't cost the totality proof", () => {
  let len = "";
  const p = program((k) => {
    len = k.def("length");
    k.define(len, k.fn(["xs"], (xs) => k.match(xs, [
      { variant: NIL, names: [], body: () => k.lit(0) },
      { variant: CONS, names: ["h", "t"], body: ([, t]) => k.let("rest", t, (r) => k.call(B.add, k.lit(1), k.call(len, r))) },
    ])));
    return len;
  });
  assert.ok(!p.effects(len).includes(DIVERGE));
});

test("§2.1 the evaluator can fold a list of ten thousand numbers", () => {
  const p = program((k) => {
    const total = k.def("total");
    k.define(total, k.fn(["xs"], (xs) => k.fold(xs, [
      { variant: NIL, names: [], body: () => k.lit(0) },
      { variant: CONS, names: ["h", "t"], results: [null, "r"], body: ([h], [, r]) => k.call(B.add, h, r!) },
    ])));
    const main = k.def("main");
    k.define(main, k.thunk(() => k.call(S.print, k.call(S.show, k.call(total, k.call(S.range, k.lit(10000)))))));
    return main;
  });
  assert.deepEqual(p.run(), ["49995000"]);
});

test("§1.2 derivative of a builtin passed as a value", () => {
  const p = program((k) => {
    const main = k.def("main");
    // A derivative may not exist (Choice), so it's asked for under `first`.
    k.define(main, k.thunk(() => k.call(S.print, k.call(S.first,
      k.thunk(() => k.call(S.show, k.call(k.call(S.derivative, B.sqrt), k.lit(4)))),
      k.thunk(() => k.lit("none"))))));
    return main;
  });
  assert.deepEqual(p.run(), ["0.25"]);
});

test("§1.2 a well-typed backwards solve must not throw NotInvertible at run time", () => {
  const p = program((k) => {
    const g = k.def("g");
    k.define(g, k.fn(["x"], (x) => k.call(S.first, k.thunk(() => k.call(B.mul, x, k.lit(2))), k.thunk(() => k.lit(0)))));
    const [x] = params(k.code, g);
    const main = k.def("main");
    k.define(main, k.thunk(() => k.call(S.print, k.call(S.show, k.call(S.count, k.thunk(() =>
      k.solve(g, { out: k.lit(6) }, { [x]: "x" }, (b) => b[x])))))));
    return main;
  });
  // Either the checker refuses it, or it runs. The checker refuses it now
  // (modes.ts): `first` waits until what its action uses is known, and
  // nothing gives x, so the search could only end with x unknown. It used
  // to run and print 0, an answer count that said nothing about why.
  assert.deepEqual(p.info.errors.map((e) => e.message), ["g can't be run this way: nothing gives x"]);
});

test("§1.3 equal on functions should be refused, not compare by identity", () => {
  const p = program((k) => {
    const main = k.def("main");
    const square = () => k.fn(["x"], (x) => k.call(B.mul, x, x));
    k.define(main, k.thunk(() => k.call(S.print, k.call(S.show, k.call(S.count, k.thunk(() =>
      k.if(k.call(S.equal, square(), square()), k.lit(1), k.call(S.fail))))))));
    return main;
  });
  assert.ok(p.info.errors.length > 0, "two copies of the same function compare unequal today");
});

// ---------------------------------------------------------------- the second review (REVIEW-2026-10-22b.md)

test("R2 §1.1 reading a formula that never ends is typed as if it may not end", () => {
  let spin = "";
  const p = program((k) => {
    spin = k.def("spin");
    k.define(spin, k.fn(["x"], (x) => k.call(spin, k.call(B.add, x, k.lit(1)))));
    const main = k.def("main");
    k.define(main, k.thunk(() => k.let("f", k.call(CELL_OPS.formula, k.thunk(() => k.call(spin, k.lit(0)))), (f) =>
      k.call(S.print, k.call(S.show, k.call(CELL_OPS.read, f))))));
    return main;
  });
  assert.ok(p.effects(spin).includes(DIVERGE));
  // main runs forever: read says Diverge, so its type does too.
  assert.ok(p.effects(p.main).includes(DIVERGE), "main reads a formula that never ends, and its type says it's total");
});

test("R2 §1.2 equal gives the same answer whether or not it goes through a generic function", () => {
  const p = program((k) => {
    const same = k.def("same");
    k.define(same, k.fn(["x", "y"], (x, y) => k.equal(x, y)));
    const main = k.def("main");
    const a = () => k.lit(1000000000000), b = () => k.lit(1000000000001);
    k.define(main, k.thunk(() => k.seq(
      k.call(S.print, k.call(SHOW_ANY, k.equal(a(), b()))),
      k.call(S.print, k.call(SHOW_ANY, k.call(same, a(), b()))))));
    return main;
  });
  assert.deepEqual(p.info.errors, []);
  // Today: ["true", "false"]. Inlining `same` changes the answer.
  const [direct, generic] = p.run();
  assert.equal(direct, generic);
});

test("R2 §1.2 run backwards, Ints still compare to within 1e-9", () => {
  const k = new Lang();
  const f = k.def("f");
  k.define(f, k.thunk(() => k.call(S.oneOf, k.list(k.int(1000000000001)))));
  const code = base(k.code);
  let steps = 0;
  const answers = [...relate(code, f, { out: 1000000000000 }, { spend: () => ++steps < 2000 })];
  // Forward, f() = 1000000000000 is false (equal on Int is exact since #78).
  assert.equal(answers.length, 0, "f() = 1000000000000 has an answer backwards");
});

test("R2 §2.1 running a one-item `one of` backwards ends", () => {
  const k = new Lang();
  const f = k.def("f");
  k.define(f, k.thunk(() => k.call(S.oneOf, k.list(k.lit(3)))));
  const code = base(k.code);
  for (const out of [3, 5]) {
    let steps = 0;
    // Without a budget this runs until memory runs out.
    [...relate(code, f, { out }, { spend: () => ++steps < 10000 })];
    assert.ok(steps < 10000, `f() = ${out} backwards was still searching after 10,000 steps`);
  }
});

// ---------------------------------------------------------------- the third review (REVIEW-2026-10-26.md)

// A main over the library (maps, sets, sort, fractions): its type errors and
// what it prints, one line per step.
const lib = (name: string) => LIBRARY.modules.flatMap((m) => m.exports).find((d) => LIBRARY.names[d] === name)!;
function printed(steps: (k: Lang, L: typeof lib) => Id[]) {
  const k = new Lang(LIBRARY.code);
  const main = k.def("main");
  k.define(main, k.thunk(() => k.seq(...steps(k, lib).map((x) => k.call(S.print, k.call(SHOW_ANY, x))))));
  const code = base(k.code), names = baseNames(k.names);
  const info = infer(code, names, undefined, checkOptions);
  const out: string[] = [];
  if (!info.errors.length) runMain(code, info, main, { print: (s) => out.push(s) });
  return { errors: info.errors, out };
}
const nums = (k: Lang, xs: number[]) => k.list(...xs.map((x) => k.lit(x)));

test("R3 §1.1 √x · √x equals x for a big x, as it does for 2", { todo: "two Numbers that happen to be whole compare exactly, so the tolerance vanishes above 2^53/1e9" }, () => {
  const sq = (k: Lang, x: number) => k.equal(k.call(B.mul, k.call(B.sqrt, k.lit(x)), k.call(B.sqrt, k.lit(x))), k.lit(x));
  // Today: ["true", "false"]. sqrt(1e17)² is 1.0000000000000002e17, a whole
  // float, so it's compared exactly; sqrt(2)² isn't whole, so it's near.
  assert.deepEqual(printed((k) => [sq(k, 2), sq(k, 1e17)]).out, ["true", "true"]);
});

test("R3 §1.2 a set of Numbers has the same size whatever order its items come in", () => {
  // Each neighbour is within 1e-9 of the next; the two ends are not.
  const a = 1000.5, d = 1.5e-6;
  const size = (k: Lang, L: typeof lib, xs: number[]) => k.call(L("set size"), k.call(L("as set"), nums(k, xs)));
  const { out } = printed((k, L) => [size(k, L, [a, a + d, a + 2 * d]), size(k, L, [a + d, a, a + 2 * d]), size(k, L, [a, a + 2 * d, a + d])]);
  // Before L78 (#443): ["2", "2", "1"].
  assert.equal(new Set(out).size, 1, `sizes by order: ${out.join(", ")}`);
});

test("R3 §1.3 NaN, which 0/0 and sqrt(−1) make in typed code, doesn't break compare or sets", () => {
  const nan = (k: Lang) => k.call(B.div, k.lit(0), k.lit(0));
  const { errors, out } = printed((k, L) => [
    k.call(COMPARE, nan(k), k.lit(1)), k.call(COMPARE, k.lit(1), nan(k)),
    k.call(L("has item"), k.call(L("as set"), k.list(nan(k), k.lit(1))), nan(k)),
  ]);
  assert.deepEqual(errors, []);
  // Before L78 (#443): ["after", "after", "false"].
  assert.notEqual(out[0], out[1], "compare isn't antisymmetric on NaN");
  assert.equal(out[2], "true", "a set doesn't find the NaN put in it");
});

test("R3 §2.1 a set made with its constructor keeps the set's rule (sorted, no item twice)", () => {
  const { errors, out } = printed((k, L) => [
    k.call(L("set size"), k.call(SET_V, k.list(k.lit(3), k.lit(1), k.lit(3)))),
    k.equal(k.call(SET_V, k.list(k.lit(3), k.lit(1))), k.call(L("as set"), nums(k, [1, 3]))),
  ]);
  // Either the checker refuses the raw constructor, or what it makes is a
  // set. Before L79 the checker took it, and it printed ["3", "false"].
  assert.ok(errors.length > 0 || (out[0] === "2" && out[1] === "true"), `printed ${out.join(", ")}`);
});

test("R3 §2.2 a fraction made with ratio keeps the fraction's rule (lowest terms, bottom not zero)", () => {
  const { errors, out } = printed((k) => [
    k.equal(k.call(RATIO, k.int(2), k.int(4)), k.at(RATIONAL_TYPE, "1/2")),
    k.call(COMPARE, k.call(RATIO, k.int(1), k.int(0)), k.call(RATIO, k.int(-7), k.int(0))),
  ]);
  // Before L79: no error, and ["false", "same"]: compare says 2/4 is 1/2 and
  // equal says it isn't, and 1/0 is the same as −7/0.
  assert.ok(errors.length > 0 || (out[0] === "true" && out[1] !== "same"), `printed ${out.join(", ")}`);
});
