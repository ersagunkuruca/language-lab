// C358: a Map's representation chosen per key type (map-groups.ts). A
// count by word, put into and read in a loop, and a map by number whose
// smallest key is taken in a loop: the first a hash table, the second a
// tree, and the program prints what the definition prints.
import { test } from "node:test";
import assert from "node:assert/strict";
import { Lang } from "../src/lang/dsl.ts";
import { infer } from "../src/lang/infer.ts";
import { runMain } from "../src/lang/run.ts";
import { base, baseNames, checkOptions } from "../src/lang/load.ts";
import { LIBRARY } from "../src/lang/library.ts";
import { withLibraryRepresentations } from "../src/lang/library-reps.ts";
import { keyGroups } from "../src/lang/map-groups.ts";
import { CONS, INT_OPS, MAP, NIL, NONE, S, SHOW_ANY, SOME } from "../src/lang/std.ts";
import { INT, STRING } from "../src/lang/types.ts";
import type { Code, Id } from "../src/model.ts";

const L = (name: string) => LIBRARY.modules[0].exports.find((d) => LIBRARY.names[d] === name)!;

function program(n: number) {
  const k = new Lang(LIBRARY.code);
  // Words counted: put and value at once per item.
  const counts = k.def("counts");
  k.define(counts, k.fold(k.call(INT_OPS.range, k.lit(n)), [
    { variant: NIL, names: [], body: () => k.x(L("empty map")) },
    { variant: CONS, names: ["i", "rest"], results: [null, "counted"], body: ([i], [, m]) => k.let("word", k.call(INT_OPS.show, k.call(INT_OPS.remainder, k.call(INT_OPS.mul, i, k.lit(7919)), k.lit(17))), (w) =>
      k.call(L("put"), m!, w, k.call(INT_OPS.add, k.call(S.first, k.thunk(() => k.call(L("value at"), m!, w)), k.thunk(() => k.lit(0))), k.lit(1)))) },
  ]));
  // A map by number, emptied smallest first: its smallest key in a loop.
  const byNumber = k.def("by number");
  k.define(byNumber, k.fold(k.call(INT_OPS.range, k.lit(n)), [
    { variant: NIL, names: [], body: () => k.x(L("empty map")) },
    { variant: CONS, names: ["i", "rest"], results: [null, "made"], body: ([i], [, m]) => k.call(L("put"), m!, k.call(INT_OPS.remainder, k.call(INT_OPS.mul, i, k.lit(31)), k.lit(11)), k.call(INT_OPS.show, i)) },
  ]));
  const drained = k.def("drained");
  k.define(drained, k.fn(["m"], (m) => k.match(k.call(S.optional, k.thunk(() => k.call(L("smallest key"), m))), [
    { variant: NONE, names: [], body: () => k.lit(0) },
    { variant: SOME, names: ["key"], body: ([key]) => k.call(INT_OPS.add, key, k.call(drained, k.call(L("remove key"), m, key))) },
  ])));
  const show = (x: Id) => k.call(S.print, k.call(SHOW_ANY, x));
  const main = k.def("main");
  k.define(main, k.thunk(() => k.seq(
    show(k.call(L("map size"), k.x(counts))),
    show(k.x(counts)),
    show(k.x(byNumber)),
    show(k.call(drained, k.x(byNumber))),
  )));
  return { code: base(k.code), names: baseNames(k.names), main, own: [counts, byNumber, drained, main] };
}

const printed = (code: Code, names: Record<Id, string>, main: Id, insiders: Id[] = []) => {
  const info = infer(code, names, undefined, { ...checkOptions, insiders: [...checkOptions.insiders!, ...insiders] });
  assert.deepEqual(info.errors.map((e) => e.message), []);
  const lines: string[] = [];
  runMain(code, info, main, { print: (s) => lines.push(s), names });
  return lines;
};

test("a Map's sites are grouped by their key type", () => {
  const p = program(40);
  const info = infer(p.code, p.names, undefined, checkOptions);
  const jobs = new Set(LIBRARY.reps.filter((r) => r.of === MAP).flatMap((r) => Object.keys(r.cost)));
  const g = keyGroups(p.code, info, [p.main, ...p.own], MAP, jobs)!;
  assert.deepEqual([...g.heads].sort(), [INT, STRING].sort());
});

test("a count by word is a hash table and a map emptied smallest first a tree, printing what the definition prints", () => {
  const p = program(60);
  const info = infer(p.code, p.names, undefined, checkOptions);
  const c = withLibraryRepresentations(p.code, info, p.names, p.main, p.own, [], { hostMaps: true });
  assert.deepEqual(c.chosen, ["Map as hash table for Text keys", "Map as weight-balanced tree for Int keys"]);
  assert.deepEqual(printed(c.code, c.names, p.main, c.insiders), printed(p.code, p.names, p.main));
});

test("without host maps there is no hash table, and one choice for every Map", () => {
  const p = program(60);
  const info = infer(p.code, p.names, undefined, checkOptions);
  const c = withLibraryRepresentations(p.code, info, p.names, p.main, p.own);
  assert.deepEqual(c.chosen, ["Map as weight-balanced tree"]);
});
