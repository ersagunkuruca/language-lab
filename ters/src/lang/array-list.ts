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
import { ARRAY_OPS, CELL_OPS, COMPARE, CONS, COST, INT_OPS, JOBS, NIL, NONE, PAIR_V, REPRESENTATION_V, S, SHOW_ANY, SOME } from "./std.ts";

// `representations`: the array's row, then List's own (the definition as
// written, with its costs), which the chooser weighs it against.
export interface ArrayList { representations: Id[]; defs: Id[] }

const cost = (k: Lang, c: "constant" | "linear" | "linearithmic" | "quadratic") => k.x(`${COST}.${c}`);

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
  // A match: the first item, and the rest, the same items from one later,
  // read in one call, so the match runs backwards too, the array made
  // from them (C137 s3e).
  const match = def("array match", ["array", "if empty", "if not"], (a, empty, not) => k.match(k.call(ARRAY_OPS.front, a), [
    { variant: NONE, names: [], body: () => k.call(empty) },
    { variant: SOME, names: ["front"], body: ([f]) => k.match(f, [{ variant: PAIR_V, names: ["item", "rest"], body: ([x, r]) => k.call(not, x, r) }]) },
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
  // An append writes the shorter one's items onto the other's end, into
  // its free room when no other array has taken it, so appending onto
  // what a loop carries (`unpacked(rest, append(out, [b]))`, pack) or a
  // fold's appends from the back (pack's bits of every token) copy
  // nothing, where a new array of both copied the whole each time (C234).
  // Else the longer one is copied once, with room, as a push does.
  // Folds, so they surely finish: back's items pushed onto front in order
  // over the positions from the last (a fold's arms run from the back),
  // one item read with no search (cons-onto.ts's `append(so far, [item])`,
  // C240), and front's onto back from front's last item.
  const len = (a: Id) => k.call(ARRAY_OPS.length, a);
  const onBack = def("array append onto back", ["front", "back"], (a, b) => k.if(k.call(S.equal, len(b), k.int(1)),
    k.match(k.call(ARRAY_OPS.firstIfAny, b), [
      { variant: NONE, names: [], body: () => a },
      { variant: SOME, names: ["item"], body: ([x]) => k.call(ARRAY_OPS.push, a, x) },
    ]),
    k.fold(k.call(INT_OPS.range, len(b)), [
      { variant: NIL, names: [], body: () => a },
      { variant: CONS, names: ["i", "rest"], results: [null, "pushed"], body: ([i], [, r]) => k.call(S.first,
        k.thunk(() => k.call(ARRAY_OPS.push, r!, k.call(ARRAY_OPS.at, b, k.call(INT_OPS.sub, k.call(INT_OPS.sub, len(b), k.int(1)), i)))),
        k.thunk(() => r!)) },
    ])));
  const onFront = def("array append onto front", ["front", "back"], (a, b) => k.fold(items(a), [
    { variant: NIL, names: [], body: () => b },
    { variant: CONS, names: ["item", "rest"], results: [null, "pushed"], body: ([x], [, r]) => k.call(ARRAY_OPS.pushFront, r!, x) },
  ]));
  // One item at the end (C250): a push, into the free room when no other
  // array has taken it.
  const atEnd = def("array added at end", ["array", "item"], (a, x) => k.call(ARRAY_OPS.push, a, x));
  const append = def("array append", ["front", "back"], (a, b) => k.if(k.call(INT_OPS.less, len(a), len(b)), k.call(onFront, a, b), k.call(onBack, a, b)));
  // A map: a fold from the back, each item mapped and pushed into the
  // free slot in front of what the rest made, as the list's map runs
  // `by`: no list made on the way (C196: the pedal's driven band, a block
  // a call).
  const mapped = def("array map", ["array", "by"], (a, f) => k.fold(items(a), [
    { variant: NIL, names: [], body: () => k.call(ARRAY_OPS.empty) },
    { variant: CONS, names: ["item", "rest"], results: [null, "the rest mapped"], body: ([x], [, r]) => k.call(ARRAY_OPS.pushFront, r!, k.call(f, x)) },
  ]));
  // An item by its Int position, read in place, and `otherwise` outside
  // the array.
  const itemAt = def("array item at", ["array", "position", "otherwise"], (a, i, o) => k.call(S.first,
    k.thunk(() => k.call(ARRAY_OPS.at, a, i)),
    k.thunk(() => o)));
  // The items after the first `count`, and the first `count` (C221): a
  // view on the same buffer, where the list's walk `count` items (trek's
  // window, `take(drop(hs, i − k), 2k + 1)`, walked i items a fix).
  const dropped = def("array drop", ["array", "count"], (a, c) => k.call(ARRAY_OPS.slice, a, c, k.call(ARRAY_OPS.length, a)));
  const taken = def("array take", ["array", "count"], (a, c) => k.call(ARRAY_OPS.slice, a, k.int(0), c));
  // An item replaced by its Int position (C93c), in the buffer, the array
  // it was keeping the change back; the array as it is outside it.
  const replaced = def("array replace at", ["array", "position", "by"], (a, i, x) => k.call(ARRAY_OPS.replaceAt, a, i, x));
  // Equal, show and compare see the list it stands for: an array's own
  // compare puts shorter arrays first, and show says "array". Two of
  // different lengths differ at once: `bits = nil` in a loop doesn't walk
  // the bits each turn (pack, GAPS round 18).
  const equal = def("array equal", ["a", "b"], (a, b) => k.if(k.call(S.equal, k.call(length, a), k.call(length, b)), k.call(S.equal, items(a), items(b)), k.false));
  const show = def("array show", ["array"], (a) => k.call(SHOW_ANY, items(a)));
  const compare = def("array compare", ["a", "b"], (a, b) => k.call(COMPARE, items(a), items(b)));

  // A sort (C355): the array sorted by the target's own sort, by compare,
  // equal items in the order they were, as the list's merge sort has
  // them. That merge conses its answer up, which on an array is a call
  // deep an item (clinic's percentiles: past 1000 deep, a generator step
  // each).
  const sorted = def("array sort", ["array"], (a) => k.call(ARRAY_OPS.sorted, a));
  const rep = k.def("array of List");
  k.define(rep, k.call(REPRESENTATION_V, k.x(ARRAY_OPS.items), cost(k, "linear"), k.list(
    k.call(JOBS.job, k.x(NIL), k.x(nil), cost(k, "constant")),
    k.call(JOBS.job, k.x(CONS), k.x(cons), cost(k, "constant")),
    k.call(JOBS.matchBy, k.x(match), cost(k, "constant")),
    k.call(JOBS.foldBy, k.x(fold), cost(k, "linear")),
    // A fold whose arms don't read the rest (a sum, a count): the items'
    // own fold, read in place, with no rest built (C42).
    k.call(JOBS.foldOfItems, cost(k, "linear")),
    k.call(JOBS.job, k.x(prelude("length")), k.x(length), cost(k, "constant")),
    k.call(JOBS.job, k.x(prelude("append")), k.x(append), cost(k, "linear")),
    // Onto what a loop carries, at its free end: as long as what is added,
    // which the loop's own items count (C234).
    k.call(JOBS.carried, k.x(prelude("append")), cost(k, "constant")),
    k.call(JOBS.job, k.x(prelude("added at end")), k.x(atEnd), cost(k, "constant")),
    k.call(JOBS.job, k.x(prelude("item at")), k.x(itemAt), cost(k, "constant")),
    k.call(JOBS.job, k.x(prelude("map")), k.x(mapped), cost(k, "linear")),
    k.call(JOBS.job, k.x(prelude("replace at")), k.x(replaced), cost(k, "constant")),
    k.call(JOBS.job, k.x(prelude("drop")), k.x(dropped), cost(k, "constant")),
    k.call(JOBS.job, k.x(prelude("take")), k.x(taken), cost(k, "constant")),
    k.call(JOBS.job, k.x(prelude("sort")), k.x(sorted), cost(k, "linearithmic")),
    // A page's each over a cell holding the list (C354): over the array.
    k.call(JOBS.job, k.x(CELL_OPS.each), k.x(CELL_OPS.eachArray), cost(k, "linear")),
    k.call(JOBS.hides, k.x(CONS), k.int(1)),
    // A whole list from outside: one array of it (C76).
    k.call(JOBS.storeBy, k.x(ARRAY_OPS.of)),
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
    k.call(JOBS.asWritten, k.x(prelude("added at end")), cost(k, "linear")),
    k.call(JOBS.asWritten, k.x(prelude("item at")), cost(k, "linear")),
    k.call(JOBS.asWritten, k.x(prelude("map")), cost(k, "linear")),
    k.call(JOBS.asWritten, k.x(prelude("replace at")), cost(k, "linear")),
    k.call(JOBS.asWritten, k.x(prelude("drop")), cost(k, "linear")),
    k.call(JOBS.asWritten, k.x(prelude("take")), cost(k, "linear")),
    k.call(JOBS.asWritten, k.x(prelude("sort")), cost(k, "linearithmic")),
  )));
  defs.push(spec);
  return { representations: [rep, spec], defs };
}
