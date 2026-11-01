// Lists stored as arrays (REPRESENTATIONS.md step 5, BACKLOG L117, with
// the Compiler lane's C30d): `array of List`, a representation of std's
// List at std's Array, written in the language like the trees for Map and
// Set (map-tree.ts). Its meaning is `items of array`. Its jobs are on the
// array's two ends (first of array, rest of array, push front), which
// the evaluator and compiled JS keep as views on one buffer with free
// room at both ends (std.ts ArrayView), so a cons (onto an array nobody
// else sees: onto a match's rest it copies, which the chooser counts,
// represent.ts ontoField), a match and the length
// are constant and a fold is a walk. Which one a value gets is the
// compiler's choice, from the jobs a program does and these costs; a
// program never picks (Ersagun, 2026-10-30).
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
import { B } from "../prelude.ts";
import { ARRAY_OPS, COMPARE, CONS, COST, INT_OPS, JOBS, NIL, NONE, PAIR_V, REPRESENTATION_V, S, SHOW_ANY, SOME } from "./std.ts";

// `representations`: the array's row, then List's own (the definition as
// written, with its costs), which the chooser weighs it against.
export interface ArrayList { representations: Id[]; defs: Id[] }

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
  const match = def("array match", ["array", "if empty", "if not"], (a, empty, not) => k.match(k.call(ARRAY_OPS.firstIfAny, a), [
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
  // An item by its position, read in place: item at's rounding (a
  // position within a half of n is n), and `otherwise` outside the array
  // or for a position that isn't a number.
  const itemAt = def("array item at", ["array", "position", "otherwise"], (a, i, o) => k.call(S.first,
    k.thunk(() => k.call(ARRAY_OPS.at, a, k.call(INT_OPS.wholePart, k.call(S.floor, k.call(B.add, i, k.lit(0.5)))))),
    k.thunk(() => o)));
  // Equal, show and compare see the list it stands for: an array's own
  // compare puts shorter arrays first, and show says "array".
  const equal = def("array equal", ["a", "b"], (a, b) => k.call(S.equal, items(a), items(b)));
  const show = def("array show", ["array"], (a) => k.call(SHOW_ANY, items(a)));
  const compare = def("array compare", ["a", "b"], (a, b) => k.call(COMPARE, items(a), items(b)));

  const rep = k.def("array of List");
  k.define(rep, k.call(REPRESENTATION_V, k.x(ARRAY_OPS.items), cost(k, "linear"), k.list(
    k.call(JOBS.job, k.x(NIL), k.x(nil), cost(k, "constant")),
    k.call(JOBS.job, k.x(CONS), k.x(cons), cost(k, "constant")),
    k.call(JOBS.matchBy, k.x(match), cost(k, "constant")),
    k.call(JOBS.foldBy, k.x(fold), cost(k, "linear")),
    k.call(JOBS.job, k.x(prelude("length")), k.x(length), cost(k, "constant")),
    k.call(JOBS.job, k.x(prelude("append")), k.x(append), cost(k, "linear")),
    k.call(JOBS.job, k.x(prelude("item at")), k.x(itemAt), cost(k, "constant")),
    k.call(JOBS.hides, k.x(CONS), k.int(1)),
    k.call(JOBS.equalBy, k.x(equal)), k.call(JOBS.showBy, k.x(show)), k.call(JOBS.compareBy, k.x(compare)),
  )));
  defs.push(rep);
  // List as written: every job its own definition, at what it costs there.
  const spec = k.def("List as written");
  k.define(spec, k.call(REPRESENTATION_V, k.fn(["list"], (l) => l), cost(k, "linear"), k.list(
    k.call(JOBS.asWritten, k.x(NIL), cost(k, "constant")),
    k.call(JOBS.asWritten, k.x(CONS), cost(k, "constant")),
    k.call(JOBS.matchAsWritten, cost(k, "constant")),
    k.call(JOBS.foldAsWritten, cost(k, "linear")),
    k.call(JOBS.asWritten, k.x(prelude("length")), cost(k, "linear")),
    k.call(JOBS.asWritten, k.x(prelude("append")), cost(k, "linear")),
    k.call(JOBS.asWritten, k.x(prelude("item at")), cost(k, "linear")),
    k.call(JOBS.asWritten, k.x(prelude("replace at")), cost(k, "linear")),
  )));
  defs.push(spec);
  return { representations: [rep, spec], defs };
}
