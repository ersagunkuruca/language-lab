// The lowering compiled to C (native programs, docs/design/targets/NATIVE.md) must
// give exactly the evaluator's answers, and with data, free every cell it
// made. Each test builds a program with the system's C compiler and talks
// to it through c.ts's harness: calls in on standard input, answers out,
// then the number of cells still live. NATIVE_CFLAGS adds flags, such as
// -fsanitize=address,undefined to look for a cell used after it's freed.

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { Aborted, bool, fromList, makeRunner, runProgram, toList, type Value } from "../../ters/src/lang/run.ts";
import { nodeWorld } from "../../ters/src/lang/world.ts";
import { book } from "../gaps/ledger.ts";
import { norm } from "../../ters/src/lang/int.ts";
import { TRUE } from "../../ters/src/lang/std.ts";
import { isRecord, lowerScalar, type DType, type LType, type Lowered, type RType } from "../src/scalar.ts";
import { CFLAGS, emitC } from "../src/c.ts";
import { load } from "../src/program.ts";
import { area, escapes, fractionInputs, fractions, maths, ordered, orderedInputs, roses, sameLists, stopsWith, worldly } from "../src/fixtures.ts";

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
  if (t === "int") { out.push(String(v)); return; }
  if (t === "text") { out.push(`x${Buffer.from(v as string).toString("hex")}`); return; }
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
  if (t === "int") return norm(BigInt(ws.shift()!));
  if (t === "text") return Buffer.from(ws.shift()!.slice(1), "hex").toString();
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
const compile = (c: string) => {
  const src = join(dir, `p${builds}.c`), exe = join(dir, `p${builds++}`);
  writeFileSync(src, c);
  // GCC can't see that a cell freed at count 1 is never a static one (whose count is 0): -Wno-free-nonheap-object.
  execFileSync(cc, [...CFLAGS, "-pthread", "-Wall", "-Werror", "-Wno-unknown-warning-option", "-Wno-unused-function", "-Wno-maybe-uninitialized", "-Wno-free-nonheap-object", "-Wno-unused-but-set-variable", "-Wno-unused-variable", "-Wno-unknown-pragmas", ...(process.env.NATIVE_CFLAGS ?? "").split(" ").filter(Boolean), "-o", exe, src, "-lm"]);
  return exe;
};
function build(lowered: Lowered) {
  const exe = compile(emitC(lowered, { harness: true }).c);
  return (calls: [number, Value[]][]) => {
    const input = calls.map(([i, xs]) => { const out = [String(i)]; xs.forEach((x, j) => encode(x, lowered.funcs[i].params[j], out)); return out.join(" "); }).join("\n") + "\n";
    const lines = execFileSync(exe, { input, maxBuffer: 1 << 28 }).toString().trim().split("\n");
    return lines.map((l, k) => {
      const ws = l.trim().split(/\s+/);
      const live = Number(ws.pop()!.slice(1));
      // "?": no answer (a function with one answer or none).
      // "!": aborted, with the reason.
      const value = ws[0] === "?" ? undefined : ws[0] === "!" ? { aborted: decode(ws.slice(1), "text") } : decode(ws, lowered.funcs[calls[k][0]].result);
      return { value: value as Value, live };
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
    // A stop (L125a) is the evaluator's Abort, and C's "!".
    const want = (d: string, xs: Value[]) => { try { return first(r.call(r.value(d), ...xs)); } catch (e) { if (e instanceof Aborted) return { aborted: e.reason } as unknown as Value; throw e; } };
    calls.forEach(([i, xs], k) => assert.deepStrictEqual(got[k].value, want(lowered.funcs[i].def, xs), `${lowered.funcs[i].name}(${xs})`));
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
  const F = { sin: Math.sin, cos: Math.cos, tan: Math.tan, exp: Math.exp, log: Math.log, pow: Math.pow, atan2: (y: number, x: number) => Math.atan2(y + 0, x + 0) } as Record<string, (x: number, y: number) => number>; // −0 is 0 (L125a): atan2(−0, −1) is π
  let seed = 11n;
  const next = () => Number((seed = (seed * 6364136223846793005n + 1442695040888963407n) % 2n ** 64n) >> 11n) / 2 ** 53;
  const anyBits = () => new Float64Array(new BigUint64Array([BigInt(Math.floor(next() * 2 ** 32)) << 32n | BigInt(Math.floor(next() * 2 ** 32))]).buffer)[0];
  const pick = () => { const k = next(); return k < 0.3 ? (next() - 0.5) * 20 : k < 0.5 ? (next() - 0.5) * 2e7 : k < 0.6 ? next() * 1e-5 : k < 0.65 ? [0, -0, 1, -1, 0.5, 2, 1e22, 1e300, 5e-324][Math.floor(next() * 9)] : finiteBits(); };
  // Every Float64 is finite (L125a): any bits but NaN's and the infinities'.
  const finiteBits = (): number => { const x = anyBits(); return Number.isFinite(x) ? x : finiteBits(); };
  const calls: [number, Value[]][] = [], want: Value[] = [];
  for (const [op, f] of Object.entries(F)) {
    const i = lowered.funcs.findIndex((g) => g.def === p.defs[op as keyof typeof p.defs]);
    for (let k = 0; k < 20000; k++) {
      const x = pick(), y = op === "pow" && next() < 0.4 ? Math.round(pick() % 20) : pick();
      calls.push([i, lowered.funcs[i].params.length === 2 ? [x, y] : [x]]);
      const why = stopsWith(op, x, y);
      want.push(why ? { aborted: why } as unknown as Value : f(x, y));
    }
  }
  const got = run(calls);
  calls.forEach(([i, xs], k) => assert.ok(typeof want[k] === "number" ? Object.is(got[k].value, want[k]) : JSON.stringify(got[k].value) === JSON.stringify(want[k]), `${lowered.funcs[i].name}(${xs}): ${JSON.stringify(got[k].value)}, not ${JSON.stringify(want[k])}`));
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
    const bits = (v: Value) => JSON.stringify(v, (_, x) => (typeof x === "number" ? hex(x) : typeof x === "bigint" ? `${x}n` : x));
    // The inputs in the message only when short (a long list is too deep for JSON).
    const said = () => { try { const t = bits(xs); return label(i) + (t.length < 2000 ? ` ${t}` : ""); } catch { return label(i); } };
    const [a, b] = [bits(got[k].value) ?? "none", bits(want(i, xs)) ?? "none"];
    if (a !== b) assert.equal(a, b, said());
    if (got[k].live !== 0) assert.equal(got[k].live, 0, `${said()}: cells left`);
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
  const pairs = [[[1, 2, 3], [1, 2, 3]], [[1, 2, 3], [1, 2]], [[], []], [[0.1 + 0.2], [0.3]], [[1e12], [1e12 + 1]], [[2], [3]], [[1e308], [-1e308]]];
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

// The functions of name that are in C, by name.
function inC(name: string) {
  const p = load(name);
  const lowered = lowerScalar(p.code, p.info, p.pres.names, p.own.defs, { data: true });
  const { refused } = emitC(lowered);
  const r = makeRunner(p.code, p.info, { print: () => {} });
  const at = (fn: string, partial?: boolean) => {
    const i = lowered.funcs.findIndex((g) => g.name === fn && !g.inner && (partial === undefined || g.partial === partial));
    assert.ok(i >= 0 && !refused.has(i), `${name}: ${fn} is in C (${refused.get(i)})`);
    return i;
  };
  const want = (i: number, xs: Value[]) => {
    try { return first(r.call(r.value(lowered.funcs[i].def), ...xs))!; } catch (e) { if (e instanceof Aborted) return { aborted: e.reason } as unknown as Value; throw e; }
  };
  return { p, lowered, r, at, want, label: (i: number) => `${name}: ${lowered.funcs[i].name}` };
}

test("one answer or none in C: partial functions say they have none, and the closures they take and make are counted cells", { skip }, () => {
  const a = inC("algebra");
  const es = fromList(a.r.value(a.p.named("samples")));
  const evaluate = a.at("evaluate"), constant = a.at("constant"), simplify = a.at("simplify"), derivative = a.at("derivative"), newton = a.at("newton");
  const derive = (e: Value) => a.want(derivative, [e]);
  // newton on 1/x (the fourth sample) doubles its guess until it overflows
  // (a stop since L125a): the program calls it within a budget (`root
  // near`), so this leaves it out.
  const calls: [number, Value[]][] = [
    ...es.flatMap((e) => [0, -1.5, 2, 1e-300, 1e300].map((x): [number, Value[]] => [evaluate, [e, x]])),
    ...es.flatMap((e, n): [number, Value[]][] => [[constant, [e]], [simplify, [e]], [simplify, [derive(e)]], ...(n === 3 ? [] : [[newton, [e, derive(e), 1]], [newton, [e, derive(e), -3]]] as [number, Value[]][])]),
  ];
  sameAndFreed(build(a.lowered), calls, a.want, a.label);
  const c = inC("calculus");
  const sinc = c.at("sinc"), parabola = c.at("parabola", true), x2 = c.at("x² − 2");
  sameAndFreed(build(c.lowered), [-2, 0, -0, 1e-9, 3, 1e300].flatMap((x): [number, Value[]][] => [[sinc, [x]], [parabola, [x]], [x2, [x]]]), c.want, c.label);
});

test("searches in C: Countdown's solutions, every answer in the evaluator's order, and every cell freed", { skip }, () => {
  const c = inC("countdown");
  const solutions = c.at("solutions");
  const calls: [number, Value[]][] = [[[1, 2, 3], 6], [[2, 3, 5], 1], [[4], 4], [[4], 5], [[], 0], [[1, 3, 7, 10], 24], [[25, 50, 75, 3, 6], 228]]
    .map(([ns, t]) => [solutions, [toList(ns as number[]), t as number]]);
  sameAndFreed(build(c.lowered), calls, c.want, c.label);
});

test("data built and taken apart in C: Peano numbers and binary ones", { skip }, () => {
  const n = inC("numbers");
  const Nat = n.lowered.funcs[n.at("double")].params[0] as DType, Binary = n.lowered.funcs[n.at("meaning")].params[0] as DType;
  const peano = (k: number): Value => { let v: Value = { tag: Nat.cases[0].variant, fields: [] }; for (let j = 0; j < k; j++) v = { tag: Nat.cases[1].variant, fields: [v] }; return v; };
  const binary = (k: number): Value => (k === 0 ? { tag: Binary.cases[0].variant, fields: [] } : { tag: Binary.cases[1 + (k % 2)].variant, fields: [binary(Math.floor(k / 2))] });
  const ks = [0, 1, 2, 3, 5];
  const one = (fn: string) => ks.map((k): [number, Value[]] => [n.at(fn), [peano(k)]]);
  const two = (fn: string) => ks.flatMap((k) => ks.slice(0, 3).map((j): [number, Value[]] => [n.at(fn), [peano(k), peano(j)]]));
  const calls = [...one("double"), ...one("number"), ...one("factorial"), ...one("is even"), ...two("add"), ...two("multiply"), ...two("power"),
    ...[0, 1, 6, 100, 300].map((k): [number, Value[]] => [n.at("meaning"), [binary(k)]])];
  sameAndFreed(build(n.lowered), calls, n.want, n.label);
});

test("Ints in C: the evaluator's whole numbers, any size, through calc's arithmetic", { skip }, () => {
  const c = inC("calc");
  const apply = c.at("apply");
  let seed = 7n;
  const next = () => (seed = (seed * 6364136223846793005n + 1442695040888963407n) % 2n ** 64n);
  const pick = (): bigint => {
    const k = Number(next() % 10n), sign = next() % 2n ? -1n : 1n;
    if (k < 3) return sign * (next() % 100n);
    if (k < 5) return sign * (2n ** 62n + (next() % 5n) - 2n);
    if (k < 7) return sign * (next() * next() * (next() % 3n ? next() : 1n));
    return sign * (next() % 2n ** 64n);
  };
  const ops = ["+", "-", "*", "/", "%", "^"];
  const calls: [number, Value[]][] = [];
  for (let k = 0; k < 400; k++) {
    const op = ops[k % ops.length], a = pick(), b = op === "^" ? next() % 7n - 1n : op === "/" || op === "%" ? (k % 40 ? pick() : 0n) : pick();
    calls.push([apply, [op, norm(a), norm(b)]]);
  }
  calls.push([apply, ["^", 3, 200]], [apply, ["^", -1, norm(2n ** 70n)]], [apply, ["^", 0, 0]], [apply, ["?", 1, 2]]);
  sameAndFreed(build(c.lowered), calls, c.want, c.label);
  const l = inC("ledger");
  const money = l.at("money"), pad = l.at("pad");
  const amount = l.at("amount");
  sameAndFreed(build(l.lowered), [
    ...[0, 5, -5, 123456, -100, norm(10n ** 30n + 7n)].map((x): [number, Value[]] => [money, [x]]), [pad, ["ab", 5]], [pad, ["abcdef", 2]],
    // Aborts, with the evaluator's reasons.
    ...["12.50", "-3.07", "7", "x", "1.2.3", "", "99999999999999999999.99"].map((t, k): [number, Value[]] => [amount, [t, k + 1]]), [l.at("bad line"), [7]],
  ], l.want, l.label);
  const e = inC("effects");
  sameAndFreed(build(e.lowered), [[10, 3], [10, 0], [-1, 2]].map((xs): [number, Value[]] => [e.at("share"), xs]), e.want, e.label);
});

test("Text in C: parsing, words, slugs and tallies give the evaluator's texts", { skip }, () => {
  const lines = ["1 + 2 * 3", "(4 - 1) ^ 2 / 3", "x + 1", "2 *", "", "  ", "12345678901234567890 * 98765432109876543210", "π ≈ 3", "a b c", "7 % 0"];
  const c = inC("calc");
  const tokens = c.at("tokens"), describe = c.at("describe"), whole = c.at("whole expression");
  const toks = (t: string) => c.want(tokens, [t]);
  sameAndFreed(build(c.lowered), [
    ...lines.map((t): [number, Value[]] => [tokens, [t]]),
    ...lines.map((t): [number, Value[]] => [describe, [toks(t)]]),
    ...lines.map((t): [number, Value[]] => [whole, [toks(t)]]),
  ], c.want, c.label);
  const texts = ["# One\nsome words here\n", "Hello, World! Ça va?", "", "  many   spaces\tand\ttabs  ", "emoji 🙂 and ünïcödé", "## Two: The Return", "x".repeat(3000)];
  const ch = inC("chapters");
  sameAndFreed(build(ch.lowered), ["words", "lower", "slug", "heading"].flatMap((fn) => texts.map((t): [number, Value[]] => [ch.at(fn), [t]])), ch.want, ch.label);
  const w = inC("wc");
  sameAndFreed(build(w.lowered), texts.map((t): [number, Value[]] => [w.at("count"), [t]]), w.want, w.label);
  const b = inC("backwards");
  sameAndFreed(build(b.lowered), [[b.at("greet"), ["Ada"]], [b.at("words"), [toList(["a", "bb", ""])]]], b.want, b.label);
});

test("Float64s shown in C: JavaScript's shortest digits, rounded as the evaluator rounds", { skip }, () => {
  const v = inC("converter");
  let seed = 3n;
  const next = () => Number((seed = (seed * 6364136223846793005n + 1442695040888963407n) % 2n ** 64n) >> 11n) / 2 ** 53;
  const xs = [0, -0, 1, -1, 0.5, 1e21, 1e-7, 123.456, 1 / 3, 5e-324, 1.7976931348623157e308, 0.1 + 0.2, 2 ** 53, 4.35, 1e-10, 0.0000005,
    ...Array.from({ length: 300 }, (_, k) => (next() - 0.5) * 10 ** Math.floor(next() * 40 - 20) * (k % 3 ? 1 : 1e9))];
  sameAndFreed(build(v.lowered), ["as °C", "as cups", "as min/km"].flatMap((fn) => xs.map((x): [number, Value[]] => [v.at(fn), [x]])), v.want, v.label);
});

// Whole programs (NATIVE.md N4b): main with its arguments, the console and
// files, in a folder of their own, against the evaluator with Node's world
// in another folder with the same files.
test("whole programs in C: files, console, arguments and exit codes as the evaluator's with Node's world", { skip }, () => {
  const scratch = mkdtempSync(join(tmpdir(), "native-run-"));
  const files: Record<string, string> = {
    "a.txt": "one two\nthree\n", "book.md": "# One\nhello world\n# Two\nmore words here\n", "sums.txt": "1+2\nlet x = 3\nx*x\n1 +\n",
    "ledger.csv": "2026-09-01,salary,350000,pay\n2026-09-02,rent,-120000,flat\n", "big.csv": book(500), "out/.keep": "", "Ünï 🎉.txt": "é\n", "z.txt": "", "Zed.txt": "",
  };
  const folder = () => {
    const d = mkdtempSync(join(scratch, "d-"));
    for (const [p, t] of Object.entries(files)) { mkdirSync(join(d, dirname(p)), { recursive: true }); writeFileSync(join(d, p), t); }
    return d;
  };
  const contents = (d: string): Record<string, string> => Object.fromEntries((readdirSync(d, { recursive: true }) as string[]).sort()
    .map((p) => [p, statSync(join(d, p)).isDirectory() ? "(folder)" : readFileSync(join(d, p), "utf8")]));
  const w = worldly();
  const programs = [
    ...["wc", "ledger", "chapters", "calc", "queens"].map((name) => { const p = load(name); return { name, code: p.code, info: p.info, names: p.pres.names, roots: p.own.defs, main: p.named("main") }; }),
    { name: "worldly", code: w.code, info: w.info, names: w.names, roots: [w.main], main: w.main },
  ];
  const argsets = [[], ["a.txt", "Ünï 🎉.txt"], ["-l", "a.txt", "nope", "out"], ["book.md", "out"], ["book.md", "gone"], ["ledger.csv"], ["big.csv"], ["out", "a.txt"], ["."], ["a.txt/x"]];
  let runs = 0;
  for (const p of programs) {
    const exe = compile(emitC(lowerScalar(p.code, p.info, p.names, p.roots, { data: true }), { main: p.main }).c);
    // The console's input matters to calc and worldly (read line), the
    // arguments to the rest.
    const inputs = ["calc", "worldly"].includes(p.name) ? ["3*4\nlet\n", "a\r\nb", "(((2)))^10 % 7\n-(5 - 8) * 2 / 0\nzz\n"] : ["3*4\n"];
    for (const args of p.name === "queens" ? [[]] : p.name === "calc" ? argsets.slice(0, 3) : argsets) for (const input of inputs) {
      const want = folder(), got = folder();
      const printed: string[] = [], errors: string[] = [], lines = input.split("\n");
      const cwd = process.cwd();
      process.chdir(want);
      let exit: number;
      try {
        exit = runProgram(p.code, p.info, p.main, args, { print: (l) => printed.push(l), names: p.names, world: {
          ...nodeWorld(), error: (l) => errors.push(l), input: () => lines.splice(0).join("\n"),
          readLine: () => (lines.length > 1 || lines[0] ? lines.shift()!.replace(/\r$/, "") : null),
        } });
      } finally { process.chdir(cwd); }
      const r = spawnSync(exe, args, { cwd: got, input, maxBuffer: 1 << 26 });
      const lined = (xs: string[]) => xs.map((l) => `${l}\n`).join("");
      assert.deepEqual(
        { code: r.status, out: r.stdout.toString(), err: r.stderr.toString(), files: contents(got) },
        { code: exit, out: lined(printed), err: lined(errors), files: contents(want) },
        `${p.name} ${args.join(" ")} < ${JSON.stringify(input)}`);
      runs++;
    }
  }
  assert.equal(runs, 70);
  // Nesting 100,000 deep: main's thread has the stack for it.
  const calc = load("calc");
  const exe = compile(emitC(lowerScalar(calc.code, calc.info, calc.pres.names, calc.own.defs, { data: true }), { main: calc.named("main") }).c);
  const deep = spawnSync(exe, [], { input: `${"(".repeat(1e5)}1${")".repeat(1e5)}\n` });
  assert.equal(deep.stdout.toString(), "1\n", deep.stderr.toString());
});

test("fractions in C: the evaluator's answers in lowest terms, past 2⁶⁴ too, none at a zero bottom, and every cell freed", { skip }, () => {
  const p = fractions();
  const lowered = lowerScalar(p.code, p.info, p.names, Object.values(p.defs), { data: true });
  const r = makeRunner(p.code, p.info, { print: () => {} });
  const calls: [number, Value[]][] = [];
  for (const def of Object.values(p.defs)) {
    const i = lowered.funcs.findIndex((g) => g.def === def && !g.inner);
    assert.ok(i >= 0 && !emitC(lowered).refused.has(i), `${p.names[def]} is in C`);
    for (const xs of fractionInputs(lowered.funcs[i].params.length, 150)) calls.push([i, xs.map(norm)]);
  }
  sameAndFreed(build(lowered), calls, (i, xs) => first(r.call(r.value(lowered.funcs[i].def), ...xs))!, (i) => lowered.funcs[i].name);
});

test("compare and sort in C: the evaluator's order on every plain type, and every cell freed", { skip }, () => {
  const p = ordered();
  const lowered = lowerScalar(p.code, p.info, p.names, Object.values(p.defs), { data: true });
  const r = makeRunner(p.code, p.info, { print: () => {} });
  const inputs = orderedInputs(), calls: [number, Value[]][] = [];
  const value = (x: unknown): Value => (typeof x === "bigint" ? norm(x) : Array.isArray(x) ? toList(x.map(value)) : x as Value);
  for (const [name, def] of Object.entries(p.defs)) {
    const i = lowered.funcs.findIndex((g) => g.def === def && !g.inner);
    assert.ok(i >= 0 && !emitC(lowered).refused.has(i), `${name} is in C`);
    for (const xs of inputs[name]) calls.push([i, xs.map(value)]);
  }
  sameAndFreed(build(lowered), calls, (i, xs) => first(r.call(r.value(lowered.funcs[i].def), ...xs))!, (i) => lowered.funcs[i].name);
});

test("a program's own effects that never return, in C as Abort is, and every cell freed", { skip }, () => {
  const p = escapes();
  const lowered = lowerScalar(p.code, p.info, p.names, Object.values(p.defs), { data: true });
  const r = makeRunner(p.code, p.info, { print: () => {} });
  const calls: [number, Value[]][] = [];
  for (const def of Object.values(p.defs)) {
    const i = lowered.funcs.findIndex((g) => g.def === def && !g.inner);
    assert.ok(i >= 0 && !emitC(lowered).refused.has(i), `${p.names[def]} is in C`);
    for (const t of ["", "x", "a", "y", "q", "b"]) calls.push([i, [t]]);
  }
  sameAndFreed(build(lowered), calls, (i, xs) => { try { return first(r.call(r.value(lowered.funcs[i].def), ...xs))!; } catch (e) { if (e instanceof Aborted) return { aborted: e.reason } as unknown as Value; throw e; } }, (i) => lowered.funcs[i].name);
});

test("a recursive let in C: lifted to a definition, the evaluator's answers, every cell freed (BACKLOG L84)", { skip }, async () => {
  const { recursiveLets } = await import("../src/fixtures.ts");
  const p = recursiveLets();
  const lowered = lowerScalar(p.code, p.info, p.names, [p.scaledSum], { data: true });
  const i = lowered.funcs.findIndex((f) => f.name === "scaled sum" && !f.inner);
  const r = makeRunner(p.code, p.info, { print: () => {} });
  sameAndFreed(build(lowered), [[[1, 2, 3], 2], [[], 5], [[0.5, -1.5], -2]].map(([xs, c]): [number, Value[]] => [i, [toList(xs as number[]), c as number]]), (_, xs) => first(r.call(r.value(p.scaledSum), ...xs))!, () => "scaled sum");
});
