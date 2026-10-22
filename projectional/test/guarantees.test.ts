// What the checker promises, and the programs that used to break those
// promises (REVIEW.md §1). known-holes.test.ts has the review's own
// examples; these are the neighbours that keep the fixes honest in both
// directions: they refuse what they must and accept what they should.

import { test } from "node:test";
import assert from "node:assert/strict";
import { get, type Code, type Id, type NodeData } from "../src/model.ts";
import { Lang } from "../src/lang/dsl.ts";
import { infer } from "../src/lang/infer.ts";
import { base, baseNames } from "../src/lang/load.ts";
import { relate } from "../src/lang/relate.ts";
import { runMain } from "../src/lang/run.ts";
import { CONS, NIL, PAIR_V, S } from "../src/lang/std.ts";
import { DIVERGE, showType } from "../src/lang/types.ts";
import { B } from "../src/prelude.ts";

function program(build: (k: Lang) => Id | void) {
  const k = new Lang();
  const main = build(k) ?? null;
  const code = base(k.code), names = baseNames(k.names);
  const info = infer(code, names);
  const run = () => { const out: string[] = []; runMain(code, info, main!, { print: (s) => out.push(s) }); return out; };
  const effects = (d: Id) => { const t = info.typeOf.get(d); return t?.t === "fn" ? t.eff.effs : []; };
  const type = (d: Id) => showType(info.typeOf.get(d)!, names);
  return { k, code, names, info, run, effects, type, errors: info.errors.map((e) => e.message) };
}
const params = (code: Code, def: Id) => get(code, get(code, def, "def").body!, "lambda").params;
const add = (k: Lang, n: NodeData) => (k as unknown as { add: (n: NodeData) => Id }).add(n);
const fnType = (k: Lang, from: Id[], to: Id) => add(k, { kind: "tfun", params: from, result: to });
const NUM = "type.number";
const orNone = (k: Lang, body: () => Id) => k.call(S.first, k.thunk(body), k.thunk(() => k.lit("none")));

// ---------------------------------------------------------------- termination

test("size-change: ackermann (a lexicographic order) is total", () => {
  let ack = "";
  const p = program((k) => {
    ack = k.def("ackermann");
    k.define(ack, k.fn(["a", "b"], (a, b) => k.match(a, [
      { variant: NIL, names: [], body: () => k.call(CONS, k.lit(0), b) },
      { variant: CONS, names: ["h", "a2"], body: ([, a2]) => k.match(b, [
        { variant: NIL, names: [], body: () => k.call(ack, a2, k.list(k.lit(0))) },
        { variant: CONS, names: ["g", "b2"], body: ([, b2]) => k.call(ack, a2, k.call(ack, a, b2)) },
      ]) },
    ])));
  });
  assert.deepEqual(p.errors, []);
  assert.ok(!p.effects(ack).includes(DIVERGE), p.type(ack));
});

test("size-change: arguments that swap places, and mutual recursion that shrinks, are total", () => {
  let swap = "", isEven = "", isOdd = "";
  const p = program((k) => {
    swap = k.def("swap");
    k.define(swap, k.fn(["a", "b"], (a, b) => k.match(a, [
      { variant: NIL, names: [], body: () => k.lit(0) },
      { variant: CONS, names: ["h", "t"], body: ([, t]) => k.call(swap, b, t) },
    ])));
    isEven = k.def("is even");
    isOdd = k.def("is odd");
    k.define(isEven, k.fn(["xs"], (xs) => k.match(xs, [
      { variant: NIL, names: [], body: () => k.true },
      { variant: CONS, names: ["h", "t"], body: ([, t]) => k.call(isOdd, t) },
    ])));
    k.define(isOdd, k.fn(["xs"], (xs) => k.match(xs, [
      { variant: NIL, names: [], body: () => k.false },
      { variant: CONS, names: ["h", "t"], body: ([, t]) => k.call(isEven, t) },
    ])));
  });
  assert.deepEqual(p.errors, []);
  for (const d of [swap, isEven, isOdd]) assert.ok(!p.effects(d).includes(DIVERGE), p.type(d));
});

test("size-change: a call that keeps every argument the same size is Diverge", () => {
  let spin = "";
  const p = program((k) => {
    spin = k.def("spin");
    k.define(spin, k.fn(["a", "b"], (a, b) => k.match(a, [
      { variant: NIL, names: [], body: () => k.lit(0) },
      // b is no smaller, a is swapped for it: nothing shrinks along spin → spin
      { variant: CONS, names: ["h", "t"], body: () => k.call(spin, b, a) },
    ])));
  });
  assert.ok(p.effects(spin).includes(DIVERGE));
});

test("only functions can be recursive: a value defined in terms of itself is refused", () => {
  const p = program((k) => {
    const ones = k.def("ones");
    k.define(ones, k.call(CONS, k.lit(1), ones));
  });
  assert.ok(p.errors.some((m) => /ones is defined in terms of itself/.test(m)), p.errors.join("\n"));
});

// ---------------------------------------------------------------- positivity

test("positivity: lazy data (a function returning the type) is fine", () => {
  const p = program((k) => {
    k.type("stream", [], [["more", [["head", () => NUM], ["rest", (self) => fnType(k, [], k.tref(self))]]]]);
  });
  assert.deepEqual(p.errors, []);
});

test("positivity: taking itself as an input through another type, or through a type defined with it, is refused", () => {
  const p = program((k) => {
    const box = k.type("box", ["a"], [["box", [["f", (_, [a]) => fnType(k, [k.tref(a)], k.tref(NUM))]]]]);
    k.type("bad", [], [["bad", [["inside", (self) => k.tref(box.def, k.tref(self))]]]]);
    // a type that only holds its param is fine to wrap yourself in
    const keep = k.type("keep", ["a"], [["keep", [["x", (_, [a]) => k.tref(a)]]]]);
    k.type("fine", [], [["fine", [["inside", (self) => k.tref(keep.def, k.tref(self))]]], ["end", []]]);
    // two types defined together: even holds an odd, odd takes an even
    const even = k.type("even", [], [["e", [["o", () => k.tref(NUM)]]], ["zero", []]]);
    const odd = k.type("odd", [], [["o", [["f", () => fnType(k, [k.tref(even.def)], k.tref(NUM))]]]]);
    (k.code.nodes[even.f["e.o"]] as { type: Id }).type = k.tref(odd.def);
  });
  const bad = p.errors.filter((m) => /can't take itself as an input/.test(m));
  assert.ok(bad.some((m) => /^bad /.test(m)), p.errors.join("\n"));
  assert.ok(!bad.some((m) => /^fine /.test(m)));
  assert.ok(bad.some((m) => /^odd /.test(m)), p.errors.join("\n"));
  assert.equal(bad.length, 2);
});

// ---------------------------------------------------------------- plain data

test("equal works on plain data, and not on functions however they're wrapped", () => {
  const ok = program((k) => {
    const main = k.def("main");
    k.define(main, k.thunk(() => k.call(S.print, k.call(S.show, k.call(S.count, k.thunk(() =>
      k.if(k.call(S.equal, k.list(k.lit(1), k.lit(2)), k.list(k.lit(1), k.lit(2))), k.lit(1), k.call(S.fail))))))));
    return main;
  });
  assert.deepEqual(ok.errors, []);
  assert.deepEqual(ok.run(), ["1"]);

  const viaWrapper = program((k) => {
    const same = k.def("same");
    k.define(same, k.fn(["x", "y"], (x, y) => k.call(S.equal, x, y)));
    const t = k.def("t");
    k.define(t, k.call(same, B.sqrt, B.sqrt));
  });
  assert.ok(viaWrapper.errors.some((m) => /plain data/.test(m)), viaWrapper.errors.join("\n"));
  assert.match(viaWrapper.type(viaWrapper.k.code.defs.find((d) => viaWrapper.names[d] === "same")!), /^\(a, a\) -> Bool$/);

  const inData = program((k) => {
    const t = k.def("t");
    k.define(t, k.call(S.equal, k.call(PAIR_V, k.lit(1), B.sqrt), k.call(PAIR_V, k.lit(1), B.sqrt)));
  });
  assert.ok(inData.errors.some((m) => /plain data/.test(m)), inData.errors.join("\n"));
});

test("a function can't be solved for: functions can't be guessed", () => {
  const p = program((k) => {
    const apply = k.def("apply");
    k.define(apply, k.fn(["f", "x"], (f, x) => k.call(f, x)));
    const [f] = params(k.code, apply);
    const g = k.def("g");
    k.define(g, k.call(S.all, k.thunk(() => k.solve(apply, { out: k.lit(4), [params(k.code, apply)[1]]: k.lit(2) }, { [f]: "f" }, (b) => k.call(b[f], k.lit(3))))));
  });
  assert.ok(p.errors.some((m) => /can't be solved for/.test(m)), p.errors.join("\n"));
});

// ---------------------------------------------------------------- derivative

test("derivative never throws: where a slope can't be read there is none", () => {
  const p = program((k) => {
    const pick = k.def("pick");
    // takes apart data built from x: the slope isn't read through data yet
    k.define(pick, k.fn(["x"], (x) => k.match(k.call(PAIR_V, x, x), [{ variant: PAIR_V, names: ["a", "b"], body: ([a, b]) => k.call(B.mul, a, b) }])));
    const kink = k.def("kink");
    k.define(kink, k.fn(["x"], (x) => k.if(k.call(S.less, x, k.lit(0)), k.call(B.neg, x), k.call(S.floor, x))));
    const main = k.def("main");
    const at = (f: Id, x: number) => orNone(k, () => k.call(S.show, k.call(k.call(S.derivative, f), k.lit(x))));
    k.define(main, k.thunk(() => k.seq(
      k.call(S.print, at(S.floor, 2.5)),
      k.call(S.print, at(pick, 3)),
      // piecewise: the left piece has a slope, the right one goes through floor
      k.call(S.print, at(kink, -1)),
      k.call(S.print, at(kink, 1)),
      k.call(S.print, at(B.sin, 0)),
    )));
    return main;
  });
  assert.deepEqual(p.errors, []);
  assert.deepEqual(p.run(), ["none", "none", "-1", "none", "1"]);
});

test("backwards, derivative and with fuel run forward once their function is known", () => {
  const p = program((k) => {
    const g = k.def("g");
    k.define(g, k.fn(["x"], (x) => k.call(S.fuel, k.lit(5), k.thunk(() => k.call(k.call(S.derivative, k.fn(["y"], (y) => k.call(B.mul, y, y))), x)))));
  });
  assert.deepEqual(p.errors, []);
  const g = p.code.defs.find((d) => p.names[d] === "g")!;
  const [x] = params(p.code, g);
  assert.deepEqual([...relate(p.code, g, { out: 6 })].map((a) => a.values[x]), [3]);
});
