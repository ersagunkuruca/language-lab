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
import { pureTogethers } from "../src/lang/pure-branches.ts";
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
  return marks.size > 0 && marks.has(call);
}

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
