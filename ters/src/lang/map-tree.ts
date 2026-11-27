// Maps and sets stored as weight-balanced trees (BACKLOG L76,
// DATA-STRUCTURES.md step 2): representations of std's Map and Set
// (NUMBERS.md, represent.ts). The meaning stays the sorted entries or
// items; the tree does their jobs in log n.
//
// A tree is tip, or bin(size, key, value, left, right) (a set's has no
// value) with every key on the left before `key` and every key on the
// right after it, by compare. It stays balanced by weight: neither side
// holds more than three times the other (plus one), restored by single and
// double rotations after each change. That is Nievergelt and Reingold's
// weight-balanced trees (1972) as Adams wrote them for functional languages
// (1993), with the parameters ⟨3, 2⟩ that Hirai and Yamamoto proved correct
// (2011), as in Haskell's containers.
//
// A tree's shape depends on the order keys were put in, so it isn't a
// canonical spelling (`canonical: false`): equal, show and compare on maps
// and sets go through `meaning`, which `byType` names for the rewrite that
// finds them by type (C47). The rows are written as representation
// definitions (REPRESENTATIONS.md, L108b), which the library publishes
// (trees-source.ts, library/trees.json) and LIBRARY.reps is read from;
// `withMapTree` builds them into a program for tests.

import { merge, type Code, type Id } from "../model.ts";
import type { Names } from "../presentation.ts";
import { Lang } from "./dsl.ts";
import { CARRIED, FOLD_OF_ITEMS, LADDER, representationsIn, type Representation } from "./represent.ts";
import { infer } from "./infer.ts";
import { COMPARE, CONS, COST, JOBS, HASH_SET_OPS, TABLE_OPS, REPRESENTATION_V, FALSE, INT_OPS, MAP, MAP_V, NIL, NONE, ORDER_V, PAIR_V, POOL, POOL_KEY, POOL_KEY_V, POOL_V, S, SET_TYPE, SET_V, SHOW_ANY, SOME, TRUE } from "./std.ts";
import { HASH_SET, INT, TABLE } from "./types.ts";
import { LIST, OPTIONAL } from "./std.ts";

// `representations`: the five definitions, the tree and the sorted list
// for Map, then for Set, then Map's hash table (C63b) and Set's (C63d).
export interface Trees { representations: Id[]; defs: Id[] }

// The two rows, written into `k`. `prelude` finds a prelude definition by
// name (the map and set operations the trees do, and map, reverse, keep).
export function buildTrees(k: Lang, prelude: (name: string) => Id): Trees {
  const defs: Id[] = [];
  const def = (name: string, params: string[], body: (...ps: Id[]) => Id) => { const d = k.def(name); k.define(d, k.fn(params, body)); defs.push(d); return d; };
  const rec = (name: string) => { const d = k.def(name); defs.push(d); return d; };
  const i = { add: (a: Id, b: Id) => k.call(INT_OPS.add, a, b), mul: (a: Id, b: Id) => k.call(INT_OPS.mul, a, b), less: (a: Id, b: Id) => k.call(INT_OPS.less, a, b) };
  const order = (a: Id, b: Id, before: () => Id, same: () => Id, after: () => Id) => k.match(k.call(COMPARE, a, b), [
    { variant: ORDER_V.before, names: [], body: before },
    { variant: ORDER_V.same, names: [], body: same },
    { variant: ORDER_V.after, names: [], body: after },
  ]);
  const pair = (e: Id, f: (a: Id, b: Id) => Id, ns = ["key", "value"]) => k.match(e, [{ variant: PAIR_V, names: ns, body: ([a, b]) => f(a, b) }]);

  // One tree, with or without values. The jobs below are written once on
  // a node's key, value (null for a set) and two sides.
  function tree(name: string, withValues: boolean) {
    const side = (self: Id, ps: Id[]) => k.tref(self, ...ps.map((p) => k.tref(p)));
    const T = k.type(name, withValues ? ["k", "v"] : ["k"], [
      ["tip", []],
      ["bin", [
        ["size", () => k.tref(INT)],
        ["key", (_, [kk]) => k.tref(kk)],
        ...(withValues ? [["value", (_: Id, ps: Id[]) => k.tref(ps[1])] as [string, (self: Id, ps: Id[]) => Id]] : []),
        ["left", side],
        ["right", side],
      ]],
    ]);
    defs.push(T.def);
    const { tip, bin } = T.v;
    const word = withValues ? "tree" : "set tree";
    type Parts = (s: Id, key: Id, v: Id | null, l: Id, r: Id) => Id;
    const parts = (t: Id, f: Parts, otherwise: () => Id, p = "") => k.match(t, [
      { variant: tip, names: [], body: otherwise },
      { variant: bin, names: [`${p}size`, `${p}key`, ...(withValues ? [`${p}value`] : []), `${p}left`, `${p}right`], body: (xs) => (withValues ? f(xs[0], xs[1], xs[2], xs[3], xs[4]) : f(xs[0], xs[1], null, xs[2], xs[3])) },
    ]);
    const kv = (key: Id, v: Id | null) => (withValues ? [key, v!] : [key]);
    const size = def(`${word} size`, ["tree"], (t) => parts(t, (s) => s, () => k.int(0)));
    const ps = withValues ? ["key", "value", "left", "right"] : ["key", "left", "right"];
    const split = (xs: Id[]) => (withValues ? { key: xs[0], v: xs[1], l: xs[2], r: xs[3] } : { key: xs[0], v: null, l: xs[1], r: xs[2] });
    const node = def(`${word} node`, ps, (...xs) => { const { key, v, l, r } = split(xs); return k.call(bin, i.add(i.add(k.call(size, l), k.call(size, r)), k.int(1)), ...kv(key, v), l, r); });
    const N = (key: Id, v: Id | null, l: Id, r: Id) => k.call(node, ...kv(key, v), l, r);
    const call4 = (d: Id, key: Id, v: Id | null, l: Id, r: Id) => k.call(d, ...kv(key, v), l, r);
    // The rotations. A side that is too heavy is never a tip, so the tip
    // cases only keep the types whole.
    const singleL = def(`${word} single left`, ps, (...xs) => { const { key, v, l, r } = split(xs); return parts(r, (_, rk, rv, rl, rr) => N(rk, rv, N(key, v, l, rl), rr), () => N(key, v, l, r), "r "); });
    const singleR = def(`${word} single right`, ps, (...xs) => { const { key, v, l, r } = split(xs); return parts(l, (_, lk, lv, ll, lr) => N(lk, lv, ll, N(key, v, lr, r)), () => N(key, v, l, r), "l "); });
    const doubleL = def(`${word} double left`, ps, (...xs) => { const { key, v, l, r } = split(xs); return parts(r, (_, rk, rv, rl, rr) =>
      parts(rl, (__, mk, mv, ml, mr) => N(mk, mv, N(key, v, l, ml), N(rk, rv, mr, rr)), () => N(key, v, l, r), "m "), () => N(key, v, l, r), "r "); });
    const doubleR = def(`${word} double right`, ps, (...xs) => { const { key, v, l, r } = split(xs); return parts(l, (_, lk, lv, ll, lr) =>
      parts(lr, (__, mk, mv, ml, mr) => N(mk, mv, N(lk, lv, ll, ml), N(key, v, mr, r)), () => N(key, v, l, r), "m "), () => N(key, v, l, r), "l "); });
    const DELTA = 3, RATIO = 2;
    const balance = def(`${word} balance`, ps, (...xs) => { const { key, v, l, r } = split(xs); return k.let("left size", k.call(size, l), (sl) => k.let("right size", k.call(size, r), (sr) =>
      k.if(i.less(i.add(sl, sr), k.int(2)), N(key, v, l, r),
        k.if(i.less(i.mul(k.int(DELTA), sl), sr),
          parts(r, (_, __, ___, rl, rr) => k.if(i.less(k.call(size, rl), i.mul(k.int(RATIO), k.call(size, rr))), call4(singleL, key, v, l, r), call4(doubleL, key, v, l, r)), () => N(key, v, l, r), "r "),
          k.if(i.less(i.mul(k.int(DELTA), sr), sl),
            parts(l, (_, __, ___, ll, lr) => k.if(i.less(k.call(size, lr), i.mul(k.int(RATIO), k.call(size, ll))), call4(singleR, key, v, l, r), call4(doubleR, key, v, l, r)), () => N(key, v, l, r), "l "),
            N(key, v, l, r)))))); });
    const B = (key: Id, v: Id | null, l: Id, r: Id) => call4(balance, key, v, l, r);

    const insert = rec(withValues ? "tree put" : "set tree add");
    k.define(insert, k.fn(["tree", "key", ...(withValues ? ["value"] : [])], (t, key, v) => parts(t, (s, tk, tv, l, r) => order(key, tk,
      () => B(tk, tv, k.call(insert, l, ...kv(key, v)), r),
      // Putting a key that is there replaces its value; adding an item
      // that is there changes nothing.
      () => (withValues ? k.call(bin, s, key, v!, l, r) : t),
      () => B(tk, tv, l, k.call(insert, r, ...kv(key, v)))),
    () => N(key, withValues ? v : null, k.x(tip), k.x(tip)))));
    // A map's update at (L103): one walk down, change(value) where the key
    // is, change(default) in a new leaf where it isn't.
    const update = withValues ? rec("tree update at") : null;
    if (update) k.define(update, k.fn(["tree", "key", "default", "change"], (t, key, d, f) => parts(t, (s, tk, tv, l, r) => order(key, tk,
      () => B(tk, tv, k.call(update, l, key, d, f), r),
      () => k.call(bin, s, key, k.call(f, tv!), l, r),
      () => B(tk, tv, l, k.call(update, r, key, d, f))),
    () => N(key, k.call(f, d), k.x(tip), k.x(tip)))));
    const has = rec(`${word} has`);
    k.define(has, k.fn(["tree", "key"], (t, key) => parts(t, (_, tk, __, l, r) => order(key, tk, () => k.call(has, l, key), () => k.x(TRUE), () => k.call(has, r, key)), () => k.x(FALSE))));
    // The leftmost key (and value), and the tree without it: what takes a
    // removed node's place.
    const smallest = rec(`${word} smallest`);
    k.define(smallest, k.fn(["tree", "key", ...(withValues ? ["value"] : [])], (t, key, v) => parts(t, (_, tk, tv, l) => k.call(smallest, l, ...kv(tk, tv)), () => (withValues ? k.call(PAIR_V, key, v) : key))));
    const dropMin = rec(`${word} without smallest`);
    k.define(dropMin, k.fn(["tree"], (t) => parts(t, (_, tk, tv, l, r) => parts(l, () => B(tk, tv, k.call(dropMin, l), r), () => r, "l "), () => k.x(tip))));
    const glue = def(`${word} glue`, ["left", "right"], (l, r) => parts(r, (_, rk, rv) => (withValues
      ? pair(k.call(smallest, r, rk, rv!), (mk, mv) => B(mk, mv, l, k.call(dropMin, r)), ["min key", "min value"])
      : k.let("min", k.call(smallest, r, rk), (mk) => B(mk, null, l, k.call(dropMin, r)))), () => l, "r "));
    const remove = rec(`${word} remove`);
    k.define(remove, k.fn(["tree", "key"], (t, key) => parts(t, (_, tk, tv, l, r) => order(key, tk,
      () => B(tk, tv, k.call(remove, l, key), r),
      () => k.call(glue, l, r),
      () => B(tk, tv, l, k.call(remove, r, key))),
    () => k.x(tip))));
    // The entries (items) in order, onto a list: the meaning's list.
    const onto = rec(`${word} onto`);
    k.define(onto, k.fn(["tree", "rest"], (t, rest) => parts(t, (_, tk, tv, l, r) => k.call(onto, l, k.call(CONS, withValues ? k.call(PAIR_V, tk, tv!) : tk, k.call(onto, r, rest))), () => rest)));
    const list = def(`${word} list`, ["tree"], (t) => k.call(onto, t, k.x(NIL)));
    // The two ends (L102): down the left side to the smallest key, down
    // the right to the largest; no answer at a tip.
    const end = (name: string, left: boolean) => {
      const d = rec(`${word} ${name}`);
      k.define(d, k.fn(["tree"], (t) => parts(t, (_, tk, __, l, r) => parts(left ? l : r, () => k.call(d, left ? l : r), () => tk, "next "), () => k.call(S.fail))));
      return d;
    };
    const first = end("first", true), last = end("last", false);
    const emptyTree = k.def(`empty ${word}`);
    k.define(emptyTree, k.x(tip));
    defs.push(emptyTree);
    // The first entry (item) only, as a list of one, or nil: down the
    // left, not the whole list (GAPS.md M3). `pick` takes what smallest
    // gives.
    const head = (name: string, pick: (e: Id) => Id) => def(name, ["tree"], (t) => parts(t, (_, tk, tv, l) => k.call(CONS, pick(k.call(smallest, l, ...kv(tk, tv))), k.x(NIL)), () => k.x(NIL)));
    return { T, tip, size, insert, update, has, remove, list, emptyTree, first, last, head };
  }

  // ---- Map
  const m = tree("Map tree", true);
  const find = rec("tree value at");
  k.define(find, k.fn(["tree", "key"], (t, key) => k.match(t, [
    { variant: m.tip, names: [], body: () => k.call(S.fail) },
    { variant: m.T.v.bin, names: ["size", "node key", "value", "left", "right"], body: ([, tk, tv, l, r]) => order(key, tk, () => k.call(find, l, key), () => tv, () => k.call(find, r, key)) },
  ])));
  const putAll = (ps: Id, t0: Id) => k.fold(ps, [
    { variant: NIL, names: [], body: () => t0 },
    { variant: CONS, names: ["entry", "rest"], results: [null, "tree"], body: ([e], [, t]) => pair(e, (key, v) => k.call(m.insert, t!, key, v)) },
  ]);
  const mapMeaning = def("tree meaning", ["tree"], (t) => k.call(MAP_V, k.call(m.list, t)));
  const mapOf = (f: (a: Id, b: Id) => Id, name: string) => def(name, ["a", "b"], (a, b) => f(k.call(mapMeaning, a), k.call(mapMeaning, b)));
  // A Map has one case and nothing recursive in it, so its fold is its
  // match.
  const matchMap = def("match tree", ["tree", "map of"], (t, f) => k.call(f, k.call(m.list, t)));
  const mapImpl: Record<Id, Id> = {
    [MAP_V]: def("tree of entries", ["entries"], (es) => putAll(es, k.x(m.tip))),
    match: matchMap,
    fold: matchMap,
    [prelude("empty map")]: m.emptyTree,
    // A later pair wins: put in the order given.
    [prelude("as map")]: def("tree as map", ["pairs"], (ps) => putAll(k.call(prelude("reverse"), ps), k.x(m.tip))),
    [prelude("put")]: m.insert,
    [prelude("update at")]: m.update!,
    [prelude("value at")]: find,
    [prelude("remove key")]: m.remove,
    [prelude("has key")]: m.has,
    [prelude("merge maps")]: def("tree merge", ["first", "second"], (a, b) => putAll(k.call(prelude("reverse"), k.call(m.list, b)), a)),
    [prelude("keys of")]: def("tree keys", ["tree"], (t) => k.call(prelude("map"), k.call(m.list, t), k.fn(["entry"], (e) => pair(e, (key) => key)))),
    [prelude("values of")]: def("tree values", ["tree"], (t) => k.call(prelude("map"), k.call(m.list, t), k.fn(["entry"], (e) => pair(e, (_, v) => v)))),
    [prelude("entries of")]: m.list,
    [prelude("map size")]: m.size,
    [prelude("smallest key")]: m.first,
    [prelude("largest key")]: m.last,
  };
  const mapHeads = {
    [prelude("entries of")]: m.head("tree head entry", (e) => e),
    [prelude("keys of")]: m.head("tree head key", (e) => pair(e, (key) => key)),
  };
  const mapByType = {
    equal: mapOf((a, b) => k.call(S.equal, a, b), "tree equal"),
    compare: mapOf((a, b) => k.call(COMPARE, a, b), "tree compare"),
    show: def("tree show", ["tree"], (t) => k.call(SHOW_ANY, k.call(mapMeaning, t))),
  };

  // ---- Map as a hash table changed in place (C63b, IN-PLACE.md step 2):
  // std.ts's Table, a JS Map. Only for a program where every map has one
  // holder (one-holder.ts), so nobody sees the version a put changed, and
  // only on JavaScript (library-reps.ts says where). Its entries come out
  // in compare's order, so its meaning is the same sorted Map.
  const T = TABLE_OPS;
  const tableEntries = def("table entries of", ["table"], (t) => k.call(T.entries, t));
  const putAllT = (ps: Id, t0: Id) => k.fold(ps, [
    { variant: NIL, names: [], body: () => t0 },
    { variant: CONS, names: ["entry", "rest"], results: [null, "table"], body: ([e], [, t]) => pair(e, (key, v) => k.call(T.put, t!, key, v)) },
  ]);
  const tableMeaning = def("table meaning", ["table"], (t) => k.call(MAP_V, k.call(tableEntries, t)));
  const tableOf = (f: (a: Id, b: Id) => Id, name: string) => def(name, ["a", "b"], (a, b) => f(k.call(tableMeaning, a), k.call(tableMeaning, b)));
  const matchTable = def("match table", ["table", "map of"], (t, f) => k.call(f, k.call(tableEntries, t)));
  const emptyTable = k.def("empty table map");
  k.define(emptyTable, k.call(T.empty));
  defs.push(emptyTable);
  const tableEnd = (name: string, last: boolean) => def(name, ["table"], (t) => k.match(last ? k.call(prelude("reverse"), k.call(tableEntries, t)) : k.call(tableEntries, t), [
    { variant: NIL, names: [], body: () => k.call(S.fail) },
    { variant: CONS, names: ["entry", "rest"], body: ([e]) => pair(e, (key) => key) },
  ]));
  const tableImpl: Record<Id, Id> = {
    [MAP_V]: def("table of entries", ["entries"], (es) => putAllT(es, k.call(T.empty))),
    match: matchTable,
    fold: matchTable,
    [prelude("empty map")]: emptyTable,
    [prelude("as map")]: def("table as map", ["pairs"], (ps) => putAllT(k.call(prelude("reverse"), ps), k.call(T.empty))),
    [prelude("put")]: def("table put map", ["table", "key", "value"], (t, key, v) => k.call(T.put, t, key, v)),
    // The value is read before the table is changed.
    [prelude("update at")]: def("table update at", ["table", "key", "default", "change"], (t, key, d, f) =>
      k.let("now", k.call(S.first, k.thunk(() => k.call(T.at, t, key)), k.thunk(() => d)), (now) => k.call(T.put, t, key, k.call(f, now)))),
    [prelude("value at")]: def("table value at map", ["table", "key"], (t, key) => k.call(T.at, t, key)),
    [prelude("remove key")]: def("table remove key", ["table", "key"], (t, key) => k.call(T.remove, t, key)),
    [prelude("has key")]: def("table has key", ["table", "key"], (t, key) => k.call(T.has, t, key)),
    [prelude("merge maps")]: def("table merge", ["first", "second"], (a, b) => putAllT(k.call(prelude("reverse"), k.call(tableEntries, b)), a)),
    [prelude("keys of")]: def("table keys", ["table"], (t) => k.call(T.keys, t)),
    [prelude("values of")]: def("table values", ["table"], (t) => k.call(prelude("map"), k.call(tableEntries, t), k.fn(["entry"], (e) => pair(e, (_, v) => v)))),
    [prelude("entries of")]: tableEntries,
    [prelude("map size")]: def("table size of", ["table"], (t) => k.call(T.size, t)),
    [prelude("smallest key")]: tableEnd("table smallest key", false),
    [prelude("largest key")]: tableEnd("table largest key", true),
  };
  const tableByType = {
    equal: tableOf((a, b) => k.call(S.equal, a, b), "table equal"),
    compare: tableOf((a, b) => k.call(COMPARE, a, b), "table compare"),
    show: def("table show", ["table"], (t) => k.call(SHOW_ANY, k.call(tableMeaning, t))),
  };

  // ---- Set
  const s = tree("Set tree", false);
  const addAll = (xs: Id, t0: Id) => k.fold(xs, [
    { variant: NIL, names: [], body: () => t0 },
    { variant: CONS, names: ["item", "rest"], results: [null, "tree"], body: ([x], [, t]) => k.call(s.insert, t!, x) },
  ]);
  const setMeaning = def("set tree meaning", ["tree"], (t) => k.call(SET_V, k.call(s.list, t)));
  // The items of a's list that `keep` says, as a tree again.
  const filtered = (name: string, keep: (inB: Id) => Id) => def(name, ["a", "b"], (a, b) => addAll(k.call(prelude("keep"), k.call(s.list, a), k.fn(["item"], (x) => keep(k.call(s.has, b, x)))), k.x(s.tip)));
  const setOf = (f: (a: Id, b: Id) => Id, name: string) => def(name, ["a", "b"], (a, b) => f(k.call(setMeaning, a), k.call(setMeaning, b)));
  const matchSet = def("match set tree", ["tree", "set of"], (t, f) => k.call(f, k.call(s.list, t)));
  // Items added to a tree, written as its own definition so a page's view
  // run again over a list a card was pushed onto adds only the new items
  // to what it gave before (compiler/src/memo-calls.ts addedMemoFuncs,
  // C354): the same set whichever order they go in.
  const addedAll = def("set tree added all", ["items", "tree"], (xs, t) => addAll(xs, t));
  const ofItems = def("set tree of items", ["items"], (xs) => k.call(addedAll, xs, k.x(s.tip)));
  const setImpl: Record<Id, Id> = {
    [SET_V]: ofItems,
    match: matchSet,
    fold: matchSet,
    [prelude("empty set")]: s.emptyTree,
    [prelude("as set")]: ofItems,
    [prelude("add item")]: s.insert,
    [prelude("remove item")]: s.remove,
    [prelude("has item")]: s.has,
    [prelude("set union")]: def("set tree union", ["a", "b"], (a, b) => addAll(k.call(s.list, b), a)),
    [prelude("set intersection")]: filtered("set tree intersection", (inB) => inB),
    [prelude("set difference")]: filtered("set tree difference", (inB) => k.call(S.not, inB)),
    [prelude("items of")]: s.list,
    [prelude("set size")]: s.size,
    [prelude("smallest item")]: s.first,
    [prelude("largest item")]: s.last,
  };
  const setHeads = { [prelude("items of")]: s.head("set tree head", (x) => x) };
  const setByType = {
    equal: setOf((a, b) => k.call(S.equal, a, b), "set tree equal"),
    compare: setOf((a, b) => k.call(COMPARE, a, b), "set tree compare"),
    show: def("set tree show", ["tree"], (t) => k.call(SHOW_ANY, k.call(setMeaning, t))),
  };

  // ---- Set as a hash table changed in place (C63d): as Map's, the keys
  // of std.ts's Table alone. Union adds b's items to a, which only a's one
  // holder sees; intersection and difference make a new one.
  const H = HASH_SET_OPS;
  const hItems = def("hash set items of", ["set"], (t) => k.call(H.items, t));
  const addAllH = (xs: Id, t0: Id) => k.fold(xs, [
    { variant: NIL, names: [], body: () => t0 },
    { variant: CONS, names: ["item", "rest"], results: [null, "set"], body: ([x], [, t]) => k.call(H.add, t!, x) },
  ]);
  const hMeaning = def("hash set meaning", ["set"], (t) => k.call(SET_V, k.call(hItems, t)));
  const hOf = (f: (a: Id, b: Id) => Id, name: string) => def(name, ["a", "b"], (a, b) => f(k.call(hMeaning, a), k.call(hMeaning, b)));
  const hFiltered = (name: string, keep: (inB: Id) => Id) => def(name, ["a", "b"], (a, b) => addAllH(k.call(prelude("keep"), k.call(hItems, a), k.fn(["item"], (x) => keep(k.call(H.has, b, x)))), k.call(H.empty)));
  const matchH = def("match hash set", ["set", "set of"], (t, f) => k.call(f, k.call(hItems, t)));
  const emptyH = k.def("empty hash set");
  k.define(emptyH, k.call(H.empty));
  defs.push(emptyH);
  const hOfItems = def("hash set of items", ["items"], (xs) => addAllH(xs, k.call(H.empty)));
  const hEnd = (name: string, last: boolean) => def(name, ["set"], (t) => k.match(last ? k.call(prelude("reverse"), k.call(hItems, t)) : k.call(hItems, t), [
    { variant: NIL, names: [], body: () => k.call(S.fail) },
    { variant: CONS, names: ["item", "rest"], body: ([x]) => x },
  ]));
  const hImpl: Record<Id, Id> = {
    [SET_V]: hOfItems,
    match: matchH,
    fold: matchH,
    [prelude("empty set")]: emptyH,
    [prelude("as set")]: hOfItems,
    [prelude("add item")]: def("hash set add item", ["set", "item"], (t, x) => k.call(H.add, t, x)),
    [prelude("remove item")]: def("hash set remove item", ["set", "item"], (t, x) => k.call(H.remove, t, x)),
    [prelude("has item")]: def("hash set has item", ["set", "item"], (t, x) => k.call(H.has, t, x)),
    [prelude("set union")]: def("hash set union", ["a", "b"], (a, b) => addAllH(k.call(hItems, b), a)),
    [prelude("set intersection")]: hFiltered("hash set intersection", (inB) => inB),
    [prelude("set difference")]: hFiltered("hash set difference", (inB) => k.call(S.not, inB)),
    [prelude("items of")]: hItems,
    [prelude("set size")]: def("hash set size of", ["set"], (t) => k.call(H.size, t)),
    [prelude("smallest item")]: hEnd("hash set smallest item", false),
    [prelude("largest item")]: hEnd("hash set largest item", true),
  };
  const hByType = {
    equal: hOf((a, b) => k.call(S.equal, a, b), "hash set equal"),
    compare: hOf((a, b) => k.call(COMPARE, a, b), "hash set compare"),
    show: def("hash set show", ["set"], (t) => k.call(SHOW_ANY, k.call(hMeaning, t))),
  };

  // ---- Pool (L280f, POOL-CHOICE-2026-11-23.md): its items in slots, a
  // free list of slots, and each slot the number of the item it holds, so
  // a key is the item's number and its slot (`slotted key`), and finds the
  // item in one step. The number plays a generation's part: a key whose
  // slot holds another number finds nothing. Its meaning drops the slot,
  // which is only a hint: a key whose slot doesn't hold its number (one
  // made from a number alone) is looked for along the order.
  //
  // The lists hold the newest slot first, so a new slot is a push at the
  // front and slot i is at position slots - 1 - i: as arrays, each add,
  // read and change is one step. `order` and `numbers in order` are the
  // slots and numbers of the items in the order they were added, newest
  // first, so the keys and items come out in number order, the meaning's;
  // a removed item stays in them (`stale`) until there are more of those
  // than items, when they are dropped.
  const K = k.type("Slotted key", [], [["slotted key", [["number", () => k.tref(INT)], ["slot", () => k.tref(INT)]]]]);
  defs.push(K.def);
  const SK = (n: Id, slot: Id) => k.call(K.v["slotted key"], n, slot);
  const skOf = (key: Id, f: (n: Id, slot: Id) => Id) => k.match(key, [{ variant: K.v["slotted key"], names: ["number", "slot"], body: ([n, slot]) => f(n, slot) }]);
  const ints = () => k.tref(LIST, k.tref(INT));
  const P = k.type("Pool slots", ["a"], [["slots", [
    ["items", (_, [a]) => k.tref(LIST, k.tref(OPTIONAL, k.tref(a)))], ["numbers", ints], ["free", ints], ["size", () => k.tref(INT)], ["slots", () => k.tref(INT)],
    ["next", () => k.tref(INT)], ["order", () => k.tref(LIST, k.tref(K.def))], ["stale", () => k.tref(INT)],
  ]]]);
  defs.push(P.def);
  type Eight = [Id, Id, Id, Id, Id, Id, Id, Id];
  const S8 = (...xs: Eight) => k.call(P.v.slots, ...xs);
  const slotsOf = (p: Id, f: (...xs: Eight) => Id) => k.match(p, [{ variant: P.v.slots, names: ["items", "numbers", "free", "size", "slots", "next", "order", "stale"], body: (xs) => f(...(xs as Eight)) }]);
  const sub1 = (n: Id) => k.call(INT_OPS.sub, n, k.int(1)), add1 = (n: Id) => i.add(n, k.int(1));
  const placeOf = (slots: Id, slot: Id) => sub1(k.call(INT_OPS.sub, slots, slot));
  const itemAt = (xs: Id, at: Id, d: Id) => k.call(prelude("item at"), xs, at, d), replaceAt = (xs: Id, at: Id, x: Id) => k.call(prelude("replace at"), xs, at, x);
  const some = (o: Id, yes: (x: Id) => Id, no: () => Id) => k.match(o, [{ variant: NONE, names: [], body: no }, { variant: SOME, names: ["item"], body: ([x]) => yes(x) }]);
  const emptySlots = k.def("empty pool slots");
  k.define(emptySlots, S8(k.x(NIL), k.x(NIL), k.x(NIL), k.int(0), k.int(0), k.int(0), k.x(NIL), k.int(0)));
  defs.push(emptySlots);
  // Whether slot holds the item numbered n.
  // A removed item's slot holds the number -1, which no item has.
  const holds = def("pool slots holds", ["pool", "slot", "number"], (p, slot, n) => slotsOf(p, (_items, nums, _f, _n, slots) =>
    k.if(i.less(slot, k.int(0)), k.x(FALSE), k.if(i.less(slot, slots), k.equal(itemAt(nums, placeOf(slots, slot), k.int(-1)), n), k.x(FALSE)))));
  // The slot numbered n was put in, found in the order by halves: the
  // order is newest first, so its numbers fall. -1 when none was.
  // Only a key whose slot doesn't hold its item looks: one made from a
  // number, or one of another pool's, or one whose item was removed.
  const halves = rec("pool slots halves");
  k.define(halves, k.fn(["order", "number", "from", "to"], (os, n, lo, hi) => k.if(i.less(lo, hi),
    k.let("middle", k.call(INT_OPS.shiftDown, i.add(lo, hi), k.int(1)), (mid) => skOf(itemAt(os, mid, SK(k.int(-1), k.int(-1))), (m, slot) =>
      k.if(k.equal(m, n), slot, k.if(i.less(n, m), k.call(halves, os, n, add1(mid), hi), k.call(halves, os, n, lo, mid))))),
    k.int(-1))));
  const along = def("pool slots along", ["order", "number"], (os, n) => k.call(halves, os, n, k.int(0), k.call(prelude("length"), os)));
  // A key's slot while it holds the key's item, else -1.
  const slotOf = def("pool slots slot of", ["pool", "key"], (p, key) => skOf(key, (n, hint) => k.if(k.call(holds, p, hint, n), hint,
    slotsOf(p, (_i, _n, _f, _s, _sl, _nx, os) => k.let("found", k.call(along, os, n), (at) => k.if(k.call(holds, p, at, n), at, k.int(-1)))))));
  // The item numbered n put in, in a free slot when there is one.
  const putS = def("pool slots put", ["pool", "number", "item"], (p, n, x) => slotsOf(p, (items, nums, free, size, slots, _next, os, stale) => k.match(free, [
    { variant: NIL, names: [], body: () => S8(k.call(CONS, k.call(SOME, x), items), k.call(CONS, n, nums), k.x(NIL), add1(size), add1(slots), add1(n), k.call(CONS, SK(n, slots), os), stale) },
    { variant: CONS, names: ["slot", "rest"], body: ([slot, rest]) => S8(replaceAt(items, placeOf(slots, slot), k.call(SOME, x)), replaceAt(nums, placeOf(slots, slot), n), rest, add1(size), slots, add1(n), k.call(CONS, SK(n, slot), os), stale) },
  ])));
  const nextKeyS = def("pool slots next key", ["pool"], (p) => slotsOf(p, (_i, _n, free, _s, slots, next) => SK(next, k.match(free, [
    { variant: NIL, names: [], body: () => slots },
    { variant: CONS, names: ["slot", "rest"], body: ([slot]) => slot },
  ]))));
  const addedS = def("pool slots added", ["pool", "item"], (p, x) => slotsOf(p, (_i, _n, _f, _s, _sl, next) => k.call(putS, p, next, x)));
  const itemS = def("pool slots item", ["pool", "key"], (p, key) => k.let("slot", k.call(slotOf, p, key), (slot) => k.if(i.less(slot, k.int(0)), k.call(S.fail),
    slotsOf(p, (items, _n, _f, _s, slots) => some(itemAt(items, placeOf(slots, slot), k.x(NONE)), (x) => x, () => k.call(S.fail))))));
  const replacedS = def("pool slots replaced", ["pool", "key", "item"], (p, key, x) => k.let("slot", k.call(slotOf, p, key), (slot) => k.if(i.less(slot, k.int(0)), p,
    slotsOf(p, (items, nums, free, size, slots, next, os, stale) => S8(replaceAt(items, placeOf(slots, slot), k.call(SOME, x)), nums, free, size, slots, next, os, stale)))));
  // The order without its removed items, once they outnumber the rest.
  const keptOrder = rec("pool slots kept order");
  k.define(keptOrder, k.fn(["pool", "order"], (p, os) => k.match(os, [
    { variant: NIL, names: [], body: () => k.x(NIL) },
    { variant: CONS, names: ["key", "rest"], body: ([key, rest]) => k.let("kept", k.call(keptOrder, p, rest), (ks) =>
      skOf(key, (n, slot) => k.if(k.call(holds, p, slot, n), k.call(CONS, key, ks), ks))) },
  ])));
  const compacted = def("pool slots compacted", ["pool"], (p) => slotsOf(p, (items, nums, free, size, slots, next, os, stale) => k.if(i.less(size, stale),
    S8(items, nums, free, size, slots, next, k.call(keptOrder, p, os), k.int(0)), p)));
  const removedS = def("pool slots removed", ["pool", "key"], (p, key) => k.let("slot", k.call(slotOf, p, key), (slot) => k.if(i.less(slot, k.int(0)), p,
    slotsOf(p, (items, nums, free, size, slots, next, os, stale) => k.call(compacted, S8(replaceAt(items, placeOf(slots, slot), k.x(NONE)), replaceAt(nums, placeOf(slots, slot), k.int(-1)), k.call(CONS, slot, free), sub1(size), slots, next, os, add1(stale)))))));
  const sizeS = def("pool slots size", ["pool"], (p) => slotsOf(p, (_i, _n, _f, size) => size));
  // Walked newest first, each item still there put in front of those
  // after it: oldest first. Each slot in the order is one the pool has
  // made, so its item is there if its number is still the one put in it.
  const walked = (name: string, each: (slot: Id, n: Id, x: Id) => Id) => {
    const w = rec(`${name} from`);
    // Each way on a call of its own, as a list's walk is written, which
    // an array's runs from its far end pushing (cons-loops.ts).
    k.define(w, k.fn(["items", "numbers", "slots", "order", "after"], (items, nums, slots, os, after) => k.match(os, [
      { variant: NIL, names: [], body: () => after },
      { variant: CONS, names: ["key", "rest"], body: ([key, rest]) => skOf(key, (n, slot) => k.let("place", placeOf(slots, slot), (at) => {
        const on = (next: Id) => k.call(w, items, nums, slots, rest, next);
        return k.if(k.equal(itemAt(nums, at, k.int(-1)), n), some(itemAt(items, at, k.x(NONE)), (x) => on(k.call(CONS, each(slot, n, x), after)), () => on(after)), on(after));
      })) },
    ])));
    return def(name, ["pool"], (p) => slotsOf(p, (items, nums, _f, _s, slots, _nx, os) => k.call(w, items, nums, slots, os, k.x(NIL))));
  };
  const keysS = walked("pool slots keys", (slot, n) => SK(n, slot));
  const itemsS = walked("pool slots items", (_slot, _n, x) => x);
  const pairsS = walked("pool slots pairs", (_slot, n, x) => k.call(PAIR_V, n, x));
  const keyedS = walked("pool slots keyed items", (slot, n, x) => k.call(PAIR_V, SK(n, slot), x));
  const updatedS = def("pool slots updated", ["pool", "f"], (p, f) => slotsOf(p, (items, nums, free, size, slots, next, os, stale) =>
    S8(k.call(prelude("map"), items, k.fn(["slot"], (o) => some(o, (x) => k.call(SOME, k.call(f, x)), () => k.x(NONE)))), nums, free, size, slots, next, os, stale)));
  const keptFrom = rec("pool slots kept from");
  k.define(keptFrom, k.fn(["keyed", "test", "pool"], (ks, test, p) => k.match(ks, [
    { variant: NIL, names: [], body: () => p },
    { variant: CONS, names: ["keyed", "rest"], body: ([e, rest]) => pair(e, (key, x) => k.call(keptFrom, rest, test, k.if(k.call(test, x), p, k.call(removedS, p, key))), ["key", "item"]) },
  ])));
  const keptS = def("pool slots kept", ["pool", "test"], (p, test) => k.call(keptFrom, k.call(keyedS, p), test, p));
  const slotsMeaning = def("pool slots meaning", ["pool"], (p) => slotsOf(p, (_i, _n, _f, _s, _sl, next) => k.call(POOL_V, k.call(prelude("as map"), k.call(pairsS, p)), next)));
  // Its items put in by number, then its next number.
  const putEntries = rec("pool slots put entries");
  k.define(putEntries, k.fn(["entries", "pool"], (es, p) => k.match(es, [
    { variant: NIL, names: [], body: () => p },
    { variant: CONS, names: ["entry", "rest"], body: ([e, rest]) => pair(e, (n, x) => k.call(putEntries, rest, k.call(putS, p, n, x)), ["number", "item"]) },
  ])));
  const slotsOfEntries = def("pool slots of entries", ["entries", "next"], (m, next) => slotsOf(k.call(putEntries, k.call(prelude("entries of"), m), k.x(emptySlots)),
    (items, nums, free, size, slots, _nx, os, stale) => S8(items, nums, free, size, slots, next, os, stale)));
  const matchSlots = def("match pool slots", ["pool", "pool of"], (p, f) => k.match(k.call(slotsMeaning, p), [{ variant: POOL_V, names: ["entries", "next"], body: ([es, next]) => k.call(f, es, next) }]));
  // The jobs told which shapes they touch (prelude `updated in pool
  // shaped` and the rest, G4): slots hold every shape together, so each
  // walks them all and asks each item's shape.
  // A shape is a prelude `Pool shape`: a record holding the function.
  const nodeAt = (id: Id) => k.code.nodes[id] ?? (k as unknown as { known: Code }).known.nodes[id];
  const PSd = prelude("Pool shape"), PSv = (nodeAt((nodeAt(PSd) as { body: Id }).body) as { variants: Id[] }).variants[0];
  const shapeOfItem = (ps: Id, x: Id) => k.match(ps, [{ variant: PSv, names: ["of"], body: ([f]) => k.call(f, x) }]);
  const inShapes = (shapes: Id, shape: Id, x: Id) => k.call(prelude("contains"), shapes, shapeOfItem(shape, x));
  const itemsShapedS = def("pool slots items shaped", ["pool", "shape", "shapes"], (p, shape, shapes) => k.call(prelude("keep"), k.call(itemsS, p), k.fn(["item"], (x) => inShapes(shapes, shape, x))));
  const updatedShapedS = def("pool slots updated shaped", ["pool", "shape", "shapes", "f"], (p, shape, shapes, f) => k.call(updatedS, p, k.fn(["item"], (x) => k.if(inShapes(shapes, shape, x), k.call(f, x), x))));
  const keptShapedS = def("pool slots kept shaped", ["pool", "shape", "shapes", "test"], (p, shape, shapes, test) => k.call(keptS, p, k.fn(["item"], (x) => k.if(inShapes(shapes, shape, x), k.call(test, x), k.x(TRUE)))));
  const emptyShapedS = def("empty pool slots shaped", ["shape"], () => k.x(emptySlots));
  const slotsImpl: Record<Id, Id> = {
    [POOL_V]: slotsOfEntries,
    match: matchSlots,
    fold: matchSlots,
    [prelude("empty pool")]: emptySlots,
    [prelude("next key")]: nextKeyS,
    [prelude("added to pool")]: addedS,
    [prelude("pool item")]: itemS,
    [prelude("replaced in pool")]: replacedS,
    [prelude("removed from pool")]: removedS,
    [prelude("pool size")]: sizeS,
    [prelude("pool keys")]: keysS,
    [prelude("pool items")]: itemsS,
    [prelude("updated in pool")]: updatedS,
    [prelude("kept in pool")]: keptS,
    [prelude("empty pool shaped")]: emptyShapedS,
    [prelude("pool items shaped")]: itemsShapedS,
    [prelude("updated in pool shaped")]: updatedShapedS,
    [prelude("updated in pool keeping shapes")]: updatedShapedS,
    [prelude("kept in pool shaped")]: keptShapedS,
  };
  const slotsBy = (f: (a: Id, b: Id) => Id, name: string) => def(name, ["a", "b"], (a, b) => f(k.call(slotsMeaning, a), k.call(slotsMeaning, b)));
  const slotsByType = {
    equal: slotsBy((a, b) => k.call(S.equal, a, b), "pool slots equal"),
    compare: slotsBy((a, b) => k.call(COMPARE, a, b), "pool slots compare"),
    show: def("pool slots show", ["pool"], (p) => k.call(SHOW_ANY, k.call(slotsMeaning, p))),
  };
  // A slotted key means its number.
  const keyMeaning = def("slotted key meaning", ["key"], (key) => skOf(key, (n) => k.call(POOL_KEY_V, n)));
  const keyBy = (f: (a: Id, b: Id) => Id, name: string) => def(name, ["a", "b"], (a, b) => f(k.call(keyMeaning, a), k.call(keyMeaning, b)));
  const keyImpl: Record<Id, Id> = {
    [POOL_KEY_V]: def("slotted key of number", ["number"], (n) => SK(n, k.int(-1))),
    match: def("match slotted key", ["key", "pool key of"], (key, f) => skOf(key, (n) => k.call(f, n))),
  };
  keyImpl.fold = keyImpl.match;
  const keyByType = {
    equal: keyBy((a, b) => k.call(S.equal, a, b), "slotted key equal"),
    compare: keyBy((a, b) => k.call(COMPARE, a, b), "slotted key compare"),
    show: def("slotted key show", ["key"], (key) => k.call(SHOW_ANY, k.call(keyMeaning, key))),
  };

  // ---- Pool as a table per shape (G4, ENTITIES.md "Archetype tables";
  // Unity DOTS, flecs, Bevy): the items grouped by their shape (which of
  // their Optional parts they have, as the pool's `shape` gives it), each
  // group in slots of its own, so a job told which shapes it touches
  // (`updated in pool shaped`) walks those tables and leaves the others
  // as they are. Numbers are given out across the tables, so a key is
  // still its number and a slot, the slot in whichever table holds it
  // (each is asked in turn; numbers are never given twice, so only one
  // can hold it). With no `shape` (a pool made without one, or after an
  // update that may have changed its items' type) the grouping is
  // anything; a job given a shape groups such a pool by it first. An
  // item whose shape an update changes moves to its own table afterwards,
  // kept in number order there.
  // Its keys are the slots' (number, slot), a type of their own so the
  // two rows differ (chosen with the pool by name, together.ts).
  const K2 = k.type("Table key", [], [["table key", [["number", () => k.tref(INT)], ["slot", () => k.tref(INT)]]]], "pool table key");
  defs.push(K2.def);
  const TK = (n: Id, slot: Id) => k.call(K2.v["table key"], n, slot);
  const tkOf = (key: Id, f: (n: Id, slot: Id) => Id) => k.match(key, [{ variant: K2.v["table key"], names: ["number", "slot"], body: ([n, slot]) => f(n, slot) }]);
  const slotted = (key: Id) => tkOf(key, (n, slot) => SK(n, slot));
  const TB = k.type("Pool table", ["a"], [["table", [["shape", () => k.tref(INT)], ["slots", (_, [a]) => k.tref(P.def, k.tref(a))]]]]);
  defs.push(TB.def);
  const PT = k.type("Pool tables", ["a"], [["tables", [
    ["shape", (_, [a]) => k.tref(OPTIONAL, k.tref(PSd, k.tref(a)))], ["tables", (_, [a]) => k.tref(LIST, k.tref(TB.def, k.tref(a)))],
    ["next", () => k.tref(INT)], ["size", () => k.tref(INT)],
  ]]]);
  defs.push(PT.def);
  const TS = (shape: Id, ts: Id, next: Id, size: Id) => k.call(PT.v.tables, shape, ts, next, size);
  const tablesOf = (p: Id, f: (shape: Id, ts: Id, next: Id, size: Id) => Id) => k.match(p, [{ variant: PT.v.tables, names: ["shape", "tables", "next", "size"], body: ([a, b, c, d]) => f(a, b, c, d) }]);
  const poolTableOf = (t: Id, f: (s: Id, sl: Id) => Id) => k.match(t, [{ variant: TB.v.table, names: ["shape", "slots"], body: ([s, sl]) => f(s, sl) }]);
  const TBL = (s: Id, sl: Id) => k.call(TB.v.table, s, sl);
  const each = (name: string, params: string[], onTable: (s: Id, sl: Id, rest: Id, again: (rest: Id) => Id, ps: Id[]) => Id, atEnd: (ps: Id[]) => Id) => {
    const d = rec(name);
    k.define(d, k.fn(["tables", ...params], (ts, ...ps) => k.match(ts, [
      { variant: NIL, names: [], body: () => atEnd(ps) },
      { variant: CONS, names: ["table", "rest"], body: ([t, rest]) => poolTableOf(t, (s, sl) => onTable(s, sl, rest, (r) => k.call(d, r, ...ps), ps)) },
    ])));
    return d;
  };
  const shapeIn = (shape: Id, x: Id) => some(shape, (ps) => shapeOfItem(ps, x), () => k.int(0));
  // The slots of the table of shape s, empty when there is none.
  const slotsAt = each("pool tables slots at", ["shape"], (s, sl, _r, again, [want]) => k.if(k.equal(s, want), sl, again(_r)), () => k.x(emptySlots));
  // The tables with the table of shape s changed by `change` (made from
  // empty slots when there is none), in the one walk, so the slots are
  // taken out of the table they were in and changed in place.
  const changedAt = (name: string, params: string[], change: (sl: Id, ps: Id[]) => Id) => each(name, ["shape", ...params], (s, sl, rest, again, [want, ...ps]) =>
    k.if(k.equal(s, want), k.call(CONS, TBL(s, change(sl, ps)), rest), k.call(CONS, TBL(s, sl), again(rest))), ([want, ...ps]) => k.call(CONS, TBL(want, change(k.x(emptySlots), ps)), k.x(NIL)));
  // The shape of the table whose slot holds number n (the key's slot asked
  // of each table first, then each table's order), or -1.
  const hinted = each("pool tables hinted", ["number", "slot"], (s, sl, rest, again, [n, slot]) => k.if(k.call(holds, sl, slot, n), s, again(rest)), () => k.int(-1));
  const along2 = each("pool tables along", ["key"], (s, sl, rest, again, [key]) => k.if(i.less(k.call(slotOf, sl, key), k.int(0)), again(rest), s), () => k.int(-1));
  const holding = def("pool tables holding", ["tables", "key"], (ts, key) => skOf(key, (n, slot) => k.let("hinted", k.call(hinted, ts, n, slot), (h) => k.if(i.less(h, k.int(0)), k.call(along2, ts, key), h))));
  const sizes = each("pool tables sizes", [], (_s, sl, rest, again) => i.add(k.call(sizeS, sl), again(rest)), () => k.int(0));
  // Two lists of (key, item) in number order, merged in number order.
  const numberOfKey = (key: Id) => skOf(key, (n) => n);
  const merged = rec("pool tables merged");
  k.define(merged, k.fn(["a", "b"], (a, b) => k.match(a, [
    { variant: NIL, names: [], body: () => b },
    { variant: CONS, names: ["x", "xs"], body: ([x, xs]) => k.match(b, [
      { variant: NIL, names: [], body: () => a },
      { variant: CONS, names: ["y", "ys"], body: ([y, ys]) => pair(x, (kx) => pair(y, (ky) => k.if(i.less(numberOfKey(kx), numberOfKey(ky)), k.call(CONS, x, k.call(merged, xs, b)), k.call(CONS, y, k.call(merged, a, ys))), ["key2", "item2"]), ["key1", "item1"]) },
    ]) },
  ])));
  // Every table's (key, item)s in number order; only shapes in `shapes`
  // with `only`.
  const keyedAll = each("pool tables keyed", [], (_s, sl, rest, again) => k.call(merged, k.call(keyedS, sl), again(rest)), () => k.x(NIL));
  const keyedOnly = each("pool tables keyed only", ["shapes"], (s, sl, rest, again, [shapes]) => k.if(k.call(prelude("contains"), shapes, s), k.call(merged, k.call(keyedS, sl), again(rest)), again(rest)), () => k.x(NIL));
  // The tables of these shapes.
  const onlyTables = each("pool tables only", ["shapes"], (s, sl, rest, again, [shapes]) => k.if(k.call(prelude("contains"), shapes, s), k.call(CONS, TBL(s, sl), again(rest)), again(rest)), () => k.x(NIL));
  const itemsOnly = def("pool tables items only", ["tables", "shapes"], (ts, shapes) => k.match(k.call(onlyTables, ts, shapes), [
    { variant: NIL, names: [], body: () => k.x(NIL) },
    { variant: CONS, names: ["table", "rest"], body: ([t, rest]) => k.match(rest, [
      // One table (the common case) is its own items, no merge.
      { variant: NIL, names: [], body: () => poolTableOf(t, (_s, sl) => k.call(itemsS, sl)) },
      { variant: CONS, names: ["next table", "others"], body: () => k.call(prelude("map"), k.call(keyedOnly, ts, shapes), k.fn(["keyed"], (e) => pair(e, (_kk, x) => x, ["k", "x"]))) },
    ]) },
  ]));
  const seconds = (xs: Id) => k.call(prelude("map"), xs, k.fn(["keyed"], (e) => pair(e, (_kk, x) => x, ["k", "x"])));
  const firsts = (xs: Id) => k.call(prelude("map"), xs, k.fn(["keyed"], (e) => pair(e, (kk) => kk, ["k", "x"])));
  // An item put in slots under number n where newer numbers are already
  // there: its key goes into the order after them, so the order stays
  // newest first.
  const intoOrder = rec("pool tables into order");
  k.define(intoOrder, k.fn(["order", "key"], (os, key) => k.match(os, [
    { variant: NIL, names: [], body: () => k.call(CONS, key, k.x(NIL)) },
    { variant: CONS, names: ["first", "rest"], body: ([o, rest]) => k.if(i.less(numberOfKey(key), numberOfKey(o)), k.call(CONS, o, k.call(intoOrder, rest, key)), k.call(CONS, key, os)) },
  ])));
  const putOrdered = def("pool tables put ordered", ["pool", "number", "item"], (sl, n, x) => slotsOf(k.call(putS, sl, n, x), (items, nums, free, size, slots, next, os, stale) =>
    k.match(os, [
      { variant: NIL, names: [], body: () => S8(items, nums, free, size, slots, next, os, stale) },
      { variant: CONS, names: ["newest", "older"], body: ([o, older]) => S8(items, nums, free, size, slots, next, k.call(intoOrder, older, o), stale) },
    ])));
  const putIn = changedAt("pool tables put in", ["number", "item"], (sl, [n, x]) => k.call(putS, sl, n, x));
  const putOrderedIn = changedAt("pool tables put ordered in", ["number", "item"], (sl, [n, x]) => k.call(putOrdered, sl, n, x));
  const removedIn = changedAt("pool tables removed in", ["key"], (sl, [key]) => k.call(removedS, sl, key));
  const replacedIn = changedAt("pool tables replaced in", ["key", "item"], (sl, [key, x]) => k.call(replacedS, sl, key, x));
  // (key, item)s put into the tables by their shape, each in number order.
  const filedIn = rec("pool tables filed");
  k.define(filedIn, k.fn(["keyed", "shape", "tables"], (es, shape, ts) => k.match(es, [
    { variant: NIL, names: [], body: () => ts },
    { variant: CONS, names: ["keyed", "rest"], body: ([e, rest]) => pair(e, (key, x) => k.let("shape of", shapeIn(shape, x), (s) =>
      k.call(filedIn, rest, shape, k.call(putOrderedIn, ts, s, numberOfKey(key), x))), ["key", "item"]) },
  ])));
  // The pool grouped by this shape, as a job given it needs: kept as it
  // is when it has a shape already (the compiler gives a type one).
  const grouped = def("pool tables grouped", ["pool", "shape"], (p, f) => tablesOf(p, (shape, ts, next, size) => some(shape, () => p,
    () => TS(k.call(SOME, f), k.call(filedIn, k.call(keyedAll, ts), k.call(SOME, f), k.x(NIL)), next, size))));
  const emptyT = k.def("empty pool tables");
  k.define(emptyT, TS(k.x(NONE), k.x(NIL), k.int(0), k.int(0)));
  defs.push(emptyT);
  const emptyShapedT = def("empty pool tables shaped", ["shape"], (f) => TS(k.call(SOME, f), k.x(NIL), k.int(0), k.int(0)));
  const nextKeyT = def("pool tables next key", ["pool"], (p) => tablesOf(p, (_s, _t, next) => TK(next, k.int(-1))));
  const addedT = def("pool tables added", ["pool", "item"], (p, x) => tablesOf(p, (shape, ts, next, size) => k.let("shape of", shapeIn(shape, x), (s) =>
    TS(shape, k.call(putIn, ts, s, next, x), add1(next), add1(size)))));
  const itemT = def("pool tables item", ["pool", "table key"], (p, key0) => k.let("key", slotted(key0), (key) => tablesOf(p, (_shape, ts) => k.let("held in", k.call(holding, ts, key), (h) =>
    k.if(i.less(h, k.int(0)), k.call(S.fail), k.call(itemS, k.call(slotsAt, ts, h), key))))));
  const removedT = def("pool tables removed", ["pool", "table key"], (p, key0) => k.let("key", slotted(key0), (key) => tablesOf(p, (shape, ts, next, size) => k.let("held in", k.call(holding, ts, key), (h) =>
    k.if(i.less(h, k.int(0)), p, TS(shape, k.call(removedIn, ts, h, key), next, sub1(size)))))));
  const replacedT = def("pool tables replaced", ["pool", "table key", "item"], (p, key0, x) => k.let("key", slotted(key0), (key) => tablesOf(p, (shape, ts, next, size) => k.let("held in", k.call(holding, ts, key), (h) =>
    k.if(i.less(h, k.int(0)), p, k.let("shape of", shapeIn(shape, x), (s) => k.if(k.equal(s, h),
      TS(shape, k.call(replacedIn, ts, h, key, x), next, size),
      TS(shape, k.call(putOrderedIn, k.call(removedIn, ts, h, key), s, numberOfKey(key), x), next, size))))))));
  const sizeT = def("pool tables size", ["pool"], (p) => tablesOf(p, (_s, _t, _n, size) => size));
  const keysT = def("pool tables keys", ["pool"], (p) => tablesOf(p, (_s, ts) => k.call(prelude("map"), firsts(k.call(keyedAll, ts)), k.fn(["key"], (kk) => skOf(kk, (n, slot) => TK(n, slot))))));
  const itemsT = def("pool tables items", ["pool"], (p) => tablesOf(p, (_s, ts) => k.match(ts, [
    { variant: NIL, names: [], body: () => k.x(NIL) },
    { variant: CONS, names: ["table", "rest"], body: ([t, rest]) => k.match(rest, [
      { variant: NIL, names: [], body: () => poolTableOf(t, (_s2, sl) => k.call(itemsS, sl)) },
      { variant: CONS, names: ["next table", "others"], body: () => seconds(k.call(keyedAll, ts)) },
    ]) },
  ])));
  // f may give another type, so the result has no shape: its grouping is
  // the old one, which a job given a shape groups again.
  const updatedEach = each("pool tables updated each", ["f"], (s, sl, rest, again, [f]) => k.call(CONS, TBL(s, k.call(updatedS, sl, f)), again(rest)), () => k.x(NIL));
  const updatedT = def("pool tables updated", ["pool", "f"], (p, f) => tablesOf(p, (_shape, ts, next, size) => TS(k.x(NONE), k.call(updatedEach, ts, f), next, size)));
  const keptEach = each("pool tables kept each", ["test", "shapes"], (s, sl, rest, again, [test, shapes]) =>
    k.call(CONS, TBL(s, k.if(k.call(prelude("contains"), shapes, s), k.call(keptS, sl, test), sl)), again(rest)), () => k.x(NIL));
  const keptAll = each("pool tables kept all", ["test"], (s, sl, rest, again, [test]) => k.call(CONS, TBL(s, k.call(keptS, sl, test)), again(rest)), () => k.x(NIL));
  const keptT = def("pool tables kept", ["pool", "test"], (p, test) => tablesOf(p, (shape, ts, next) => k.let("kept tables", k.call(keptAll, ts, test), (kt) =>
    TS(shape, kt, next, k.call(sizes, kt)))));
  // The items of these shapes changed by f. An item f gives another shape
  // is moved to its table after (`strays`: whether a table has any).
  const strays = rec("pool tables strays");
  k.define(strays, k.fn(["items", "shape", "of shape"], (xs, f, s) => k.match(xs, [
    { variant: NIL, names: [], body: () => k.x(FALSE) },
    { variant: CONS, names: ["slot", "rest"], body: ([o, rest]) => some(o, (x) => k.if(k.equal(shapeIn(f, x), s), k.call(strays, rest, f, s), k.x(TRUE)), () => k.call(strays, rest, f, s)) },
  ])));
  const strayed = rec("pool tables strayed");
  // The (key, item)s of a table not of its shape, and the slots without them.
  k.define(strayed, k.fn(["keyed", "shape", "of shape", "slots", "out"], (es, f, s, sl, out) => k.match(es, [
    { variant: NIL, names: [], body: () => k.call(PAIR_V, sl, out) },
    { variant: CONS, names: ["keyed", "rest"], body: ([e, rest]) => pair(e, (key, x) => k.if(k.equal(shapeIn(f, x), s), k.call(strayed, rest, f, s, sl, out),
      k.call(strayed, rest, f, s, k.call(removedS, sl, key), k.call(CONS, e, out))), ["key", "item"]) },
  ])));
  const updatedOnly = each("pool tables updated only", ["shapes", "f"], (s, sl, rest, again, [shapes, f]) =>
    k.call(CONS, TBL(s, k.if(k.call(prelude("contains"), shapes, s), k.call(updatedS, sl, f), sl)), again(rest)), () => k.x(NIL));
  // The touched tables without the items not of their shape, and those
  // items, (key, item) each.
  const unstrayed = rec("pool tables unstrayed");
  k.define(unstrayed, k.fn(["tables", "shape", "shapes", "done", "moved"], (ts, shape, shapes, done, moved) => k.match(ts, [
    { variant: NIL, names: [], body: () => k.call(PAIR_V, done, moved) },
    { variant: CONS, names: ["table", "rest"], body: ([t, rest]) => poolTableOf(t, (s, sl) => {
      const as = () => k.call(unstrayed, rest, shape, shapes, k.call(CONS, TBL(s, sl), done), moved);
      return k.if(k.call(prelude("contains"), shapes, s), k.if(slotsOf(sl, (items) => k.call(strays, items, shape, s)),
        pair(k.call(strayed, k.call(keyedS, sl), shape, s, sl, moved), (kept, out) => k.call(unstrayed, rest, shape, shapes, k.call(CONS, TBL(s, kept), done), out), ["kept", "moved"]),
        as()), as());
    }) },
  ])));
  const updatedShapedT = def("pool tables updated shaped", ["pool", "shape", "shapes", "f"], (p0, f0, shapes, f) => tablesOf(k.call(grouped, p0, f0), (shape, ts, next, size) =>
    pair(k.call(unstrayed, k.call(updatedOnly, ts, shapes, f), shape, shapes, k.x(NIL), k.x(NIL)), (ts2, moved) => TS(shape, k.call(filedIn, moved, shape, ts2), next, size), ["tables", "moved"])));
  const updatedAlikeT = def("pool tables updated keeping shapes", ["pool", "shape", "shapes", "f"], (p0, f0, shapes, f) => tablesOf(k.call(grouped, p0, f0), (shape, ts, next, size) =>
    TS(shape, k.call(updatedOnly, ts, shapes, f), next, size)));
  const keptShapedT = def("pool tables kept shaped", ["pool", "shape", "shapes", "test"], (p0, f0, shapes, test) => tablesOf(k.call(grouped, p0, f0), (shape, ts, next) =>
    k.let("kept tables", k.call(keptEach, ts, test, shapes), (kt) => TS(shape, kt, next, k.call(sizes, kt)))));
  const itemsShapedT = def("pool tables items shaped", ["pool", "shape", "shapes"], (p0, f0, shapes) => tablesOf(k.call(grouped, p0, f0), (_shape, ts) => k.call(itemsOnly, ts, shapes)));
  const tablesMeaning = def("pool tables meaning", ["pool"], (p) => tablesOf(p, (_s, ts, next) => k.call(POOL_V, k.call(prelude("as map"),
    k.call(prelude("map"), k.call(keyedAll, ts), k.fn(["keyed"], (e) => pair(e, (kk, x) => k.call(PAIR_V, numberOfKey(kk), x), ["k", "x"])))), next)));
  const tablesOfEntries = def("pool tables of entries", ["entries", "next"], (m, next) => TS(k.x(NONE), k.call(CONS, TBL(k.int(0), k.call(slotsOfEntries, m, next)), k.x(NIL)), next, k.call(prelude("map size"), m)));
  const matchTables = def("match pool tables", ["pool", "pool of"], (p, f) => k.match(k.call(tablesMeaning, p), [{ variant: POOL_V, names: ["entries", "next"], body: ([es, next]) => k.call(f, es, next) }]));
  const tablesImpl: Record<Id, Id> = {
    [POOL_V]: tablesOfEntries,
    match: matchTables,
    fold: matchTables,
    [prelude("empty pool")]: emptyT,
    [prelude("next key")]: nextKeyT,
    [prelude("added to pool")]: addedT,
    [prelude("pool item")]: itemT,
    [prelude("replaced in pool")]: replacedT,
    [prelude("removed from pool")]: removedT,
    [prelude("pool size")]: sizeT,
    [prelude("pool keys")]: keysT,
    [prelude("pool items")]: itemsT,
    [prelude("updated in pool")]: updatedT,
    [prelude("kept in pool")]: keptT,
    [prelude("empty pool shaped")]: emptyShapedT,
    [prelude("pool items shaped")]: itemsShapedT,
    [prelude("updated in pool shaped")]: updatedShapedT,
    [prelude("updated in pool keeping shapes")]: updatedAlikeT,
    [prelude("kept in pool shaped")]: keptShapedT,
  };
  const tablesBy = (f: (a: Id, b: Id) => Id, name: string) => def(name, ["a", "b"], (a, b) => f(k.call(tablesMeaning, a), k.call(tablesMeaning, b)));
  const tablesByType = {
    equal: tablesBy((a, b) => k.call(S.equal, a, b), "pool tables equal"),
    compare: tablesBy((a, b) => k.call(COMPARE, a, b), "pool tables compare"),
    show: def("pool tables show", ["pool"], (p) => k.call(SHOW_ANY, k.call(tablesMeaning, p))),
  };
  const key2Meaning = def("table key meaning", ["key"], (key) => tkOf(key, (n) => k.call(POOL_KEY_V, n)));
  const key2By = (f: (a: Id, b: Id) => Id, name: string) => def(name, ["a", "b"], (a, b) => f(k.call(key2Meaning, a), k.call(key2Meaning, b)));
  const key2Impl: Record<Id, Id> = {
    [POOL_KEY_V]: def("table key of number", ["number"], (n) => TK(n, k.int(-1))),
    match: def("match table key", ["key", "pool key of"], (key, f) => tkOf(key, (n) => k.call(f, n))),
  };
  key2Impl.fold = key2Impl.match;
  const key2ByType = {
    equal: key2By((a, b) => k.call(S.equal, a, b), "table key equal"),
    compare: key2By((a, b) => k.call(COMPARE, a, b), "table key compare"),
    show: def("table key show", ["key"], (key) => k.call(SHOW_ANY, k.call(key2Meaning, key))),
  };
  const shapedJobs = ["pool items shaped", "updated in pool shaped", "updated in pool keeping shapes", "kept in pool shaped"];
  const poolJobs = ["next key", "added to pool", "pool item", "replaced in pool", "removed from pool", "pool size", "pool keys", "pool items", "updated in pool", "kept in pool"];
  const job = (n: string) => (n === "match" || n === "fold" ? n : prelude(n));
  const at = (ns: string[], cost: string) => Object.fromEntries(ns.map((n) => [job(n), cost]));
  const mapLog = ["put", "update at", "value at", "remove key", "has key", "smallest key", "largest key"], mapLin = ["keys of", "values of", "entries of", "match", "fold"];
  const setLog = ["add item", "remove item", "has item", "smallest item", "largest item"], setLin = ["items of", "match", "fold"];
  // The definitions themselves: every job walks the sorted list.
  const spec = (of: Id, cons: Id, linear: string[], quadratic: string[], one: string[]): Representation => ({
    name: "sorted list", of, type: of, meaning: null, canonical: true, impl: {},
    cost: { ...at(linear, "n"), ...at(quadratic, "n²"), ...at(one, "1"), [cons]: "1", space: "n" },
  });
  const rows: Representation[] = [
    { name: "weight-balanced tree", of: MAP, type: m.T.def, meaning: mapMeaning, canonical: false, impl: mapImpl, byType: mapByType, heads: mapHeads,
      cost: { ...at(mapLog, "log n"), ...at(mapLin, "n"), ...at(["as map", "merge maps"], "n log n"), ...at(["empty map", "map size"], "1"), [MAP_V]: "n log n", space: "n" } },
    spec(MAP, MAP_V, [...mapLog, ...mapLin, "map size"], ["as map", "merge maps"], ["empty map"]),
    { name: "weight-balanced tree", of: SET_TYPE, type: s.T.def, meaning: setMeaning, canonical: false, impl: setImpl, byType: setByType, heads: setHeads,
      cost: { ...at(setLog, "log n"), ...at(setLin, "n"), ...at(["as set", "set union", "set intersection", "set difference"], "n log n"), ...at(["empty set", "set size"], "1"), [SET_V]: "n log n", space: "n" } },
    spec(SET_TYPE, SET_V, [...setLog, ...setLin, "set size", "set union", "set intersection", "set difference"], ["as set"], ["empty set"]),
    // After the four, so their rows keep their places in LIBRARY.reps.
    { name: "hash table", of: MAP, type: TABLE, meaning: tableMeaning, canonical: false, impl: tableImpl, byType: tableByType, oneHolder: true,
      cost: { ...at(["put", "update at", "value at", "remove key", "has key", "empty map", "map size"], "1"), ...at([...mapLin, "smallest key", "largest key", "as map", "merge maps"], "n log n"), [MAP_V]: "n", space: "n" } },
    { name: "hash table", of: SET_TYPE, type: HASH_SET, meaning: hMeaning, canonical: false, impl: hImpl, byType: hByType, oneHolder: true,
      cost: { ...at(["add item", "remove item", "has item", "empty set", "set size"], "1"), ...at(["set union", "as set"], "n"), ...at([...setLin, "smallest item", "largest item", "set intersection", "set difference"], "n log n"), [SET_V]: "n", space: "n" } },

    // After those, so their rows keep their places (L280f): the pool as
    // its meaning (a map and a counter) and in slots, and its key as a
    // number and as a number and a slot, chosen with the pool's slots.
    { name: "map and counter", of: POOL, type: POOL, meaning: null, canonical: true, impl: {},
      cost: { ...at(["next key", "pool size"], "1"), ...at(["added to pool", "pool item", "replaced in pool", "removed from pool"], "log n"), ...at(["pool keys", "pool items", "updated in pool", "kept in pool", "match", "fold", ...shapedJobs], "n log n"), ...at(["empty pool", "empty pool shaped"], "1"), [POOL_V]: "1", space: "n" } },
    { name: "slots", of: POOL, type: P.def, meaning: slotsMeaning, canonical: false, impl: slotsImpl, byType: slotsByType,
      cost: { ...at(poolJobs, "1"), ...at(["pool keys", "pool items", "updated in pool", "kept in pool", ...shapedJobs], "n"), ...at(["match", "fold"], "n log n"), ...at(["empty pool", "empty pool shaped"], "1"), [POOL_V]: "n", space: "n" } },
    { name: "number", of: POOL_KEY, type: POOL_KEY, meaning: null, canonical: true, impl: {}, cost: { [POOL_KEY_V]: "1", match: "1", fold: "1", space: "1" } },
    { name: "slots", of: POOL_KEY, type: K.def, meaning: keyMeaning, canonical: false, impl: keyImpl, byType: keyByType, cost: { [POOL_KEY_V]: "1", match: "1", fold: "1", space: "1" } },
    // After those, so their rows keep their places (G4): the pool as a
    // table per shape, its keys the slots' own. Its costs are the slots'
    // (the tables are few: one per shape a type has); what it buys, a
    // shaped job walking only its shapes' tables, is a part of n the
    // ladder can't write, so the chooser takes it where shaped jobs are.
    { name: "tables", of: POOL, type: PT.def, meaning: tablesMeaning, canonical: false, impl: tablesImpl, byType: tablesByType,
      cost: { ...at(poolJobs, "1"), ...at(["pool keys", "pool items", "updated in pool", "kept in pool", ...shapedJobs], "n"), ...at(["match", "fold"], "n log n"), ...at(["empty pool", "empty pool shaped"], "1"), [POOL_V]: "n", space: "n" } },
    { name: "tables", of: POOL_KEY, type: K2.def, meaning: key2Meaning, canonical: false, impl: key2Impl, byType: key2ByType, cost: { [POOL_KEY_V]: "1", match: "1", fold: "1", space: "1" } },
  ];
  return { representations: rows.map(written), defs };

  // Each row written as a representation's definition (REPRESENTATIONS.md,
  // L108b): what the library publishes, and what LIBRARY.reps is read from.
  function written(rep: Representation): Id {
    const cost = (c: string) => k.x(COST_NAMES[c]);
    const jobs: Id[] = [];
    const keys = [...new Set([...Object.keys(rep.impl), ...Object.keys(rep.cost)])].filter((j) => j !== "space");
    for (const j of keys) {
      const by = rep.impl[j], c = rep.cost[j];
      if (!c) throw new Error(`${rep.name}: ${j} has no cost`);
      if (j === FOLD_OF_ITEMS) jobs.push(k.call(JOBS.foldOfItems, cost(c)));
      else if (j.startsWith(CARRIED)) jobs.push(k.call(JOBS.carried, k.x(j.slice(CARRIED.length)), cost(c)));
      else if (j === "match" || j === "fold") jobs.push(by ? k.call(j === "match" ? JOBS.matchBy : JOBS.foldBy, k.x(by), cost(c)) : k.call(j === "match" ? JOBS.matchAsWritten : JOBS.foldAsWritten, cost(c)));
      else jobs.push(by ? k.call(JOBS.job, k.x(j), k.x(by), cost(c)) : k.call(JOBS.asWritten, k.x(j), cost(c)));
    }
    if (rep.byType) jobs.push(k.call(JOBS.equalBy, k.x(rep.byType.equal)), k.call(JOBS.showBy, k.x(rep.byType.show)), k.call(JOBS.compareBy, k.x(rep.byType.compare)));
    for (const [j, d] of Object.entries(rep.heads ?? {})) jobs.push(k.call(JOBS.headBy, k.x(j), k.x(d)));
    if (rep.oneHolder) jobs.push(k.call(JOBS.inPlace));
    if (rep.store) jobs.push(k.call(JOBS.storeBy, k.x(rep.store)));
    const d = k.def(rep.name);
    k.define(d, k.call(REPRESENTATION_V, rep.meaning ? k.x(rep.meaning) : k.fn(["value"], (v) => v), cost(rep.cost.space), k.list(...jobs)));
    defs.push(d);
    return d;
  }
}

const COST_NAMES: Record<string, Id> = Object.fromEntries(LADDER.map((c, i) => [c, `${COST}.${["constant", "logarithmic", "polylogarithmic", "linear", "linearithmic", "quadratic"][i]}`]));

// The trees written into a program, for tests (the library's published
// rows are LIBRARY.reps). `prelude` finds a prelude definition by name.
// `insiders`: the trees' definitions, whose meanings build a Map and a
// Set with their private constructors, for the checker's options.
export function withMapTree(code: Code, names: Names, prelude: (name: string) => Id) {
  const k = new Lang(code);
  const t = buildTrees(k, prelude);
  const all = merge(code, k.code), allNames = { ...names, ...k.names };
  const [rep, spec, set, setSpec] = representationsIn(all, infer(all, allNames, undefined, { insiders: t.defs }), allNames, t.representations);
  return { code: all, names: allNames, rep, spec, set, setSpec, insiders: t.defs };
}
