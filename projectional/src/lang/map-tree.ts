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
// finds them by type (C47). The library publishes both rows
// (trees-source.ts, library/trees.json, LIBRARY.reps); `withMapTree` builds
// them into a program for tests.

import { merge, type Code, type Id } from "../model.ts";
import type { Names } from "../presentation.ts";
import { Lang } from "./dsl.ts";
import type { Representation } from "./represent.ts";
import { COMPARE, CONS, FALSE, INT_OPS, MAP, MAP_V, NIL, ORDER_V, PAIR_V, S, SET_TYPE, SET_V, SHOW_ANY, TRUE } from "./std.ts";
import { INT } from "./types.ts";

export interface Trees { map: Representation; set: Representation; mapSpec: Representation; setSpec: Representation; defs: Id[] }

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
    const emptyTree = k.def(`empty ${word}`);
    k.define(emptyTree, k.x(tip));
    defs.push(emptyTree);
    return { T, tip, size, insert, has, remove, list, emptyTree };
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
    [prelude("value at")]: find,
    [prelude("remove key")]: m.remove,
    [prelude("has key")]: m.has,
    [prelude("merge maps")]: def("tree merge", ["first", "second"], (a, b) => putAll(k.call(prelude("reverse"), k.call(m.list, b)), a)),
    [prelude("keys of")]: def("tree keys", ["tree"], (t) => k.call(prelude("map"), k.call(m.list, t), k.fn(["entry"], (e) => pair(e, (key) => key)))),
    [prelude("values of")]: def("tree values", ["tree"], (t) => k.call(prelude("map"), k.call(m.list, t), k.fn(["entry"], (e) => pair(e, (_, v) => v)))),
    [prelude("entries of")]: m.list,
    [prelude("map size")]: m.size,
  };
  const mapByType = {
    equal: mapOf((a, b) => k.call(S.equal, a, b), "tree equal"),
    compare: mapOf((a, b) => k.call(COMPARE, a, b), "tree compare"),
    show: def("tree show", ["tree"], (t) => k.call(SHOW_ANY, k.call(mapMeaning, t))),
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
  const ofItems = def("set tree of items", ["items"], (xs) => addAll(xs, k.x(s.tip)));
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
  };
  const setByType = {
    equal: setOf((a, b) => k.call(S.equal, a, b), "set tree equal"),
    compare: setOf((a, b) => k.call(COMPARE, a, b), "set tree compare"),
    show: def("set tree show", ["tree"], (t) => k.call(SHOW_ANY, k.call(setMeaning, t))),
  };

  const job = (n: string) => (n === "match" || n === "fold" ? n : prelude(n));
  const at = (ns: string[], cost: string) => Object.fromEntries(ns.map((n) => [job(n), cost]));
  const mapLog = ["put", "value at", "remove key", "has key"], mapLin = ["keys of", "values of", "entries of", "match", "fold"];
  const setLog = ["add item", "remove item", "has item"], setLin = ["items of", "match", "fold"];
  // The definitions themselves: every job walks the sorted list.
  const spec = (of: Id, cons: Id, linear: string[], quadratic: string[], one: string[]): Representation => ({
    name: "sorted list", of, type: of, meaning: null, canonical: true, impl: {},
    cost: { ...at(linear, "n"), ...at(quadratic, "n²"), ...at(one, "1"), [cons]: "1", space: "n" },
  });
  return {
    map: { name: "weight-balanced tree", of: MAP, type: m.T.def, meaning: mapMeaning, canonical: false, impl: mapImpl, byType: mapByType,
      cost: { ...at(mapLog, "log n"), ...at(mapLin, "n"), ...at(["as map", "merge maps"], "n log n"), ...at(["empty map", "map size"], "1"), [MAP_V]: "n log n", space: "n" } },
    set: { name: "weight-balanced tree", of: SET_TYPE, type: s.T.def, meaning: setMeaning, canonical: false, impl: setImpl, byType: setByType,
      cost: { ...at(setLog, "log n"), ...at(setLin, "n"), ...at(["as set", "set union", "set intersection", "set difference"], "n log n"), ...at(["empty set", "set size"], "1"), [SET_V]: "n log n", space: "n" } },
    mapSpec: spec(MAP, MAP_V, [...mapLog, ...mapLin, "map size"], ["as map", "merge maps"], ["empty map"]),
    setSpec: spec(SET_TYPE, SET_V, [...setLog, ...setLin, "set size", "set union", "set intersection", "set difference"], ["as set"], ["empty set"]),
    defs,
  };
}

// The trees written into a program, for tests (the library's published
// rows are LIBRARY.reps). `prelude` finds a prelude definition by name.
// `insiders`: the trees' definitions, whose meanings build a Map and a
// Set with their private constructors, for the checker's options.
export function withMapTree(code: Code, names: Names, prelude: (name: string) => Id) {
  const k = new Lang(code);
  const t = buildTrees(k, prelude);
  return { code: merge(code, k.code), names: { ...names, ...k.names }, rep: t.map, spec: t.mapSpec, set: t.set, setSpec: t.setSpec, insiders: t.defs };
}
