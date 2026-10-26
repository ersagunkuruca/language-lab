// Maps stored as a weight-balanced tree (BACKLOG L76, DATA-STRUCTURES.md
// step 2): a representation of std's Map (NUMBERS.md, represent.ts). The
// meaning stays the sorted entries; the tree does Map's jobs in log n.
//
// A tree is tip, or bin(size, key, value, left, right) with every key on
// the left before `key` and every key on the right after it, by compare.
// It stays balanced by weight: neither side holds more than three times
// the other (plus one), restored by single and double rotations after each
// change. That is Nievergelt and Reingold's weight-balanced trees (1972) as
// Adams wrote them for functional languages (1993), with the parameters
// ⟨3, 2⟩ that Hirai and Yamamoto proved correct (2011), as in Haskell's
// containers.
//
// The tree's shape depends on the order keys were put in, so it isn't a
// canonical spelling (`canonical: false`): equal, show and compare on maps
// must go through `meaning`. Choosing this representation without the
// program asking is C47.

import { merge, type Code, type Id } from "../model.ts";
import type { Names } from "../presentation.ts";
import { Lang } from "./dsl.ts";
import { LIBRARY } from "./library.ts";
import type { Representation } from "./represent.ts";
import { COMPARE, CONS, FALSE, INT_OPS, MAP, MAP_V, NIL, ORDER_V, PAIR_V, S, TRUE } from "./std.ts";
import { INT } from "./types.ts";

// The prelude's map operations the tree does itself, by name.
export const TREE_JOBS = ["empty map", "as map", "put", "value at", "remove key", "has key", "merge maps", "keys of", "values of", "entries of", "map size"] as const;
const prelude = (name: string) => LIBRARY.modules[0].exports.find((d) => LIBRARY.names[d] === name)!;

// `insiders`: the tree's definitions, which build a Map with its private
// constructor (its meaning does), for the checker's options.
export function withMapTree(code: Code, names: Names): { code: Code; names: Names; rep: Representation; tree: Id; spec: Representation; insiders: Id[] } {
  const k = new Lang(code);
  const T = k.type("Map tree", ["k", "v"], [
    ["tip", []],
    ["bin", [["size", () => k.tref(INT)], ["key", (_, [kk]) => k.tref(kk)], ["value", (_, [, v]) => k.tref(v)], ["left", (self, [kk, v]) => k.tref(self, k.tref(kk), k.tref(v))], ["right", (self, [kk, v]) => k.tref(self, k.tref(kk), k.tref(v))]]],
  ]);
  const { tip, bin } = T.v;
  const def = (name: string, params: string[], body: (...ps: Id[]) => Id) => { const d = k.def(name); k.define(d, k.fn(params, body)); return d; };
  const i = { add: (a: Id, b: Id) => k.call(INT_OPS.add, a, b), mul: (a: Id, b: Id) => k.call(INT_OPS.mul, a, b), less: (a: Id, b: Id) => k.call(INT_OPS.less, a, b) };
  const order = (a: Id, b: Id, before: () => Id, same: () => Id, after: () => Id) => k.match(k.call(COMPARE, a, b), [
    { variant: ORDER_V.before, names: [], body: before },
    { variant: ORDER_V.same, names: [], body: same },
    { variant: ORDER_V.after, names: [], body: after },
  ]);
  // A tree's parts, or `otherwise` at a tip.
  const parts = (t: Id, f: (s: Id, key: Id, v: Id, l: Id, r: Id) => Id, otherwise: () => Id, ns = ["size", "key", "value", "left", "right"]) =>
    k.match(t, [{ variant: tip, names: [], body: otherwise }, { variant: bin, names: ns, body: ([s, key, v, l, r]) => f(s, key, v, l, r) }]);

  const size = def("tree size", ["tree"], (t) => parts(t, (s) => s, () => k.int(0)));
  const node = def("node", ["key", "value", "left", "right"], (key, v, l, r) => k.call(bin, i.add(i.add(k.call(size, l), k.call(size, r)), k.int(1)), key, v, l, r));
  const N = (key: Id, v: Id, l: Id, r: Id) => k.call(node, key, v, l, r);
  // The rotations. A side that is too heavy is never a tip, so the tip
  // cases only keep the types whole.
  const singleL = def("single left", ["key", "value", "left", "right"], (key, v, l, r) => parts(r, (_, rk, rv, rl, rr) => N(rk, rv, N(key, v, l, rl), rr), () => N(key, v, l, r), ["r size", "r key", "r value", "r left", "r right"]));
  const singleR = def("single right", ["key", "value", "left", "right"], (key, v, l, r) => parts(l, (_, lk, lv, ll, lr) => N(lk, lv, ll, N(key, v, lr, r)), () => N(key, v, l, r), ["l size", "l key", "l value", "l left", "l right"]));
  const doubleL = def("double left", ["key", "value", "left", "right"], (key, v, l, r) => parts(r, (_, rk, rv, rl, rr) =>
    parts(rl, (__, mk, mv, ml, mr) => N(mk, mv, N(key, v, l, ml), N(rk, rv, mr, rr)), () => N(key, v, l, r), ["m size", "m key", "m value", "m left", "m right"]),
  () => N(key, v, l, r), ["r size", "r key", "r value", "r left", "r right"]));
  const doubleR = def("double right", ["key", "value", "left", "right"], (key, v, l, r) => parts(l, (_, lk, lv, ll, lr) =>
    parts(lr, (__, mk, mv, ml, mr) => N(mk, mv, N(lk, lv, ll, ml), N(key, v, mr, r)), () => N(key, v, l, r), ["m size", "m key", "m value", "m left", "m right"]),
  () => N(key, v, l, r), ["l size", "l key", "l value", "l left", "l right"]));
  const DELTA = 3, RATIO = 2;
  const balance = def("balance", ["key", "value", "left", "right"], (key, v, l, r) => k.let("left size", k.call(size, l), (sl) => k.let("right size", k.call(size, r), (sr) =>
    k.if(i.less(i.add(sl, sr), k.int(2)), N(key, v, l, r),
      k.if(i.less(i.mul(k.int(DELTA), sl), sr),
        parts(r, (_, __, ___, rl, rr) => k.if(i.less(k.call(size, rl), i.mul(k.int(RATIO), k.call(size, rr))), k.call(singleL, key, v, l, r), k.call(doubleL, key, v, l, r)), () => N(key, v, l, r), ["r size", "r key", "r value", "r left", "r right"]),
        k.if(i.less(i.mul(k.int(DELTA), sr), sl),
          parts(l, (_, __, ___, ll, lr) => k.if(i.less(k.call(size, lr), i.mul(k.int(RATIO), k.call(size, ll))), k.call(singleR, key, v, l, r), k.call(doubleR, key, v, l, r)), () => N(key, v, l, r), ["l size", "l key", "l value", "l left", "l right"]),
          N(key, v, l, r)))))));

  const insert = k.def("tree put");
  k.define(insert, k.fn(["tree", "key", "value"], (t, key, v) => parts(t, (s, tk, tv, l, r) => order(key, tk,
    () => k.call(balance, tk, tv, k.call(insert, l, key, v), r),
    () => k.call(bin, s, key, v, l, r),
    () => k.call(balance, tk, tv, l, k.call(insert, r, key, v))),
  () => N(key, v, k.x(tip), k.x(tip)))));
  const find = k.def("tree value at");
  k.define(find, k.fn(["tree", "key"], (t, key) => parts(t, (_, tk, tv, l, r) => order(key, tk, () => k.call(find, l, key), () => tv, () => k.call(find, r, key)), () => k.call(S.fail))));
  const has = k.def("tree has key");
  k.define(has, k.fn(["tree", "key"], (t, key) => parts(t, (_, tk, __, l, r) => order(key, tk, () => k.call(has, l, key), () => k.x(TRUE), () => k.call(has, r, key)), () => k.x(FALSE))));
  // The leftmost entry, and the tree without it: what takes a removed
  // node's place.
  const minEntry = k.def("smallest entry");
  k.define(minEntry, k.fn(["tree", "key", "value"], (t, key, v) => parts(t, (_, tk, tv, l) => k.call(minEntry, l, tk, tv), () => k.call(PAIR_V, key, v))));
  const dropMin = k.def("without smallest");
  k.define(dropMin, k.fn(["tree"], (t) => parts(t, (_, tk, tv, l, r) => parts(l, () => k.call(balance, tk, tv, k.call(dropMin, l), r), () => r, ["l size", "l key", "l value", "l left", "l right"]), () => k.x(tip))));
  const glue = def("glue", ["left", "right"], (l, r) => parts(r, (_, rk, rv) => k.match(k.call(minEntry, r, rk, rv), [
    { variant: PAIR_V, names: ["min key", "min value"], body: ([mk, mv]) => k.call(balance, mk, mv, l, k.call(dropMin, r)) },
  ]), () => l, ["r size", "r key", "r value", "r left", "r right"]));
  const remove = k.def("tree remove key");
  k.define(remove, k.fn(["tree", "key"], (t, key) => parts(t, (_, tk, tv, l, r) => order(key, tk,
    () => k.call(balance, tk, tv, k.call(remove, l, key), r),
    () => k.call(glue, l, r),
    () => k.call(balance, tk, tv, l, k.call(remove, r, key))),
  () => k.x(tip))));
  // The entries in key order, onto a list: the meaning.
  const onto = k.def("entries onto");
  k.define(onto, k.fn(["tree", "rest"], (t, rest) => parts(t, (_, tk, tv, l, r) => k.call(onto, l, k.call(CONS, k.call(PAIR_V, tk, tv), k.call(onto, r, rest))), () => rest)));
  const entries = def("tree entries", ["tree"], (t) => k.call(onto, t, k.x(NIL)));
  const meaning = def("tree meaning", ["tree"], (t) => k.call(MAP_V, k.call(entries, t)));
  const fromEntries = def("tree of entries", ["entries"], (es) => k.fold(es, [
    { variant: NIL, names: [], body: () => k.x(tip) },
    { variant: CONS, names: ["entry", "rest"], results: [null, "tree"], body: ([e], [, t]) => k.match(e, [{ variant: PAIR_V, names: ["key", "value"], body: ([key, v]) => k.call(insert, t!, key, v) }]) },
  ]));
  const pairsIn = (ps: Id, t0: Id) => k.fold(ps, [
    { variant: NIL, names: [], body: () => t0 },
    { variant: CONS, names: ["entry", "rest"], results: [null, "tree"], body: ([e], [, t]) => k.match(e, [{ variant: PAIR_V, names: ["key", "value"], body: ([key, v]) => k.call(insert, t!, key, v) }]) },
  ]);
  const map = prelude("map");
  const emptyTree = k.def("empty tree");
  k.define(emptyTree, k.x(tip));
  const impl: Record<Id, Id> = {
    [MAP_V]: fromEntries,
    match: def("match tree", ["tree", "map of"], (t, f) => k.call(f, k.call(entries, t))),
    fold: def("fold tree", ["tree", "map of"], (t, f) => k.call(f, k.call(entries, t))),
    [prelude("empty map")]: emptyTree,
    // A later pair wins: put in the order given.
    [prelude("as map")]: def("tree as map", ["pairs"], (ps) => pairsIn(k.call(prelude("reverse"), ps), k.x(tip))),
    [prelude("put")]: insert,
    [prelude("value at")]: find,
    [prelude("remove key")]: remove,
    [prelude("has key")]: has,
    [prelude("merge maps")]: def("tree merge", ["first", "second"], (a, b) => pairsIn(k.call(prelude("reverse"), k.call(entries, b)), a)),
    [prelude("keys of")]: def("tree keys", ["tree"], (t) => k.call(map, k.call(entries, t), k.fn(["entry"], (e) => k.match(e, [{ variant: PAIR_V, names: ["key", "value"], body: ([key]) => key }])))),
    [prelude("values of")]: def("tree values", ["tree"], (t) => k.call(map, k.call(entries, t), k.fn(["entry"], (e) => k.match(e, [{ variant: PAIR_V, names: ["key", "value"], body: ([, v]) => v }])))),
    [prelude("entries of")]: entries,
    [prelude("map size")]: size,
  };
  const logn = ["put", "value at", "remove key", "has key"].map(prelude);
  const linear = ["keys of", "values of", "entries of", "match", "fold"].map((n) => (n === "match" || n === "fold" ? n : prelude(n)));
  const cost: Record<string, string> = {
    ...Object.fromEntries(logn.map((j) => [j, "log n"])), ...Object.fromEntries(linear.map((j) => [j, "n"])),
    [MAP_V]: "n log n", [prelude("as map")]: "n log n", [prelude("merge maps")]: "n log n", [prelude("empty map")]: "1", [prelude("map size")]: "1", space: "n",
  };
  // The definition itself: every job walks the sorted list.
  const spec: Representation = {
    name: "sorted entries", of: MAP, type: MAP, meaning: null, canonical: true, impl: {},
    cost: { ...Object.fromEntries([...logn, ...linear, prelude("map size")].map((j) => [j, "n"])), [MAP_V]: "1", [prelude("as map")]: "n²", [prelude("merge maps")]: "n²", [prelude("empty map")]: "1", space: "n" },
  };
  const rep: Representation = { name: "weight-balanced tree", of: MAP, type: T.def, meaning, canonical: false, impl, cost };
  return { code: merge(code, k.code), names: { ...names, ...k.names }, rep, tree: T.def, spec, insiders: k.code.defs };
}
