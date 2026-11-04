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
import { ZONE_OPS, ABORT_OP, ARITH, CELL_OPS, COMPARE, COMPLEX_V, CONS, FALSE, INT_OPS, MAP_V, NIL, NONE, ORDER_V, OUTCOME_V, PAIR_V, RATIO, S, SET_V, SOME, TEXT_OPS, TIMES_V, ALGEBRA_V, TRIG_V, TRIG_POLAR, TRIG_UNPOLAR, TRIG_ASIN, TRIG_ACOS, TRUE, TICKET_V, AWAIT_OP, START_TIMER_OP, NOW_OP, WAIT_OP, BRANCH_V, DUAL_V, FIXED_V, MAT_V, ARITHMETIC_V, TRIG_OPS, ORDERED_V, DIVISION_V, SHOWN_V, BITS_V, WORD_SIZES, WORD_V, EXTENDED_V, ALGEBRAIC_OPS, CHECK_OP, RANDOM_OP, QUEUE_V, PRIORITY_QUEUE_V, MATRIX_V, TENSOR_V, BYTES_V, JSON_V, DATE_V, TIME_OF_DAY_V, INSTANT_V, EMBEDDING_V, STATE_OPS, PIPE_OPS, std } from "./std.ts";

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
  // Text's copies of ≤ > ≥, from before Text had the one < (L152): kept so
  // programs saved before still open, not offered.
  const textOnly = [notAfter, after, notBefore];
  // Letters and digits, and a text's case (BACKLOG L133, GAPS round 6
  // NG1: notebook wrote lower, wordy and between with character codes, calc
  // its own digit and letter). The English letters A to Z and the digits 0
  // to 9 only, as C's isalpha and isdigit in the "C" locale; other
  // alphabets' letters and cases are left as they are for now.
  const inRange = (c: Id, lo: string, hi: string) => k.and(k.equal(k.call(TEXT_OPS.length, c), k.int(1)),
    k.and(k.call(S.not, k.call(TEXT_OPS.less, c, k.lit(lo))), k.call(S.not, k.call(TEXT_OPS.less, k.lit(hi), c))));
  const isDigit = k.def("is digit");
  k.define(isDigit, k.fn(["character"], (c) => inRange(c, "0", "9")));
  const isLetter = k.def("is letter");
  k.define(isLetter, k.fn(["character"], (c) => k.call(S.or, inRange(c, "a", "z"), inRange(c, "A", "Z"))));
  // One character moved between the cases, by its code: A to Z and a to z
  // are 32 apart.
  const shifted = (name: string, lo: string, hi: string, by: number) => {
    const d = k.def(name);
    k.define(d, k.fn(["character"], (c) => k.if(inRange(c, lo, hi),
      k.call(S.first, k.thunk(() => k.call(TEXT_OPS.fromCode, k.call(INT_OPS.add, k.call(TEXT_OPS.code, c), k.int(by)))), k.thunk(() => c)), c)));
    return d;
  };
  const lowerOne = shifted("lowercase character", "A", "Z", 32), upperOne = shifted("uppercase character", "a", "z", -32);
  // A to Z only, for identifiers, hex and protocols (L214b): people's text
  // goes through `uppercase(text, in: locale)`, whose answer depends on
  // the language (Turkish i goes up to İ).
  const lowercase = k.def("ascii lowercase");
  k.define(lowercase, k.fn(["text"], (t) => k.call(TEXT_OPS.joinAll, k.call(map, k.call(TEXT_OPS.characters, t), lowerOne), k.lit(""))));
  const uppercase = k.def("ascii uppercase");
  k.define(uppercase, k.fn(["text"], (t) => k.call(TEXT_OPS.joinAll, k.call(map, k.call(TEXT_OPS.characters, t), upperOne), k.lit(""))));
  // A text's start and end (BACKLOG L134, GAPS round 6 NG2): notebook
  // wrote ends with from length and slice, and routes its blank-line test.
  const startsWith = k.def("starts with");
  k.define(startsWith, k.fn(["text", "start"], (t, p) => k.let("n", k.call(TEXT_OPS.length, p), (m) =>
    k.and(k.call(S.not, k.call(INT_OPS.less, k.call(TEXT_OPS.length, t), m)), k.equal(k.call(TEXT_OPS.slice, t, k.int(0), m), p)))));
  const endsWith = k.def("ends with");
  k.define(endsWith, k.fn(["text", "end"], (t, p) => k.let("length", k.call(TEXT_OPS.length, t), (l) =>
    k.let("n", k.call(TEXT_OPS.length, p), (m) =>
      k.and(k.call(S.not, k.call(INT_OPS.less, l, m)), k.equal(k.call(TEXT_OPS.slice, t, k.call(INT_OPS.sub, l, m), l), p))))));

  // A text's inside (L169, REVIEW-2026-11-02d §4): board spelled "the
  // title has these words" as not (find(…) < 0) under a first, and machine
  // sliced after starts with five times. contains text is find's Choice
  // asked only whether there is a position (Python's `in`, JavaScript's
  // includes); after prefix is starts with and the slice as one Choice,
  // "if it starts so, the rest" (Python 3.9's removeprefix, which gives
  // the text unchanged instead of no answer).
  const containsText = k.def("contains text");
  k.define(containsText, k.fn(["text", "part"], (t, p) => k.call(S.first, k.thunk(() => k.seq(k.call(TEXT_OPS.find, t, p), k.true)), k.thunk(() => k.false))));
  const afterPrefix = k.def("after prefix");
  k.define(afterPrefix, k.fn(["text", "prefix"], (t, p) => k.if(k.call(startsWith, t, p), k.call(TEXT_OPS.slice, t, k.call(TEXT_OPS.length, p), k.call(TEXT_OPS.length, t)), k.call(S.fail))));

  // A text repeated and padded, a list of lists flattened (BACKLOG L148,
  // GAPS round 7 SL3 and SL4: sheet wrote spaces, padded and flattened
  // itself). JavaScript's repeat, padStart and padEnd, and flat and
  // flatMap (Haskell's concat and concatMap).
  const repeated = k.def("repeated");
  k.define(repeated, k.fn(["text", "times"], (t, n) => k.call(TEXT_OPS.joinAll, k.call(map, k.call(INT_OPS.range, n), k.fn(["i"], () => t)), k.lit(""))));
  const padding = (t: Id, w: Id, fill: Id, put: (pad: Id) => Id) => k.let("short by", k.call(INT_OPS.sub, w, k.call(TEXT_OPS.length, t)), (by) =>
    k.if(k.call(INT_OPS.less, k.int(0), by), put(k.call(TEXT_OPS.slice, k.call(repeated, fill, by), k.int(0), by)), t));
  const padStart = k.def("padded start");
  k.define(padStart, k.fn(["text", "width", "fill"], (t, w, fill) => padding(t, w, fill, (pad) => k.call(S.concat, pad, t))));
  const padEnd = k.def("padded end");
  k.define(padEnd, k.fn(["text", "width", "fill"], (t, w, fill) => padding(t, w, fill, (pad) => k.call(S.concat, t, pad))));

  // Grammar pieces (L70a, GRAMMARS-2026-11-02): a printer written with
  // them reads text when run backwards. Each prints one way and reads
  // several (relate.ts's grammarGoal): `spaced` any spaces around, none
  // too, and `optional parens` the parentheses a printer leaves out where
  // they aren't needed. Rendel and Ostermann's invertible syntax
  // descriptions and Boomerang's canonical lenses (docs/language/CREDITS.md).
  const spaced = k.def("spaced");
  k.define(spaced, k.fn(["text"], (t) => k.call(S.concat, k.lit(" "), k.call(S.concat, t, k.lit(" ")))));
  const optionalParens = k.def("optional parens");
  k.define(optionalParens, k.fn(["needed", "text"], (needed, t) => k.if(needed, k.call(S.concat, k.lit("("), k.call(S.concat, t, k.lit(")"))), t)));
  const flatten = k.def("flatten");
  k.define(flatten, k.fn(["lists"], (ls) => k.fold(ls, [
    { variant: NIL, names: [], body: () => NIL },
    { variant: CONS, names: ["list", "rest"], results: [null, "rest flattened"], body: ([l], [, r]) => k.call(append, l, r!) },
  ])));
  const flatMap = k.def("flat map");
  k.define(flatMap, k.fn(["list", "f"], (xs, f) => k.call(flatten, k.call(map, xs, f))));

  // Ends of a Choice that can't happen, or has a plain default (L174, GAPS
  // round 10 KL1): clinic wrote `int of`, `share` and three more to end
  // one. A Float64 is finite (L125), so the whole number at or below one
  // always exists; `whole part` stays a Choice for the programs that
  // handle it. `divided or` is a / b, or the default when b is 0.
  const wholeOf = k.def("whole of");
  k.define(wholeOf, k.fn(["x"], (x) => k.call(S.first, k.thunk(() => k.call(INT_OPS.wholePart, x)), k.thunk(() => k.int(0)))));
  const dividedOr = k.def("divided or");
  k.define(dividedOr, k.fn(["a", "b", "otherwise"], (a, b, o) => k.call(S.first, k.thunk(() => k.call(B.div, a, b)), k.thunk(() => o))));

  // The Ints from start up to end, end left out (BACKLOG L147, GAPS round
  // 7 SL2: sheet counted `numbers from` itself), as Python's range(a, b).
  const rangeFrom = k.def("range from");
  k.define(rangeFrom, k.fn(["start", "end"], (a, b) => k.call(map, k.call(INT_OPS.range, k.call(INT_OPS.sub, b, a)), k.fn(["i"], (i) => k.call(INT_OPS.add, a, i)))));

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
  const toNum = k.def("as float64");
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
  const onUnpolar = (x: Id, y: Id) => k.solve(TRIG_UNPOLAR, { 0: x, 1: y, out: k.true }, { 3: "angle" }, ({ 3: t }) => t);
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
  // Two Float64s that agree to the precision floats carry: within 1e-9 of
  // each other, relative to their size. `equal` is exact (L197, Ersagun's
  // choice 2026-11-03); near is how a program says "the same up to
  // rounding", as a law over floats does: √2 · √2 is near 2, not equal to
  // it. The solver checks an answer it found the same way (run.ts close).
  const near = k.def("near");
  k.define(near, k.fn(["a", "b"], (a, b) => k.let("gap", k.call(S.abs, n.sub(a, b)), (gap) =>
    k.call(S.not, k.call(S.less, n.mul(k.lit(1e-9), n.add(n.add(k.lit(1), k.call(S.abs, a)), k.call(S.abs, b))), gap)))));
  // Two complex numbers near part by part: what the laws below check.
  const nearC = (w: Id, z: Id) => cx(w, (a, b) => cx(z, (c, d) => k.and(k.call(near, a, c), k.call(near, b, d)), ["re2", "im2"]));
  const lawFromPolar = k.def("from polar undoes modulus and angle");
  k.define(lawFromPolar, k.fn(["z"], (z) => expect(nearC(k.call(polar, k.call(modulus, z), k.call(angle, z)), z), "from polar(modulus z, angle of z) is near z")));
  const lawPolar = k.def("polar undoes unpolar");
  k.define(lawPolar, k.fn(["z"], (z) => cx(z, (a, b) =>
    k.solve(TRIG_UNPOLAR, { 0: a, 1: b, out: k.true }, { 2: "length", 3: "angle" }, ({ 2: r, 3: t }) =>
      k.solve(TRIG_POLAR, { 0: r, 1: t, out: k.true }, { 2: "x", 3: "y" }, ({ 2: x, 3: y }) =>
        expect(nearC(C(x, y), z), "polar(unpolar(x, y)) is near (x, y)"))))));
  // Ways agree (WAYS.md step 4, BACKLOG L96d): each way of a Trig field
  // against Float64's own field on small values, as T7 laws, so `lab test`
  // and test/prelude-laws.test.ts run them, with `near`: the ways are other
  // roundings of one real function. asin and acos are
  // given a sine and a cosine, which are in their domain.
  const agrees = (way: Id, own: (x: Id) => Id, what: string, input = (x: Id) => x) => {
    const d = k.def(`${what} agrees at Float64`);
    // Two small Float64s mixed, so more values are tried than one gives,
    // and kept within [−3, 3]: far out, x + π/2 rounds away more than the
    // tolerance (1e9 + π/2 is off by 6e-8), a disagreement of floats, not
    // of the ways.
    k.define(d, k.fn(["x", "y"], (x, y) => k.let("given", input(k.call(B.mul, k.lit(3), k.call(B.sin, k.call(B.add, x, k.call(B.mul, y, k.lit(0.37)))))), (v) => expect(k.call(near, k.call(way, v), own(v)), `${what}(x) is near its field at Float64`))));
    return d;
  };
  // polar by sincos gives x and y from a length and an angle: near what
  // Float64's own polar gives.
  const polarAgrees = k.def("polar by sincos agrees at Float64");
  const [byLength, byAngle, byX, byY] = (k.code.nodes[(k.code.nodes[polarBy] as NodeOf<"def">).body!] as NodeOf<"lambda">).params;
  k.define(polarAgrees, k.fn(["length", "angle"], (r, t) => k.let("r", k.call(B.add, r, k.lit(0)), (rr) =>
    k.solve(TRIG_POLAR, { 0: rr, 1: t, out: k.true }, { 2: "x", 3: "y" }, ({ 2: x, 3: y }) =>
      k.solve(polarBy, { [byLength]: rr, [byAngle]: t, out: k.true }, { [byX]: "x2", [byY]: "y2" }, ({ [byX]: x2, [byY]: y2 }) =>
        expect(k.and(k.call(near, x, x2), k.call(near, y, y2)), "polar by sincos is near Float64's polar"))))));
  const wayLaws = [
    agrees(cosBySin, (v) => k.call(B.cos, v), "cos by sin"),
    agrees(sinByCos, (v) => k.call(B.sin, v), "sin by cos"),
    agrees(sinByPolar, (v) => k.call(B.sin, v), "sin by polar"),
    agrees(cosByPolar, (v) => k.call(B.cos, v), "cos by polar"),
    agrees(asinBy, (v) => k.call(asinF, v), "asin by unpolar", (x) => k.call(B.sin, x)),
    agrees(acosBy, (v) => k.call(acosF, v), "acos by unpolar", (x) => k.call(B.cos, x)),
    polarAgrees,
  ];
  const laws = [lawFromPolar, lawPolar, ...wayLaws];

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
  const fixedF = k.def("as float64");
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
  const zipped = k.def("zipped");
  k.define(zipped, k.fn(["first", "second"], (xs, ys) => k.match(xs, [
    { variant: NIL, names: [], body: () => NIL },
    { variant: CONS, names: ["x", "xs rest"], body: ([x, xr]) => k.match(ys, [
      { variant: NIL, names: [], body: () => NIL },
      { variant: CONS, names: ["y", "ys rest"], body: ([y, yr]) => k.call(CONS, k.call(PAIR_V, x, y), k.call(zipped, xr, yr)) },
    ]) },
  ])));
  // Pairs each blade with its basis element (once its own `blades with`,
  // which was zipped under another name: L223).
  const pairUp = zipped;
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
    k.if(k.call(S.equal, k.call(gradeOf, b), k.call(INT_OPS.toNumber, g)), scaledBy(along(x, e), e), k.call(S.mapParts, k.fn(["part"], () => k.lit(0)), x))))));
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
      { variant: CONS, names: ["w", "more"], results: [null, "with more"], body: ([w], [, m]) => k.if(k.call(INT_OPS.less, w, v), k.call(B.neg, m!), m!) },
    ]) },
  ])));
  // The blade with those vectors, as clifford algebra lists them: for each
  // position 1 … n, whether it is among them.
  const namedBlade = (sq: Id, vs: Id) => k.call(map, k.call(S.range, k.call(INT_OPS.toNumber, k.call(length, sq))), k.fn(["position"], (i) =>
    k.fold(vs, [
      { variant: NIL, names: [], body: () => FALSE },
      { variant: CONS, names: ["v", "others"], results: [null, "among the others"], body: ([v], [, r]) => k.call(S.or, k.call(S.equal, k.call(INT_OPS.toNumber, v), n.add(i, k.lit(1))), r!) },
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
  // Words (BACKLOG L193, std.ts's Word8 to Word64): an Int from 0 to
  // 2ⁿ − 1 in `bits`. + − · and −x keep the low n bits of the Int's own
  // (two's complement, so −1 at Word8 is 255); < compares the bits, so it is
  // unsigned; and, or, xor are the Int's, and a shift up drops what passes
  // the top. As in C's unsigned types, Java's int and Rust's wrapping_add.
  const intShiftUp = k.def("shifted up int");
  k.define(intShiftUp, k.fn(["x", "n"], (x, by) => k.call(INT_OPS.shiftDown, x, k.call(INT_OPS.neg, by))));
  const wordDefs = WORD_SIZES.map((w) => {
    const V = WORD_V[w], top = () => k.int((1n << BigInt(w)) - 1n);
    const wrap = (x: Id) => k.call(V, k.call(INT_OPS.bitAnd, x, top()));
    const bitsOf = (v: Id, f: (b: Id) => Id, name = "bits") => k.match(v, [{ variant: V, names: [name], body: ([b]) => f(b) }]);
    const two = (name: string, f: (a: Id, b: Id) => Id) => { const d = k.def(name); k.define(d, k.fn(["x", "y"], (x, y) => bitsOf(x, (a) => bitsOf(y, (b) => f(a, b), "bits₂")))); return d; };
    const shift = (name: string, f: (a: Id, n: Id) => Id) => { const d = k.def(name); k.define(d, k.fn(["x", "n"], (x, by) => bitsOf(x, (a) => f(a, by)))); return d; };
    const as = k.def(`as word${w}`);
    k.define(as, k.fn(["whole"], (x) => wrap(x)));
    const add = two(`add word${w}`, (a, b) => wrap(k.call(INT_OPS.add, a, b)));
    const sub = two(`subtract word${w}`, (a, b) => wrap(k.call(INT_OPS.sub, a, b)));
    const mul = two(`multiply word${w}`, (a, b) => wrap(k.call(INT_OPS.mul, a, b)));
    const neg = k.def(`negate word${w}`);
    k.define(neg, k.fn(["x"], (x) => bitsOf(x, (a) => wrap(k.call(INT_OPS.neg, a)))));
    const less = two(`word${w} less than`, (a, b) => k.call(INT_OPS.less, a, b));
    const and = two(`word${w} bits and`, (a, b) => k.call(V, k.call(INT_OPS.bitAnd, a, b)));
    const or = two(`word${w} bits or`, (a, b) => k.call(V, k.call(INT_OPS.bitOr, a, b)));
    const xor = two(`word${w} bits xor`, (a, b) => k.call(V, k.call(INT_OPS.bitXor, a, b)));
    const up = shift(`word${w} shifted up`, (a, by) => wrap(k.call(INT_OPS.shiftDown, a, k.call(INT_OPS.neg, by))));
    const down = shift(`word${w} shifted down`, (a, by) => wrap(k.call(INT_OPS.shiftDown, a, by)));
    const show = k.def(`show word${w}`);
    k.define(show, k.fn(["x"], (x) => bitsOf(x, (a) => k.call(INT_OPS.show, a))));
    return { w, as, add, sub, mul, neg, less, and, or, xor, up, down, show };
  });
  const wordHelpers = wordDefs.flatMap((d) => [d.add, d.sub, d.mul, d.neg, d.less, d.and, d.or, d.xor, d.up, d.down, d.show]);
  const wordMakers = wordDefs.map((d) => d.as);
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
    ...wordDefs.flatMap((d) => [impl(`arithmetic at word${d.w}`, ARITHMETIC_V, [d.add, d.sub, d.mul, d.neg]), impl(`ordered at word${d.w}`, ORDERED_V, [d.less])]),
    // Text's < is `comes before`, alphabetical (L152): at most, smaller,
    // larger and the rest take Text, and no + − · does.
    impl("ordered at text", ORDERED_V, [TEXT_OPS.less]),
  ];
  // The one ÷ (L155): each number type's own divide, found by its type.
  // Int has none. Not offered: divide is.
  const divisions = [
    impl("division at float64", DIVISION_V, [B.div]),
    impl("division at rational", DIVISION_V, [divF]),
    impl("division at complex", DIVISION_V, [divC]),
    impl("division at dual", DIVISION_V, [divD]),
    impl("division at fixed", DIVISION_V, [divX]),
    impl("division at algebraic", DIVISION_V, [ALGEBRAIC_OPS.divide]),
  ];

  // How each number type shows (L205): `show any` asks the type's Shown.
  const showns = [
    impl("shown at rational", SHOWN_V, [showF]),
    impl("shown at complex", SHOWN_V, [showC]),
    impl("shown at fixed", SHOWN_V, [showX]),
    ...wordDefs.map((d) => impl(`shown at word${d.w}`, SHOWN_V, [d.show])),
  ];
  // and, or, xor and shifts (L193): Int's own and each word's.
  const bitses = [
    impl("bits at int", BITS_V, [INT_OPS.bitAnd, INT_OPS.bitOr, INT_OPS.bitXor, intShiftUp, INT_OPS.shiftDown]),
    ...wordDefs.map((d) => impl(`bits at word${d.w}`, BITS_V, [d.and, d.or, d.xor, d.up, d.down])),
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
  // their own. Positions count from 0 and are Ints, as `length` is (L140);
  // a position outside the list gives `otherwise` (item at) or the list as
  // it was (replace at), so neither has Choice. Each walks to the
  // position, n steps.
  const lt = (a: Id, b: Id) => k.call(INT_OPS.less, a, b);
  const less1 = (i: Id) => k.call(INT_OPS.sub, i, k.int(1));
  // The walk of position where: the position of the first item that
  // passes, the list's first item being at `from`.
  const positionFrom = k.def("position from");
  k.define(positionFrom, k.fn(["list", "test", "from"], (xs, test, from) => k.match(xs, [
    { variant: NIL, names: [], body: () => k.x(NONE) },
    { variant: CONS, names: ["item", "rest"], body: ([x, rest]) => k.if(k.call(test, x), k.call(SOME, from), k.call(positionFrom, rest, test, k.call(INT_OPS.add, from, k.int(1)))) },
  ])));
  const itemAt = k.def("item at");
  k.define(itemAt, k.fn(["list", "position", "otherwise"], (xs, i, o) => k.match(xs, [
    { variant: NIL, names: [], body: () => o },
    { variant: CONS, names: ["item", "rest"], body: ([x, rest]) => k.if(lt(i, k.int(0)), o,
      k.if(lt(i, k.int(1)), x, k.call(itemAt, rest, less1(i), o))) },
  ])));
  const replaceAt = k.def("replace at");
  k.define(replaceAt, k.fn(["list", "position", "by"], (xs, i, by) => k.match(xs, [
    { variant: NIL, names: [], body: () => NIL },
    { variant: CONS, names: ["item", "rest"], body: ([x, rest]) => k.if(lt(i, k.int(0)), xs,
      k.if(lt(i, k.int(1)), k.call(CONS, by, rest), k.call(CONS, x, k.call(replaceAt, rest, less1(i), by)))) },
  ])));
  // The first n items, and the rest after them (BACKLOG L135, GAPS round 6
  // NG3: notebook wrote take for its best five). Counted in Ints, as
  // `length` is (L140); fewer than n items give them all (take) or none
  // (drop).
  const take = k.def("take");
  k.define(take, k.fn(["list", "count"], (xs, c) => k.match(xs, [
    { variant: NIL, names: [], body: () => NIL },
    { variant: CONS, names: ["item", "rest"], body: ([x, rest]) => k.if(lt(c, k.int(1)), NIL, k.call(CONS, x, k.call(take, rest, less1(c)))) },
  ])));
  const drop = k.def("drop");
  k.define(drop, k.fn(["list", "count"], (xs, c) => k.match(xs, [
    { variant: NIL, names: [], body: () => NIL },
    { variant: CONS, names: ["item", "rest"], body: ([, rest]) => k.if(lt(c, k.int(1)), xs, k.call(drop, rest, less1(c))) },
  ])));
  // The position of the first item that passes a test, counting from 0, as
  // some(position); none when no item does (L160). Not a Choice, so the
  // test runs as the function it is.
  const positionWhere = k.def("position where");
  k.define(positionWhere, k.fn(["list", "test"], (xs, test) => k.call(positionFrom, xs, test, k.int(0))));
  // A path to the list item that passes a test, so one item of a cell's
  // list can be written by its key (BACKLOG L160, GAPS round 8 B2 and BL5:
  // board rewrote its whole state to change one card's time). The list is
  // read now and the item found by position: `write at(board, then
  // path(item where(board, cards, (c) ↦ c.id = id), time), t)` wakes only
  // that card's readers. Prior art: Solid stores' path filters
  // (`setState("todos", t => t.id === id, "done", true)`). When no item
  // passes, the path is to no item, as `item path` past the end is: read
  // at has no answer there and an edit changes nothing.
  const itemWhere = k.def("item where");
  k.define(itemWhere, k.fn(["cell", "path", "test"], (c, p, test) =>
    k.call(CELL_OPS.itemPath, p, k.match(k.call(positionWhere, k.call(S.first, k.thunk(() => k.call(CELL_OPS.readAt, c, p)), k.thunk(() => k.x(NIL))), test), [
      { variant: SOME, names: ["position"], body: ([i]) => i },
      { variant: NONE, names: [], body: () => k.int(-1) },
    ]))));
  // A cell changed by a function of what it holds (L170, REVIEW-2026-11-02d
  // §4): board wrote write(stc, undone(read(stc))) six times. change(cell,
  // f) is that as one call, as React's setState(f) and Solid's setter
  // given a function are.
  const change = k.def("change");
  k.define(change, k.fn(["cell", "f"], (c, f) => k.call(CELL_OPS.write, c, k.call(f, k.call(CELL_OPS.read, c)))));
  // An item drawn at random (L171, REVIEW-2026-11-02d §4): board picked a
  // card with a Float64 position it counted down itself. Each item is as
  // likely, and an empty list has no answer (Python's random.choice, which
  // raises there instead).
  const randomItem = k.def("random item");
  k.define(randomItem, k.fn(["list"], (xs) => k.match(xs, [
    { variant: NIL, names: [], body: () => k.call(S.fail) },
    { variant: CONS, names: ["first", "rest"], body: ([x]) => k.call(itemAt, xs,
      k.call(INT_OPS.wholePart, n.mul(k.call(RANDOM_OP), k.call(INT_OPS.toNumber, k.call(length, xs)))), x) },
  ])));
  // Lists side by side, numbered, made of copies, and tested whole (L164,
  // GAPS round 9 MG3: machine wrote zipped, numbered, zeros and all
  // digits). zipped stops at the shorter list, as Haskell's zip and
  // Python's zip do; numbered counts from 0, as positions do (L140); all
  // pass and any pass stop at the first item that decides (Haskell's all
  // and any; `all` and `any of` were taken).
  const numberedFrom = k.def("numbered from");
  k.define(numberedFrom, k.fn(["list", "from"], (xs, from) => k.match(xs, [
    { variant: NIL, names: [], body: () => NIL },
    { variant: CONS, names: ["item", "rest"], body: ([x, rest]) => k.call(CONS, k.call(PAIR_V, from, x), k.call(numberedFrom, rest, k.call(INT_OPS.add, from, k.int(1)))) },
  ])));
  const numbered = k.def("numbered");
  k.define(numbered, k.fn(["list"], (xs) => k.call(numberedFrom, xs, k.int(0))));
  const copies = k.def("copies");
  k.define(copies, k.fn(["count", "item"], (c, x) => k.call(map, k.call(INT_OPS.range, c), k.fn(["i"], () => x))));
  const allPass = k.def("all pass");
  k.define(allPass, k.fn(["list", "test"], (xs, test) => k.match(xs, [
    { variant: NIL, names: [], body: () => k.true },
    { variant: CONS, names: ["item", "rest"], body: ([x, rest]) => k.if(k.call(test, x), k.call(allPass, rest, test), k.false) },
  ])));
  const anyPass = k.def("any pass");
  k.define(anyPass, k.fn(["list", "test"], (xs, test) => k.match(xs, [
    { variant: NIL, names: [], body: () => k.false },
    { variant: CONS, names: ["item", "rest"], body: ([x, rest]) => k.if(k.call(test, x), k.true, k.call(anyPass, rest, test)) },
  ])));
  // Searching a list, its largest and smallest item, and an item put in
  // at a position (L161, GAPS round 8 BL2 to BL4: board wrote card of,
  // position of, tag in, largest id and inserted for itself). Its whole
  // number from text and Float64 to Int were already std's `read whole
  // number` and `whole part`.
  const firstWhere = k.def("first where");
  k.define(firstWhere, k.fn(["list", "test"], (xs, test) => k.match(xs, [
    { variant: NIL, names: [], body: () => k.x(NONE) },
    { variant: CONS, names: ["item", "rest"], body: ([x, rest]) => k.if(k.call(test, x), k.call(SOME, x), k.call(firstWhere, rest, test)) },
  ])));
  const positionOf = k.def("position of");
  k.define(positionOf, k.fn(["list", "item"], (xs, y) => k.call(positionFrom, xs, k.fn(["x"], (x) => k.call(S.equal, x, y)), k.int(0))));
  const contains = k.def("contains");
  k.define(contains, k.fn(["list", "item"], (xs, y) => k.call(anyPass, xs, k.fn(["x"], (x) => k.call(S.equal, x, y)))));
  // The largest and smallest by the one generic <, none for an empty list.
  const extremeOf = (name: string, keep: (a: Id, b: Id) => Id) => {
    const d = k.def(name);
    k.define(d, k.fn(["list"], (xs) => k.match(xs, [
      { variant: NIL, names: [], body: () => k.x(NONE) },
      { variant: CONS, names: ["item", "rest"], body: ([x, rest]) => k.call(SOME, k.fold(rest, [
        { variant: NIL, names: [], body: () => x },
        { variant: CONS, names: ["next", "rest"], results: [null, "best of the rest"], body: ([y], [, r]) => keep(r!, y) },
      ])) },
    ])));
    return d;
  };
  const largestOf = extremeOf("largest of", (a, b) => k.if(k.call(ARITH.less, a, b), b, a));
  const smallestOf = extremeOf("smallest of", (a, b) => k.if(k.call(ARITH.less, b, a), b, a));
  const insertedAt = k.def("inserted at");
  k.define(insertedAt, k.fn(["list", "position", "item"], (xs, i, y) => k.call(append, k.call(take, xs, i), k.call(CONS, y, k.call(drop, xs, i)))));
  // A choice by value (L164b, GAPS round 9 MG3): machine's `instruction
  // of` was a 21-way if chain over the instruction's name. case of(key,
  // cases, otherwise) runs the first case whose key equals key, or
  // otherwise when none does: Lisp's `case` and C's `switch`, written as a
  // list of (key, what to do) pairs, so any plain data is a key.
  const caseOf = k.def("case of");
  k.define(caseOf, k.fn(["key", "cases", "otherwise"], (key, cs, o) => k.match(cs, [
    { variant: NIL, names: [], body: () => k.call(o) },
    { variant: CONS, names: ["case", "rest"], body: ([c, rest]) => k.match(c, [
      { variant: PAIR_V, names: ["when", "then"], body: ([w, then]) => k.if(k.call(S.equal, w, key), k.call(then), k.call(caseOf, key, rest, o)) },
    ]) },
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
  k.define(showDecimals, k.fn(["x", "places"], (x, wholePlaces) => k.let("places as float64", k.call(INT_OPS.toNumber, wholePlaces), (places) => k.let("scale", k.call(B.pow, k.lit(10), places), (scale) =>
    k.let("steps", k.call(S.floor, n.add(n.mul(k.call(S.abs, x), scale), k.lit(0.5))), (m) =>
      k.let("whole", k.call(S.floor, n.div(m, scale)), (w) =>
        k.let("text", k.if(k.call(S.less, places, k.lit(0.5)), k.call(S.show, w),
          k.call(S.concat, k.call(S.show, w), k.call(S.concat, k.lit("."), k.call(paddedDigits, n.sub(m, n.mul(w, scale)), places)))), (text) =>
          k.if(k.call(S.and, k.call(S.less, x, k.lit(0)), k.call(S.less, k.lit(0), m)), k.call(S.concat, k.lit("-"), text), text))))))));
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

  // Sorting by an order the program gives (L214d): a collation for
  // people's names, or any (a, b) → Order. The same stable merge sort as
  // sort by, asking order(y, x) where it asked compare(key(y), key(x)).
  const mergeWith = k.def("merge with order");
  k.define(mergeWith, k.fn(["order", "xs", "ys"], (order, xs, ys) => k.match(xs, [
    { variant: NIL, names: [], body: () => ys },
    { variant: CONS, names: ["x", "xs rest"], body: ([x, xr]) => k.match(ys, [
      { variant: NIL, names: [], body: () => xs },
      { variant: CONS, names: ["y", "ys rest"], body: ([y, yr]) => k.match(k.call(order, y, x), [
        { variant: ORDER_V.before, names: [], body: () => k.call(CONS, y, k.call(mergeWith, order, xs, yr)) },
      ], k.call(CONS, x, k.call(mergeWith, order, xr, ys))) },
    ]) },
  ])));
  const addRunWith = k.def("add run with order");
  k.define(addRunWith, k.fn(["order", "run", "slots"], (order, run, slots) => k.match(slots, [
    { variant: NIL, names: [], body: () => k.call(CONS, k.call(SOME, run), k.x(NIL)) },
    { variant: CONS, names: ["slot", "higher"], body: ([slot, higher]) => k.match(slot, [
      { variant: NONE, names: [], body: () => k.call(CONS, k.call(SOME, run), higher) },
      { variant: SOME, names: ["held"], body: ([held]) => k.call(CONS, k.x(NONE), k.call(addRunWith, order, k.call(mergeWith, order, run, held), higher)) },
    ]) },
  ])));
  const sortWith = k.def("sort with");
  k.define(sortWith, k.fn(["list", "order"], (xs, order) => k.fold(
    k.fold(xs, [
      { variant: NIL, names: [], body: () => k.x(NIL) },
      { variant: CONS, names: ["item", "rest"], results: [null, "slots"], body: ([item], [, slots]) => k.call(addRunWith, order, k.call(CONS, item, k.x(NIL)), slots!) },
    ]), [
      { variant: NIL, names: [], body: () => k.x(NIL) },
      { variant: CONS, names: ["slot", "higher"], results: [null, "merged"], body: ([slot], [, merged]) => k.match(slot, [
        { variant: NONE, names: [], body: () => merged! },
        { variant: SOME, names: ["run"], body: ([run]) => k.call(mergeWith, order, run, merged!) },
      ]) },
    ])));
  const collated = k.def("collated");
  k.define(collated, k.fn(["locale"], (l) => k.fn(["a", "b"], (a, b) => k.call(TEXT_OPS.collate, a, b, l))));
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
  // A queue and a priority queue (L177, std.ts's Queue and Priority
  // queue). A queue's front is empty only when the queue is, so its first
  // item is the front's; taking it, the back turns round when the front
  // runs out. A priority queue's soonest is its Map's smallest key: the
  // lowest priority, and of those the one put in first.
  const Q = (front: Id, back: Id, size: Id) => k.call(QUEUE_V, front, back, size);
  const queueOf_ = (q: Id, f: (front: Id, back: Id, size: Id) => Id) => k.match(q, [{ variant: QUEUE_V, names: ["front", "back", "size"], body: ([a, b, n]) => f(a, b, n) }]);
  const plus1 = (n: Id) => k.call(INT_OPS.add, n, k.int(1));
  const emptyQueue = k.def("empty queue");
  k.define(emptyQueue, Q(k.x(NIL), k.x(NIL), k.int(0)));
  const queueOf = def("queue of", ["items"], (xs) => Q(xs, k.x(NIL), k.call(length, xs)));
  const queued = def("queued", ["queue", "item"], (q, x) => queueOf_(q, (front, back, n) => k.match(front, [
    { variant: NIL, names: [], body: () => Q(k.call(CONS, x, k.x(NIL)), back, plus1(n)) },
  ], Q(front, k.call(CONS, x, back), plus1(n)))));
  const frontOf = def("front of", ["queue"], (q) => queueOf_(q, (front) => firstOf(front)));
  const dequeued = def("dequeued", ["queue"], (q) => queueOf_(q, (front, back, n) => k.match(front, [
    { variant: NIL, names: [], body: () => k.call(S.fail) },
    { variant: CONS, names: ["item", "rest"], body: ([, rest]) => k.match(rest, [
      { variant: NIL, names: [], body: () => Q(k.call(reverse, back), k.x(NIL), k.call(INT_OPS.sub, n, k.int(1))) },
    ], Q(rest, back, k.call(INT_OPS.sub, n, k.int(1)))) },
  ])));
  const queueSize = def("queue size", ["queue"], (q) => queueOf_(q, (_f, _b, n) => n));
  const queueItems = def("queue items", ["queue"], (q) => queueOf_(q, (front, back) => k.call(append, front, k.call(reverse, back))));
  const PQ = (es: Id, next: Id) => k.call(PRIORITY_QUEUE_V, es, next);
  const pqOf = (q: Id, f: (es: Id, next: Id) => Id) => k.match(q, [{ variant: PRIORITY_QUEUE_V, names: ["entries", "next"], body: ([es, n]) => f(es, n) }]);
  const emptyPriorityQueue = k.def("empty priority queue");
  k.define(emptyPriorityQueue, PQ(k.x(emptyMap), k.int(0)));
  const prioritized = def("prioritized", ["queue", "priority", "item"], (q, pr, x) => pqOf(q, (es, n) => PQ(k.call(put, es, P(pr, n), x), plus1(n))));
  const prioritizedAll = k.def("prioritized all");
  k.define(prioritizedAll, k.fn(["queue", "pairs"], (q, ps) => k.match(ps, [
    { variant: NIL, names: [], body: () => q },
    { variant: CONS, names: ["pair", "rest"], body: ([pr, rest]) => entry(pr, (p, x) => k.call(prioritizedAll, k.call(prioritized, q, p, x), rest), ["priority", "item"]) },
  ])));
  const priorityQueueOf = def("priority queue of", ["pairs"], (ps) => k.call(prioritizedAll, k.x(emptyPriorityQueue), ps));
  const soonest = def("soonest", ["queue"], (q) => pqOf(q, (es) => k.let("key", k.call(smallestKey, es), (key) =>
    entry(key, (p) => P(p, k.call(lookup, es, key)), ["priority", "order"]))));
  const withoutSoonest = def("without soonest", ["queue"], (q) => pqOf(q, (es, n) => PQ(k.call(remove, es, k.call(smallestKey, es)), n)));
  const priorityQueueSize = def("priority queue size", ["queue"], (q) => pqOf(q, (es) => k.call(mapSize, es)));
  const priorityQueueItems = def("priority queue items", ["queue"], (q) => pqOf(q, (es) => k.call(map, k.call(entries, es),
    k.fn(["entry"], (e) => entry(e, (key, x) => entry(key, (p) => P(p, x), ["priority", "order"]))))));
  // Matrices of any size (L44, MATRICES.md step 3, std.ts's Matrix): the
  // items row by row in one list. Products, sums and a matrix times a
  // vector are for every number type, as + and × are; a size mismatch
  // stops with both sizes, as NumPy's "shapes (2,3) and (2,2) not
  // aligned" does. solved(m, b) is the x with m·x = b, by Gaussian
  // elimination with partial pivoting (the largest pivot first, as
  // LAPACK's gesv does), at Float64; a singular matrix has no answer.
  const M = (r: Id, c: Id, xs: Id) => k.call(MATRIX_V, r, c, xs);
  const matOf = (m: Id, f: (r: Id, c: Id, xs: Id) => Id) => k.match(m, [{ variant: MATRIX_V, names: ["rows", "columns", "items"], body: ([r, c, xs]) => f(r, c, xs) }]);
  const iLess = (a: Id, b: Id) => k.call(INT_OPS.less, a, b);
  const iSame = (a: Id, b: Id) => k.equal(a, b);
  const iMul = (a: Id, b: Id) => k.call(INT_OPS.mul, a, b);
  const iAdd = (a: Id, b: Id) => k.call(INT_OPS.add, a, b);
  const texts = (...parts: Id[]) => parts.reduceRight((acc, t) => k.call(S.concat, t, acc));
  const sizeText = (r: Id, c: Id) => texts(k.call(INT_OPS.show, r), k.lit(" × "), k.call(INT_OPS.show, c));
  // Two lists' items multiplied pairwise and added, its own walk.
  const listDot = k.def("matrix dot");
  k.define(listDot, k.fn(["first", "second"], (xs, ys) => k.match(xs, [
    { variant: NIL, names: [], body: () => k.lit(0) },
    { variant: CONS, names: ["x", "xs rest"], body: ([x, xr]) => k.match(ys, [
      { variant: NIL, names: [], body: () => k.lit(0) },
      { variant: CONS, names: ["y", "ys rest"], body: ([y, yr]) => k.call(ARITH.add, k.call(ARITH.mul, x, y), k.call(listDot, xr, yr)) },
    ]) },
  ])));
  const rowsOf = def("matrix rows", ["matrix"], (m) => matOf(m, (r, c, xs) => k.call(map, k.call(INT_OPS.range, r), k.fn(["i"], (i) => k.call(take, k.call(drop, xs, iMul(i, c)), c)))));
  const matrixOfRows = def("matrix of rows", ["rows"], (rs) => k.match(rs, [
    { variant: NIL, names: [], body: () => M(k.int(0), k.int(0), k.x(NIL)) },
    { variant: CONS, names: ["first", "rest"], body: ([first]) => k.let("columns", k.call(length, first), (c) =>
      k.if(k.call(allPass, rs, k.fn(["row"], (row) => iSame(k.call(length, row), c))),
        M(k.call(length, rs), c, k.call(flatten, rs)),
        k.call(ABORT_OP, texts(k.lit("matrix of rows: the rows aren't all "), k.call(INT_OPS.show, c), k.lit(" long"))))) },
  ]));
  const rowCount = def("row count", ["matrix"], (m) => matOf(m, (r) => r));
  const columnCount = def("column count", ["matrix"], (m) => matOf(m, (_r, c) => c));
  const matrixEntry = def("matrix entry", ["matrix", "row", "column"], (m, i, j) => matOf(m, (r, c, xs) =>
    k.if(k.call(S.or, k.call(S.or, iLess(i, k.int(0)), k.call(S.not, iLess(i, r))), k.call(S.or, iLess(j, k.int(0)), k.call(S.not, iLess(j, c)))), k.call(S.fail),
      k.match(k.call(drop, xs, iAdd(iMul(i, c), j)), [
        { variant: CONS, names: ["item", "rest"], body: ([x]) => x },
      ], k.call(S.fail)))));
  const transposed = def("transposed", ["matrix"], (m) => matOf(m, (r, c, xs) => M(c, r,
    k.call(flatMap, k.call(INT_OPS.range, c), k.fn(["j"], (j) => k.call(flatMap, k.call(INT_OPS.range, r), k.fn(["i"], (i) => k.call(take, k.call(drop, xs, iAdd(iMul(i, c), j)), k.int(1)))))))));
  const identityMatrix = def("identity matrix", ["size"], (n) => M(n, n,
    k.call(flatMap, k.call(INT_OPS.range, n), k.fn(["i"], (i) => k.call(map, k.call(INT_OPS.range, n), k.fn(["j"], (j) => k.if(iSame(i, j), k.lit(1), k.lit(0))))))));
  const matrixScaled = def("matrix scaled", ["matrix", "by"], (m, s) => matOf(m, (r, c, xs) => M(r, c, k.call(map, xs, k.fn(["x"], (x) => k.call(ARITH.mul, s, x))))));
  const mismatch = (what: string, r1: Id, c1: Id, r2: Id, c2: Id) => k.call(ABORT_OP, texts(k.lit(`${what}: a `), sizeText(r1, c1), k.lit(" matrix and a "), sizeText(r2, c2), k.lit(" one")));
  const matrixSum = def("matrix sum", ["first", "second"], (a, b) => matOf(a, (r1, c1, xs) => matOf(b, (r2, c2, ys) =>
    k.if(k.call(S.and, iSame(r1, r2), iSame(c1, c2)),
      M(r1, c1, k.call(map, k.call(zipped, xs, ys), k.fn(["pair"], (p) => entry(p, (x, y) => k.call(ARITH.add, x, y), ["x", "y"])))),
      mismatch("matrix sum", r1, c1, r2, c2)))));
  const matrixProduct = def("matrix product", ["first", "second"], (a, b) => matOf(a, (r1, c1, _xs) => matOf(b, (r2, c2, _ys) =>
    k.if(iSame(c1, r2),
      k.let("columns", k.call(rowsOf, k.call(transposed, b)), (cols) =>
        M(r1, c2, k.call(flatMap, k.call(rowsOf, a), k.fn(["row"], (row) => k.call(map, cols, k.fn(["column"], (col) => k.call(listDot, row, col))))))),
      mismatch("matrix product", r1, c1, r2, c2)))));
  const matrixTimesVector = def("matrix times vector", ["matrix", "vector"], (m, v) => matOf(m, (r, c) =>
    k.if(iSame(c, k.call(length, v)),
      k.call(map, k.call(rowsOf, m), k.fn(["row"], (row) => k.call(listDot, row, v))),
      k.call(ABORT_OP, texts(k.lit("matrix times vector: a "), sizeText(r, c), k.lit(" matrix and a vector of "), k.call(INT_OPS.show, k.call(length, v)))))));
  // Elimination: the row with the largest first item is the pivot; the
  // others lose their first column, less a multiple of the pivot's. It
  // counts down the rows, so it ends; a pivot of 0 has no answer (divide
  // has none). Back substitution then reads the triangle from the bottom.
  const headOr0 = (row: Id) => k.match(row, [{ variant: CONS, names: ["first", "rest"], body: ([x]) => x }], k.lit(0));
  const tailOf = (row: Id) => k.match(row, [{ variant: CONS, names: ["first", "rest"], body: ([, rest]) => rest }], k.x(NIL));
  const eliminated = k.def("eliminated");
  k.define(eliminated, k.fn(["rows", "count"], (rs, n) => k.if(iLess(n, k.int(1)), k.x(NIL),
    k.match(k.call(sortBy, rs, k.fn(["row"], (row) => k.call(B.sub, k.lit(0), k.call(S.abs, headOr0(row))))), [
      { variant: NIL, names: [], body: () => k.x(NIL) },
      { variant: CONS, names: ["pivot", "others"], body: ([p, others]) => k.let("pivot first", headOr0(p), (a) =>
        k.call(CONS, p, k.call(eliminated, k.call(map, others, k.fn(["row"], (row) => k.let("factor", k.call(B.div, headOr0(row), a), (f) =>
          k.call(map, k.call(zipped, tailOf(row), tailOf(p)), k.fn(["pair"], (pr) => entry(pr, (x, y) => k.call(B.sub, x, k.call(B.mul, f, y)), ["x", "y"])))))),
          k.call(INT_OPS.sub, n, k.int(1))))) },
    ]))));
  const backSubstituted = k.def("back substituted");
  k.define(backSubstituted, k.fn(["triangle"], (t) => k.match(t, [
    { variant: NIL, names: [], body: () => k.x(NIL) },
    { variant: CONS, names: ["row", "below"], body: ([row, below]) => k.let("found", k.call(backSubstituted, below), (xs) =>
      k.let("coefficients", tailOf(row), (cs) => k.let("known", k.call(length, xs), (n) =>
        k.call(CONS, k.call(B.div, k.call(B.sub, k.call(itemAt, k.call(drop, cs, n), k.int(0), k.lit(0)), k.call(listDot, k.call(take, cs, n), xs)), headOr0(row)), xs)))) },
  ])));
  const solved = def("solved", ["matrix", "vector"], (m, v) => matOf(m, (r, c) =>
    k.if(k.call(S.and, iSame(r, c), iSame(r, k.call(length, v))),
      k.call(backSubstituted, k.call(eliminated, k.call(map, k.call(zipped, k.call(rowsOf, m), v), k.fn(["pair"], (p) => entry(p, (row, b) => k.call(append, row, k.call(CONS, b, k.x(NIL))), ["row", "b"]))), r)),
      k.call(ABORT_OP, texts(k.lit("solved: a "), sizeText(r, c), k.lit(" matrix and a vector of "), k.call(INT_OPS.show, k.call(length, v)), k.lit("; it needs a square matrix and one item per row"))))));
  // The determinant and the inverse (L44e), at Float64. The determinant is
  // the elimination's pivots multiplied, the sign turned for each row a
  // pivot was moved past (partial pivoting, as LAPACK's getrf); a 0 pivot
  // is a singular matrix, so 0. The inverse is solved once per column of
  // the identity, so a singular matrix has no answer.
  const determinantOf = k.def("determinant of rows");
  const reducedBy = (p: Id, a: Id) => k.fn(["row"], (row) => k.let("factor", k.call(dividedOr, headOr0(row), a, k.lit(0)), (f) =>
    k.call(map, k.call(zipped, tailOf(row), tailOf(p)), k.fn(["pair"], (pr) => entry(pr, (x, y) => k.call(B.sub, x, k.call(B.mul, f, y)), ["x", "y"])))));
  const odd = (i: Id) => k.let("place", k.call(INT_OPS.toNumber, i), (x) => k.call(S.not, k.call(S.equal, k.call(B.mul, k.call(S.floor, k.call(B.mul, x, k.lit(0.5))), k.lit(2)), x)));
  const pivotStep = (rs: Id, n: Id, i: Id, p: Id) => k.let("pivot first", headOr0(p), (a) => k.if(k.call(S.equal, a, k.lit(0)), k.lit(0),
    k.let("rest", k.call(determinantOf, k.call(map, k.call(append, k.call(take, rs, i), k.call(drop, rs, k.call(INT_OPS.add, i, k.int(1)))), reducedBy(p, a)), k.call(INT_OPS.sub, n, k.int(1))), (d) =>
      k.if(odd(i), k.call(B.sub, k.lit(0), k.call(B.mul, a, d)), k.call(B.mul, a, d)))));
  k.define(determinantOf, k.fn(["rows", "count"], (rs, n) => k.if(iLess(n, k.int(1)), k.lit(1),
    k.match(k.call(sortBy, k.call(numbered, rs), k.fn(["pair"], (pr) => entry(pr, (_i, row) => k.call(B.sub, k.lit(0), k.call(S.abs, headOr0(row))), ["position", "row"]))), [
      { variant: NIL, names: [], body: () => k.lit(1) },
      { variant: CONS, names: ["pivot", "others"], body: ([pp]) => entry(pp, (i, p) => pivotStep(rs, n, i, p), ["position", "row"]) },
    ]))));
  const determinant = def("determinant", ["matrix"], (m) => matOf(m, (r, c) => k.if(iSame(r, c), k.call(determinantOf, k.call(rowsOf, m), r),
    k.call(ABORT_OP, texts(k.lit("determinant: a "), sizeText(r, c), k.lit(" matrix; it needs a square one"))))));
  const inverted = def("inverted", ["matrix"], (m) => matOf(m, (r, c) => k.if(iSame(r, c),
    k.call(transposed, k.call(matrixOfRows, k.call(map, k.call(rowsOf, k.call(identityMatrix, r)), k.fn(["column"], (e) => k.call(solved, m, e))))),
    k.call(ABORT_OP, texts(k.lit("inverted: a "), sizeText(r, c), k.lit(" matrix; it needs a square one"))))));
  // The best fit when there are more equations than unknowns (L44f): the
  // x making m·x nearest b, by the normal equations mᵀm·x = mᵀb (Gauss,
  // 1809; Legendre, 1805). Squaring m loses accuracy LAPACK's QR (gels)
  // keeps, a later way of the same function.
  const leastSquares = def("least squares", ["matrix", "vector"], (m, v) => matOf(m, (r, c) =>
    k.if(iSame(r, k.call(length, v)),
      k.let("flipped", k.call(transposed, m), (t) => k.call(solved, k.call(matrixProduct, t, m), k.call(matrixTimesVector, t, v))),
      k.call(ABORT_OP, texts(k.lit("least squares: a "), sizeText(r, c), k.lit(" matrix and a vector of "), k.call(INT_OPS.show, k.call(length, v)), k.lit("; it needs one item per row"))))));
  // Tensors (L51, TENSORS-2026-11-03.md step a): a shape and its items
  // row-major, written in the language like the matrices above.
  const T = (shape: Id, xs: Id) => k.call(TENSOR_V, shape, xs);
  const tenOf = (t: Id, f: (shape: Id, xs: Id) => Id) => k.match(t, [{ variant: TENSOR_V, names: ["shape", "items"], body: ([sh, xs]) => f(sh, xs) }]);
  const shapeSize = k.def("shape size");
  k.define(shapeSize, k.fn(["shape"], (sh) => k.match(sh, [
    { variant: NIL, names: [], body: () => k.int(1) },
    { variant: CONS, names: ["length", "rest"], body: ([n, rest]) => iMul(n, k.call(shapeSize, rest)) },
  ])));
  const shapeText = k.def("shape text");
  k.define(shapeText, k.fn(["shape"], (sh) => k.match(sh, [
    { variant: NIL, names: [], body: () => k.lit("[]") },
    { variant: CONS, names: ["length", "rest"], body: ([n, rest]) => k.match(rest, [
      { variant: NIL, names: [], body: () => k.call(INT_OPS.show, n) },
    ], texts(k.call(INT_OPS.show, n), k.lit(" × "), k.call(shapeText, rest))) },
  ])));
  const tensorOf = def("tensor of", ["shape", "items"], (sh, xs) => k.if(iSame(k.call(length, xs), k.call(shapeSize, sh)), T(sh, xs),
    k.call(ABORT_OP, texts(k.lit("tensor of: a "), k.call(shapeText, sh), k.lit(" shape holds "), k.call(INT_OPS.show, k.call(shapeSize, sh)), k.lit(" items, not "), k.call(INT_OPS.show, k.call(length, xs))))));
  const tensorShape = def("tensor shape", ["tensor"], (t) => tenOf(t, (sh) => sh));
  const tensorItems = def("tensor items", ["tensor"], (t) => tenOf(t, (_sh, xs) => xs));
  const rank = def("rank", ["tensor"], (t) => tenOf(t, (sh) => k.call(length, sh)));
  const tensorSize = def("tensor size", ["tensor"], (t) => tenOf(t, (_sh, xs) => k.call(length, xs)));
  // Where an index's item is among the items, row-major: each axis's
  // position, then the next axis's within it. No answer for an index of
  // the wrong length or out of its axis.
  const tensorOffset = k.def("tensor offset");
  k.define(tensorOffset, k.fn(["shape", "index", "so far"], (sh, ix, acc) => k.match(sh, [
    { variant: NIL, names: [], body: () => k.match(ix, [{ variant: NIL, names: [], body: () => acc }], k.call(S.fail)) },
    { variant: CONS, names: ["length", "rest"], body: ([n, rest]) => k.match(ix, [
      { variant: CONS, names: ["position", "later"], body: ([i, later]) => k.if(k.call(S.or, iLess(i, k.int(0)), k.call(S.not, iLess(i, n))), k.call(S.fail),
        k.call(tensorOffset, rest, later, iAdd(iMul(acc, n), i))) },
    ], k.call(S.fail)) },
  ])));
  const tensorEntry = def("tensor entry", ["tensor", "index"], (t, ix) => tenOf(t, (sh, xs) =>
    k.match(k.call(drop, xs, k.call(tensorOffset, sh, ix, k.int(0))), [
      { variant: CONS, names: ["item", "rest"], body: ([x]) => x },
    ], k.call(S.fail))));
  const tensorMap = def("tensor map", ["f", "tensor"], (f, t) => tenOf(t, (sh, xs) => T(sh, k.call(map, xs, f))));
  const tensorZipWith = def("tensor zip with", ["f", "first", "second"], (f, a, b) => tenOf(a, (sa, xs) => tenOf(b, (sb, ys) =>
    k.if(k.equal(sa, sb),
      T(sa, k.call(map, k.call(zipped, xs, ys), k.fn(["pair"], (p) => entry(p, (x, y) => k.call(f, x, y), ["x", "y"])))),
      k.call(ABORT_OP, texts(k.lit("tensor zip with: a "), k.call(shapeText, sa), k.lit(" tensor and a "), k.call(shapeText, sb), k.lit(" one")))))));
  const reshaped = def("reshaped", ["tensor", "shape"], (t, sh) => tenOf(t, (was, xs) => k.if(iSame(k.call(shapeSize, sh), k.call(length, xs)), T(sh, xs),
    k.call(ABORT_OP, texts(k.lit("reshaped: a "), k.call(shapeText, was), k.lit(" tensor can't be read as "), k.call(shapeText, sh))))));
  // Step b: contraction over named pairs of axes (Einstein summation, as
  // numpy.einsum), a transpose by an axis order, and a trace.
  const tsum = k.def("tensor items added");
  k.define(tsum, k.fn(["items"], (xs) => k.match(xs, [
    { variant: NIL, names: [], body: () => k.lit(0) },
    { variant: CONS, names: ["item", "rest"], body: ([x, rest]) => k.call(ARITH.add, x, k.call(tsum, rest)) },
  ])));
  // Every index of a shape, row-major.
  const indicesOf = k.def("indices of");
  k.define(indicesOf, k.fn(["shape"], (sh) => k.match(sh, [
    { variant: NIL, names: [], body: () => k.call(CONS, k.x(NIL), k.x(NIL)) },
    { variant: CONS, names: ["length", "rest"], body: ([n, rest]) => k.let("later indices", k.call(indicesOf, rest), (laters) => k.call(flatMap, k.call(INT_OPS.range, n), k.fn(["i"], (i) =>
      k.call(map, laters, k.fn(["later"], (later) => k.call(CONS, i, later)))))) },
  ])));
  // Where an index known to fit is among the items.
  const rowMajor = k.def("row-major offset");
  k.define(rowMajor, k.fn(["shape", "index", "so far"], (sh, ix, acc) => k.match(sh, [
    { variant: NIL, names: [], body: () => acc },
    { variant: CONS, names: ["length", "rest"], body: ([n, rest]) => k.match(ix, [
      { variant: CONS, names: ["position", "later"], body: ([i, later]) => k.call(rowMajor, rest, later, iAdd(iMul(acc, n), i)) },
    ], acc) },
  ])));
  const itemFitting = (sh: Id, xs: Id, ix: Id) => k.call(itemAt, xs, k.call(rowMajor, sh, ix, k.int(0)), k.lit(0));
  // Where x is in a list of Ints, or −1.
  const placeOf = k.def("place of axis");
  k.define(placeOf, k.fn(["axes", "axis", "from"], (as, x, i) => k.match(as, [
    { variant: NIL, names: [], body: () => k.int(-1) },
    { variant: CONS, names: ["first", "rest"], body: ([y, rest]) => k.if(iSame(y, x), i, k.call(placeOf, rest, x, iAdd(i, k.int(1)))) },
  ])));
  const axesBut = k.def("axes but");
  k.define(axesBut, k.fn(["axes", "taken"], (as, taken) => k.match(as, [
    { variant: NIL, names: [], body: () => k.x(NIL) },
    { variant: CONS, names: ["first", "rest"], body: ([y, rest]) => k.if(k.call(contains, taken, y), k.call(axesBut, rest, taken), k.call(CONS, y, k.call(axesBut, rest, taken))) },
  ])));
  const lengthsAt = (sh: Id, axes: Id) => k.call(map, axes, k.fn(["axis"], (p) => k.call(itemAt, sh, p, k.int(0))));
  const axesInRange = (axes: Id, r: Id) => k.call(allPass, axes, k.fn(["axis"], (p) => k.call(S.and, k.call(S.not, iLess(p, k.int(0))), iLess(p, r))));
  const axesOnce = k.def("axes once each");
  k.define(axesOnce, k.fn(["axes"], (as) => k.match(as, [
    { variant: NIL, names: [], body: () => k.true },
    { variant: CONS, names: ["first", "rest"], body: ([y, rest]) => k.call(S.and, k.call(S.not, k.call(contains, rest, y)), k.call(axesOnce, rest)) },
  ])));
  const once = (axes: Id) => k.call(axesOnce, axes);
  // An index of `rank` axes: an axis paired at place q reads the summed
  // index's q, the others the result index's, in order from `start`.
  const indexFor = (r: Id, paired: Id, free: Id, start: Id, summed: Id, result: Id) => k.call(map, k.call(INT_OPS.range, r), k.fn(["axis"], (p) =>
    k.let("place", k.call(placeOf, paired, p, k.int(0)), (q) => k.if(iLess(q, k.int(0)),
      k.call(itemAt, result, iAdd(start, k.call(placeOf, free, p, k.int(0))), k.int(0)),
      k.call(itemAt, summed, q, k.int(0))))));
  const firsts = (ps: Id) => k.call(map, ps, k.fn(["pair"], (pr) => entry(pr, (x) => x, ["a axis", "b axis"])));
  const seconds = (ps: Id) => k.call(map, ps, k.fn(["pair"], (pr) => entry(pr, (_x, y) => y, ["a axis", "b axis"])));
  const contracted = def("contracted", ["first", "second", "pairs"], (a, b, ps) => tenOf(a, (sa, xs) => tenOf(b, (sb, ys) =>
    k.let("a axes", firsts(ps), (as) => k.let("b axes", seconds(ps), (bs) =>
      k.let("a rank", k.call(length, sa), (ra) => k.let("b rank", k.call(length, sb), (rb) =>
        k.if(k.call(S.and, k.call(S.and, axesInRange(as, ra), axesInRange(bs, rb)), k.call(S.and, k.call(S.and, once(as), once(bs)), k.equal(lengthsAt(sa, as), lengthsAt(sb, bs)))),
          k.let("a free", k.call(axesBut, k.call(INT_OPS.range, ra), as), (fa) => k.let("b free", k.call(axesBut, k.call(INT_OPS.range, rb), bs), (fb) =>
            k.let("shape", k.call(append, lengthsAt(sa, fa), lengthsAt(sb, fb)), (shape) => k.let("summed indices", k.call(indicesOf, lengthsAt(sa, as)), (sums) =>
              k.let("b starts", k.call(length, fa), (bStart) => T(shape,
              k.call(map, k.call(indicesOf, shape), k.fn(["at"], (rix) => k.call(tsum, k.call(map, sums, k.fn(["summed"], (kix) =>
                k.call(ARITH.mul,
                  itemFitting(sa, xs, indexFor(ra, as, fa, k.int(0), kix, rix)),
                  itemFitting(sb, ys, indexFor(rb, bs, fb, bStart, kix, rix)))))))))))))),
          k.call(ABORT_OP, texts(k.lit("contracted: the pairs don't fit a "), k.call(shapeText, sa), k.lit(" tensor and a "), k.call(shapeText, sb), k.lit(" one: each pair needs an axis of each, of the same length, each axis in one pair at most")))))))))));
  // Axis order[k] of the tensor becomes axis k.
  const transposedBy = def("transposed by", ["tensor", "order"], (t, order) => tenOf(t, (sa, xs) => k.let("rank", k.call(length, sa), (r) =>
    k.if(k.call(S.and, iSame(k.call(length, order), r), k.call(S.and, axesInRange(order, r), once(order))),
      k.let("shape", lengthsAt(sa, order), (shape) => T(shape, k.call(map, k.call(indicesOf, shape), k.fn(["at"], (nix) =>
        itemFitting(sa, xs, k.call(map, k.call(INT_OPS.range, r), k.fn(["axis"], (p) => k.call(itemAt, nix, k.call(placeOf, order, p, k.int(0)), k.int(0))))))))),
      k.call(ABORT_OP, texts(k.lit("transposed by: the order doesn't name each axis of a "), k.call(shapeText, sa), k.lit(" tensor once")))))));
  // The sum over the diagonal of two axes of the same length.
  const traced = def("traced", ["tensor", "first axis", "second axis"], (t, i, j) => tenOf(t, (sa, xs) => k.let("rank", k.call(length, sa), (r) =>
    k.let("both", k.call(CONS, i, k.call(CONS, j, k.x(NIL))), (ij) =>
    k.if(k.call(S.and, k.call(S.and, axesInRange(ij, r), once(ij)), iSame(k.call(itemAt, sa, i, k.int(0)), k.call(itemAt, sa, j, k.int(0)))),
      k.let("free", k.call(axesBut, k.call(INT_OPS.range, r), ij), (free) => k.let("shape", lengthsAt(sa, free), (shape) =>
        k.let("diagonal", k.call(INT_OPS.range, k.call(itemAt, sa, i, k.int(0))), (diag) =>
        T(shape, k.call(map, k.call(indicesOf, shape), k.fn(["at"], (rix) => k.call(tsum, k.call(map, diag, k.fn(["d"], (d) =>
          itemFitting(sa, xs, k.call(map, k.call(INT_OPS.range, r), k.fn(["axis"], (p) => k.if(k.call(contains, ij, p), d, k.call(itemAt, rix, k.call(placeOf, free, p, k.int(0)), k.int(0))))))))))))))),
      k.call(ABORT_OP, texts(k.lit("traced: two different axes of the same length, of a "), k.call(shapeText, sa), k.lit(" tensor"))))))));
  // Step c (L51c): a Tensor of a Number has + − · −x item by item, for any
  // Number (one implementation with a type parameter, L219). Shapes that
  // differ stop the program, naming both, as an overflow stops (Ersagun's
  // choice, 2026-11-03): Arithmetic's operations are pure, so not abort.
  const itemByItem = (what: string, op: Id) => def(`tensor ${what}`, ["first", "second"], (a, b) => tenOf(a, (sa, xs) => tenOf(b, (sb, ys) =>
    k.if(k.equal(sa, sb),
      T(sa, k.call(map, k.call(zipped, xs, ys), k.fn(["pair"], (p) => entry(p, (x, y) => k.call(op, x, y), ["x", "y"])))),
      k.call(S.stop, texts(k.lit(`tensor ${what}: a `), k.call(shapeText, sa), k.lit(" tensor and a "), k.call(shapeText, sb), k.lit(" one")))))));
  const tensorAdd = itemByItem("sum", ARITH.add), tensorSub = itemByItem("difference", ARITH.sub), tensorMul = itemByItem("product item by item", ARITH.mul);
  const tensorNeg = def("tensor negated", ["tensor"], (t) => tenOf(t, (sh, xs) => T(sh, k.call(map, xs, k.fn(["x"], (x) => k.call(ARITH.neg, x))))));
  arithmetics.push(impl("arithmetic at tensor", ARITHMETIC_V, [tensorAdd, tensorSub, tensorMul, tensorNeg]));
  // State (L16, std.ts's State): with state(initial, action) runs the
  // action with get state and put state answered, and gives its value and
  // the last state. Each case answers with a function of the state so far
  // and hands the rest the next one.
  const withState = def("with state", ["initial", "action"], (init, a) => k.call(k.handle(k.call(a), [
    { variant: STATE_OPS.get, names: ["rest"], body: ([rest]) => k.fn(["state"], (st) => k.call(k.call(rest, st), st)) },
    { variant: STATE_OPS.put, names: ["value", "rest"], body: ([v, rest]) => k.fn(["state"], () => k.call(k.call(rest, k.unitValue), v)) },
  ], ["value", (v) => k.fn(["state"], (st) => P(v, st))]), init));
  const changeState = def("change state", ["f"], (f) => k.call(STATE_OPS.put, k.call(f, k.call(STATE_OPS.get))));
  // A pipeline (L64, std.ts's Send, Receive and Pipe): `pipe of` runs the
  // producer to its first send and stops it there; `piped` runs the
  // consumer, and each receive takes the item the producer stopped at and
  // runs it on to its next send, or gives none once it has finished.
  const pipeOf = def("pipe of", ["producer"], (pr) => k.handle(k.call(pr), [
    { variant: PIPE_OPS.send, names: ["item", "rest"], body: ([x, rest]) => k.call(PIPE_OPS.sent, x, k.thunk(() => k.call(rest, k.unitValue))) },
  ], ["value", () => k.x(PIPE_OPS.finished)]));
  const piped = def("piped", ["producer", "consumer"], (pr, co) => k.call(k.handle(k.call(co), [
    { variant: PIPE_OPS.receive, names: ["rest"], body: ([rest]) => k.fn(["pipe"], (p) => k.match(p, [
      { variant: PIPE_OPS.sent, names: ["item", "more"], body: ([x, more]) => k.call(k.call(rest, k.call(SOME, x)), k.call(more)) },
      { variant: PIPE_OPS.finished, names: [], body: () => k.call(k.call(rest, k.x(NONE)), p) },
    ])) },
  ], ["value", (v) => k.fn(["pipe"], () => v)]), k.call(pipeOf, pr)));
  const matrixHelpers = [listDot, eliminated, backSubstituted, determinantOf, tensorAdd, tensorSub, tensorMul, tensorNeg];
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
    { variant: TICKET_V.at, names: ["time", "value"], body: ([at]) => k.call(TICKET_V.at, at, k.unitValue) },
  ])));
  const anyOf = k.def("any of");
  k.define(anyOf, k.fn(["tickets"], (ts) => k.call(TICKET_V.firstReady, ts, k.fn(["i"], (i) => i))));
  const startBranch = k.def("start branch");
  k.define(startBranch, k.fn(["action"], (a) => k.handle(k.call(a), [
    { variant: AWAIT_OP, names: ["ticket", "rest"], body: ([t, rest]) => k.call(BRANCH_V.parked, k.call(ticketId, t), k.thunk(() => k.call(rest, k.call(AWAIT_OP, t)))) },
    // Starting a timer is answered outward, and the branch goes on at once.
    { variant: START_TIMER_OP, names: ["milliseconds", "rest"], body: ([ms, rest]) => k.call(rest, k.call(START_TIMER_OP, ms)) },
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
  // A simulated world for tests (L63, LANGUAGE-NEEDS Part 1 "Deterministic
  // testing"): `simulated(seed, action)` answers Await from a virtual clock
  // that starts at 0, so no pause is real, and when several tickets are
  // ready at the same moment it picks one with Random, seeded by `seed`
  // like the action's own random numbers. Time's `now` reads the same
  // clock and Wait's `wait` moves it (L138). A schedule is then a seed: the
  // same every run, and another seed tries another order. The clock is
  // passed along as the rests resume (a handler's state, the
  // parameter-passing handlers of Plotkin and Pretnar), and a timer it
  // starts is a ticket `at` its deadline. Prior art: FoundationDB's
  // deterministic simulation (Will Wilson, 2014), tokio's paused clock.
  const readyAt = k.def("ready at");
  const earliest = k.def("earliest");
  k.define(earliest, k.fn(["times"], (ts) => k.match(ts, [
    { variant: NIL, names: [], body: () => k.call(ABORT_OP, k.lit("any of no tickets is never ready")) },
    { variant: CONS, names: ["time", "others"], body: ([t, others]) => k.match(others, [
      { variant: NIL, names: [], body: () => t },
      { variant: CONS, names: ["next", "rest"], body: () => k.let("soonest", k.call(earliest, others), (e) => k.if(k.call(S.less, e, t), e, t)) },
    ]) },
  ])));
  const readyTimes = k.def("ready times");
  k.define(readyTimes, k.fn(["tickets", "now"], (ts, now) => k.match(ts, [
    { variant: NIL, names: [], body: () => NIL },
    { variant: CONS, names: ["ticket", "others"], body: ([t, others]) => k.call(CONS, k.call(readyAt, t, now), k.call(readyTimes, others, now)) },
  ])));
  const foreign = () => k.call(ABORT_OP, k.lit("a ticket from another world, awaited in a simulated one"));
  k.define(readyAt, k.fn(["ticket", "now"], (t, now) => k.match(t, [
    { variant: TICKET_V.ticket, names: ["number"], body: foreign },
    { variant: TICKET_V.timer, names: ["milliseconds", "value"], body: ([ms]) => k.call(B.add, now, ms) },
    { variant: TICKET_V.firstReady, names: ["tickets", "which"], body: ([ts]) => k.call(earliest, k.call(readyTimes, ts, now)) },
    { variant: TICKET_V.at, names: ["time", "value"], body: ([at]) => at },
  ])));
  // The positions whose time is `at`.
  const tiedAt = k.def("tied at");
  k.define(tiedAt, k.fn(["times", "at", "position"], (ts, at, i) => k.match(ts, [
    { variant: NIL, names: [], body: () => NIL },
    { variant: CONS, names: ["time", "others"], body: ([t, others]) => k.let("later ones", k.call(tiedAt, others, at, k.call(INT_OPS.add, i, k.int(1))), (r) => k.if(k.equal(t, at), k.call(CONS, i, r), r)) },
  ])));
  // The one at x · count, x in [0, 1): each as likely.
  const pickAt = k.def("pick at");
  k.define(pickAt, k.fn(["positions", "x"], (ps, x) => k.match(ps, [
    { variant: NIL, names: [], body: () => k.call(ABORT_OP, k.lit("nothing to pick from")) },
    { variant: CONS, names: ["position", "others"], body: ([p, others]) => k.match(others, [
      { variant: NIL, names: [], body: () => p },
      { variant: CONS, names: ["next", "rest"], body: () => k.if(k.call(S.less, x, k.lit(1)), p, k.call(pickAt, others, k.call(B.sub, x, k.lit(1)))) },
    ]) },
  ])));
  const later = (now: Id, at: Id) => k.if(k.call(S.less, at, now), now, at);
  // The schedule's own random numbers (L142), apart from the action's, so
  // an action that draws one more number keeps the schedule its seed
  // names: Park and Miller's minimal standard generator (CACM 1988), a
  // state in 1 … 2³¹ − 2 multiplied by 16807 modulo 2³¹ − 1, exact in a
  // Float64. Kept by the simulated world beside its clock.
  const M31 = 2147483647;
  const modM = (of: Id) => k.let("x", of, (x) => k.let("r", k.call(B.sub, x, k.call(B.mul, k.call(S.floor, k.call(B.mul, x, k.lit(1 / M31))), k.lit(M31))), (r) =>
    k.if(k.call(S.less, r, k.lit(0)), k.call(B.add, r, k.lit(M31)), k.if(k.call(S.less, r, k.lit(M31)), r, k.call(B.sub, r, k.lit(M31))))));
  const nextDraw = k.def("next schedule draw");
  k.define(nextDraw, k.fn(["state"], (st) => modM(k.call(B.mul, st, k.lit(16807)))));
  const firstDraw = k.def("first schedule draw");
  // A state from the seed, three steps on, so small seeds don't start
  // near 0.
  const step = (x: Id) => k.call(nextDraw, x);
  k.define(firstDraw, k.fn(["seed"], (seed) => step(step(step(k.call(B.add, k.lit(1), k.let("m", modM(k.call(S.abs, k.call(S.floor, seed))), (m) =>
    k.if(k.call(S.less, m, k.lit(M31 - 1)), m, k.lit(0)))))))));
  const simulatedWorld = k.def("simulated world");
  k.define(simulatedWorld, k.fn(["action"], (a) => k.handle(k.call(a), [
    { variant: START_TIMER_OP, names: ["milliseconds", "rest"], body: ([ms, rest]) => k.fn(["now", "schedule"], (now, sch) =>
      k.call(k.call(rest, k.call(TICKET_V.at, k.call(B.add, now, ms), k.unitValue)), now, sch)) },
    { variant: AWAIT_OP, names: ["ticket", "rest"], body: ([t, rest]) => k.fn(["now", "schedule"], (now, sch) => k.match(t, [
      { variant: TICKET_V.timer, names: ["milliseconds", "value"], body: ([ms, v]) => k.call(k.call(rest, v), k.call(B.add, now, ms), sch) },
      { variant: TICKET_V.at, names: ["time", "value"], body: ([at, v]) => k.call(k.call(rest, v), later(now, at), sch) },
      { variant: TICKET_V.firstReady, names: ["tickets", "which"], body: ([ts, which]) => k.let("times", k.call(readyTimes, ts, now), (times) =>
        k.let("soonest", k.call(earliest, times), (at) => k.let("tied", k.call(tiedAt, times, at, k.int(0)), (tied) =>
          k.let("picked", k.call(pickAt, tied, k.call(B.mul, k.call(B.mul, sch, k.lit(1 / M31)), k.call(INT_OPS.toNumber, k.call(length, tied)))), (i) =>
            k.call(k.call(rest, k.call(which, i)), later(now, at), k.call(nextDraw, sch)))))) },
      { variant: TICKET_V.ticket, names: ["number"], body: foreign },
    ])) },
  ], ["value", (v) => k.fn(["now", "schedule"], () => v)])));
  // Time and Wait on the same clock (L138), so `now` after a 5 s timer is
  // 5000 every run and `wait` never really sleeps: a wait is an await of a
  // timer, and now is the time of a timer of 0 started now, which the
  // simulated world gives as a ticket `at` its clock.
  const simulatedClock = k.def("simulated clock");
  k.define(simulatedClock, k.fn(["action"], (a) => k.handle(
    k.handle(k.call(a), [
      { variant: WAIT_OP, names: ["milliseconds"], body: ([ms]) => k.call(AWAIT_OP, k.call(TICKET_V.timer, ms, k.unitValue)) },
    ]),
    [{ variant: NOW_OP, names: [], body: () => k.match(k.call(START_TIMER_OP, k.lit(0)), [
      { variant: TICKET_V.at, names: ["time", "value"], body: ([t]) => t },
    ], k.call(ABORT_OP, k.lit("the simulated world's clock gave no time"))) }],
  )));
  const simulated = k.def("simulated");
  k.define(simulated, k.fn(["seed", "action"], (seed, a) => k.call(S.seeded, seed, k.thunk(() => k.call(k.call(simulatedWorld, k.thunk(() => k.call(simulatedClock, a))), k.lit(0), k.call(firstDraw, seed))))));
  const simulatedHelpers = [readyAt, earliest, readyTimes, tiedAt, pickAt, nextDraw, firstDraw, simulatedWorld, simulatedClock];
  const awaitHelpers = [startBranch, waiting, goOn, finished, settle, firstDone, raceSettle, ...simulatedHelpers];

  // Bytes (L189): a list of Ints 0 to 255, checked when made. UTF-8 is
  // written here in the language (RFC 3629): a code point in one to four
  // bytes, a lead byte saying how many follow, each following one 10xxxxxx.
  const Bt = (xs: Id) => k.call(BYTES_V, xs);
  const bytesIn = (b: Id, f: (xs: Id) => Id) => k.match(b, [{ variant: BYTES_V, names: ["items"], body: ([xs]) => f(xs) }]);
  const isByte = def("is byte", ["number"], (n) => k.if(iLess(n, k.int(0)), k.false, iLess(n, k.int(256))));
  const bytesOf = def("bytes of", ["items"], (xs) => k.if(k.call(allPass, xs, k.x(isByte)), Bt(xs),
    k.call(ABORT_OP, k.lit("bytes of: every item is a byte, a whole number from 0 to 255"))));
  const byteItems = def("byte items", ["bytes"], (b) => bytesIn(b, (xs) => xs));
  const byteCount = def("byte count", ["bytes"], (b) => bytesIn(b, (xs) => k.call(length, xs)));
  // Shifts and masks, which have one answer where quotient has none for 0.
  const q = (a: Id, n: number) => k.call(INT_OPS.shiftDown, a, k.int(Math.log2(n))), r64 = (a: Id) => k.call(INT_OPS.bitAnd, a, k.int(63));
  const cont = (a: Id) => iAdd(k.int(128), r64(a));
  const utf8Code = def("utf8 code", ["code point"], (c) => k.if(iLess(c, k.int(0x80)), k.list(c),
    k.if(iLess(c, k.int(0x800)), k.list(iAdd(k.int(0xc0), q(c, 64)), cont(c)),
    k.if(iLess(c, k.int(0x10000)), k.list(iAdd(k.int(0xe0), q(c, 4096)), cont(q(c, 64)), cont(c)),
    k.list(iAdd(k.int(0xf0), q(c, 262144)), cont(q(c, 4096)), cont(q(c, 64)), cont(c))))));
  const utf8Of = def("utf8 of", ["text"], (t) => Bt(k.call(flatMap, k.call(TEXT_OPS.characters, t), k.fn(["character"], (ch) =>
    k.call(utf8Code, k.call(S.first, k.thunk(() => k.call(TEXT_OPS.code, ch)), k.thunk(() => k.int(0))))))));
  // The characters the bytes spell: `decoded` reads a lead byte, `decoded
  // after` the bytes that follow it, then the next character.
  const bad = (why: string) => k.call(ABORT_OP, k.lit(`text of utf8: ${why}`));
  const decoded = k.def("utf8 characters"), decodedAfter = k.def("utf8 character after");
  k.define(decodedAfter, k.fn(["bytes", "following", "so far"], (xs, n, acc) => k.if(iSame(n, k.int(0)),
    k.call(CONS, k.call(S.first, k.thunk(() => k.call(TEXT_OPS.fromCode, acc)), k.thunk(() => bad("a code point that is no character"))), k.call(decoded, xs)),
    k.match(xs, [
      { variant: NIL, names: [], body: () => bad("the bytes end inside a character") },
      { variant: CONS, names: ["byte", "rest"], body: ([c, rest]) => k.if(k.call(S.and, k.call(S.not, iLess(c, k.int(0x80))), iLess(c, k.int(0xc0))),
        k.call(decodedAfter, rest, k.call(INT_OPS.sub, n, k.int(1)), iAdd(iMul(acc, k.int(64)), k.call(INT_OPS.sub, c, k.int(0x80)))),
        bad("a character's following byte isn't 10xxxxxx")) },
    ]))));
  const lead = (xs: Id, b: Id, n: number, base: number) => k.call(decodedAfter, xs, k.int(n), k.call(INT_OPS.sub, b, k.int(base)));
  k.define(decoded, k.fn(["bytes"], (xs) => k.match(xs, [
    { variant: NIL, names: [], body: () => k.x(NIL) },
    { variant: CONS, names: ["byte", "rest"], body: ([b, rest]) => k.if(iLess(b, k.int(0x80)), lead(rest, b, 0, 0),
      k.if(iLess(b, k.int(0xc0)), bad("a following byte where a character starts"),
      k.if(iLess(b, k.int(0xe0)), lead(rest, b, 1, 0xc0),
      k.if(iLess(b, k.int(0xf0)), lead(rest, b, 2, 0xe0),
      k.if(iLess(b, k.int(0xf8)), lead(rest, b, 3, 0xf0), bad("a byte no character starts with")))))) },
  ])));
  const textOfUtf8 = def("text of utf8", ["bytes"], (b) => bytesIn(b, (xs) => k.call(TEXT_OPS.joinAll, k.call(decoded, xs), k.lit(""))));
  // JSON (L190, RFC 8259): a Json value as its text. Text is quoted with
  // ", \\ and the control characters escaped; a Float64 is written as show
  // writes it, which JSON reads (finite, with e for large and small).
  const hexAt = (n: Id) => k.call(itemAt, k.call(TEXT_OPS.characters, k.lit("0123456789abcdef")), n, k.lit("0"));
  const jsonChar = def("json character", ["character"], (ch) => k.let("code", k.call(S.first, k.thunk(() => k.call(TEXT_OPS.code, ch)), k.thunk(() => k.int(0))), (c) =>
    k.if(iSame(c, k.int(34)), k.lit("\\\""), k.if(iSame(c, k.int(92)), k.lit("\\\\"), k.if(iSame(c, k.int(10)), k.lit("\\n"),
    k.if(iLess(c, k.int(32)), texts(k.lit("\\u00"), hexAt(k.call(INT_OPS.shiftDown, c, k.int(4))), hexAt(k.call(INT_OPS.bitAnd, c, k.int(15)))), ch))))));
  const jsonQuoted = def("json quoted", ["text"], (t) => texts(k.lit("\""), k.call(TEXT_OPS.joinAll, k.call(map, k.call(TEXT_OPS.characters, t), k.x(jsonChar)), k.lit("")), k.lit("\"")));
  const jsonPrinted = k.def("json printed");
  k.define(jsonPrinted, k.fn(["json"], (j) => k.match(j, [
    { variant: JSON_V.null, names: [], body: () => k.lit("null") },
    { variant: JSON_V.bool, names: ["value"], body: ([b]) => k.if(b, k.lit("true"), k.lit("false")) },
    { variant: JSON_V.number, names: ["value"], body: ([x]) => k.call(S.show, x) },
    { variant: JSON_V.text, names: ["value"], body: ([t]) => k.call(jsonQuoted, t) },
    { variant: JSON_V.list, names: ["items"], body: ([xs]) => texts(k.lit("["), k.call(TEXT_OPS.joinAll, k.call(map, xs, k.x(jsonPrinted)), k.lit(",")), k.lit("]")) },
    { variant: JSON_V.object, names: ["fields"], body: ([fs]) => texts(k.lit("{"), k.call(TEXT_OPS.joinAll, k.call(map, fs, k.fn(["field"], (f) =>
      entry(f, (name, v) => texts(k.call(jsonQuoted, name), k.lit(":"), k.call(jsonPrinted, v)), ["name", "value"]))), k.lit(",")), k.lit("}")) },
  ])));
  // Json printed over lines (L190f), the same text as JSON.stringify(value,
  // null, step): each item and field on its own line, indented by `step`
  // spaces a level, and `: ` after a field's name; an empty list or object
  // stays [] or {}.
  const jsonLaid = k.def("json laid out");
  k.define(jsonLaid, k.fn(["json", "step", "indent"], (j, step, ind) => {
    const block = (open: string, close: string, xs: Id, one: (x: Id, inner: Id) => Id) => k.match(xs, [
      { variant: NIL, names: [], body: () => k.lit(open + close) },
      { variant: CONS, names: ["first", "more"], body: () => k.let("inner", texts(ind, k.call(repeated, k.lit(" "), step)), (inner) =>
        texts(k.lit(open + "\n"), inner, k.call(TEXT_OPS.joinAll, k.call(map, xs, k.fn(["item"], (x) => one(x, inner))), texts(k.lit(",\n"), inner)), k.lit("\n"), ind, k.lit(close))) },
    ]);
    return k.match(j, [
      { variant: JSON_V.list, names: ["items"], body: ([xs]) => block("[", "]", xs, (x, inner) => k.call(jsonLaid, x, step, inner)) },
      { variant: JSON_V.object, names: ["fields"], body: ([fs]) => block("{", "}", fs, (f, inner) =>
        entry(f, (name, v) => texts(k.call(jsonQuoted, name), k.lit(": "), k.call(jsonLaid, v, step, inner)), ["name", "value"])) },
    ], k.call(jsonPrinted, j));
  }));
  const jsonIndented = def("json printed indented", ["json", "step"], (j, step) => k.if(iLess(step, k.int(1)), k.call(jsonPrinted, j), k.call(jsonLaid, j, step, k.lit(""))));
  // Reading a Json value's parts (L190d), each with no answer when the value
  // is another kind, so a program's records read through `first` or a
  // search: json field(person, "name") and then json as text.
  const jAs = (name: string, v: Id) => def(`json as ${name}`, ["json"], (j) => k.match(j, [{ variant: v, names: ["value"], body: ([x]) => x }], k.call(S.fail)));
  const jsonAsNumber = jAs("number", JSON_V.number), jsonAsText = jAs("text", JSON_V.text), jsonAsBool = jAs("bool", JSON_V.bool);
  const jsonAsList = def("json as list", ["json"], (j) => k.match(j, [{ variant: JSON_V.list, names: ["items"], body: ([x]) => x }], k.call(S.fail)));
  const jFieldIn = k.def("json field in");
  k.define(jFieldIn, k.fn(["fields", "name"], (fs, n) => k.match(fs, [
    { variant: NIL, names: [], body: () => k.call(S.fail) },
    { variant: CONS, names: ["field", "rest"], body: ([f, r]) => entry(f, (fname, v) => k.if(k.equal(fname, n), v, k.call(jFieldIn, r, n)), ["field name", "value"]) },
  ])));
  const jsonField = def("json field", ["json", "name"], (j, n) => k.match(j, [{ variant: JSON_V.object, names: ["fields"], body: ([fs]) => k.call(jFieldIn, fs, n) }], k.call(S.fail)));
  // Reading JSON (L190b, RFC 8259): a recursive descent over the text's
  // characters, each reader giving its value and the characters after it.
  // \u escapes outside the Basic Multilingual Plane come as surrogate
  // pairs and are joined (json escape code).
  const jChars = (t: string) => k.call(TEXT_OPS.characters, k.lit(t));
  const jIs = (c: Id, t: string) => k.equal(c, k.lit(t));
  const jBad = (why: string) => k.call(ABORT_OP, k.lit(`json read: ${why}`));
  const jPair = (a: Id, b: Id) => k.call(PAIR_V, a, b);
  const jHead = (cs: Id, ends: string, f: (c: Id, rest: Id) => Id) => k.match(cs, [
    { variant: NIL, names: [], body: () => jBad(ends) },
    { variant: CONS, names: ["character", "rest"], body: ([c, r]) => f(c, r) },
  ]);
  const jSkipped = k.def("json skipped");
  k.define(jSkipped, k.fn(["characters"], (cs) => k.match(cs, [
    { variant: NIL, names: [], body: () => k.x(NIL) },
    { variant: CONS, names: ["character", "rest"], body: ([c, r]) => k.if(k.call(contains, jChars(" \n\t\r"), c), k.call(jSkipped, r), cs) },
  ])));
  const jValue = k.def("json value"), jString = k.def("json string"), jItems = k.def("json items"), jFields = k.def("json fields"), jNumber = k.def("json number span"), jHex = k.def("json hex");
  k.define(jHex, k.fn(["digits", "so far"], (ds, acc) => k.match(ds, [
    { variant: NIL, names: [], body: () => acc },
    { variant: CONS, names: ["digit", "rest"], body: ([d, r]) => k.match(k.call(positionOf, jChars("0123456789abcdef"), k.call(lowercase, d)), [
      { variant: NONE, names: [], body: () => jBad("\\u needs four hex digits") },
      { variant: SOME, names: ["value"], body: ([i]) => k.call(jHex, r, iAdd(iMul(acc, k.int(16)), i)) },
    ]) },
  ])));
  const jEscaped = (e: Id) => k.if(jIs(e, "n"), k.lit("\n"), k.if(jIs(e, "t"), k.lit("\t"), k.if(jIs(e, "r"), k.lit("\r"), k.if(jIs(e, "b"), k.lit("\b"), k.if(jIs(e, "f"), k.lit("\f"), e)))));
  // A \u escape's code, joining a surrogate pair (RFC 8259 §7) into the one
  // character outside the Basic Multilingual Plane it spells; a lone
  // surrogate is no character, and fromCode says so.
  const jSub = (a: Id, b: Id) => k.call(INT_OPS.sub, a, b);
  const jCode = k.def("json escape code");
  const jWithin = (x: Id, lo: number, hi: number, yes: () => Id, no: () => Id) => k.if(iLess(x, k.int(lo)), no(), k.if(iLess(x, k.int(hi)), yes(), no()));
  k.define(jCode, k.fn(["characters"], (cs) => k.let("high", k.call(jHex, k.call(take, cs, k.int(4)), k.int(0)), (hi) => k.let("after", k.call(drop, cs, k.int(4)), (after) =>
    jWithin(hi, 0xd800, 0xdc00, () => k.if(k.equal(k.call(take, after, k.int(2)), jChars("\\u")),
      k.let("low", k.call(jHex, k.call(take, k.call(drop, after, k.int(2)), k.int(4)), k.int(0)), (lo) => jWithin(lo, 0xdc00, 0xe000,
        () => jPair(iAdd(k.int(0x10000), iAdd(iMul(jSub(hi, k.int(0xd800)), k.int(0x400)), jSub(lo, k.int(0xdc00)))), k.call(drop, after, k.int(6))),
        () => jPair(hi, after))),
      jPair(hi, after)), () => jPair(hi, after))))));
  k.define(jString, k.fn(["characters", "so far"], (cs, acc) => jHead(cs, "the text ends inside a string", (c, r) =>
    k.if(jIs(c, "\""), jPair(acc, r), k.if(jIs(c, "\\"), jHead(r, "the text ends inside a string", (e, r2) =>
      k.if(jIs(e, "u"), entry(k.call(jCode, r2), (code, r3) => k.call(jString, r3, k.call(S.concat, acc, k.call(S.first,
        k.thunk(() => k.call(TEXT_OPS.fromCode, code)), k.thunk(() => jBad("a \\u escape that is no character"))))), ["code", "rest"]),
      k.call(jString, r2, k.call(S.concat, acc, jEscaped(e))))),
    k.call(jString, r, k.call(S.concat, acc, c)))))));
  k.define(jNumber, k.fn(["characters", "so far"], (cs, acc) => k.match(cs, [
    { variant: NIL, names: [], body: () => jPair(acc, k.x(NIL)) },
    { variant: CONS, names: ["character", "rest"], body: ([c, r]) => k.if(k.call(contains, jChars("0123456789+-.eE"), c), k.call(jNumber, r, k.call(S.concat, acc, c)), jPair(acc, cs)) },
  ])));
  const jWord = (cs: Id, word: string, v: () => Id) => k.if(k.equal(k.call(take, cs, k.int(word.length)), jChars(word)), jPair(v(), k.call(drop, cs, k.int(word.length))), jBad(`expected ${word}`));
  k.define(jValue, k.fn(["characters"], (cs0) => k.let("start", k.call(jSkipped, cs0), (cs) => jHead(cs, "the text ends where a value goes", (c, r) =>
    k.if(jIs(c, "n"), jWord(cs, "null", () => k.x(JSON_V.null)),
    k.if(jIs(c, "t"), jWord(cs, "true", () => k.call(JSON_V.bool, k.true)),
    k.if(jIs(c, "f"), jWord(cs, "false", () => k.call(JSON_V.bool, k.false)),
    k.if(jIs(c, "\""), entry(k.call(jString, r, k.lit("")), (t, rest) => jPair(k.call(JSON_V.text, t), rest), ["text", "rest"]),
    k.if(jIs(c, "["), k.let("inside", k.call(jSkipped, r), (ins) => jHead(ins, "the text ends inside a list", (c2, r2) => k.if(jIs(c2, "]"), jPair(k.call(JSON_V.list, k.x(NIL)), r2), k.call(jItems, ins, k.x(NIL))))),
    k.if(jIs(c, "{"), k.let("inside", k.call(jSkipped, r), (ins) => jHead(ins, "the text ends inside an object", (c2, r2) => k.if(jIs(c2, "}"), jPair(k.call(JSON_V.object, k.x(NIL)), r2), k.call(jFields, ins, k.x(NIL))))),
    entry(k.call(jNumber, cs, k.lit("")), (digits, rest) => jPair(k.call(JSON_V.number, k.call(S.first, k.thunk(() => k.call(TEXT_OPS.readNumber, digits)), k.thunk(() => jBad("expected a value")))), rest), ["digits", "rest"])))))))))));
  k.define(jItems, k.fn(["characters", "so far"], (cs, acc) => entry(k.call(jValue, cs), (v, rest) => k.let("after", k.call(jSkipped, rest), (a) =>
    jHead(a, "the text ends inside a list", (c, r) => k.if(jIs(c, ","), k.call(jItems, r, k.call(CONS, v, acc)),
      k.if(jIs(c, "]"), jPair(k.call(JSON_V.list, k.call(reverse, k.call(CONS, v, acc))), r), jBad("expected , or ] in a list"))))), ["value", "rest"])));
  k.define(jFields, k.fn(["characters", "so far"], (cs0, acc) => k.let("at", k.call(jSkipped, cs0), (cs) => jHead(cs, "the text ends inside an object", (c, r) =>
    k.if(jIs(c, "\""), entry(k.call(jString, r, k.lit("")), (name, r2) => k.let("colon", k.call(jSkipped, r2), (cl) => jHead(cl, "the text ends inside an object", (c2, r3) =>
      k.if(jIs(c2, ":"), entry(k.call(jValue, r3), (v, r4) => k.let("next", k.call(jSkipped, r4), (nx) => jHead(nx, "the text ends inside an object", (c3, r5) =>
        k.if(jIs(c3, ","), k.call(jFields, r5, k.call(CONS, jPair(name, v), acc)),
        k.if(jIs(c3, "}"), jPair(k.call(JSON_V.object, k.call(reverse, k.call(CONS, jPair(name, v), acc))), r5), jBad("expected , or } in an object"))))), ["value", "rest"]),
      jBad("expected : after a field's name")))), ["name", "rest"]),
    jBad("expected a field's name in quotes"))))));
  const jsonRead = def("json read", ["text"], (t) => entry(k.call(jValue, k.call(TEXT_OPS.characters, t)), (v, rest) => k.match(k.call(jSkipped, rest), [
    { variant: NIL, names: [], body: () => v },
    { variant: CONS, names: ["character", "after"], body: () => jBad("text after the value") },
  ]), ["value", "rest"]));
  // Calendar dates (L188a): the proleptic Gregorian calendar, a date
  // counted as days from 1970-01-01 both ways by Howard Hinnant's
  // days_from_civil and civil_from_days ("chrono-Compatible Low-Level Date
  // Algorithms", 2013), in floor division throughout.
  const fdiv = (a: Id, n: number) => k.call(S.first, k.thunk(() => k.call(INT_OPS.quotient, a, k.int(n))), k.thunk(() => k.int(0)));
  const fmod = (a: Id, n: number) => k.call(S.first, k.thunk(() => k.call(INT_OPS.remainder, a, k.int(n))), k.thunk(() => k.int(0)));
  const iSub = (a: Id, b: Id) => k.call(INT_OPS.sub, a, b);
  const dateIn = (d: Id, f: (y: Id, m: Id, day: Id) => Id) => k.match(d, [{ variant: DATE_V, names: ["year", "month", "day"], body: ([y, m, dd]) => f(y, m, dd) }]);
  const leapYear = def("leap year", ["year"], (y) => k.if(iSame(fmod(y, 4), k.int(0)), k.if(iSame(fmod(y, 100), k.int(0)), iSame(fmod(y, 400), k.int(0)), k.true), k.false));
  const daysInMonth = def("days in month", ["year", "month"], (y, m) => k.if(iSame(m, k.int(2)), k.if(k.call(leapYear, y), k.int(29), k.int(28)),
    k.if(k.call(contains, k.list(k.int(4), k.int(6), k.int(9), k.int(11)), m), k.int(30), k.int(31))));
  const between = (x: Id, lo: number, hi: Id) => k.call(S.and, k.call(S.not, iLess(x, k.int(lo))), k.call(S.not, iLess(hi, x)));
  const dateOf = def("date of", ["year", "month", "day"], (y, m, d) => k.if(k.call(S.and, between(m, 1, k.int(12)), between(d, 1, k.call(daysInMonth, y, m))),
    k.call(DATE_V, y, m, d), k.call(ABORT_OP, k.lit("date of: a month from 1 to 12 and a day that month has"))));
  const dateYear = def("date year", ["date"], (d) => dateIn(d, (y) => y));
  const dateMonth = def("date month", ["date"], (d) => dateIn(d, (_y, m) => m));
  const dateDay = def("date day", ["date"], (d) => dateIn(d, (_y, _m, dd) => dd));
  const dayNumber = def("day number", ["date"], (d) => dateIn(d, (y0, m, dd) => k.let("y", iSub(y0, k.if(iLess(k.int(2), m), k.int(0), k.int(1))), (y) =>
    k.let("era", fdiv(y, 400), (era) => k.let("yoe", iSub(y, iMul(era, k.int(400))), (yoe) =>
    k.let("doy", iAdd(fdiv(iAdd(iMul(k.int(153), iAdd(m, k.if(iLess(k.int(2), m), k.int(-3), k.int(9)))), k.int(2)), 5), iSub(dd, k.int(1))), (doy) =>
    k.let("doe", iAdd(iSub(iAdd(iMul(yoe, k.int(365)), fdiv(yoe, 4)), fdiv(yoe, 100)), doy), (doe) =>
    iSub(iAdd(iMul(era, k.int(146097)), doe), k.int(719468)))))))));
  const dateOfDay = def("date of day number", ["days"], (z0) => k.let("z", iAdd(z0, k.int(719468)), (z) => k.let("era", fdiv(z, 146097), (era) =>
    k.let("doe", iSub(z, iMul(era, k.int(146097))), (doe) =>
    k.let("yoe", fdiv(iSub(iAdd(iSub(doe, fdiv(doe, 1460)), fdiv(doe, 36524)), fdiv(doe, 146096)), 365), (yoe) =>
    k.let("doy", iSub(doe, iSub(iAdd(iMul(k.int(365), yoe), fdiv(yoe, 4)), fdiv(yoe, 100))), (doy) =>
    k.let("mp", fdiv(iAdd(iMul(k.int(5), doy), k.int(2)), 153), (mp) =>
    k.let("month", k.if(iLess(mp, k.int(10)), iAdd(mp, k.int(3)), iSub(mp, k.int(9))), (m) =>
    k.call(DATE_V, iAdd(iAdd(yoe, iMul(era, k.int(400))), k.if(iLess(k.int(2), m), k.int(0), k.int(1))), m,
      iAdd(iSub(doy, fdiv(iAdd(iMul(k.int(153), mp), k.int(2)), 5)), k.int(1)))))))))));
  const weekday = def("weekday", ["date"], (d) => iAdd(fmod(iAdd(k.call(dayNumber, d), k.int(3)), 7), k.int(1)));
  const addedDays = def("added days", ["date", "days"], (d, n) => k.call(dateOfDay, iAdd(k.call(dayNumber, d), n)));
  const daysBetween = def("days between", ["from", "to"], (a, b) => iSub(k.call(dayNumber, b), k.call(dayNumber, a)));
  const twoDigits = (n: Id) => k.call(padStart, k.call(INT_OPS.show, n), k.int(2), k.lit("0"));
  const dateText = def("date text", ["date"], (d) => dateIn(d, (y, m, dd) => texts(k.call(padStart, k.call(INT_OPS.show, y), k.int(4), k.lit("0")), k.lit("-"), twoDigits(m), k.lit("-"), twoDigits(dd))));
  // Reading a date (L188e): ISO 8601's year-month-day, digits only, the
  // year four digits or more; checked as date of checks.
  const dBad = () => k.call(ABORT_OP, k.lit("date read: a date is written year-month-day in digits, as 2026-11-03"));
  const digitsValue = k.def("digits value");
  k.define(digitsValue, k.fn(["characters", "so far"], (cs, acc) => k.match(cs, [
    { variant: NIL, names: [], body: () => acc },
    { variant: CONS, names: ["character", "rest"], body: ([c, r]) => k.if(k.call(isDigit, c),
      k.call(digitsValue, r, iAdd(iMul(acc, k.int(10)), iSub(k.call(S.first, k.thunk(() => k.call(TEXT_OPS.code, c)), k.thunk(() => k.int(48))), k.int(48)))), dBad()) },
  ])));
  const dPart = (part: Id, least: number) => k.let("part", part, (t) => k.if(iLess(k.call(TEXT_OPS.length, t), k.int(least)), dBad(), k.call(digitsValue, k.call(TEXT_OPS.characters, t), k.int(0))));
  const dateRead = def("date read", ["text"], (t) => k.let("parts", k.call(TEXT_OPS.split, t, k.lit("-")), (ps) => k.if(iSame(k.call(length, ps), k.int(3)),
    k.call(dateOf, dPart(k.call(itemAt, ps, k.int(0), k.lit("")), 4), dPart(k.call(itemAt, ps, k.int(1), k.lit("")), 2), dPart(k.call(itemAt, ps, k.int(2), k.lit("")), 2)), dBad())));
  // CSV (L190e, RFC 4180): rows of text fields. A field with a comma, a
  // quote or a line break is quoted, its quotes doubled; reading takes LF
  // or CRLF line ends, and a last line end makes no empty row.
  const cQuoted = def("csv field", ["text"], (t) => k.if(k.call(anyPass, k.call(TEXT_OPS.characters, t), k.fn(["character"], (c) => k.call(contains, jChars(",\"\n\r"), c))),
    texts(k.lit("\""), k.call(TEXT_OPS.joinAll, k.call(map, k.call(TEXT_OPS.characters, t), k.fn(["character"], (c) => k.if(jIs(c, "\""), k.lit("\"\""), c))), k.lit("")), k.lit("\"")), t));
  const csvPrinted = def("csv printed", ["rows"], (rows) => k.call(TEXT_OPS.joinAll, k.call(map, rows, k.fn(["row"], (row) =>
    k.call(TEXT_OPS.joinAll, k.call(map, row, k.x(cQuoted)), k.lit(",")))), k.lit("\n")));
  const cRows = k.def("csv rows from"), cQuote = k.def("csv quoted from");
  const done = (field: Id, row: Id) => k.call(reverse, k.call(CONS, field, row));
  k.define(cRows, k.fn(["characters", "field", "row", "rows"], (cs, f, row, rows) => k.match(cs, [
    { variant: NIL, names: [], body: () => k.if(k.call(S.and, k.equal(row, k.x(NIL)), k.equal(f, k.lit(""))), k.call(reverse, rows), k.call(reverse, k.call(CONS, done(f, row), rows))) },
    { variant: CONS, names: ["character", "rest"], body: ([c, r]) =>
      k.if(jIs(c, ","), k.call(cRows, r, k.lit(""), k.call(CONS, f, row), rows),
      k.if(jIs(c, "\n"), k.call(cRows, r, k.lit(""), k.x(NIL), k.call(CONS, done(f, row), rows)),
      k.if(jIs(c, "\r"), k.call(cRows, r, f, row, rows),
      k.if(k.call(S.and, jIs(c, "\""), k.equal(f, k.lit(""))), k.call(cQuote, r, k.lit(""), row, rows),
      k.call(cRows, r, k.call(S.concat, f, c), row, rows))))) },
  ])));
  k.define(cQuote, k.fn(["characters", "field", "row", "rows"], (cs, f, row, rows) => k.match(cs, [
    { variant: NIL, names: [], body: () => k.call(ABORT_OP, k.lit("csv rows: the text ends inside a quoted field")) },
    { variant: CONS, names: ["character", "rest"], body: ([c, r]) => k.if(jIs(c, "\""), k.match(r, [
      { variant: CONS, names: ["next", "after"], body: ([n, after]) => k.if(jIs(n, "\""), k.call(cQuote, after, k.call(S.concat, f, k.lit("\"")), row, rows), k.call(cRows, r, f, row, rows)) },
    ], k.call(cRows, r, f, row, rows)), k.call(cQuote, r, k.call(S.concat, f, c), row, rows)) },
  ])));
  const csvRows = def("csv rows", ["text"], (t) => k.call(cRows, k.call(TEXT_OPS.characters, t), k.lit(""), k.x(NIL), k.x(NIL)));
  // A CSV with a header line, read as records (L190g, as Python's
  // csv.DictReader): each later row a map from the header's names to its
  // fields. A row shorter than the header leaves the last names out.
  const csvRecords = def("csv records", ["text"], (t) => k.match(k.call(csvRows, t), [
    { variant: NIL, names: [], body: () => k.x(NIL) },
    { variant: CONS, names: ["header", "rows"], body: ([h, rs]) => k.call(map, rs, k.fn(["row"], (r) => k.call(asMap, k.call(zipped, h, r)))) },
  ]));
  // The other way (L190h, as csv.DictWriter): the column names as the
  // header line, then each record's value at each name, empty where it has
  // none.
  const csvOfRecords = def("csv of records", ["columns", "records"], (cols, rs) => {
    const value = (r: Id, c: Id) => k.call(S.first, k.thunk(() => k.call(lookup, r, c)), k.thunk(() => k.lit("")));
    const row = (r: Id) => k.call(map, cols, k.fn(["column"], (c) => value(r, c)));
    return k.call(csvPrinted, k.call(CONS, cols, k.call(map, rs, k.fn(["record"], row))));
  });
  // Bytes as text (L189d): hex, two digits a byte, and Base64 (RFC 4648 §4),
  // three bytes as four characters, = filling the last group.
  const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const b64At = (i: Id) => k.call(itemAt, jChars(B64), i, k.lit("="));
  const sh = (a: Id, n: number) => k.call(INT_OPS.shiftDown, a, k.int(n)), band = (a: Id, m: number) => k.call(INT_OPS.bitAnd, a, k.int(m));
  const b64Groups = k.def("base64 groups");
  k.define(b64Groups, k.fn(["bytes"], (xs) => k.match(xs, [
    { variant: NIL, names: [], body: () => k.x(NIL) },
    { variant: CONS, names: ["first", "after first"], body: ([a, r1]) => k.match(r1, [
      { variant: NIL, names: [], body: () => k.list(b64At(sh(a, 2)), b64At(iMul(band(a, 3), k.int(16))), k.lit("="), k.lit("=")) },
      { variant: CONS, names: ["second", "after second"], body: ([b, r2]) => k.match(r2, [
        { variant: NIL, names: [], body: () => k.list(b64At(sh(a, 2)), b64At(iAdd(iMul(band(a, 3), k.int(16)), sh(b, 4))), b64At(iMul(band(b, 15), k.int(4))), k.lit("=")) },
        { variant: CONS, names: ["third", "rest"], body: ([c, r3]) => k.call(append, k.list(b64At(sh(a, 2)), b64At(iAdd(iMul(band(a, 3), k.int(16)), sh(b, 4))),
          b64At(iAdd(iMul(band(b, 15), k.int(4)), sh(c, 6))), b64At(band(c, 63))), k.call(b64Groups, r3)) },
      ]) },
    ]) },
  ])));
  const base64Of = def("base64 of", ["bytes"], (b) => bytesIn(b, (xs) => k.call(TEXT_OPS.joinAll, k.call(b64Groups, xs), k.lit(""))));
  const b64Bad = () => k.call(ABORT_OP, k.lit("bytes of base64: only A to Z, a to z, 0 to 9, + and /, with = at the end"));
  const b64Value = (c: Id) => k.match(k.call(positionOf, jChars(B64), c), [
    { variant: NONE, names: [], body: () => b64Bad() },
    { variant: SOME, names: ["value"], body: ([i]) => i },
  ]);
  const b64Bytes = k.def("base64 bytes");
  // Four values make three bytes; two or three at the end, one or two.
  k.define(b64Bytes, k.fn(["values"], (vs) => k.match(vs, [
    { variant: NIL, names: [], body: () => k.x(NIL) },
    { variant: CONS, names: ["first", "after first"], body: ([v0, r1]) => k.match(r1, [
      { variant: CONS, names: ["second", "after second"], body: ([v1, r2]) => k.let("byte one", iAdd(iMul(v0, k.int(4)), sh(v1, 4)), (x) => k.match(r2, [
        { variant: NIL, names: [], body: () => k.list(x) },
        { variant: CONS, names: ["third", "after third"], body: ([v2, r3]) => k.let("byte two", iAdd(iMul(band(v1, 15), k.int(16)), sh(v2, 2)), (y) => k.match(r3, [
          { variant: NIL, names: [], body: () => k.list(x, y) },
          { variant: CONS, names: ["fourth", "rest"], body: ([v3, r4]) => k.call(CONS, x, k.call(CONS, y, k.call(CONS, iAdd(iMul(band(v2, 3), k.int(64)), v3), k.call(b64Bytes, r4)))) },
        ])) },
      ])) },
    ], b64Bad()) },
  ])));
  const bytesOfBase64 = def("bytes of base64", ["text"], (t) => Bt(k.call(b64Bytes, k.call(map, k.call(keep, k.call(TEXT_OPS.characters, t), k.fn(["character"], (c) => k.call(S.not, jIs(c, "=")))), k.fn(["character"], (c) => b64Value(c))))));
  const hexOf = def("hex of", ["bytes"], (b) => bytesIn(b, (xs) => k.call(TEXT_OPS.joinAll, k.call(map, xs, k.fn(["byte"], (x) => texts(hexAt(sh(x, 4)), hexAt(band(x, 15))))), k.lit(""))));
  const hexBad = () => k.call(ABORT_OP, k.lit("bytes of hex: two hex digits a byte, 0 to 9 and a to f"));
  const hexValue = (c: Id) => k.match(k.call(positionOf, jChars("0123456789abcdef"), k.call(lowercase, c)), [
    { variant: NONE, names: [], body: () => hexBad() },
    { variant: SOME, names: ["value"], body: ([i]) => i },
  ]);
  const hexBytes = k.def("hex bytes");
  k.define(hexBytes, k.fn(["digits"], (ds) => k.match(ds, [
    { variant: NIL, names: [], body: () => k.x(NIL) },
    { variant: CONS, names: ["high", "after high"], body: ([h, r]) => k.match(r, [
      { variant: CONS, names: ["low", "rest"], body: ([l, rest]) => k.call(CONS, iAdd(iMul(hexValue(h), k.int(16)), hexValue(l)), k.call(hexBytes, rest)) },
    ], hexBad()) },
  ])));
  const bytesOfHex = def("bytes of hex", ["text"], (t) => Bt(k.call(hexBytes, k.call(TEXT_OPS.characters, t))));
  // Times of day (L188c): whole seconds from midnight, 0 to 86399.
  const secsIn = (t: Id, f: (x: Id) => Id) => k.match(t, [{ variant: TIME_OF_DAY_V, names: ["seconds"], body: ([x]) => f(x) }]);
  const timeIn = (t: Id, f: (h: Id, m: Id, sec: Id) => Id) => secsIn(t, (x) => f(fdiv(x, 3600), fmod(fdiv(x, 60), 60), fmod(x, 60)));
  const timeOf = def("time of", ["hour", "minute", "second"], (h, m, sec) => k.if(k.call(S.and, between(h, 0, k.int(23)), k.call(S.and, between(m, 0, k.int(59)), between(sec, 0, k.int(59)))),
    k.call(TIME_OF_DAY_V, iAdd(iAdd(iMul(h, k.int(3600)), iMul(m, k.int(60))), sec)), k.call(ABORT_OP, k.lit("time of: an hour from 0 to 23, and a minute and a second from 0 to 59"))));
  const timeHour = def("time hour", ["time"], (t) => secsIn(t, (x) => fdiv(x, 3600)));
  const timeMinute = def("time minute", ["time"], (t) => secsIn(t, (x) => fmod(fdiv(x, 60), 60)));
  const timeSecond = def("time second", ["time"], (t) => secsIn(t, (x) => fmod(x, 60)));
  const secondsOfDay = def("seconds of day", ["time"], (t) => secsIn(t, (x) => x));
  const timeOfSeconds = def("time of seconds", ["seconds"], (n) => k.call(TIME_OF_DAY_V, fmod(n, 86400)));
  const timeText = def("time text", ["time"], (t) => timeIn(t, (h, m, sec) => texts(twoDigits(h), k.lit(":"), twoDigits(m), k.lit(":"), twoDigits(sec))));
  const tBad = () => k.call(ABORT_OP, k.lit("time read: a time is written hour:minute:second in two digits each, as 09:05:00"));
  const tPart = (part: Id) => k.let("part", part, (p) => k.if(iSame(k.call(TEXT_OPS.length, p), k.int(2)), k.call(digitsValue, k.call(TEXT_OPS.characters, p), k.int(0)), tBad()));
  const timeRead = def("time read", ["text"], (t) => k.let("parts", k.call(TEXT_OPS.split, t, k.lit(":")), (ps) => k.if(iSame(k.call(length, ps), k.int(3)),
    k.call(timeOf, tPart(k.call(itemAt, ps, k.int(0), k.lit(""))), tPart(k.call(itemAt, ps, k.int(1), k.lit(""))), tPart(k.call(itemAt, ps, k.int(2), k.lit("")))), tBad())));
  // Instants and durations (L188b): an instant is seconds since 1970-01-01
  // 00:00:00 UTC, a duration a Float64 in seconds, so hours(2) is 7200 s
  // and units.ts checks a duration isn't added to a metre.
  const fsec = (x: number, e = 1) => { const l = k.lit(x); (k.code.nodes[l] as NodeOf<"lit">).unit = { s: e }; return l; };
  const per = (name: string, x: number) => def(name, ["count"], (n) => k.call(ARITH.mul, n, fsec(x)));
  const secondsD = per("seconds", 1), minute = per("minutes", 60), hour = per("hours", 3600), day = per("days", 86400);
  const instIn = (i: Id, f: (x: Id) => Id) => k.match(i, [{ variant: INSTANT_V, names: ["seconds"], body: ([x]) => f(x) }]);
  const instantOf = def("instant of", ["seconds"], (x) => k.call(INSTANT_V, k.call(ARITH.mul, x, fsec(1))));
  const secondsSince = def("seconds since 1970", ["instant"], (i) => instIn(i, (x) => k.call(ARITH.mul, x, fsec(1, -1))));
  const laterBy = def("later by", ["instant", "duration"], (i, d) => instIn(i, (x) => k.call(INSTANT_V, k.call(ARITH.add, x, d))));
  const durationBetween = def("duration between", ["earlier", "later"], (a, b) => instIn(a, (x) => instIn(b, (y) => k.call(ARITH.sub, y, x))));
  const instantAt = def("instant at", ["date", "time"], (d, t) => k.call(INSTANT_V, k.call(ARITH.mul, k.call(INT_OPS.toNumber, iAdd(iMul(k.call(dayNumber, d), k.int(86400)), k.call(secondsOfDay, t))), fsec(1))));
  const wholeSeconds = (i: Id) => instIn(i, (x) => k.call(wholeOf, k.call(S.floor, k.call(ARITH.mul, x, fsec(1, -1)))));
  const dateAt = def("date at", ["instant"], (i) => k.call(dateOfDay, fdiv(wholeSeconds(i), 86400)));
  const timeAt = def("time at", ["instant"], (i) => k.call(timeOfSeconds, wholeSeconds(i)));
  const instantText = def("instant text", ["instant"], (i) => k.let("when", i, (w) => texts(k.call(dateText, k.call(dateAt, w)), k.lit("T"), k.call(timeText, k.call(timeAt, w)), k.lit("Z"))));
  // An instant at an offset from UTC (L188c1, ISO 8601's ±hh:mm): its date
  // and time where clocks are that far ahead, written with the offset.
  const iAbs = (x: Id) => k.let("n", x, (n) => k.if(iLess(n, k.int(0)), iSub(k.int(0), n), n));
  const offsetMinutes = (d: Id) => k.call(wholeOf, k.call(S.floor, k.call(ARITH.mul, d, fsec(1 / 60, -1))));
  const offsetText = def("offset text", ["offset"], (d) => k.let("minutes", offsetMinutes(d), (m) => k.if(iSame(m, k.int(0)), k.lit("Z"),
    k.let("size", iAbs(m), (a) => texts(k.if(iLess(m, k.int(0)), k.lit("-"), k.lit("+")), twoDigits(fdiv(a, 60)), k.lit(":"), twoDigits(fmod(a, 60)))))));
  const instantTextIn = def("instant text in", ["instant", "offset"], (i, d) => k.let("local", k.call(laterBy, i, d), (l) =>
    texts(k.call(dateText, k.call(dateAt, l)), k.lit("T"), k.call(timeText, k.call(timeAt, l)), k.call(offsetText, d))));
  // In a time zone by name (L188c2): its offset at that instant, by the
  // host's zone rules, so summer time is in it.
  const instantTextInZone = def("instant text in zone", ["instant", "zone"], (i, z) => k.call(instantTextIn, i, k.call(ZONE_OPS.offset, z, i)));
  // A local date and time read back in a zone (L188c3): the instant whose
  // clock there shows them. At a change of offset a local time can be
  // missing (clocks jump ahead) or shown twice (clocks go back); as
  // Temporal's "compatible", a missing one is read with the offset before
  // the jump, so it lands as far after it, and a twice-shown one gives the
  // earlier instant. The offsets a day either side are the two candidates.
  const earlierBy = (i: Id, d: Id) => instIn(i, (x) => k.call(INSTANT_V, k.call(ARITH.sub, x, d)));
  const instantInZone = def("instant in zone", ["date", "time", "zone"], (d, t, z) => k.let("local", k.call(instantAt, d, t), (l) =>
    k.let("before", k.call(ZONE_OPS.offset, z, k.call(laterBy, l, fsec(-86400))), (ob) => k.let("after", k.call(ZONE_OPS.offset, z, k.call(laterBy, l, fsec(86400))), (oa) =>
      k.let("with before", earlierBy(l, ob), (b) => k.let("with after", earlierBy(l, oa), (a) =>
        k.if(k.equal(k.call(ZONE_OPS.offset, z, b), ob), b, k.if(k.equal(k.call(ZONE_OPS.offset, z, a), oa), a, b))))))));
  const iBad = () => k.call(ABORT_OP, k.lit("instant read: an instant is written year-month-dayThour:minute:second, then Z for UTC or an offset ±hh:mm, as 2026-11-04T09:30:00Z or 2026-11-04T12:30:00+03:00"));
  const slice = (t: Id, from: number, to: Id) => k.call(TEXT_OPS.slice, t, k.int(from), to);
  const offPart = (t: Id, from: number, hi: number) => k.let("part", slice(t, from, k.int(from + 2)), (p) => k.if(iSame(k.call(TEXT_OPS.length, p), k.int(2)),
    k.let("value", k.call(digitsValue, k.call(TEXT_OPS.characters, p), k.int(0)), (v) => k.if(between(v, 0, k.int(hi)), v, iBad())), iBad()));
  const instantRead = def("instant read", ["text"], (t) => k.let("parts", k.call(TEXT_OPS.split, t, k.lit("T")), (ps) => k.if(iSame(k.call(length, ps), k.int(2)),
    k.let("clock", k.call(itemAt, ps, k.int(1), k.lit("")), (c) => k.let("day", k.call(dateRead, k.call(itemAt, ps, k.int(0), k.lit(""))), (day) => k.let("size", k.call(TEXT_OPS.length, c), (n) =>
      k.if(k.call(endsWith, c, k.lit("Z")), k.call(instantAt, day, k.call(timeRead, slice(c, 0, iSub(n, k.int(1))))),
        k.let("sign", slice(c, 8, k.int(9)), (sg) => k.if(k.call(S.and, iSame(n, k.int(14)), k.call(S.and, k.call(S.or, iSame(sg, k.lit("+")), iSame(sg, k.lit("-"))), iSame(slice(c, 11, k.int(12)), k.lit(":")))),
          k.let("ahead", k.call(INT_OPS.toNumber, iAdd(iMul(offPart(c, 9, 23), k.int(3600)), iMul(offPart(c, 12, 59), k.int(60)))), (ah) =>
            k.call(laterBy, k.call(instantAt, day, k.call(timeRead, slice(c, 0, k.int(8)))), k.call(ARITH.mul, k.if(iSame(sg, k.lit("+")), k.lit(-1), k.lit(1)), k.call(secondsD, ah)))),
          iBad())))))), iBad())));
  // The clock as an instant, and a wait for a duration (L188d): now() and
  // wait(ms) count milliseconds, as JavaScript's Date.now and setTimeout do.
  const currentInstant = def("current instant", [], () => k.call(INSTANT_V, k.call(ARITH.mul, k.call(NOW_OP), fsec(0.001))));
  const waitFor = def("wait for", ["duration"], (d) => k.call(WAIT_OP, k.call(ARITH.mul, d, fsec(1000, -1))));
  // Durations as ISO 8601 text (L188e): PT, then hours, minutes and seconds
  // as java.time's Duration writes them, with a leading - for a negative one
  // as Temporal's does; whole seconds.
  const durationText = def("duration text", ["duration"], (d) => k.let("seconds", k.call(wholeOf, k.call(S.floor, k.call(ARITH.mul, d, fsec(1, -1)))), (x) => k.let("size", iAbs(x), (a) =>
    k.let("h", fdiv(a, 3600), (h) => k.let("m", fmod(fdiv(a, 60), 60), (m) => k.let("s", fmod(a, 60), (sec) => {
      const part = (n: Id, unit: string) => k.if(iSame(n, k.int(0)), k.lit(""), texts(k.call(INT_OPS.show, n), k.lit(unit)));
      return texts(k.if(iLess(x, k.int(0)), k.lit("-"), k.lit("")), k.lit("PT"), k.if(iSame(a, k.int(0)), k.lit("0S"), texts(part(h, "H"), part(m, "M"), part(sec, "S"))));
    }))))));
  const durBad = () => k.call(ABORT_OP, k.lit("duration read: a duration is written PT then hours H, minutes M and seconds S in that order, as PT1H30M or -PT45S"));
  // The parts after PT: `number` is the digits so far (-1 for none), `last`
  // the unit read last (0 none, 1 H, 2 M, 3 S), `total` the seconds so far.
  const durationParts = k.def("duration parts");
  k.define(durationParts, k.fn(["characters", "number", "last", "total"], (cs, n, last, total) => k.match(cs, [
    { variant: NIL, names: [], body: () => k.if(k.call(S.and, iSame(n, k.int(-1)), iLess(k.int(0), last)), total, durBad()) },
    { variant: CONS, names: ["character", "rest"], body: ([c, r]) => k.if(k.call(isDigit, c),
      k.call(durationParts, r, iAdd(iMul(k.if(iLess(n, k.int(0)), k.int(0), n), k.int(10)), k.call(digitsValue, k.call(CONS, c, k.x(NIL)), k.int(0))), last, total),
      k.match(k.call(positionOf, jChars("HMS"), c), [
        { variant: NONE, names: [], body: () => durBad() },
        { variant: SOME, names: ["at"], body: ([at]) => k.let("unit", iAdd(at, k.int(1)), (u) => k.if(k.call(S.and, iLess(k.int(-1), n), iLess(last, u)),
          k.call(durationParts, r, k.int(-1), u, iAdd(total, iMul(n, k.call(itemAt, k.listOf(k.int(3600), k.int(60), k.int(1)), at, k.int(0))))), durBad())) },
      ])) },
  ])));
  const durationRead = def("duration read", ["text"], (t) => k.let("negative", k.call(startsWith, t, k.lit("-PT")), (neg) =>
    k.if(k.call(S.or, neg, k.call(startsWith, t, k.lit("PT"))),
      k.let("total", k.call(durationParts, k.call(TEXT_OPS.characters, k.call(TEXT_OPS.slice, t, k.if(neg, k.int(3), k.int(2)), k.call(TEXT_OPS.length, t))), k.int(-1), k.int(0), k.int(0)), (n) =>
        k.call(secondsD, k.call(INT_OPS.toNumber, k.if(neg, iSub(k.int(0), n), n)))),
      durBad())));
  // Embeddings (EMBEDDINGS.md, L208b): the one canonical map from a type
  // into a larger one that keeps + − · and <. Into Float64 it holds only
  // as closely as Float64 rounds, so lab test checks those with near.
  const embed = (name: string, map: Id) => { const d = k.def(name); k.define(d, k.call(EMBEDDING_V, map)); return d; };
  const embeddings = [
    embed("int in rational", k.x(whole)),
    embed("int in float64", k.x(INT_OPS.toNumber)),
    embed("rational in float64", k.x(toNum)),
    embed("float64 in complex", k.x(asC)),
    embed("float64 in dual", k.fn(["x"], (x) => k.call(DUAL_V, x, k.lit(0)))),
  ];
  const offered: Id[] = [...embeddings, extLess, extAdd, extNeg, extSub, extMul, minimum, maximum, startsWith, endsWith, containsText, afterPrefix, repeated, padStart, padEnd, spaced, optionalParens, flatten, flatMap, rangeFrom, wholeOf, dividedOr, isDigit, isLetter, lowercase, uppercase, each, map, keep, showNumbers, length, sum, append, reverse, inverse, conjugate, curry, uncurry, partially, flip, atMost, moreThan, atLeast, smaller, larger, fraction, whole, toNum, asC, unitI, conjC, modulus, angle, polar, expC, csqrt, clog, cpow, casin, cacos, tableProduct, complexTable, cliffordTable, cliffordAlgebra, cliffordProduct, cliffordReverse, cliffordInverse, cliffordSandwich, cliffordReflect, cliffordProject, cliffordExp, cliffordOuter, cliffordInner, cliffordGrade, cliffordDual, cliffordUndual, cliffordRegressive, cliffordPart, cliffordWithPart, matrixTable, itemAt, replaceAt, take, drop, zipped, numbered, copies, allPass, anyPass, firstWhere, positionOf, contains, largestOf, smallestOf, insertedAt, caseOf, positionWhere, itemWhere, randomItem, change, showDecimals, slopeAt, dualTable, asFixed, fixedF, sqrtX, sort, sortBy, sortWith, collated, attempt, valueOrAbort, emptyMap, asMap, put, updateAt, lookup, remove, hasKey, mergeMaps, keys, values, entries, mapSize, emptySet, asSet, addItem, removeItem, has, union, intersection, difference, items, setSize, smallestItem, largestItem, smallestKey, largestKey, emptyQueue, queueOf, queued, frontOf, dequeued, queueSize, queueItems, emptyPriorityQueue, priorityQueueOf, prioritized, soonest, withoutSoonest, priorityQueueSize, priorityQueueItems, matrixOfRows, rowsOf, rowCount, columnCount, matrixEntry, transposed, identityMatrix, matrixScaled, matrixSum, matrixProduct, matrixTimesVector, solved, determinant, inverted, leastSquares, tensorOf, tensorShape, tensorItems, rank, tensorSize, tensorEntry, tensorMap, tensorZipWith, reshaped, contracted, transposedBy, traced, bytesOf, byteItems, byteCount, utf8Of, textOfUtf8, base64Of, bytesOfBase64, hexOf, bytesOfHex, jsonPrinted, jsonIndented, jsonRead, jsonField, jsonAsNumber, jsonAsText, jsonAsBool, jsonAsList, csvPrinted, csvRows, csvRecords, csvOfRecords, dateOf, dateYear, dateMonth, dateDay, leapYear, daysInMonth, dayNumber, dateOfDay, weekday, addedDays, daysBetween, dateText, dateRead, timeOf, timeHour, timeMinute, timeSecond, secondsOfDay, timeOfSeconds, timeText, timeRead, secondsD, minute, hour, day, instantOf, secondsSince, laterBy, durationBetween, instantAt, dateAt, timeAt, instantText, instantRead, offsetText, instantTextIn, instantTextInZone, instantInZone, durationText, durationRead, currentInstant, waitFor, withState, changeState, piped, ticketId, ...wordMakers, anyOf, together, race, within, simulated, near];
  // Each number's own show, from before the generic one showed every number
  // (L153, L156): kept so programs saved before still open, not offered.
  const perTypeShows = [showF, showC, showD, showX];
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
    [notAfter]: "Text a ≤ b: a comes before b or is b. Not offered: at most, more than and at least take Text; kept so programs saved before still open.",
    [after]: "Text a > b: b comes before a. Not offered: at most, more than and at least take Text; kept so programs saved before still open.",
    [notBefore]: "Text a ≥ b: b comes before a or is a. Not offered: at most, more than and at least take Text; kept so programs saved before still open.",
    [isDigit]: "Whether this is one of the characters 0 to 9.",
    [isLetter]: "Whether this is one of the English letters a to z or A to Z (other alphabets' letters aren't, yet).",
    [lowercase]: "The text with A to Z made a to z, everything else as it was (for identifiers, hex and protocols; people's text goes through lowercase(text, locale)): ascii lowercase(\"Hello, World\") is \"hello, world\".",
    [uppercase]: "The text with a to z made A to Z, everything else as it was (for identifiers, hex and protocols; people's text goes through uppercase(text, locale)): ascii uppercase(\"Hello\") is \"HELLO\".",
    [lowerOne]: "A helper of lowercase. Not offered in the palette.",
    [upperOne]: "A helper of uppercase. Not offered in the palette.",
    [startsWith]: "Whether the text begins with this: starts with(\"# notes\", \"#\") is true. Every text starts with \"\".",
    [endsWith]: "Whether the text ends with this: ends with(\"page.md\", \".md\") is true. Every text ends with \"\".",
    [containsText]: "Whether the part occurs somewhere in the text: contains text(\"to do list\", \"do\") is true. Every text contains \"\". (contains is a list's.)",
    [afterPrefix]: "The text without the prefix it starts with: after prefix(\"r7\", \"r\") is \"7\". No answer when it doesn't start with it (Choice), so first(after prefix(w, \"#\"), else w) reads a tag or keeps the word.",
    [spaced]: "The text with a space either side: spaced(\"+\") is \" + \". Run backwards (inverse) it reads the text with any spaces around it, or none.",
    [optionalParens]: "The text in parentheses when needed, else as it is. Run backwards it reads the text bare (when not needed) or in parentheses, any number of matched pairs, so a printer that leaves out the ones it needn't print still reads them.",
    [repeated]: "The text written this many times over: repeated(\"ab\", 3) is \"ababab\". 0 times, or fewer, is \"\".",
    [padStart]: "The text with fill put in front until it is this wide: padded start(\"7\", 3, \"0\") is \"007\". A text already as wide is as it was; a fill of several characters is cut where the width ends.",
    [padEnd]: "The text with fill put after it until it is this wide: padded end(\"ab\", 4, \".\") is \"ab..\". For columns of text.",
    [flatten]: "The lists one after another, as one list: flatten([[1, 2], [], [3]]) is [1, 2, 3].",
    [flatMap]: "The lists f gives for each item, one after another: flat map([1, 2], (x) => [x, x]) is [1, 1, 2, 2]. map, then flatten.",
    [rangeFrom]: "The Ints from start up to end, end left out: range from(2, 5) is [2, 3, 4]. Empty when end is not after start.",
    [extLess]: "a < b for Extended numbers: −∞ is below every number and +∞ above, so the order is total. compare and sort give the same order.",
    [extAdd]: "a + b with ±∞: ∞ + 1 is ∞ and −∞ + −∞ is −∞. ∞ + −∞ has no answer.",
    [extNeg]: "−a with ±∞: −(+∞) is −∞.",
    [extSub]: "a − b with ±∞: ∞ − 1 is ∞. ∞ − ∞ has no answer.",
    [extMul]: "a · b with ±∞: −2 · ∞ is −∞ and −∞ · −∞ is ∞. 0 · ∞ has no answer.",
    [minimum]: "The smallest of the numbers, as an Extended: +∞ when there are none, so it is minimum's identity and a fold over an empty list still has an answer.",
    [maximum]: "The largest of the numbers, as an Extended: −∞ when there are none.",
    [fraction]: "top/bottom, exactly, in lowest terms (Euclid's algorithm, textbook); no answer when bottom is 0.",
    [whole]: "The whole number n as a fraction, n/1.",
    [positionWhere]: "The position of the first item that passes the test, counting from 0, as some(position): position where([3, 8, 5], (x) ↦ 4 < x) is some(1); none when no item passes.",
    [change]: "The cell given f of what it holds: change(count, (n) ↦ n + 1) is write(count, read(count) + 1). Only event handlers can write.",
    [randomItem]: "An item of the list drawn at random, each as likely: random item([\"a\", \"b\", \"c\"]). No answer for an empty list (Choice). seeded gives the same draws every time.",
    [itemWhere]: "A path to the first item of the list at a place in a cell that passes the test, so one item can be written by its key: write at(board, then path(item where(board, path((b) ↦ b.cards), (c) ↦ c.id = id), path((c) ↦ c.time)), t) changes one card and wakes only its readers. The list is read now. When no item passes, the path is to no item: read at has no answer there and a write changes nothing.",
    [positionFrom]: "A helper of position where: the walk, counting from `from`. Not offered.",
    [zipped]: "The two lists' items side by side, as tuples, as long as the shorter: zipped([1, 2, 3], [\"a\", \"b\"]) is [(1, \"a\"), (2, \"b\")].",
    [numbered]: "Each item with its position, counting from 0: numbered([\"a\", \"b\"]) is [(0, \"a\"), (1, \"b\")].",
    [firstWhere]: "The first item that passes the test, or none: first where([3, 8, 9], (x) ↦ x > 5) is some(8).",
    [positionOf]: "Where the item first is in the list, from 0, or none: position of([\"a\", \"b\"], \"b\") is some(1).",
    [wholeOf]: "The whole number at or below x, as an Int: whole of(2.7) is 2, whole of(-0.5) is -1. Always an answer, since a Float64 is finite (whole part is the same as a Choice).",
    [dividedOr]: "a / b, or otherwise when b is 0: divided or(waited, patients, 0) is the mean, or 0 with no patients.",
    [contains]: "Whether the item is in the list: contains([1, 2], 2) is true. (has is a Set's.)",
    [largestOf]: "The largest item by <, or none for an empty list: largest of([3, 9, 4]) is some(9).",
    [smallestOf]: "The smallest item by <, or none for an empty list: smallest of([3, 9, 4]) is some(3).",
    [caseOf]: "The first case whose key equals key, run, or otherwise when none does: case of(name, [(\"add\", () ↦ 1), (\"jump\", () ↦ 2)], () ↦ 0). Any plain data is a key.",
    [insertedAt]: "The list with the item put in at the position, the items from there on moved one later: inserted at([1, 3], 1, 2) is [1, 2, 3].",
    [numberedFrom]: "A helper of numbered: the positions counted from `from`. Not offered.",
    [copies]: "A list of count copies of the item: copies(3, 0) is [0, 0, 0]. (repeated is Text's.)",
    [allPass]: "Whether every item passes the test; true for an empty list. Stops at the first that doesn't.",
    [anyPass]: "Whether some item passes the test; false for an empty list. Stops at the first that does.",
    [divF]: "a ÷ b for fractions, exactly; no answer when b is 0. Not offered: the one divide works on every number but Int; kept so programs saved before still open.",
    [showF]: "A fraction as 3/4, or 3 when it is whole. Not offered: the one show shows every number; kept so programs saved before still open.",
    [toNum]: "The nearest Float64.",
    [addF]: "What + is at Rational. Not offered on its own: + is.",
    [subF]: "What − is at Rational. Not offered on its own: − is.",
    [mulF]: "What · is at Rational. Not offered on its own: · is.",
    [negF]: "What −x is at Rational. Not offered on its own: − is.",
    [lessF]: "What < is at Rational. Not offered on its own: < is.",
    [sort]: "The list in order: numbers by value, text alphabetically (by code point), cases in the order their type lists them, then field by field (compare). A merge sort (von Neumann, 1945), bottom-up so it surely finishes: n log n steps.",
    [take]: "The first count items: take([a, b, c], 2) is [a, b]; a list with fewer gives them all. count steps.",
    [drop]: "The items after the first count: drop([a, b, c], 2) is [c]; a list with fewer gives []. count steps.",
    [itemAt]: "The item at a position, counting from 0, or `otherwise` when the list has none there: item at([a, b, c], 1, z) is b, item at([a], 5, z) is z. n steps.",
    [replaceAt]: "The list with the item at a position, counting from 0, replaced by `by`; the list as it was when it has no item there. n steps.",
    [showDecimals]: "x as text with `places` digits after the point, rounded half away from 0 and keeping trailing zeros: show decimals(2.5, 3) is \"2.500\", show decimals(-0.0004, 3) is \"0.000\". For when show's up to nine places would jump about.",
    [sortWith]: "The list in the order order(a, b) gives, an Order: sort with(names, collated(locale(\"tr\"))) sorts names as Turkish does. Items the order calls the same keep their order (stable). n log n steps.",
    [mergeWith]: "Two lists sorted by an order as one. A helper of sort with, not offered.",
    [addRunWith]: "A helper of sort with, not offered.",
    [collated]: "People's order for text in a language (the Unicode Collation Algorithm with that language's rules): Turkish puts ç after c and ğ after g, German ä with a. Give it to sort with. It never changes compare or <, which stay code-point order.",
    [sortBy]: "The list in the order of key(item), by compare: sort by(roads, length of) puts the shortest first, sort by(rows, (r) → −amount of(r)) the largest. Items with the same key keep their order (a stable sort; Python's key=, Haskell's sortOn). n log n steps, each calling key.",
    [mergeByKey]: "Two lists sorted by key as one. A helper of sort by, not offered.",
    [addRunByKey]: "A helper of sort by, as add run is of sort. Not offered.",
    [attempt]: "The action's answer as done(answer), or refused(reason) when it aborts: an Abort kept as data, so it can go in a list (Rust's Result is the influence).",
    [valueOrAbort]: "The value in done(value); refused(reason) aborts with the reason again. attempt run backwards.",
    [emptyMap]: "The map with no entries.",
    [asMap]: "The map of a list of (key, value) tuples; when a key comes twice, the later one wins. Keys are kept in compare's order, so a map has one spelling and folds go in key order (Haskell's Data.Map, Rust's BTreeMap).",
    [put]: "The map with key holding value, in place of what it held.",
    [updateAt]: "The map with key holding change(what it held), or change(default) when it held nothing: one walk, where put(m, k, change(first(value at(m, k), default))) looks the key up twice. Counting is update at(counts, word, 0, partially(add, 1)). Haskell's Data.Map alter and Rust's entry API are the same job.",
    [lookup]: "What key holds; no answer when the map hasn't got it, so first(value at(m, k), else d) gives a default.",
    [remove]: "The map without key.",
    [hasKey]: "Whether the map holds key.",
    [mergeMaps]: "The entries of both maps; where both hold a key, the second's value wins.",
    [keys]: "The keys, in order.",
    [values]: "The values, in the order of their keys.",
    [entries]: "The entries as (key, value) tuples, in key order.",
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
    [emptyQueue]: "A queue with nothing in it. queued adds at the back, front of and dequeued take from the front: first in, first out.",
    [queueOf]: "A queue of the items, the first item at the front.",
    [queued]: "The queue with the item added at the back. Doesn't walk the queue.",
    [frontOf]: "The item at the front of the queue, the one queued longest ago; no answer when it's empty.",
    [dequeued]: "The queue without its front item; no answer when it's empty. Taking every item in turn walks each once.",
    [queueSize]: "How many items the queue holds. Kept, not counted.",
    [queueItems]: "The queue's items, front first.",
    [emptyPriorityQueue]: "A priority queue with nothing in it: prioritized adds an item with a priority, and soonest is the one with the lowest priority (in compare's order), of those the one added first.",
    [priorityQueueOf]: "A priority queue of (priority, item) pairs, added in the list's order: priority queue of([(2.5, \"b\"), (1.0, \"a\")]).",
    [prioritized]: "The queue with the item added at that priority. Two items may share a priority; they leave in the order they were added. A simulation's events: prioritized(events, now + delay, arrival(p)).",
    [soonest]: "The (priority, item) with the lowest priority, the earliest added of those; no answer when the queue is empty.",
    [withoutSoonest]: "The queue without its soonest item; no answer when it's empty. first(soonest(q), else …) and without soonest(q) are one simulation step.",
    [priorityQueueSize]: "How many items the priority queue holds.",
    [matrixOfRows]: "The matrix with these rows: matrix of rows([[1, 2, 3], [4, 5, 6]]) is 2 × 3. Rows of different lengths stop the program.",
    [rowsOf]: "The matrix's rows, each a list, top to bottom.",
    [rowCount]: "How many rows the matrix has.",
    [columnCount]: "How many columns the matrix has.",
    [matrixEntry]: "The item at a row and a column, counting from 0; no answer outside the matrix.",
    [transposed]: "The matrix flipped across its diagonal: row i is column i.",
    [identityMatrix]: "The size × size matrix with 1 on its diagonal and 0 elsewhere, for any number type.",
    [matrixScaled]: "Every item times the number.",
    [matrixSum]: "The two matrices added item by item. Different sizes stop the program, with both sizes.",
    [matrixProduct]: "The first matrix times the second: row by column, for any number type. The first's columns must be the second's rows, or the program stops with both sizes.",
    [matrixTimesVector]: "The matrix times the list as a column: one item per row. The list must have one item per column, or the program stops with both sizes.",
    [solved]: "The list x with matrix times vector(m, x) = b, for a square Float64 matrix, by Gaussian elimination with partial pivoting. No answer when the matrix is singular (a pivot is 0).",
    [determinant]: "The determinant of a square Float64 matrix: 0 when it is singular. Other sizes stop the program.",
    [jsonRead]: "The Json value a JSON text spells (RFC 8259), the other way from json printed: json read(\"[1, true]\") is json list([json number(1), json bool(true)]). Stops on text that isn't JSON, saying where.",
    [dateOf]: "The calendar date of a year, a month (1 to 12) and a day of that month: date of(2026, 11, 3). Stops on a month or day the calendar hasn't, such as 30 February.",
    [dateYear]: "The date's year.",
    [dateMonth]: "The date's month, 1 to 12.",
    [dateDay]: "The date's day of its month.",
    [leapYear]: "Whether the year has 29 February: every fourth year, but not a century unless it is a fourth century (2000 is, 1900 isn't).",
    [daysInMonth]: "How many days a month of a year has: days in month(2024, 2) is 29.",
    [dayNumber]: "The date counted in days from 1970-01-01, which is 0; a date before it is negative. Howard Hinnant's days_from_civil.",
    [dateOfDay]: "The date a day number names, the other way from day number: date of day number(0) is 1970-01-01. Howard Hinnant's civil_from_days.",
    [weekday]: "The date's day of the week, 1 for Monday to 7 for Sunday (ISO 8601): weekday(date of(1970, 1, 1)) is 4, a Thursday.",
    [addedDays]: "The date this many days later, or earlier for a negative count: added days(date of(2024, 2, 28), 1) is 2024-02-29.",
    [daysBetween]: "How many days from the first date to the second, negative when the second is earlier.",
    [dateRead]: "The date an ISO 8601 text writes, year-month-day: date read(\"2026-11-03\") is date of(2026, 11, 3), the other way from date text. Stops on any other text, or a day the calendar hasn't.",
    [timeOf]: "The time of day of an hour (0 to 23), a minute and a second (0 to 59): time of(9, 5, 0). Stops on any other.",
    [timeHour]: "The time's hour, 0 to 23.",
    [timeMinute]: "The time's minute, 0 to 59.",
    [timeSecond]: "The time's second, 0 to 59.",
    [secondsOfDay]: "The time as seconds from midnight, 0 to 86399.",
    [timeOfSeconds]: "The time of day so many seconds from midnight, wrapping round: time of seconds(90000) is 01:00:00, and a negative count goes back from midnight.",
    [timeText]: "The time as ISO 8601 writes it, hour:minute:second: time text(time of(9, 5, 0)) is \"09:05:00\".",
    [secondsD]: "So many seconds, as a duration: a duration is a Float64 in seconds (s), so seconds(90) is minutes(1.5) and units check it isn't added to a length.",
    [minute]: "So many minutes as a duration, 60 s each: minutes(5) is 300 s.",
    [hour]: "So many hours as a duration, 3600 s each: hours(2) is 7200 s.",
    [day]: "So many days as a duration, 86400 s each. A calendar day can be longer or shorter where clocks change; this is the day of UTC.",
    [instantOf]: "The instant so many seconds after 1970-01-01 00:00:00 UTC (POSIX time, leap seconds not counted): instant of(0) is 1970-01-01T00:00:00Z.",
    [secondsSince]: "The instant as seconds since 1970-01-01 00:00:00 UTC, the other way from instant of.",
    [laterBy]: "The instant a duration after this one, earlier for a negative duration: later by(start, hours(2)).",
    [durationBetween]: "The duration from the first instant to the second, negative when the second is earlier.",
    [instantAt]: "The instant a date and a time of day name in UTC: instant at(date of(1970, 1, 2), time of(0, 0, 0)) is a day after instant of(0).",
    [dateAt]: "The date in UTC at an instant.",
    [timeAt]: "The time of day in UTC at an instant, in whole seconds (a fraction of a second is dropped).",
    [instantText]: "The instant as ISO 8601 writes it in UTC, whole seconds: instant text(instant of(0)) is \"1970-01-01T00:00:00Z\".",
    [instantRead]: "The instant an ISO 8601 text writes, year-month-dayThour:minute:second then Z for UTC or an offset ±hh:mm: instant read(\"2026-11-04T12:30:00+03:00\") is the same instant as instant read(\"2026-11-04T09:30:00Z\"). The other way from instant text and instant text in. Stops on any other text.",
    [offsetText]: "An offset from UTC as ISO 8601 writes it, in whole minutes: offset text(hours(3)) is \"+03:00\", offset text(seconds(0)) is \"Z\".",
    [instantInZone]: "The instant at a date and time on the clocks of a time zone by its IANA name: instant in zone(date of(2026, 7, 1), time of(10, 30, 0), \"Europe/London\") is the instant 09:30 UTC. Where clocks jump ahead, a time they skip lands as far after the jump (01:30 on the day London goes to summer time is 02:30 summer time); where they go back, a time shown twice is the earlier one. No answer for a zone the computer doesn't know.",
    [instantTextInZone]: "The instant as ISO 8601 writes it in a time zone by its IANA name, with that zone's offset at that instant (summer time included): instant text in zone(instant read(\"2026-07-01T09:30:00Z\"), \"Europe/London\") is \"2026-07-01T10:30:00+01:00\". No answer for a zone the computer doesn't know. instant text in zone(i, my time zone()) is the user's own.",
    [instantTextIn]: "The instant as ISO 8601 writes it where clocks are this far ahead of UTC: instant text in(instant read(\"2026-11-04T09:30:00Z\"), hours(3)) is \"2026-11-04T12:30:00+03:00\". A fixed offset, not a time zone's rules.",
    [durationText]: "The duration as ISO 8601 writes it, in hours, minutes and whole seconds: duration text(minutes(90)) is \"PT1H30M\", a negative one \"-PT45S\", none \"PT0S\" (java.time's Duration, Temporal's sign).",
    [durationRead]: "The duration an ISO 8601 text writes, PT then hours H, minutes M and seconds S in that order, any of them left out: duration read(\"PT1H30M\") is minutes(90). The other way from duration text. Stops on any other text.",
    [currentInstant]: "The instant now, from the program's clock (Time): instant text(current instant()) is the time in UTC. In a test, simulated runs it on a clock that starts at instant of(0).",
    [waitFor]: "Waits for a duration (Wait): wait for(seconds(2)). The same as wait with the duration in milliseconds.",
    [timeRead]: "The time an ISO 8601 text writes, hour:minute:second in two digits each, the other way from time text. Stops on any other text.",
    [dateText]: "The date as ISO 8601 writes it, year-month-day: date text(date of(2026, 11, 3)) is \"2026-11-03\".",
    [embeddings[0]]: "Int in Rational: n as the fraction n/1, the one map that keeps + − · and <.",
    [embeddings[1]]: "Int in Float64: n as the Float64 nearest it, exact up to 2⁵³; + − · agree as closely as Float64 rounds.",
    [embeddings[2]]: "Rational in Float64: top ÷ bottom, the Float64 nearest the fraction; + − · agree as closely as Float64 rounds.",
    [embeddings[3]]: "Float64 in Complex: x as x + 0i.",
    [embeddings[4]]: "Float64 in Dual: x as the dual number x + 0ε, a constant, whose slope is 0.",
    [jsonIndented]: "The Json value as text over lines, each item and field on a line of its own and indented step spaces a level: the same text as JavaScript's JSON.stringify(value, null, step). A step below 1 prints it on one line, as json printed.",
    [jsonField]: "The value of an object's field with this name, the first if there are several. No answer for a missing field or a value that isn't an object.",
    [jsonAsNumber]: "The Float64 a json number holds; no answer for any other kind.",
    [jsonAsText]: "The Text a json text holds; no answer for any other kind.",
    [jsonAsBool]: "The Bool a json bool holds; no answer for any other kind.",
    [jsonAsList]: "The items a json list holds; no answer for any other kind.",
    [csvPrinted]: "Rows of fields as CSV text (RFC 4180), a line each: a field with a comma, a quote or a line break is quoted, its quotes doubled.",
    [csvRecords]: "The records of a CSV text whose first line names its columns, each a map from those names to the row's fields: csv records(\"name,age\\nAda,36\") is one map, name to Ada and age to 36 (Python's csv.DictReader). A short row leaves the last names out.",
    [csvOfRecords]: "A CSV text of records, the other way from csv records: the column names as its first line, then each record's value at each name, empty where it has none (Python's csv.DictWriter).",
    [csvRows]: "The rows of fields a CSV text holds (RFC 4180), the other way from csv printed: quoted fields may hold commas, doubled quotes and line breaks; lines end in LF or CRLF. Stops when the text ends inside a quoted field.",
    [jsonPrinted]: "The JSON text of a Json value (RFC 8259): json printed(json object([(\"a\", json list([json number(1), json null]))])) is {\"a\":[1,null]}. Text is quoted with \", \\ and control characters escaped.",
    [base64Of]: "The bytes as Base64 text (RFC 4648): every three bytes as four characters from A to Z, a to z, 0 to 9, + and /, with = filling the last group: base64 of(utf8 of(\"hi\")) is \"aGk=\".",
    [bytesOfBase64]: "The bytes a Base64 text holds, the other way from base64 of. Stops on a character Base64 hasn't.",
    [hexOf]: "The bytes as hex text, two digits a byte: hex of(bytes of([0, 255])) is \"00ff\".",
    [bytesOfHex]: "The bytes a hex text holds, two digits a byte in either case. Stops on anything else.",
    [bytesOf]: "The bytes with these items, each a whole number from 0 to 255: bytes of([104, 105]) is the bytes of \"hi\". Stops when an item isn't a byte.",
    [byteItems]: "The bytes as their list of Ints, each 0 to 255.",
    [byteCount]: "How many bytes there are.",
    [utf8Of]: "The text's UTF-8 bytes (RFC 3629): each character's code point in one to four bytes. utf8 of(\"é\") is [195, 169].",
    [textOfUtf8]: "The text UTF-8 bytes spell, the other way from utf8 of. Stops on bytes that aren't UTF-8: a following byte where a character starts, or the bytes ending inside a character.",
    [tensorOf]: "The tensor with this shape and these items, the last axis changing fastest: tensor of([2, 3], [1, 2, 3, 4, 5, 6]) has rows [1, 2, 3] and [4, 5, 6]. Stops when the items don't fill the shape.",
    [tensorShape]: "A tensor's axis lengths: [2, 3] for a 2 × 3 one, [] for a single number.",
    [tensorItems]: "A tensor's items, the last axis changing fastest.",
    [rank]: "How many axes a tensor has: 2 for a matrix, 1 for a vector, 0 for a single number.",
    [tensorSize]: "How many items a tensor has: its axis lengths multiplied.",
    [tensorEntry]: "The item at an index, one position per axis from 0: tensor entry(t, [1, 2]) is row 1, column 2. No answer outside the shape.",
    [tensorMap]: "Each item through f, the shape kept.",
    [tensorZipWith]: "f of the two tensors' items at each index. Stops when their shapes differ, and says both.",
    [reshaped]: "The same items read with another shape of the same size: a 2 × 3 tensor reshaped to [3, 2] or [6]. Stops when the sizes differ.",
    [contracted]: "The product of two tensors summed over each pair of axes in pairs, (axis of the first, axis of the second), of the same length; the axes left, the first's then the second's, are the result's (Einstein summation, numpy.einsum). Matrix product is contracted(a, b, [(1, 0)]), a dot product contracted(u, v, [(0, 0)]), the outer product contracted(a, b, []).",
    [transposedBy]: "The tensor with its axes reordered: axis order[k] becomes axis k. transposed by(m, [1, 0]) is a matrix's transpose.",
    [traced]: "The sum over the diagonal of two axes of the same length: traced(m, 0, 1) is a square matrix's trace.",
    [leastSquares]: "The x making matrix times vector(m, x) nearest the vector, by least squares, for a Float64 matrix with at least as many rows as columns: a line through points. No answer when the columns aren't independent.",
    [withState]: "Runs the action with get state and put state answered, starting from initial, and gives (its value, the last state): with state(0, () ↦ put state(get state() + 1)) is ((), 1).",
    [changeState]: "Puts f(the state) as the state: change state((n) ↦ n + 1).",
    [piped]: "Runs the consumer with each receive() answered by the producer's next send(item): some(item), or none once the producer has finished. The producer runs only as far as the consumer asks.",
    [pipeOf]: "A helper of piped: the producer run to its first send. Not offered.",
    [inverted]: "The inverse of a square Float64 matrix: matrix product(m, inverted(m)) is the identity. No answer when the matrix is singular.",
    ...Object.fromEntries(matrixHelpers.map((d) => [d, "A helper of the matrix operations. Not offered."])),
    [priorityQueueItems]: "The queue's (priority, item) pairs, soonest first.",
    [smallestKey]: "The map's smallest key, in compare's order; no answer when the map is empty. value at(m, smallest key(m)) is what it holds.",
    [largestKey]: "The map's largest key, in compare's order; no answer when the map is empty.",
    ...Object.fromEntries(mapHelpers.map((d) => [d, "A helper of the map and set operations: a walk down the sorted list. Not offered."])),
    [mergeSorted]: "Two sorted lists as one. A helper of sort, not offered.",
    [addRun]: "A helper of sort: a sorted run added to the slots of runs, like adding 1 to a binary number. Not offered.",
    [asC]: "The Float64 x as a complex number, x + 0i.",
    [unitI]: "i, the square root of −1: i · i is −1.",
    [conjC]: "a − bi for a + bi: the same point mirrored across the real line. z · conjugate(z) is |z|².",
    [modulus]: "|z|, how far z is from 0 (the vectors module's magnitude says the same).",
    [near]: "Whether two Float64s agree to the precision floats carry: within 1e-9 of each other, relative to their size. equal is exact, so √2 · √2 isn't equal to 2, but it is near it.",
    [angle]: "The angle from the positive real line to z, in radians, between −π and π (atan2).",
    [polar]: "The complex number size away from 0 at this angle: size·(cos angle + i sin angle).",
    [divC]: "z ÷ w for complex numbers; no answer when w is 0. Not offered: the one divide works on every number but Int; kept so programs saved before still open.",
    [expC]: "e to the z: eᵃ(cos b + i sin b) for a + bi, Euler's formula (textbook). complex exp(i · π) is −1.",
    [csqrt]: "√z for a complex number, the root with a real part of 0 or more: complex sqrt(−4) is 2i. Float64's sqrt has no answer below 0; this one always has.",
    [clog]: "log z for a complex number: log|z| + i·(its angle, between −π and π). complex log(−1) is iπ. No answer at 0.",
    [cpow]: "z to the power w, e^(w · log z), the principal value: complex power(−8, 1/3) is 1 + 1.732i. 0 to a power with a real part above 0 is 0; to any other, no answer.",
    [casin]: "asin z for a complex number, the principal value: complex asin(2) is π/2 + 1.317i. Float64's asin has no answer outside −1 to 1; this one always has.",
    [cacos]: "acos z for a complex number, the principal value: complex acos(2) is −1.317i. Float64's acos has no answer outside −1 to 1; this one always has.",
    [showC]: "A complex number as 3 + 4i or 3 − 4i. Not offered: the one show shows every number; kept so programs saved before still open.",
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
    [divD]: "x ÷ y for dual numbers, the quotient rule; no answer when y's value is 0. Not offered: the one divide works on every number but Int; kept so programs saved before still open.",
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
    [showD]: "A dual number as 3 + 2ε. Not offered: the one show shows every number; kept so programs saved before still open.",
    [asFixed]: "A whole number as a Fixed, exactly.",
    [fixedF]: "A Fixed as the nearest Float64, for drawing or printing. Past 2⁵³ steps (about 2 million) it drops the last bits; the Fixed keeps them.",
    [showX]: "A Fixed as text: the shortest decimal that reads back to the same steps, so 0.1 shows as 0.1 and every step shows differently. Not offered: the one show shows every number; kept so programs saved before still open.",
    [divX]: "a ÷ b for Fixed, rounded down to a step; no answer when b is 0. Not offered: the one divide works on every number but Int; kept so programs saved before still open.",
    [sqrtX]: "√x for Fixed, rounded down to a step, the same bits on every machine; no answer below 0.",
    ...Object.fromEntries(divisions.map((d) => [d, "How this number type divides (Division): its own divide. Found by its type, so not offered: divide is."])),
    ...Object.fromEntries(showns.map((d) => [d, "How this number type shows (Shown): `show any` uses it. Found by its type, so not offered."])),
    ...Object.fromEntries(bitses.map((d) => [d, "This type's and, or, xor and shifts (Bits). Found by its type, so not offered: bits and, bits or, bits xor, shifted up and shifted down are."])),
    ...Object.fromEntries(wordHelpers.map((d) => [d, "One of a word's own operations, kept to its n bits. Found by its type through Arithmetic, Ordered, Bits or Shown, so not offered."])),
    [intShiftUp]: "x shifted up n places: x · 2ⁿ. Int's shifted up in Bits.",
    ...Object.fromEntries(wordMakers.map((d, i) => [d, `The ${WORD_SIZES[i]}-bit word of an Int: its low ${WORD_SIZES[i]} bits, so as word8(300) is 44 and as word8(−1) is 255. + − · wrap around, < is unsigned, and bits and, or, xor and shifts work on it. Its bits are the Int in its field bits.`])),
    ...Object.fromEntries(arithmetics.map((d) => [d, "How this number type does + − · −x (Arithmetic) or < (Ordered): its own operations. Found by its type, so not offered: + and < are."])),
    [ticketId]: "The same ticket with what it gives forgotten (a Ticket Unit), so tickets of different types can go in one list for any of.",
    [anyOf]: "A ticket for whichever of these tickets is ready first: await(any of(tickets)) gives its position, from 0.",
    [together]: "Runs the actions side by side: each runs until it awaits a ticket, and whichever ticket is ready first goes on, until every action has its value. The values come back in the actions' order (as JavaScript's Promise.all).",
    [race]: "Runs the actions side by side, as together does, and gives the value of the first to finish; the others are dropped where they wait (as JavaScript's Promise.race).",
    [within]: "The action's value as some(value) if it finishes within this many milliseconds, or none if the timer is ready first; the action is then dropped where it waits.",
    [simulated]: "Runs the action in a simulated world for tests: its timers, now and wait on a clock that starts at 0 and never really waits, and when several tickets are ready at the same moment, which goes on is picked with a second stream of numbers from the same seed, apart from the action's own Random (seeded by seed), so the same seed gives the same schedule every run, even after the action draws more or fewer numbers; another seed may give another, so an order that goes wrong is a seed to paste into a test (FoundationDB's deterministic simulation).",
    ...Object.fromEntries(awaitHelpers.map((d) => [d, simulatedHelpers.includes(d) ? "A helper of simulated. Not offered in the palette." : "A helper of together and race. Not offered in the palette."])),
    [applied]: "A helper of inverse: f(x), as a definition solve can name. Not offered in the palette.",
  };
  const p = publish(merge(prelude, std, k.code), k.names, [...offered, onto, applied, ...awaitHelpers, ...arithmetics, trigF, addD, subD, mulD, negD, sinD, cosD, tanD, expD, logD, trigD, sinX, cosX, tanX, expX, logX, trigX, cosBySin, sinByCos, polarBy, sinByPolar, cosByPolar, polarF, unpolarF, unpolarD, unpolarX, vector, asinBy, acosBy, asinF, acosF, asinX, acosX, addF, subF, mulF, negF, lessF, addC, subC, mulC, negC, ...numberOnly, ...perTypeShows, ...textOnly, numberedFrom, positionFrom, ...divisions, ...showns, ...bitses, intShiftUp, ...wordHelpers, divF, divC, divD, divX, mergeSorted, addRun, mergeByKey, addRunByKey, ...mapHelpers, ...matrixHelpers, pipeOf, ...laws], merge(prelude, std));
  if (!p.ok) throw new Error(`the prelude can't be published: ${p.reason}`);
  const at = (d: Id) => p.rename.get(d)!;
  const notes = Object.fromEntries(Object.entries(comments).map(([d, c]) => [at(d), c]));
  return makeModule("prelude", p.code, p.names, offered.map(at), p.pins, notes, [...awaitHelpers, addF, subF, mulF, negF, lessF, addC, subC, mulC, negC, ...numberOnly, ...perTypeShows, ...textOnly, numberedFrom, positionFrom, ...divisions, ...showns, ...bitses, intShiftUp, ...wordHelpers, divF, divC, divD, divX, mergeSorted, addRun, mergeByKey, addRunByKey, ...mapHelpers, ...matrixHelpers, pipeOf, ...arithmetics, trigF, addD, subD, mulD, negD, sinD, cosD, tanD, expD, logD, trigD, sinX, cosX, tanX, expX, logX, trigX, cosBySin, sinByCos, polarBy, sinByPolar, cosByPolar, polarF, unpolarF, unpolarD, unpolarX, vector, asinBy, acosBy, asinF, acosF, asinX, acosX, ...laws].map(at));
}
