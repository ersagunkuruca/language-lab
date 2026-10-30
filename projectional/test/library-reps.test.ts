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
import { runMain } from "../src/lang/run.ts";
import { base, baseNames, checkOptions } from "../src/lang/load.ts";
import { LIBRARY } from "../src/lang/library.ts";
import { withLibraryRepresentations } from "../src/lang/library-reps.ts";
import { COMPARE, CONS, NIL, PAIR_V, S, SHOW_ANY } from "../src/lang/std.ts";
import { NUMBER, STRING } from "../src/lang/types.ts";
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
const printed = (code: ReturnType<typeof program>["code"], names: Record<Id, string>, main: Id, insiders: Id[] = []) => {
  const info = infer(code, names, undefined, { ...checkOptions, insiders: [...checkOptions.insiders!, ...insiders] });
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

// C52: a map inside another value takes the tree too; what shows,
// compares or answers it sees the entries.
test("a list of maps, a map of maps and main's answer get the tree, and print what the definition prints", () => {
  const p = program(300, true);
  const info = infer(p.code, p.names, undefined, checkOptions);
  const c = withLibraryRepresentations(p.code, info, p.names, p.main, p.own);
  assert.deepEqual(c.chosen, ["Map as weight-balanced tree"]);
  const plain = printed(p.code, p.names, p.main);
  assert.deepEqual(printed(c.code, c.names, p.main, c.insiders), plain);
  assert.match(plain.at(-1)!, /^\[map of\(\[pair\("a", 1\)/);

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
