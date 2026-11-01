// Maps stored as a weight-balanced tree (BACKLOG L76, DATA-STRUCTURES.md
// step 2): each tree job agrees with the sorted-entries definition through
// `meaning`, the tree stays balanced, the chooser takes the tree for a
// program that puts and looks up a lot, and the represented program prints
// what the definition prints, faster.

import { test } from "node:test";
import assert from "node:assert/strict";
import { B } from "../src/prelude.ts";
import { Lang } from "../src/lang/dsl.ts";
import { infer } from "../src/lang/infer.ts";
import { compareValues, makeRunner, runMain, equal, variantOrder, type Data, type Value } from "../src/lang/run.ts";
import { base, baseNames, checkOptions } from "../src/lang/load.ts";
import { LIBRARY, TREES } from "../src/lang/library.ts";
import { choose, jobProblem, represent } from "../src/lang/represent.ts";
import { withMapTree } from "../src/lang/map-tree.ts";
import { CONS, NIL, PAIR_V, S, SET_TYPE, SHOW_ANY } from "../src/lang/std.ts";
import { merge, type Id } from "../src/model.ts";

const lib = (name: string) => LIBRARY.modules[0].exports.find((d) => LIBRARY.names[d] === name)!;
const first = (xs: Iterable<Value>): Value | undefined => { for (const x of xs) return x; return undefined; };

// A word count over n words drawn from a small vocabulary, then removals
// and lookups; main prints the entries, a size and a lookup.
function program(n: number) {
  const k = new Lang(LIBRARY.code);
  const L = lib;
  // Word i is (7919 i) mod n/3, so each comes about three times.
  const counts = k.def("counts");
  k.define(counts, k.fold(k.call(S.range, k.lit(n)), [
    { variant: NIL, names: [], body: () => k.x(L("empty map")) },
    { variant: CONS, names: ["i", "rest"], results: [null, "counted"], body: ([i], [, m]) => k.let("word", k.call(S.mod, k.call(B.mul, i, k.lit(7919)), k.lit(Math.max(1, Math.floor(n / 3)))), (w) =>
      k.call(L("put"), m!, w, k.call(B.add, k.call(S.first, k.thunk(() => k.call(L("value at"), m!, w)), k.thunk(() => k.lit(0))), k.lit(1)))) },
  ]));
  const fewer = k.def("fewer");
  k.define(fewer, k.call(L("remove key"), k.call(L("remove key"), k.x(counts), k.lit(0)), k.lit(1)));
  const main = k.def("main");
  k.define(main, k.thunk(() => k.seq(
    k.call(S.print, k.call(SHOW_ANY, k.call(L("entries of"), k.x(fewer)))),
    k.call(S.print, k.call(SHOW_ANY, k.call(L("map size"), k.x(fewer)))),
    k.call(S.print, k.call(SHOW_ANY, k.call(L("has key"), k.x(fewer), k.lit(1)))),
    k.call(S.print, k.call(SHOW_ANY, k.call(L("keys of"), k.call(L("merge maps"), k.call(L("as map"), k.list(k.call(PAIR_V, k.lit("b"), k.lit(1)), k.call(PAIR_V, k.lit("a"), k.lit(2)))), k.call(L("as map"), k.list(k.call(PAIR_V, k.lit("c"), k.lit(3)))))))),
  )));
  const code = base(k.code), names = baseNames(k.names);
  return { code, names, main, own: [counts, fewer, main] };
}

// `insiders`: a representation's definitions, which may build a Map.
const printed = (code: ReturnType<typeof program>["code"], names: Record<Id, string>, main: Id, insiders: Id[] = []) => {
  const info = infer(code, names, undefined, { ...checkOptions, insiders: [...checkOptions.insiders!, ...insiders] });
  assert.deepEqual(info.errors.map((e) => e.message), []);
  const lines: string[] = [];
  runMain(code, info, main, { print: (s) => lines.push(s), names });
  return lines;
};

test("each tree job agrees with the definition through meaning, and the tree stays balanced", () => {
  const k = new Lang(LIBRARY.code);
  const code0 = base(k.code), names0 = baseNames(k.names);
  const w = withMapTree(code0, names0, lib);
  const info = infer(w.code, w.names, undefined, { ...checkOptions, insiders: [...checkOptions.insiders!, ...w.insiders] });
  assert.deepEqual(info.errors.map((e) => e.message), []);
  assert.equal(jobProblem(info, w.rep, w.names), null);
  const r = makeRunner(w.code, info, { print: () => {}, names: w.names });
  const call = (d: Id, ...args: Value[]) => first(r.call(r.value(d), ...args));
  const means = (t: Value) => call(w.rep.meaning!, t);
  const impl = (name: string) => w.rep.impl[lib(name)];
  const spec = (name: string) => lib(name);
  // A tree's sizes are right and no side outweighs the other by more than 3 to 1.
  const balanced = (t: Value): number => {
    const d = t as Data;
    if (!d.fields.length) return 0;
    const [s, , , l, rt] = d.fields;
    const sl = balanced(l), sr = balanced(rt);
    assert.equal(s, sl + sr + 1, "size");
    if (sl + sr >= 2) assert.ok(sl <= 3 * sr && sr <= 3 * sl, `unbalanced: ${sl} against ${sr}`);
    return sl + sr + 1;
  };
  let seed = 7;
  const rand = (n: number) => (seed = (seed * 1103515245 + 12345) % 2147483648) % n;
  // Whole keys, then Float64s a near step apart (each within equal's 1e-9
  // of the next) with −0 and 0: compare's exact order keeps the tree
  // and the sorted list agreeing on those too (REVIEW-2026-10-26.md §1.1).
  const order = variantOrder(w.code);
  const near = [...Array.from({ length: 20 }, (_, j) => 1000.5 + j * 1.5e-6), -0, 0];
  for (const keyOf of [(i: number) => i, (i: number) => near[i % near.length]]) {
  let tree = r.value(impl("empty map")), map = r.value(spec("empty map"));
  for (let step = 0; step < 400; step++) {
    const key = keyOf(rand(60)), op = rand(3);
    if (op < 2) { tree = call(impl("put"), tree, key, step)!; map = call(spec("put"), map, key, step)!; }
    else { tree = call(impl("remove key"), tree, key)!; map = call(spec("remove key"), map, key)!; }
    // compare's "same": exact, where equal is near.
    assert.equal(compareValues(means(tree)!, map, order), 0, `step ${step}`);
    balanced(tree);
    const probe = keyOf(rand(60));
    assert.deepEqual(call(impl("value at"), tree, probe), call(spec("value at"), map, probe));
    assert.ok(equal(call(impl("has key"), tree, probe)!, call(spec("has key"), map, probe)!));
    assert.equal(call(impl("map size"), tree), call(spec("map size"), map));
    for (const end of ["smallest key", "largest key"]) assert.deepEqual(call(impl(end), tree), call(spec(end), map), end);
  }
  }
});

test("the chooser takes the tree for a word count; the represented program prints what the definition prints", () => {
  const p = program(300);
  const w = withMapTree(p.code, p.names, lib);
  const pick = choose(w.code, p.main, [w.spec, w.rep]);
  assert.equal(pick.rep.name, "weight-balanced tree");
  const plain = printed(p.code, p.names, p.main);
  const tree = printed(represent(w.code, p.own, w.rep), w.names, p.main, w.insiders);
  assert.deepEqual(tree, plain);
  assert.equal(plain[3], '["a", "b", "c"]');
});

test("on 1200 words, 400 of them different, the tree is faster than the sorted list", () => {
  const p = program(1200);
  const w = withMapTree(p.code, p.names, lib);
  const repd = represent(w.code, p.own, w.rep);
  const time = (f: () => string[]) => { const t = performance.now(); const out = f(); return { out, ms: performance.now() - t }; };
  const a = time(() => printed(p.code, p.names, p.main));
  const b = time(() => printed(repd, w.names, p.main, w.insiders));
  assert.deepEqual(b.out, a.out);
  console.log(`# sorted list ${a.ms.toFixed(0)} ms, tree ${b.ms.toFixed(0)} ms`);
  assert.ok(b.ms < a.ms, `tree ${b.ms} ms, list ${a.ms} ms`);
});

test("the library publishes both trees as representation rows, and a program stored on them prints the same", () => {
  const [mapTree, mapList, setTree, setList] = LIBRARY.reps;
  assert.deepEqual([mapTree.name, mapList.name, setTree.name, setList.name], ["weight-balanced tree", "sorted list", "weight-balanced tree", "sorted list"]);
  assert.equal(mapTree.canonical, false);
  // Every job the rows name is in the trees module or the library, and
  // the trees aren't in what every program is checked on (C53).
  const withTrees = merge(LIBRARY.code, TREES.code);
  for (const r of LIBRARY.reps) for (const d of [r.type, r.meaning, ...Object.values(r.impl), ...Object.values(r.byType ?? {})]) if (d) assert.ok(withTrees.nodes[d], `${r.name} names ${d}`);
  assert.ok(!LIBRARY.code.nodes[mapTree.type]);
  const k = new Lang(LIBRARY.code);
  const L = lib;
  const nums = (xs: number[]) => k.list(...xs.map((x) => k.lit(x)));
  const a = k.call(L("as set"), nums([5, 1, 4, 1, 3])), b = k.call(L("as set"), nums([4, 9, 1]));
  const main = k.def("main");
  k.define(main, k.thunk(() => k.seq(
    k.call(S.print, k.call(SHOW_ANY, k.call(L("items of"), k.call(L("set union"), a, b)))),
    k.call(S.print, k.call(SHOW_ANY, k.call(L("items of"), k.call(L("set intersection"), a, b)))),
    k.call(S.print, k.call(SHOW_ANY, k.call(L("items of"), k.call(L("set difference"), a, b)))),
    k.call(S.print, k.call(SHOW_ANY, k.call(L("has item"), k.call(L("remove item"), a, k.lit(4)), k.lit(4)))),
    k.call(S.print, k.call(SHOW_ANY, k.call(L("keys of"), k.call(L("put"), k.call(L("as map"), k.list(k.call(PAIR_V, k.lit("b"), k.lit(2)))), k.lit("a"), k.lit(1))))),
  )));
  const code = base(k.code), names = baseNames(k.names);
  const plain = printed(code, names, main);
  assert.deepEqual(plain, ["[1, 3, 4, 5, 9]", "[1, 4]", "[3, 5]", "false", '["a", "b"]']);
  const stored = represent(represent(merge(code, TREES.code), [main], mapTree), [main], setTree);
  assert.deepEqual(printed(stored, names, main), plain);
});

test("byType: equal, show and compare on trees go through the meaning", () => {
  const [mapTree] = LIBRARY.reps;
  const code = merge(LIBRARY.code, TREES.code), names = { ...LIBRARY.names, ...TREES.names };
  const info = infer(code, names, undefined, checkOptions);
  const r = makeRunner(code, info, { print: () => {}, names });
  const call = (d: Id, ...args: Value[]) => first(r.call(r.value(d), ...args));
  const put = mapTree.impl[lib("put")];
  let x = r.value(mapTree.impl[lib("empty map")]), y = x;
  // Two keys: the first put is the root, so the order shows in the shape.
  for (const kk of [2, 1]) x = call(put, x, kk, kk * 10)!;
  for (const kk of [1, 2]) y = call(put, y, kk, kk * 10)!;
  // Different shapes, one meaning.
  assert.notDeepEqual(x, y);
  assert.equal((call(mapTree.byType!.equal, x, y) as Data).tag, "std.bool.true");
  assert.equal((call(mapTree.byType!.compare, x, y) as Data).tag, "std.order.same");
  assert.equal(call(mapTree.byType!.show, x), "map of([pair(1, 10), pair(2, 20)])");
  const setTree = LIBRARY.reps.find((rep) => rep.of === SET_TYPE && rep.byType)!;
  const add = setTree.impl[lib("add item")];
  let a = r.value(setTree.impl[lib("empty set")]), b = a;
  for (const kk of [2, 1]) a = call(add, a, kk)!;
  for (const kk of [1, 2]) b = call(add, b, kk)!;
  assert.notDeepEqual(a, b);
  assert.equal((call(setTree.byType!.equal, a, b) as Data).tag, "std.bool.true");
  assert.equal((call(setTree.byType!.compare, a, b) as Data).tag, "std.order.same");
  assert.equal(call(setTree.byType!.show, a), "set of([1, 2])");
});

test("a set's smallest and largest item, and a map's smallest and largest key (L102): the tree walks one side, and agrees with the sorted list", () => {
  const [mapTree, , setTree] = LIBRARY.reps;
  const k = new Lang(LIBRARY.code);
  const L = lib;
  const nums = (xs: number[]) => k.list(...xs.map((x) => k.lit(x)));
  // A Choice: `all` lists the answers, none for an empty set.
  const ends = (s: Id) => k.call(S.all, k.thunk(() => k.call(CONS, k.call(L("smallest item"), s), k.call(CONS, k.call(L("largest item"), s), k.x(NIL)))));
  const frontier = k.call(L("as set"), k.list(...[[30, "c"], [10, "b"], [20, "a"], [10, "a"]].map(([d, t]) => k.call(PAIR_V, k.lit(d), k.lit(t)))));
  const m = k.call(L("as map"), k.list(...["kiwi", "apple", "pear"].map((t, i) => k.call(PAIR_V, k.lit(t), k.lit(i)))));
  const main = k.def("main");
  k.define(main, k.thunk(() => k.seq(
    k.call(S.print, k.call(SHOW_ANY, ends(k.call(L("as set"), nums([5, 1, 4, 1, 3]))))),
    k.call(S.print, k.call(SHOW_ANY, ends(k.x(L("empty set"))))),
    k.call(S.print, k.call(SHOW_ANY, k.call(S.first, k.thunk(() => k.call(L("smallest item"), frontier)), k.thunk(() => k.call(PAIR_V, k.lit(0), k.lit("none")))))),
    k.call(S.print, k.call(SHOW_ANY, k.call(S.all, k.thunk(() => k.call(CONS, k.call(L("smallest key"), m), k.call(CONS, k.call(L("largest key"), m), k.x(NIL))))))),
    k.call(S.print, k.call(SHOW_ANY, k.call(S.all, k.thunk(() => k.call(L("largest key"), k.x(L("empty map"))))))),
  )));
  const code = base(k.code), names = baseNames(k.names);
  const plain = printed(code, names, main);
  assert.deepEqual(plain, ["[[1, 5]]", "[]", 'pair(10, "a")', '[["apple", "pear"]]', "[]"]);
  const stored = represent(represent(merge(code, TREES.code), [main], mapTree), [main], setTree);
  assert.deepEqual(printed(stored, names, main), plain);
  // On the tree, each is log n: a walk down one side, not the items listed.
  assert.equal(setTree.cost[lib("smallest item")], "log n");
  assert.equal(mapTree.cost[lib("largest key")], "log n");
});

test("update at changes the value at a key in one walk, or puts change(default) (L103); the tree agrees with the sorted list", () => {
  const [mapTree] = LIBRARY.reps;
  const k = new Lang(LIBRARY.code);
  const L = lib;
  // Counting words, and a list of neighbours grown at the front: routes'
  // `connect` without its `neighbours` helper.
  const words = ["b", "a", "c", "a", "b", "a"];
  const counted = words.reduce((m, w) => k.call(L("update at"), m, k.lit(w), k.lit(0), k.fn(["n"], (n) => k.call(B.add, n, k.lit(1)))), k.x(L("empty map")));
  const roads = [["a", "b"], ["a", "c"], ["b", "c"]];
  const graph = roads.reduce((g, [x, y]) => k.call(L("update at"), g, k.lit(x), k.x(NIL), k.fn(["ns"], (ns) => k.call(CONS, k.lit(y), ns))), k.x(L("empty map")));
  const main = k.def("main");
  k.define(main, k.thunk(() => k.seq(
    k.call(S.print, k.call(SHOW_ANY, k.call(L("entries of"), counted))),
    k.call(S.print, k.call(SHOW_ANY, k.call(L("entries of"), graph))),
  )));
  const code = base(k.code), names = baseNames(k.names);
  const plain = printed(code, names, main);
  assert.deepEqual(plain, ['[pair("a", 3), pair("b", 2), pair("c", 1)]', '[pair("a", ["c", "b"]), pair("b", ["c"])]']);
  assert.deepEqual(printed(represent(merge(code, TREES.code), [main], mapTree), names, main), plain);
  assert.equal(mapTree.cost[lib("update at")], "log n");
});
