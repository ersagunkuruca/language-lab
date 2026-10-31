// Lists stored as arrays (REPRESENTATIONS.md step 5, BACKLOG L117, with
// the Compiler lane's C30d): `array of List`, a representation of std's
// List at std's Array, written in the language like the trees for Map and
// Set (map-tree.ts). Its meaning is `items of array`; its jobs say what an
// array does well (its length, appending) and what it does badly (a cons
// at the front copies, and a fold that reads each rest copies each rest).
// Which one a value gets is the compiler's choice, from the jobs a program
// does and these costs; a program never picks (Ersagun, 2026-10-30).
//
// A list's rest (cons's field 1) is `hides`: in an array it is the items after a position,
// not a value kept. The jobs below make it, as an array of the rest, only
// because a job must give the arm something; a fold whose arms never read
// it is a walk along the array, which the compiler generates (C30d).
//
// Prior art: Clojure's vectors and Haskell's Data.Vector as sequences
// stored side by side; Hoare's abstraction function (1972), here the
// meaning.

import type { Id } from "../model.ts";
import type { Lang } from "./dsl.ts";
import { ARRAY_OPS, CONS, COST, JOBS, NIL, REPRESENTATION_V } from "./std.ts";

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
  // A cons at the front makes a new array: every item moves up one.
  const cons = def("array cons", ["item", "rest"], (x, rest) => array(k.call(CONS, x, items(rest))));
  // A match: the first item, and the rest as an array of its own.
  const match = def("array match", ["array", "if empty", "if not"], (a, empty, not) => k.match(items(a), [
    { variant: NIL, names: [], body: () => k.call(empty) },
    { variant: CONS, names: ["item", "rest"], body: ([x, rest]) => k.call(not, x, array(rest)) },
  ]));
  // A fold from the last item back, as a list's fold runs its arms; each
  // arm is given its rest as an array, which copies it.
  const fold = def("array fold", ["array", "if empty", "if not"], (a, empty, not) => k.fold(items(a), [
    { variant: NIL, names: [], body: () => k.call(empty) },
    { variant: CONS, names: ["item", "rest"], results: [null, "the rest's answer"], body: ([x, rest], [, r]) => k.call(not, x, array(rest), r!) },
  ]));
  const length = def("array length of", ["array"], (a) => k.call(ARRAY_OPS.length, a));
  const append = def("array append", ["front", "back"], (a, b) => array(k.call(prelude("append"), items(a), items(b))));

  const rep = k.def("array of List");
  k.define(rep, k.call(REPRESENTATION_V, k.x(ARRAY_OPS.items), cost(k, "linear"), k.list(
    k.call(JOBS.job, k.x(NIL), k.x(nil), cost(k, "constant")),
    k.call(JOBS.job, k.x(CONS), k.x(cons), cost(k, "linear")),
    k.call(JOBS.matchBy, k.x(match), cost(k, "linear")),
    k.call(JOBS.foldBy, k.x(fold), cost(k, "quadratic")),
    k.call(JOBS.job, k.x(prelude("length")), k.x(length), cost(k, "constant")),
    k.call(JOBS.job, k.x(prelude("append")), k.x(append), cost(k, "linear")),
    k.call(JOBS.hides, k.x(CONS), k.int(1)),
  )));
  defs.push(rep);
  return { representation: rep, defs };
}
