// The scalar profile compiled to C (native programs, stage N1 of
// projectional/NATIVE.md) must give exactly the evaluator's numbers. Each
// test builds a program with the system's C compiler and talks to it
// through c.ts's harness: calls in on standard input, answers' bits out.

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { makeRunner, type Value } from "../../projectional/src/lang/run.ts";
import { TRUE } from "../../projectional/src/lang/std.ts";
import { lowerScalar, type Lowered } from "../src/scalar.ts";
import { CFLAGS, emitC } from "../src/c.ts";
import { load } from "../src/program.ts";
import { area, maths } from "../src/fixtures.ts";

const cc = process.env.CC ?? "cc";
let have = true;
try { execFileSync(cc, ["--version"], { stdio: "ignore" }); } catch { have = false; }
const skip = have ? false : `no C compiler (${cc})`;
const dir = mkdtempSync(join(tmpdir(), "native-"));
let builds = 0;

// The program built, and a function that makes the calls and gives back
// each answer's parts: numbers, and Bools as true or false.
function build(lowered: Lowered) {
  const { c } = emitC(lowered, { harness: true });
  const src = join(dir, `p${builds}.c`), exe = join(dir, `p${builds++}`);
  writeFileSync(src, c);
  execFileSync(cc, [...CFLAGS, "-Wall", "-Werror", "-Wno-unknown-warning-option", "-Wno-unused-function", "-Wno-maybe-uninitialized", "-Wno-unused-but-set-variable", "-Wno-unknown-pragmas", "-o", exe, src, "-lm"]);
  return (calls: [number, number[]][]) => {
    const bits = (x: number) => new BigUint64Array(new Float64Array([x]).buffer)[0].toString(16);
    const input = calls.map(([i, xs]) => [i, ...xs.map((x, j) => (lowered.funcs[i].params[j] === "i32" ? String(x) : bits(x)))].join(" ")).join("\n") + "\n";
    const out = execFileSync(exe, { input, maxBuffer: 1 << 28 }).toString().trim().split("\n");
    return out.map((l) => l.trim().split(/\s+/).filter(Boolean).map((w) => (w.length === 16 ? new Float64Array(new BigUint64Array([BigInt(`0x${w}`)]).buffer)[0] : w === "1")));
  };
}
const first = (xs: Iterable<Value>) => { for (const x of xs) return x; };
// The evaluator's answer as the harness prints it.
const parts = (v: Value): (number | boolean)[] =>
  typeof v === "number" ? [v] : (v as { tag: string }).tag === TRUE ? [true] : (v as { tag: string }).tag === "std.bool.false" ? [false] : (v as { fields: Value[] }).fields.flatMap(parts);

for (const name of ["calculus", "physics"]) {
  test(`${name}: scalar definitions as C give the evaluator's exact numbers`, { skip }, () => {
    const p = load(name);
    const lowered = lowerScalar(p.code, p.info, p.pres.names, p.own.defs);
    const run = build(lowered);
    const r = makeRunner(p.code, p.info, { print: () => {} });
    const calls: [number, number[]][] = [];
    lowered.funcs.forEach((f, i) => { for (const x of [-2.5, -1, 0, 0.5, 2, 3.7, 1e6]) calls.push([i, f.params.map((_, j) => x + j)]); });
    const got = run(calls);
    calls.forEach(([i, xs], k) => assert.deepEqual(got[k], parts(first(r.call(r.value(lowered.funcs[i].def), ...xs))!), `${lowered.funcs[i].name}(${xs})`));
    assert.ok(calls.length > 10);
  });
}

test("records are structs: the ray marcher's colours in C, exactly the evaluator's", { skip }, () => {
  const p = load("raymarch");
  const lowered = lowerScalar(p.code, p.info, p.pres.names, p.own.defs, { records: true });
  assert.deepEqual(lowered.records.map((r) => r.name), ["Vec", "Colour"]);
  assert.match(emitC(lowered).c, /typedef struct \{ double f0; double f1; double f2; \} Vec;/);
  const run = build(lowered);
  const r = makeRunner(p.code, p.info, { print: () => {} });
  const colour = lowered.funcs.findIndex((f) => f.name === "colour" && f.params.every((t) => t === "f64"));
  const at = [[0, 0, 0], [0.3, -0.2, 1.5], [-0.9, 0.7, 4], [0.5, 0.5, 10], [0.1, 0.9, 2.2]];
  const got = run(at.map((xs) => [colour, xs]));
  at.forEach((xs, k) => assert.deepEqual(got[k], parts(first(r.call(r.value(lowered.funcs[colour].def), ...xs))!), `colour(${xs})`));
});

test("sin, cos, tan, exp, log, pow and atan2 in C: V8's fdlibm, the same bits as Node's Math", { skip }, () => {
  const p = maths();
  const lowered = lowerScalar(p.code, p.info, p.names, Object.values(p.defs));
  const run = build(lowered);
  const F = { sin: Math.sin, cos: Math.cos, tan: Math.tan, exp: Math.exp, log: Math.log, pow: Math.pow, atan2: Math.atan2 } as Record<string, (x: number, y: number) => number>;
  let seed = 11n;
  const next = () => Number((seed = (seed * 6364136223846793005n + 1442695040888963407n) % 2n ** 64n) >> 11n) / 2 ** 53;
  const anyBits = () => new Float64Array(new BigUint64Array([BigInt(Math.floor(next() * 2 ** 32)) << 32n | BigInt(Math.floor(next() * 2 ** 32))]).buffer)[0];
  const pick = () => { const k = next(); return k < 0.3 ? (next() - 0.5) * 20 : k < 0.5 ? (next() - 0.5) * 2e7 : k < 0.6 ? next() * 1e-5 : k < 0.65 ? [0, -0, NaN, Infinity, -Infinity, 1, -1, 0.5, 2, 1e22, 1e300, 5e-324][Math.floor(next() * 12)] : anyBits(); };
  const calls: [number, number[]][] = [], want: number[] = [];
  for (const [op, f] of Object.entries(F)) {
    const i = lowered.funcs.findIndex((g) => g.def === p.defs[op as keyof typeof p.defs]);
    for (let k = 0; k < 20000; k++) {
      const x = pick(), y = op === "pow" && next() < 0.4 ? Math.round(pick() % 20) : pick();
      calls.push([i, lowered.funcs[i].params.length === 2 ? [x, y] : [x]]);
      want.push(f(x, y));
    }
  }
  const got = run(calls);
  calls.forEach(([i, xs], k) => assert.ok(Object.is(got[k][0], want[k]), `${lowered.funcs[i].name}(${xs}): ${got[k][0]}, not ${want[k]}`));
});

test("tail calls are loops in C, and a budget runs out where the evaluator's does", { skip }, () => {
  const a = area();
  const lowered = lowerScalar(a.code, a.info, a.names, [a.integral, a.capped]);
  assert.match(emitC(lowered).c, /for \(;;\)/);
  const run = build(lowered);
  const r = makeRunner(a.code, a.info, { print: () => {} });
  const integral = lowered.funcs.findIndex((f) => f.def === a.integral), capped = lowered.funcs.findIndex((f) => f.def === a.capped);
  const steps = [0, 1, 9, 10, 11, 1e9];
  const got = run([[integral, [0, 0.01, 200]], [integral, [0, 2e-6, 1e6]], ...steps.map((n): [number, number[]] => [capped, [0, 0.25, n]])]);
  assert.ok(Object.is(got[0][0], first(r.call(r.value(a.integral), 0, 0.01, 200))));
  // ∫₀² x³ − x − 1 dx = 0, in a million strips, in constant stack.
  assert.ok(Math.abs(got[1][0] as number) < 1e-4);
  steps.forEach((n, k) => assert.ok(Object.is(got[k + 2][0], first(r.call(r.value(a.capped), 0, 0.25, n))), `${n} strips`));
});
