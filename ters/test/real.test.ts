// Real numbers as intervals that narrow on demand (EXACT-REALS.md step 4,
// BACKLOG L88e1): a Real made of fractions by + − · gives an Int m with
// |x − m/2ᵖ| < 2⁻ᵖ for any p asked, evaluated and compiled.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { Lang } from "../src/lang/dsl.ts";
import { infer } from "../src/lang/infer.ts";
import { makeRunner, type Value } from "../src/lang/run.ts";
import { base, baseNames, checkOptions } from "../src/lang/load.ts";
import { LIBRARY } from "../src/lang/library.ts";
import { ARITH, REAL_OPS as RO, FALSE, S, TRUE } from "../src/lang/std.ts";
import { showType } from "../src/lang/types.ts";
import type { Id } from "../src/model.ts";
import { compile } from "../../compiler/src/compile.ts";
import * as R from "../src/lang/real.ts";

const runtime = pathToFileURL(join(import.meta.dirname, "../../compiler/src/runtime.js")).href;

// |n/d − m/2ᵖ| < 2⁻ᵖ, in Ints.
const within = (n: bigint, d: bigint, m: bigint, p: number) => { const e = n * (1n << BigInt(p)) - m * d; return (e < 0n ? -e : e) < d; };

test("a Real of fractions by + − · is as close as asked, at any precision", () => {
  let seed = 7;
  const rnd = (k: number) => (seed = (seed * 16807) % 2147483647) % k;
  for (let i = 0; i < 500; i++) {
    const [a, b, c, d, e, f] = [rnd(2001) - 1000, rnd(99) + 1, rnd(2001) - 1000, rnd(99) + 1, rnd(2001) - 1000, rnd(99) + 1].map(BigInt);
    const x = R.multiply(R.subtract(R.fraction(a, b), R.fraction(c, d)), R.add(R.negate(R.fraction(e, f)), R.fraction(1n, 3n)));
    // (a/b − c/d) · (1/3 − e/f)
    const n = (a * d - c * b) * (f - 3n * e), dd = b * d * 3n * f;
    for (const p of [0, 1, 5, 30, 200]) assert.ok(within(n, dd, R.approximate(x, p), p), `${a}/${b} ${c}/${d} ${e}/${f} at ${p}`);
  }
});

test("asked again, narrower or the same, a Real reuses what it worked out", () => {
  const x = R.add(R.fraction(1n, 3n), R.fraction(2n, 7n));
  const m = R.approximate(x, 100);
  assert.equal(R.approximate(x, 100), m);
  assert.ok(x.kept.has(100) && (x as { parts: R.Real[] }).parts[0].kept.has(102));
  const [[lo, d1], [hi, d2]] = R.interval(x, 10);
  assert.ok(lo * 21n < 13n * d1 && 13n * d2 < hi * 21n, "13/21 is inside the interval");
});

test("π to as many decimals as asked, and digits rounded within one in the last place", () => {
  assert.equal(R.digits(R.pi(), 50), "3.14159265358979323846264338327950288419716939937511");
  // 200 decimals agree with 260 of them rounded at the 200th.
  const many = R.digits(R.pi(), 260), cut = BigInt(many.replace(".", "").slice(0, 201)) + (Number(many[202]) >= 5 ? 1n : 0n);
  assert.equal(R.digits(R.pi(), 200).replace(".", ""), cut.toString());
  assert.equal(R.digits(R.pi(), 0), "3");
  assert.equal(R.digits(R.negate(R.pi()), 5), "−3.14159");
  assert.equal(R.digits(R.fraction(1n, 3n), 4), "0.3333");
  assert.equal(R.digits(R.fraction(-1n, 8n), 2), "−0.13");
  // π · π − π² as fractions of π's digits: within 2⁻ᵖ at every p.
  for (const p of [0, 10, 300]) assert.ok(R.approximate(R.subtract(R.multiply(R.pi(), R.pi()), R.multiply(R.pi(), R.pi())), p) ** 2n <= 4n);
});

test("comparisons narrow until they decide, or say they can't with the fuel given", () => {
  const third = R.fraction(1n, 3n);
  assert.equal(R.compare(R.pi(), R.fraction(22n, 7n), 64), -1);
  assert.equal(R.compare(R.pi(), R.fraction(314159n, 100000n), 64), 1);
  // They differ only at 2⁻¹⁰⁰: 64 bits can't tell, 128 can.
  const near = R.add(third, R.fraction(1n, 1n << 100n));
  assert.equal(R.compare(near, third, 64), null);
  assert.equal(R.compare(near, third, 128), 1);
  // Equal ones never come apart: no answer however much fuel.
  assert.equal(R.compare(R.multiply(third, R.fraction(3n, 1n)), R.fraction(1n, 1n), 500), null);
});

function program() {
  const k = new Lang(LIBRARY.code);
  const def = (name: string, body: () => Id) => { const d = k.def(name); k.define(d, body()); return d; };
  const frac = (n: number, d: number) => k.call(RO.fraction, k.int(n), k.int(d));
  // (1/3 + 2/7) · (1/3 − 2/7) = 13/21 · 1/21 = 13/441
  const x = def("x", () => k.call(RO.mul, k.call(RO.add, frac(1, 3), frac(2, 7)), k.call(RO.sub, frac(1, 3), frac(2, 7))));
  def("to 0", () => k.call(RO.approximate, k.x(x), k.int(0)));
  def("to 20", () => k.call(RO.approximate, k.x(x), k.int(20)));
  def("to 100", () => k.call(RO.approximate, k.call(RO.neg, k.x(x)), k.int(100)));
  // A comparison in a program (L88e3): π < 22/7, and 1/3 · 3 < 1 has no
  // answer, so first gives its other, true (decided, it would be false).
  def("below", () => k.call(S.first, k.thunk(() => k.call(RO.less, k.call(RO.pi), frac(22, 7), k.int(64))), k.thunk(() => k.x(FALSE))));
  def("undecided", () => k.call(S.first, k.thunk(() => k.call(RO.less, k.call(ARITH.mul, frac(1, 3), frac(3, 1)), frac(1, 1), k.int(64))), k.thunk(() => k.x(TRUE))));
  // π and digits (L88e2): 2π to 30 decimals.
  def("two pi", () => k.call(RO.digits, k.call(ARITH.mul, k.lit(2), k.call(RO.pi)), k.int(30)));
  // The one + − · at Real, and a number written there (1/2 + x · x − 1).
  def("with operators", () => k.call(RO.approximate, k.call(ARITH.sub, k.call(ARITH.add, k.lit(0.5), k.call(ARITH.mul, k.x(x), k.x(x))), k.lit(1)), k.int(40)));
  const code = base(k.code), names = baseNames(k.names);
  return { code, names, info: infer(code, names, undefined, checkOptions) };
}
const NAMES = ["to 0", "to 20", "to 100", "with operators", "two pi", "below", "undecided"];

test("a Real's approximation in a program, evaluated and compiled", async () => {
  const p = program();
  assert.deepEqual(p.info.errors.map((e) => e.message), []);
  const at = (n: string) => p.code.defs.find((d) => p.names[d] === n)!;
  assert.equal(showType(p.info.schemes.get(at("x"))!.type, p.names), "Real");
  const r = makeRunner(p.code, p.info, { print: () => {}, names: p.names });
  assert.equal(r.value(at("two pi")), "6.283185307179586476925286766559");
  assert.deepEqual([r.value(at("below")), r.value(at("undecided"))], [{ tag: TRUE, fields: [] }, { tag: TRUE, fields: [] }]);
  const got = NAMES.slice(0, 4).map((n) => BigInt(r.value(at(n)) as number | bigint));
  // 1/2 + 169/194481 − 1 = (169 − 97240.5·2)/388962
  assert.ok(within(13n, 441n, got[0], 0) && within(13n, 441n, got[1], 20) && within(-13n, 441n, got[2], 100) && within(2n * 169n - 194481n, 2n * 194481n, got[3], 40), String(got));
  const path = join(mkdtempSync(join(tmpdir(), "real-")), "real.js");
  writeFileSync(path, compile(p.code, p.info, p.names, { runtime, exports: NAMES }));
  const defs = (await import(pathToFileURL(path).href)).defs as Record<string, unknown>;
  for (const n of NAMES) {
    const c = typeof defs[n] === "function" ? (defs[n] as () => Value)() : defs[n];
    assert.deepEqual(c, r.value(at(n)), n);
  }
});
