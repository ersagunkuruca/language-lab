// Maps and sets (BACKLOG L65, DATA-STRUCTURES.md): ordinary data with one
// spelling, entries sorted by key in compare's order with no key twice, so
// equal and show need no special case and folds go in key order. Checked
// against a plain model on small inputs; compiled JS gives the evaluator's
// answers.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { B } from "../src/prelude.ts";
import { Lang } from "../src/lang/dsl.ts";
import { infer } from "../src/lang/infer.ts";
import { makeRunner, type Value } from "../src/lang/run.ts";
import { base, baseNames, checkOptions } from "../src/lang/load.ts";
import { LIBRARY } from "../src/lang/library.ts";
import { CONS, NIL, PAIR_V, S, SHOW_ANY } from "../src/lang/std.ts";
import { showType } from "../src/lang/types.ts";
import { subtree, type Id } from "../src/model.ts";
import { compile } from "../../compiler/src/compile.ts";

const runtime = pathToFileURL(join(import.meta.dirname, "../../compiler/src/runtime.js")).href;
const lib = (name: string) => LIBRARY.modules.flatMap((m) => m.exports).find((d) => LIBRARY.names[d] === name)!;

// Small sets of 0..3 as lists, every one, in a scrambled order.
const SETS = Array.from({ length: 16 }, (_, m) => [3, 0, 2, 1].filter((x) => m & (1 << x)));

function program() {
  const k = new Lang(LIBRARY.code);
  const def = (name: string, body: () => Id) => { const d = k.def(name); k.define(d, body()); return d; };
  const L = lib, show = (x: Id) => k.call(SHOW_ANY, x);
  const nums = (xs: number[]) => k.list(...xs.map((x) => k.lit(x)));
  const P = (a: Id, b: Id) => k.call(PAIR_V, a, b);
  const words = ["the", "cat", "saw", "the", "dog", "and", "the", "cat"];
  const defs = {
    // Counting words: a fold that puts each word's count plus one.
    counts: def("counts", () => show(k.fold(k.list(...words.map((w) => k.lit(w))), [
      { variant: NIL, names: [], body: () => k.x(L("empty map")) },
      { variant: CONS, names: ["word", "rest"], results: [null, "counted"], body: ([w], [, m]) =>
        k.call(L("put"), m!, w, k.call(B.add, k.call(S.first, k.thunk(() => k.call(L("value at"), m!, w)), k.thunk(() => k.lit(0))), k.lit(1))) },
    ]))),
    // One spelling: the same entries put in two orders are equal, and a
    // later pair wins in as map.
    sameSpelling: def("same spelling", () => k.equal(
      k.call(L("put"), k.call(L("put"), k.x(L("empty map")), k.lit("b"), k.lit(2)), k.lit("a"), k.lit(1)),
      k.call(L("as map"), k.list(P(k.lit("a"), k.lit(0)), P(k.lit("b"), k.lit(2)), P(k.lit("a"), k.lit(1)))))),
    reads: def("reads", () => {
      const m = (...ps: [number, string][]) => k.call(L("as map"), k.list(...ps.map(([a, b]) => P(k.lit(a), k.lit(b)))));
      return k.list(
        show(k.call(L("keys of"), m([3, "c"], [1, "a"], [2, "b"]))),
        show(k.call(L("values of"), m([3, "c"], [1, "a"]))),
        show(k.call(L("map size"), k.call(L("remove key"), m([1, "a"], [2, "b"]), k.lit(1)))),
        show(k.call(L("has key"), m([1, "a"]), k.lit(2))),
        show(k.call(S.all, k.thunk(() => k.call(L("value at"), k.x(L("empty map")), k.lit(1))))),
        show(k.call(L("merge maps"), m([1, "a"], [2, "b"]), m([2, "B"], [3, "C"]))),
      );
    }),
    // Every pair of small sets, through the three operations and has item.
    setOps: def("set ops", () => k.list(...SETS.flatMap((a) => SETS.map((b) => {
      const A = k.call(L("as set"), nums(a)), Bs = k.call(L("as set"), nums(b));
      return k.list(
        show(k.call(L("items of"), k.call(L("set union"), A, Bs))),
        show(k.call(L("items of"), k.call(L("set intersection"), A, Bs))),
        show(k.call(L("items of"), k.call(L("set difference"), A, Bs))),
        show(k.call(L("has item"), A, k.lit(b.length))),
        show(k.call(L("set size"), k.call(L("remove item"), k.call(L("add item"), A, k.lit(9)), k.lit(0)))),
      );
    })))),
  };
  const code = base(k.code), names = baseNames(k.names);
  return { code, names, info: infer(code, names, undefined, checkOptions), defs };
}

const NAMES = ["counts", "same spelling", "reads", "set ops"];
const items = (v: Value): Value[] => { const out: Value[] = []; let l = v as { fields: Value[] }; while (l.fields.length) { out.push(l.fields[0]); l = l.fields[1] as { fields: Value[] }; } return out; };
const bool = (v: Value) => (v as { tag: string }).tag === "std.bool.true";

test("a map has one spelling, counts words in key order, and reads out in order", () => {
  const p = program();
  assert.deepEqual(p.info.errors.map((e) => e.message), []);
  const r = makeRunner(p.code, p.info, { print: () => {}, names: p.names });
  assert.equal(r.value(p.defs.counts), 'map of([pair("and", 1), pair("cat", 2), pair("dog", 1), pair("saw", 1), pair("the", 3)])');
  assert.ok(bool(r.value(p.defs.sameSpelling)));
  assert.deepEqual(items(r.value(p.defs.reads)), ["[1, 2, 3]", '["a", "c"]', "1", "false", "[]", 'map of([pair(1, "a"), pair(2, "B"), pair(3, "C")])']);
});

test("set union, intersection and difference agree with a plain model on every small set", () => {
  const p = program();
  const r = makeRunner(p.code, p.info, { print: () => {}, names: p.names });
  const got = items(r.value(p.defs.setOps));
  const sorted = (xs: number[]) => [...new Set(xs)].sort((x, y) => x - y);
  let i = 0;
  for (const a of SETS) for (const b of SETS) {
    const [u, n, d, h, size] = items(got[i++]);
    const list = (xs: number[]) => `[${sorted(xs).join(", ")}]`;
    assert.equal(u, list([...a, ...b]));
    assert.equal(n, list(a.filter((x) => b.includes(x))));
    assert.equal(d, list(a.filter((x) => !b.includes(x))));
    assert.equal(h, String(a.includes(b.length)));
    assert.equal(size, String(sorted([...a, 9]).filter((x) => x !== 0).length));
  }
});

test("the operations surely finish: no Diverge in their types; value at is a Choice", () => {
  const p = program();
  const t = (name: string) => showType(p.info.schemes.get(lib(name))!.type, p.names);
  assert.equal(t("put"), "(Map a b, a, b) -> Map a b");
  assert.equal(t("value at"), "(Map a b, a) -[Choice]-> b");
  assert.equal(t("as map"), "(List (Pair a b)) -> Map a b");
  assert.equal(t("set union"), "(Set a, Set a) -> Set a");
  for (const name of ["remove key", "has key", "merge maps", "keys of", "values of", "as set", "add item", "remove item", "has item", "set intersection", "set difference"]) assert.doesNotMatch(t(name), /Diverge/, name);
});

test("compiled JavaScript gives the evaluator's answers", async () => {
  const p = program();
  const ok = new Set(NAMES.map((n) => p.code.defs.find((d) => p.names[d] === n)!));
  const clean = { ...p.info, errors: p.info.errors.filter((e) => [...ok].some((d) => subtree(p.code, d).includes(e.id))) };
  const r = makeRunner(p.code, p.info, { print: () => {}, names: p.names });
  const path = join(mkdtempSync(join(tmpdir(), "maps-")), "maps.js");
  writeFileSync(path, compile(p.code, clean, p.names, { runtime, exports: NAMES }));
  const defs = (await import(pathToFileURL(path).href)).defs as Record<string, unknown>;
  for (const n of NAMES) {
    const c = typeof defs[n] === "function" ? (defs[n] as () => Value)() : defs[n];
    assert.deepEqual(c, r.value(p.code.defs.find((d) => p.names[d] === n)!), n);
  }
});
