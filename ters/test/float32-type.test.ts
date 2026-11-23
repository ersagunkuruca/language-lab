// Float32, the type (L286): binary32 floats kept as the Float64 each is,
// every step rounded once to the nearest binary32 (ties to even). Its
// literals are rounded once from their digits, exactly, the halfway cases
// too; + − × ÷ and √ give what Math.fround of the Float64 step gives,
// which is binary32 hardware's answer; show gives the shortest decimal
// that reads back. Evaluated and compiled agree.

import { test } from "node:test";
import assert from "node:assert/strict";
import { Lang } from "../src/lang/dsl.ts";
import { infer } from "../src/lang/infer.ts";
import { makeRunner } from "../src/lang/run.ts";
import { base, baseNames, checkOptions } from "../src/lang/load.ts";
import { LIBRARY, FLOAT32_TYPE, FLOAT32_V } from "../src/lang/library.ts";
import { ARITH, DIVIDE, S, SHOW_ANY, TRIG_OPS } from "../src/lang/std.ts";
import type { Id } from "../src/model.ts";
import { compiledEach, plainValue } from "../../compiler/src/core-js.ts";

const lib = (name: string) => LIBRARY.code.defs.find((d) => LIBRARY.names[d] === name && (LIBRARY.code.nodes[d] as { body?: Id }).body !== undefined)!;
const STEP = 2n ** 149n;
// A Float64 as an exact fraction, top/bottom.
const exact = (x: number): [bigint, bigint] => {
  if (x === 0) return [0n, 1n];
  const v = new DataView(new ArrayBuffer(8));
  v.setFloat64(0, x);
  const hi = v.getUint32(0), lo = v.getUint32(4), sign = hi >>> 31 ? -1n : 1n, e = (hi >>> 20) & 0x7ff;
  const frac = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo), m = e ? frac | (1n << 52n) : frac, p = BigInt((e || 1) - 1075);
  return p >= 0n ? [sign * (m << p), 1n] : [sign * m, 1n << -p];
};
// The binary32 nearest top/bottom, ties to even, found among the three
// around the Float64 guess by exact comparison.
const below = (x: number) => { const a = new Float32Array([x]), b = new Int32Array(a.buffer); b[0] += x > 0 ? -1 : 1; return a[0]; };
const above = (x: number) => { const a = new Float32Array([x]), b = new Int32Array(a.buffer); b[0] += x >= 0 ? 1 : -1; return a[0]; };
const nearest32 = (top: bigint, bottom: bigint): number => {
  const f = Math.fround(Number(top) / Number(bottom));
  const off = (c: number) => { const [p, q] = exact(c); const d = top * q - p * bottom; return [d < 0n ? -d : d, q * bottom] as const; };
  const odd = (c: number) => (new Int32Array(new Float32Array([c]).buffer)[0] & 1) === 1;
  let best = f;
  for (const c of [below(f), above(f)]) {
    const [a, b] = off(c), [x, y] = off(best);
    if (a * y < x * b || (a * y === x * b && odd(best))) best = c;
  }
  return best;
};
const parts = (text: string): [bigint, bigint] => {
  const [num, den] = text.split("/");
  const m = /^(-?)(\d*)(?:\.(\d*))?(?:e([+-]?\d+))?$/.exec(num)!;
  const digits = BigInt(m[1] + (m[2] || "0") + (m[3] ?? "")), e = Number(m[4] ?? 0) - (m[3] ?? "").length;
  const [t, b] = e >= 0 ? [digits * 10n ** BigInt(e), 1n] : [digits, 10n ** BigInt(-e)];
  return [t, b * BigInt(den ?? 1)];
};
// The shortest decimal that reads back to a binary32, as JavaScript lays
// a Float64 of those digits out.
const shortest32 = (x: number) => { for (let p = 1; ; p++) { const t = x.toPrecision(p); if (Math.fround(Number(t)) === x) return String(Number(t)); } };

const LITERALS = ["0.1", "-0.1", "1/3", "-2/3", "1.5", "16777217", "16777219", "123456789", "3.4028234663852886e38", "1e-45", "7e-46", "2.5e-40", "1e-50",
  // Exactly halfway between 1 and the next binary32, and just past it:
  // through a Float64, both are 1 + 2⁻²⁴ and round to 1.
  "1.000000059604644775390625", "1.0000000596046447753906251", "0.000000000000000000001", "6.02214076e23"];
const VALUES = [0.1, 1 / 3, 2.5, 100, 1e-7, 1e21, 3e38, 1e-45, 1.17549435e-38, 7.006e-46, 123456.789, -0.75, 16777216, 0.3, 65504, 1e-6, 2 ** 70, 1.5e-5];

test("Float32: literals rounded once, + − × ÷ √ and Trig as binary32 gives, the shortest show; evaluated and compiled", async () => {
  const k = new Lang(LIBRARY.code);
  const def = (name: string, body: () => Id) => { const d = k.def(name); k.define(d, body()); return d; };
  const at = (v: number | string) => k.at(FLOAT32_TYPE, v);
  const steps = (v: Id) => k.match(v, [{ variant: FLOAT32_V, names: ["value"], body: ([x]) => k.call(lib("whole of"), k.call("builtin.mul", x, k.lit(2 ** 149))) }]);
  const names: string[] = [], want: string[] = [];
  const check = (name: string, v: () => Id, expected: string) => { names.push(name); want.push(expected); def(name, () => k.call(SHOW_ANY, v())); };
  const stepsText = (x: number) => { const [p, q] = exact(x); return String((p * STEP) / q); };
  for (const l of LITERALS) check(`literal ${l}`, () => steps(at(l)), stepsText(nearest32(...parts(l))));
  const f32 = VALUES.map((v) => Math.fround(v));
  const of = (x: number) => k.call(lib("as float32"), k.lit(x));
  const ops: [string, Id, (a: number, b: number) => number][] = [["add", ARITH.add, (a, b) => a + b], ["subtract", ARITH.sub, (a, b) => a - b], ["multiply", ARITH.mul, (a, b) => a * b], ["divide", DIVIDE, (a, b) => a / b]];
  for (const [name, op, f] of ops) for (let i = 0; i < f32.length; i++) {
    const a = f32[i], b = f32[(i * 7 + 3) % f32.length], r = Math.fround(f(a, b));
    if (!Number.isFinite(r) || Math.abs(r) > 3.4028234663852886e38) continue;
    check(`${name} ${i}`, () => k.call(S.first, k.thunk(() => steps(k.call(op, of(a), of(b)))), k.thunk(() => k.int(-1))), stepsText(r));
  }
  for (const [i, a] of f32.entries()) if (a > 0) check(`sqrt ${i}`, () => k.call(S.first, k.thunk(() => steps(k.call(lib("square root float32"), of(a)))), k.thunk(() => k.int(-1))), stepsText(Math.fround(Math.sqrt(a))));
  for (const [i, a] of [0.5, -2, 3, 10].entries()) check(`sin ${i}`, () => steps(k.call(TRIG_OPS.sin, of(a))), stepsText(Math.fround(Math.sin(Math.fround(a)))));
  check("less", () => k.call(ARITH.less, at("0.1"), of(0.1)), "false");
  check("equal", () => k.call(S.equal, at("0.1"), of(0.1)), "true");
  for (const [i, a] of f32.entries()) check(`shown ${i}`, () => k.call(SHOW_ANY, of(a)), JSON.stringify(shortest32(a)));
  check("shown zero", () => k.call(SHOW_ANY, at(0)), JSON.stringify("0"));

  const code = base(k.code), info = infer(code, baseNames(k.names), undefined, checkOptions);
  const nm = baseNames(k.names);
  assert.deepEqual(info.errors.map((e) => e.message), []);
  const r = makeRunner(code, info, { print: () => {}, names: nm });
  const id = (n: string) => code.defs.find((d) => nm[d] === n)!;
  const got = names.map((n) => r.value(id(n)));
  assert.deepEqual(Object.fromEntries(names.map((n, i) => [n, got[i]])), Object.fromEntries(names.map((n, i) => [n, want[i]])));
  const { defs, gaps } = compiledEach(code, info, nm, names);
  // Only show any of a literal 0 at Float32 stays in the evaluator.
  assert.ok(Object.keys(defs).length >= names.length - 1, Object.values(gaps).join("; "));
  for (const [i, n] of names.entries()) if (defs[n]) assert.deepEqual(plainValue(defs[n]()), got[i], n);
});
