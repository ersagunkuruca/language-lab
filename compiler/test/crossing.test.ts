// What crosses to a page's or a module's workers (branches-rt.ts encode):
// a long cons list crosses as its items, so neither encoding it nor
// postMessage's copy runs out of stack (the pond page's patches, E278).

import { test } from "node:test";
import assert from "node:assert/strict";
import { crossed } from "../src/branches-rt.ts";
import { CONS, NIL } from "../../ters/src/lang/std-ids.ts";
import { ArrayView, arrayOf } from "../../ters/src/lang/array-view.ts";

type Cell = { tag: string; fields: unknown[] };
const list = (n: number): Cell => { let l: Cell = { tag: NIL, fields: [] }; for (let i = n - 1; i >= 0; i--) l = { tag: CONS, fields: [{ tag: "patch", fields: [i / 2] }, l] }; return l; };
const items = (l: Cell): unknown[] => { const xs = []; for (; l.tag === CONS; l = l.fields[1] as Cell) xs.push(l.fields[0]); return xs; };

test("a cons list of 100,000 records crosses whole, in order", () => {
  const l = list(100_000), back = crossed(l) as Cell;
  assert.deepEqual(items(back), items(l));
  let end = back;
  while (end.tag === CONS) end = end.fields[1] as Cell;
  assert.equal(end.tag, NIL);
});

test("a short list inside a record crosses as it was", () => {
  const r = { tag: "pond", fields: [list(3), 7] };
  assert.deepEqual(crossed(r), r);
});

// An array or a list of numbers crosses as one Float64Array (C329: wav
// of's 192,000 words, captured by its bytes' map): every number exactly
// as it was, -0 and the largest Ints a number holds too.
test("numbers cross as one Float64Array, exactly", () => {
  const xs = Array.from({ length: 1000 }, (_, i) => (i % 7 === 0 ? -0 : i % 5 === 0 ? 2 ** 53 - i : i / 3));
  const view = arrayOf(xs) as ArrayView, back = crossed(view) as ArrayView;
  assert.ok(back instanceof ArrayView);
  assert.equal(back.n, xs.length);
  for (let i = 0; i < xs.length; i++) assert.ok(Object.is(back.buf.items[back.start + i], xs[i]), `item ${i}`);
  assert.deepEqual(crossed(xs), xs);
  // One that isn't a number: each item as before.
  const mixed = [...xs, { tag: "patch", fields: [1] }];
  assert.deepEqual(crossed(mixed), mixed);
});
