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
import { CONS, INT_OPS, NIL, S, TEXT_OPS, std } from "./std.ts";

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

  const offered: Id[] = [each, map, keep, showNumbers, length, sum, append, reverse, inverse, conjugate, atMost, moreThan, atLeast, smaller, larger, notAfter, after, notBefore];
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
    [applied]: "A helper of inverse: f(x), as a definition solve can name. Not offered in the palette.",
  };
  const p = publish(merge(prelude, std, k.code), k.names, [...offered, onto, applied], merge(prelude, std));
  if (!p.ok) throw new Error(`the prelude can't be published: ${p.reason}`);
  const at = (d: Id) => p.rename.get(d)!;
  const notes = Object.fromEntries(Object.entries(comments).map(([d, c]) => [at(d), c]));
  return makeModule("prelude", p.code, p.names, offered.map(at), p.pins, notes);
}
