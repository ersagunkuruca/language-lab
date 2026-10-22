// The prelude, the first module: list helpers every program can use. It is
// written here with the DSL once, then published (library/build.ts writes
// library/prelude.json). Publishing names each definition by its content,
// so building it again gives the same ids, byte for byte: regenerating a
// published module can't lose anything, unlike regenerating a draft.

import { merge, type Id } from "../model.ts";
import { B, prelude } from "../prelude.ts";
import { Lang } from "./dsl.ts";
import { makeModule, publish, type Module } from "./modules.ts";
import { library } from "./programs.ts";
import { CONS, INT_OPS, NIL, std } from "./std.ts";

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

  const offered: Id[] = [each, map, keep, showNumbers, length, sum, append, reverse];
  const comments: Record<Id, string> = {
    [keep]: "filter, written as a choice: pick any item, fail unless it passes, collect what's left with all.",
    [showNumbers]: "A fold that prints. Run backwards it unfolds, so it parses.",
    [onto]: "A helper of reverse. Published with the module, not offered in the palette.",
  };
  const p = publish(merge(prelude, std, k.code), k.names, [...offered, onto], merge(prelude, std));
  if (!p.ok) throw new Error(`the prelude can't be published: ${p.reason}`);
  const at = (d: Id) => p.rename.get(d)!;
  const notes = Object.fromEntries(Object.entries(comments).map(([d, c]) => [at(d), c]));
  return makeModule("prelude", p.code, p.names, offered.map(at), p.pins, notes);
}
