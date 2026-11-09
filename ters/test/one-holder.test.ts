// Does every map have one holder? (one-holder.ts, BACKLOG C63.) A program
// that keeps an old version of a map, gives it twice, or keeps it in a
// closure fails the check; one that reads a map and then changes it, or
// changes one field of a record and rebuilds it, passes; and so do the
// examples whose maps are only ever passed on, routes among them.

import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { B } from "../src/prelude.ts";
import { Lang } from "../src/lang/dsl.ts";
import { infer } from "../src/lang/infer.ts";
import { base, baseNames, checkOptions, loadProgram } from "../src/lang/load.ts";
import { LIBRARY } from "../src/lang/library.ts";
import { oneHolder } from "../src/lang/one-holder.ts";
import { ARRAY_OPS, MAP, PAIR_V, S, SET_TYPE, SHOW_ANY } from "../src/lang/std.ts";
import { ARRAY, INT, STRING } from "../src/lang/types.ts";
import type { Code, Id } from "../src/model.ts";
import type { Info } from "../src/lang/infer.ts";

const L = (n: string) => LIBRARY.modules.flatMap((m) => m.exports).find((d) => LIBRARY.names[d] === n)!;
const row = LIBRARY.reps.find((r) => r.name === "weight-balanced tree" && r.of === MAP)!;
const jobs = new Set(Object.keys(row.impl));
const changes = new Map([[L("put"), 0], [L("update at"), 0], [L("remove key"), 0]]);
const check = (code: Code, info: Info, main: Id, names: Record<Id, string>) => oneHolder(code, info, main, new Set([MAP]), jobs, changes, names);

// A program with main written by `body`, checked.
function program(body: (k: Lang, m: Id) => Id, extra?: (k: Lang) => void) {
  const k = new Lang(LIBRARY.code);
  extra?.(k);
  const main = k.def("main");
  k.define(main, k.thunk(() => k.let("m", k.call(L("put"), k.x(L("empty map")), k.lit(1), k.lit(10)), (m) => body(k, m))));
  const code = base(k.code), names = baseNames(k.names), info = infer(code, names, undefined, checkOptions);
  assert.deepEqual(info.errors.map((e) => e.message), []);
  return check(code, info, main, names);
}
const put = (k: Lang, m: Id, key: number, v: number) => k.call(L("put"), m, k.lit(key), k.lit(v));
const show = (k: Lang, x: Id) => k.call(SHOW_ANY, x);

test("a map read and then changed, or changed and passed on, has one holder", () => {
  assert.equal(program((k, m) => show(k, put(k, m, 2, 20))).ok, true);
  // Read, then changed: the read comes first.
  assert.equal(program((k, m) => k.let("n", k.call(S.first, k.thunk(() => k.call(L("value at"), m, k.lit(1))), k.thunk(() => k.lit(0))), (n) => show(k, k.call(L("put"), m, k.lit(2), n)))).ok, true);
  // put(m, k, value at(m, k) + 1): the value is read before the change.
  assert.equal(program((k, m) => show(k, k.call(L("put"), m, k.lit(1), k.call(B.add, k.call(S.first, k.thunk(() => k.call(L("value at"), m, k.lit(1))), k.thunk(() => k.lit(0))), k.lit(1))))).ok, true);
});

test("a map kept after it was changed, given twice, or kept in a closure has more than one holder", () => {
  // The old version shown after the new one was made.
  const old = program((k, m) => k.let("m2", put(k, m, 2, 20), (m2) => k.call(PAIR_V, show(k, m2), show(k, m))));
  assert.equal(old.ok, false);
  assert.match(old.problems.join("; "), /m is used after it was changed or kept/);
  // The same map in a pair with its changed version.
  assert.equal(program((k, m) => show(k, k.call(PAIR_V, m, put(k, m, 2, 20)))).ok, false);
  // A closure that is kept captures the map.
  assert.equal(program((k, m) => k.let("later", k.thunk(() => show(k, m)), (later) => k.call(PAIR_V, k.call(later), show(k, put(k, m, 2, 20))))).ok, false);
});

test("a helper that gives its map back twice shares it", () => {
  const r = program((k, m) => show(k, k.call(k.code.defs.find((d) => k.names[d] === "twice")!, m)), (k) => {
    const twice = k.def("twice");
    k.define(twice, k.fn(["map"], (mm) => k.call(PAIR_V, mm, mm)));
  });
  assert.equal(r.ok, false);
  assert.match(r.problems.join("; "), /twice shares its parameter 1/);
});

test("a definition with Choice that holds a map fails, and so does a map of maps", () => {
  assert.equal(program((k, m) => show(k, k.call(L("put"), m, k.call(S.oneOf, k.list(k.lit(1), k.lit(2))), k.lit(0)))).ok, false);
  assert.equal(program((k, m) => show(k, k.call(L("put"), k.x(L("empty map")), k.lit(1), m))).ok, false);
});

test("the examples that keep one version of each map pass: routes, ledger, chapters, wc", () => {
  for (const name of ["routes", "ledger", "chapters", "wc"]) {
    const p = loadProgram(join(import.meta.dirname, "../examples", name));
    const info = infer(p.code, p.pres.names, undefined, p.options);
    const r = check(p.code, info, p.named("main"), p.pres.names);
    assert.deepEqual(r.problems, [], name);
  }
});

// routes' sets too: its `near` walks the same fold twice (a match's
// scrutinee, and its otherwise again), each walk a set of its own. The
// names an arm binds are new each time it runs, so what the first walk
// used up under them doesn't count against the second.
test("routes' sets have one holder, a fold walked twice included", () => {
  const p = loadProgram(join(import.meta.dirname, "../examples", "routes"));
  const info = infer(p.code, p.pres.names, undefined, p.options);
  const setRow = LIBRARY.reps.find((r) => r.name === "hash table" && r.of === SET_TYPE)!;
  const setChanges = new Map([[L("add item"), 0], [L("remove item"), 0], [L("set union"), 0]]);
  const r = oneHolder(p.code, info, p.named("main"), new Set([SET_TYPE]), new Set(Object.keys(setRow.impl)), setChanges, p.pres.names);
  assert.deepEqual(r.problems, []);
});

// Only the arrays of one item type (C93 s4): machine's registers and memory
// are Array Int, and every one has one holder, though its arrays of arrays
// don't.
test("an Array Int changed and passed on has one holder; one kept after it was changed doesn't; an Array Text isn't asked", () => {
  const arrays = (body: (k: Lang, a: Id) => Id, item: Id = INT) => {
    const k = new Lang(LIBRARY.code);
    const main = k.def("main");
    k.define(main, k.thunk(() => k.let("a", k.call(ARRAY_OPS.of, k.listOf(...(item === INT ? [k.int(1), k.int(2)] : [k.lit("x"), k.lit("y")]))), (a) => body(k, a))));
    const code = base(k.code), names = baseNames(k.names), info = infer(code, names, undefined, checkOptions);
    assert.deepEqual(info.errors.map((e) => e.message), []);
    const ops = ARRAY_OPS as Record<string, Id>;
    return oneHolder(code, info, main, new Set([ARRAY]), new Set(Object.values(ops)), new Map([[ops.replaceAt, 0], [ops.push, 0], [ops.pushFront, 0], [ops.rest, 0], [ops.front, 0]]), names, INT);
  };
  const at = (k: Lang, a: Id, v: Id) => k.call(ARRAY_OPS.replaceAt, a, k.int(0), v);
  assert.equal(arrays((k, a) => show(k, at(k, a, k.int(5)))).ok, true);
  const old = arrays((k, a) => k.let("b", at(k, a, k.int(5)), (b) => k.call(PAIR_V, show(k, b), show(k, a))));
  assert.equal(old.ok, false);
  assert.match(old.problems.join("; "), /a is used after it was changed or kept/);
  assert.equal(arrays((k, a) => k.let("b", at(k, a, k.lit("z")), (b) => k.call(PAIR_V, show(k, b), show(k, a))), STRING).ok, true);
});
