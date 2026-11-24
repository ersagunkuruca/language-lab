// What a printed program runs side by side (C41 to C43, C61; branches-rt.ts),
// given to its runtime only where it does (C251c, core-rt.ts useBranches):
// its runtime names, its page's maps and searches on workers, and how a
// module or a page hands its functions to them. A page or module that
// runs nothing side by side carries none of it.

import { arrayOf } from "../../ters/src/lang/array-view.ts";
import { toList, type Value } from "../../ters/src/lang/run-values.ts";
import type * as I from "../../ters/src/lang/int.ts";
import { allEvery, countEvery, FAIL, firstOf, rangeCount, RUNTIME, type Branches } from "./core-rt.ts";
import { bothOn, bothPure, bothSecond, branchesFrom, branchWorker, pageBranches, pageGpu, pageWorker, mapAway, searchAway, chooseSplit, rangeSplit, firstInOrder, searchesBy, searchPure, splitGive, splitHold, firstPure, foldInOrder, foldPure, inOrder, mapInOrder, mapPure, mapWorth, testInOrder, testPure, togetherPure } from "./branches-rt.ts";

// The runtime's names a printed program calls these by (R.rt), and the
// world's operations (core-js.ts reads them to know a script needs this).
export const BRANCH_NAMES = ["together.pure", "map.worth", "all.pure", "any.pure", "both.pure", "both.second", "both.on", "first.pure", "count.search", "all.search", "first.search", "fold.pure", "choose.split", "range.split", "split.hold", "split.give", "map.pure", "keep.pure"];
export const BRANCH_WORLDS = ["mapAway", "searchAway"];

type Fn = (...xs: unknown[]) => unknown;
const unbounded = (fuel: unknown) => fuel === Infinity || fuel === undefined;
function rt(name: string): Fn | undefined {
  // A together whose actions only compute (C41): side by side on worker
  // threads, in order under a budget.
  if (name === "together.pure") return (actions: unknown, fuel: unknown) => (unbounded(fuel) ? togetherPure(actions) : inOrder(actions));
  // And a map of a function that only computes, by runs of its items (C42).
  if (name === "map.worth") return mapWorth as Fn;
  // all pass and any pass, stopping at the first item that decides (C43).
  if (name === "all.pure" || name === "any.pure") {
    const any = name === "any.pure";
    return (xs: unknown, f: unknown, fuel: unknown, site: unknown, always?: unknown, runs?: unknown) => (unbounded(fuel) ? testPure(xs, f as (x: unknown) => unknown, site as number, any, !!always, runs as number | undefined) : testInOrder(xs, f as (x: unknown) => unknown, any));
  }
  // Two calls of a function in its own body (C61 e): the first's answer,
  // and then the second's.
  if (name === "both.pure") return bothPure as Fn;
  if (name === "both.second") return bothSecond as Fn;
  if (name === "both.on") return bothOn as Fn;
  // first where, its answer's item as a list of one or none (C43).
  if (name === "first.pure") return (xs: unknown, f: unknown, fuel: unknown, site: unknown, always?: unknown, runs?: unknown) => (unbounded(fuel) ? firstPure(xs, f as (x: unknown) => unknown, site as number, !!always, runs as number | undefined) : firstInOrder(xs, f as (x: unknown) => unknown));
  // A count whose search's first choice is shared out (C43), and that
  // choice, which keeps one item in each run of it.
  if (name === "count.search") return (search: unknown, fuel: unknown, site: unknown, always?: unknown) => (unbounded(fuel) ? searchPure(search, site as number, "count", !!always) : countEvery(search));
  // all's, an array or a list of the runtime's as its type says.
  if (name === "all.search") return (search: unknown, array: unknown, fuel: unknown, site: unknown, always?: unknown) => {
    const xs = (unbounded(fuel) ? searchPure(search, site as number, "all", !!always) : allEvery(search)) as Value[];
    return array ? arrayOf(xs) : toList(xs);
  };
  // first's: its answer, or FAIL for the default.
  if (name === "first.search") return (search: unknown, fuel: unknown, site: unknown, always?: unknown) => {
    const xs = (unbounded(fuel) ? searchPure(search, site as number, "first", !!always) : firstOf(search)) as unknown[];
    if (!xs.length) throw FAIL;
    return xs[0];
  };
  // A fold of a list adding an Int for each item, or keeping the largest
  // or the smallest, after the empty list's z (C42).
  // A site held on worker threads (L280h) is given true after the join
  // (0 where it has none).
  if (name === "fold.pure") return (xs: unknown, f: unknown, z: unknown, how: unknown, fuel: unknown, site: unknown, by?: unknown, always?: unknown, runs?: unknown) => {
    const join = by === undefined || typeof by === "number" ? undefined : by as (x: unknown) => unknown;
    return unbounded(fuel) ? foldPure(xs, f as (x: unknown) => unknown, z as I.Int, how as "add", site as number, join, !!always, runs as number | undefined) : foldInOrder(xs, f as (x: unknown) => unknown, z as I.Int, how as "add", join);
  };
  if (name === "choose.split") return chooseSplit as Fn;
  if (name === "range.split") return ((x: number) => rangeSplit(rangeCount(x))) as Fn;
  if (name === "split.hold") return splitHold as Fn;
  if (name === "split.give") return splitGive as Fn;
  if (name === "map.pure" || name === "keep.pure") {
    const keep = name === "keep.pure";
    return (xs: unknown, f: unknown, fuel: unknown, site: unknown, always?: unknown, runs?: unknown) => (unbounded(fuel) ? mapPure(xs, f as (x: unknown) => unknown, site as number, keep, !!always, runs as number | undefined) : mapInOrder(xs, f as (x: unknown) => unknown, keep));
  }
  return undefined;
}

// A map on a page's workers (C61 c′, branches-rt.ts), given the rest; a
// count or an all of a search there likewise (C61 c′4).
function world(op: string): Fn | undefined {
  // One held (L280h) is given where, after the join, before the rest.
  if (op === "mapAway") return (...a: unknown[]) => {
    const [xs, f, fuel, site, how, z, join] = a, k = a[a.length - 1], on = a.length > 8 ? a[7] as "workers" | "GPU" | "" : undefined, runs = a.length > 9 ? a[8] as number : undefined;
    return mapAway(xs, f as (x: unknown) => unknown, fuel, site as number, how as "map", z, typeof join === "number" ? undefined : join as (x: unknown) => unknown, (v) => RUNTIME.ap(k as never, v), on || undefined, runs);
  };
  if (op === "searchAway") return (search, array, fuel, site, how, k) => searchAway(search, fuel, site as number, how as "count", (v) => RUNTIME.ap(k as never, how === "count" ? v : how === "first" ? ((v as Value[]).length ? (v as Value[])[0] : FAIL) : array ? arrayOf(v as Value[]) : toList(v as Value[])));
  return undefined;
}

searchesBy({ count: countEvery, all: allEvery, first: firstOf });
export const branches: Branches = { rt, world, branchesFrom, branchWorker, pageBranches, pageGpu, pageWorker };
