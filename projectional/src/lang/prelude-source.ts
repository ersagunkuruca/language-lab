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
import { ABORT_OP, ARITH, COMPARE, COMPLEX_V, CONS, FALSE, INT_OPS, MAP_V, NIL, NONE, ORDER_V, OUTCOME_V, PAIR_V, RATIO, S, SET_V, SOME, TEXT_OPS, TIMES_V, TRIG_V, TRUE, DUAL_V, ARITHMETIC_V, ORDERED_V, ALGEBRAIC_OPS, std } from "./std.ts";

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
    { variant: CONS, names: ["n", "rest"], results: [null, "sum of rest"], body: ([n], [, r]) => k.call(B.add, n, r!) },
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
  const polar = k.def("polar");
  k.define(polar, k.fn(["size", "angle"], (r, t) => C(n.mul(r, k.call(B.cos, t)), n.mul(r, k.call(B.sin, t)))));
  const divC = twoC("divide complex", (a, b, c, d) => k.let("c² + d²", n.add(n.mul(c, c), n.mul(d, d)), (m) =>
    k.if(k.call(S.equal, m, k.lit(0)), k.call(S.fail), C(n.div(n.add(n.mul(a, c), n.mul(b, d)), m), n.div(n.sub(n.mul(b, c), n.mul(a, d)), m)))));
  const expC = k.def("complex exp");
  k.define(expC, k.fn(["z"], (z) => cx(z, (a, b) => k.let("eᵃ", k.call(B.exp, a), (e) => C(n.mul(e, k.call(B.cos, b)), n.mul(e, k.call(B.sin, b)))))));
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
  const trigF = k.def("trig at float64");
  k.define(trigF, k.call(TRIG_V, ...[B.sin, B.cos, B.tan, B.exp, B.log].map((b) => k.x(b))));

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
  const tanD = oneD("dual tan", (a, a1) => k.let("cos", k.call(B.cos, a), (c) => D(k.call(B.tan, a), n.div(a1, n.mul(c, c)))));
  const expD = oneD("dual exp", (a, a1) => k.let("eᵃ", k.call(B.exp, a), (e) => D(e, n.mul(e, a1))));
  const logD = oneD("dual log", (a, a1) => D(k.call(B.log, a), n.div(a1, a)));
  const trigD = k.def("trig at dual");
  k.define(trigD, k.call(TRIG_V, ...[sinD, cosD, tanD, expD, logD].map((d) => k.x(d))));
  const slopeAt = k.def("slope by duals");
  k.define(slopeAt, k.fn(["f", "x"], (f, x) => du(k.call(f, D(x, k.lit(1))), (_, a1) => a1)));
  const dualTable = k.def("dual table");
  k.define(dualTable, k.list(...([[1, 0, 1, 0, 1, 0], [1, 0, 0, 1, 0, 1], [0, 1, 1, 0, 0, 1]] as const).map(([a, b, c, d, e, f]) =>
    k.call(TIMES_V, D(k.lit(a), k.lit(b)), D(k.lit(c), k.lit(d)), D(k.lit(e), k.lit(f))))));
  const showD = oneD("show dual", (a, a1) => k.call(S.concat, k.call(S.show, a), k.call(S.concat,
    k.if(k.call(S.less, a1, k.lit(0)), k.lit(" − "), k.lit(" + ")), k.call(S.concat, k.call(S.show, k.call(S.abs, a1)), k.lit("ε")))));

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

  const offered: Id[] = [each, map, keep, showNumbers, length, sum, append, reverse, inverse, conjugate, curry, uncurry, partially, flip, atMost, moreThan, atLeast, smaller, larger, notAfter, after, notBefore, fraction, whole, divF, showF, toNum, asC, unitI, conjC, modulus, angle, polar, divC, expC, showC, tableProduct, complexTable, cliffordTable, divD, slopeAt, dualTable, showD, sort, attempt, valueOrAbort, emptyMap, asMap, put, lookup, remove, hasKey, mergeMaps, keys, values, entries, mapSize, emptySet, asSet, addItem, removeItem, has, union, intersection, difference, items, setSize];
  const mapHelpers = [putEntry, removeEntry, lookupEntry, hasEntry, pairsAsEntries, addItem_, removeItem_, hasItem_, unionItems, interItems, diffItems];
  const comments: Record<Id, string> = {
    [each]: "Runs the action on each item of the list in turn, for what it does (prints, writes a cell).",
    [map]: "The list of f(item) for each item, in the same order.",
    [length]: "How many items the list has.",
    [sum]: "The Float64s of the list added up; 0 for an empty list.",
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
    [attempt]: "The action's answer as done(answer), or refused(reason) when it aborts: an Abort kept as data, so it can go in a list (Rust's Result is the influence).",
    [valueOrAbort]: "The value in done(value); refused(reason) aborts with the reason again. attempt run backwards.",
    [emptyMap]: "The map with no entries.",
    [asMap]: "The map of a list of pair(key, value); when a key comes twice, the later pair wins. Keys are kept in compare's order, so a map has one spelling and folds go in key order (Haskell's Data.Map, Rust's BTreeMap).",
    [put]: "The map with key holding value, in place of what it held.",
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
    [cliffordTable]: "The multiplication table of a Clifford algebra, for table product: its basis vectors square to `squares` (1, −1 or 0 each; Cl(p, q, r) is p ones, q minus ones, r zeros), and `basis` is your record type's basis elements in the order 1, e₁, e₂, e₁e₂, e₃, e₁e₃, e₂e₃, e₁e₂e₃, … . clifford table([−1], …) is the complex numbers, [0] the dual numbers, [1] the split-complex ones, [−1, −1] the quaternions (i = e₁, j = e₂, k = e₁e₂), [1, 1, 1] Cl(3, 0) and [1, 1, 1, 0] projective geometric algebra (ALGEBRA-TABLES.md).",
    [dualTable]: "Dual numbers' multiplication table: 1 · 1 = 1, 1 · ε = ε, ε · 1 = ε, and ε · ε = 0, which needs no line. table product(dual table, x, y) is x · y.",
    [showD]: "A dual number as 3 + 2ε.",
    ...Object.fromEntries(arithmetics.map((d) => [d, "How this number type does + − · −x (Arithmetic) or < (Ordered): its own operations. Found by its type, so not offered: + and < are."])),
    [applied]: "A helper of inverse: f(x), as a definition solve can name. Not offered in the palette.",
  };
  const p = publish(merge(prelude, std, k.code), k.names, [...offered, onto, applied, ...arithmetics, trigF, addD, subD, mulD, negD, sinD, cosD, tanD, expD, logD, trigD, addF, subF, mulF, negF, lessF, addC, subC, mulC, negC, ...numberOnly, mergeSorted, addRun, ...mapHelpers], merge(prelude, std));
  if (!p.ok) throw new Error(`the prelude can't be published: ${p.reason}`);
  const at = (d: Id) => p.rename.get(d)!;
  const notes = Object.fromEntries(Object.entries(comments).map(([d, c]) => [at(d), c]));
  return makeModule("prelude", p.code, p.names, offered.map(at), p.pins, notes, [addF, subF, mulF, negF, lessF, addC, subC, mulC, negC, ...numberOnly, mergeSorted, addRun, ...mapHelpers, ...arithmetics, trigF, addD, subD, mulD, negD, sinD, cosD, tanD, expD, logD, trigD].map(at));
}
