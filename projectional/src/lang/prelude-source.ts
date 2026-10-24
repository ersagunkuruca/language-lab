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
import { ABORT_OP, ARITH, COMPARE, COMPLEX_V, CONS, INT_OPS, NIL, NONE, ORDER_V, OUTCOME_V, PAIR_V, RATIO, S, SOME, TEXT_OPS, std } from "./std.ts";

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
  // The same five over Number's own <, as they were published before the
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
  const toNum = k.def("fraction as number");
  k.define(toNum, k.fn(["a"], (a) => ratio(a, (p, q) => k.call(B.div, k.call(INT_OPS.toNumber, p), k.call(INT_OPS.toNumber, q)))));

  // Complex numbers: a record of two Numbers (std.ts), re + im·i. + − ·
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

  const offered: Id[] = [each, map, keep, showNumbers, length, sum, append, reverse, inverse, conjugate, atMost, moreThan, atLeast, smaller, larger, notAfter, after, notBefore, fraction, whole, divF, showF, toNum, asC, unitI, conjC, modulus, angle, polar, divC, expC, showC, sort, attempt, valueOrAbort];
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
    [sort]: "The list in order: numbers by value, text alphabetically (by code point), cases in the order their type lists them, then field by field (compare). A merge sort (von Neumann, 1945), bottom-up so it surely finishes: n log n steps.",
    [attempt]: "The action's answer as done(answer), or refused(reason) when it aborts: an Abort kept as data, so it can go in a list (Rust's Result is the influence).",
    [valueOrAbort]: "The value in done(value); refused(reason) aborts with the reason again. attempt run backwards.",
    [mergeSorted]: "Two sorted lists as one. A helper of sort, not offered.",
    [addRun]: "A helper of sort: a sorted run added to the slots of runs, like adding 1 to a binary number. Not offered.",
    [asC]: "The Number x as a complex number, x + 0i.",
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
    [mulC]: "What · is at Complex: (a + bi)(c + di) = (ac − bd) + (ad + bc)i. Not offered on its own: · is.",
    [negC]: "What −x is at Complex. Not offered on its own: − is.",
    ...Object.fromEntries(numberOnly.map((d) => [d, "The Number-only version from before the one generic <, kept so programs saved before still open. Not offered: the generic one is."])),
    [applied]: "A helper of inverse: f(x), as a definition solve can name. Not offered in the palette.",
  };
  const p = publish(merge(prelude, std, k.code), k.names, [...offered, onto, applied, addF, subF, mulF, negF, lessF, addC, subC, mulC, negC, ...numberOnly, mergeSorted, addRun], merge(prelude, std));
  if (!p.ok) throw new Error(`the prelude can't be published: ${p.reason}`);
  const at = (d: Id) => p.rename.get(d)!;
  const notes = Object.fromEntries(Object.entries(comments).map(([d, c]) => [at(d), c]));
  return makeModule("prelude", p.code, p.names, offered.map(at), p.pins, notes, [addF, subF, mulF, negF, lessF, addC, subC, mulC, negC, ...numberOnly, mergeSorted, addRun].map(at));
}
