// List helpers built through the TypeScript builder, for tests and
// benchmarks that need a program of a given size. The examples aren't built
// here: they are JSON written in the editor (examples/unpack.ts).

import { Lang } from "./dsl.ts";
import { CONS, NIL, S } from "./std.ts";

// Loops without loops: list helpers every program here can use. `each` and
// `map` recurse on the tail they took apart, so the checker sees they end;
// `keep` (filter) is a choice plus `all`.
export function library(k: Lang) {
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
