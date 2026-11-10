// Pure branches of together (L62, pure-branches.ts): a together whose
// actions only compute (or abort) is marked, one that prints, waits or
// writes a cell isn't.

import { test } from "node:test";
import assert from "node:assert/strict";
import type { Id } from "../src/model.ts";
import { Lang } from "../src/lang/dsl.ts";
import { infer } from "../src/lang/infer.ts";
import { base, baseNames, checkOptions } from "../src/lang/load.ts";
import { LIBRARY } from "../src/lang/library.ts";
import { parallelLists, parallelMaps, parallelTogethers, pureTogethers } from "../src/lang/pure-branches.ts";
import { ABORT_OP, AWAIT_OP, START_TIMER_OP, S, SHOW_ANY } from "../src/lang/std.ts";
import { B } from "../src/prelude.ts";

const lib = (name: string) => LIBRARY.code.defs.find((d) => LIBRARY.names[d] === name)!;

let inner = new Set<Id>();
function markedInner(actions: (k: Lang) => Id[]): boolean { marked(actions); return inner.size > 1; }
function marked(actions: (k: Lang) => Id[]): boolean {
  const k = new Lang(LIBRARY.code);
  const main = k.def("main");
  let call = "";
  k.define(main, k.thunk(() => k.call(S.print, k.call(SHOW_ANY, k.call(lib("simulated"), k.lit(1), k.thunk(() => (call = k.call(lib("together"), k.list(...actions(k))))))))));
  const code = base(k.code), names = baseNames(k.names);
  const info = infer(code, names, undefined, checkOptions);
  assert.deepEqual(info.errors.map((e) => e.message), []);
  const marks = pureTogethers(code, info);
  inner = marks;
  together = parallelTogethers(code, info).has(call);
  return marks.size > 0 && marks.has(call);
}
let together = false;

test("a together whose actions only compute, or abort, may run them elsewhere", () => {
  assert.equal(marked((k) => [k.thunk(() => k.call(B.mul, k.lit(6), k.lit(7))), k.thunk(() => k.lit(1))]), true);
  assert.equal(marked((k) => [k.thunk(() => k.call(ABORT_OP, k.lit("no"))), k.thunk(() => k.lit("yes"))]), true);
});

test("one that prints or waits may not", () => {
  assert.equal(marked((k) => [k.thunk(() => k.seq(k.call(S.print, k.lit("hi")), k.lit(1))), k.thunk(() => k.lit(2))]), false);
  assert.equal(marked((k) => [k.thunk(() => k.seq(k.call(AWAIT_OP, k.call(START_TIMER_OP, k.lit(5))), k.lit(1))), k.thunk(() => k.lit(2))]), false);
});

test("one that hands on a function from outside may not: only the caller knows what it does", () => {
  // the outer together's action is pure, the inner one (inside twice each) isn't marked
  assert.equal(markedInner((k) => {
    const g = k.def("twice each");
    k.define(g, k.fn(["f"], (f) => k.call(lib("together"), k.list(k.thunk(() => k.call(lib("map"), k.list(k.lit(1)), f))))));
    return [k.thunk(() => k.call(g, k.fn(["x"], (x) => x)))];
  }), false);
});

// At once (C41): an action that aborts stops the ones after it when run in
// order, so none after it may run long, where at once it would keep the
// together waiting.
test("a together runs at once unless an action that may abort comes before one that may run long", () => {
  const forever = (k: Lang) => { const f = k.def("forever"); k.define(f, k.fn(["n"], (n) => k.call(f, n))); return f; };
  assert.equal(marked((k) => [k.thunk(() => k.call(ABORT_OP, k.lit("no"))), k.thunk(() => k.lit("yes"))]), true);
  assert.equal(together, true);
  assert.equal(marked((k) => { const f = forever(k); return [k.thunk(() => k.call(ABORT_OP, k.lit("no"))), k.thunk(() => k.call(f, k.lit(1)))]; }), true);
  assert.equal(together, false);
  assert.equal(marked((k) => { const f = forever(k); return [k.thunk(() => k.call(f, k.lit(1))), k.thunk(() => k.call(ABORT_OP, k.lit("no")))]; }), true);
  assert.equal(together, true);
});

// A map shares out its items (C42) when its function, written in place,
// only computes; one that may abort may not also run long, as above.
function mapMarked(by: (k: Lang, x: Id) => Id): boolean {
  const k = new Lang(LIBRARY.code);
  const main = k.def("main"), forever = k.def("forever");
  k.define(forever, k.fn(["n"], (n) => k.call(forever, n)));
  let call = "";
  k.define(main, k.thunk(() => k.call(S.print, k.call(SHOW_ANY, (call = k.call(lib("map"), k.list(k.lit(1), k.lit(2)), k.fn(["x"], (x) => by(k, x))))))));
  const code = base(k.code), names = baseNames(k.names);
  const info = infer(code, names, undefined, checkOptions);
  assert.deepEqual(info.errors.map((e) => e.message), []);
  return parallelMaps(code, info).has(call);
}

test("a map shares out its items when its function only computes, or aborts, or runs long (C42)", () => {
  assert.equal(mapMarked((k, x) => k.call(B.mul, x, k.lit(2))), true);
  assert.equal(mapMarked((k, x) => k.if(k.call(S.less, x, k.lit(2)), x, k.call(ABORT_OP, k.lit("no")))), true);
  assert.equal(mapMarked((k, x) => k.seq(k.call(S.print, k.lit("hi")), x)), false);
  const forever = (k: Lang) => Object.keys(k.names).find((d) => k.names[d] === "forever")!;
  assert.equal(mapMarked((k, x) => k.call(forever(k), x)), true);
  assert.equal(mapMarked((k, x) => k.if(k.call(S.less, x, k.lit(2)), k.call(forever(k), x), k.call(ABORT_OP, k.lit("no")))), false);
});

test("a keep shares out its items like a map, its test written in place and only computing (C43)", () => {
  const k = new Lang(LIBRARY.code);
  const main = k.def("main");
  let pure = "";
  k.define(main, k.thunk(() => k.call(S.print, k.call(SHOW_ANY, (pure = k.call(lib("keep"), k.list(k.lit(1), k.lit(2)), k.fn(["x"], (x) => k.call(S.less, x, k.lit(2)))))))));
  const code = base(k.code), names = baseNames(k.names);
  const info = infer(code, names, undefined, checkOptions);
  assert.deepEqual(info.errors.map((e) => e.message), []);
  assert.equal(parallelLists(code, info).get(pure), "keep");
});

// all pass and any pass stop at the first item that decides, so their
// test may abort but never run long (C43).
test("all pass, any pass and first where share out their items only for a test that ends (C43)", () => {
  const k = new Lang(LIBRARY.code);
  const main = k.def("main"), forever = k.def("forever");
  k.define(forever, k.fn(["n"], (n) => k.call(forever, n)));
  let ends = "", aborts = "", runsLong = "", found = "", foundLong = "";
  k.define(main, k.thunk(() => k.call(S.print, k.text(k.call(SHOW_ANY, k.list(
    (ends = k.call(lib("all pass"), k.list(k.lit(1), k.lit(2)), k.fn(["x"], (x) => k.call(S.less, x, k.lit(2))))),
    (aborts = k.call(lib("any pass"), k.list(k.lit(1), k.lit(2)), k.fn(["x"], (x) => k.if(k.call(S.less, x, k.lit(2)), k.call(S.less, x, k.lit(0)), k.call(ABORT_OP, k.lit("no")))))),
    (runsLong = k.call(lib("all pass"), k.list(k.lit(1), k.lit(2)), k.fn(["x"], (x) => k.call(S.less, k.call(forever, x), k.lit(2))))))),
    k.call(SHOW_ANY, (found = k.call(lib("first where"), k.list(k.lit(1), k.lit(2)), k.fn(["x"], (x) => k.call(S.less, k.lit(1), x))))),
    k.call(SHOW_ANY, (foundLong = k.call(lib("first where"), k.list(k.lit(1), k.lit(2)), k.fn(["x"], (x) => k.call(S.less, k.call(forever, x), k.lit(2))))))))));
  const code = base(k.code), names = baseNames(k.names);
  const info = infer(code, names, undefined, checkOptions);
  assert.deepEqual(info.errors.map((e) => e.message), []);
  const marked = parallelLists(code, info);
  assert.equal(marked.get(ends), "all");
  assert.equal(marked.get(aborts), "any");
  assert.equal(marked.get(runsLong), undefined);
  assert.equal(marked.get(found), "first");
  assert.equal(marked.get(foundLong), undefined);
});
