// Lists stored as arrays (REPRESENTATIONS.md step 5, BACKLOG L117, with
// the Compiler lane's C30d): `array of List`, a representation of std's
// List at std's Array, written in the language like the trees for Map and
// Set (map-tree.ts). Its meaning is `items of array`. Its jobs are on the
// array's two ends (first of array, rest of array, push front), which
// compiled JS keeps as views on one buffer with free room at both ends
// (runtime.js), so a cons, a match and the length are constant and a fold
// is a walk. Which one a value gets is the compiler's choice, from the
// jobs a program does and these costs; a program never picks (Ersagun,
// 2026-10-30).
//
// A list's rest (cons's field 1) is `hides`: in an array it is the items
// after a position, not a value kept.
//
// Ersagun's design: a two-ended array list from one of his Unity C#
// projects. Prior art: deques as ring buffers, gap buffers, two-stack
// queues, Go's slices sharing a backing array; Clojure's vectors and
// Haskell's Data.Vector as sequences stored side by side; Hoare's
// abstraction function (1972), here the meaning.

import type { Id } from "../model.ts";
import type { Lang } from "./dsl.ts";
import { ARRAY_OPS, CONS, COST, JOBS, NIL, NONE, PAIR_V, REPRESENTATION_V, S, SOME } from "./std.ts";

export interface ArrayList { representation: Id; defs: Id[] }

const cost = (k: Lang, c: "constant" | "linear" | "quadratic") => k.x(`${COST}.${c}`);

export function buildArrayList(k: Lang, prelude: (name: string) => Id): ArrayList {
  const defs: Id[] = [];
  const def = (name: string, params: string[], body: (...ps: Id[]) => Id) => { const d = k.def(name); k.define(d, k.fn(params, body)); defs.push(d); return d; };
  const items = (a: Id) => k.call(ARRAY_OPS.items, a);
  const array = (l: Id) => k.call(ARRAY_OPS.of, l);

  const nil = k.def("array nil");
  k.define(nil, k.call(ARRAY_OPS.empty));
  defs.push(nil);
  // A cons adds the item at the front, into the free slot before the
  // items when no other array has taken it.
  const cons = def("array cons", ["item", "rest"], (x, rest) => k.call(ARRAY_OPS.pushFront, rest, x));
  // A match: the first item, and the rest, the same items from one later.
  const match = def("array match", ["array", "if empty", "if not"], (a, empty, not) => k.match(k.call(S.optional, k.thunk(() => k.call(ARRAY_OPS.first, a))), [
    { variant: NONE, names: [], body: () => k.call(empty) },
    { variant: SOME, names: ["item"], body: ([x]) => k.call(not, x, k.call(ARRAY_OPS.rest, a)) },
  ]));
  // A fold from the last item back, as a list's fold runs its arms. Each
  // arm's rest is built from the back as the fold goes, one push front an
  // item, so the fold is a walk and no rest is copied.
  const fold = def("array fold", ["array", "if empty", "if not"], (a, empty, not) => k.match(k.fold(items(a), [
    { variant: NIL, names: [], body: () => k.call(PAIR_V, k.call(empty), k.call(ARRAY_OPS.empty)) },
    { variant: CONS, names: ["item", "rest"], results: [null, "the rest's answer"], body: ([x], [, r]) => k.match(r!, [
      { variant: PAIR_V, names: ["answer", "rest"], body: ([answer, rest]) => k.call(PAIR_V, k.call(not, x, rest, answer), k.call(ARRAY_OPS.pushFront, rest, x)) },
    ]) },
  ]), [{ variant: PAIR_V, names: ["answer", "array"], body: ([answer]) => answer }]));
  const length = def("array length of", ["array"], (a) => k.call(ARRAY_OPS.length, a));
  const append = def("array append", ["front", "back"], (a, b) => array(k.call(prelude("append"), items(a), items(b))));

  const rep = k.def("array of List");
  k.define(rep, k.call(REPRESENTATION_V, k.x(ARRAY_OPS.items), cost(k, "linear"), k.list(
    k.call(JOBS.job, k.x(NIL), k.x(nil), cost(k, "constant")),
    k.call(JOBS.job, k.x(CONS), k.x(cons), cost(k, "constant")),
    k.call(JOBS.matchBy, k.x(match), cost(k, "constant")),
    k.call(JOBS.foldBy, k.x(fold), cost(k, "linear")),
    k.call(JOBS.job, k.x(prelude("length")), k.x(length), cost(k, "constant")),
    k.call(JOBS.job, k.x(prelude("append")), k.x(append), cost(k, "linear")),
    k.call(JOBS.hides, k.x(CONS), k.int(1)),
  )));
  defs.push(rep);
  return { representation: rep, defs };
}
