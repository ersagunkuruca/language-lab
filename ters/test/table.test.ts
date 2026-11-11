// std.ts's Table (C71): every version stays a value. A put or remove gives
// a new version and the one it was given still says what it said, read
// before or after, however the versions branch: the same answers as a copy
// per version, on a few thousand random changes and reads.

import { test } from "node:test";
import assert from "node:assert/strict";
import { CONS, DirectMap, STD_IMPL, Table, TABLE_OPS } from "../src/lang/std.ts";

const put = STD_IMPL[TABLE_OPS.put] as (t: Table, k: unknown, v: unknown) => Table;
const remove = STD_IMPL[TABLE_OPS.remove] as (t: Table, k: unknown) => Table;
const empty = STD_IMPL[TABLE_OPS.empty] as () => Table;
const entries = STD_IMPL[TABLE_OPS.entries] as (t: Table) => unknown;
// The entries list as [key, value] pairs.
const listed = (t: Table) => {
  const out: unknown[][] = [];
  let c = entries(t) as { tag: string; fields: unknown[] };
  while (c.tag === CONS) { out.push((c.fields[0] as { fields: unknown[] }).fields); c = c.fields[1] as never; }
  return out;
};
// What a list says, as a Map, with no key twice.
const asMap = (xs: unknown[][]) => { const m = new Map(xs as [unknown, unknown][]); assert.equal(m.size, xs.length); return m; };

// A table's keys are all of one type (the checker's Map k v), so Ints and
// Texts are each run on their own: listing a table sorts its keys, and a
// Text is never compared with an Int (text.ts less reads the second as a
// text since C59, #2095).
for (const [kind, keyOf] of [["Int", (r: number) => r], ["Text", (r: number) => `k${r}`]] as const)
test(`a table's versions each keep their entries, however they branch and are read (${kind} keys)`, () => {
  let seed = 7;
  const rand = (n: number) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
  const versions: { t: Table; want: Map<unknown, unknown> }[] = [{ t: empty(), want: new Map() }];
  for (let i = 0; i < 4000; i++) {
    // Mostly the newest (one holder), sometimes an old one.
    const at = rand(4) ? versions.length - 1 : rand(versions.length);
    const { t, want } = versions[at];
    const key = keyOf(rand(3) ? rand(40) : 40 + rand(10));
    if (rand(5) === 0) {
      const w = new Map(want); w.delete(key);
      versions.push({ t: remove(t, key), want: w });
    } else if (rand(3) === 0) {
      const w = new Map(want); w.set(key, i);
      versions.push({ t: put(t, key, i), want: w });
    } else {
      const v = versions[rand(versions.length)];
      assert.deepEqual(new Map(v.t.m), v.want, `version read at step ${i}`);
      // Its entries, listed once and kept (C72), stay right after later changes.
      if (rand(2)) assert.deepEqual(asMap(listed(v.t)), v.want, `entries at step ${i}`);
    }
  }
  for (const v of versions) { assert.deepEqual(new Map(v.t.m), v.want); assert.deepEqual(asMap(listed(v.t)), v.want); }
});

test("the empty table every `empty map` shares is never changed", () => {
  const e = empty(), a = put(e, 1, "a"), b = put(e, 2, "b");
  assert.deepEqual([...e.m], []);
  assert.deepEqual([...a.m], [[1, "a"]]);
  assert.deepEqual([...b.m], [[2, "b"]]);
});

test("a version's entries are listed once, however often they are read (C72)", () => {
  const t = put(put(empty(), 2, "b"), 1, "a");
  assert.equal(entries(t), entries(t));
  const u = put(t, 0, "z");
  assert.notEqual(entries(u), entries(t));
  assert.deepEqual(listed(t), [[1, "a"], [2, "b"]]);
  assert.deepEqual(listed(u), [[0, "z"], [1, "a"], [2, "b"]]);
});

test("a table of Int keys lists them in order, put in order or not (C58b')", () => {
  let seed = 11;
  const rand = (n: number) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
  let t = empty(), want = new Map<number, number>();
  for (let i = 0; i < 2000; i++) {
    // Mostly a counter's next key, as an entity store's are; sometimes an
    // old one removed or put again, or a key from anywhere.
    const key = rand(4) ? i : rand(3) ? rand(i + 1) : -rand(50);
    if (rand(6) === 0) { t = remove(t, key); want.delete(key); } else { t = put(t, key, i); want.set(key, i); }
    if (rand(20) === 0) assert.deepEqual(listed(t), [...want].sort(([a], [b]) => a - b), `step ${i}`);
  }
  assert.deepEqual(listed(t), [...want].sort(([a], [b]) => a - b));
});

test("a direct map keeps small Int keys in its array and agrees with a Map, past its array too (C215)", () => {
  const d = new DirectMap(), m = new Map<unknown, unknown>();
  const both = (f: (x: DirectMap | Map<unknown, unknown>) => unknown) => assert.deepEqual(f(d), f(m));
  for (let k = 0; k < 300; k++) { d.set(k, k * 2); m.set(k, k * 2); }
  assert.equal(d.o, null, "keys put in order stay in the array");
  d.set(5, undefined); m.set(5, undefined); d.delete(7); m.delete(7); d.delete(7); m.delete(7);
  both((x) => [x.size, x.has(5), x.get(5), x.has(7), x.get(7), x.has(299), x.get(300)]);
  both((x) => [...x.entries()].sort((a, b) => (a[0] as number) - (b[0] as number)));
  // A key far past the keys there, a negative one, a Text: hashed for good.
  for (const k of [100000, -3, "a"]) { d.set(k, 1); m.set(k, 1); }
  assert.ok(d.o, "hashed");
  both((x) => [x.size, x.get(100000), x.get(-3), x.get("a"), x.get(299), x.has(7)]);
});
