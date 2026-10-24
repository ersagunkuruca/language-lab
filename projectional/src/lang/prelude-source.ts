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
import { CONS, INT_OPS, NIL, PAIR_V, RATIO, S, TEXT_OPS, std } from "./std.ts";

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

  // The other comparisons, over `<` (and Text's over `comes before`), so
  // they run backwards and differentiate with no rules of their own; and
  // the smaller and larger of two numbers, which shaders compile to min
  // and max.
  const compare = (name: string, less: Id, f: (less: (a: Id, b: Id) => Id, a: Id, b: Id) => Id) => {
    const d = k.def(name);
    k.define(d, k.fn(["a", "b"], (a, b) => f((x, y) => k.call(less, x, y), a, b)));
    return d;
  };
  const atMost = compare("at most", S.less, (lt, a, b) => k.call(S.not, lt(b, a)));
  const moreThan = compare("more than", S.less, (lt, a, b) => lt(b, a));
  const atLeast = compare("at least", S.less, (lt, a, b) => k.call(S.not, lt(a, b)));
  const smaller = compare("smaller", S.less, (lt, a, b) => k.if(lt(a, b), a, b));
  const larger = compare("larger", S.less, (lt, a, b) => k.if(lt(a, b), b, a));
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
  const toNum = k.def("fraction as number");
  k.define(toNum, k.fn(["a"], (a) => ratio(a, (p, q) => k.call(B.div, k.call(INT_OPS.toNumber, p), k.call(INT_OPS.toNumber, q)))));

  const offered: Id[] = [each, map, keep, showNumbers, length, sum, append, reverse, inverse, conjugate, atMost, moreThan, atLeast, smaller, larger, notAfter, after, notBefore, fraction, whole, divF, showF, toNum];
  const comments: Record<Id, string> = {
    [keep]: "filter, written as a choice: pick any item, fail unless it passes, collect what's left with all.",
    [showNumbers]: "A fold that prints. Run backwards it unfolds, so it parses.",
    [onto]: "A helper of reverse. Published with the module, not offered in the palette.",
    [inverse]: "The x that f takes to y: f run backwards, for any function value f. Several answers are a Choice, as with solve; a function that acts (prints, writes a cell) is refused when it's run.",
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
    [toNum]: "The nearest Number.",
    [addF]: "What + is at Rational. Not offered on its own: + is.",
    [subF]: "What − is at Rational. Not offered on its own: − is.",
    [mulF]: "What · is at Rational. Not offered on its own: · is.",
    [negF]: "What −x is at Rational. Not offered on its own: − is.",
    [lessF]: "What < is at Rational. Not offered on its own: < is.",
    [applied]: "A helper of inverse: f(x), as a definition solve can name. Not offered in the palette.",
  };
  const p = publish(merge(prelude, std, k.code), k.names, [...offered, onto, applied, addF, subF, mulF, negF, lessF], merge(prelude, std));
  if (!p.ok) throw new Error(`the prelude can't be published: ${p.reason}`);
  const at = (d: Id) => p.rename.get(d)!;
  const notes = Object.fromEntries(Object.entries(comments).map(([d, c]) => [at(d), c]));
  return makeModule("prelude", p.code, p.names, offered.map(at), p.pins, notes, [addF, subF, mulF, negF, lessF].map(at));
}
