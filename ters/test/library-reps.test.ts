// Library representations chosen without the program asking (BACKLOG C47):
// a program that puts and looks up a lot gets L76's tree for Map and
// prints what the definition prints; equal, show and compare on maps see
// the entries, not the tree's shape; a program with a map inside another
// value keeps the definition.

import { test } from "node:test";
import assert from "node:assert/strict";
import { B } from "../src/prelude.ts";
import { Lang } from "../src/lang/dsl.ts";
import { infer } from "../src/lang/infer.ts";
import { makeRunner, runMain, showValue, type Value } from "../src/lang/run.ts";
import { base, baseNames, checkOptions } from "../src/lang/load.ts";
import { LIBRARY } from "../src/lang/library.ts";
import { withLibraryRepresentations } from "../src/lang/library-reps.ts";
import { COMPARE, CONS, INT_OPS, LIST, NIL, PAIR_V, S, SHOW_ANY } from "../src/lang/std.ts";
import { DIVERGE, NUMBER, STRING } from "../src/lang/types.ts";
import { subtree, type Id } from "../src/model.ts";

const L = (name: string) => LIBRARY.modules[0].exports.find((d) => LIBRARY.names[d] === name)!;

// Counts n words, then shows, compares and tests maps built in two orders.
function program(n: number, nested = false) {
  const k = new Lang(LIBRARY.code);
  const counts = k.def("counts");
  k.define(counts, k.fold(k.call(S.range, k.lit(n)), [
    { variant: NIL, names: [], body: () => k.x(L("empty map")) },
    { variant: CONS, names: ["i", "rest"], results: [null, "counted"], body: ([i], [, m]) => k.let("word", k.call(S.mod, k.call(B.mul, i, k.lit(7919)), k.lit(Math.max(1, Math.floor(n / 3)))), (w) =>
      k.call(L("put"), m!, w, k.call(B.add, k.call(S.first, k.thunk(() => k.call(L("value at"), m!, w)), k.thunk(() => k.lit(0))), k.lit(1)))) },
  ]));
  const of = (...kv: [string, number][]) => k.call(L("as map"), k.list(...kv.map(([a, b]) => k.call(PAIR_V, k.lit(a), k.lit(b)))));
  // The same entries put in another order: a tree of another shape.
  const ab = k.def("ab"), ba = k.def("ba");
  k.define(ab, of(["a", 1], ["b", 2], ["c", 3], ["d", 4]));
  k.define(ba, k.call(L("put"), k.call(L("put"), k.call(L("put"), k.call(L("put"), k.x(L("empty map")), k.lit("d"), k.lit(4)), k.lit("c"), k.lit(3)), k.lit("b"), k.lit(2)), k.lit("a"), k.lit(1)));
  const show = (x: Id) => k.call(S.print, k.call(SHOW_ANY, x));
  const main = k.def("main");
  k.define(main, k.thunk(() => k.seq(
    show(k.call(L("map size"), k.x(counts))),
    show(k.call(S.first, k.thunk(() => k.call(L("value at"), k.x(counts), k.lit(5))), k.thunk(() => k.lit(-1)))),
    show(k.x(ab)),
    show(k.call(S.equal, k.x(ab), k.x(ba))),
    show(k.call(COMPARE, k.x(ab), k.call(L("remove key"), k.x(ba), k.lit("d")))),
    ...(nested ? [show(k.list(k.x(ab), k.x(ba)))] : []),
  )));
  const code = base(k.code), names = baseNames(k.names);
  return { code, names, main, own: [counts, ab, ba, main] };
}
// `insiders`: a representation's definitions, which may build a Map.
const printed = (code: ReturnType<typeof program>["code"], names: Record<Id, string>, main: Id, insiders: Id[] = [], unpinned: Id[] = []) => {
  const pins = Object.fromEntries(Object.entries(checkOptions.pins ?? {}).filter(([d]) => !unpinned.includes(d)));
  const info = infer(code, names, undefined, { ...checkOptions, pins, insiders: [...checkOptions.insiders!, ...insiders] });
  assert.deepEqual(info.errors.map((e) => e.message), []);
  const lines: string[] = [];
  runMain(code, info, main, { print: (s) => lines.push(s), names });
  return lines;
};

test("a word count gets the tree, and prints what the definition prints: equal, show and compare see the entries", () => {
  const p = program(300);
  const info = infer(p.code, p.names, undefined, checkOptions);
  const c = withLibraryRepresentations(p.code, info, p.names, p.main, p.own);
  assert.deepEqual(c.chosen, ["Map as weight-balanced tree"]);
  const plain = printed(p.code, p.names, p.main);
  assert.deepEqual(printed(c.code, c.names, p.main, c.insiders), plain);
  assert.equal(plain[3], "true");
});

// C48: a Set gets its tree too, from LIBRARY.reps.
test("a program that adds and tests many items gets the tree for Set, and prints what the definition prints", () => {
  const k = new Lang(LIBRARY.code);
  const seen = k.def("seen");
  k.define(seen, k.fold(k.call(S.range, k.lit(300)), [
    { variant: NIL, names: [], body: () => k.x(L("empty set")) },
    { variant: CONS, names: ["i", "rest"], results: [null, "s"], body: ([i], [, s]) => k.call(L("add item"), s!, k.call(S.mod, k.call(B.mul, i, k.lit(7919)), k.lit(100))) },
  ]));
  const ab = k.def("ab"), ba = k.def("ba");
  k.define(ab, k.call(L("add item"), k.call(L("add item"), k.x(L("empty set")), k.lit("a")), k.lit("b")));
  k.define(ba, k.call(L("add item"), k.call(L("add item"), k.x(L("empty set")), k.lit("b")), k.lit("a")));
  const show = (x: Id) => k.call(S.print, k.call(SHOW_ANY, x));
  const main = k.def("main");
  k.define(main, k.thunk(() => k.seq(
    show(k.call(L("set size"), k.x(seen))),
    show(k.call(L("has item"), k.x(seen), k.lit(42))),
    show(k.x(ab)),
    show(k.call(S.equal, k.x(ab), k.x(ba))),
    show(k.call(COMPARE, k.x(ab), k.x(ba))),
  )));
  const code = base(k.code), names = baseNames(k.names);
  const info = infer(code, names, undefined, checkOptions);
  const c = withLibraryRepresentations(code, info, names, main, [seen, ab, ba, main]);
  assert.deepEqual(c.chosen, ["Set as weight-balanced tree"]);
  const plain = printed(code, names, main);
  assert.deepEqual(printed(c.code, c.names, main, c.insiders), plain);
  assert.deepEqual(plain.slice(3), ["true", "same"]);
});

// A generic helper decides what it does with a value for every type, so
// the rewrite can't find its show by type: it would see the tree's shape.
test("a set given to a generic helper keeps the definition", () => {
  const k = new Lang(LIBRARY.code);
  const seen = k.def("seen");
  k.define(seen, k.fold(k.call(S.range, k.lit(300)), [
    { variant: NIL, names: [], body: () => k.x(L("empty set")) },
    { variant: CONS, names: ["i", "rest"], results: [null, "s"], body: ([i], [, s]) => k.call(L("add item"), s!, i) },
  ]));
  const ab = k.def("ab");
  k.define(ab, k.call(L("add item"), k.call(L("add item"), k.x(L("empty set")), k.lit("b")), k.lit("a")));
  const describe = k.def("describe");
  k.define(describe, k.fn(["x"], (x) => k.call(SHOW_ANY, x)));
  const main = k.def("main");
  k.define(main, k.thunk(() => k.seq(
    k.call(S.print, k.call(SHOW_ANY, k.call(L("has item"), k.x(seen), k.lit(42)))),
    k.call(S.print, k.call(describe, k.x(ab))),
  )));
  const code = base(k.code), names = baseNames(k.names);
  const info = infer(code, names, undefined, checkOptions);
  const c = withLibraryRepresentations(code, info, names, main, [seen, ab, describe, main]);
  assert.deepEqual(c.chosen, []);
  assert.deepEqual(printed(c.code, c.names, main), ["true", 'set of(["a", "b"])']);
});

// C70 (GAPS.md round 6 N1): a generic definition that only passes its
// values on (`map` over pairs holding a set, a helper giving the pair's
// second) never sees the tree, so it doesn't keep the definition; one
// that shows them, through another definition, still does.
test("a set handed to definitions that never look at it keeps the tree (C70)", () => {
  const program = (look: boolean) => {
    const k = new Lang(LIBRARY.code);
    const seen = k.def("seen");
    k.define(seen, k.fold(k.call(S.range, k.lit(300)), [
      { variant: NIL, names: [], body: () => k.x(L("empty set")) },
      { variant: CONS, names: ["i", "rest"], results: [null, "s"], body: ([i], [, s]) => k.call(L("add item"), s!, i) },
    ]));
    const second = k.def("second");
    k.define(second, k.fn(["p"], (p) => k.match(p, [{ variant: PAIR_V, names: ["a", "b"], body: ([, b]) => b }])));
    const describe = k.def("describe");
    k.define(describe, k.fn(["x"], (x) => k.call(SHOW_ANY, x)));
    const via = k.def("via");
    k.define(via, k.fn(["x"], (x) => k.call(describe, x)));
    const sizes = k.call(L("map"), k.list(k.call(PAIR_V, k.lit("s"), k.x(seen))), k.fn(["e"], (e) =>
      look ? k.call(via, e) : k.call(SHOW_ANY, k.call(L("set size"), k.call(second, e)))));
    const main = k.def("main");
    k.define(main, k.thunk(() => k.call(S.print, k.call(SHOW_ANY, k.call(PAIR_V, k.call(L("has item"), k.x(seen), k.lit(42)), sizes)))));
    const code = base(k.code), names = baseNames(k.names);
    const info = infer(code, names, undefined, checkOptions);
    assert.deepEqual(info.errors.map((e) => e.message), []);
    return { code, names, main, c: withLibraryRepresentations(code, info, names, main, [seen, second, describe, via, main]) };
  };
  const { code, names, main, c } = program(false);
  assert.deepEqual(c.chosen, ["Set as weight-balanced tree"]);
  assert.deepEqual(printed(c.code, c.names, main, c.insiders), printed(code, names, main));
  assert.deepEqual(program(true).c.chosen, []);
});

// C52: a map inside another value takes the tree too; what shows,
// compares or answers it sees the entries.
test("a list of maps, a map of maps and main's answer get the tree, and print what the definition prints", () => {
  const p = program(300, true);
  const info = infer(p.code, p.names, undefined, checkOptions);
  const c = withLibraryRepresentations(p.code, info, p.names, p.main, p.own);
  assert.deepEqual(c.chosen, ["Map as weight-balanced tree"]);
  const plain = printed(p.code, p.names, p.main);
  assert.deepEqual(printed(c.code, c.names, p.main, c.insiders), plain);
  assert.match(plain.at(-1)!, /^\[map of\(\[\("a", 1\)/);

  const k = new Lang(LIBRARY.code);
  const put = (m: Id, key: string, v: Id) => k.call(L("put"), m, k.lit(key), v);
  // The same entries put in two orders: trees of two shapes.
  const small = (first: boolean) => first ? put(put(k.x(L("empty map")), "a", k.lit(1)), "b", k.lit(2)) : put(put(k.x(L("empty map")), "b", k.lit(2)), "a", k.lit(1));
  const nested = k.def("nested"), other = k.def("other");
  k.define(nested, put(put(k.x(L("empty map")), "x", small(true)), "y", small(false)));
  k.define(other, put(put(k.x(L("empty map")), "y", small(true)), "x", small(false)));
  const main = k.def("main");
  k.define(main, k.thunk(() => k.seq(
    k.call(S.print, k.call(SHOW_ANY, k.x(nested))),
    k.call(S.print, k.call(SHOW_ANY, k.call(S.equal, k.x(nested), k.x(other)))),
    k.call(PAIR_V, k.x(nested), k.lit(1)),
  )));
  const code = base(k.code), names = baseNames(k.names);
  const i2 = infer(code, names, undefined, checkOptions);
  const c2 = withLibraryRepresentations(code, i2, names, main, [nested, other, main]);
  assert.deepEqual(c2.chosen, ["Map as weight-balanced tree"]);
  const answer = (cd: typeof code, nm: Record<Id, string>, ins: Id[]) => {
    const info = infer(cd, nm, undefined, { ...checkOptions, insiders: [...checkOptions.insiders!, ...ins] });
    assert.deepEqual(info.errors.map((e) => e.message), []);
    const lines: string[] = [];
    const v = runMain(cd, info, main, { print: (x) => lines.push(x), names: nm });
    return { lines, v };
  };
  const a = answer(code, names, []), b = answer(c2.code, c2.names, c2.insiders);
  assert.deepEqual(b.lines, a.lines);
  assert.equal(a.lines[1], "true");
  assert.deepEqual(b.v, a.v);
});

test("a set of sets keeps the definition: the tree would order its items by their shapes", () => {
  const k = new Lang(LIBRARY.code);
  const seen = k.def("seen");
  k.define(seen, k.fold(k.call(S.range, k.lit(300)), [
    { variant: NIL, names: [], body: () => k.x(L("empty set")) },
    { variant: CONS, names: ["i", "rest"], results: [null, "s"], body: ([i], [, s]) => k.call(L("add item"), s!, k.call(L("add item"), k.x(L("empty set")), i)) },
  ]));
  const main = k.def("main");
  k.define(main, k.thunk(() => k.call(S.print, k.call(SHOW_ANY, k.call(L("set size"), k.x(seen))))));
  const code = base(k.code), names = baseNames(k.names);
  const info = infer(code, names, undefined, checkOptions);
  assert.deepEqual(withLibraryRepresentations(code, info, names, main, [seen, main]).chosen, []);
});

test("a representation the program writes for Map wins", () => {
  const p = program(30);
  const info = infer(p.code, p.names, undefined, checkOptions);
  const row = { name: "mine", of: "std.map", type: "std.map", meaning: null, canonical: true, impl: {}, cost: {} };
  assert.deepEqual(withLibraryRepresentations(p.code, info, p.names, p.main, p.own, [row]).chosen, []);
});

test("the represented program compiles: JavaScript prints the same, and WebAssembly and C take the counts on the tree", async () => {
  const { mkdtempSync, writeFileSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { pathToFileURL } = await import("node:url");
  const { compile } = await import("../../compiler/src/compile.ts");
  const { lowerScalar } = await import("../../compiler/src/scalar.ts");
  const { emitC } = await import("../../compiler/src/c.ts");
  const { emitWasm } = await import("../../compiler/src/wasm.ts");
  const p = program(300);
  const c = withLibraryRepresentations(p.code, infer(p.code, p.names, undefined, checkOptions), p.names, p.main, p.own);
  const info = infer(c.code, c.names, undefined, { ...checkOptions, insiders: [...checkOptions.insiders!, ...c.insiders] });
  const runtime = pathToFileURL(join(import.meta.dirname, "../../compiler/src/runtime.js")).href;
  const path = join(mkdtempSync(join(tmpdir(), "library-reps-")), "p.js");
  writeFileSync(path, compile(c.code, info, c.names, { runtime, exports: ["main"] }));
  const lines: string[] = [];
  (await import(runtime)).$setPrint((s: string) => lines.push(s));
  ((await import(pathToFileURL(path).href)).defs as Record<string, () => unknown>).main();
  assert.deepEqual(lines, printed(p.code, p.names, p.main));
  // The counts on the tree (show isn't in WebAssembly or C yet, so not main).
  const lowered = lowerScalar(c.code, info, c.names, [p.own[0]], { data: true });
  assert.deepEqual([...lowered.refused.values()], []);
  assert.deepEqual([...emitC(lowered).refused.values()], []);
  assert.ok(WebAssembly.validate(emitWasm(lowered).bytes));
});

// GAPS.md M2: a map in a field of the program's own type. The type is
// handed to the chooser with the rest, so the field holds the tree the
// code now builds; equal, show and compare on the record see the entries.
test("a record of the program's own type holding a map gets the tree, and is equal, shown and compared by its entries", () => {
  const k = new Lang(LIBRARY.code);
  const Tally = k.type("Tally", [], [["tally", [["label", () => k.tref(STRING)], ["counts", () => k.tref("std.map", k.tref(STRING), k.tref(NUMBER))]]]]);
  const put = (m: Id, key: string, v: number) => k.call(L("put"), m, k.lit(key), k.lit(v));
  const counts = k.def("counts");
  k.define(counts, k.fold(k.call(S.range, k.lit(300)), [
    { variant: NIL, names: [], body: () => k.x(L("empty map")) },
    { variant: CONS, names: ["i", "rest"], results: [null, "m"], body: ([i], [, m]) => k.call(L("put"), m!, k.call(SHOW_ANY, k.call(S.mod, i, k.lit(40))), i) },
  ]));
  const ab = k.def("ab"), ba = k.def("ba"), abc = k.def("abc");
  // The same entries put in two orders: trees of two shapes.
  k.define(ab, k.call(Tally.v.tally, k.lit("t"), put(put(put(put(k.x(L("empty map")), "a", 1), "b", 2), "c", 3), "d", 4)));
  k.define(ba, k.call(Tally.v.tally, k.lit("t"), put(put(put(put(k.x(L("empty map")), "d", 4), "c", 3), "b", 2), "a", 1)));
  k.define(abc, k.call(Tally.v.tally, k.lit("t"), put(put(k.x(L("empty map")), "a", 1), "b", 2)));
  const show = (x: Id) => k.call(S.print, k.call(SHOW_ANY, x));
  const main = k.def("main");
  k.define(main, k.thunk(() => k.seq(
    show(k.call(L("map size"), k.x(counts))),
    show(k.x(ab)),
    show(k.call(S.equal, k.x(ab), k.x(ba))),
    show(k.call(COMPARE, k.x(ab), k.x(abc))),
    show(k.call(COMPARE, k.x(abc), k.x(ba))),
  )));
  const code = base(k.code), names = baseNames(k.names);
  const info = infer(code, names, undefined, checkOptions);
  assert.deepEqual(info.errors.map((e) => e.message), []);
  const c = withLibraryRepresentations(code, info, names, main, [Tally.def, counts, ab, ba, abc, main]);
  assert.deepEqual(c.chosen, ["Map as weight-balanced tree"]);
  const plain = printed(code, names, main);
  assert.deepEqual(printed(c.code, c.names, main, c.insiders), plain);
  assert.equal(plain[2], "true");
});

// GAPS.md M3: a match on a set's items (a map's keys or entries) that
// never uses the rest reads only the first, down the left of the tree.
test("a match on the items of a tree that doesn't use the rest takes the smallest, and prints what the definition prints", () => {
  const k = new Lang(LIBRARY.code);
  const seen = k.def("seen");
  k.define(seen, k.fold(k.call(S.range, k.lit(300)), [
    { variant: NIL, names: [], body: () => k.x(L("empty set")) },
    { variant: CONS, names: ["i", "rest"], results: [null, "s"], body: ([i], [, s]) => k.call(L("add item"), s!, k.call(S.mod, k.call(B.mul, i, k.lit(7919)), k.lit(1000))) },
  ]));
  const counts = k.def("counts");
  k.define(counts, k.call(L("as map"), k.list(k.call(PAIR_V, k.lit("b"), k.lit(2)), k.call(PAIR_V, k.lit("a"), k.lit(1)))));
  const firstOf = (list: Id, empty: Id, useRest: boolean) => k.match(list, [
    { variant: NIL, names: [], body: () => empty },
    { variant: CONS, names: ["x", "later"], body: ([x, later]) => (useRest ? later : x) },
  ]);
  const show = (x: Id) => k.call(S.print, k.call(SHOW_ANY, x));
  const main = k.def("main");
  k.define(main, k.thunk(() => k.seq(
    show(firstOf(k.call(L("items of"), k.x(seen)), k.lit(-1), false)),
    show(firstOf(k.call(L("items of"), k.x(L("empty set"))), k.lit(-1), false)),
    show(firstOf(k.call(L("items of"), k.x(seen)), k.list(), true)),
    show(firstOf(k.call(L("keys of"), k.x(counts)), k.lit("none"), false)),
    show(firstOf(k.call(L("entries of"), k.x(counts)), k.call(PAIR_V, k.lit(""), k.lit(0)), false)),
    show(k.call(L("map size"), k.x(counts))),
  )));
  const code = base(k.code), names = baseNames(k.names);
  const info = infer(code, names, undefined, checkOptions);
  const c = withLibraryRepresentations(code, info, names, main, [seen, counts, main]);
  assert.deepEqual(c.chosen, ["Map as weight-balanced tree", "Set as weight-balanced tree"]);
  const plain = printed(code, names, main);
  assert.deepEqual(printed(c.code, c.names, main, c.insiders), plain);
  assert.equal(plain[0], "0");
  // the four that don't use the rest take the head; the one that does, the list
  const heads = subtree(c.code, main).filter((x) => { const n = c.code.nodes[x]; return n.kind === "ref" && / head/.test(c.names[n.target] ?? ""); });
  assert.equal(heads.length, 4);
});

// Lists as arrays (C30d3b): a program reading a list by position gets
// `array of List`, and prints what the definition prints. Builtins that
// take or give a list (range, all) meet it through items of array and
// array of; equal, show and compare see the list.
test("a program that reads a list by position gets arrays, and prints what the definition prints", () => {
  const k = new Lang(LIBRARY.code);
  const xs = k.def("xs");
  k.define(xs, k.call(L("map"), k.call(S.range, k.lit(200)), k.fn(["i"], (i) => k.call(B.mul, i, i))));
  const total = k.def("total");
  k.define(total, k.fold(k.call(INT_OPS.range, k.int(200)), [
    { variant: NIL, names: [], body: () => k.lit(0) },
    { variant: CONS, names: ["i", "rest"], results: [null, "sum"], body: ([i], [, s]) => k.call(B.add, s!, k.call(L("item at"), k.x(xs), i, k.lit(-1))) },
  ]));
  const show = (x: Id) => k.call(S.print, k.call(SHOW_ANY, x));
  const nums = (...ns: number[]) => k.list(...ns.map((n) => k.lit(n)));
  const main = k.def("main");
  k.define(main, k.thunk(() => k.seq(
    show(k.x(total)),
    show(k.call(L("length"), k.x(xs))),
    show(k.call(L("item at"), k.x(xs), k.int(7), k.lit(-1))),
    show(nums(1, 2, 3)),
    show(k.call(S.equal, nums(1, 2), k.call(L("append"), nums(1), nums(2)))),
    show(k.call(COMPARE, nums(3), nums(1, 2))),
    show(k.call(S.all, k.thunk(() => k.call(S.oneOf, nums(4, 5))))),
    nums(9, 8),
  )));
  const code = base(k.code), names = baseNames(k.names);
  const info = infer(code, names, undefined, checkOptions);
  const before = printed(code, names, main);
  const c = withLibraryRepresentations(code, info, names, main, [xs, total, main]);
  assert.deepEqual(c.chosen, ["List as array of List"]);
  assert.deepEqual(printed(c.code, c.names, main, c.insiders), before);
  assert.deepEqual(before, ["2646700", "200", "49", "[1, 2, 3]", "true", "after", "[4, 5]"]);
  // main's answer is the list.
  const info2 = infer(c.code, c.names, undefined, { ...checkOptions, insiders: [...checkOptions.insiders!, ...c.insiders] });
  assert.equal(showValue(runMain(c.code, info2, main, { print: () => {}, names: c.names }), c.code, c.names), "[9, 8]");
});

// C30d3c: WebAssembly and C take the same choice. `array of List`'s match
// is `first of array if any`, lowered as `optional` of the array's first.
test("a program that reads a list by position and takes it apart gets arrays in WebAssembly and C too, with the evaluator's answers", async () => {
  const { lowerScalar } = await import("../../compiler/src/scalar.ts");
  const { emitC } = await import("../../compiler/src/c.ts");
  const { emitWasm, instantiate } = await import("../../compiler/src/wasm.ts");
  const k = new Lang(LIBRARY.code);
  const xs = k.def("xs");
  k.define(xs, k.call(L("map"), k.call(S.range, k.lit(50)), k.fn(["i"], (i) => k.call(B.mul, i, i))));
  const at = k.def("at");
  k.define(at, k.fn(["i"], (i) => k.call(B.add, k.call(L("item at"), k.x(xs), i, k.lit(-1)), k.lit(50))));
  // A match on the list: its first item, or 0 when there is none.
  const head = k.def("head plus");
  k.define(head, k.fn(["n"], (n) => k.match(k.x(xs), [
    { variant: NIL, names: [], body: () => n },
    { variant: CONS, names: ["x", "rest"], body: ([x]) => k.call(B.add, x, n) },
  ])));
  const main = k.def("main");
  k.define(main, k.thunk(() => k.call(S.print, k.call(SHOW_ANY, k.call(B.add, k.call(at, k.lit(3)), k.call(head, k.lit(4)))))));
  const code = base(k.code), names = baseNames(k.names);
  const info = infer(code, names, undefined, checkOptions);
  const c = withLibraryRepresentations(code, info, names, main, [xs, at, head, main]);
  assert.deepEqual(c.chosen, ["List as array of List"]);
  const info2 = infer(c.code, c.names, undefined, { ...checkOptions, insiders: [...checkOptions.insiders!, ...c.insiders] });
  const lowered = lowerScalar(c.code, info2, c.names, [at, head], { data: true });
  assert.deepEqual([...lowered.refused.values()], []);
  assert.deepEqual([...emitC(lowered).refused.values()], []);
  // The match is the array's first, as an Optional, put in place in head
  // plus (C93: a match job that isn't recursive is inlined).
  const seen = new Set<unknown>();
  const finds = (e: unknown): boolean => {
    if (!e || typeof e !== "object" || seen.has(e)) return false;
    seen.add(e);
    const x = e as { k?: string; body?: { k?: string; fn?: unknown } };
    if (x.k === "attempt" && x.body?.k === "rt" && typeof x.body.fn === "string" && x.body.fn.startsWith("array.first")) return true;
    return Object.entries(e).some(([key, v]) => key !== "t" && key !== "bt" && finds(v));
  };
  assert.ok(lowered.funcs.some((g) => g.def === head && finds(g.body)));
  const w = (await instantiate(emitWasm(lowered))) as unknown as Record<string, (x: number) => unknown>;
  const fn = (d: Id) => w[lowered.funcs.find((g) => g.def === d)!.name];
  const one = (v: unknown) => (Array.isArray(v) ? v[0] : v);
  for (const i of [0, 3, 49, 50]) assert.equal(one(fn(at)(i)), i < 50 ? i * i + 50 : 49);
  for (const n of [0, 4, 7]) assert.equal(one(fn(head)(n)), n);
});

// C93c: replace at on a list stored as an array is a job of its own,
// written into the buffer; the list it was given still reads as it was,
// in the evaluator and in WebAssembly and C (which copies unless it holds
// the only view).
test("a program that reads and replaces items by position gets arrays, and the list replaced still reads as it was, on every engine", async () => {
  const { lowerScalar } = await import("../../compiler/src/scalar.ts");
  const { emitC } = await import("../../compiler/src/c.ts");
  const { emitWasm, instantiate } = await import("../../compiler/src/wasm.ts");
  const k = new Lang(LIBRARY.code);
  const xs = k.def("xs");
  k.define(xs, k.call(L("map"), k.call(S.range, k.lit(50)), k.fn(["i"], (i) => k.call(B.mul, i, i))));
  // The new item at i, plus the old one there, plus a neighbour of the new.
  const swapped = k.def("swapped");
  k.define(swapped, k.fn(["i"], (i) => k.let("ys", k.call(L("replace at"), k.x(xs), i, k.lit(1000)), (ys) =>
    k.call(B.add, k.call(B.add, k.call(L("item at"), ys, i, k.lit(-1)), k.call(L("item at"), k.x(xs), i, k.lit(-1))), k.call(L("item at"), ys, k.int(2), k.lit(-1))))));
  const main = k.def("main");
  k.define(main, k.thunk(() => k.call(S.print, k.call(SHOW_ANY, k.list(...[0, 2, 49, 50].map((i) => k.call(swapped, k.int(i))))))));
  const code = base(k.code), names = baseNames(k.names);
  const info = infer(code, names, undefined, checkOptions);
  const before = printed(code, names, main);
  assert.deepEqual(before, ["[1004, 2004, 3405, 2]"]);
  const c = withLibraryRepresentations(code, info, names, main, [xs, swapped, main]);
  assert.deepEqual(c.chosen, ["List as array of List"]);
  assert.deepEqual(printed(c.code, c.names, main, c.insiders), before);
  const info2 = infer(c.code, c.names, undefined, { ...checkOptions, insiders: [...checkOptions.insiders!, ...c.insiders] });
  const lowered = lowerScalar(c.code, info2, c.names, [swapped], { data: true });
  assert.deepEqual([...lowered.refused.values()], []);
  assert.deepEqual([...emitC(lowered).refused.values()], []);
  const w = (await instantiate(emitWasm(lowered))) as unknown as Record<string, (x: unknown) => unknown>;
  const f = lowered.funcs.find((g) => g.def === swapped && !g.inner)!;
  const toInt = (await import("../../compiler/src/wasm.ts")).toInt;
  assert.deepEqual([0n, 2n, 49n, 50n].map((i) => w[f.name](toInt(w as never, i))), [1004, 2004, 3405, 2]);
  // C replaces in place only with one holder: xs is held, so it copies, and frees what it made.
  const { build, skip } = await import("../../compiler/test/c-harness.ts");
  if (skip) return;
  const i = lowered.funcs.indexOf(f);
  assert.deepEqual(build(lowered)([0n, 2n, 49n, 50n].map((x) => [i, [x]])), [1004, 2004, 3405, 2].map((value) => ({ value, live: 0 })));
});

// A Set holds a list as written (its constructor's field), so lists as
// arrays wait until the Set is stored some other way: chosen first, as a
// tree, then lists on what that made (C93). The answer is the same.
test("a program whose lists meet a set gets the set as a tree, then lists as arrays, with the same answer (C93)", () => {
  const k = new Lang(LIBRARY.code);
  const xs = k.def("xs");
  k.define(xs, k.call(S.range, k.lit(50)));
  const main = k.def("main");
  k.define(main, k.thunk(() => k.call(S.print, k.call(SHOW_ANY, k.call(PAIR_V, k.call(L("item at"), k.x(xs), k.int(3), k.lit(0)), k.call(L("set size"), k.call(L("as set"), k.x(xs))))))));
  const code = base(k.code), names = baseNames(k.names);
  const info = infer(code, names, undefined, checkOptions);
  assert.deepEqual(info.errors.map((e) => e.message), []);
  const c = withLibraryRepresentations(code, info, names, main, [xs, main]);
  assert.deepEqual(c.chosen, ["Set as weight-balanced tree", "List as array of List"]);
  const as = (cd: typeof code, nm: typeof names, i: typeof info) => { const lines: string[] = []; runMain(cd, i, main, { print: (x) => lines.push(x), names: nm }); return lines; };
  assert.deepEqual(as(c.code, c.names, c.info!), as(code, names, info));
  assert.deepEqual(as(code, names, info), ["(3, 50)"]);
});

// I105: a choice that doesn't check is no choice, and isn't reported.
// chapters once failed its check with lists as arrays; since C93 (a list of
// lists is no reason to keep List) it takes them and checks, and
// examples-agree runs it the same every way.
test("a representation the program doesn't check on is dropped, not reported; chapters checks with arrays (I105, C93)", async () => {
  const { join } = await import("node:path");
  const { loadProgram } = await import("../src/lang/load.ts");
  const p = loadProgram(join(import.meta.dirname, "../examples/chapters"));
  const names = p.pres.names, info = infer(p.code, names, undefined, p.options);
  assert.deepEqual(info.errors.map((e) => e.message), []);
  const main = p.named("main");
  const c = withLibraryRepresentations(p.code, info, names, main, p.own.defs);
  assert.deepEqual(c.chosen, ["List as array of List"]);
  assert.deepEqual(c.info!.errors.map((e) => e.message), []);
});

// I106: a cons onto a match's rest copies the array (the rest is a view
// the list it came from still sees), so a program that pops and pushes
// keeps cons cells, even though it also reads by position.
test("a program that conses onto a match's rest keeps List as written, and the chooser says why (I106)", async () => {
  const { choose, ontoField } = await import("../src/lang/represent.ts");
  const k = new Lang(LIBRARY.code);
  const xs = k.def("xs");
  k.define(xs, k.call(S.range, k.lit(50)));
  // Replace the head: x :: rest becomes (x + 1) :: rest.
  const bump = k.def("bump");
  k.define(bump, k.fn(["list"], (l) => k.match(l, [
    { variant: NIL, names: [], body: () => k.x(NIL) },
    { variant: CONS, names: ["x", "rest"], body: ([x, rest]) => k.call(CONS, k.call(B.add, x, k.lit(1)), rest) },
  ])));
  const main = k.def("main");
  k.define(main, k.thunk(() => k.call(S.print, k.call(SHOW_ANY, k.call(L("item at"), k.call(bump, k.x(xs)), k.lit(0), k.lit(-1))))));
  const code = base(k.code), names = baseNames(k.names);
  const info = infer(code, names, undefined, checkOptions);
  assert.deepEqual(info.errors.map((e) => e.message), []);
  const reps = LIBRARY.reps.filter((r) => r.name === "array of List" || (r.of === LIST && r.canonical));
  const c = choose(code, main, reps);
  assert.ok(c.jobs.includes(ontoField(CONS, 1)), String(c.jobs));
  const row = (n: string) => c.table.find((r) => r.rep === n)!.costs[ontoField(CONS, 1)];
  assert.equal(row("array of List"), "n");
  assert.equal(row("List as written"), "1");
  assert.equal(c.rep.name, "List as written");
  assert.ok(!withLibraryRepresentations(code, info, names, main, [xs, bump, main]).chosen.includes("List as array of List"));
});

// A list with xs appended `times` times, in a loop: on an array each append
// copies (n), on a tree it's log n.
function appendedInLoop(k: Lang, xs: Id, times = 4): Id {
  const grown = k.def("grown");
  k.define(grown, k.fold(k.call(INT_OPS.range, k.int(times)), [
    { variant: NIL, names: [], body: () => k.x(xs) },
    { variant: CONS, names: ["i", "rest"], results: [null, "so far"], body: (_, [, l]) => k.call(L("append"), l!, k.x(xs)) },
  ]));
  return grown;
}

// C45: a program that changes a list by position and appends in a loop gets
// `tree of List`, where each change is log n (the cons cells walk, the
// array copies on append: n² both), and prints what the definition prints.
// Changing by position alone gets arrays (C93c).
function byPosition(n: number) {
  const k = new Lang(LIBRARY.code);
  const xs = k.def("xs");
  k.define(xs, k.call(L("map"), k.call(S.range, k.lit(n)), k.fn(["i"], (i) => k.call(B.mul, i, k.lit(0)))));
  // Each i adds i to the item at 7i mod n.
  const counted = k.def("counted");
  k.define(counted, k.fold(k.call(INT_OPS.range, k.int(3 * n)), [
    { variant: NIL, names: [], body: () => k.x(xs) },
    { variant: CONS, names: ["i", "rest"], results: [null, "so far"], body: ([i], [, l]) => k.let("at", k.call(S.first, k.thunk(() => k.call(INT_OPS.remainder, k.call(INT_OPS.mul, i, k.int(7)), k.int(n))), k.thunk(() => k.int(0))), (at) =>
      k.call(L("replace at"), l!, at, k.call(B.add, k.call(L("item at"), l!, at, k.lit(0)), k.call(INT_OPS.toNumber, i)))) },
  ]));
  // And appends in a loop, n each on an array (C93c made replacing 1 there).
  const grown = appendedInLoop(k, xs);
  const at = k.def("at");
  k.define(at, k.fn(["i"], (i) => k.call(L("item at"), k.x(counted), i, k.lit(-1))));
  const show = (x: Id) => k.call(S.print, k.call(SHOW_ANY, x));
  const main = k.def("main");
  k.define(main, k.thunk(() => k.seq(
    show(k.call(at, k.int(3))),
    show(k.call(L("length"), k.call(L("append"), k.x(counted), k.x(xs)))),
    show(k.call(L("replace at"), k.list(k.lit(1), k.lit(2), k.lit(3)), k.int(1), k.lit(9))),
    show(k.call(L("replace at"), k.list(k.lit(1), k.lit(2)), k.lit(5), k.lit(9))),
    show(k.call(S.equal, k.x(counted), k.call(L("reverse"), k.call(L("reverse"), k.x(counted))))),
    show(k.call(L("sum"), k.x(counted))),
    show(k.call(L("length"), k.x(grown))),
  )));
  const code = base(k.code), names = baseNames(k.names);
  return { code, names, main, at, defs: [xs, counted, grown, at, main], info: infer(code, names, undefined, checkOptions) };
}

test("a program that changes a list by position in a loop gets trees, and prints what the definition prints (C45)", () => {
  const { code, names, main, defs, info } = byPosition(40);
  assert.deepEqual(info.errors.map((e) => e.message), []);
  const before = printed(code, names, main);
  const c = withLibraryRepresentations(code, info, names, main, defs);
  assert.deepEqual(c.chosen, ["List as tree of List"]);
  assert.deepEqual(printed(c.code, c.names, main, c.insiders), before);
  assert.deepEqual(before.slice(1, 5), ["80", "[1, 9, 3]", "[1, 2]", "true"]);
  assert.equal(before[5], String((120 * 119) / 2));
});

test("lists as trees lower to WebAssembly and C too, with the evaluator's answers (C45)", async () => {
  const { lowerScalar } = await import("../../compiler/src/scalar.ts");
  const { emitC } = await import("../../compiler/src/c.ts");
  const { emitWasm, instantiate } = await import("../../compiler/src/wasm.ts");
  const { code, names, main, at, defs, info } = byPosition(40);
  const c = withLibraryRepresentations(code, info, names, main, defs);
  assert.deepEqual(c.chosen, ["List as tree of List"]);
  const info2 = infer(c.code, c.names, undefined, { ...checkOptions, insiders: [...checkOptions.insiders!, ...c.insiders] });
  const want = (i: number) => { let s = 0; for (let j = 0; j < 120; j++) if ((j * 7) % 40 === i) s += j; return i >= 0 && i < 40 ? s : -1; };
  const run = (i: number) => { const r = makeRunner(c.code, info2, { print: () => {}, names: c.names }); for (const v of r.call(r.value(at), i) as Iterable<unknown>) return v; };
  for (const i of [0, 3, 39, 40]) assert.equal(run(i), want(i));
  const lowered = lowerScalar(c.code, info2, c.names, [at], { data: true });
  assert.deepEqual([...lowered.refused.values()], []);
  assert.deepEqual([...emitC(lowered).refused.values()], []);
  const w = (await instantiate(emitWasm(lowered))) as unknown as Record<string, (x: number) => unknown>;
  const fn = w[lowered.funcs.find((g) => g.def === at)!.name];
  const one = (v: unknown) => (Array.isArray(v) ? v[0] : v);
  for (const i of [0, 3, 39, 40]) assert.equal(one(fn(i)), want(i));
});

// C75: a fold whose cases don't read the rest (sum's) walks the tree's
// items, fold(meaning(x)), where the tree's own fold rebuilds each arm's
// rest as a tree (n log n, and slow: 1,770 ms for 8,000 items against the
// walk's 17.5 ms in REVIEW-2026-11-01b §4).
test("a fold over a list stored as a tree that doesn't read the rest walks its items (C75)", () => {
  const { code, names, main, defs, info } = byPosition(40);
  const c = withLibraryRepresentations(code, info, names, main, defs);
  assert.deepEqual(c.chosen, ["List as tree of List"]);
  const named = (n: string) => Object.keys(c.names).find((d) => c.names[d] === n && c.code.nodes[d]?.kind === "def")!;
  const items = named("items of list tree");
  // The program's own copy of sum, which the rewrite changes.
  const sum = c.code.defs.find((d) => c.names[d] === "sum" && d !== L("sum"))!;
  const fold = subtree(c.code, sum).map((x) => c.code.nodes[x]).find((n) => n.kind === "fold")!;
  const by = c.code.nodes[(fold as { scrutinee: Id }).scrutinee];
  assert.ok(by.kind === "call" && (c.code.nodes[by.fn] as { target?: Id }).target === items, "sum's fold is over the tree's items");
  const info2 = infer(c.code, c.names, undefined, { ...checkOptions, insiders: [...checkOptions.insiders!, ...c.insiders] });
  const r = makeRunner(c.code, info2, { print: () => {}, names: c.names });
  const one = (x: unknown) => { for (const v of x as Iterable<unknown>) return v; };
  let t = r.value(named("list tree nil"));
  for (let i = 0; i < 8000; i++) t = one(r.call(r.value(named("list tree cons")), i, t)) as typeof t;
  const time = (f: () => unknown) => { let best = Infinity; for (let b = 0; b < 3; b++) { const s = performance.now(); f(); best = Math.min(best, performance.now() - s); } return best; };
  let total: unknown;
  const summed = time(() => (total = one(r.call(r.value(sum), t))));
  const walked = time(() => one(r.call(r.value(items), t)));
  assert.equal(total, (8000 * 7999) / 2);
  assert.ok(summed < 10 * walked + 20, `summing 8,000 items took ${summed.toFixed(1)} ms, walking them ${walked.toFixed(1)} ms`);
});

// C76: a whole list handed to a row that stores lists as trees is stored by
// the row's own `store by`, a balanced build in n steps (a binary counter
// of finished trees, as Haskell's containers builds from a sorted list),
// where it was one cons a time, each relinking the tree (n log n).
test("a list stored as a tree is built by the row's own store, balanced, in n steps (C76)", () => {
  const { code, names, main, defs, info } = byPosition(40);
  const c = withLibraryRepresentations(code, info, names, main, defs);
  assert.deepEqual(c.chosen, ["List as tree of List"]);
  const named = (n: string) => Object.keys(c.names).find((d) => c.names[d] === n && c.code.nodes[d]?.kind === "def")!;
  assert.equal(named("stored list"), undefined, "no cons-a-time rebuild is written");
  const info2 = infer(c.code, c.names, undefined, { ...checkOptions, insiders: [...checkOptions.insiders!, ...c.insiders] });
  const r = makeRunner(c.code, info2, { print: () => {}, names: c.names });
  const one = (x: unknown) => { for (const v of x as Iterable<Value>) return v as Value; return undefined as unknown as Value; };
  const list = (n: number): Value => { let l: Value = { tag: NIL, fields: [] }; for (let i = n - 1; i >= 0; i--) l = { tag: CONS, fields: [i, l] }; return l; };
  const back = (l: unknown) => { const xs: unknown[] = []; for (let c = l as { tag: Id; fields: unknown[] }; c.tag === CONS; c = c.fields[1] as typeof c) xs.push(c.fields[0]); return xs; };
  const store = r.value(named("list tree of list")), items = r.value(named("items of list tree"));
  for (const n of [0, 1, 2, 3, 7, 8, 9, 100]) assert.deepEqual(back(one(r.call(items, one(r.call(store, list(n)))))), Array.from({ length: n }, (_, i) => i), `${n} items`);
  const time = (f: () => unknown) => { let best = Infinity; for (let b = 0; b < 3; b++) { const s = performance.now(); f(); best = Math.min(best, performance.now() - s); } return best; };
  const big = list(8000);
  const stored = time(() => one(r.call(store, big)));
  const consed = time(() => { let t = r.value(named("list tree nil")); for (let i = 7999; i >= 0; i--) t = one(r.call(r.value(named("list tree cons")), i, t)) as typeof t; });
  assert.ok(stored < consed, `storing 8,000 items took ${stored.toFixed(1)} ms, consing them ${consed.toFixed(1)} ms`);
});

// C93 step 2: a definition that recurs through a stored list's match, not
// in a tail call (`count(l) = match l | cons(x, r) → 1 + count(r)`), calls
// itself through the case's function when the match is the row's own
// definition, which compiled JS can't move to the heap: 50,000 items ran
// out of stack. The match is put in place, so the recursion is plain, and
// its rest still shrinks for the termination check (no Diverge).
test("a definition recurring through a stored list's match runs 50,000 deep compiled, and still surely finishes (C93)", async () => {
  const { compile } = await import("../../compiler/src/compile.ts");
  const { $setPrint } = await import("../../compiler/src/runtime.js");
  const { mkdtempSync, writeFileSync } = await import("node:fs");
  const { join } = await import("node:path");
  const { tmpdir } = await import("node:os");
  const { pathToFileURL } = await import("node:url");
  const k = new Lang(LIBRARY.code);
  const xs = k.def("xs");
  k.define(xs, k.call(S.range, k.lit(25000)));
  const changed = k.def("changed");
  k.define(changed, k.fold(k.call(INT_OPS.range, k.int(100)), [
    { variant: NIL, names: [], body: () => k.x(xs) },
    { variant: CONS, names: ["i", "rest"], results: [null, "so far"], body: ([i], [, l]) => k.call(L("replace at"), l!, k.call(INT_OPS.mul, i, k.int(7)), k.lit(9)) },
  ]));
  const grown = appendedInLoop(k, changed, 1);
  const count = k.def("count");
  k.define(count, k.fn(["l"], (l) => k.match(l, [
    { variant: NIL, names: [], body: () => k.int(0) },
    { variant: CONS, names: ["x", "r"], body: ([, r]) => k.call(INT_OPS.add, k.int(1), k.call(count, r)) },
  ])));
  const main = k.def("main");
  k.define(main, k.thunk(() => k.call(S.print, k.call(SHOW_ANY, k.call(count, k.x(grown))))));
  const code = base(k.code), names = baseNames(k.names);
  const info = infer(code, names, undefined, checkOptions);
  assert.deepEqual(info.errors.map((e) => e.message), []);
  const c = withLibraryRepresentations(code, info, names, main, [xs, changed, grown, count, main]);
  assert.deepEqual(c.chosen, ["List as tree of List"]);
  const info2 = infer(c.code, c.names, undefined, { ...checkOptions, insiders: [...checkOptions.insiders!, ...c.insiders] });
  assert.deepEqual(info2.errors.map((e) => e.message), []);
  const t = info2.subst.zonk(info2.typeOf.get(count)!);
  assert.ok(t.t === "fn" && !info2.subst.resolveRow(t.eff).effs.includes(DIVERGE), "count surely finishes");
  const path = join(mkdtempSync(join(tmpdir(), "deep-")), "m.js");
  writeFileSync(path, compile(c.code, info2, c.names, { runtime: pathToFileURL(join(import.meta.dirname, "../../compiler/src/runtime.js")).href, exports: ["main"] }));
  const out: string[] = [];
  $setPrint((s: string) => out.push(s));
  const m = (await import(pathToFileURL(path).href)).defs.main;
  if (typeof m === "function") m();
  assert.deepEqual(out.join("").trim(), "50000");
});
