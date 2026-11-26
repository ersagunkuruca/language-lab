// gcd and exact division on small Ints worked out as numbers (I375),
// against BigInt's answers: signs, zeros, the ends of the small range,
// and past it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { coreRuntime } from "../src/core-rt.ts";
import { norm, type Int } from "../../ters/src/lang/int.ts";

test("int.gcd and int.exact give BigInt's answers on small Ints and past them", () => {
  const R = coreRuntime([], [], {} as never);
  const gcd = R.rt("int.gcd") as (a: Int, b: Int) => Int, exact = R.rt("int.exact") as (a: Int, b: Int) => Int;
  const B = (x: Int) => BigInt(x), abs = (x: bigint) => (x < 0n ? -x : x);
  const bgcd = (a: bigint, b: bigint) => { let x = abs(a), y = abs(b); while (y) [x, y] = [y, x % y]; return norm(x); };
  const edge = 2 ** 28 - 1;
  const xs: Int[] = [0, 1, -1, 2, -2, 6, -6, 12, -18, 35, 97, -97, edge, -edge, edge - 1, 2n ** 28n, -(2n ** 28n), 2n ** 70n + 6n, 3n * 2n ** 40n];
  for (const a of xs) for (const b of xs) {
    const g = gcd(a, b);
    assert.equal(g, bgcd(B(a), B(b)), `gcd(${a}, ${b})`);
    assert.ok(!Object.is(g, -0));
    if (B(b) !== 0n) {
      const q = exact(a, b);
      assert.equal(q, norm(B(a) / B(b)), `exact(${a}, ${b})`);
      assert.ok(!Object.is(q, -0), `exact(${a}, ${b}) is -0`);
    }
  }
});
