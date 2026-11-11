// Work a lambda redoes on every call though nothing in it changes, done once
// (hoist.ts, C81; GAPS.md round 7 S2).

import { test } from "node:test";
import assert from "node:assert/strict";
import { Lang } from "../../ters/src/lang/dsl.ts";
import { base, baseNames, checkOptions } from "../../ters/src/lang/load.ts";
import { infer } from "../../ters/src/lang/infer.ts";
import { LIBRARY } from "../../ters/src/lang/library.ts";
import { makeRunner } from "../../ters/src/lang/run.ts";
import { B } from "../../ters/src/prelude.ts";
import { CONS, HTML_V, NIL, S, UNIT_V } from "../../ters/src/lang/std.ts";
import type { Id } from "../../ters/src/model.ts";
import { compiledDefs } from "../src/core-js.ts";
import { toList } from "../../ters/src/lang/run.ts";
import { hoistInvariants } from "../src/hoist.ts";
import { elaborate, verify } from "../../ters/src/lang/verify.ts";

const lib = (name: string) => LIBRARY.modules.flatMap((m) => m.exports).find((d) => LIBRARY.names[d] === name)!;

function program() {
  const k = new Lang(LIBRARY.code);
  const def = (name: string, ps: string[], body: (...xs: Id[]) => Id) => { const d = k.def(name); k.define(d, k.fn(ps, body)); return d; };
  // The total of a list: a walk over it, the same for every item below.
  const total = k.def("total of");
  k.define(total, k.fn(["xs"], (xs) => k.fold(xs, [
    { variant: NIL, names: [], body: () => k.lit(0) },
    { variant: CONS, names: ["h", "t"], results: [null, "r"], body: ([h], [, r]) => k.call(B.add, h, r!) },
  ])));
  // Each item times the total: the total doesn't change from item to item.
  const shares = def("shares", ["xs"], (xs) => k.call(lib("map"), xs, k.fn(["x"], (x) => k.call(B.mul, x, k.call(total, xs)))));
  // An item's own work stays where it is.
  const own = def("own", ["xs"], (xs) => k.call(lib("map"), xs, k.fn(["x"], (x) => k.call(total, k.list(x, x)))));
  const code = base(k.code), names = baseNames(k.names);
  return { code, names, info: infer(code, names, undefined, checkOptions), shares, own };
}

test("a call inside a lambda given to map, using nothing of the lambda's, is worked out once; the answers are the same", async () => {
  const p = program();
  assert.deepEqual(p.info.errors.map((e) => e.message), []);
  const h = hoistInvariants(p.code, p.info, p.names);
  // `total of(xs)` in shares, now a let around map; nothing in own, whose
  // call uses x.
  const bodyOf = (d: Id) => h.code.nodes[(h.code.nodes[(h.code.nodes[d] as { body: Id }).body] as { body: Id }).body] as { kind: string; fn: Id };
  assert.equal(h.code.nodes[bodyOf(p.shares).fn].kind, "lambda");
  assert.equal(h.code.nodes[bodyOf(p.own).fn].kind, "ref");
  const js = compiledDefs(p.code, p.info, p.names, ["shares", "own"]);
  const r = makeRunner(p.code, p.info, { print: () => {}, names: p.names });
  const list = (xs: number[]): unknown => xs.reduceRight<unknown>((t, x) => ({ tag: CONS, fields: [x, t] }), { tag: NIL, fields: [] });
  const items = (l: { tag: string; fields: unknown[] }): unknown[] => (l.tag === NIL ? [] : [l.fields[0], ...items(l.fields[1] as typeof l)]);
  for (const d of ["shares", "own"] as const) {
    const xs = list([1, 3, 4]);
    const [want] = [...(r.call(r.value(p[d]), xs) as Iterable<{ tag: string; fields: unknown[] }>)];
    assert.deepEqual(items(js[d](toList([1, 3, 4])) as never), items(want), d);
  }
});

// C88: a thunk runs once or not at all, so its work stays in it: `first`'s
// fallback, worked out before the search was tried, ran even when the
// search had an answer (board's `take word`, GAPS round 8 B4).
test("a first's fallback keeps its work: nothing is moved out of a lambda of no inputs (C88)", () => {
  const k = new Lang(LIBRARY.code);
  const total = k.def("total of");
  k.define(total, k.fn(["xs"], (xs) => k.fold(xs, [
    { variant: NIL, names: [], body: () => k.lit(0) },
    { variant: CONS, names: ["h", "t"], results: [null, "r"], body: ([h], [, r]) => k.call(B.add, h, r!) },
  ])));
  const pick = k.def("pick");
  k.define(pick, k.fn(["xs"], (xs) => k.call(S.first, k.thunk(() => k.call(S.oneOf, xs)), k.thunk(() => k.call(total, xs)))));
  const code = base(k.code), names = baseNames(k.names), info = infer(code, names, undefined, checkOptions);
  assert.deepEqual(info.errors.map((e) => e.message), []);
  assert.equal(hoistInvariants(code, info, names).hoisted, 0);
});

test("the hoisted program's types are carried, not checked again, and the verifier vouches for them (I203)", () => {
  const p = program();
  const h = hoistInvariants(p.code, p.info, p.names);
  assert.ok(h.hoisted > 0);
  const v = verify(h.code, elaborate(h.code, h.info), [p.shares, p.own]);
  assert.deepEqual(v.problems, []);
  // The let it made is checked like any function.
  assert.ok(v.checked > 20, `${v.checked} nodes`);
});

// A pure call moved out of a page's handler runs where the let is, so its
// function's row is that place's, not the handler's: bounce's carried
// types gave `items of list tree` every effect a handler may do, inside a
// function that does only Cells, and the verifier refused 11 calls (I207).
test("a call moved out of a handler takes the row of the place it moves to (I207)", () => {
  const k = new Lang(LIBRARY.code);
  const total = k.def("total of");
  k.define(total, k.fn(["xs"], (xs) => k.fold(xs, [
    { variant: NIL, names: [], body: () => k.lit(0) },
    { variant: CONS, names: ["h", "t"], results: [null, "r"], body: ([h], [, r]) => k.call(B.add, h, r!) },
  ])));
  const click = k.def("click");
  k.define(click, k.fn(["xs"], (xs) => k.call(HTML_V.on, k.lit("click"), k.fn(["e"], () => k.let("t", k.call(total, xs), () => k.x(UNIT_V))))));
  const code = base(k.code), names = baseNames(k.names), info = infer(code, names, undefined, checkOptions);
  assert.deepEqual(info.errors.map((e) => e.message), []);
  const h = hoistInvariants(code, info, names);
  assert.ok(h.hoisted > 0);
  assert.deepEqual(verify(h.code, elaborate(h.code, h.info), [click]).problems, []);
});
