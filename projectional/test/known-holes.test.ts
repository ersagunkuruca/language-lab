// Holes found by the review (REVIEW.md). Each test states what *should*
// happen. One still open is marked todo, so it runs and reports without
// failing the suite; when a fix lands, the todo is dropped and the test
// guards it.

import { test } from "node:test";
import assert from "node:assert/strict";
import { get, type Code, type Id, type NodeData } from "../src/model.ts";
import { Lang } from "../src/lang/dsl.ts";
import { infer } from "../src/lang/infer.ts";
import { base, baseNames } from "../src/lang/load.ts";
import { runMain } from "../src/lang/run.ts";
import { CONS, NIL, S } from "../src/lang/std.ts";
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
