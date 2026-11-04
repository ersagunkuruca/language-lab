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
import { makeRunner, runMain, toList, type Value } from "../src/lang/run.ts";
import { CONS, INT_OPS as I, LIST, NIL, PAIR_V, S, SHOW_ANY } from "../src/lang/std.ts";
import { LIBRARY } from "../src/lang/library.ts";
import { CHOICE, CONSOLE, DIVERGE, showType } from "../src/lang/types.ts";
import { B } from "../src/prelude.ts";

function program(build: (k: Lang) => Id | void, known?: Code) {
  const k = new Lang(known);
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

// Recursion on a list a function gives back (BACKLOG I84, Bounce's `bump
// pairs`): no piece of the input, but no longer than one, so the call
// still shrinks by length (spine.ts). One that gives back a list as long
// as the input, or longer, doesn't.
test("size-change: recursion on a list given back no longer, inside a pair, is total", () => {
  const defs: Record<string, Id> = {};
  const p = program((k) => {
    const def = (name: string, ps: string[], body: (...xs: Id[]) => Id) => { const d = k.def(name); defs[name] = d; k.define(d, k.fn(ps, body)); return d; };
    const split = (of: Id, body: (n: Id, rest: Id) => Id) => k.match(of, [{ variant: PAIR_V, names: ["n", "rest"], body: ([n, rest]) => body(n, rest) }]);
    // Rebuilds the list one cons per cons, counting: as long as xs.
    const passAlong = def("pass along", ["xs"], (xs) => k.match(xs, [
      { variant: NIL, names: [], body: () => k.call(PAIR_V, k.lit(0), k.x(NIL)) },
      { variant: CONS, names: ["h", "t"], body: ([h, t]) => split(k.call(defs["pass along"], t), (n, rest) => k.call(PAIR_V, n, k.call(CONS, h, rest))) },
    ]));
    const same = def("same", ["xs"], (xs) => k.call(PAIR_V, k.lit(0), xs));
    const longer = def("longer", ["xs"], (xs) => k.call(PAIR_V, k.lit(0), k.call(CONS, k.lit(1), xs)));
    const walk = (name: string, through: Id, onTail: boolean) => { def(name, ["xs"], (xs) => k.match(xs, [
      { variant: NIL, names: [], body: () => k.lit(0) },
      { variant: CONS, names: ["h", "t"], body: ([, t]) => split(k.call(through, onTail ? t : xs), (_, rest) => k.call(defs[name], rest)) },
    ])); };
    walk("walk", passAlong, true);
    walk("walk same", same, false);
    walk("walk longer", longer, true);
  });
  assert.deepEqual(p.errors, []);
  for (const d of ["pass along", "walk"]) assert.ok(!p.effects(defs[d]).includes(DIVERGE), `${d}: ${p.type(defs[d])}`);
  for (const d of ["walk same", "walk longer"]) assert.ok(p.effects(defs[d]).includes(DIVERGE), `${d}: ${p.type(defs[d])}`);
});

// Recursion through a function that calls what it is given on pieces of
// its other inputs (BACKLOG L146): `map(args, copy)` over a case's list
// field shrinks, as sheet's `show formula` does; map over a list holding
// the input itself, or a function applied to the input whole, doesn't.
test("size-change: recursion through map over a field's list is total", () => {
  const lib = (n: string) => Object.keys(LIBRARY.names).find((x) => LIBRARY.names[x] === n && LIBRARY.code.nodes[x]?.kind === "def")!;
  const map = lib("map");
  const defs: Record<string, Id> = {};
  const p = program((k) => {
    const expr = k.type("expr", [], [["num", [["x", () => k.tref(NUM)]]], ["node", [["args", (self) => k.tref(LIST, k.tref(self))]]]]);
    const def = (name: string, body: (self: Id, e: Id) => Id) => { const d = k.def(name); defs[name] = d; k.define(d, k.fn(["e"], (e) => k.match(e, [
      { variant: expr.v.num, names: ["x"], body: ([x]) => k.call(expr.v.num, x) },
      { variant: expr.v.node, names: ["args"], body: ([args]) => k.call(expr.v.node, body(d, args)) },
    ]))); };
    def("copy", (self, args) => k.call(map, args, self));
    def("copy each", (self, args) => k.call(map, args, k.fn(["a"], (a) => k.call(self, a))));
    const applyTo = k.def("apply to");
    k.define(applyTo, k.fn(["x", "f"], (x, f) => k.call(f, x)));
    // map over a list that holds the whole input, not a piece of it
    const d1 = k.def("again"); defs.again = d1;
    k.define(d1, k.fn(["e"], (e) => k.call(expr.v.node, k.call(map, k.list(e), d1))));
    // a function that is given the input whole
    const d2 = k.def("whole"); defs.whole = d2;
    k.define(d2, k.fn(["e"], (e) => k.call(applyTo, e, d2)));
  }, LIBRARY.code);
  assert.deepEqual(p.errors, []);
  for (const d of ["copy", "copy each"]) assert.ok(!p.effects(defs[d]).includes(DIVERGE), `${d}: ${p.type(defs[d])}`);
  for (const d of ["again", "whole"]) assert.ok(p.effects(defs[d]).includes(DIVERGE), `${d}: ${p.type(defs[d])}`);
});

// Bounded counting (BACKLOG L46): an Int moving towards a bound its guard
// compares it with ends; a Float64 count, a bound that moves, or one input
// counted towards two bounds stays Diverge.
test("bounded counting: an Int counted towards a bound it is compared with is total", () => {
  const defs: Record<string, Id> = {};
  const p = program((k) => {
    const def = (name: string, params: string[], body: (self: Id, ...ps: Id[]) => Id) => { const d = k.def(name); defs[name] = d; k.define(d, k.fn(params, (...ps) => body(d, ...ps))); };
    const lessI = (a: Id, b: Id) => k.call(I.less, a, b), plus = (a: Id, c: number) => k.call(I.add, a, k.int(c)), minus = (a: Id, c: number) => k.call(I.sub, a, k.int(c));
    // up to a literal, as raymarch's march: the else of 120 < steps
    def("up", ["steps", "x"], (self, s, x) => k.if(k.call(S.or, k.call(S.less, x, k.lit(0)), lessI(k.int(120), s)), x, k.call(self, plus(s, 1), k.call(B.add, x, k.lit(1)))));
    // up to a bound passed on unchanged
    def("up to n", ["i", "n"], (self, i, nn) => k.if(lessI(i, nn), k.call(self, plus(i, 2), nn), i));
    // down to 0
    def("down", ["i"], (self, i) => k.if(k.call(S.not, lessI(k.int(0), i)), i, k.call(self, minus(i, 1))));
    // the bound grows with the count: never ends
    def("chase", ["i", "n"], (self, i, nn) => k.if(lessI(i, nn), k.call(self, plus(i, 1), plus(nn, 1)), i));
    // up under one guard and down under another: 5, 6, 5, 6, …
    def("ping pong", ["i"], (self, i) => k.if(lessI(i, k.int(10)), k.call(self, plus(i, 1)), k.if(lessI(k.int(0), i), k.call(self, minus(i, 1)), i)));
    // a Float64 count can be NaN, which no comparison stops
    def("float count", ["i"], (self, i) => k.if(k.call(S.less, i, k.lit(10)), k.call(self, k.call(B.add, i, k.lit(1))), i));
    // counted without a guard
    def("unguarded", ["i"], (self, i) => k.call(self, plus(i, 1)));
  });
  assert.deepEqual(p.errors, []);
  for (const d of ["up", "up to n", "down"]) assert.ok(!p.effects(defs[d]).includes(DIVERGE), `${d}: ${p.type(defs[d])}`);
  for (const d of ["chase", "ping pong", "float count", "unguarded"]) assert.ok(p.effects(defs[d]).includes(DIVERGE), `${d}: ${p.type(defs[d])}`);
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

// A handler that parks its continuation in a field whose function type
// says only Diverge has a closed row itself: it does Diverge and nothing
// else. Its callers may still do more around the call (BACKLOG I36:
// Tumble's Chain.rest had to list all ten of a page handler's effects).
test("effects: a definition whose row is closed can be called where more happens", () => {
  let main = "", parked = "";
  const p = program((k) => {
    const Ask = k.effect("Ask", [["ask", [["n", () => k.tref(NUM)]], () => k.tref(NUM), "later"]]);
    const chain = k.type("chain", [], [["done", [["n", () => k.tref(NUM)]]], ["waiting", [["rest", (self) => k.tfun([k.tref(NUM)], k.tref(self), [DIVERGE])]]]]);
    parked = k.def("parked");
    k.define(parked, k.fn(["n"], (n) => k.handle(k.call(chain.v.done, k.call(Ask.op.ask, n)), [
      { variant: Ask.op.ask, names: ["n", "rest"], body: ([, rest]) => k.call(chain.v.waiting, rest) },
    ])));
    main = k.def("main");
    k.define(main, k.thunk(() => k.seq(k.call(S.print, k.lit("start")), k.call(parked, k.lit(2)))));
    return main;
  });
  assert.deepEqual(p.errors, []);
  assert.equal(p.type(parked), "(Float64) -[Diverge]-> chain");
  assert.deepEqual(p.effects(main).slice().sort(), [CONSOLE, DIVERGE].sort());
});

// ---------------------------------------------------------------- plain data

test("equal works on plain data, and not on functions however they're wrapped", () => {
  const ok = program((k) => {
    const main = k.def("main");
    k.define(main, k.thunk(() => k.call(S.print, k.call(SHOW_ANY, k.call(S.count, k.thunk(() =>
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
    // takes apart a record built from x: each part has its slope (x · x)
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
  assert.deepEqual(p.run(), ["none", "6", "-1", "none", "1"]);
});

test("derivative of a function written right there fails only where the function does", () => {
  const p = program((k) => {
    const square = k.def("square");
    k.define(square, k.fn(["x"], (x) => k.call(B.mul, x, x)));
    const kink = k.def("kink");
    k.define(kink, k.fn(["x"], (x) => k.if(k.call(S.less, x, k.lit(0)), k.call(B.neg, x), k.call(S.floor, x))));
    // smooth: a definition, a lambda holding y still, a builtin
    k.define(k.def("a"), k.fn(["x"], (x) => k.call(k.call(S.derivative, square), x)));
    k.define(k.def("b"), k.fn(["x", "y"], (x, y) => k.call(k.call(S.derivative, k.fn(["u"], (u) => k.call(B.mul, u, y))), x)));
    k.define(k.def("c"), k.fn(["x"], (x) => k.call(k.call(S.derivative, B.sin), x)));
    // no slope through floor, and a function value isn't known until it runs
    k.define(k.def("d"), k.fn(["x"], (x) => k.call(k.call(S.derivative, kink), x)));
    k.define(k.def("e"), k.fn(["f", "x"], (f, x) => k.call(k.call(S.derivative, f), x)));
    k.define(k.def("g"), k.fn(["f", "x"], (f, x) => k.call(k.call(S.derivative, k.fn(["u"], (u) => k.call(f, u))), x)));
  });
  assert.deepEqual(p.errors, []);
  const def = (n: string) => p.code.defs.find((d) => p.names[d] === n)!;
  for (const n of ["a", "b", "c"]) assert.deepEqual(p.effects(def(n)), [], n);
  for (const n of ["d", "e", "g"]) assert.ok(p.effects(def(n)).includes(CHOICE), n);
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

// ---------------------------------------------------------------- nested data

// A rose tree: each node has a list of children. size and depth are folds;
// the folded value of `children` is the list of the children's sizes.
function roseTree() {
  let size = "", depth = "", tree = "", node = "", sum = "", most = "";
  const p = program((k) => {
    const t = k.type("tree", [], [["node", [["value", () => k.tref(NUM)], ["children", (self) => k.tref("std.list", k.tref(self))]]]]);
    tree = t.def;
    node = t.v.node;
    const listFold = (name: string, f: (h: Id, r: Id) => Id) => {
      const d = k.def(name);
      k.define(d, k.fn(["xs"], (xs) => k.fold(xs, [
        { variant: NIL, names: [], body: () => k.lit(0) },
        { variant: CONS, names: ["h", "t"], results: [null, "r"], body: ([h], [, r]) => f(h, r!) },
      ])));
      return d;
    };
    sum = listFold("sum", (h, r) => k.call(B.add, h, r));
    most = listFold("most", (h, r) => k.if(k.call(S.less, h, r), r, h));
    size = k.def("size");
    k.define(size, k.fn(["t"], (x) => k.fold(x, [
      { variant: node, names: ["v", "cs"], results: [null, "sizes"], body: (_, [, sizes]) => k.call(B.add, k.lit(1), k.call(sum, sizes!)) },
    ])));
    depth = k.def("depth");
    k.define(depth, k.fn(["t"], (x) => k.fold(x, [
      { variant: node, names: ["v", "cs"], results: [null, "depths"], body: (_, [, ds]) => k.call(B.add, k.lit(1), k.call(most, ds!)) },
    ])));
    const leaf = (v: number) => k.call(node, k.lit(v), k.x(NIL));
    const main = k.def("main");
    k.define(main, k.thunk(() => k.let("t", k.call(node, k.lit(1), k.list(leaf(2), k.call(node, k.lit(3), k.list(leaf(4))))), (t) =>
      k.call(S.print, k.text(k.call(S.show, k.call(size, t)), k.lit(" "), k.call(S.show, k.call(depth, t)))))));
    return main;
  });
  return { ...p, size, depth, tree, node };
}

test("nested data: a rose tree folds, and the children's folded values are a list", () => {
  const p = roseTree();
  assert.deepEqual(p.errors, []);
  assert.equal(p.type(p.size), "(tree) -> Float64");
  assert.ok(!p.effects(p.size).includes(DIVERGE));
  const arm = Object.values(p.code.nodes).find((n) => n.kind === "arm" && n.variant === p.node && n.results[1] && p.names[n.results[1]] === "sizes") as { results: Id[] };
  assert.equal(showType(p.info.typeOf.get(arm.results[1])!, p.names), "List Float64");
  assert.deepEqual(p.run(), ["4 3"]);
});

test("nested data: a fold reaches no deeper than the data, and needs no JS stack for wide or deep trees", () => {
  const p = roseTree();
  const r = makeRunner(p.code, p.info, { print: () => {} });
  const leaf = (v: number) => ({ tag: p.node, fields: [v, toList([])] });
  const wide = { tag: p.node, fields: [0, toList(Array.from({ length: 100000 }, (_, i) => leaf(i)))] };
  let deep: Value = leaf(0);
  for (let i = 1; i < 100000; i++) deep = { tag: p.node, fields: [i, toList([deep])] };
  const at = (f: Id, v: Value) => [...r.call(r.value(f), v)][0];
  assert.equal(at(p.size, wide), 100001);
  assert.equal(at(p.depth, wide), 2);
  assert.equal(at(p.depth, deep), 100000);
});

test("nested data: a rose tree folds backwards too", () => {
  const p = roseTree();
  // trees of size 2: a node with one leaf child
  const [first] = relate(p.code, p.size, { out: 2 });
  const [t] = params(p.code, p.size);
  const shape = (x: unknown): string => {
    const d = x as { tag?: Id; fields?: unknown[] };
    if (!d || typeof d !== "object" || !("tag" in d)) return "_";
    if (d.tag === NIL) return "[]";
    if (d.tag === CONS) return `[${shape(d.fields![0])}${shape(d.fields![1]) === "[]" ? "" : "," + shape(d.fields![1])}]`;
    return `node(${shape(d.fields![1])})`;
  };
  assert.equal(shape(first.values[t]), "node([node([])])");
});

test("nested data: a container defined together with the type is refused, not looped on", () => {
  const p = program((k) => {
    const forest = k.def("forest");
    const t = k.type("t", [], [["node", [["kids", () => k.tref(forest)]]]]);
    const f = k.type("forest-body", [], [["none", []], ["some", [["head", () => k.tref(t.def)], ["rest", () => k.tref(forest)]]]]);
    k.code.nodes[forest] = { ...k.code.nodes[f.def], id: forest };
    const count = k.def("count");
    k.define(count, k.fn(["x"], (x) => k.fold(x, [{ variant: t.v.node, names: ["kids"], results: ["n"], body: () => k.lit(1) }])));
  });
  assert.ok(p.errors.some((m) => /can't be folded/.test(m)), p.errors.join("\n"));
});

test("a lazy stream maker: the message names the function in the field, and Diverge on the field takes it (L159)", () => {
  // `next` runs make and then the next of what it made: running it never
  // stops, so this one isn't guarded corecursion (L16, below).
  const build = (diverge: boolean) => (k: Lang) => {
    const Stream = k.type("Stream", [], [["node", [["next", (self) => k.tfun([], k.tref(self), diverge ? [DIVERGE] : [])]]]]);
    const make = k.def("make");
    k.define(make, k.fn(["u"], (u) => k.call(Stream.v.node, k.thunk(() => k.match(k.call(make, u), [{ variant: Stream.v.node, names: ["n"], body: ([n]) => k.call(n) }])))));
  };
  const closed = program(build(false));
  assert.deepEqual(closed.errors, ["the function in node's next calls make, which might not finish, but next's type, () -> Stream, wants one that surely finishes: add Diverge to it, () -[Diverge]-> Stream"]);
  const open = program(build(true));
  assert.deepEqual(open.errors, []);
});

// Guarded corecursion (BACKLOG L16): a producer whose every call into
// itself is what a stream's lazy field gives back makes one value and
// returns, so it has no Diverge, nor does its field. Running the whole
// stream is the consumer's recursion, which still has it.
test("guarded corecursion: a stream's producer surely finishes, its consumer to the end doesn't", () => {
  const defs: Record<string, Id> = {};
  const p = program((k) => {
    const Stream = k.type("Stream", [], [["term", [["head", () => k.tref(NUM)], ["rest", (self) => k.tfun([], k.tref(self))]]]]);
    for (const name of ["from", "twos", "ping", "pong", "doubled", "last", "skip"]) defs[name] = k.def(name);
    const def = (name: string, ps: string[], body: (...xs: Id[]) => Id) => k.define(defs[name], k.fn(ps, body));
    const term = (h: Id, rest: () => Id) => k.call(Stream.v.term, h, k.thunk(rest));
    def("from", ["n"], (n) => term(n, () => k.call(defs.from, k.call(B.add, n, k.lit(1)))));
    // Two at a time, and a mutual pair: still guarded.
    def("twos", ["n"], (n) => term(n, () => term(n, () => k.call(defs.twos, n))));
    def("ping", ["n"], (n) => term(n, () => k.call(defs.pong, n)));
    def("pong", ["n"], (n) => term(k.call(B.neg, n), () => k.call(defs.ping, n)));
    // A producer that reads its input's rest inside the field: guarded too.
    def("doubled", ["s"], (s) => k.match(s, [{ variant: Stream.v.term, names: ["h", "r"], body: ([h, r]) => term(k.call(B.mul, h, k.lit(2)), () => k.call(defs.doubled, k.call(r))) }]));
    // The last term: runs the stream to its end, which never comes.
    def("last", ["s"], (s) => k.match(s, [{ variant: Stream.v.term, names: ["h", "r"], body: ([, r]) => k.call(defs.last, k.call(r)) }]));
    // The field runs what the group made: not guarded.
    def("skip", ["s"], (s) => term(k.lit(0), () => k.match(k.call(defs.skip, s), [{ variant: Stream.v.term, names: ["h", "r"], body: ([, r]) => k.call(r) }])));
  });
  for (const d of ["from", "twos", "ping", "pong", "doubled"]) assert.ok(!p.effects(defs[d]).includes(DIVERGE), `${d}: ${p.type(defs[d])}`);
  assert.ok(p.effects(defs.last).includes(DIVERGE), p.type(defs.last));
  assert.ok(p.errors.some((m) => /node's rest|term's rest/.test(m)), p.errors.join("\n"));
});
