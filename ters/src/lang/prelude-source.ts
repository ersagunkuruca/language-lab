// The prelude, the first module: list helpers every program can use. It is
// written here with the DSL once, then published (library/build.ts writes
// library/prelude.json). Publishing names each definition by its content,
// so building it again gives the same ids, byte for byte: regenerating a
// published module can't lose anything, unlike regenerating a draft.

import { merge, type Id, type NodeOf } from "../model.ts";
import { B, prelude } from "../prelude.ts";
import { Lang } from "./dsl.ts";
import { makeModule, publish, type Module } from "./modules.ts";
import { library } from "./programs.ts";
import { ABORT_OP, ARITH, COMPARE, COMPLEX_V, CONS, FALSE, INT_OPS, MAP_V, NIL, NONE, ORDER_V, OUTCOME_V, PAIR_V, RATIO, S, SET_V, SOME, TEXT_OPS, TIMES_V, ALGEBRA_V, TRIG_V, TRIG_POLAR, TRIG_UNPOLAR, TRIG_ASIN, TRIG_ACOS, TRUE, TICKET_V, AWAIT_OP, START_TIMER_OP, BRANCH_V, DUAL_V, FIXED_V, MAT_V, ARITHMETIC_V, TRIG_OPS, ORDERED_V, EXTENDED_V, ALGEBRAIC_OPS, CHECK_OP, std } from "./std.ts";

export function buildPrelude(): Module {
  const k = new Lang();
  // The four every example used to carry its own copy of.
  const { each, map, keep, showNumbers } = library(k);

  const length = k.def("length");
  k.define(length, k.fn(["list"], (xs) => k.fold(xs, [
    { variant: NIL, names: [], body: () => k.int(0) },
    { variant: CONS, names: ["item", "rest"], results: [null, "length of rest"], body: (_, [, r]) => k.call(INT_OPS.add, r!, k.int(1)) },
  ])));

  const sum = k.def("sum");
  k.define(sum, k.fn(["numbers"], (xs) => k.fold(xs, [
    { variant: NIL, names: [], body: () => k.lit(0) },
    // + for every number type, as + itself is (BACKLOG L136).
    { variant: CONS, names: ["n", "rest"], results: [null, "sum of rest"], body: ([n], [, r]) => k.call(ARITH.add, n, r!) },
  ])));

  const append = k.def("append");
  k.define(append, k.fn(["front", "back"], (front, back) => k.fold(front, [
    { variant: NIL, names: [], body: () => back },
    { variant: CONS, names: ["item", "rest"], results: [null, "rest and back"], body: ([item], [, r]) => k.call(CONS, item, r!) },
  ])));

  // A helper: published with the module, used by reverse, not offered.
  const onto = k.def("reverse onto");
  k.define(onto, k.fn(["list", "onto"], (xs, acc) => k.match(xs, [
    { variant: NIL, names: [], body: () => acc },
    { variant: CONS, names: ["item", "rest"], body: ([item, rest]) => k.call(onto, rest, k.call(CONS, item, acc)) },
  ])));
  const reverse = k.def("reverse");
  k.define(reverse, k.fn(["list"], (xs) => k.call(onto, xs, NIL)));

  // solve names a definition, so running a function value backwards goes
  // through one that calls it: inverse(f, y) is the x with f(x) = y.
  const applied = k.def("applied");
  k.define(applied, k.fn(["f", "x"], (f, x) => k.call(f, x)));
  const [fPort, xPort] = (k.code.nodes[(k.code.nodes[applied] as NodeOf<"def">).body!] as NodeOf<"lambda">).params;
  const inverse = k.def("inverse");
  k.define(inverse, k.fn(["f", "y"], (f, y) => k.solve(applied, { [fPort]: f, out: y }, { [xPort]: "x" }, ({ [xPort]: x }) => x)));

  // Go to another space, act there, come back: f⁻¹ ∘ g ∘ f, the f⁻¹ from
  // running f backwards (NOTES.md, conjugation; examples/conjugate).
  const conjugate = k.def("conjugate");
  k.define(conjugate, k.fn(["f", "g"], (f, g) => k.fn(["x"], (x) => k.call(inverse, f, k.call(g, k.call(f, x))))));

  // A function takes all its inputs at once (model.ts: a lambda's params
  // are a list), so a function of one input that gives back a function is
  // something you ask for (BACKLOG L87, Ersagun 2026-10-26: "non curried
  // is easier to reason about"). Curry and uncurry are named after Haskell
  // Curry, the standard names (Haskell's Prelude has both).
  const curry = k.def("curry");
  k.define(curry, k.fn(["f"], (f) => k.fn(["a"], (a) => k.fn(["b"], (b) => k.call(f, a, b)))));
  const uncurry = k.def("uncurry");
  k.define(uncurry, k.fn(["f"], (f) => k.fn(["a", "b"], (a, b) => k.call(k.call(f, a), b))));
  const partially = k.def("partially");
  k.define(partially, k.fn(["f", "a"], (f, a) => k.fn(["b"], (b) => k.call(f, a, b))));
  const flip = k.def("flip");
  k.define(flip, k.fn(["f"], (f) => k.fn(["a", "b"], (a, b) => k.call(f, b, a))));

  // The other comparisons, over the one generic `<` (and Text's over
  // `comes before`), so they work on every ordered number type, run
  // backwards and differentiate with no rules of their own; and the
  // smaller and larger of two numbers, which shaders compile to min and
  // max.
  const compare = (name: string, less: Id, f: (less: (a: Id, b: Id) => Id, a: Id, b: Id) => Id) => {
    const d = k.def(name);
    k.define(d, k.fn(["a", "b"], (a, b) => f((x, y) => k.call(less, x, y), a, b)));
    return d;
  };
  const atMost = compare("at most", ARITH.less, (lt, a, b) => k.call(S.not, lt(b, a)));
  const moreThan = compare("more than", ARITH.less, (lt, a, b) => lt(b, a));
  const atLeast = compare("at least", ARITH.less, (lt, a, b) => k.call(S.not, lt(a, b)));
  const smaller = compare("smaller", ARITH.less, (lt, a, b) => k.if(lt(a, b), a, b));
  const larger = compare("larger", ARITH.less, (lt, a, b) => k.if(lt(a, b), b, a));
  // The same five over Float64's own <, as they were published before the
  // one generic < reached them: kept, hidden, so a program saved before
  // still opens and runs (its references are by hash). Not offered.
  const numberOnly = ["at most", "more than", "at least", "smaller", "larger"].map((name, i) => compare(name, S.less, [
    (lt: (a: Id, b: Id) => Id, a: Id, b: Id) => k.call(S.not, lt(b, a)), (lt: (a: Id, b: Id) => Id, a: Id, b: Id) => lt(b, a),
    (lt: (a: Id, b: Id) => Id, a: Id, b: Id) => k.call(S.not, lt(a, b)), (lt: (a: Id, b: Id) => Id, a: Id, b: Id) => k.if(lt(a, b), a, b),
    (lt: (a: Id, b: Id) => Id, a: Id, b: Id) => k.if(lt(a, b), b, a),
  ][i]));
  const notAfter = compare("not after", TEXT_OPS.less, (lt, a, b) => k.call(S.not, lt(b, a)));
  const after = compare("comes after", TEXT_OPS.less, (lt, a, b) => lt(b, a));
  const notBefore = compare("not before", TEXT_OPS.less, (lt, a, b) => k.call(S.not, lt(a, b)));

  // Extended a (FLOAT-VALUES-2026-11-01.md §3, BACKLOG L125d): a number type
  // with −∞ and +∞ around it, for any ordered number type. The extended
  // reals' rules (∞ + 1 = ∞, −2 · ∞ = −∞), and no answer where they have
  // none (∞ − ∞, 0 · ∞), so there is no NaN here either. Its order is
  // total; minimum of no numbers is +∞, its identity.
  const X = EXTENDED_V;
  const ext = (v: Id, minus: () => Id, finite: (x: Id) => Id, plus: () => Id, name = "value") => k.match(v, [
    { variant: X.minus, names: [], body: minus },
    { variant: X.finite, names: [name], body: ([x]) => finite(x) },
    { variant: X.plus, names: [], body: plus },
  ]);
  const fin = (x: Id) => k.call(X.finite, x);
  const nothing = () => k.call(S.fail);
  const extDef = (name: string, params: string[], body: (...xs: Id[]) => Id) => { const d = k.def(name); k.define(d, k.fn(params, body)); return d; };
  const extLess = extDef("extended less", ["a", "b"], (a, b) => ext(a,
    () => ext(b, () => FALSE, () => TRUE, () => TRUE),
    (x) => ext(b, () => FALSE, (y) => k.call(ARITH.less, x, y), () => TRUE, "other"),
    () => FALSE));
  const extAdd = extDef("extended add", ["a", "b"], (a, b) => ext(a,
    () => ext(b, () => X.minus, () => X.minus, nothing),
    (x) => ext(b, () => X.minus, (y) => fin(k.call(ARITH.add, x, y)), () => X.plus, "other"),
    () => ext(b, nothing, () => X.plus, () => X.plus)));
  const extNeg = extDef("extended negate", ["a"], (a) => ext(a, () => X.plus, (x) => fin(k.call(ARITH.neg, x)), () => X.minus));
  const extSub = extDef("extended subtract", ["a", "b"], (a, b) => k.call(extAdd, a, k.call(extNeg, b)));
  // ±∞ times a finite x: no answer when x is 0, else ∞ with the signs' product.
  const infTimes = (x: Id, plus: boolean) => k.if(k.equal(x, k.lit(0)), k.call(S.fail),
    k.if(k.call(ARITH.less, k.lit(0), x), plus ? X.plus : X.minus, plus ? X.minus : X.plus));
  const extMul = extDef("extended multiply", ["a", "b"], (a, b) => ext(a,
    () => ext(b, () => X.plus, (y) => infTimes(y, false), () => X.minus, "other"),
    (x) => ext(b, () => infTimes(x, false), (y) => fin(k.call(ARITH.mul, x, y)), () => infTimes(x, true), "other"),
    () => ext(b, () => X.minus, (y) => infTimes(y, true), () => X.plus, "other")));
  const extreme = (name: string, empty: Id, keepLeft: (a: Id, b: Id) => Id) => extDef(name, ["numbers"], (xs) => k.fold(xs, [
    { variant: NIL, names: [], body: () => empty },
    { variant: CONS, names: ["x", "rest"], results: [null, `the rest's ${name}`], body: ([x], [, r]) =>
      k.let("x, extended", fin(x), (fx) => k.if(keepLeft(fx, r!), fx, r!)) },
  ]));
  const minimum = extreme("minimum", X.plus, (a, b) => k.call(extLess, a, b));
  const maximum = extreme("maximum", X.minus, (a, b) => k.call(extLess, b, a));

  // Fractions: exact, kept in lowest terms by `lowest terms` (std.ts), so
  // each has one spelling. The arithmetic is what the one generic `+ − ·
  // <` resolves to at Rational (arith.ts), so it isn't offered on its own;
  // `fraction` makes one, `÷` divides, `show fraction` prints 3/4.
  const pair = (v: Id, f: (a: Id, b: Id) => Id) => k.match(v, [{ variant: PAIR_V, names: ["top", "bottom"], body: ([a, b]) => f(a, b) }]);
  const ratio = (v: Id, f: (top: Id, bottom: Id) => Id, names = ["top", "bottom"]) => k.match(v, [{ variant: RATIO, names, body: ([a, b]) => f(a, b) }]);
  const reduced = (top: Id, bottom: Id) => pair(k.call(INT_OPS.lowestTerms, top, bottom), (a, b) => k.call(RATIO, a, b));
  const i = { add: (a: Id, b: Id) => k.call(INT_OPS.add, a, b), sub: (a: Id, b: Id) => k.call(INT_OPS.sub, a, b), mul: (a: Id, b: Id) => k.call(INT_OPS.mul, a, b) };
  const two = (name: string, f: (p: Id, q: Id, r: Id, t: Id) => Id) => {
    const d = k.def(name);
    k.define(d, k.fn(["a", "b"], (a, b) => ratio(a, (p, q) => ratio(b, (r, t) => f(p, q, r, t), ["top₂", "bottom₂"]))));
    return d;
  };
  const fraction = k.def("fraction");
  k.define(fraction, k.fn(["top", "bottom"], (top, bottom) => k.if(k.call(S.equal, bottom, k.int(0)), k.call(S.fail), reduced(top, bottom))));
  const whole = k.def("as fraction");
  k.define(whole, k.fn(["n"], (n) => k.call(RATIO, n, k.int(1))));
  const addF = two("add fractions", (p, q, r, t) => reduced(i.add(i.mul(p, t), i.mul(r, q)), i.mul(q, t)));
  const subF = two("subtract fractions", (p, q, r, t) => reduced(i.sub(i.mul(p, t), i.mul(r, q)), i.mul(q, t)));
  const mulF = two("multiply fractions", (p, q, r, t) => reduced(i.mul(p, r), i.mul(q, t)));
  const lessF = two("fraction less than", (p, q, r, t) => k.call(INT_OPS.less, i.mul(p, t), i.mul(r, q)));
  const negF = k.def("negate fraction");
  k.define(negF, k.fn(["a"], (a) => ratio(a, (p, q) => k.call(RATIO, k.call(INT_OPS.neg, p), q))));
  const divF = two("divide fractions", (p, q, r, t) => k.if(k.call(S.equal, r, k.int(0)), k.call(S.fail), reduced(i.mul(p, t), i.mul(q, r))));
  const showF = k.def("show fraction");
  k.define(showF, k.fn(["a"], (a) => ratio(a, (p, q) => k.if(k.call(S.equal, q, k.int(1)), k.call(INT_OPS.show, p), k.call(S.concat, k.call(INT_OPS.show, p), k.call(S.concat, k.lit("/"), k.call(INT_OPS.show, q)))))));
  const toNum = k.def("fraction as float64");
  k.define(toNum, k.fn(["a"], (a) => ratio(a, (p, q) => k.call(B.div, k.call(INT_OPS.toNumber, p), k.call(INT_OPS.toNumber, q)))));

  // Complex numbers: a record of two Float64s (std.ts), re + im·i. + − ·
  // and −x at Complex are these (arith.ts), so they aren't offered on
  // their own; · is (a + bi)(c + di) = (ac − bd) + (ad + bc)i.
  const cx = (v: Id, f: (re: Id, im: Id) => Id, names = ["re", "im"]) => k.match(v, [{ variant: COMPLEX_V, names, body: ([a, b]) => f(a, b) }]);
  const n = { add: (a: Id, b: Id) => k.call(B.add, a, b), sub: (a: Id, b: Id) => k.call(B.sub, a, b), mul: (a: Id, b: Id) => k.call(B.mul, a, b), div: (a: Id, b: Id) => k.call(B.div, a, b) };
  const twoC = (name: string, f: (a: Id, b: Id, c: Id, d: Id) => Id) => {
    const d = k.def(name);
    k.define(d, k.fn(["z", "w"], (z, w) => cx(z, (a, b) => cx(w, (c, e) => f(a, b, c, e), ["re₂", "im₂"]))));
    return d;
  };
  const C = (re: Id, im: Id) => k.call(COMPLEX_V, re, im);
  const addC = twoC("add complex", (a, b, c, d) => C(n.add(a, c), n.add(b, d)));
  const subC = twoC("subtract complex", (a, b, c, d) => C(n.sub(a, c), n.sub(b, d)));
  const mulC = twoC("multiply complex", (a, b, c, d) => C(n.sub(n.mul(a, c), n.mul(b, d)), n.add(n.mul(a, d), n.mul(b, c))));
  const negC = k.def("negate complex");
  k.define(negC, k.fn(["z"], (z) => cx(z, (a, b) => C(k.call(B.neg, a), k.call(B.neg, b)))));
  const asC = k.def("as complex");
  k.define(asC, k.fn(["x"], (x) => C(x, k.lit(0))));
  const unitI = k.def("i");
  k.define(unitI, C(k.lit(0), k.lit(1)));
  const conjC = k.def("complex conjugate");
  k.define(conjC, k.fn(["z"], (z) => cx(z, (a, b) => C(a, k.call(B.neg, b)))));
  const modulus = k.def("modulus");
  k.define(modulus, k.fn(["z"], (z) => cx(z, (a, b) => k.call(B.sqrt, n.add(n.mul(a, a), n.mul(b, b))))));
  const angle = k.def("angle of");
  k.define(angle, k.fn(["z"], (z) => cx(z, (a, b) => k.call(B.atan2, b, a))));
  const polar = k.def("from polar");
  k.define(polar, k.fn(["size", "angle"], (r, t) => C(n.mul(r, k.call(B.cos, t)), n.mul(r, k.call(B.sin, t)))));
  const divC = twoC("divide complex", (a, b, c, d) => k.let("c² + d²", n.add(n.mul(c, c), n.mul(d, d)), (m) =>
    k.if(k.call(S.equal, m, k.lit(0)), k.call(S.fail), C(n.div(n.add(n.mul(a, c), n.mul(b, d)), m), n.div(n.sub(n.mul(b, c), n.mul(a, d)), m)))));
  const expC = k.def("complex exp");
  k.define(expC, k.fn(["z"], (z) => cx(z, (a, b) => k.let("eᵃ", k.call(B.exp, a), (e) => C(n.mul(e, k.call(B.cos, b)), n.mul(e, k.call(B.sin, b)))))));
  // What Float64 has no answer for, on Complex (BACKLOG L127): principal
  // values, each branch cut's points taken from above (counter-clockwise),
  // as C99's csqrt, clog, cpow, casin and cacos give for a +0 imaginary
  // part, so √−4 is 2i, log(−1) is iπ and asin(2) is π/2 + 1.317i. asin
  // and acos pick, of the two logs w and 1/w that give them, the one whose
  // input is the larger, so nothing cancels (Kahan, "Branch cuts for
  // complex elementary functions", 1987, on why that matters).
  const zero = () => C(k.lit(0), k.lit(0));
  const csqrt = k.def("complex sqrt");
  k.define(csqrt, k.fn(["z"], (z) => cx(z, (a, b) => k.let("r", k.call(modulus, z), (r) => {
    const half = (x: Id) => k.call(B.sqrt, k.call(larger, n.div(x, k.lit(2)), k.lit(0)));
    return k.let("im", half(n.sub(r, a)), (im) => C(half(n.add(r, a)), k.if(k.call(S.less, b, k.lit(0)), k.call(B.neg, im), im)));
  }))));
  const clog = k.def("complex log");
  k.define(clog, k.fn(["z"], (z) => cx(z, (a, b) => C(k.call(B.log, k.call(modulus, z)), k.call(B.atan2, b, a)))));
  const cpow = k.def("complex power");
  k.define(cpow, k.fn(["z", "w"], (z, w) => k.if(k.call(S.equal, z, zero()),
    cx(w, (c) => k.if(k.call(S.less, k.lit(0), c), zero(), k.call(S.fail)), ["re₂", "im₂"]),
    k.call(expC, k.call(mulC, w, k.call(clog, z))))));
  // −i · log(w), from w and its reciprocal's sum: the larger one's log
  // (its input is at least 1 away from 0, so there is always an answer).
  const minusILog = (w: Id, v: Id) => k.let("up", w, (up) => k.let("down", v, (down) => k.let("log", k.call(S.first,
    k.thunk(() => k.if(k.call(S.less, k.call(modulus, up), k.call(modulus, down)), k.call(negC, k.call(clog, down)), k.call(clog, up))),
    k.thunk(zero)), (l) => cx(l, (p, q) => C(q, k.call(B.neg, p)), ["p", "q"]))));
  // √(1 − z²), from above on the cut: for a real z above 1, −i√(z² − 1).
  const rootOneMinus = (z: Id, a: Id, b: Id) => k.let("s", k.call(csqrt, k.call(subC, C(k.lit(1), k.lit(0)), k.call(mulC, z, z))), (s) =>
    k.if(k.and(k.call(S.equal, b, k.lit(0)), k.call(S.less, k.lit(0), a)), k.call(conjC, s), s));
  const casin = k.def("complex asin");
  k.define(casin, k.fn(["z"], (z) => cx(z, (a, b) => k.let("s", rootOneMinus(z, a, b), (s) =>
    k.let("iz", C(k.call(B.neg, b), a), (iz) => minusILog(k.call(addC, s, iz), k.call(subC, s, iz)))))));
  const cacos = k.def("complex acos");
  k.define(cacos, k.fn(["z"], (z) => cx(z, (a, b) => k.let("s", rootOneMinus(z, a, b), (s) =>
    k.let("is", cx(s, (c, d) => C(k.call(B.neg, d), c), ["re₂", "im₂"]), (is) => minusILog(k.call(addC, z, is), k.call(subC, z, is)))))));
  const showC = k.def("show complex");
  k.define(showC, k.fn(["z"], (z) => cx(z, (a, b) => k.call(S.concat, k.call(S.show, a), k.call(S.concat,
    k.if(k.call(S.less, b, k.lit(0)), k.lit(" − "), k.lit(" + ")), k.call(S.concat, k.call(S.show, k.call(S.abs, b)), k.lit("i")))))));

  // An algebra's product from its multiplication table (ALGEBRA-TABLES.md):
  // a and b are records of Float64s, each line says what two basis
  // elements multiply to, and the product is the sum over the lines of
  // (a's part along the left one) · (b's part along the right one) · what
  // they give. The part along a basis element is the parts multiplied
  // pairwise and added, so the basis must be the records with one part 1.
  // This is the algebra's structure constants, the textbook construction.
  const along = (x: Id, e: Id) => k.call(S.total, k.call(S.zipParts, B.mul, x, e));
  const tableProduct = k.def("table product");
  k.define(tableProduct, k.fn(["table", "a", "b"], (table, a, b) => k.fold(table, [
    { variant: NIL, names: [], body: () => k.call(S.mapParts, k.fn(["part"], () => k.lit(0)), a) },
    { variant: CONS, names: ["line", "rest"], results: [null, "the rest's sum"], body: ([line], [, rest]) => k.match(line, [
      { variant: TIMES_V, names: ["left", "right", "gives"], body: ([e, f, g]) => k.let("weight", n.mul(along(a, e), along(b, f)), (w) =>
        k.call(S.zipParts, B.add, k.call(S.mapParts, k.fn(["part"], (x) => n.mul(w, x)), g), rest!)) },
    ]) },
  ])));
  const complexTable = k.def("complex table");
  k.define(complexTable, k.list(...([[1, 0, 1, 0, 1, 0], [1, 0, 0, 1, 0, 1], [0, 1, 1, 0, 0, 1], [0, 1, 0, 1, -1, 0]] as const).map(([a, b, c, d, e, f]) =>
    k.call(TIMES_V, C(k.lit(a), k.lit(b)), C(k.lit(c), k.lit(d)), C(k.lit(e), k.lit(f))))));

  // Trig at Float64 (INTERFACES.md, L40f): its builtins. Found by its type
  // when a use of sin needs Float64's, so not offered.
  // Ways (WAYS.md, BACKLOG L96): sin and cos from each other, so an
  // implementation of Trig may give one and leave the other `by its ways`.
  // The pair is a cycle; the compiler follows it only from a field the
  // implementation gives.
  const way = (name: string, field: Id, body: () => Id) => { const d = k.def(name); k.define(d, body()); (k.code.nodes[d] as NodeOf<"def">).way = field; return d; };
  const cosBySin = way("cos by sin", TRIG_OPS.cos, () => k.fn(["x"], (x) => k.call(TRIG_OPS.sin, k.call(ARITH.add, x, k.lit(Math.PI / 2)))));
  const sinByCos = way("sin by cos", TRIG_OPS.sin, () => k.fn(["x"], (x) => k.call(TRIG_OPS.cos, k.call(ARITH.sub, x, k.lit(Math.PI / 2)))));
  // Polar (POLAR.md, L97c): Trig's field with results, (length, angle) →
  // x, y. A type gives it, or sin and cos and gets it by their way; sin and
  // cos come from it in turn, each reading one of its results.
  const polarBy = way("polar by sincos", TRIG_POLAR, () => k.fn(["length", "angle", "x", "y"], (r, t, x, y) =>
    k.and(k.equal(x, k.call(ARITH.mul, r, k.call(TRIG_OPS.cos, t))), k.equal(y, k.call(ARITH.mul, r, k.call(TRIG_OPS.sin, t))))));
  k.results(polarBy, "x", "y");
  const sinByPolar = way("sin by polar", TRIG_OPS.sin, () => k.fn(["angle"], (t) => k.solve(TRIG_POLAR, { 0: k.lit(1), 1: t, out: k.true }, { 3: "y" }, ({ 3: y }) => y)));
  const cosByPolar = way("cos by polar", TRIG_OPS.cos, () => k.fn(["angle"], (t) => k.solve(TRIG_POLAR, { 0: k.lit(1), 1: t, out: k.true }, { 2: "x" }, ({ 2: x }) => x)));
  const polarF = k.def("float64 polar");
  k.define(polarF, k.fn(["length", "angle", "x", "y"], (r, t, x, y) =>
    k.and(k.equal(x, k.call(B.mul, r, k.call(B.cos, t))), k.equal(y, k.call(B.mul, r, k.call(B.sin, t))))));
  k.results(polarF, "x", "y");
  // Unpolar (L97c2), polar's other direction: atan2 and the length.
  const unpolarF = k.def("float64 unpolar");
  k.define(unpolarF, k.fn(["length", "angle", "x", "y"], (r, t, x, y) =>
    k.and(k.equal(r, k.call(B.sqrt, k.call(B.add, k.call(B.mul, x, x), k.call(B.mul, y, y)))), k.equal(t, k.call(B.atan2, y, x)))));
  k.results(unpolarF, "length", "angle");
  // asin and acos (L97c3) read the angle off unpolar: asin s is the angle
  // of (√(1 − s²), s), acos c of (c, √(1 − c²)). A type with a square root
  // of its own gives them with it; the ways take √x as e^(½ log x), from
  // Trig's own exp and log, for any type that has them.
  const onUnpolar = (x: Id, y: Id) => k.solve(TRIG_UNPOLAR, { 2: x, 3: y, out: k.true }, { 1: "angle" }, ({ 1: t }) => t);
  const rest = (v: Id) => k.call(ARITH.sub, k.lit(1), k.call(ARITH.mul, v, v));
  const root = (v: Id) => k.call(TRIG_OPS.exp, k.call(ARITH.mul, k.lit(0.5), k.call(TRIG_OPS.log, v)));
  const asinBy = way("asin by unpolar", TRIG_ASIN, () => k.fn(["s"], (sv) => onUnpolar(root(rest(sv)), sv)));
  const acosBy = way("acos by unpolar", TRIG_ACOS, () => k.fn(["c"], (cv) => onUnpolar(cv, root(rest(cv)))));
  const asinF = k.def("float64 asin");
  k.define(asinF, k.fn(["s"], (sv) => onUnpolar(k.call(B.sqrt, k.call(B.sub, k.lit(1), k.call(B.mul, sv, sv))), sv)));
  const acosF = k.def("float64 acos");
  k.define(acosF, k.fn(["c"], (cv) => onUnpolar(cv, k.call(B.sqrt, k.call(B.sub, k.lit(1), k.call(B.mul, cv, cv))))));
  const trigF = k.def("trig at float64");
  k.define(trigF, k.call(TRIG_V, ...[B.sin, B.cos, B.tan, B.exp, B.log, polarF, unpolarF, asinF, acosF].map((b) => k.x(b))));

  // Complex laws (POLAR.md L97e), tests in the language (T7): each performs
  // Check, so `lab test` and test/prelude-laws.test.ts run them on small
  // complex numbers. The first is the prelude's own from polar against
  // modulus and angle of; the second is Trig's polar and unpolar fields,
  // one direction undoing the other.
  const expect = (holds: Id, what: string) => k.call(CHECK_OP, holds, k.lit(what));
  const lawFromPolar = k.def("from polar undoes modulus and angle");
  k.define(lawFromPolar, k.fn(["z"], (z) => expect(k.equal(k.call(polar, k.call(modulus, z), k.call(angle, z)), z), "from polar(modulus z, angle of z) = z")));
  const lawPolar = k.def("polar undoes unpolar");
  k.define(lawPolar, k.fn(["z"], (z) => cx(z, (a, b) =>
    k.solve(TRIG_UNPOLAR, { 2: a, 3: b, out: k.true }, { 0: "length", 1: "angle" }, ({ 0: r, 1: t }) =>
      k.solve(TRIG_POLAR, { 0: r, 1: t, out: k.true }, { 2: "x", 3: "y" }, ({ 2: x, 3: y }) =>
        expect(k.equal(C(x, y), z), "polar(unpolar(x, y)) = (x, y)"))))));
  const laws = [lawFromPolar, lawPolar];

  // Dual numbers (INTERFACES.md step 3): value + slope·ε with ε² = 0, so
  // a function given dual(x, 1) gives its value and its slope at x.
  // + − · −x at Dual are these (arith.ts); · is the product rule,
  // (a + a′ε)(b + b′ε) = ab + (ab′ + a′b)ε. Trig is the chain rule. The
  // textbook construction (W. K. Clifford, 1873; forward-mode automatic
  // differentiation, Wengert 1964).
  const du = (v: Id, f: (a: Id, a1: Id) => Id, names = ["value", "slope"]) => k.match(v, [{ variant: DUAL_V, names, body: ([a, b]) => f(a, b) }]);
  const D = (a: Id, b: Id) => k.call(DUAL_V, a, b);
  const twoD = (name: string, f: (a: Id, a1: Id, b: Id, b1: Id) => Id) => {
    const d = k.def(name);
    k.define(d, k.fn(["x", "y"], (x, y) => du(x, (a, a1) => du(y, (b, b1) => f(a, a1, b, b1), ["value₂", "slope₂"]))));
    return d;
  };
  const oneD = (name: string, f: (a: Id, a1: Id) => Id) => {
    const d = k.def(name);
    k.define(d, k.fn(["x"], (x) => du(x, f)));
    return d;
  };
  const addD = twoD("add duals", (a, a1, b, b1) => D(n.add(a, b), n.add(a1, b1)));
  const subD = twoD("subtract duals", (a, a1, b, b1) => D(n.sub(a, b), n.sub(a1, b1)));
  const mulD = twoD("multiply duals", (a, a1, b, b1) => D(n.mul(a, b), n.add(n.mul(a, b1), n.mul(a1, b))));
  const negD = oneD("negate dual", (a, a1) => D(k.call(B.neg, a), k.call(B.neg, a1)));
  const divD = twoD("divide duals", (a, a1, b, b1) => k.if(k.call(S.equal, b, k.lit(0)), k.call(S.fail),
    D(n.div(a, b), n.div(n.sub(n.mul(a1, b), n.mul(a, b1)), n.mul(b, b)))));
  const sinD = oneD("dual sin", (a, a1) => D(k.call(B.sin, a), n.mul(k.call(B.cos, a), a1)));
  const cosD = oneD("dual cos", (a, a1) => D(k.call(B.cos, a), k.call(B.neg, n.mul(k.call(B.sin, a), a1))));
  // tan′ = 1 + tan², which needs no division (cos is never exactly 0 at a Float64).
  const tanD = oneD("dual tan", (a, a1) => k.let("tan", k.call(B.tan, a), (t) => D(t, n.mul(a1, n.add(k.lit(1), n.mul(t, t))))));
  const expD = oneD("dual exp", (a, a1) => k.let("eᵃ", k.call(B.exp, a), (e) => D(e, n.mul(e, a1))));
  const logD = oneD("dual log", (a, a1) => D(k.call(B.log, a), n.div(a1, a)));
  // Unpolar by the chain rule: for r = √(x² + y²), r′ = (x·x′ + y·y′)/r,
  // and atan2(y, x)′ = (x·y′ − y·x′)/r².
  const unpolarD = k.def("dual unpolar");
  const xy = (x: Id, y: Id, f: (a: Id, a1: Id, b: Id, b1: Id) => Id) => du(x, (a, a1) => du(y, (b, b1) => f(a, a1, b, b1), ["y value", "y slope"]), ["x value", "x slope"]);
  const sq = (a: Id, b: Id) => n.add(n.mul(a, a), n.mul(b, b));
  // At the origin the slopes are taken as 0, as atan2(0, 0) is taken as 0.
  k.define(unpolarD, k.fn(["length", "angle", "x", "y"], (r, t, x, y) => k.and(
    k.equal(r, xy(x, y, (a, a1, b, b1) => k.let("r", k.call(B.sqrt, sq(a, b)), (rr) => D(rr, k.if(k.call(S.equal, rr, k.lit(0)), k.lit(0), n.div(n.add(n.mul(a, a1), n.mul(b, b1)), rr)))))),
    k.equal(t, xy(x, y, (a, a1, b, b1) => k.let("r²", sq(a, b), (r2) => D(k.call(B.atan2, b, a), k.if(k.call(S.equal, r2, k.lit(0)), k.lit(0), n.div(n.sub(n.mul(a, b1), n.mul(b, a1)), r2)))))))));
  k.results(unpolarD, "length", "angle");
  const trigD = k.def("trig at dual");
  k.define(trigD, k.call(TRIG_V, ...[sinD, cosD, tanD, expD, logD].map((d) => k.x(d)), k.x(S.byItsWays), k.x(unpolarD), k.x(S.byItsWays), k.x(S.byItsWays)));
  const slopeAt = k.def("slope by duals");
  k.define(slopeAt, k.fn(["f", "x"], (f, x) => du(k.call(f, D(x, k.lit(1))), (_, a1) => a1)));
  const dualTable = k.def("dual table");
  k.define(dualTable, k.list(...([[1, 0, 1, 0, 1, 0], [1, 0, 0, 1, 0, 1], [0, 1, 1, 0, 0, 1]] as const).map(([a, b, c, d, e, f]) =>
    k.call(TIMES_V, D(k.lit(a), k.lit(b)), D(k.lit(c), k.lit(d)), D(k.lit(e), k.lit(f))))));
  const showD = oneD("show dual", (a, a1) => k.call(S.concat, k.call(S.show, a), k.call(S.concat,
    k.if(k.call(S.less, a1, k.lit(0)), k.lit(" − "), k.lit(" + ")), k.call(S.concat, k.call(S.show, k.call(S.abs, a1)), k.lit("ε")))));

  // Fixed (FIXED-POINT.md, BACKLOG L89): an Int counting steps of 2⁻³². + −
  // and −x are the Int's own; a · b is the steps' product shifted down 32,
  // rounded towards −∞, the same on every machine; < is the Int's. Doom's
  // fixed_t (16.16, id Software, 1993) is the classic one.
  const fx = (v: Id, f: (s: Id) => Id, name = "steps") => k.match(v, [{ variant: FIXED_V, names: [name], body: ([s]) => f(s) }]);
  const F = (s: Id) => k.call(FIXED_V, s);
  const twoX = (name: string, f: (a: Id, b: Id) => Id) => {
    const d = k.def(name);
    k.define(d, k.fn(["x", "y"], (x, y) => fx(x, (a) => fx(y, (b) => f(a, b), "steps₂"))));
    return d;
  };
  const addX = twoX("add fixed", (a, b) => F(k.call(INT_OPS.add, a, b)));
  const subX = twoX("subtract fixed", (a, b) => F(k.call(INT_OPS.sub, a, b)));
  const mulX = twoX("multiply fixed", (a, b) => F(k.call(INT_OPS.shiftDown, k.call(INT_OPS.mul, a, b), k.int(32))));
  const lessX = twoX("fixed less than", (a, b) => k.call(INT_OPS.less, a, b));
  const negX = k.def("negate fixed");
  k.define(negX, k.fn(["x"], (x) => fx(x, (a) => F(k.call(INT_OPS.neg, a)))));
  const asFixed = k.def("as fixed");
  k.define(asFixed, k.fn(["whole"], (w) => F(k.call(INT_OPS.shiftDown, w, k.int(-32)))));
  const fixedF = k.def("fixed as float64");
  k.define(fixedF, k.fn(["x"], (x) => fx(x, (a) => n.div(k.call(INT_OPS.toNumber, a), k.lit(2 ** 32)))));
  // a ÷ b: floor(a · 2³² / b), no answer when b is 0, as at Rational.
  const divX = twoX("divide fixed", (a, b) => k.if(k.call(S.equal, b, k.int(0)), k.call(S.fail),
    F(k.call(INT_OPS.quotient, k.call(INT_OPS.shiftDown, a, k.int(-32)), b))));
  // The shortest decimal that reads back to the same steps: Steele and
  // White's free-format digits (1990), in integers. r is what is left of
  // the fraction and m half a step, both in units of 2⁻³³; each digit
  // multiplies both by 10, and the digits stop once what is left is
  // within half a step of either end. Ten digits always suffice for
  // steps of 2⁻³², so it is a fold over ten, and m = 0 marks done.
  const z = { add: (a: Id, b: Id) => k.call(INT_OPS.add, a, b), sub: (a: Id, b: Id) => k.call(INT_OPS.sub, a, b), mul: (a: Id, b: Id) => k.call(INT_OPS.mul, a, b), less: (a: Id, b: Id) => k.call(INT_OPS.less, a, b), up: (a: Id, n: number) => k.call(INT_OPS.shiftDown, a, k.int(-n)), down: (a: Id, n: number) => k.call(INT_OPS.shiftDown, a, k.int(n)) };
  const unit = () => z.up(k.int(1), 33);
  const state = (text: Id, r: Id, m: Id) => k.call(PAIR_V, text, k.call(PAIR_V, r, m));
  const fractionDigits = k.def("fraction digits");
  k.define(fractionDigits, k.fn(["fraction"], (fr) => k.match(k.fold(k.call(INT_OPS.range, k.int(10)), [
    { variant: NIL, names: [], body: () => state(k.lit(""), z.mul(k.int(2), fr), k.int(1)) },
    { variant: CONS, names: ["place", "places"], results: [null, "digits so far"], body: (_, [, sofar]) => k.match(sofar!, [
      { variant: PAIR_V, names: ["text", "left"], body: ([text, left]) => k.match(left, [
        { variant: PAIR_V, names: ["r", "m"], body: ([r, m]) => k.if(k.call(S.equal, m, k.int(0)), sofar!,
          k.let("r₁₀", z.mul(r, k.int(10)), (r10) => k.let("m₁₀", z.mul(m, k.int(10)), (m10) => k.let("digit", z.down(r10, 33), (d) =>
            k.let("rest", z.sub(r10, z.up(d, 33)), (rest) => k.let("low", z.less(rest, m10), (low) => k.let("high", z.less(z.sub(unit(), m10), rest), (high) =>
              k.if(k.call(S.or, low, high),
                state(k.call(S.concat, text, k.call(INT_OPS.show, k.if(k.call(S.and, low, k.call(S.or, k.call(S.not, high), z.less(z.mul(k.int(2), rest), unit()))), d, z.add(d, k.int(1))))), k.int(0), k.int(0)),
                state(k.call(S.concat, text, k.call(INT_OPS.show, d)), rest, m10))))))))) },
      ]) },
    ]) },
  ]), [{ variant: PAIR_V, names: ["digits", "done"], body: ([ds]) => ds }])));
  const showSteps = k.def("show fixed steps");
  k.define(showSteps, k.fn(["steps"], (s) => k.let("whole", z.down(s, 32), (w) => k.let("fraction", z.sub(s, z.up(w, 32)), (fr) =>
    k.if(k.call(S.equal, fr, k.int(0)), k.call(INT_OPS.show, w),
      k.call(S.concat, k.call(INT_OPS.show, w), k.call(S.concat, k.lit("."), k.call(fractionDigits, fr))))))));
  const showX = k.def("show fixed");
  k.define(showX, k.fn(["x"], (x) => fx(x, (s) => k.if(z.less(s, k.int(0)),
    k.call(S.concat, k.lit("-"), k.call(showSteps, k.call(INT_OPS.neg, s))), k.call(showSteps, s)))));

  // Trig at Fixed, all in Ints, so the same bits on every machine.
  // sin and cos are CORDIC (Volder, 1959): the angle, brought into
  // [−π/2, π/2], is turned to 0 by ±atan(2⁻ⁱ) for i = 0 … 31, and (K, 0)
  // turned the same way ends at (cos, sin), each turn only shifts and
  // adds. exp is e^r · 2ᵏ for x = k·ln 2 + r, e^r by its series; log is
  // e·ln 2 + 2·atanh((m − 1)/(m + 1)) for x = m · 2ᵉ with m in [1, 2).
  // The divisions are by numbers that are never 0, so `first` gives the
  // one answer; the defaults only say so to the checker.
  const ONE = 2 ** 32, PI = 13493037705, HALF_PI = 6746518852, TWO_PI = 26986075409, K_GAIN = 2608131496;
  const LN2 = 2977044472n, LN2_64 = 12786308645202655660n;
  const ATANS = [3373259426, 1991351318, 1052175346, 534100635, 268086748, 134174063, 67103403, 33553749, 16777131, 8388597, 4194303, 2097152, 1048576, 524288, 262144, 131072, 65536, 32768, 16384, 8192, 4096, 2048, 1024, 512, 256, 128, 64, 32, 16, 8, 4, 2];
  const only = (body: () => Id, otherwise: () => Id) => k.call(S.first, k.thunk(body), k.thunk(otherwise));
  const quot = (a: Id, b: Id) => k.call(INT_OPS.quotient, a, b);
  const shift = (a: Id, by: Id) => k.call(INT_OPS.shiftDown, a, by);
  const triple = (a: Id, b: Id, c: Id) => k.call(PAIR_V, a, k.call(PAIR_V, b, c));
  const third = (t: Id, f: (a: Id, b: Id, c: Id) => Id, names = ["a", "b", "c"]) => k.match(t, [{ variant: PAIR_V, names: [names[0], "rest"], body: ([a, r]) => k.match(r, [{ variant: PAIR_V, names: [names[1], names[2]], body: ([b, c]) => f(a, b, c) }]) }]);
  const cordic = k.def("cordic");
  // The table from i = 31 down to 0: a fold reaches the last item first.
  k.define(cordic, k.fn(["angle"], (angle) => k.fold(k.list(...ATANS.map((t, j) => k.call(PAIR_V, k.int(j), k.int(t))).reverse()), [
    { variant: NIL, names: [], body: () => triple(k.int(K_GAIN), k.int(0), angle) },
    { variant: CONS, names: ["turn", "turns"], results: [null, "turned"], body: ([turn], [, done]) => k.match(turn, [
      { variant: PAIR_V, names: ["i", "atan"], body: ([j, at]) => third(done!, (x, y, z0) => k.if(z.less(z0, k.int(0)),
        triple(z.add(x, shift(y, j)), z.sub(y, shift(x, j)), z.add(z0, at)),
        triple(z.sub(x, shift(y, j)), z.add(y, shift(x, j)), z.sub(z0, at))), ["x", "y", "left"]) },
    ]) },
  ])));
  // (cos, sin) of an angle in steps.
  const sinCos = k.def("fixed cosine and sine");
  k.define(sinCos, k.fn(["angle"], (angle) => k.let("turns", only(() => quot(angle, k.int(TWO_PI)), () => k.int(0)), (t) =>
    k.let("r", z.sub(angle, z.mul(t, k.int(TWO_PI))), (r0) => k.let("r₂", k.if(z.less(k.int(PI), r0), z.sub(r0, k.int(TWO_PI)), r0), (r) => {
      const at = (a: Id, flip: boolean) => third(k.call(cordic, a), (c, sn) => k.call(PAIR_V, flip ? k.call(INT_OPS.neg, c) : c, sn), ["cos", "sin", "left"]);
      return k.if(z.less(k.int(HALF_PI), r), at(z.sub(k.int(PI), r), true),
        k.if(z.less(r, k.int(-HALF_PI)), at(z.sub(k.int(-PI), r), true), at(r, false)));
    })))));
  const cs = (x: Id, f: (c: Id, sn: Id) => Id) => fx(x, (st) => k.match(k.call(sinCos, st), [{ variant: PAIR_V, names: ["cos", "sin"], body: ([c, sn]) => f(c, sn) }]));
  const sinX = k.def("fixed sin");
  k.define(sinX, k.fn(["x"], (x) => cs(x, (_, sn) => F(sn))));
  const cosX = k.def("fixed cos");
  k.define(cosX, k.fn(["x"], (x) => cs(x, (c) => F(c))));
  const tanX = k.def("fixed tan");
  k.define(tanX, k.fn(["x"], (x) => cs(x, (c, sn) => F(only(() => quot(z.up(sn, 32), c), () => z.up(sn, 32))))));
  const expX = k.def("fixed exp");
  k.define(expX, k.fn(["x"], (x) => fx(x, (st) => F(only(() => k.let("k", quot(st, k.int(LN2)), (kk) => k.let("r", z.sub(st, z.mul(kk, k.int(LN2))), (r) =>
    shift(k.fold(k.call(INT_OPS.range, k.int(14)), [
      { variant: NIL, names: [], body: () => k.int(ONE) },
      { variant: CONS, names: ["n", "ns"], results: [null, "the rest of the series"], body: ([nn], [, acc]) =>
        z.add(k.int(ONE), quot(z.down(z.mul(r, acc!), 32), z.add(nn, k.int(1)))) },
    ]), k.call(INT_OPS.neg, kk)))), () => k.int(0))))));
  // The number of bits of a positive Int, by halving the range 17 times
  // (up to 2¹⁶ bits).
  const bits = k.def("bit length");
  k.define(bits, k.fn(["n"], (nn) => k.match(k.fold(k.call(INT_OPS.range, k.int(17)), [
    { variant: NIL, names: [], body: () => k.call(PAIR_V, k.int(0), k.int(65536)) },
    { variant: CONS, names: ["step", "steps"], results: [null, "narrowed"], body: (_, [, lh]) => k.match(lh!, [
      { variant: PAIR_V, names: ["low", "high"], body: ([lo, hi]) => k.let("middle", z.down(z.add(lo, hi), 1), (mid) =>
        k.if(k.call(S.equal, shift(nn, mid), k.int(0)), k.call(PAIR_V, lo, mid), k.call(PAIR_V, mid, hi))) },
    ]) },
  ]), [{ variant: PAIR_V, names: ["low", "high"], body: ([, hi]) => hi }])));
  const logX = k.def("fixed log");
  k.define(logX, k.fn(["x"], (x) => fx(x, (st) => F(k.if(z.less(st, k.int(1)), k.int(0), only(() =>
    k.let("e", z.sub(k.call(bits, st), k.int(33)), (e) => k.let("m", shift(st, e), (m) =>
      k.let("t", quot(z.up(z.sub(m, k.int(ONE)), 32), z.add(m, k.int(ONE))), (t) => k.let("t²", z.down(z.mul(t, t), 32), (t2) =>
        z.add(z.down(z.mul(e, k.int(LN2_64)), 32), z.mul(k.int(2), z.down(z.mul(t, k.fold(k.call(INT_OPS.range, k.int(12)), [
          { variant: NIL, names: [], body: () => k.int(0) },
          { variant: CONS, names: ["j", "js"], results: [null, "the rest of the series"], body: ([j], [, acc]) =>
            z.add(quot(k.int(ONE), z.add(z.mul(k.int(2), j), k.int(1))), z.down(z.mul(t2, acc!), 32)) },
        ])), 32))))))), () => k.int(0)))))));
  // Unpolar is CORDIC's other mode, vectoring (L97c2): (x, y), brought
  // into the right half-plane, is turned onto the x axis by ±atan(2⁻ⁱ),
  // which adds up to the angle, and x ends as the length over K. Each of
  // length and angle runs it once.
  const vector = k.def("cordic vector");
  k.define(vector, k.fn(["x", "y"], (x0, y0) => k.fold(k.list(...ATANS.map((t, j) => k.call(PAIR_V, k.int(j), k.int(t))).reverse()), [
    { variant: NIL, names: [], body: () => triple(x0, y0, k.int(0)) },
    { variant: CONS, names: ["turn", "turns"], results: [null, "turned"], body: ([turn], [, done]) => k.match(turn, [
      { variant: PAIR_V, names: ["i", "atan"], body: ([j, at]) => third(done!, (x, y, z0) => k.if(z.less(y, k.int(0)),
        triple(z.sub(x, shift(y, j)), z.add(y, shift(x, j)), z.sub(z0, at)),
        triple(z.add(x, shift(y, j)), z.sub(y, shift(x, j)), z.add(z0, at))), ["x", "y", "angle"]) },
    ]) },
  ])));
  // (x, y) in steps, mirrored through 0 when x < 0 (then the angle is π
  // more, or less when y < 0): what `cordic vector` reads.
  const halfPlane = (sx: Id, sy: Id, f: (len: Id, ang: Id) => Id) => {
    const at = (a: Id, b: Id, off: number) => third(k.call(vector, a, b), (len, _, ang) => f(z.down(z.mul(len, k.int(K_GAIN)), 32), off ? z.add(ang, k.int(off)) : ang), ["x", "y", "angle"]);
    return k.if(z.less(sx, k.int(0)), k.if(z.less(sy, k.int(0)), at(k.call(INT_OPS.neg, sx), k.call(INT_OPS.neg, sy), -PI), at(k.call(INT_OPS.neg, sx), k.call(INT_OPS.neg, sy), PI)), at(sx, sy, 0));
  };
  const unpolarX = k.def("fixed unpolar");
  k.define(unpolarX, k.fn(["length", "angle", "x", "y"], (r, t, x, y) => k.and(
    k.equal(r, fx(x, (sx) => fx(y, (sy) => halfPlane(sx, sy, (len) => F(len)), "y steps"), "x steps")),
    k.equal(t, fx(x, (sx) => fx(y, (sy) => halfPlane(sx, sy, (_, ang) => F(ang)), "y steps"), "x steps")))));
  k.results(unpolarX, "length", "angle");
  // √x: the whole square root of x's steps · 2³² by Newton's method from
  // above (Heron's), which only goes down and stops at the floor; no
  // answer below 0.
  const sqrtX = k.def("square root fixed");
  k.define(sqrtX, k.fn(["x"], (x) => fx(x, (st) => k.if(z.less(st, k.int(0)), k.call(S.fail), k.if(k.call(S.equal, st, k.int(0)), F(k.int(0)),
    k.let("n", z.up(st, 32), (nn) => F(k.fold(k.call(INT_OPS.range, k.int(12)), [
      { variant: NIL, names: [], body: () => shift(k.int(1), k.call(INT_OPS.neg, z.down(z.add(k.call(bits, nn), k.int(1)), 1))) },
      { variant: CONS, names: ["step", "steps"], results: [null, "closer"], body: (_, [, g]) => k.let("next", z.down(z.add(g!, quot(nn, g!)), 1), (nx) =>
        k.if(z.less(nx, g!), nx, g!)) },
    ]))))))));
  // asin and acos at Fixed (L97c3): the angle of (√(1 − s²), s) and of
  // (c, √(1 − c²)) by CORDIC's vectoring, with Fixed's own exact square
  // root, so asin(1) is π/2 to the step. Outside [−1, 1] the square root
  // has no answer and the angle is 0's.
  const cut = (v: Id) => only(() => k.call(sqrtX, k.call(ARITH.sub, F(k.int(ONE)), k.call(ARITH.mul, v, v))), () => F(k.int(0)));
  const angleOf = (x: Id, y: Id) => fx(x, (sx) => fx(y, (sy) => halfPlane(sx, sy, (_, ang) => F(ang)), "y steps"), "x steps");
  const asinX = k.def("fixed asin");
  k.define(asinX, k.fn(["s"], (sv) => angleOf(cut(sv), sv)));
  const acosX = k.def("fixed acos");
  k.define(acosX, k.fn(["c"], (cv) => angleOf(cv, cut(cv))));
  // Polar at Fixed is CORDIC's rotating mode (L97d): (cos, sin) of the
  // angle, each times the length with Fixed's own ·. sin and cos are
  // Trig's ways from it, length 1, which gives the same bits as `fixed
  // sin` and `fixed cos` (1 · s is s to the step). Each result runs the
  // rotation on its own until a direction that reads one drops the other
  // (C55).
  const polarX = k.def("fixed polar");
  k.define(polarX, k.fn(["length", "angle", "x", "y"], (r, t, x, y) => k.and(
    k.equal(x, cs(t, (c) => k.call(mulX, r, F(c)))),
    k.equal(y, cs(t, (_, sn) => k.call(mulX, r, F(sn)))))));
  k.results(polarX, "x", "y");
  const trigX = k.def("trig at fixed");
  k.define(trigX, k.call(TRIG_V, ...[S.byItsWays, S.byItsWays, tanX, expX, logX, polarX, unpolarX, asinX, acosX].map((d) => k.x(d))));

  // Clifford algebras (ALGEBRA-TABLES.md, BACKLOG L42): the table of the
  // algebra whose basis vectors square to `squares` (1, −1 or 0 each, so
  // Cl(p, q, r) is p ones, q minus ones and r zeros), for a record type
  // whose basis elements are `basis`, in the blade order 1, e₁, e₂, e₁e₂,
  // e₃, e₁e₃, … . A blade is which basis vectors it has, a list of Bools.
  // e_A · e_B is ± the blade with the vectors in one and not both, its sign
  // a −1 for each swap putting them in order and the square of each vector
  // they share. The standard construction (as in ganja.js; Dorst, Fontijne
  // and Mann, Geometric Algebra for Computer Science, 2007).
  const bladesOf = k.def("blades of");
  k.define(bladesOf, k.fn(["squares"], (sq) => k.fold(sq, [
    { variant: NIL, names: [], body: () => k.list(NIL) },
    { variant: CONS, names: ["square", "rest"], results: [null, "the rest's blades"], body: (_, [, r]) => k.fold(r!, [
      { variant: NIL, names: [], body: () => NIL },
      { variant: CONS, names: ["blade", "more"], results: [null, "more with this vector"], body: ([b], [, m]) =>
        k.call(CONS, k.call(CONS, FALSE, b), k.call(CONS, k.call(CONS, TRUE, b), m!)) },
    ]) },
  ])));
  const outer = k.def("blade outer");
  k.define(outer, k.fn(["a", "b"], (a, b) => k.match(a, [
    { variant: NIL, names: [], body: () => NIL },
    { variant: CONS, names: ["x", "xs"], body: ([x, xs]) => k.match(b, [
      { variant: NIL, names: [], body: () => NIL },
      { variant: CONS, names: ["y", "ys"], body: ([y, ys]) => k.call(CONS, k.call(S.not, k.call(S.equal, x, y)), k.call(outer, xs, ys)) },
    ]) },
  ])));
  // −1 for each vector in the blade, 1 when it has none.
  const flips = k.def("blade flips");
  k.define(flips, k.fn(["blade"], (bl) => k.fold(bl, [
    { variant: NIL, names: [], body: () => k.lit(1) },
    { variant: CONS, names: ["has", "rest"], results: [null, "the rest's flips"], body: ([h], [, r]) => k.if(h, k.call(B.neg, r!), r!) },
  ])));
  const bladeSign = k.def("blade sign");
  k.define(bladeSign, k.fn(["squares", "a", "b"], (sq, a, b) => k.match(sq, [
    { variant: NIL, names: [], body: () => k.lit(1) },
    { variant: CONS, names: ["square", "squares₂"], body: ([s0, sqs]) => k.match(a, [
      { variant: NIL, names: [], body: () => k.lit(1) },
      { variant: CONS, names: ["x", "xs"], body: ([x, xs]) => k.match(b, [
        { variant: NIL, names: [], body: () => k.lit(1) },
        // y moves past every vector of a after it; x and y together square.
        { variant: CONS, names: ["y", "ys"], body: ([y, ys]) => n.mul(n.mul(
          k.if(k.call(S.and, x, y), s0, k.lit(1)),
          k.if(y, k.call(flips, xs), k.lit(1))),
          k.call(bladeSign, sqs, xs, ys)) },
      ]) },
    ]) },
  ])));
  const pairUp = k.def("blades with");
  k.define(pairUp, k.fn(["blades", "basis"], (bs, es) => k.match(bs, [
    { variant: NIL, names: [], body: () => NIL },
    { variant: CONS, names: ["blade", "blades₂"], body: ([b, bs2]) => k.match(es, [
      { variant: NIL, names: [], body: () => NIL },
      { variant: CONS, names: ["element", "basis₂"], body: ([e, es2]) => k.call(CONS, k.call(PAIR_V, b, e), k.call(pairUp, bs2, es2)) },
    ]) },
  ])));
  // The basis element of a blade, or `none` (a zero) when no element has it.
  const elementOf = k.def("element of blade");
  k.define(elementOf, k.fn(["pairs", "blade", "none"], (ps, bl, no) => k.match(ps, [
    { variant: NIL, names: [], body: () => no },
    { variant: CONS, names: ["pair", "pairs₂"], body: ([pr, ps2]) => k.match(pr, [
      { variant: PAIR_V, names: ["b", "e"], body: ([b, e]) => k.if(k.call(S.equal, b, bl), e, k.call(elementOf, ps2, bl, no)) },
    ]) },
  ])));
  const cliffordTable = k.def("clifford table");
  k.define(cliffordTable, k.fn(["squares", "basis"], (sq, es) => k.let("pairs", k.call(pairUp, k.call(bladesOf, sq), es), (ps) =>
    k.fold(ps, [
      { variant: NIL, names: [], body: () => NIL },
      { variant: CONS, names: ["left", "rest"], results: [null, "the rest's lines"], body: ([l], [, r]) => k.match(l, [
        { variant: PAIR_V, names: ["a", "ea"], body: ([a, ea]) => k.fold(ps, [
          { variant: NIL, names: [], body: () => r! },
          { variant: CONS, names: ["right", "more"], results: [null, "more lines"], body: ([rt], [, m]) => k.match(rt, [
            { variant: PAIR_V, names: ["b", "eb"], body: ([b, eb]) => k.let("sign", k.call(bladeSign, sq, a, b), (sg) =>
              k.if(k.call(S.equal, sg, k.lit(0)), m!,
                k.call(CONS, k.call(TIMES_V, ea, eb, k.call(S.mapParts, k.fn(["part"], (x) => n.mul(sg, x)), k.call(elementOf, ps, k.call(outer, a, b), k.call(S.mapParts, k.fn(["part"], () => k.lit(0)), ea)))), m!))) },
          ]) },
        ]) },
      ]) },
    ]))));

  // The reverse of x, x̃: each blade's vectors in the opposite order, which
  // is (−1)^(g(g−1)/2) for a blade of g vectors, the blade's square when
  // every vector squares to 1. A rotor R turns a vector v into R · v · R̃
  // (BACKLOG L43): in Cl(3, 0) the rotors are the even part 1, e₁₂, e₁₃,
  // e₂₃, which multiplies as the quaternions do (Hamilton, 1843; Clifford,
  // 1878; Hestenes, New Foundations for Classical Mechanics, 1986).
  // An algebra's parts, by name (std's Algebra, BACKLOG I79).
  type Parts = { squares: Id; basis: Id; blades: Id; table: Id };
  const parts = (al: Id, body: (p: Parts) => Id) => k.match(al, [{ variant: ALGEBRA_V, names: ["squares", "basis", "blades", "table"],
    body: ([squares, basis, blades, table]) => body({ squares, basis, blades, table }) }]);
  // The algebra of a signature and basis, its table built once: what the
  // clifford functions below take (BACKLOG I79).
  const cliffordAlgebra = k.def("clifford algebra");
  k.define(cliffordAlgebra, k.fn(["squares", "basis"], (sq, es) => k.call(ALGEBRA_V, sq, es, k.call(pairUp, k.call(bladesOf, sq), es), k.call(cliffordTable, sq, es))));
  const cliffordReverse = k.def("clifford reverse");
  k.define(cliffordReverse, k.fn(["algebra", "x"], (al, x) => parts(al, ({ squares: sq, blades }) => k.let("ones", k.fold(sq, [
    { variant: NIL, names: [], body: () => NIL },
    { variant: CONS, names: ["square", "rest"], results: [null, "the rest's ones"], body: (_, [, r]) => k.call(CONS, k.lit(1), r!) },
  ]), (ones) => k.fold(blades, [
    { variant: NIL, names: [], body: () => k.call(S.mapParts, k.fn(["part"], () => k.lit(0)), x) },
    { variant: CONS, names: ["pair", "rest"], results: [null, "the rest reversed"], body: ([pr], [, r]) => k.match(pr, [
      { variant: PAIR_V, names: ["blade", "element"], body: ([b, e]) => k.let("weight", n.mul(k.call(bladeSign, ones, b, b), along(x, e)), (w) =>
        k.call(S.zipParts, B.add, k.call(S.mapParts, k.fn(["part"], (y) => n.mul(w, y)), e), r!)) },
    ]) },
  ])))));

  // Geometry from the tables (MATRICES.md layer 2, BACKLOG L44b): turning,
  // reflecting, projecting and moving are products in the algebra, so they
  // are written once for every signature. In Cl(3, 0) a rotor turns
  // vectors; in projective geometric algebra, [1, 1, 1, 0], a motor turns
  // and moves points. Versors and the sandwich are Hestenes's (1986); the
  // projective forms follow Gunn and De Keninck, "Geometric Algebra for
  // Computer Graphics" (SIGGRAPH 2019 course), and ganja.js.
  // w is worked out once, outside the function map parts runs (which must be pure).
  const scaledBy = (w: Id, x: Id) => ["ref", "lit"].includes(k.code.nodes[w]?.kind ?? "") ? k.call(S.mapParts, k.fn(["part"], (y) => n.mul(w, y)), x)
    : k.let("weight", w, (wv) => k.call(S.mapParts, k.fn(["part"], (y) => n.mul(wv, y)), x));
  const added = (a: Id, b: Id) => k.call(S.zipParts, B.add, a, b);
  // The basis's first element, the scalar 1 (x's zero when there is none).
  const scalarOne = (es: Id, x: Id) => k.match(es, [
    { variant: NIL, names: [], body: () => k.call(S.mapParts, k.fn(["part"], () => k.lit(0)), x) },
    { variant: CONS, names: ["one", "others"], body: ([one]) => one },
  ]);
  // x̂: each blade times −1 for each of its vectors, so odd grades flip.
  const cliffordInvolute = k.def("clifford involute");
  k.define(cliffordInvolute, k.fn(["algebra", "x"], (al, x) => parts(al, ({ blades }) => k.fold(blades, [
    { variant: NIL, names: [], body: () => k.call(S.mapParts, k.fn(["part"], () => k.lit(0)), x) },
    { variant: CONS, names: ["pair", "rest"], results: [null, "the rest involuted"], body: ([pr], [, r]) => k.match(pr, [
      { variant: PAIR_V, names: ["blade", "element"], body: ([b, e]) => added(scaledBy(n.mul(k.call(flips, b), along(x, e)), e), r!) },
    ]) },
  ]))));
  // A versor's inverse, ṽ / (v ṽ): a vector's, a rotor's or a blade's,
  // whose v ṽ is a number (Hestenes, 1986). When v ṽ isn't a number, or is
  // 0, there is no answer here (BACKLOG I108): 1 + e₁ has no inverse at
  // all, and 2 + e₁, which has one, isn't a versor. The general inverse
  // (Hitzer and Sangwine, 2017) would be another function.
  const sumOfSquares = (x: Id) => k.call(S.total, k.call(S.zipParts, B.mul, x, x));
  // reflect and project take a vector or a blade, whose v ṽ is a number,
  // so they divide by it without the check (a null one, v ṽ = 0, stops
  // the program: x / 0 has no answer). Not offered on its own.
  const bladeInverse = k.def("clifford blade inverse");
  k.define(bladeInverse, k.fn(["algebra", "v"], (al, v) => parts(al, ({ basis: es, table: t }) => k.let("ṽ", k.call(cliffordReverse, al, v), (rv) =>
    scaledBy(n.div(k.lit(1), along(k.call(tableProduct, t, v, rv), scalarOne(es, v))), rv)))));
  const cliffordInverse = k.def("clifford versor inverse");
  k.define(cliffordInverse, k.fn(["algebra", "v"], (al, v) => parts(al, ({ basis: es, table: t }) => k.let("ṽ", k.call(cliffordReverse, al, v), (rv) =>
    k.let("one", scalarOne(es, v), (one) => k.let("v ṽ", k.call(tableProduct, t, v, rv), (vv) => k.let("s", along(vv, one), (sc) =>
      k.let("the rest of v ṽ", k.call(S.zipParts, B.sub, vv, scaledBy(sc, one)), (rest) =>
      k.if(k.call(S.or, k.call(S.equal, sc, k.lit(0)), k.call(S.less, n.mul(k.lit(1e-18), n.mul(sc, sc)), sumOfSquares(rest))),
        k.call(S.fail),
        scaledBy(n.div(k.lit(1), sc), rv))))))))));
  const cliffordProduct = k.def("clifford product");
  k.define(cliffordProduct, k.fn(["algebra", "a", "b"], (al, a, b) => parts(al, ({ table: t }) => k.call(tableProduct, t, a, b))));
  const cliffordSandwich = k.def("clifford sandwich");
  k.define(cliffordSandwich, k.fn(["algebra", "r", "x"], (al, r, x) => parts(al, ({ table: t }) =>
    k.call(tableProduct, t, k.call(tableProduct, t, r, x), k.call(cliffordReverse, al, r)))));
  const cliffordReflect = k.def("clifford reflect");
  k.define(cliffordReflect, k.fn(["algebra", "n", "x"], (al, nv, x) => parts(al, ({ table: t }) =>
    k.call(tableProduct, t, k.call(tableProduct, t, k.call(cliffordInvolute, al, nv), x), k.call(bladeInverse, al, nv)))));
  // x's part in the blade b: ½(x − b̂ x b⁻¹), since b̂ x b⁻¹ keeps the
  // part outside b and flips the part in it.
  const cliffordProject = k.def("clifford project");
  k.define(cliffordProject, k.fn(["algebra", "b", "x"], (al, b, x) =>
    scaledBy(k.lit(0.5), k.call(S.zipParts, B.sub, x, k.call(cliffordReflect, al, b, x)))));
  // e^b for a bivector b whose square is a number s: cos √−s + sin √−s / √−s · b
  // when s < 0 (a rotor), 1 + b when s = 0 (a translator in projective
  // geometric algebra), cosh √s + sinh √s / √s · b when s > 0. The rotor
  // turning by θ in the plane B (B² = −1) is clifford exp(−θ/2 · B).
  // When b² isn't a number (an electromagnetic field with E·B ≠ 0 squares
  // to a number plus a pseudoscalar part; a screw motion in projective
  // geometric algebra), the series instead (BACKLOG I92): halved until
  // small, Horner's form of 1 + b + b²/2! + … to 16 terms, then squared
  // back up, e^b = (e^(b/2ᵏ))^(2ᵏ). That is scaling and squaring, as for
  // the matrix exponential (Moler and Van Loan, "Nineteen dubious ways to
  // compute the exponential of a matrix", 1978/2003).
  const cliffordSeries = k.def("clifford exp by series");
  k.define(cliffordSeries, k.fn(["table", "one", "b"], (t, one, b) =>
    k.let("halvings", k.let("size", k.call(B.sqrt, sumOfSquares(b)), (size) =>
      k.if(k.call(S.less, size, k.lit(0.25)), k.lit(0), n.add(k.call(S.floor, n.div(k.call(B.log, n.div(size, k.lit(0.25))), k.call(B.log, k.lit(2)))), k.lit(1)))), (h) =>
      k.let("small", scaledBy(n.div(k.lit(1), k.call(B.pow, k.lit(2), h)), b), (x) =>
        k.fold(k.call(S.range, h), [
          { variant: NIL, names: [], body: () => k.fold(k.list(...Array.from({ length: 16 }, (_, i) => k.lit(1 / (i + 1)))), [
            { variant: NIL, names: [], body: () => one },
            { variant: CONS, names: ["1/(i + 1)", "rest"], results: [null, "the rest's terms"], body: ([c], [, r]) =>
              added(one, scaledBy(c, k.call(tableProduct, t, x, r!))) },
          ]) },
          { variant: CONS, names: ["_", "rest"], results: [null, "half as far"], body: (_, [, r]) => k.call(tableProduct, t, r!, r!) },
        ])))));
  const cliffordExp = k.def("clifford exp");
  k.define(cliffordExp, k.fn(["algebra", "b"], (al, b) => parts(al, ({ basis: es, table: t }) => k.let("one", scalarOne(es, b), (one) =>
    k.let("b²", k.call(tableProduct, t, b, b), (bb) => k.let("s", along(bb, one), (s) =>
      k.let("the rest of b²", k.call(S.zipParts, B.sub, bb, scaledBy(s, one)), (rest) =>
      k.if(k.call(S.less, k.lit(1e-18), n.sub(sumOfSquares(rest), k.call(B.mul, k.lit(1e-18), n.mul(s, s)))),
        k.call(cliffordSeries, t, one, b),
      k.if(k.call(S.equal, s, k.lit(0)), added(one, b),
        k.if(k.call(S.less, s, k.lit(0)),
          k.let("a", k.call(B.sqrt, k.call(B.neg, s)), (a) => added(scaledBy(k.call(B.cos, a), one), scaledBy(n.div(k.call(B.sin, a), a), b))),
          k.let("a", k.call(B.sqrt, s), (a) => k.let("eᵃ", k.call(B.exp, a), (ea) => k.let("e⁻ᵃ", n.div(k.lit(1), ea), (eb) =>
            added(scaledBy(n.mul(k.lit(0.5), n.add(ea, eb)), one), scaledBy(n.div(n.mul(k.lit(0.5), n.sub(ea, eb)), a), b)))))))))))))));

  // The other products, grades and duals (BACKLOG I89), as in Dorst,
  // Fontijne and Mann (2007) and Gunn and De Keninck (2019). The outer and
  // inner products are the geometric product's table with some lines left
  // out: e_A ∧ e_B is e_A e_B when A and B share no vector, else 0; the
  // left contraction e_A ⌋ e_B is e_A e_B when A is inside B, else 0. So
  // each is a table for `table product`, built as clifford table is.
  // Two blades, position by position: does any position hold `x` in a and
  // `y` in b?
  const anyPair = (name: string, x: boolean, y: boolean) => {
    const d = k.def(name);
    k.define(d, k.fn(["a", "b"], (a, b) => k.match(a, [
      { variant: NIL, names: [], body: () => FALSE },
      { variant: CONS, names: ["p", "ps"], body: ([p, ps]) => k.match(b, [
        { variant: NIL, names: [], body: () => FALSE },
        { variant: CONS, names: ["q", "qs"], body: ([q, qs]) => k.if(k.call(S.and, x ? p : k.call(S.not, p), y ? q : k.call(S.not, q)), TRUE, k.call(d, ps, qs)) },
      ]) },
    ])));
    return d;
  };
  const share = anyPair("blades share", true, true);
  const sticksOut = anyPair("blade sticks out", true, false);
  // clifford table, keeping only the lines whose blades `wanted` says yes to.
  const tableWhere = k.def("clifford table where");
  k.define(tableWhere, k.fn(["squares", "basis", "wanted"], (sq, es, wanted) => k.let("pairs", k.call(pairUp, k.call(bladesOf, sq), es), (ps) =>
    k.fold(ps, [
      { variant: NIL, names: [], body: () => NIL },
      { variant: CONS, names: ["left", "rest"], results: [null, "the rest's lines"], body: ([l], [, r]) => k.match(l, [
        { variant: PAIR_V, names: ["a", "ea"], body: ([a, ea]) => k.fold(ps, [
          { variant: NIL, names: [], body: () => r! },
          { variant: CONS, names: ["right", "more"], results: [null, "more lines"], body: ([rt], [, m]) => k.match(rt, [
            { variant: PAIR_V, names: ["b", "eb"], body: ([b, eb]) => k.let("sign", k.call(bladeSign, sq, a, b), (sg) =>
              k.if(k.call(S.or, k.call(S.equal, sg, k.lit(0)), k.call(S.not, k.call(wanted, a, b))), m!,
                k.call(CONS, k.call(TIMES_V, ea, eb, k.call(S.mapParts, k.fn(["part"], (x) => n.mul(sg, x)), k.call(elementOf, ps, k.call(outer, a, b), k.call(S.mapParts, k.fn(["part"], () => k.lit(0)), ea)))), m!))) },
          ]) },
        ]) },
      ]) },
    ]))));
  const cliffordOuter = k.def("clifford outer");
  k.define(cliffordOuter, k.fn(["algebra", "a", "b"], (al, a, b) => parts(al, ({ squares: sq, basis: es }) =>
    k.call(tableProduct, k.call(tableWhere, sq, es, k.fn(["p", "q"], (p, q) => k.call(S.not, k.call(share, p, q)))), a, b))));
  const cliffordInner = k.def("clifford inner");
  k.define(cliffordInner, k.fn(["algebra", "a", "b"], (al, a, b) => parts(al, ({ squares: sq, basis: es }) =>
    k.call(tableProduct, k.call(tableWhere, sq, es, k.fn(["p", "q"], (p, q) => k.call(S.not, k.call(sticksOut, p, q)))), a, b))));

  // How many vectors a blade has: its grade.
  const gradeOf = k.def("blade grade");
  k.define(gradeOf, k.fn(["blade"], (bl) => k.fold(bl, [
    { variant: NIL, names: [], body: () => k.lit(0) },
    { variant: CONS, names: ["has", "rest"], results: [null, "the rest's grade"], body: ([h], [, r]) => k.if(h, n.add(r!, k.lit(1)), r!) },
  ])));
  // x's parts on the blades the function `weigh` gives each blade's
  // weight for, summed: grade selection, dual and undual are each one.
  const reweigh = (ps: Id, x: Id, weigh: (blade: Id, element: Id, ps: Id) => Id) => k.fold(ps, [
    { variant: NIL, names: [], body: () => k.call(S.mapParts, k.fn(["part"], () => k.lit(0)), x) },
    { variant: CONS, names: ["pair", "rest"], results: [null, "the rest's sum"], body: ([pr], [, r]) => k.match(pr, [
      { variant: PAIR_V, names: ["blade", "element"], body: ([b, e]) => added(weigh(b, e, ps), r!) },
    ]) },
  ]);
  const cliffordGrade = k.def("clifford grade");
  k.define(cliffordGrade, k.fn(["algebra", "grade", "x"], (al, g, x) => parts(al, ({ blades }) => reweigh(blades, x, (b, e) =>
    k.if(k.call(S.equal, k.call(gradeOf, b), g), scaledBy(along(x, e), e), k.call(S.mapParts, k.fn(["part"], () => k.lit(0)), x))))));
  // The dual by complement, which works in degenerate algebras too
  // (projective geometric algebra, where the pseudoscalar squares to 0):
  // e_A goes to ± e_Ā, Ā the vectors A doesn't have, signed so that
  // e_A ∧ dual(e_A) is the pseudoscalar. undual undoes it, and the
  // regressive product (the join of points, the meet of planes) is
  // undual(dual(a) ∧ dual(b)).
  const complement = (bl: Id) => k.call(map, bl, k.fn(["has"], (h) => k.call(S.not, h)));
  const cliffordDual = k.def("clifford dual");
  k.define(cliffordDual, k.fn(["algebra", "x"], (al, x) => parts(al, ({ squares: sq, blades }) => reweigh(blades, x, (b, e, ps) => k.let("other", complement(b), (c) =>
    scaledBy(n.mul(k.call(bladeSign, sq, b, c), along(x, e)), k.call(elementOf, ps, c, k.call(S.mapParts, k.fn(["part"], () => k.lit(0)), x))))))));
  const cliffordUndual = k.def("clifford undual");
  k.define(cliffordUndual, k.fn(["algebra", "x"], (al, x) => parts(al, ({ squares: sq, blades }) => reweigh(blades, x, (c, e, ps) => k.let("other", complement(c), (b) =>
    scaledBy(n.mul(k.call(bladeSign, sq, b, c), along(x, e)), k.call(elementOf, ps, b, k.call(S.mapParts, k.fn(["part"], () => k.lit(0)), x))))))));
  const cliffordRegressive = k.def("clifford regressive");
  k.define(cliffordRegressive, k.fn(["algebra", "a", "b"], (al, a, b) =>
    k.call(cliffordUndual, al, k.call(cliffordOuter, al, k.call(cliffordDual, al, a), k.call(cliffordDual, al, b)))));

  // Parts by blade (BACKLOG I81): a blade is named by its vectors,
  // numbered from 1 in the order of the algebra's squares, so in Cl(3, 0)
  // [1, 2] is e₁₂ and in projective geometric algebra ([1, 1, 1, 0])
  // [1, 2, 3] is e₁₂₃ and 4 is e₀. Naming them in another order flips the
  // sign once per swap: [2, 1] is e₂₁ = −e₁₂. Bounce wrote solid(0, 0, 0,
  // 2, 0, 1, 0, 0) for 2e₁₂ + e₁₃, and Spacetime named all 16 parts to
  // read one. A vector named twice, or past the last, is no blade: its
  // part reads 0 and writing it changes nothing.
  // How many swaps put the vectors in order: −1 for an odd count, else 1.
  const orderSign = k.def("vectors order sign");
  k.define(orderSign, k.fn(["vectors"], (vs) => k.fold(vs, [
    { variant: NIL, names: [], body: () => k.lit(1) },
    { variant: CONS, names: ["v", "later"], results: [null, "the later ones' sign"], body: ([v, later], [, r]) => k.fold(later, [
      { variant: NIL, names: [], body: () => r! },
      { variant: CONS, names: ["w", "more"], results: [null, "with more"], body: ([w], [, m]) => k.if(k.call(S.less, w, v), k.call(B.neg, m!), m!) },
    ]) },
  ])));
  // The blade with those vectors, as clifford algebra lists them: for each
  // position 1 … n, whether it is among them.
  const namedBlade = (sq: Id, vs: Id) => k.call(map, k.call(S.range, k.call(INT_OPS.toNumber, k.call(length, sq))), k.fn(["position"], (i) =>
    k.fold(vs, [
      { variant: NIL, names: [], body: () => FALSE },
      { variant: CONS, names: ["v", "others"], results: [null, "among the others"], body: ([v], [, r]) => k.call(S.or, k.call(S.equal, v, n.add(i, k.lit(1))), r!) },
    ])));
  // The sign is 0 for no blade: a blade with fewer vectors than were named.
  const byBlade = (al: Id, x: Id, vs: Id, body: (sign: Id, element: Id) => Id) => parts(al, ({ squares: sq, blades }) =>
    k.let("blade", namedBlade(sq, vs), (bl) =>
      k.let("element", k.call(elementOf, blades, bl, k.call(S.mapParts, k.fn(["part"], () => k.lit(0)), x)), (e) =>
        k.let("sign", k.if(k.call(S.equal, k.call(gradeOf, bl), k.call(INT_OPS.toNumber, k.call(length, vs))), k.call(orderSign, vs), k.lit(0)), (sg) => body(sg, e)))));
  const cliffordPart = k.def("clifford part");
  k.define(cliffordPart, k.fn(["algebra", "x", "vectors"], (al, x, vs) => byBlade(al, x, vs, (sg, e) => n.mul(sg, along(x, e)))));
  const cliffordWithPart = k.def("clifford with part");
  k.define(cliffordWithPart, k.fn(["algebra", "x", "vectors", "value"], (al, x, vs, v) => byBlade(al, x, vs, (sg, e) =>
    k.if(k.call(S.equal, sg, k.lit(0)), x, added(x, scaledBy(n.sub(n.mul(sg, v), along(x, e)), e))))));

  // Small matrices (BACKLOG L44): the multiplication table of n × n
  // matrices from their matrix units, given as rows of basis elements.
  // E_ij · E_jl = E_il, and any other product of two units is 0, so the
  // lines are, for each row i, each E_ij beside row j, and each E_jl of
  // row j beside E_il of row i. The matrix units are the textbook
  // basis of a matrix algebra (as in Cayley, 1858).
  const matrixTable = k.def("matrix table");
  k.define(matrixTable, k.fn(["rows"], (rows) => k.fold(rows, [
    { variant: NIL, names: [], body: () => NIL },
    { variant: CONS, names: ["row", "rest"], results: [null, "the rest's lines"], body: ([row], [, rest]) => k.call(append, k.fold(k.call(pairUp, row, rows), [
      { variant: NIL, names: [], body: () => NIL },
      { variant: CONS, names: ["unit", "units"], results: [null, "more lines"], body: ([u], [, more]) => k.match(u, [
        { variant: PAIR_V, names: ["eij", "row j"], body: ([eij, rowJ]) => k.call(append, k.fold(k.call(pairUp, rowJ, row), [
          { variant: NIL, names: [], body: () => NIL },
          { variant: CONS, names: ["pair", "pairs"], results: [null, "the row's lines"], body: ([pr], [, lines]) => k.match(pr, [
            { variant: PAIR_V, names: ["ejl", "eil"], body: ([ejl, eil]) => k.call(CONS, k.call(TIMES_V, eij, ejl, eil), lines!) },
          ]) },
        ]), more!) },
      ]) },
    ]), rest!) },
  ])));
  const units = (size: 2 | 3 | 4) => k.list(...Array.from({ length: size }, (_, i) => k.list(...Array.from({ length: size }, (_, j) =>
    k.call(MAT_V[size], ...Array.from({ length: size * size }, (_, c) => k.lit(c === i * size + j ? 1 : 0)))))));
  const matTables = ([2, 3, 4] as const).map((size) => { const d = k.def(`mat${size} table`); k.define(d, k.call(matrixTable, units(size))); return d; });
  // + − and −x part by part, at any record of Float64s.
  const partwise = (name: string, op: Id) => { const d = k.def(name); k.define(d, k.fn(["a", "b"], (a, b) => k.call(S.zipParts, op, a, b))); return d; };
  const addParts = partwise("add parts", B.add), subParts = partwise("subtract parts", B.sub);
  const negParts = k.def("negate parts");
  k.define(negParts, k.fn(["a"], (a) => k.call(S.mapParts, k.x(B.neg), a)));
  const matProducts = matTables.map((t, i) => { const d = k.def(`multiply mat${i + 2}`); k.define(d, k.fn(["a", "b"], (a, b) => k.call(tableProduct, k.x(t), a, b))); return d; });

  // Each number type's + − · −x and < (INTERFACES.md step 4): the one +
  // at a type is its Arithmetic's, found by the type. Not offered: + is.
  const impl = (name: string, v: Id, ops: Id[]) => { const d = k.def(name); k.define(d, k.call(v, ...ops.map((o) => k.x(o)))); return d; };
  const arithmetics = [
    impl("arithmetic at float64", ARITHMETIC_V, [B.add, B.sub, B.mul, B.neg]),
    impl("arithmetic at int", ARITHMETIC_V, [INT_OPS.add, INT_OPS.sub, INT_OPS.mul, INT_OPS.neg]),
    impl("arithmetic at rational", ARITHMETIC_V, [addF, subF, mulF, negF]),
    impl("arithmetic at complex", ARITHMETIC_V, [addC, subC, mulC, negC]),
    impl("arithmetic at dual", ARITHMETIC_V, [addD, subD, mulD, negD]),
    impl("arithmetic at algebraic", ARITHMETIC_V, [ALGEBRAIC_OPS.add, ALGEBRAIC_OPS.sub, ALGEBRAIC_OPS.mul, ALGEBRAIC_OPS.neg]),
    impl("ordered at float64", ORDERED_V, [S.less]),
    impl("ordered at int", ORDERED_V, [INT_OPS.less]),
    impl("ordered at rational", ORDERED_V, [lessF]),
    impl("ordered at algebraic", ORDERED_V, [ALGEBRAIC_OPS.less]),
    impl("arithmetic at fixed", ARITHMETIC_V, [addX, subX, mulX, negX]),
    ...matProducts.map((m, i) => impl(`arithmetic at mat${i + 2}`, ARITHMETIC_V, [addParts, subParts, m, negParts])),
    impl("ordered at fixed", ORDERED_V, [lessX]),
  ];

  // Sorting by the order on plain data (`compare`, L66): a merge sort
  // written bottom-up, so every step is a fold or a recursion the
  // termination check accepts (merge shrinks one list or the other; add
  // run walks the slots), and the type has no Diverge. Each slot holds a
  // sorted run of 2^i items or none, as a binary counter: von Neumann's
  // merge sort (1945), counted as Okasaki's bottom-up mergesort does.
  const mergeSorted = k.def("merge sorted");
  k.define(mergeSorted, k.fn(["xs", "ys"], (xs, ys) => k.match(xs, [
    { variant: NIL, names: [], body: () => ys },
    { variant: CONS, names: ["x", "xs rest"], body: ([x, xr]) => k.match(ys, [
      { variant: NIL, names: [], body: () => xs },
      { variant: CONS, names: ["y", "ys rest"], body: ([y, yr]) => k.match(k.call(COMPARE, y, x), [
        { variant: ORDER_V.before, names: [], body: () => k.call(CONS, y, k.call(mergeSorted, xs, yr)) },
      ], k.call(CONS, x, k.call(mergeSorted, xr, ys))) },
    ]) },
  ])));
  const addRun = k.def("add run");
  k.define(addRun, k.fn(["run", "slots"], (run, slots) => k.match(slots, [
    { variant: NIL, names: [], body: () => k.call(CONS, k.call(SOME, run), k.x(NIL)) },
    { variant: CONS, names: ["slot", "higher"], body: ([slot, higher]) => k.match(slot, [
      { variant: NONE, names: [], body: () => k.call(CONS, k.call(SOME, run), higher) },
      { variant: SOME, names: ["held"], body: ([held]) => k.call(CONS, k.x(NONE), k.call(addRun, k.call(mergeSorted, held, run), higher)) },
    ]) },
  ])));
  const sort = k.def("sort");
  k.define(sort, k.fn(["list"], (xs) => k.fold(
    k.fold(xs, [
      { variant: NIL, names: [], body: () => k.x(NIL) },
      { variant: CONS, names: ["item", "rest"], results: [null, "slots"], body: ([item], [, slots]) => k.call(addRun, k.call(CONS, item, k.x(NIL)), slots!) },
    ]), [
      { variant: NIL, names: [], body: () => k.x(NIL) },
      { variant: CONS, names: ["slot", "higher"], results: [null, "merged"], body: ([slot], [, merged]) => k.match(slot, [
        { variant: NONE, names: [], body: () => merged! },
        { variant: SOME, names: ["run"], body: ([run]) => k.call(mergeSorted, run, merged!) },
      ]) },
    ])));

  // Sorting by a key (L104, routes' LG3): the same bottom-up merge sort,
  // comparing key(item)s, so a program sorts records by one field without
  // a type whose fields put that one first. Stable: items with the same
  // key keep the list's order. The fold adds the items from the end, so
  // each new run holds earlier items than the one it meets and goes first
  // on a tie. Python's sorted(key=…) and Haskell's sortOn are the same.
  const mergeByKey = k.def("merge by key");
  k.define(mergeByKey, k.fn(["key", "xs", "ys"], (key, xs, ys) => k.match(xs, [
    { variant: NIL, names: [], body: () => ys },
    { variant: CONS, names: ["x", "xs rest"], body: ([x, xr]) => k.match(ys, [
      { variant: NIL, names: [], body: () => xs },
      { variant: CONS, names: ["y", "ys rest"], body: ([y, yr]) => k.match(k.call(COMPARE, k.call(key, y), k.call(key, x)), [
        { variant: ORDER_V.before, names: [], body: () => k.call(CONS, y, k.call(mergeByKey, key, xs, yr)) },
      ], k.call(CONS, x, k.call(mergeByKey, key, xr, ys))) },
    ]) },
  ])));
  const addRunByKey = k.def("add run by key");
  k.define(addRunByKey, k.fn(["key", "run", "slots"], (key, run, slots) => k.match(slots, [
    { variant: NIL, names: [], body: () => k.call(CONS, k.call(SOME, run), k.x(NIL)) },
    { variant: CONS, names: ["slot", "higher"], body: ([slot, higher]) => k.match(slot, [
      { variant: NONE, names: [], body: () => k.call(CONS, k.call(SOME, run), higher) },
      { variant: SOME, names: ["held"], body: ([held]) => k.call(CONS, k.x(NONE), k.call(addRunByKey, key, k.call(mergeByKey, key, run, held), higher)) },
    ]) },
  ])));
  // A list's items by position (BACKLOG I83): three examples each wrote
  // their own. Positions count from 0; a position outside the list gives
  // `otherwise` (item at) or the list as it was (replace at), so neither
  // has Choice. Each walks to the position, n steps.
  const itemAt = k.def("item at");
  k.define(itemAt, k.fn(["list", "position", "otherwise"], (xs, i, o) => k.match(xs, [
    { variant: NIL, names: [], body: () => o },
    { variant: CONS, names: ["item", "rest"], body: ([x, rest]) => k.if(k.call(S.less, i, k.lit(-0.5)), o,
      k.if(k.call(S.less, i, k.lit(0.5)), x, k.call(itemAt, rest, n.sub(i, k.lit(1)), o))) },
  ])));
  const replaceAt = k.def("replace at");
  k.define(replaceAt, k.fn(["list", "position", "by"], (xs, i, by) => k.match(xs, [
    { variant: NIL, names: [], body: () => NIL },
    { variant: CONS, names: ["item", "rest"], body: ([x, rest]) => k.if(k.call(S.less, i, k.lit(-0.5)), xs,
      k.if(k.call(S.less, i, k.lit(0.5)), k.call(CONS, by, rest), k.call(CONS, x, k.call(replaceAt, rest, n.sub(i, k.lit(1)), by)))) },
  ])));
  // A Float64 shown to a fixed number of decimals (BACKLOG I93): the
  // Spacetime demo wrote its own `rounded`. Rounds half away from 0 at
  // the last place and keeps trailing zeros, as JavaScript's toFixed and
  // C's printf("%.*f") do, and never shows -0. "padded digits" is n, a
  // whole number ≥ 0, in exactly `count` digits with zeros in front,
  // digit by digit so it is a fold and not a loop on a number.
  const paddedDigits = k.def("padded digits");
  k.define(paddedDigits, k.fn(["n", "count"], (m, c) => k.fold(k.call(S.range, c), [
    { variant: NIL, names: [], body: () => k.lit("") },
    { variant: CONS, names: ["place", "places"], results: [null, "after"], body: ([i], [, after]) => k.call(S.concat,
      k.call(S.show, k.call(S.mod, k.call(S.floor, n.div(m, k.call(B.pow, k.lit(10), n.sub(n.sub(c, k.lit(1)), i)))), k.lit(10))), after!) },
  ])));
  const showDecimals = k.def("show decimals");
  k.define(showDecimals, k.fn(["x", "places"], (x, places) => k.let("scale", k.call(B.pow, k.lit(10), places), (scale) =>
    k.let("steps", k.call(S.floor, n.add(n.mul(k.call(S.abs, x), scale), k.lit(0.5))), (m) =>
      k.let("whole", k.call(S.floor, n.div(m, scale)), (w) =>
        k.let("text", k.if(k.call(S.less, places, k.lit(0.5)), k.call(S.show, w),
          k.call(S.concat, k.call(S.show, w), k.call(S.concat, k.lit("."), k.call(paddedDigits, n.sub(m, n.mul(w, scale)), places)))), (text) =>
          k.if(k.call(S.and, k.call(S.less, x, k.lit(0)), k.call(S.less, k.lit(0), m)), k.call(S.concat, k.lit("-"), text), text)))))));
  const sortBy = k.def("sort by");
  k.define(sortBy, k.fn(["list", "key"], (xs, key) => k.fold(
    k.fold(xs, [
      { variant: NIL, names: [], body: () => k.x(NIL) },
      { variant: CONS, names: ["item", "rest"], results: [null, "slots"], body: ([item], [, slots]) => k.call(addRunByKey, key, k.call(CONS, item, k.x(NIL)), slots!) },
    ]), [
      { variant: NIL, names: [], body: () => k.x(NIL) },
      { variant: CONS, names: ["slot", "higher"], results: [null, "merged"], body: ([slot], [, merged]) => k.match(slot, [
        { variant: NONE, names: [], body: () => merged! },
        { variant: SOME, names: ["run"], body: ([run]) => k.call(mergeByKey, key, run, merged!) },
      ]) },
    ])));

  // Maps and sets (L65, DATA-STRUCTURES.md): the entries sorted by key in
  // compare's order with no key twice, the items sorted with none twice,
  // so each has one spelling. Every operation keeps it. Each walks the
  // list, so each is linear until the balanced tree (L76) stores them;
  // ordered maps with folds in key order are Haskell's Data.Map, OCaml's
  // Map and Rust's BTreeMap.
  const byOrder = (a: Id, b: Id, before: () => Id, same: () => Id, after: () => Id) => k.match(k.call(COMPARE, a, b), [
    { variant: ORDER_V.before, names: [], body: before },
    { variant: ORDER_V.same, names: [], body: same },
    { variant: ORDER_V.after, names: [], body: after },
  ]);
  const entry = (e: Id, f: (key: Id, value: Id) => Id, names = ["key", "value"]) => k.match(e, [{ variant: PAIR_V, names, body: ([a, b]) => f(a, b) }]);
  const entriesOf = (m: Id, f: (es: Id) => Id) => k.match(m, [{ variant: MAP_V, names: ["entries"], body: ([es]) => f(es) }]);
  const itemsOf = (s: Id, f: (xs: Id) => Id, name = "items") => k.match(s, [{ variant: SET_V, names: [name], body: ([xs]) => f(xs) }]);
  const P = (a: Id, b: Id) => k.call(PAIR_V, a, b);
  // A walk down a sorted list to the place of `key`: what to give at the
  // end, where the item is the key, and where it is past it.
  const walk = (name: string, params: string[], at: (keyOf: (item: Id, f: (itemKey: Id) => Id) => Id) => (args: Id[], self: Id) => { end: Id; here: (item: Id, rest: Id) => Id; past: (item: Id, rest: Id) => Id; before: (item: Id, rest: Id) => Id }, keyOf: (item: Id, f: (itemKey: Id) => Id) => Id) => {
    const d = k.def(name);
    k.define(d, k.fn(["list", ...params], (xs, ...args) => {
      const c = at(keyOf)(args, d);
      return k.match(xs, [
        { variant: NIL, names: [], body: () => c.end },
        { variant: CONS, names: ["item", "rest"], body: ([item, rest]) => keyOf(item, (ik) => byOrder(args[0], ik, () => c.before(item, rest), () => c.here(item, rest), () => c.past(item, rest))) },
      ]);
    }));
    return d;
  };
  const pairKey = (item: Id, f: (ik: Id) => Id) => entry(item, (ik) => f(ik), ["item key", "item value"]);
  const itself = (item: Id, f: (ik: Id) => Id) => f(item);
  const putEntry = walk("put entry", ["key", "value"], () => ([key, value], self) => ({
    end: k.call(CONS, P(key, value), k.x(NIL)),
    before: (item, rest) => k.call(CONS, P(key, value), k.call(CONS, item, rest)),
    here: (_, rest) => k.call(CONS, P(key, value), rest),
    past: (item, rest) => k.call(CONS, item, k.call(self, rest, key, value)),
  }), pairKey);
  const removeEntry = walk("remove entry", ["key"], () => ([key], self) => ({
    end: k.x(NIL),
    before: (item, rest) => k.call(CONS, item, rest),
    here: (_, rest) => rest,
    past: (item, rest) => k.call(CONS, item, k.call(self, rest, key)),
  }), pairKey);
  const lookupEntry = walk("lookup entry", ["key"], () => ([key], self) => ({
    end: k.call(S.fail),
    before: () => k.call(S.fail),
    here: (item) => entry(item, (_, v) => v),
    past: (_, rest) => k.call(self, rest, key),
  }), pairKey);
  const addItem_ = walk("add to items", ["item"], () => ([x], self) => ({
    end: k.call(CONS, x, k.x(NIL)),
    before: (item, rest) => k.call(CONS, x, k.call(CONS, item, rest)),
    here: (item, rest) => k.call(CONS, item, rest),
    past: (item, rest) => k.call(CONS, item, k.call(self, rest, x)),
  }), itself);
  const removeItem_ = walk("remove from items", ["item"], () => ([x], self) => ({
    end: k.x(NIL),
    before: (item, rest) => k.call(CONS, item, rest),
    here: (_, rest) => rest,
    past: (item, rest) => k.call(CONS, item, k.call(self, rest, x)),
  }), itself);
  const hasItem_ = walk("items have", ["item"], () => ([x], self) => ({
    end: k.x(FALSE),
    before: () => k.x(FALSE),
    here: () => k.x(TRUE),
    past: (_, rest) => k.call(self, rest, x),
  }), itself);
  // One walk to the key's place, changing what it holds or putting
  // change(default) where it has nothing (L103).
  const updateEntry = walk("update entry", ["key", "default", "change"], () => ([key, dflt, change], self) => ({
    end: k.call(CONS, P(key, k.call(change, dflt)), k.x(NIL)),
    before: (item, rest) => k.call(CONS, P(key, k.call(change, dflt)), k.call(CONS, item, rest)),
    here: (item, rest) => entry(item, (_, v) => k.call(CONS, P(key, k.call(change, v)), rest), ["item key", "item value"]),
    past: (item, rest) => k.call(CONS, item, k.call(self, rest, key, dflt, change)),
  }), pairKey);
  const hasEntry = walk("entries have", ["key"], () => ([key], self) => ({
    end: k.x(FALSE),
    before: () => k.x(FALSE),
    here: () => k.x(TRUE),
    past: (_, rest) => k.call(self, rest, key),
  }), pairKey);

  const def = (name: string, params: string[], body: (...ps: Id[]) => Id) => { const d = k.def(name); k.define(d, k.fn(params, body)); return d; };
  const emptyMap = k.def("empty map");
  k.define(emptyMap, k.call(MAP_V, k.x(NIL)));
  const emptySet = k.def("empty set");
  k.define(emptySet, k.call(SET_V, k.x(NIL)));
  const put = def("put", ["map", "key", "value"], (m, key, v) => entriesOf(m, (es) => k.call(MAP_V, k.call(putEntry, es, key, v))));
  const remove = def("remove key", ["map", "key"], (m, key) => entriesOf(m, (es) => k.call(MAP_V, k.call(removeEntry, es, key))));
  const lookup = def("value at", ["map", "key"], (m, key) => entriesOf(m, (es) => k.call(lookupEntry, es, key)));
  const updateAt = def("update at", ["map", "key", "default", "change"], (m, key, d, f) => entriesOf(m, (es) => k.call(MAP_V, k.call(updateEntry, es, key, d, f))));
  const hasKey = def("has key", ["map", "key"], (m, key) => entriesOf(m, (es) => k.call(hasEntry, es, key)));
  // Folded from the end of the list, so an earlier pair is put last: the
  // pairs reversed first, so a later pair wins, as puts in a row would.
  const pairsAsEntries = def("pairs as entries", ["pairs"], (ps) => k.fold(k.call(reverse, ps), [
    { variant: NIL, names: [], body: () => k.x(NIL) },
    { variant: CONS, names: ["pair", "rest"], results: [null, "entries"], body: ([pr], [, es]) => entry(pr, (key, v) => k.call(putEntry, es!, key, v)) },
  ]));
  const asMap = def("as map", ["pairs"], (ps) => k.call(MAP_V, k.call(pairsAsEntries, ps)));
  const entries = def("entries of", ["map"], (m) => entriesOf(m, (es) => es));
  const keys = def("keys of", ["map"], (m) => entriesOf(m, (es) => k.call(map, es, k.fn(["entry"], (e) => entry(e, (key) => key)))));
  const values = def("values of", ["map"], (m) => entriesOf(m, (es) => k.call(map, es, k.fn(["entry"], (e) => entry(e, (_, v) => v)))));
  const mergeMaps = def("merge maps", ["first", "second"], (a, b) => entriesOf(a, (ea) => entriesOf(b, (eb) => k.call(MAP_V, k.fold(eb, [
    { variant: NIL, names: [], body: () => ea },
    { variant: CONS, names: ["entry", "rest"], results: [null, "merged"], body: ([e], [, merged]) => entry(e, (key, v) => k.call(putEntry, merged!, key, v)) },
  ])))));
  const mapSize = def("map size", ["map"], (m) => entriesOf(m, (es) => k.call(length, es)));

  const asSet = def("as set", ["items"], (xs) => k.call(SET_V, k.fold(xs, [
    { variant: NIL, names: [], body: () => k.x(NIL) },
    { variant: CONS, names: ["item", "rest"], results: [null, "items"], body: ([x], [, r]) => k.call(addItem_, r!, x) },
  ])));
  const addItem = def("add item", ["set", "item"], (st, x) => itemsOf(st, (xs) => k.call(SET_V, k.call(addItem_, xs, x))));
  const removeItem = def("remove item", ["set", "item"], (st, x) => itemsOf(st, (xs) => k.call(SET_V, k.call(removeItem_, xs, x))));
  const has = def("has item", ["set", "item"], (st, x) => itemsOf(st, (xs) => k.call(hasItem_, xs, x)));
  const items = def("items of", ["set"], (st) => itemsOf(st, (xs) => xs));
  const setSize = def("set size", ["set"], (st) => itemsOf(st, (xs) => k.call(length, xs)));
  // The two ends of a set, and of a map's keys (L102, routes' LG1): the
  // items are sorted, so the smallest is the first and the largest the
  // last. Each is a Choice with no answer when there is none, as value at
  // is. The trees (map-tree.ts) walk down one side instead, in log n.
  // Haskell's Data.Set lookupMin and lookupMax, Rust's BTreeSet first and
  // last are the same jobs.
  const lastItem = k.def("last of items");
  k.define(lastItem, k.fn(["list"], (xs) => k.match(xs, [
    { variant: NIL, names: [], body: () => k.call(S.fail) },
    { variant: CONS, names: ["item", "rest"], body: ([x, rest]) => k.match(rest, [
      { variant: NIL, names: [], body: () => x },
      { variant: CONS, names: ["next", "after"], body: () => k.call(lastItem, rest) },
    ]) },
  ])));
  const firstOf = (xs: Id) => k.match(xs, [
    { variant: NIL, names: [], body: () => k.call(S.fail) },
    { variant: CONS, names: ["item", "rest"], body: ([x]) => x },
  ]);
  const keyOfEntry = (e: Id) => entry(e, (key) => key);
  const smallestItem = def("smallest item", ["set"], (st) => itemsOf(st, (xs) => firstOf(xs)));
  const largestItem = def("largest item", ["set"], (st) => itemsOf(st, (xs) => k.call(lastItem, xs)));
  const smallestKey = def("smallest key", ["map"], (m) => entriesOf(m, (es) => keyOfEntry(firstOf(es))));
  const largestKey = def("largest key", ["map"], (m) => entriesOf(m, (es) => keyOfEntry(k.call(lastItem, es))));
  // The three set operations: one walk down both sorted lists at once,
  // keeping what each wants from the smaller head, the shape of merge
  // sorted.
  const both = (name: string, keepLeft: boolean, keepBoth: boolean, keepRight: boolean) => {
    const d = k.def(name);
    k.define(d, k.fn(["xs", "ys"], (xs, ys) => k.match(xs, [
      { variant: NIL, names: [], body: () => (keepRight ? ys : k.x(NIL)) },
      { variant: CONS, names: ["x", "xs rest"], body: ([x, xr]) => k.match(ys, [
        { variant: NIL, names: [], body: () => (keepLeft ? xs : k.x(NIL)) },
        { variant: CONS, names: ["y", "ys rest"], body: ([y, yr]) => byOrder(x, y,
          () => { const r = k.call(d, xr, ys); return keepLeft ? k.call(CONS, x, r) : r; },
          () => { const r = k.call(d, xr, yr); return keepBoth ? k.call(CONS, x, r) : r; },
          () => { const r = k.call(d, xs, yr); return keepRight ? k.call(CONS, y, r) : r; }) },
      ]) },
    ])));
    return d;
  };
  const unionItems = both("union of items", true, true, true);
  const interItems = both("intersection of items", false, true, false);
  const diffItems = both("difference of items", true, false, false);
  const setOp = (name: string, f: Id) => def(name, ["a", "b"], (a, b) => itemsOf(a, (xs) => itemsOf(b, (ys) => k.call(SET_V, k.call(f, xs, ys)), "items₂")));
  const union = setOp("set union", unionItems);
  const intersection = setOp("set intersection", interItems);
  const difference = setOp("set difference", diffItems);

  // Errors as data (L67): `attempt` runs an action and keeps its answer or
  // its Abort as an Outcome, the way `optional` keeps a Choice; `value or
  // abort` is the Abort again, the way `value of` is the Choice. Rust's
  // Result and `?` are the influence.
  const attempt = k.def("attempt");
  k.define(attempt, k.fn(["action"], (action) => k.handle(k.call(OUTCOME_V.done, k.call(action)), [
    { variant: ABORT_OP, names: ["reason"], body: ([why]) => k.call(OUTCOME_V.refused, why) },
  ])));
  const valueOrAbort = k.def("value or abort");
  k.define(valueOrAbort, k.fn(["outcome"], (o) => k.match(o, [
    { variant: OUTCOME_V.done, names: ["value"], body: ([v]) => v },
    { variant: OUTCOME_V.refused, names: ["reason"], body: ([why]) => k.call(ABORT_OP, why) },
  ])));

  // Waiting for several things at once (BACKLOG L71b, ANSWERED-LATER.md
  // "Typing await and together"). together runs each action until it
  // awaits a ticket, parks its rest as a thunk that awaits that ticket
  // again (so every parked branch has one type, whatever its ticket's), and
  // asks outward which parked ticket is ready first: the world (L71c), or a
  // handler such as a test's. Prior art: Promise.all and Promise.race
  // (JavaScript), Trio's nursery and OCaml 5's Eio fibers, here a handler
  // written in the language.
  const ticketId = k.def("ticket id");
  k.define(ticketId, k.fn(["ticket"], (t) => k.match(t, [
    { variant: TICKET_V.ticket, names: ["number"], body: ([n]) => k.call(TICKET_V.ticket, n) },
    { variant: TICKET_V.timer, names: ["milliseconds", "value"], body: ([ms]) => k.call(TICKET_V.timer, ms, k.unitValue) },
    { variant: TICKET_V.firstReady, names: ["tickets", "which"], body: ([ts]) => k.call(TICKET_V.firstReady, ts, k.fn(["i"], () => k.unitValue)) },
  ])));
  const anyOf = k.def("any of");
  k.define(anyOf, k.fn(["tickets"], (ts) => k.call(TICKET_V.firstReady, ts, k.fn(["i"], (i) => i))));
  const startBranch = k.def("start branch");
  k.define(startBranch, k.fn(["action"], (a) => k.handle(k.call(a), [
    { variant: AWAIT_OP, names: ["ticket", "rest"], body: ([t, rest]) => k.call(BRANCH_V.parked, k.call(ticketId, t), k.thunk(() => k.call(rest, k.call(AWAIT_OP, t)))) },
    // Starting a timer is answered outward, and the branch goes on at once.
    { variant: START_TIMER_OP, names: ["milliseconds"], body: ([ms]) => k.call(START_TIMER_OP, ms) },
  ], ["value", (v) => k.call(BRANCH_V.done, v)])));
  const waiting = k.def("waiting tickets");
  k.define(waiting, k.fn(["branches"], (bs) => k.fold(bs, [
    { variant: NIL, names: [], body: () => NIL },
    { variant: CONS, names: ["branch", "rest"], results: [null, "waiting in rest"], body: ([b], [, r]) => k.match(b, [
      { variant: BRANCH_V.done, names: ["value"], body: () => r! },
      { variant: BRANCH_V.parked, names: ["ticket", "resume"], body: ([t]) => k.call(CONS, t, r!) },
    ]) },
  ])));
  const goOn = k.def("go on with");
  k.define(goOn, k.fn(["branches", "i"], (bs, i) => k.match(bs, [
    { variant: NIL, names: [], body: () => NIL },
    { variant: CONS, names: ["branch", "others"], body: ([b, others]) => k.match(b, [
      { variant: BRANCH_V.done, names: ["value"], body: () => k.call(CONS, b, k.call(goOn, others, i)) },
      { variant: BRANCH_V.parked, names: ["ticket", "resume"], body: ([, resume]) => k.if(k.equal(i, k.int(0)),
        k.call(CONS, k.call(resume), others),
        k.call(CONS, b, k.call(goOn, others, k.call(INT_OPS.sub, i, k.int(1))))) },
    ]) },
  ])));
  const finished = k.def("finished values");
  k.define(finished, k.fn(["branches"], (bs) => k.fold(bs, [
    { variant: NIL, names: [], body: () => NIL },
    { variant: CONS, names: ["branch", "rest"], results: [null, "values in rest"], body: ([b], [, r]) => k.match(b, [
      { variant: BRANCH_V.done, names: ["value"], body: ([v]) => k.call(CONS, v, r!) },
      { variant: BRANCH_V.parked, names: ["ticket", "resume"], body: () => r! },
    ]) },
  ])));
  const settle = k.def("settle");
  k.define(settle, k.fn(["branches"], (bs) => k.match(k.call(waiting, bs), [
    { variant: NIL, names: [], body: () => k.call(finished, bs) },
    { variant: CONS, names: ["first", "more"], body: ([f, m]) => k.call(settle, k.call(goOn, bs, k.call(AWAIT_OP, k.call(anyOf, k.call(CONS, f, m))))) },
  ])));
  const together = k.def("together");
  k.define(together, k.fn(["actions"], (as) => k.call(settle, k.call(map, as, startBranch))));
  // race and within (L71c): the first action to finish wins; the others
  // stay parked and are dropped, which is all cancelling them takes.
  const firstDone = k.def("first done");
  k.define(firstDone, k.fn(["branches"], (bs) => k.match(bs, [
    { variant: NIL, names: [], body: () => k.x(NONE) },
    { variant: CONS, names: ["branch", "others"], body: ([b, others]) => k.match(b, [
      { variant: BRANCH_V.done, names: ["value"], body: ([v]) => k.call(SOME, v) },
      { variant: BRANCH_V.parked, names: ["ticket", "resume"], body: () => k.call(firstDone, others) },
    ]) },
  ])));
  const raceSettle = k.def("race settle");
  k.define(raceSettle, k.fn(["branches"], (bs) => k.match(k.call(firstDone, bs), [
    { variant: SOME, names: ["value"], body: ([v]) => v },
    { variant: NONE, names: [], body: () => k.call(raceSettle, k.call(goOn, bs, k.call(AWAIT_OP, k.call(anyOf, k.call(waiting, bs))))) },
  ])));
  const race = k.def("race");
  k.define(race, k.fn(["actions"], (as) => k.call(raceSettle, k.call(map, as, startBranch))));
  const within = k.def("within");
  k.define(within, k.fn(["milliseconds", "action"], (ms, a) => k.let("timer", k.call(START_TIMER_OP, ms), (t) =>
    k.call(race, k.list(
      k.thunk(() => k.call(SOME, k.call(a))),
      k.thunk(() => k.seq(k.call(AWAIT_OP, t), k.x(NONE))),
    )))));
  const awaitHelpers = [startBranch, waiting, goOn, finished, settle, firstDone, raceSettle];

  const offered: Id[] = [extLess, extAdd, extNeg, extSub, extMul, minimum, maximum, each, map, keep, showNumbers, length, sum, append, reverse, inverse, conjugate, curry, uncurry, partially, flip, atMost, moreThan, atLeast, smaller, larger, notAfter, after, notBefore, fraction, whole, divF, showF, toNum, asC, unitI, conjC, modulus, angle, polar, divC, expC, csqrt, clog, cpow, casin, cacos, showC, tableProduct, complexTable, cliffordTable, cliffordAlgebra, cliffordProduct, cliffordReverse, cliffordInverse, cliffordSandwich, cliffordReflect, cliffordProject, cliffordExp, cliffordOuter, cliffordInner, cliffordGrade, cliffordDual, cliffordUndual, cliffordRegressive, cliffordPart, cliffordWithPart, matrixTable, itemAt, replaceAt, showDecimals, divD, slopeAt, dualTable, showD, asFixed, fixedF, showX, divX, sqrtX, sort, sortBy, attempt, valueOrAbort, emptyMap, asMap, put, updateAt, lookup, remove, hasKey, mergeMaps, keys, values, entries, mapSize, emptySet, asSet, addItem, removeItem, has, union, intersection, difference, items, setSize, smallestItem, largestItem, smallestKey, largestKey, ticketId, anyOf, together, race, within];
  const mapHelpers = [lastItem, putEntry, updateEntry, removeEntry, lookupEntry, hasEntry, pairsAsEntries, addItem_, removeItem_, hasItem_, unionItems, interItems, diffItems];
  const comments: Record<Id, string> = {
    [each]: "Runs the action on each item of the list in turn, for what it does (prints, writes a cell).",
    [map]: "The list of f(item) for each item, in the same order.",
    [length]: "How many items the list has.",
    [sum]: "The numbers of the list added up, for every number type as + is (Float64s, Ints, Rationals, …); 0 for an empty list.",
    [append]: "The items of the first list, then the items of the second.",
    [reverse]: "The list back to front.",
    [keep]: "filter, written as a choice: pick any item, fail unless it passes, collect what's left with all.",
    [showNumbers]: "A fold that prints. Run backwards it unfolds, so it parses.",
    [onto]: "A helper of reverse. Published with the module, not offered in the palette.",
    [inverse]: "The x that f takes to y: f run backwards, for any function value f. Several answers are a Choice, as with solve; a function that acts (prints, writes a cell) is refused when it's run.",
    [curry]: "f, taking its two inputs one at a time: curry(f)(a)(b) is f(a, b). Functions take all their inputs at once; this is for when one at a time is wanted.",
    [uncurry]: "The other way: a function that takes a and gives back a function of b, made into one function of (a, b).",
    [partially]: "f with its first input given: partially(f, a)(b) is f(a, b). map(xs, partially(add, 1)) adds 1 to each.",
    [flip]: "f with its two inputs swapped: flip(f)(a, b) is f(b, a).",
    [conjugate]: "g done in f's space: f, then g, then f run backwards (f⁻¹ ∘ g ∘ f). An edit in linear light, a turn about a point, a filter on one band of a signal.",
    [atMost]: "a ≤ b: not b < a.",
    [moreThan]: "a > b: b < a.",
    [atLeast]: "a ≥ b: not a < b.",
    [smaller]: "The smaller of two numbers (min); a shader's min.",
    [larger]: "The larger of two numbers (max); a shader's max.",
    [notAfter]: "Text a ≤ b: a comes before b or is b.",
    [after]: "Text a > b: b comes before a.",
    [notBefore]: "Text a ≥ b: b comes before a or is a.",
    [extLess]: "a < b for Extended numbers: −∞ is below every number and +∞ above, so the order is total. compare and sort give the same order.",
    [extAdd]: "a + b with ±∞: ∞ + 1 is ∞ and −∞ + −∞ is −∞. ∞ + −∞ has no answer.",
    [extNeg]: "−a with ±∞: −(+∞) is −∞.",
    [extSub]: "a − b with ±∞: ∞ − 1 is ∞. ∞ − ∞ has no answer.",
    [extMul]: "a · b with ±∞: −2 · ∞ is −∞ and −∞ · −∞ is ∞. 0 · ∞ has no answer.",
    [minimum]: "The smallest of the numbers, as an Extended: +∞ when there are none, so it is minimum's identity and a fold over an empty list still has an answer.",
    [maximum]: "The largest of the numbers, as an Extended: −∞ when there are none.",
    [fraction]: "top/bottom, exactly, in lowest terms (Euclid's algorithm, textbook); no answer when bottom is 0.",
    [whole]: "The whole number n as a fraction, n/1.",
    [divF]: "a ÷ b for fractions, exactly; no answer when b is 0.",
    [showF]: "A fraction as 3/4, or 3 when it is whole.",
    [toNum]: "The nearest Float64.",
    [addF]: "What + is at Rational. Not offered on its own: + is.",
    [subF]: "What − is at Rational. Not offered on its own: − is.",
    [mulF]: "What · is at Rational. Not offered on its own: · is.",
    [negF]: "What −x is at Rational. Not offered on its own: − is.",
    [lessF]: "What < is at Rational. Not offered on its own: < is.",
    [sort]: "The list in order: numbers by value, text alphabetically (by code point), cases in the order their type lists them, then field by field (compare). A merge sort (von Neumann, 1945), bottom-up so it surely finishes: n log n steps.",
    [itemAt]: "The item at a position, counting from 0, or `otherwise` when the list has none there: item at([a, b, c], 1, z) is b, item at([a], 5, z) is z. n steps.",
    [replaceAt]: "The list with the item at a position, counting from 0, replaced by `by`; the list as it was when it has no item there. n steps.",
    [showDecimals]: "x as text with `places` digits after the point, rounded half away from 0 and keeping trailing zeros: show decimals(2.5, 3) is \"2.500\", show decimals(-0.0004, 3) is \"0.000\". For when show's up to nine places would jump about.",
    [sortBy]: "The list in the order of key(item), by compare: sort by(roads, length of) puts the shortest first, sort by(rows, (r) → −amount of(r)) the largest. Items with the same key keep their order (a stable sort; Python's key=, Haskell's sortOn). n log n steps, each calling key.",
    [mergeByKey]: "Two lists sorted by key as one. A helper of sort by, not offered.",
    [addRunByKey]: "A helper of sort by, as add run is of sort. Not offered.",
    [attempt]: "The action's answer as done(answer), or refused(reason) when it aborts: an Abort kept as data, so it can go in a list (Rust's Result is the influence).",
    [valueOrAbort]: "The value in done(value); refused(reason) aborts with the reason again. attempt run backwards.",
    [emptyMap]: "The map with no entries.",
    [asMap]: "The map of a list of pair(key, value); when a key comes twice, the later pair wins. Keys are kept in compare's order, so a map has one spelling and folds go in key order (Haskell's Data.Map, Rust's BTreeMap).",
    [put]: "The map with key holding value, in place of what it held.",
    [updateAt]: "The map with key holding change(what it held), or change(default) when it held nothing: one walk, where put(m, k, change(first(value at(m, k), default))) looks the key up twice. Counting is update at(counts, word, 0, partially(add, 1)). Haskell's Data.Map alter and Rust's entry API are the same job.",
    [lookup]: "What key holds; no answer when the map hasn't got it, so first(value at(m, k), else d) gives a default.",
    [remove]: "The map without key.",
    [hasKey]: "Whether the map holds key.",
    [mergeMaps]: "The entries of both maps; where both hold a key, the second's value wins.",
    [keys]: "The keys, in order.",
    [values]: "The values, in the order of their keys.",
    [entries]: "The entries as pair(key, value), in key order.",
    [mapSize]: "How many keys the map holds.",
    [emptySet]: "The set with no items.",
    [asSet]: "The set of a list's items: in compare's order, each once.",
    [addItem]: "The set with item in it.",
    [removeItem]: "The set without item.",
    [has]: "Whether the set has item.",
    [union]: "The items in either set.",
    [intersection]: "The items in both sets.",
    [difference]: "The items of the first set that aren't in the second.",
    [items]: "The items, in order.",
    [setSize]: "How many items the set has.",
    [smallestItem]: "The set's smallest item, in compare's order; no answer when the set is empty, so first(smallest item(s), else d) gives a default. Nearest first in a set of pair(distance, place).",
    [largestItem]: "The set's largest item, in compare's order; no answer when the set is empty.",
    [smallestKey]: "The map's smallest key, in compare's order; no answer when the map is empty. value at(m, smallest key(m)) is what it holds.",
    [largestKey]: "The map's largest key, in compare's order; no answer when the map is empty.",
    ...Object.fromEntries(mapHelpers.map((d) => [d, "A helper of the map and set operations: a walk down the sorted list. Not offered."])),
    [mergeSorted]: "Two sorted lists as one. A helper of sort, not offered.",
    [addRun]: "A helper of sort: a sorted run added to the slots of runs, like adding 1 to a binary number. Not offered.",
    [asC]: "The Float64 x as a complex number, x + 0i.",
    [unitI]: "i, the square root of −1: i · i is −1.",
    [conjC]: "a − bi for a + bi: the same point mirrored across the real line. z · conjugate(z) is |z|².",
    [modulus]: "|z|, how far z is from 0 (the vectors module's magnitude says the same).",
    [angle]: "The angle from the positive real line to z, in radians, between −π and π (atan2).",
    [polar]: "The complex number size away from 0 at this angle: size·(cos angle + i sin angle).",
    [divC]: "z ÷ w for complex numbers; no answer when w is 0.",
    [expC]: "e to the z: eᵃ(cos b + i sin b) for a + bi, Euler's formula (textbook). complex exp(i · π) is −1.",
    [csqrt]: "√z for a complex number, the root with a real part of 0 or more: complex sqrt(−4) is 2i. Float64's sqrt has no answer below 0; this one always has.",
    [clog]: "log z for a complex number: log|z| + i·(its angle, between −π and π). complex log(−1) is iπ. No answer at 0.",
    [cpow]: "z to the power w, e^(w · log z), the principal value: complex power(−8, 1/3) is 1 + 1.732i. 0 to a power with a real part above 0 is 0; to any other, no answer.",
    [casin]: "asin z for a complex number, the principal value: complex asin(2) is π/2 + 1.317i. Float64's asin has no answer outside −1 to 1; this one always has.",
    [cacos]: "acos z for a complex number, the principal value: complex acos(2) is −1.317i. Float64's acos has no answer outside −1 to 1; this one always has.",
    [showC]: "A complex number as 3 + 4i or 3 − 4i.",
    [addC]: "What + is at Complex. Not offered on its own: + is.",
    [subC]: "What − is at Complex. Not offered on its own: − is.",
    [tableProduct]: "a · b in an algebra given by its multiplication table: each line says what two basis elements multiply to, as times(i, i, −1). Complex numbers, dual numbers and quaternions are each one table (ALGEBRA-TABLES.md).",
    [complexTable]: "Complex's multiplication table: 1 · 1 = 1, 1 · i = i, i · 1 = i, i · i = −1. table product(complex table, z, w) is z · w.",
    [mulC]: "What · is at Complex: (a + bi)(c + di) = (ac − bd) + (ad + bc)i. Not offered on its own: · is.",
    [negC]: "What −x is at Complex. Not offered on its own: − is.",
    ...Object.fromEntries(numberOnly.map((d) => [d, "The Float64-only version from before the one generic <, kept so programs saved before still open. Not offered: the generic one is."])),
    [trigF]: "How Float64 does Trig: its builtin sin, cos, tan, exp and log. Found by its type, so not offered: sin is.",
    [addD]: "What + is at Dual. Not offered on its own: + is.",
    [subD]: "What − is at Dual. Not offered on its own: − is.",
    [mulD]: "What · is at Dual, the product rule: (a + a′ε)(b + b′ε) = ab + (ab′ + a′b)ε, since ε · ε is 0. Not offered on its own: · is.",
    [negD]: "What −x is at Dual. Not offered on its own: − is.",
    [divD]: "x ÷ y for dual numbers, the quotient rule; no answer when y's value is 0.",
    [sinD]: "sin at Dual, by the chain rule: sin(a + a′ε) = sin a + cos a · a′ε. Not offered on its own: sin is.",
    [cosD]: "cos at Dual: cos a − sin a · a′ε. Not offered on its own: cos is.",
    [tanD]: "tan at Dual: tan a + a′/cos² a · ε. Not offered on its own: tan is.",
    [expD]: "exp at Dual: eᵃ + eᵃ · a′ε. Not offered on its own: exp is.",
    [logD]: "log at Dual: log a + a′/a · ε. Not offered on its own: log is.",
    [trigD]: "How Dual does Trig: the chain rule for each. Found by its type, so not offered: sin is.",
    [slopeAt]: "f′(x), worked out by giving f the dual number x + 1ε and reading the slope of what comes back (forward-mode automatic differentiation). f must work on duals: write it with the generic + − · and Trig. derivative(f) gives the same number by differentiating f's code.",
    [matrixTable]: "The multiplication table of n × n matrices, for table product, from rows of basis elements: E_ij · E_jl = E_il and every other product of two of them is 0. Mat2, Mat3 and Mat4 use it for their ·.",
    [cliffordReverse]: "x̃, the reverse of x in the algebra (clifford algebra makes one): each blade's vectors in the opposite order, so e₁₂ becomes −e₁₂ and vectors stay. A rotor R turns a vector v into R · v · R̃. In Cl(3, 0) the rotor that turns by θ in the e₁e₂ plane is cos(θ/2) − sin(θ/2)e₁₂, and the rotors 1, e₂₃, e₁₃, e₁₂ multiply as the quaternions do.",
    [cliffordSandwich]: "r · x · r̃ in the algebra (clifford algebra makes one): how a rotor or a motor moves x. In Cl(3, 0) a rotor turns vectors; in projective geometric algebra ([1, 1, 1, 0]) a motor turns and moves points, and two motors compose by their product.",
    [cliffordInverse]: "v⁻¹ for a versor v, ṽ / (v ṽ): a non-null vector's, a rotor's, a motor's or a blade's, for which v ṽ is a number. No answer when v ṽ isn't a number (v isn't a versor, such as 1 + e₁) or is 0 (a null vector such as e₀ in projective geometric algebra). clifford versor inverse(algebra, 2e₁) is ½e₁.",
    [cliffordReflect]: "n̂ · x · n⁻¹: x reflected in the plane (in n dimensions, the hyperplane) that is perpendicular to the vector n. In projective geometric algebra, n is a plane and x a point, which comes back with weight −1, the same point.",
    [cliffordProject]: "The part of the vector x that lies in the blade b, ½(x − b̂ x b⁻¹): onto a line when b is a vector, onto a plane when b is a bivector such as e₁e₂. b must not be null (b b̃ ≠ 0).",
    [cliffordExp]: "e^b for a bivector b whose square is a number: a rotor when b² < 0, 1 + b when b² = 0 (a translator in projective geometric algebra) and cosh/sinh when b² > 0. The rotor turning by θ in the plane B with B² = −1 is clifford exp(algebra, −θ/2 · B). When b² isn't a number (a field with E·B ≠ 0, a screw motion), it sums the series instead, by scaling and squaring.",
    [cliffordOuter]: "a ∧ b, the outer product in the algebra (clifford algebra makes one): e_A ∧ e_B is e_A e_B when the blades share no vector, else 0. Two vectors span a plane (e₁ ∧ e₂ = e₁₂), and a vector with itself gives 0.",
    [cliffordInner]: "a ⌋ b, the left contraction: e_A ⌋ e_B is e_A e_B when every vector of A is in B, else 0. A vector contracted with a bivector gives the vector in that plane at right angles to it (e₁ ⌋ e₁₂ = e₂); a vector with a vector is their dot product.",
    [cliffordGrade]: "x's grade-k part: only its parts on blades of k vectors. Grade 0 is the scalar, 1 the vector, 2 the bivector.",
    [cliffordDual]: "x's dual by complement: e_A becomes ± e_Ā, the blade of the vectors A doesn't have, signed so that e_A ∧ dual(e_A) is the pseudoscalar. It works in projective geometric algebra, whose pseudoscalar squares to 0.",
    [cliffordUndual]: "Undoes clifford dual: clifford undual(algebra, clifford dual(algebra, x)) is x.",
    [cliffordRegressive]: "a ∨ b, the regressive product, undual(dual(a) ∧ dual(b)): in projective geometric algebra the line through two points, or the point where two lines meet in the plane.",
    [cliffordPart]: "x's part on a blade named by its vectors, numbered from 1 in the order of the algebra's squares: clifford part(algebra, x, [1, 2]) reads e₁₂. In projective geometric algebra ([1, 1, 1, 0]) e₀ is vector 4. Another order flips the sign once per swap ([2, 1] reads −e₁₂), and a vector named twice reads 0.",
    [cliffordWithPart]: "x with its part on a blade, named by its vectors as clifford part names it, set to `value`, the other parts kept: clifford with part(algebra, zero, [1, 2], 2) is 2e₁₂. Several calls build a multivector by blade.",
    [cliffordProduct]: "a · b, the geometric product in the algebra (clifford algebra makes one): table product with the algebra's table.",
    [cliffordAlgebra]: "A Clifford algebra, built once: its basis vectors square to `squares` (1, −1 or 0 each) and `basis` is your record type's basis elements, in clifford table's order. It holds the multiplication table, so clifford sandwich, reflect, exp and the others take it and don't build a table on every call. Make it once, as a definition: pga = clifford algebra([1, 1, 1, 0], basis).",
    [cliffordTable]: "The multiplication table of a Clifford algebra, for table product: its basis vectors square to `squares` (1, −1 or 0 each; Cl(p, q, r) is p ones, q minus ones, r zeros), and `basis` is your record type's basis elements in the order 1, e₁, e₂, e₁e₂, e₃, e₁e₃, e₂e₃, e₁e₂e₃, … . clifford table([−1], …) is the complex numbers, [0] the dual numbers, [1] the split-complex ones, [−1, −1] the quaternions (i = e₁, j = e₂, k = e₁e₂), [1, 1, 1] Cl(3, 0) and [1, 1, 1, 0] projective geometric algebra (ALGEBRA-TABLES.md).",
    [dualTable]: "Dual numbers' multiplication table: 1 · 1 = 1, 1 · ε = ε, ε · 1 = ε, and ε · ε = 0, which needs no line. table product(dual table, x, y) is x · y.",
    [showD]: "A dual number as 3 + 2ε.",
    [asFixed]: "A whole number as a Fixed, exactly.",
    [fixedF]: "A Fixed as the nearest Float64, for drawing or printing. Past 2⁵³ steps (about 2 million) it drops the last bits; the Fixed keeps them.",
    [showX]: "A Fixed as text: the shortest decimal that reads back to the same steps, so 0.1 shows as 0.1 and every step shows differently.",
    [divX]: "a ÷ b for Fixed, rounded down to a step; no answer when b is 0.",
    [sqrtX]: "√x for Fixed, rounded down to a step, the same bits on every machine; no answer below 0.",
    ...Object.fromEntries(arithmetics.map((d) => [d, "How this number type does + − · −x (Arithmetic) or < (Ordered): its own operations. Found by its type, so not offered: + and < are."])),
    [ticketId]: "The same ticket with what it gives forgotten (a Ticket Unit), so tickets of different types can go in one list for any of.",
    [anyOf]: "A ticket for whichever of these tickets is ready first: await(any of(tickets)) gives its position, from 0.",
    [together]: "Runs the actions side by side: each runs until it awaits a ticket, and whichever ticket is ready first goes on, until every action has its value. The values come back in the actions' order (as JavaScript's Promise.all).",
    [race]: "Runs the actions side by side, as together does, and gives the value of the first to finish; the others are dropped where they wait (as JavaScript's Promise.race).",
    [within]: "The action's value as some(value) if it finishes within this many milliseconds, or none if the timer is ready first; the action is then dropped where it waits.",
    ...Object.fromEntries(awaitHelpers.map((d) => [d, "A helper of together and race. Not offered in the palette."])),
    [applied]: "A helper of inverse: f(x), as a definition solve can name. Not offered in the palette.",
  };
  const p = publish(merge(prelude, std, k.code), k.names, [...offered, onto, applied, ...awaitHelpers, ...arithmetics, trigF, addD, subD, mulD, negD, sinD, cosD, tanD, expD, logD, trigD, sinX, cosX, tanX, expX, logX, trigX, cosBySin, sinByCos, polarBy, sinByPolar, cosByPolar, polarF, unpolarF, unpolarD, unpolarX, vector, asinBy, acosBy, asinF, acosF, asinX, acosX, addF, subF, mulF, negF, lessF, addC, subC, mulC, negC, ...numberOnly, mergeSorted, addRun, mergeByKey, addRunByKey, ...mapHelpers, ...laws], merge(prelude, std));
  if (!p.ok) throw new Error(`the prelude can't be published: ${p.reason}`);
  const at = (d: Id) => p.rename.get(d)!;
  const notes = Object.fromEntries(Object.entries(comments).map(([d, c]) => [at(d), c]));
  return makeModule("prelude", p.code, p.names, offered.map(at), p.pins, notes, [...awaitHelpers, addF, subF, mulF, negF, lessF, addC, subC, mulC, negC, ...numberOnly, mergeSorted, addRun, mergeByKey, addRunByKey, ...mapHelpers, ...arithmetics, trigF, addD, subD, mulD, negD, sinD, cosD, tanD, expD, logD, trigD, sinX, cosX, tanX, expX, logX, trigX, cosBySin, sinByCos, polarBy, sinByPolar, cosByPolar, polarF, unpolarF, unpolarD, unpolarX, vector, asinBy, acosBy, asinF, acosF, asinX, acosX, ...laws].map(at));
}
