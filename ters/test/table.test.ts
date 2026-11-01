// std.ts's Table (C71): every version stays a value. A put or remove gives
// a new version and the one it was given still says what it said, read
// before or after, however the versions branch: the same answers as a copy
// per version, on a few thousand random changes and reads.

import { test } from "node:test";
import assert from "node:assert/strict";
import { STD_IMPL, Table, TABLE_OPS } from "../src/lang/std.ts";

const put = STD_IMPL[TABLE_OPS.put] as (t: Table, k: unknown, v: unknown) => Table;
const remove = STD_IMPL[TABLE_OPS.remove] as (t: Table, k: unknown) => Table;
const empty = STD_IMPL[TABLE_OPS.empty] as () => Table;

test("a table's versions each keep their entries, however they branch and are read", () => {
  let seed = 7;
  const rand = (n: number) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
  const versions: { t: Table; want: Map<unknown, unknown> }[] = [{ t: empty(), want: new Map() }];
  for (let i = 0; i < 4000; i++) {
    // Mostly the newest (one holder), sometimes an old one.
    const at = rand(4) ? versions.length - 1 : rand(versions.length);
    const { t, want } = versions[at];
    const key = rand(3) ? rand(40) : `k${rand(10)}`;
    if (rand(5) === 0) {
      const w = new Map(want); w.delete(key);
      versions.push({ t: remove(t, key), want: w });
    } else if (rand(3) === 0) {
      const w = new Map(want); w.set(key, i);
      versions.push({ t: put(t, key, i), want: w });
    } else {
      const v = versions[rand(versions.length)];
      assert.deepEqual(new Map(v.t.m), v.want, `version read at step ${i}`);
    }
  }
  for (const v of versions) assert.deepEqual(new Map(v.t.m), v.want);
});

test("the empty table every `empty map` shares is never changed", () => {
  const e = empty(), a = put(e, 1, "a"), b = put(e, 2, "b");
  assert.deepEqual([...e.m], []);
  assert.deepEqual([...a.m], [[1, "a"]]);
  assert.deepEqual([...b.m], [[2, "b"]]);
});
