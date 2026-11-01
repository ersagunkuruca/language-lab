// Fixed (FIXED-POINT.md, BACKLOG L89 step 1): an Int counting steps of
// 2⁻³², with + − · < through the one + − · < and literals rounded once to
// the nearest step. A 1,000-step physics loop gives the same steps
// evaluated and compiled, and the same as Int arithmetic done here by
// hand; a position at 10¹² keeps a single step, which Float64 loses.

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
import { ARITH, FIXED_V, INT_OPS, PAIR_V, S, SHOW_ANY, TRIG_OPS } from "../src/lang/std.ts";
import { FIXED_TYPE } from "../src/lang/types.ts";
import type { Id } from "../src/model.ts";
import { compile } from "../../compiler/src/compile.ts";

const runtime = pathToFileURL(join(import.meta.dirname, "../../compiler/src/runtime.js")).href;
const lib = (name: string) => LIBRARY.modules.flatMap((m) => m.exports).find((d) => LIBRARY.names[d] === name)!;
const ONE = 2n ** 32n;
// The nearest step, halves up, and the product rounded down: by hand.
const steps = (top: bigint, bottom: bigint) => { const t = 2n * top * ONE + bottom, d = 2n * bottom; return t >= 0n ? t / d : -((-t + d - 1n) / d); };
const times = (a: bigint, b: bigint) => (a * b) >> 32n;
const SHOWN = [1, 2 ** 31, 429496730, 4294967295, -1, -429496730, 123456789, 3 * 2 ** 32 + 1];
const decimalParts = (text: string): [bigint, bigint] => {
  const [w, f = ""] = text.split(".");
  return [BigInt(w + f), 10n ** BigInt(f.length)];
};

test("Fixed: exact literals, a physics loop and a big world, evaluated and compiled", async () => {
  const k = new Lang(LIBRARY.code);
  const def = (name: string, body: () => Id) => { const d = k.def(name); k.define(d, body()); return d; };
  const x = (v: number | string) => k.at(FIXED_TYPE, v);
  const stepsOf = (v: Id) => k.match(v, [{ variant: FIXED_V, names: ["steps"], body: ([s]) => s }]);
  const names: string[] = [];
  const show = (name: string, v: () => Id) => { names.push(name); def(name, () => k.call(SHOW_ANY, v())); };
  show("one and a half", () => stepsOf(x(1.5)));
  show("a tenth", () => stepsOf(x(0.1)));
  show("minus a tenth", () => stepsOf(x(-0.1)));
  show("product", () => stepsOf(k.call(ARITH.mul, x(0.1), x(-3.7))));
  show("less", () => k.call(ARITH.less, x(-0.25), x(0.1)));
  // A ball falling for 1,000 steps of 10 ms: v ← v + g·dt, h ← h + v·dt.
  show("fall", () => k.match(k.fold(k.call(INT_OPS.range, k.int(1000)), [
    { variant: "std.list.nil", names: [], body: () => k.call(PAIR_V, x(100), x(0)) },
    { variant: "std.list.cons", names: ["i", "rest"], results: [null, "before"], body: (_, [, before]) => k.match(before!, [
      { variant: PAIR_V, names: ["h", "v"], body: ([h, v]) => k.let("v₂", k.call(ARITH.add, v, k.call(ARITH.mul, x(-9.81), x(0.01))), (v2) =>
        k.call(PAIR_V, k.call(ARITH.add, h, k.call(ARITH.mul, v2, x(0.01))), v2)) },
    ]) },
  ]), [{ variant: PAIR_V, names: ["h", "v"], body: ([h, v]) => k.call(SHOW_ANY, k.call(PAIR_V, stepsOf(h), stepsOf(v))) }]));
  // A step past 10¹², and back: Fixed keeps it.
  show("far away", () => stepsOf(k.call(ARITH.sub, k.call(ARITH.add, k.call(lib("as fixed"), k.int(10 ** 12)), k.call(FIXED_V, k.int(1))), x(1e12))));
  show("as float64", () => k.call(lib("show fixed"), x(-2.75)));
  // Shown as the shortest decimal that reads back to the same steps.
  SHOWN.forEach((st, j) => show(`shown ${j}`, () => k.call(lib("show fixed"), k.call(FIXED_V, k.int(st)))));
  show("a third", () => k.call(S.all, k.thunk(() => stepsOf(k.call(lib("divide fixed"), x(1), x(3))))));
  show("by zero", () => k.call(S.all, k.thunk(() => k.call(lib("divide fixed"), x(1), x(0)))));
  const code = base(k.code), info = infer(code, baseNames(k.names), undefined, checkOptions);
  const nm = baseNames(k.names);
  assert.deepEqual(info.errors.map((e) => e.message), []);
  const r = makeRunner(code, info, { print: () => {}, names: nm });
  const at = (n: string) => code.defs.find((d) => nm[d] === n)!;
  const got = names.map((n) => r.value(at(n)));
  let h = steps(100n, 1n), v = 0n;
  const g = steps(-981n, 100n), dt = steps(1n, 100n);
  for (let i = 0; i < 1000; i++) { v += times(g, dt); h += times(v, dt); }
  assert.deepEqual(got.slice(0, 8), [
    String(3n * ONE / 2n), String(steps(1n, 10n)), String(steps(-1n, 10n)), String(times(steps(1n, 10n), steps(-37n, 10n))), "true",
    `"pair(${h}, ${v})"`, "1", "\"-2.75\"",
  ]);
  // Each shown decimal reads back to its steps, and one digit fewer doesn't.
  SHOWN.forEach((st, j) => {
    const text = JSON.parse(got[8 + j] as string) as string;
    const [top, bottom] = decimalParts(text);
    assert.equal(steps(top, bottom), BigInt(st), `${text} reads back to ${st}`);
    // The two decimals one digit shorter around it read back to other steps.
    const [t, b] = decimalParts(text.slice(0, -1));
    if (text.includes(".") && !text.endsWith(".") && b > 1n) for (const near of [t, t < 0n ? t - 1n : t + 1n]) assert.notEqual(steps(near, b), BigInt(st));
  });
  assert.equal(got[8 + SHOWN.length], `[${(ONE * ONE) / (3n * ONE)}]`);
  assert.equal(got[9 + SHOWN.length], "[]");
  const path = join(mkdtempSync(join(tmpdir(), "fixed-")), "fixed.js");
  writeFileSync(path, compile(code, info, nm, { runtime, exports: names }));
  const defs = (await import(pathToFileURL(path).href)).defs as Record<string, unknown>;
  assert.deepEqual(names.map((n) => (typeof defs[n] === "function" ? (defs[n] as () => Value)() : defs[n])), got);
});

// Trig at Fixed (FIXED-POINT.md step 2): the one sin, cos, tan, exp and log
// at Fixed are CORDIC and series in Ints, so evaluated and compiled give
// the same steps; each is within a few steps of the true value.
test("Fixed: CORDIC sin and cos, tan, exp, log and square root, evaluated and compiled", async () => {
  const k = new Lang(LIBRARY.code);
  const def = (name: string, body: () => Id) => { const d = k.def(name); k.define(d, body()); return d; };
  const x = (v: number) => k.at(FIXED_TYPE, v);
  const stepsOf = (v: Id) => k.match(v, [{ variant: FIXED_V, names: ["steps"], body: ([s]) => s }]);
  const cases: [string, (a: Id) => Id, (a: number) => number, number[]][] = [
    ["sin", (a) => k.call(TRIG_OPS.sin, a), Math.sin, [0, 0.5, 1.5707963, 2, 3.14159, -1, -2.5, 10, -100, 1000.25]],
    ["cos", (a) => k.call(TRIG_OPS.cos, a), Math.cos, [0, 0.5, 2, 3.14159, -1, -2.5, 10, 1000.25]],
    ["tan", (a) => k.call(TRIG_OPS.tan, a), Math.tan, [0, 0.5, -1, 1.2, 4]],
    ["exp", (a) => k.call(TRIG_OPS.exp, a), Math.exp, [0, 1, -1, 0.5, 2.5, -7, 10]],
    ["log", (a) => k.call(TRIG_OPS.log, a), Math.log, [1, 2, 0.5, 10, 1e-3, 12345.678, 1e9]],
    ["sqrt", (a) => k.call(S.all, k.thunk(() => k.call(lib("square root fixed"), a))), Math.sqrt, [0, 1, 2, 0.25, 1e-6, 12345.678, 1e12]],
  ];
  const names: string[] = [];
  for (const [op, f, , xs] of cases) xs.forEach((v, j) => { names.push(`${op} ${j}`); def(`${op} ${j}`, () => k.call(SHOW_ANY, op === "sqrt" ? k.call(lib("map"), f(x(v)), k.fn(["r"], (r) => stepsOf(r))) : stepsOf(f(x(v))))); });
  const code = base(k.code), info = infer(code, baseNames(k.names), undefined, checkOptions);
  const nm = baseNames(k.names);
  assert.deepEqual(info.errors.map((e) => e.message), []);
  const r = makeRunner(code, info, { print: () => {}, names: nm });
  const at = (n: string) => code.defs.find((d) => nm[d] === n)!;
  const got = names.map((n) => r.value(at(n)));
  let i = 0;
  for (const [op, , want, xs] of cases) for (const v of xs) {
    const shown = String(got[i++]).replace(/^\[|\]$/g, "");
    const value = Number(BigInt(shown)) / 2 ** 32, exact = want(Number(steps(...decimalParts(String(v)))) / 2 ** 32);
    assert.ok(Math.abs(value - exact) <= 2e-8 * Math.max(1, Math.abs(exact)), `${op}(${v}) = ${value}, not ${exact}`);
  }
  const path = join(mkdtempSync(join(tmpdir(), "fixed-trig-")), "trig.js");
  writeFileSync(path, compile(code, info, nm, { runtime, exports: names }));
  const defs = (await import(pathToFileURL(path).href)).defs as Record<string, unknown>;
  assert.deepEqual(names.map((n) => (typeof defs[n] === "function" ? (defs[n] as () => Value)() : defs[n])), got);
});
