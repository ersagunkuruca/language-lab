// The example programs, built once and saved as code.json + names.json
// (examples/build-lang.ts). From then on the JSON is the source of truth.

import type { Id } from "../model.ts";
import { B } from "../prelude.ts";
import { Lang } from "./dsl.ts";
import { CONS, FIRST, NIL, PAIR_V, S, SECOND } from "./std.ts";
import { R } from "../relational.ts";

// Loops without loops: list helpers every program here can use. `each` and
// `map` recurse on the tail they took apart, so the checker sees they end;
// `keep` (filter) is a choice plus `all`.
function library(k: Lang) {
  const each = k.def("for each");
  k.define(each, k.fn(["list", "action"], (xs, f) => k.match(xs, [
    { variant: NIL, names: [], body: () => k.unitValue },
    { variant: CONS, names: ["item", "rest"], body: ([h, t]) => k.seq(k.call(f, h), k.call(each, t, f)) },
  ])));

  const map = k.def("map");
  k.define(map, k.fn(["list", "change"], (xs, f) => k.match(xs, [
    { variant: NIL, names: [], body: () => NIL },
    { variant: CONS, names: ["item", "rest"], body: ([h, t]) => k.call(CONS, k.call(f, h), k.call(map, t, f)) },
  ])));

  const keep = k.def("keep");
  k.define(keep, k.fn(["list", "test"], (xs, p) => k.call(S.all, k.thunk(() =>
    k.let("item", k.call(S.oneOf, xs), (x) => k.if(k.call(p, x), x, k.call(S.fail)))))));

  // "1 2 3": a fold whose cons case looks at the rest to decide on a space.
  const showNumbers = k.def("show numbers");
  k.define(showNumbers, k.fn(["numbers"], (xs) => k.fold(xs, [
    { variant: NIL, names: [], body: () => k.lit("") },
    {
      variant: CONS, names: ["n", "rest"], results: [null, "rest shown"],
      body: ([n, rest], [, shown]) => k.match(rest, [{ variant: NIL, names: [], body: () => k.call(S.show, n) }],
        k.text(k.call(S.show, n), k.lit(" "), shown!)),
    },
  ])));
  return { each, map, keep, showNumbers };
}

// ------------------------------------------------------------------ queens
// Eight queens with the Choice effect. No search code: each row picks a
// column with `one of`, an unsafe pick fails, and the handler decides what
// "the answer" means (the first, all of them, how many).

export function queens() {
  const k = new Lang();
  const lib = library(k);

  const safe = k.def("safe");
  k.define(safe, k.fn(["column", "placed"], (col, placed) => k.call(
    k.fold(placed, [
      { variant: NIL, names: [], body: () => k.fn(["distance"], () => k.true) },
      {
        variant: CONS, names: ["queen", "others"], results: [null, "others safe"],
        body: ([q], [, othersOk]) => k.fn(["distance"], (d) => k.call(S.and,
          k.call(S.and, k.call(S.not, k.call(S.equal, q, col)), k.call(S.not, k.call(S.equal, k.call(S.abs, k.call(B.sub, q, col)), d))),
          k.call(othersOk!, k.call(B.add, d, k.lit(1))))),
      },
    ]),
    k.lit(1))));

  const place = k.def("queens");
  k.define(place, k.fn(["size"], (n) => k.fold(k.call(S.range, n), [
    { variant: NIL, names: [], body: () => NIL },
    {
      variant: CONS, names: ["row", "rows"], results: [null, "board"],
      body: (_, [, board]) => k.let("column", k.call(S.oneOf, k.call(S.range, n)), (col) =>
        k.if(k.call(safe, col, board!), k.call(CONS, col, board!), k.call(S.fail))),
    },
  ])));

  const main = k.def("main");
  k.define(main, k.thunk(() => k.seq(
    k.call(S.print, k.text(k.lit("first solution for 8: "), k.call(lib.showNumbers, k.call(S.first, k.thunk(() => k.call(place, k.lit(8))), k.thunk(() => NIL))))),
    k.call(S.print, k.text(k.lit("solutions for 8: "), k.call(S.show, k.call(S.count, k.thunk(() => k.call(place, k.lit(8))))))),
    k.call(S.print, k.lit("all solutions for 6:")),
    k.call(lib.each, k.call(S.all, k.thunk(() => k.call(place, k.lit(6)))), k.fn(["board"], (b) => k.call(S.print, k.text(k.lit("  "), k.call(lib.showNumbers, b))))),
    k.call(S.print, k.text(k.lit("even numbers below 10: "), k.call(lib.showNumbers,
      k.call(lib.keep, k.call(S.range, k.lit(10)), k.fn(["n"], (x) => k.call(S.equal, k.call(S.mod, x, k.lit(2)), k.lit(0))))))),
  )));
  return { code: k.code, names: k.names, defs: { ...lib, safe, queens: place, main } };
}

// ---------------------------------------------------------------- calculus
// Calculus on real functions. A function is a graph of nodes, not a black
// box, so `derivative` reads it and builds the derivative as another
// function (src/lang/derive.ts). The samples are ordinary definitions;
// their derivatives (cubic′, …) are generated next to them by
// examples/build-lang.ts and are ordinary definitions too. Finding where a
// function is zero is running it backwards from 0. Compare `algebra`, which
// does the same with expressions as a data type.

export function calculus() {
  const k = new Lang();
  const lib = library(k);
  const fn1 = (name: string, body: (x: Id) => Id) => { const d = k.def(name); k.define(d, k.fn(["x"], body)); return d; };
  const [add, sub, mul, div] = [B.add, B.sub, B.mul, B.div];

  const cubic = fn1("cubic", (x) => k.call(sub, k.call(sub, k.call(mul, k.call(mul, x, x), x), x), k.lit(1)));
  const wave = fn1("wave", (x) => k.call(sub, k.call(B.cos, x), x));
  // Piecewise: the derivative is piecewise too, arm by arm.
  const kink = fn1("kink", (x) => k.if(k.call(S.less, x, k.lit(0)), k.call(B.neg, x), k.call(mul, x, x)));
  // A let (a dot on the wire): the derivative lets the value and its slope.
  const bump = fn1("bump", (x) => k.let("s", k.call(B.sin, x), (s) => k.call(mul, s, s)));
  // Horner's rule as a fold over the coefficients, lowest first.
  const polynomial = k.def("polynomial");
  k.define(polynomial, k.fn(["coefficients", "x"], (cs, x) => k.fold(cs, [
    { variant: NIL, names: [], body: () => k.lit(0) },
    { variant: CONS, names: ["c", "rest"], results: [null, "higher"], body: ([c], [, r]) => k.call(add, c, k.call(mul, x, r!)) },
  ])));
  const parabola = fn1("parabola", (x) => k.call(polynomial, k.list(k.lit(-2), k.lit(0), k.lit(1)), x));
  // No value at 0, and so no slope there either.
  const sinc = fn1("sinc", (x) => k.if(k.call(S.equal, x, k.lit(0)), k.call(S.fail), k.call(div, k.call(B.sin, x), x)));

  // Newton's method on real functions. Nothing gets smaller, so it carries
  // Diverge; `with fuel` turns that into Choice.
  const newton = k.def("newton");
  k.define(newton, k.fn(["f", "slope", "guess"], (f, df, x) =>
    k.let("next", k.call(sub, x, k.call(div, k.call(f, x), k.call(df, x))), (next) =>
      k.if(k.call(S.less, k.call(S.abs, k.call(sub, next, x)), k.lit(1e-12)), next, k.call(newton, f, df, next)))));
  const root = k.def("root near");
  k.define(root, k.fn(["f", "guess"], (f, g) => k.call(S.fuel, k.lit(100), k.thunk(() =>
    k.call(newton, f, k.call(S.derivative, f), g)))));

  // Every zero at once: the function run backwards from 0. The solver
  // can't isolate x in x·x·x − x − 1, so it scans for sign changes and
  // finds every root in range, where Newton finds one.
  const zeros = (name: string, f: Id) => { const d = k.def(name); const lam = k.code.nodes[(k.code.nodes[f] as { body: Id }).body] as { params: Id[] };
    k.define(d, k.call(S.all, k.thunk(() => k.solve(f, { out: k.lit(0) }, { [lam.params[0]]: "x" }, ({ [lam.params[0]]: x }) => x)))); return d; };
  const cubicZeros = zeros("zeros of cubic", cubic);
  const parabolaZeros = zeros("zeros of x² − 2", fn1("x² − 2", (x) => k.call(sub, k.call(mul, x, x), k.lit(2))));

  const samples = k.def("samples");
  const entry = (name: string, f: Id) => k.call(PAIR_V, k.lit(name), f);
  k.define(samples, k.list(entry("cubic", cubic), entry("wave", wave), entry("kink", kink), entry("bump", bump), entry("parabola", parabola), entry("sinc", sinc)));

  const orElse = (f: () => Id, text: string) => k.call(S.first, k.thunk(f), k.thunk(() => k.lit(text)));
  const main = k.def("main");
  k.define(main, k.thunk(() => k.seq(
    k.call(lib.each, samples, k.fn(["sample"], (p) => k.let("f", k.call(SECOND, p), (f) => k.call(S.print, k.text(
      k.call(FIRST, p),
      k.lit(": f(2) = "), orElse(() => k.call(S.show, k.call(f, k.lit(2))), "none"),
      k.lit(", f′(2) = "), orElse(() => k.call(S.show, k.call(k.call(S.derivative, f), k.lit(2))), "none"),
      k.lit(", root near 1: "), orElse(() => k.call(S.show, k.call(root, f, k.lit(1))), "none found"),
    ))))),
    k.call(S.print, k.text(k.lit("zeros of cubic: "), k.call(lib.showNumbers, cubicZeros))),
    k.call(S.print, k.text(k.lit("zeros of x² − 2: "), k.call(lib.showNumbers, parabolaZeros))),
  )));
  return { code: k.code, names: k.names, defs: { ...lib, cubic, wave, kink, bump, polynomial, parabola, sinc, newton, root, samples, main } };
}

// ---------------------------------------------------------------- algebra
// A tiny computer algebra system: expressions as data, and evaluation,
// differentiation, simplification and printing as folds over them, so all
// of them are total. Newton's method is the one thing that might not end,
// and its type says so until `with fuel` turns that into a failure.
// `calculus` does the same on real functions, without a second copy of
// arithmetic as a data type; this one stays as the test bed for data types.

export function algebra() {
  const k = new Lang();
  const lib = library(k);
  const num = (_: string, __: string[]) => k.tref("type.number");
  const E = k.type("expression", [], [
    ["number", [["value", num]]],
    ["x", []],
    ["sum", [["left", (s) => k.tref(s)], ["right", (s) => k.tref(s)]]],
    ["difference", [["left", (s) => k.tref(s)], ["right", (s) => k.tref(s)]]],
    ["product", [["left", (s) => k.tref(s)], ["right", (s) => k.tref(s)]]],
    ["negative", [["of", (s) => k.tref(s)]]],
    ["quotient", [["top", (s) => k.tref(s)], ["bottom", (s) => k.tref(s)]]],
    ["sine", [["of", (s) => k.tref(s)]]],
    ["cosine", [["of", (s) => k.tref(s)]]],
  ]);
  const V = E.v;
  const n = (x: number) => k.call(V.number, k.lit(x));
  const two = (a: string, b: string) => ({ names: [a, b], results: [`${a}′`, `${b}′`] as (string | null)[] });
  const one = (a: string) => ({ names: [a], results: [`${a}′`] as (string | null)[] });

  // Evaluate at a point. Division by zero is a failure (Choice), not NaN.
  const evaluate = k.def("evaluate");
  k.define(evaluate, k.fn(["expression", "at"], (e, at) => k.fold(e, [
    { variant: V.number, names: ["value"], body: ([v]) => v },
    { variant: V.x, names: [], body: () => at },
    { variant: V.sum, ...two("l", "r"), body: (_, [a, b]) => k.call(B.add, a!, b!) },
    { variant: V.difference, ...two("l", "r"), body: (_, [a, b]) => k.call(B.sub, a!, b!) },
    { variant: V.product, ...two("l", "r"), body: (_, [a, b]) => k.call(B.mul, a!, b!) },
    { variant: V.negative, ...one("a"), body: (_, [a]) => k.call(B.neg, a!) },
    {
      variant: V.quotient, ...two("t", "b"),
      body: (_, [a, b]) => k.if(k.call(S.equal, b!, k.lit(0)), k.call(S.fail), k.call(B.div, a!, b!)),
    },
    { variant: V.sine, ...one("a"), body: (_, [a]) => k.call(B.sin, a!) },
    { variant: V.cosine, ...one("a"), body: (_, [a]) => k.call(B.cos, a!) },
  ])));

  // The derivative needs both each part and its derivative: the fold binds
  // both (a paramorphism), so the product and chain rules are direct.
  const derivative = k.def("derivative");
  k.define(derivative, k.fn(["expression"], (e) => k.fold(e, [
    { variant: V.number, names: ["value"], body: () => n(0) },
    { variant: V.x, names: [], body: () => n(1) },
    { variant: V.sum, ...two("u", "v"), body: (_, [du, dv]) => k.call(V.sum, du!, dv!) },
    { variant: V.difference, ...two("u", "v"), body: (_, [du, dv]) => k.call(V.difference, du!, dv!) },
    {
      variant: V.product, ...two("u", "v"),
      body: ([u, v], [du, dv]) => k.call(V.sum, k.call(V.product, du!, v), k.call(V.product, u, dv!)),
    },
    { variant: V.negative, ...one("u"), body: (_, [du]) => k.call(V.negative, du!) },
    {
      variant: V.quotient, ...two("u", "v"),
      body: ([u, v], [du, dv]) => k.call(V.quotient,
        k.call(V.difference, k.call(V.product, du!, v), k.call(V.product, u, dv!)),
        k.call(V.product, v, v)),
    },
    { variant: V.sine, ...one("u"), body: ([u], [du]) => k.call(V.product, k.call(V.cosine, u), du!) },
    { variant: V.cosine, ...one("u"), body: ([u], [du]) => k.call(V.negative, k.call(V.product, k.call(V.sine, u), du!)) },
  ])));

  // "The number inside, if it is one": a match that fails otherwise. With
  // `first`, that's pattern matching by choice: try the constant case, else
  // fall back.
  const constant = k.def("constant");
  k.define(constant, k.fn(["expression"], (e) => k.match(e, [{ variant: V.number, names: ["value"], body: ([v]) => v }], k.call(S.fail))));
  const is = (e: Id, x: number) => k.call(S.equal, e, n(x));
  const tryConst = (f: () => Id, otherwise: () => Id) => k.call(S.first, k.thunk(f), k.thunk(otherwise));

  const simplify = k.def("simplify");
  k.define(simplify, k.fn(["expression"], (e) => k.fold(e, [
    { variant: V.number, names: ["value"], body: ([v]) => k.call(V.number, v) },
    { variant: V.x, names: [], body: () => V.x },
    {
      variant: V.sum, ...two("l", "r"),
      body: (_, [a, b]) => tryConst(() => k.call(V.number, k.call(B.add, k.call(constant, a!), k.call(constant, b!))),
        () => k.if(is(a!, 0), b!, k.if(is(b!, 0), a!, k.call(V.sum, a!, b!)))),
    },
    {
      variant: V.difference, ...two("l", "r"),
      body: (_, [a, b]) => tryConst(() => k.call(V.number, k.call(B.sub, k.call(constant, a!), k.call(constant, b!))),
        () => k.if(is(b!, 0), a!, k.if(is(a!, 0), k.call(V.negative, b!), k.call(V.difference, a!, b!)))),
    },
    {
      variant: V.product, ...two("l", "r"),
      body: (_, [a, b]) => tryConst(() => k.call(V.number, k.call(B.mul, k.call(constant, a!), k.call(constant, b!))),
        () => k.if(k.call(S.or, is(a!, 0), is(b!, 0)), n(0), k.if(is(a!, 1), b!, k.if(is(b!, 1), a!, k.call(V.product, a!, b!))))),
    },
    {
      variant: V.negative, ...one("a"),
      body: (_, [a]) => tryConst(() => k.call(V.number, k.call(B.neg, k.call(constant, a!))),
        () => k.match(a!, [{ variant: V.negative, names: ["inner"], body: ([i]) => i }], k.call(V.negative, a!))),
    },
    { variant: V.quotient, ...two("t", "b"), body: (_, [a, b]) => k.if(is(b!, 1), a!, k.call(V.quotient, a!, b!)) },
    { variant: V.sine, ...one("a"), body: (_, [a]) => k.call(V.sine, a!) },
    { variant: V.cosine, ...one("a"), body: (_, [a]) => k.call(V.cosine, a!) },
  ])));

  // Printing with the fewest parentheses: each case returns its text and how
  // tightly it binds, and wraps a part only when that part binds less.
  const wrap = k.def("parenthesize");
  k.define(wrap, k.fn(["shown", "needed"], (p, min) => k.if(
    k.call(S.less, k.call(SECOND, p), min),
    k.text(k.lit("("), k.call(FIRST, p), k.lit(")")),
    k.call(FIRST, p))));
  const shown = (text: Id, prec: number) => k.call(PAIR_V, text, k.lit(prec));
  const display = k.def("display");
  k.define(display, k.fn(["expression"], (e) => k.call(FIRST, k.fold(e, [
    {
      variant: V.number, names: ["value"],
      body: ([v]) => k.if(k.call(S.less, v, k.lit(0)), shown(k.text(k.lit("−"), k.call(S.show, k.call(B.neg, v))), 3), shown(k.call(S.show, v), 9)),
    },
    { variant: V.x, names: [], body: () => shown(k.lit("x"), 9) },
    { variant: V.sum, ...two("l", "r"), body: (_, [a, b]) => shown(k.text(k.call(wrap, a!, k.lit(1)), k.lit(" + "), k.call(wrap, b!, k.lit(1))), 1) },
    { variant: V.difference, ...two("l", "r"), body: (_, [a, b]) => shown(k.text(k.call(wrap, a!, k.lit(1)), k.lit(" − "), k.call(wrap, b!, k.lit(2))), 1) },
    { variant: V.product, ...two("l", "r"), body: (_, [a, b]) => shown(k.text(k.call(wrap, a!, k.lit(2)), k.lit("·"), k.call(wrap, b!, k.lit(3))), 2) },
    { variant: V.negative, ...one("a"), body: (_, [a]) => shown(k.text(k.lit("−"), k.call(wrap, a!, k.lit(3))), 3) },
    { variant: V.quotient, ...two("t", "b"), body: (_, [a, b]) => shown(k.text(k.call(wrap, a!, k.lit(2)), k.lit(" / "), k.call(wrap, b!, k.lit(3))), 2) },
    { variant: V.sine, ...one("a"), body: (_, [a]) => shown(k.text(k.lit("sin("), k.call(FIRST, a!), k.lit(")")), 9) },
    { variant: V.cosine, ...one("a"), body: (_, [a]) => shown(k.text(k.lit("cos("), k.call(FIRST, a!), k.lit(")")), 9) },
  ]))));

  // General recursion: nothing gets smaller, so the checker gives it Diverge.
  const newton = k.def("newton");
  k.define(newton, k.fn(["f", "slope", "guess"], (f, df, x) =>
    k.let("next", k.call(B.sub, x, k.call(B.div, k.call(evaluate, f, x), k.call(evaluate, df, x))), (next) =>
      k.if(k.call(S.less, k.call(S.abs, k.call(B.sub, next, x)), k.lit(1e-12)), next, k.call(newton, f, df, next)))));

  // ... and `with fuel` turns "might not end" into "might fail".
  const root = k.def("root near");
  k.define(root, k.fn(["f", "guess"], (f, g) => k.call(S.fuel, k.lit(100), k.thunk(() =>
    k.call(newton, f, k.call(simplify, k.call(derivative, f)), g)))));

  const samples = k.def("samples");
  const X = () => k.x(V.x);
  k.define(samples, k.list(
    k.call(V.difference, k.call(V.product, X(), X()), n(2)),
    k.call(V.difference, k.call(V.cosine, X()), X()),
    k.call(V.difference, k.call(V.difference, k.call(V.product, k.call(V.product, X(), X()), X()), X()), n(1)),
    k.call(V.quotient, n(1), X()),
    k.call(V.quotient, k.call(V.sine, X()), k.call(V.difference, X(), X())),
  ));

  const orElse = (f: () => Id, text: string) => k.call(S.first, k.thunk(f), k.thunk(() => k.lit(text)));
  const main = k.def("main");
  k.define(main, k.thunk(() => k.call(lib.each, samples, k.fn(["f"], (f) => k.seq(
    k.call(S.print, k.text(k.lit("f(x)  = "), k.call(display, f))),
    k.call(S.print, k.text(k.lit("f′(x) = "), k.call(display, k.call(simplify, k.call(derivative, f))))),
    k.call(S.print, k.text(k.lit("f(2)  = "), orElse(() => k.call(S.show, k.call(evaluate, f, k.lit(2))), "undefined"))),
    k.call(S.print, k.text(k.lit("root near 1: "), orElse(() => k.call(S.show, k.call(root, f, k.lit(1))), "none found"))),
    k.call(S.print, k.lit("")),
  )))));

  return { code: k.code, names: k.names, type: E, defs: { ...lib, evaluate, derivative, constant, simplify, parenthesize: wrap, display, newton, root, samples, main } };
}

// ---------------------------------------------------------------- relations
// Relations as functions with a direction picked at the use site. Whether a
// direction is pure or a Choice is inferred from the solver's plan.

export function relations() {
  const k = new Lang();
  const lib = library(k);
  const pair = (a: Id, b: Id) => k.call(PAIR_V, a, b);
  const showPair = (p: Id) => k.text(k.call(S.show, k.call(FIRST, p)), k.lit(", "), k.call(S.show, k.call(SECOND, p)));

  // Linear: one answer, so no Choice in the type.
  const split = k.def("split");
  k.define(split, k.fn(["sum", "difference"], (c, d) => k.solve(R.sumDiff, { c, d }, { a: "a", b: "b" }, ({ a, b }) => pair(a, b))));

  // Also linear, through the variadic sum atom: the missing addend.
  const missing = k.def("missing addend");
  k.define(missing, k.fn(["known", "total"], (a, t) => k.solve(R.sum, { a, total: t }, { b: "b" }, ({ b }) => b)));

  // Polar has two branches (and k·2π): Choice.
  const toPolar = k.def("to polar");
  k.define(toPolar, k.fn(["x", "y"], (x, y) => k.solve(R.polar, { x, y }, { r: "length", θ: "angle" }, ({ r, θ }) => pair(r, θ))));

  // An ordinary function, read backwards: x · x = y has two answers.
  const square = k.def("square");
  const sq = k.fn(["x"], (x) => k.call(B.mul, x, x));
  k.define(square, sq);
  const param = (k.code.nodes[sq] as { params: Id[] }).params[0];
  const roots = k.def("square roots");
  k.define(roots, k.fn(["y"], (y) => k.call(S.all, k.thunk(() => k.solve(square, { out: y }, { [param]: "x" }, ({ [param]: x }) => x)))));

  const main = k.def("main");
  k.define(main, k.thunk(() => k.seq(
    k.call(S.print, k.text(k.lit("split(10, 4) = "), showPair(k.call(split, k.lit(10), k.lit(4))))),
    k.call(S.print, k.text(k.lit("missing addend(3, 10) = "), k.call(S.show, k.call(missing, k.lit(3), k.lit(10))))),
    k.call(S.print, k.text(k.lit("to polar(0, 2), canonical = "), showPair(k.call(S.first, k.thunk(() => k.call(toPolar, k.lit(0), k.lit(2))), k.thunk(() => pair(k.lit(0), k.lit(0))))))),
    k.call(S.print, k.text(k.lit("square roots(9) = "), k.call(lib.showNumbers, k.call(roots, k.lit(9))))),
    k.call(S.print, k.text(k.lit("square roots(−1) = ["), k.call(lib.showNumbers, k.call(roots, k.lit(-1))), k.lit("]"))),
  )));
  return { code: k.code, names: k.names, defs: { split, missing, toPolar, square, roots, main } };
}

// ---------------------------------------------------------------- backwards
// Everyday functions run backwards, through cases, text and folds (the
// relational interpreter, src/lang/relate.ts). Each one is an ordinary
// function written forwards; the solve node picks the direction.

export function backwards() {
  const k = new Lang();
  const lib = library(k);
  const square = k.def("square");
  k.define(square, k.fn(["x"], (x) => k.call(B.mul, x, x)));
  const params = (def: Id) => (k.code.nodes[(k.code.nodes[def] as { body: Id }).body] as { params: Id[] }).params;
  const backwards = (fn: Id, given: Record<string, Id>, want: string, name: string) =>
    k.solve(fn, given, { [want]: name }, ({ [want]: x }) => x);

  // An if, run backwards: a choice over its two arms.
  const magnitude = k.def("magnitude");
  k.define(magnitude, k.fn(["x"], (x) => k.if(k.call(S.less, x, k.lit(0)), k.call(B.neg, x), x)));
  const unmagnitude = k.def("magnitudes to");
  k.define(unmagnitude, k.fn(["size"], (y) => k.call(S.all, k.thunk(() => backwards(magnitude, { out: y }, params(magnitude)[0], "x")))));

  // Text: join text with one side known strips it off; with neither known,
  // every way to cut the text in two.
  const greet = k.def("greet");
  k.define(greet, k.fn(["name"], (who) => k.text(k.lit("hello, "), who)));
  const greeted = k.def("who was greeted");
  k.define(greeted, k.fn(["greeting"], (g) => k.call(S.first, k.thunk(() => backwards(greet, { out: g }, params(greet)[0], "name")), k.thunk(() => k.lit("nobody")))));
  const cuts = k.def("cuts");
  k.define(cuts, k.fn(["text"], (t) => k.call(S.all, k.thunk(() =>
    k.solve(S.concat, { out: t }, { 0: "front", 1: "back" }, ({ 0: a, 1: b }) => k.text(a, k.lit("|"), b))))));

  // A fold, run backwards, is an unfold: the printer becomes a parser.
  // Unfolding may not end in general, so it carries Diverge until fuel
  // bounds it.
  const read = k.def("read numbers");
  k.define(read, k.fn(["text"], (t) => k.call(S.fuel, k.lit(10000), k.thunk(() => backwards(lib.showNumbers, { out: t }, params(lib.showNumbers)[0], "numbers")))));

  // map, run backwards with its function known: every list whose squares
  // these are.
  const unsquare = k.def("square roots of each");
  k.define(unsquare, k.fn(["squares"], (ys) => k.call(S.all, k.thunk(() => k.call(S.fuel, k.lit(10000), k.thunk(() =>
    k.solve(lib.map, { [params(lib.map)[1]]: k.x(square), out: ys }, { [params(lib.map)[0]]: "list" }, ({ [params(lib.map)[0]]: xs }) => xs)))))));

  // atan2 is a primitive with inverses: given the angle and x, y is on the
  // ray at that angle (or nowhere, for the opposite ray).
  const angle = k.def("angle");
  k.define(angle, k.fn(["x", "y"], (x, y) => k.call(B.atan2, y, x)));
  const onRay = k.def("height on the ray");
  k.define(onRay, k.fn(["angle", "x"], (a, x) => backwards(angle, { out: a, [params(angle)[0]]: x }, params(angle)[1], "y")));

  // Words, one per item, for printing lists of texts.
  const words = k.def("words");
  k.define(words, k.fn(["texts"], (xs) => k.fold(xs, [
    { variant: NIL, names: [], body: () => k.lit("") },
    {
      variant: CONS, names: ["w", "rest"], results: [null, "rest shown"],
      body: ([w, rest], [, shown]) => k.match(rest, [{ variant: NIL, names: [], body: () => w }], k.text(w, k.lit(" "), shown!)),
    },
  ])));
  const bracket = (xs: Id) => k.text(k.lit("["), k.call(lib.showNumbers, xs), k.lit("]"));

  const main = k.def("main");
  k.define(main, k.thunk(() => k.seq(
    k.call(S.print, k.text(k.lit("magnitudes to(5) = "), k.call(lib.showNumbers, k.call(unmagnitude, k.lit(5))))),
    k.call(S.print, k.text(k.lit("who was greeted(\"hello, Ada\") = "), k.call(greeted, k.lit("hello, Ada")))),
    k.call(S.print, k.text(k.lit("who was greeted(\"goodbye\") = "), k.call(greeted, k.lit("goodbye")))),
    k.call(S.print, k.text(k.lit("cuts(\"abc\") = "), k.call(words, k.call(cuts, k.lit("abc"))))),
    k.call(S.print, k.text(k.lit("read numbers(\"10 20 30\") = "), k.call(S.first, k.thunk(() => bracket(k.call(read, k.lit("10 20 30")))), k.thunk(() => k.lit("unreadable"))))),
    k.call(S.print, k.text(k.lit("read numbers(\"10  20\") = "), k.call(S.first, k.thunk(() => bracket(k.call(read, k.lit("10  20")))), k.thunk(() => k.lit("unreadable"))))),
    k.call(S.print, k.text(k.lit("square roots of each([4, 9]) = "), k.call(words, k.call(lib.map, k.call(unsquare, k.list(k.lit(4), k.lit(9))), k.fn(["xs"], (xs) => bracket(xs)))))),
    k.call(S.print, k.text(k.lit("height on the ray(3π/4, −2) = "), k.call(S.first, k.thunk(() => k.call(S.show, k.call(onRay, k.lit(3 * Math.PI / 4), k.lit(-2)))), k.thunk(() => k.lit("none"))))),
    k.call(S.print, k.text(k.lit("height on the ray(3π/4, 2) = "), k.call(S.first, k.thunk(() => k.call(S.show, k.call(onRay, k.lit(3 * Math.PI / 4), k.lit(2)))), k.thunk(() => k.lit("none"))))),
  )));
  return { code: k.code, names: k.names, defs: { square, magnitude, unmagnitude, greet, greeted, cuts, read, unsquare, angle, onRay, words, main } };
}
