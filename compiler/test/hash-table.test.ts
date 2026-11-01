// Map as a hash table changed in place (BACKLOG C63b, IN-PLACE.md step 2):
// chosen where its keys are Ints or Texts and the program runs where std's
// Table is (the evaluator and compiled JavaScript). A program with Float64
// keys keeps the tree. Since C71 every version of a table stays a value
// (std.ts Table, rerooted), so a program that reads an old version of a
// map after a put gets the table too and prints the same.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { B } from "../../ters/src/prelude.ts";
import { Lang } from "../../ters/src/lang/dsl.ts";
import { infer } from "../../ters/src/lang/infer.ts";
import { runMain } from "../../ters/src/lang/run.ts";
import { base, baseNames, checkOptions } from "../../ters/src/lang/load.ts";
import { LIBRARY } from "../../ters/src/lang/library.ts";
import { withLibraryRepresentations } from "../../ters/src/lang/library-reps.ts";
import { CONS, INT_OPS, NIL, S, SHOW_ANY } from "../../ters/src/lang/std.ts";
import type { Id } from "../../ters/src/model.ts";
import { compile } from "../src/compile.ts";
import { $setPrint } from "../src/runtime.js";

const L = (name: string) => LIBRARY.modules[0].exports.find((d) => LIBRARY.names[d] === name)!;

// Counts n keys (Ints, or Float64s with `floats`), then shows the count,
// a few lookups and whether keys are there. With `old`, it also keeps the
// map before one more put and shows both.
function program(n: number, opts: { floats?: boolean; old?: boolean; remove?: boolean; list?: boolean } = {}) {
  const k = new Lang(LIBRARY.code);
  const key = (i: Id) => opts.floats ? k.call(B.mul, k.call(S.mod, i, k.lit(37)), k.lit(0.5)) : k.call(INT_OPS.shiftDown, i, k.int(1));
  const counts = k.def("counts");
  k.define(counts, k.fold(opts.floats ? k.call(S.range, k.lit(n)) : k.call(INT_OPS.range, k.int(n)), [
    { variant: NIL, names: [], body: () => k.x(L("empty map")) },
    { variant: CONS, names: ["i", "rest"], results: [null, "counted"], body: ([i], [, m]) => k.let("key", key(i), (w) =>
      k.call(L("put"), m!, w, k.call(INT_OPS.add, k.call(S.first, k.thunk(() => k.call(L("value at"), m!, w)), k.thunk(() => k.int(0))), k.int(1)))) },
  ]));
  const show = (x: Id) => k.call(S.print, k.call(SHOW_ANY, x));
  const at = (m: Id, x: Id) => k.call(S.first, k.thunk(() => k.call(L("value at"), m, x)), k.thunk(() => k.int(-1)));
  const probe = opts.floats ? k.lit(2.5) : k.int(5);
  const main = k.def("main");
  k.define(main, k.thunk(() => k.let("m", k.x(counts), (m) => k.seq(
    show(k.call(L("map size"), m)),
    show(at(m, probe)),
    show(k.call(L("has key"), m, probe)),
    ...(opts.old ? [k.let("more", k.call(L("put"), m, probe, k.int(1000)), (more) => k.seq(show(at(more, probe)), show(at(m, probe))))] : []),
    ...(opts.list ? [show(k.call(L("entries of"), m))] : []),
    ...(opts.remove ? [k.let("less", k.call(L("remove key"), m, probe), (less) => k.seq(show(k.call(L("map size"), less)), show(k.call(L("has key"), less, probe))))] : []),
  ))));
  return { code: base(k.code), names: baseNames(k.names), main, own: [counts, main] };
}

function chosen(p: ReturnType<typeof program>, hostMaps = true) {
  const info = infer(p.code, p.names, undefined, checkOptions);
  assert.deepEqual(info.errors.map((e) => e.message), []);
  return withLibraryRepresentations(p.code, info, p.names, p.main, p.own, [], { hostMaps });
}

const printed = (code: ReturnType<typeof program>["code"], names: Record<Id, string>, main: Id, insiders: Id[] = []) => {
  const info = infer(code, names, undefined, { ...checkOptions, insiders: [...checkOptions.insiders!, ...insiders] });
  assert.deepEqual(info.errors.map((e) => e.message), []);
  const lines: string[] = [];
  runMain(code, info, main, { print: (s) => lines.push(s), names });
  return { lines, info };
};

test("a map only built, looked up and changed by its one holder is a hash table, and prints what the definition prints", () => {
  for (const remove of [false, true]) {
    const p = program(300, { remove });
    const c = chosen(p);
    assert.deepEqual(c.chosen, ["Map as hash table"]);
    assert.deepEqual(printed(c.code, c.names, p.main, c.insiders).lines, printed(p.code, p.names, p.main).lines);
  }
});

// C63c: its puts and lookups run once per item, in the fold; the listing,
// n log n on the table, runs once. The chooser weighs a job in a loop by
// n, so the table still wins.
test("a map listed once after its puts and lookups in a loop is a hash table too, and lists its entries in order", () => {
  const p = program(300, { list: true });
  const c = chosen(p);
  assert.deepEqual(c.chosen, ["Map as hash table"]);
  assert.deepEqual(printed(c.code, c.names, p.main, c.insiders).lines, printed(p.code, p.names, p.main).lines);
});

test("where there is no host Map (WebAssembly, C), or its keys are Float64s, it keeps the tree", () => {
  assert.deepEqual(chosen(program(300), false).chosen, ["Map as weight-balanced tree"]);
  assert.deepEqual(chosen(program(300, { floats: true })).chosen, ["Map as weight-balanced tree"]);
});

// C71: the old version, read after a put and a remove on it, still says
// what it said: the table undoes the changes to read it (std.ts reroot).
test("a map whose old version is read again is a hash table, and prints what the definition prints (C71)", () => {
  const p = program(300, { old: true, remove: true });
  const c = chosen(p);
  assert.deepEqual(c.chosen, ["Map as hash table"]);
  const want = printed(p.code, p.names, p.main).lines;
  assert.deepEqual(printed(c.code, c.names, p.main, c.insiders).lines, want);
  assert.deepEqual(want.slice(3, 5), ["1000", "2"]);
});

test("compiled JavaScript on the hash table prints what the evaluator prints", async () => {
  const p = program(300, { remove: true });
  const c = chosen(p);
  const { lines, info } = printed(c.code, c.names, p.main, c.insiders);
  const source = compile(c.code, info, c.names, { runtime: pathToFileURL(join(import.meta.dirname, "../src/runtime.js")).href, exports: ["main"] });
  const file = join(mkdtempSync(join(tmpdir(), "hash-table-")), "counts.js");
  writeFileSync(file, source);
  const defs = (await import(pathToFileURL(file).href)).defs as Record<string, () => void>;
  const got: string[] = [];
  $setPrint((s: string) => got.push(s));
  defs.main();
  assert.deepEqual(got, lines);
});

// Set as a hash table (C63d): the same, for a set of Ints built by adding
// in a fold, then asked about, listed and taken apart.
function setProgram(n: number, opts: { old?: boolean } = {}) {
  const k = new Lang(LIBRARY.code);
  const seen = k.def("seen");
  k.define(seen, k.fold(k.call(INT_OPS.range, k.int(n)), [
    { variant: NIL, names: [], body: () => k.x(L("empty set")) },
    { variant: CONS, names: ["i", "rest"], results: [null, "added"], body: ([i], [, s]) => k.call(L("add item"), s!, k.call(INT_OPS.shiftDown, i, k.int(2))) },
  ]));
  const show = (x: Id) => k.call(S.print, k.call(SHOW_ANY, x));
  const main = k.def("main");
  k.define(main, k.thunk(() => k.let("s", k.x(seen), (s) => k.seq(
    show(k.call(L("set size"), s)),
    show(k.call(L("has item"), s, k.int(7))),
    show(k.call(L("has item"), s, k.int(5000))),
    ...(opts.old ? [k.let("more", k.call(L("add item"), s, k.int(5000)), (more) => k.seq(show(k.call(L("has item"), more, k.int(5000))), show(k.call(L("has item"), s, k.int(5000)))))] : []),
    k.let("less", k.call(L("remove item"), s, k.int(7)), (less) => k.seq(show(k.call(L("set size"), less)), show(k.call(L("has item"), less, k.int(7))))),
  ))));
  return { code: base(k.code), names: baseNames(k.names), main, own: [seen, main] };
}

test("a set only built, asked and changed by its one holder is a hash table, compiled and evaluated the same; one whose old version is read again too", async () => {
  const p = setProgram(400);
  const c = chosen(p);
  assert.deepEqual(c.chosen, ["Set as hash table"]);
  const { lines, info } = printed(c.code, c.names, p.main, c.insiders);
  assert.deepEqual(lines, printed(p.code, p.names, p.main).lines);
  assert.deepEqual(lines, ["100", "true", "false", "99", "false"]);
  const source = compile(c.code, info, c.names, { runtime: pathToFileURL(join(import.meta.dirname, "../src/runtime.js")).href, exports: ["main"] });
  const file = join(mkdtempSync(join(tmpdir(), "hash-set-")), "seen.js");
  writeFileSync(file, source);
  const defs = (await import(pathToFileURL(file).href)).defs as Record<string, () => void>;
  const got: string[] = [];
  $setPrint((s: string) => got.push(s));
  defs.main();
  assert.deepEqual(got, lines);
  assert.deepEqual(chosen(setProgram(400), false).chosen, ["Set as weight-balanced tree"]);
  // An old version read again (C71): the table, and the same answers.
  const old = setProgram(400, { old: true }), o = chosen(old);
  assert.deepEqual(o.chosen, ["Set as hash table"]);
  assert.deepEqual(printed(o.code, o.names, old.main, o.insiders).lines, printed(old.code, old.names, old.main).lines);
});
