// What crosses to a page's or a module's workers (branches-rt.ts encode):
// a long cons list crosses as its items, so neither encoding it nor
// postMessage's copy runs out of stack (the pond page's patches, E278).

import { test } from "node:test";
import assert from "node:assert/strict";
import { crossed } from "../src/branches-rt.ts";
import { CONS, NIL } from "../../ters/src/lang/std-ids.ts";

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
