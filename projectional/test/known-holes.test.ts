// Holes found by the reviews (REVIEW.md, then REVIEW-2026-10-22b.md). Each
// test states what *should* happen. One still open is marked todo, so it
// runs and reports without failing the suite; when a fix lands, the todo is
// dropped and the test guards it. Every hole from the first review is
// fixed; the open ones are the second review's, at the end.

import { test } from "node:test";
import assert from "node:assert/strict";
import { get, type Code, type Id, type NodeData } from "../src/model.ts";
import { Lang } from "../src/lang/dsl.ts";
import { infer } from "../src/lang/infer.ts";
import { base, baseNames } from "../src/lang/load.ts";
import { relate } from "../src/lang/relate.ts";
import { runMain } from "../src/lang/run.ts";
import { CELL_OPS, CONS, NIL, S, SHOW_ANY } from "../src/lang/std.ts";
import { DIVERGE } from "../src/lang/types.ts";
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
  // Either the checker refuses it, or it runs. It runs: `first` waits until
  // what its action uses is known, and x never is, so there's no answer
  // that's pinned down (as for floor and mod run backwards).
  assert.deepEqual(p.info.errors, []);
  assert.deepEqual(p.run(), ["0"]);
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

test("R2 §1.1 reading a formula that never ends is typed as if it ends (Cells hides Diverge)", { todo: "Cells covers Diverge (LANGUAGE.md, Cells)" }, () => {
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
  // main runs forever, and its type is () -[Cells, Console]-> Unit.
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
