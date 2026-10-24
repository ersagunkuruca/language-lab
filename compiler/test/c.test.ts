// The lowering compiled to C (native programs, projectional/NATIVE.md) must
// give exactly the evaluator's answers, and with data, free every cell it
// made. Each test builds a program with the system's C compiler and talks
// to it through c.ts's harness: calls in on standard input, answers out,
// then the number of cells still live. NATIVE_CFLAGS adds flags, such as
// -fsanitize=address,undefined to look for a cell used after it's freed.

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bool, fromList, makeRunner, toList, type Value } from "../../projectional/src/lang/run.ts";
import { TRUE } from "../../projectional/src/lang/std.ts";
import { isRecord, lowerScalar, type DType, type LType, type Lowered, type RType } from "../src/scalar.ts";
import { CFLAGS, emitC } from "../src/c.ts";
import { load } from "../src/program.ts";
import { area, maths, roses, sameLists } from "../src/fixtures.ts";

const cc = process.env.CC ?? "cc";
let have = true;
try { execFileSync(cc, ["--version"], { stdio: "ignore" }); } catch { have = false; }
const skip = have ? false : `no C compiler (${cc})`;
const dir = mkdtempSync(join(tmpdir(), "native-"));
let builds = 0;

type Data = { tag: string; fields: Value[] };
const hex = (x: number) => new BigUint64Array(new Float64Array([x]).buffer)[0].toString(16);
const unhex = (w: string) => new Float64Array(new BigUint64Array([BigInt(`0x${w}`)]).buffer)[0];
// A value as the harness reads it; data along its last field with a loop.
function encode(v: Value, t: LType, out: string[]): void {
  if (t === "f64") { out.push(hex(v as number)); return; }
  if (t === "i32") { out.push((v as Data).tag === TRUE ? "1" : "0"); return; }
  if (isRecord(t)) { t.fields.forEach((f, j) => encode((v as Data).fields[j], f.t, out)); return; }
  const d = t as DType;
  for (let x = v as Data; ;) {
    const j = d.cases.findIndex((c) => c.variant === x.tag), c = d.cases[j];
    out.push(String(j));
    const self = c.fields.length > 0 && c.fields.at(-1)!.t === d;
    c.fields.forEach((f, k) => { if (!(self && k === c.fields.length - 1)) encode(x.fields[k], f.t, out); });
    if (!self) return;
    x = x.fields.at(-1) as Data;
  }
}
function decode(ws: string[], t: LType): Value {
  if (t === "f64") return unhex(ws.shift()!);
  if (t === "i32") return bool(ws.shift() === "1");
  if (isRecord(t)) return { tag: (t as RType).variant, fields: t.fields.map((f) => decode(ws, f.t)) };
  const d = t as DType, top: Data = { tag: "", fields: [] };
  for (let into = top; ;) {
    const c = d.cases[Number(ws.shift())];
    const self = c.fields.length > 0 && c.fields.at(-1)!.t === d;
    const x: Data = { tag: c.variant, fields: c.fields.map((f, k) => (self && k === c.fields.length - 1 ? null : decode(ws, f.t))) as Value[] };
    into.fields.push(x);
    if (!self) return top.fields[0];
    x.fields.pop();
    into = x;
  }
}

// The program built, and a function that makes the calls and gives back
// each answer, with the cells still live after it.
function build(lowered: Lowered) {
  const { c } = emitC(lowered, { harness: true });
  const src = join(dir, `p${builds}.c`), exe = join(dir, `p${builds++}`);
  writeFileSync(src, c);
  execFileSync(cc, [...CFLAGS, "-Wall", "-Werror", "-Wno-unknown-warning-option", "-Wno-unused-function", "-Wno-maybe-uninitialized", "-Wno-unused-but-set-variable", "-Wno-unused-variable", "-Wno-unknown-pragmas", ...(process.env.NATIVE_CFLAGS ?? "").split(" ").filter(Boolean), "-o", exe, src, "-lm"]);
  return (calls: [number, Value[]][]) => {
    const input = calls.map(([i, xs]) => { const out = [String(i)]; xs.forEach((x, j) => encode(x, lowered.funcs[i].params[j], out)); return out.join(" "); }).join("\n") + "\n";
    const lines = execFileSync(exe, { input, maxBuffer: 1 << 28 }).toString().trim().split("\n");
    return lines.map((l, k) => {
      const ws = l.trim().split(/\s+/);
      const live = Number(ws.pop()!.slice(1));
      return { value: decode(ws, lowered.funcs[calls[k][0]].result), live };
    });
  };
}
const first = (xs: Iterable<Value>) => { for (const x of xs) return x; };

for (const name of ["calculus", "physics"]) {
  test(`${name}: scalar definitions as C give the evaluator's exact numbers`, { skip }, () => {
    const p = load(name);
    const lowered = lowerScalar(p.code, p.info, p.pres.names, p.own.defs);
    const run = build(lowered);
    const r = makeRunner(p.code, p.info, { print: () => {} });
    const calls: [number, Value[]][] = [];
    lowered.funcs.forEach((f, i) => { for (const x of [-2.5, -1, 0, 0.5, 2, 3.7, 1e6]) calls.push([i, f.params.map((_, j) => x + j)]); });
    const got = run(calls);
    calls.forEach(([i, xs], k) => assert.deepStrictEqual(got[k].value, first(r.call(r.value(lowered.funcs[i].def), ...xs)), `${lowered.funcs[i].name}(${xs})`));
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
  at.forEach((xs, k) => assert.deepStrictEqual(got[k].value, first(r.call(r.value(lowered.funcs[colour].def), ...xs)), `colour(${xs})`));
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
  const calls: [number, Value[]][] = [], want: number[] = [];
  for (const [op, f] of Object.entries(F)) {
    const i = lowered.funcs.findIndex((g) => g.def === p.defs[op as keyof typeof p.defs]);
    for (let k = 0; k < 20000; k++) {
      const x = pick(), y = op === "pow" && next() < 0.4 ? Math.round(pick() % 20) : pick();
      calls.push([i, lowered.funcs[i].params.length === 2 ? [x, y] : [x]]);
      want.push(f(x, y));
    }
  }
  const got = run(calls);
  calls.forEach(([i, xs], k) => assert.ok(Object.is(got[k].value, want[k]), `${lowered.funcs[i].name}(${xs}): ${got[k].value}, not ${want[k]}`));
});

test("tail calls are loops in C, and a budget runs out where the evaluator's does", { skip }, () => {
  const a = area();
  const lowered = lowerScalar(a.code, a.info, a.names, [a.integral, a.capped]);
  assert.match(emitC(lowered).c, /for \(;;\)/);
  const run = build(lowered);
  const r = makeRunner(a.code, a.info, { print: () => {} });
  const integral = lowered.funcs.findIndex((f) => f.def === a.integral), capped = lowered.funcs.findIndex((f) => f.def === a.capped);
  const steps = [0, 1, 9, 10, 11, 1e9];
  const got = run([[integral, [0, 0.01, 200]], [integral, [0, 2e-6, 1e6]], ...steps.map((n): [number, Value[]] => [capped, [0, 0.25, n]])]);
  assert.ok(Object.is(got[0].value, first(r.call(r.value(a.integral), 0, 0.01, 200))));
  // ∫₀² x³ − x − 1 dx = 0, in a million strips, in constant stack.
  assert.ok(Math.abs(got[1].value as number) < 1e-4);
  steps.forEach((n, k) => assert.ok(Object.is(got[k + 2].value, first(r.call(r.value(a.capped), 0, 0.25, n))), `${n} strips`));
});

// Each answer the evaluator's, and every cell freed once the answer is
// dropped: nothing leaks, and nothing is freed twice (that would crash, or
// show as a count below zero).
function sameAndFreed(run: ReturnType<typeof build>, calls: [number, Value[]][], want: (i: number, xs: Value[]) => Value, label: (i: number) => string) {
  const got = run(calls);
  calls.forEach(([i, xs], k) => {
    // As text, numbers by their bits (-0 and NaN too): a long list is
    // deeper than deepStrictEqual's recursion goes.
    const bits = (v: Value) => JSON.stringify(v, (_, x) => (typeof x === "number" ? hex(x) : x));
    assert.equal(bits(got[k].value), bits(want(i, xs)), label(i));
    assert.equal(got[k].live, 0, `${label(i)}: cells left`);
  });
}

test("data in C: lists, expression trees, matches and folds give the evaluator's answers, and every cell is freed", { skip }, () => {
  const cases: [string, string, () => Value[][]][] = [
    ["sort", "sort", () => [[toList([3, 1, 2, 5, -0.5, 4, 1])], [toList([])], [toList(Array.from({ length: 200 }, (_, i) => (i * 37) % 101))]]],
    ["sort", "insert", () => [[2.5, toList([1, 2, 3, 4])], [0, toList([])]]],
    // A hundred thousand coefficients: the fold is a loop, and so is freeing the list.
    ["calculus", "polynomial", () => [[toList([1, -2, 0.5]), 3], [toList([]), 1], [toList([2, 0, 0, 1]), -1.5], [toList(Array.from({ length: 1e5 }, (_, i) => (i % 7) / 1e3)), 0.999]]],
    ["calculus", "∂polynomial/∂x", () => [[toList([1, -2, 0.5]), 3], [toList([2, 0, 0, 1]), -1.5]]],
    ["countdown", "valid", () => [0, 1, 2, 3].flatMap((k) => [[k, 6, 3], [k, 2, 4]])],
    ["algebra", "derivative", () => []],
  ];
  for (const [name, fn, inputs] of cases) {
    const p = load(name);
    const lowered = lowerScalar(p.code, p.info, p.pres.names, p.own.defs, { data: true });
    const i = lowered.funcs.findIndex((g) => g.name === fn && !g.inner);
    assert.ok(i >= 0, `${name}: ${fn} lowers`);
    const { refused } = emitC(lowered);
    assert.ok(!refused.has(i), `${name}: ${fn} is in C (${refused.get(i)})`);
    const f = lowered.funcs[i];
    const r = makeRunner(p.code, p.info, { print: () => {} });
    let args = inputs();
    if (name === "countdown") args = args.map(([k, ...xs]) => [{ tag: (f.params[0] as DType).cases[k as number].variant, fields: [] }, ...xs]);
    if (name === "algebra") args = fromList(r.value(p.named("samples"))).map((e) => [e]);
    assert.ok(args.length);
    sameAndFreed(build(lowered), args.map((xs) => [i, xs]), (_, xs) => first(r.call(r.value(f.def), ...xs))!, () => `${name}: ${fn}`);
  }
});

test("equal on data in C, and folds over nested data: a rose tree's List of children", { skip }, () => {
  const s = sameLists();
  const ls = lowerScalar(s.code, s.info, s.names, [s.same], { data: true });
  const same = ls.funcs.findIndex((f) => f.name === "same");
  const rs = makeRunner(s.code, s.info, { print: () => {} });
  const pairs = [[[1, 2, 3], [1, 2, 3]], [[1, 2, 3], [1, 2]], [[], []], [[0.1 + 0.2], [0.3]], [[1e12], [1e12 + 1]], [[2], [3]]];
  sameAndFreed(build(ls), pairs.map(([a, b]) => [same, [toList(a), toList(b)]]), (_, xs) => first(rs.call(rs.value(s.same), ...xs))!, () => "same");

  const p = roses();
  const lowered = lowerScalar(p.code, p.info, p.names, Object.values(p.defs), { data: true });
  const { refused } = emitC(lowered);
  const r = makeRunner(p.code, p.info, { print: () => {} });
  const node = (v: number, ...kids: Value[]): Value => ({ tag: p.rose.v.node, fields: [v, toList(kids)] });
  const tree = node(1, node(2), node(3, node(4), node(5)), node(6), node(0, ...Array.from({ length: 1000 }, (_, i) => node(i))));
  const calls: [number, Value[]][] = [];
  for (const n of ["total", "depth", "mirror", "scaled"]) {
    const i = lowered.funcs.findIndex((f) => f.name === n && !f.inner);
    assert.ok(i >= 0 && !refused.has(i), `${n} is in C (${refused.get(i)})`);
    calls.push([i, lowered.funcs[i].params.map((t) => (t === "f64" ? 10 : tree))]);
  }
  sameAndFreed(build(lowered), calls, (i, xs) => first(r.call(r.value(lowered.funcs[i].def), ...xs))!, (i) => lowered.funcs[i].name);
});
