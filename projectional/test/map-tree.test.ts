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
import { LIBRARY } from "../src/lang/library.ts";
import { choose, jobProblem, represent } from "../src/lang/represent.ts";
import { withMapTree } from "../src/lang/map-tree.ts";
import { CONS, NIL, PAIR_V, S, SHOW_ANY } from "../src/lang/std.ts";
import type { Id } from "../src/model.ts";

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

const printed = (code: ReturnType<typeof program>["code"], names: Record<Id, string>, main: Id) => {
  const info = infer(code, names, undefined, checkOptions);
  assert.deepEqual(info.errors.map((e) => e.message), []);
  const lines: string[] = [];
  runMain(code, info, main, { print: (s) => lines.push(s), names });
  return lines;
};

test("each tree job agrees with the definition through meaning, and the tree stays balanced", () => {
  const k = new Lang(LIBRARY.code);
  const code0 = base(k.code), names0 = baseNames(k.names);
  const w = withMapTree(code0, names0);
  const info = infer(w.code, w.names, undefined, checkOptions);
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
  // Whole keys, then Numbers a near step apart (each within equal's 1e-9
  // of the next) with NaN, −0 and 0: compare's exact order keeps the tree
  // and the sorted list agreeing on those too (REVIEW-2026-10-26.md §1.1).
  const order = variantOrder(w.code);
  const near = [...Array.from({ length: 20 }, (_, j) => 1000.5 + j * 1.5e-6), NaN, -0, 0];
  for (const keyOf of [(i: number) => i, (i: number) => near[i % near.length]]) {
  let tree = r.value(impl("empty map")), map = r.value(spec("empty map"));
  for (let step = 0; step < 400; step++) {
    const key = keyOf(rand(60)), op = rand(3);
    if (op < 2) { tree = call(impl("put"), tree, key, step)!; map = call(spec("put"), map, key, step)!; }
    else { tree = call(impl("remove key"), tree, key)!; map = call(spec("remove key"), map, key)!; }
    // compare's "same", not equal: equal(NaN, NaN) is false, as IEEE says.
    assert.equal(compareValues(means(tree)!, map, order), 0, `step ${step}`);
    balanced(tree);
    const probe = keyOf(rand(60));
    assert.deepEqual(call(impl("value at"), tree, probe), call(spec("value at"), map, probe));
    assert.ok(equal(call(impl("has key"), tree, probe)!, call(spec("has key"), map, probe)!));
    assert.equal(call(impl("map size"), tree), call(spec("map size"), map));
  }
  }
});

test("the chooser takes the tree for a word count; the represented program prints what the definition prints", () => {
  const p = program(300);
  const w = withMapTree(p.code, p.names);
  const pick = choose(w.code, p.main, [w.spec, w.rep]);
  assert.equal(pick.rep.name, "weight-balanced tree");
  const plain = printed(p.code, p.names, p.main);
  const tree = printed(represent(w.code, p.own, w.rep), w.names, p.main);
  assert.deepEqual(tree, plain);
  assert.equal(plain[3], '["a", "b", "c"]');
});

test("on 1200 words, 400 of them different, the tree is faster than the sorted list", () => {
  const p = program(1200);
  const w = withMapTree(p.code, p.names);
  const repd = represent(w.code, p.own, w.rep);
  const time = (f: () => string[]) => { const t = performance.now(); const out = f(); return { out, ms: performance.now() - t }; };
  const a = time(() => printed(p.code, p.names, p.main));
  const b = time(() => printed(repd, w.names, p.main));
  assert.deepEqual(b.out, a.out);
  console.log(`# sorted list ${a.ms.toFixed(0)} ms, tree ${b.ms.toFixed(0)} ms`);
  assert.ok(b.ms < a.ms, `tree ${b.ms} ms, list ${a.ms} ms`);
});
