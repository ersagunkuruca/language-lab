// Arrays in compiled JS (C30d): a view on a buffer with room at both ends
// (runtime.js, Ersagun's two-ended array list). An array never changes:
// two pushes onto one array give two arrays, each with its own last item,
// and the evaluator's answers. A push onto the newest array writes into
// the free slot, so a million pushes take linear time.

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { Lang } from "../../ters/src/lang/dsl.ts";
import { infer } from "../../ters/src/lang/infer.ts";
import { makeRunner } from "../../ters/src/lang/run.ts";
import { base, baseNames, checkOptions } from "../../ters/src/lang/load.ts";
import { LIBRARY } from "../../ters/src/lang/library.ts";
import { ARRAY_OPS, COMPARE, CONS, INT_OPS, NIL, ORDER_V, S, SHOW_ANY } from "../../ters/src/lang/std.ts";
import { B } from "../../ters/src/prelude.ts";
import { compile } from "../src/compile.ts";
import { lowerScalar } from "../src/scalar.ts";
import { emitWasm, fromInt, instantiate, toInt } from "../src/wasm.ts";
import { CFLAGS, emitC } from "../src/c.ts";

const runtime = pathToFileURL(join(import.meta.dirname, "../src/runtime.js")).href;

test("an array pushed twice gives two arrays, and a long run of pushes is linear", async () => {
  const k = new Lang(LIBRARY.code);
  const def = (name: string, body: () => string) => { const d = k.def(name); k.define(d, body()); return d; };
  const of = (...xs: number[]) => k.call(ARRAY_OPS.of, k.list(...xs.map((x) => k.int(x))));
  const push = (a: string, x: number) => k.call(ARRAY_OPS.push, a, k.int(x));
  const names: string[] = [];
  const show = (name: string, x: () => string) => { names.push(name); def(name, () => k.call(SHOW_ANY, x())); };
  const base2 = def("base", () => push(of(1, 2), 3));
  show("pushed 4", () => push(k.x(base2), 4));
  show("pushed 5", () => push(k.x(base2), 5));
  show("both", () => k.list(push(push(k.x(base2), 6), 7), push(k.x(base2), 8), k.x(base2)));
  show("from empty", () => push(push(k.call(ARRAY_OPS.empty), 1), 2));
  // n pushes onto the array before: 0, 1, …, n − 1.
  const count = def("count", () => k.fn(["n"], (n) => k.fold(k.call(INT_OPS.range, n), [
    { variant: NIL, names: [], body: () => k.call(ARRAY_OPS.empty) },
    { variant: CONS, names: ["i", "t"], results: [null, "a"], body: ([i], [, a]) => k.call(ARRAY_OPS.push, a!, i) },
  ])));
  const lengthOf = def("length after", () => k.fn(["n"], (n) => k.call(ARRAY_OPS.length, k.call(count, n))));
  const code = base(k.code), nm = baseNames(k.names), info = infer(code, nm, undefined, checkOptions);
  assert.deepEqual(info.errors.map((e) => e.message), []);
  const r = makeRunner(code, info, { print: () => {}, names: nm });
  const want = names.map((n) => r.value(code.defs.find((d) => nm[d] === n)!));
  assert.deepEqual(want, ["array [1, 2, 3, 4]", "array [1, 2, 3, 5]", "[array [1, 2, 3, 6, 7], array [1, 2, 3, 8], array [1, 2, 3]]", "array [1, 2]"]);
  const path = join(mkdtempSync(join(tmpdir(), "arrays-")), "arrays.js");
  writeFileSync(path, compile(code, info, nm, { runtime, exports: [...names, "count", "length after"] }));
  const defs = (await import(pathToFileURL(path).href)).defs as Record<string, unknown>;
  assert.deepEqual(names.map((n) => (typeof defs[n] === "function" ? (defs[n] as () => unknown)() : defs[n])), want);
  // A copy per push would take minutes; free slots take milliseconds.
  const t = performance.now();
  assert.equal(Number((defs["length after"] as (n: number) => unknown)(1_000_000)), 1_000_000);
  assert.ok(performance.now() - t < 5_000, `${performance.now() - t} ms`);
});

test("Array in WebAssembly: the same two-ended buffer, the evaluator's answers, a million pushes in a loop (C66)", async () => {
  const k = new Lang(LIBRARY.code);
  const def = (name: string, body: () => string) => { const d = k.def(name); k.define(d, body()); return d; };
  const lit = (x: number) => k.lit(x);
  const of = (...xs: number[]) => k.call(ARRAY_OPS.of, k.list(...xs.map(lit)));
  const sum = def("sum", () => k.fn(["xs"], (xs) => k.fold(xs, [
    { variant: NIL, names: [], body: () => lit(0) },
    { variant: CONS, names: ["x", "t"], results: [null, "r"], body: ([x], [, r]) => k.call(B.add, x, r!) },
  ])));
  const total = (a: string) => k.call(sum, k.call(ARRAY_OPS.items, a));
  // One array pushed twice: two arrays, each with its own last item.
  const shared = def("shared", () => k.fn(["x"], (x) => k.let("base", k.call(ARRAY_OPS.push, of(1, 2), lit(3)), (b) =>
    k.call(B.add, k.call(B.mul, lit(100), total(k.call(ARRAY_OPS.push, b, x))), total(k.call(ARRAY_OPS.push, k.call(ARRAY_OPS.push, b, lit(5)), lit(6)))))));
  // 0, 1, …, n − 1 pushed one by one; its length; the item at k, or −1.
  const count = def("count", () => k.fn(["n"], (n) => k.fold(k.call(S.range, n), [
    { variant: NIL, names: [], body: () => k.call(ARRAY_OPS.empty) },
    { variant: CONS, names: ["i", "t"], results: [null, "a"], body: ([i], [, a]) => k.call(ARRAY_OPS.push, a!, i) },
  ])));
  def("length after", () => k.fn(["n"], (n) => k.call(ARRAY_OPS.length, k.call(count, n))));
  def("item of", () => k.fn(["n", "i"], (n, i) => k.call(S.first, k.thunk(() => k.call(ARRAY_OPS.at, k.call(count, n), i)), k.thunk(() => lit(-1)))));
  def("total of", () => k.fn(["n"], (n) => total(k.call(count, n))));
  const code = base(k.code), nm = baseNames(k.names), info = infer(code, nm, undefined, checkOptions);
  assert.deepEqual(info.errors.map((e) => e.message), []);
  const named = (n: string) => code.defs.find((d) => nm[d] === n)!;
  const roots = ["shared", "length after", "item of", "total of"];
  const lowered = lowerScalar(code, info, nm, roots.map(named), { data: true });
  assert.deepEqual(roots.flatMap((n) => lowered.refused.has(named(n)) ? [`${n}: ${lowered.refused.get(named(n))}`] : []), []);
  const m = emitWasm(lowered);
  assert.ok(WebAssembly.validate(m.bytes));
  assert.match(m.wat, /\(type \$items\d+ \(array \(mut f64\)\)\)/);
  const w = (await instantiate(m)) as unknown as Record<string, (...xs: unknown[]) => unknown>;
  const r = makeRunner(code, info, { print: () => {}, names: nm });
  const ev = (n: string, ...xs: unknown[]) => [...r.call(r.value(named(n)), ...(xs as never[]))][0];
  assert.equal(w.shared(4), ev("shared", 4));
  assert.equal(w.shared(4), 1000 + 17);
  assert.equal(fromInt(w as never, w["length after"](10)), BigInt(ev("length after", 10) as number));
  for (const [n, i] of [[10, 3], [10, 10], [10, -1], [0, 0]]) assert.equal(w["item of"](n, toInt(w as never, BigInt(i))), Number(ev("item of", n, BigInt(i))), `item ${i} of ${n}`);
  assert.equal(w["total of"](100), ev("total of", 100));
  const t = performance.now();
  assert.equal(fromInt(w as never, w["length after"](1_000_000)), 1_000_000n);
  assert.ok(performance.now() - t < 5_000, `${performance.now() - t} ms`);
});

const cc = process.env.CC ?? "cc";
let haveC = true;
try { execFileSync(cc, ["--version"], { stdio: "ignore" }); } catch { haveC = false; }

test("Array in C: the two-ended buffer as counted cells, the evaluator's answers, nothing left live, a million pushes (C66b)", { skip: haveC ? false : `no C compiler (${cc})` }, () => {
  const k = new Lang(LIBRARY.code);
  const def = (name: string, body: () => string) => { const d = k.def(name); k.define(d, body()); return d; };
  const lit = (x: number) => k.lit(x);
  const of = (...xs: number[]) => k.call(ARRAY_OPS.of, k.list(...xs.map(lit)));
  const sum = def("sum", () => k.fn(["xs"], (xs) => k.fold(xs, [
    { variant: NIL, names: [], body: () => lit(0) },
    { variant: CONS, names: ["x", "t"], results: [null, "r"], body: ([x], [, r]) => k.call(B.add, x, r!) },
  ])));
  const total = (a: string) => k.call(sum, k.call(ARRAY_OPS.items, a));
  def("shared", () => k.fn(["x"], (x) => k.let("base", k.call(ARRAY_OPS.push, of(1, 2), lit(3)), (b) =>
    k.call(B.add, k.call(B.mul, lit(100), total(k.call(ARRAY_OPS.push, b, x))), total(k.call(ARRAY_OPS.push, k.call(ARRAY_OPS.push, b, lit(5)), lit(6)))))));
  const count = def("count", () => k.fn(["n"], (n) => k.fold(k.call(S.range, n), [
    { variant: NIL, names: [], body: () => k.call(ARRAY_OPS.empty) },
    { variant: CONS, names: ["i", "t"], results: [null, "a"], body: ([i], [, a]) => k.call(ARRAY_OPS.push, a!, i) },
  ])));
  def("length after", () => k.fn(["n"], (n) => k.call(ARRAY_OPS.length, k.call(count, n))));
  def("item of", () => k.fn(["n", "i"], (n, i) => k.call(S.first, k.thunk(() => k.call(ARRAY_OPS.at, k.call(count, n), i)), k.thunk(() => lit(-1)))));
  def("total of", () => k.fn(["n"], (n) => total(k.call(count, n))));
  // Counted items: Texts, shared between two arrays pushed from one.
  const words = def("words", () => k.fn(["n"], (n) => k.fold(k.call(S.range, n), [
    { variant: NIL, names: [], body: () => k.call(ARRAY_OPS.empty) },
    { variant: CONS, names: ["i", "t"], results: [null, "a"], body: ([i], [, a]) => k.call(ARRAY_OPS.push, a!, k.call(S.show, i)) },
  ])));
  def("word of", () => k.fn(["n", "i"], (n, i) => k.let("w", k.call(words, n), (w) => k.call(S.first,
    k.thunk(() => k.call(S.concat, k.call(ARRAY_OPS.at, k.call(ARRAY_OPS.push, w, k.lit("!")), i), k.call(ARRAY_OPS.at, k.call(ARRAY_OPS.push, w, k.lit("?")), i))),
    k.thunk(() => k.lit("none"))))));
  const code = base(k.code), nm = baseNames(k.names), info = infer(code, nm, undefined, checkOptions);
  assert.deepEqual(info.errors.map((e) => e.message), []);
  const named = (n: string) => code.defs.find((d) => nm[d] === n)!;
  const roots = ["shared", "length after", "item of", "total of", "word of"];
  const lowered = lowerScalar(code, info, nm, roots.map(named), { data: true });
  assert.deepEqual(roots.flatMap((n) => lowered.refused.has(named(n)) ? [`${n}: ${lowered.refused.get(named(n))}`] : []), []);
  const out = emitC(lowered, { harness: true });
  assert.deepEqual([...out.refused.values()], []);
  const dir = mkdtempSync(join(tmpdir(), "arrays-c-")), exe = join(dir, "arrays");
  writeFileSync(`${exe}.c`, out.c);
  execFileSync(cc, [...CFLAGS, "-pthread", "-Wall", "-Werror", "-Wno-unknown-warning-option", "-Wno-unused-function", "-Wno-maybe-uninitialized", "-Wno-free-nonheap-object", "-Wno-unused-but-set-variable", "-Wno-unused-variable", "-Wno-unknown-pragmas", ...(process.env.NATIVE_CFLAGS ?? "").split(" ").filter(Boolean), "-o", exe, `${exe}.c`, "-lm"]);
  // The harness: a call a line (the function's number, then its inputs),
  // its answer a line, then the cells still live.
  const fn = (n: string) => lowered.funcs.findIndex((f) => f.def === named(n) && !f.inner);
  const hex = (x: number) => new BigUint64Array(new Float64Array([x]).buffer)[0].toString(16);
  const unhex = (w: string) => new Float64Array(new BigUint64Array([BigInt(`0x${w}`)]).buffer)[0];
  const run = (lines: string[]) => execFileSync(exe, { input: lines.join("\n") + "\n", maxBuffer: 1 << 24 }).toString().trim().split("\n").map((l) => l.trim().split(/\s+/));
  const r = makeRunner(code, info, { print: () => {}, names: nm });
  const ev = (n: string, ...xs: unknown[]) => [...r.call(r.value(named(n)), ...(xs as never[]))][0];
  const items: [number, number][] = [[10, 3], [10, 10], [10, -1], [0, 0]], wordsAt: [number, number][] = [[12, 11], [12, 0], [12, 12]];
  const got = run([
    `${fn("shared")} ${hex(4)}`, `${fn("length after")} ${hex(10)}`, `${fn("total of")} ${hex(100)}`,
    ...items.map(([n, i]) => `${fn("item of")} ${hex(n)} ${i}`),
    ...wordsAt.map(([n, i]) => `${fn("word of")} ${hex(n)} ${i}`),
    `${fn("length after")} ${hex(1_000_000)}`,
  ]);
  // Every call frees every cell it made.
  assert.deepEqual(got.map((ws) => ws.at(-1)), got.map(() => ";0"));
  assert.equal(unhex(got[0][0]), ev("shared", 4));
  assert.equal(BigInt(got[1][0]), BigInt(ev("length after", 10) as number));
  assert.equal(unhex(got[2][0]), ev("total of", 100));
  items.forEach(([n, i], j) => assert.equal(unhex(got[3 + j][0]), ev("item of", n, BigInt(i)), `item ${i} of ${n}`));
  wordsAt.forEach(([n, i], j) => assert.equal(Buffer.from(got[7 + j][0].slice(1), "hex").toString(), ev("word of", n, BigInt(i)), `word ${i} of ${n}`));
  assert.equal(got[10][0], "1000000");
});

// The two ends (C30d) in WebAssembly and C: first, rest and push front on
// the same buffer. A push front onto the newest array writes into the free
// slot before it, one onto an array somebody else pushed onto first copies,
// and the evaluator's answers come out on both targets.
test("first, rest and push front in WebAssembly and C: the evaluator's answers, shared arrays copied, a million pushes at the front (C30d)", async () => {
  const k = new Lang(LIBRARY.code);
  const def = (name: string, body: () => string) => { const d = k.def(name); k.define(d, body()); return d; };
  const lit = (x: number) => k.lit(x);
  const of = (...xs: number[]) => k.call(ARRAY_OPS.of, k.list(...xs.map(lit)));
  const front = (a: string, x: string) => k.call(ARRAY_OPS.pushFront, a, x);
  const firstOr = (a: string, none: string) => k.call(S.first, k.thunk(() => k.call(ARRAY_OPS.first, a)), k.thunk(() => none));
  const sum = def("sum", () => k.fn(["xs"], (xs) => k.fold(xs, [
    { variant: NIL, names: [], body: () => lit(0) },
    { variant: CONS, names: ["x", "t"], results: [null, "r"], body: ([x], [, r]) => k.call(B.add, x, r!) },
  ])));
  const total = (a: string) => k.call(sum, k.call(ARRAY_OPS.items, a));
  // [1, 2, 3] pushed at the front twice: [x, 1, 2, 3] and [9, 1, 2, 3];
  // the first after two rests; the empty array's rest has no first.
  def("ends", () => k.fn(["x"], (x) => k.let("base", front(of(2, 3), lit(1)), (b) => k.let("a", front(b, x), (a) =>
    k.call(B.add, k.call(B.add, k.call(B.mul, lit(1000), total(a)), k.call(B.mul, lit(10), total(front(b, lit(9))))),
      k.call(B.add, firstOr(k.call(ARRAY_OPS.rest, k.call(ARRAY_OPS.rest, a)), lit(-1)), firstOr(k.call(ARRAY_OPS.rest, k.call(ARRAY_OPS.empty)), lit(-100))))))));
  // n − 1, …, 1, 0 pushed at the front one by one.
  const count = def("count", () => k.fn(["n"], (n) => k.fold(k.call(S.range, n), [
    { variant: NIL, names: [], body: () => k.call(ARRAY_OPS.empty) },
    { variant: CONS, names: ["i", "t"], results: [null, "a"], body: ([i], [, a]) => front(a!, i) },
  ])));
  def("length after", () => k.fn(["n"], (n) => k.call(ARRAY_OPS.length, k.call(count, n))));
  // The first item after taking the rest `d` times.
  def("first after", () => k.fn(["n", "d"], (n, d) => k.let("a", k.fold(k.call(S.range, d), [
    { variant: NIL, names: [], body: () => k.call(count, n) },
    { variant: CONS, names: ["i", "t"], results: [null, "a"], body: (_, [, a]) => k.call(ARRAY_OPS.rest, a!) },
  ]), (a) => firstOr(a, lit(-1)))));
  // Counted items in C: Texts, pushed at the front of one array twice.
  def("word at", () => k.fn(["i"], (i) => k.let("w", front(front(k.call(ARRAY_OPS.empty), k.call(S.show, lit(2))), k.call(S.show, lit(1))), (w) =>
    k.call(S.first, k.thunk(() => k.call(S.concat, k.call(ARRAY_OPS.at, front(w, k.lit("!")), i), k.call(ARRAY_OPS.at, front(w, k.lit("?")), i))), k.thunk(() => k.lit("none"))))));
  const code = base(k.code), nm = baseNames(k.names), info = infer(code, nm, undefined, checkOptions);
  assert.deepEqual(info.errors.map((e) => e.message), []);
  const named = (n: string) => code.defs.find((d) => nm[d] === n)!;
  const roots = ["ends", "length after", "first after", "word at"];
  const lowered = lowerScalar(code, info, nm, roots.map(named), { data: true });
  assert.deepEqual(roots.flatMap((n) => lowered.refused.has(named(n)) ? [`${n}: ${lowered.refused.get(named(n))}`] : []), []);
  const r = makeRunner(code, info, { print: () => {}, names: nm });
  const ev = (n: string, ...xs: unknown[]) => [...r.call(r.value(named(n)), ...(xs as never[]))][0];
  assert.equal(ev("ends", 4), 1000 * 10 + 10 * 15 + 2 - 100);
  const drops: [number, number][] = [[10, 0], [10, 3], [10, 9], [10, 10], [10, 12], [0, 0]];
  // WebAssembly.
  const m = emitWasm(lowered);
  assert.ok(WebAssembly.validate(m.bytes));
  const w = (await instantiate(m)) as unknown as Record<string, (...xs: unknown[]) => unknown>;
  assert.equal(w.ends(4), ev("ends", 4));
  for (const [n, d] of drops) assert.equal(w["first after"](n, d), ev("first after", n, d), `first after ${d} of ${n}`);
  let t = performance.now();
  assert.equal(fromInt(w as never, w["length after"](1_000_000)), 1_000_000n);
  assert.ok(performance.now() - t < 5_000, `${performance.now() - t} ms`);
  // C, where every call frees every cell it made.
  if (!haveC) return;
  const out = emitC(lowered, { harness: true });
  assert.deepEqual([...out.refused.values()], []);
  const dir = mkdtempSync(join(tmpdir(), "ends-c-")), exe = join(dir, "ends");
  writeFileSync(`${exe}.c`, out.c);
  execFileSync(cc, [...CFLAGS, "-pthread", "-Wall", "-Werror", "-Wno-unknown-warning-option", "-Wno-unused-function", "-Wno-maybe-uninitialized", "-Wno-free-nonheap-object", "-Wno-unused-but-set-variable", "-Wno-unused-variable", "-Wno-unknown-pragmas", ...(process.env.NATIVE_CFLAGS ?? "").split(" ").filter(Boolean), "-o", exe, `${exe}.c`, "-lm"]);
  const fn = (n: string) => lowered.funcs.findIndex((f) => f.def === named(n) && !f.inner);
  const hex = (x: number) => new BigUint64Array(new Float64Array([x]).buffer)[0].toString(16);
  const unhex = (x: string) => new Float64Array(new BigUint64Array([BigInt(`0x${x}`)]).buffer)[0];
  const words: number[] = [0, 1, 2, 3];
  t = performance.now();
  const got = execFileSync(exe, { input: [
    `${fn("ends")} ${hex(4)}`, ...drops.map(([n, d]) => `${fn("first after")} ${hex(n)} ${hex(d)}`),
    ...words.map((i) => `${fn("word at")} ${i}`), `${fn("length after")} ${hex(1_000_000)}`,
  ].join("\n") + "\n", maxBuffer: 1 << 24 }).toString().trim().split("\n").map((l) => l.trim().split(/\s+/));
  assert.deepEqual(got.map((ws) => ws.at(-1)), got.map(() => ";0"));
  assert.equal(unhex(got[0][0]), ev("ends", 4));
  drops.forEach(([n, d], j) => assert.equal(unhex(got[1 + j][0]), ev("first after", n, d), `first after ${d} of ${n}`));
  words.forEach((i, j) => assert.equal(Buffer.from(got[1 + drops.length + j][0].slice(1), "hex").toString(), ev("word at", BigInt(i)), `word ${i}`));
  assert.equal(got.at(-1)![0], "1000000");
});

// equal and compare on arrays in WebAssembly and C (C66): the evaluator's
// rule, the length first and then the items in order, so a shorter array
// comes first. Float64 items and counted ones (Text).
test("equal and compare on arrays in WebAssembly and C: the evaluator's answers", async () => {
  const k = new Lang(LIBRARY.code);
  const def = (name: string, body: () => string) => { const d = k.def(name); k.define(d, body()); return d; };
  const lit = (x: number) => k.lit(x);
  const count = def("count", () => k.fn(["n"], (n) => k.fold(k.call(S.range, n), [
    { variant: NIL, names: [], body: () => k.call(ARRAY_OPS.empty) },
    { variant: CONS, names: ["i", "t"], results: [null, "a"], body: ([i], [, a]) => k.call(ARRAY_OPS.push, a!, i) },
  ])));
  const words = def("words", () => k.fn(["n"], (n) => k.fold(k.call(S.range, n), [
    { variant: NIL, names: [], body: () => k.call(ARRAY_OPS.empty) },
    { variant: CONS, names: ["i", "t"], results: [null, "a"], body: ([i], [, a]) => k.call(ARRAY_OPS.push, a!, k.call(S.show, i)) },
  ])));
  const sign = (o: string) => k.match(o, [
    { variant: ORDER_V.before, names: [], body: () => lit(-1) },
    { variant: ORDER_V.same, names: [], body: () => lit(0) },
    { variant: ORDER_V.after, names: [], body: () => lit(1) },
  ]);
  const same = (a: string, b: string) => k.if(k.call(S.equal, a, b), lit(1), lit(0));
  def("same counts", () => k.fn(["n", "m"], (n, m) => same(k.call(count, n), k.call(count, m))));
  def("order of counts", () => k.fn(["n", "m"], (n, m) => sign(k.call(COMPARE, k.call(count, n), k.call(count, m)))));
  def("order pushed", () => k.fn(["n", "x", "y"], (n, x, y) => k.let("c", k.call(count, n), (c) => sign(k.call(COMPARE, k.call(ARRAY_OPS.push, c, x), k.call(ARRAY_OPS.push, c, y))))));
  def("same pushed", () => k.fn(["n", "x", "y"], (n, x, y) => k.let("c", k.call(count, n), (c) => same(k.call(ARRAY_OPS.push, c, x), k.call(ARRAY_OPS.push, c, y)))));
  def("same words", () => k.fn(["n", "m"], (n, m) => same(k.call(words, n), k.call(words, m))));
  def("order of words", () => k.fn(["n", "m"], (n, m) => sign(k.call(COMPARE, k.call(ARRAY_OPS.push, k.call(words, n), k.lit("x")), k.call(ARRAY_OPS.push, k.call(words, m), k.lit("y"))))));
  const code = base(k.code), nm = baseNames(k.names), info = infer(code, nm, undefined, checkOptions);
  assert.deepEqual(info.errors.map((e) => e.message), []);
  const named = (n: string) => code.defs.find((d) => nm[d] === n)!;
  const two = ["same counts", "order of counts", "same words", "order of words"], three = ["order pushed", "same pushed"];
  const roots = [...two, ...three];
  const lowered = lowerScalar(code, info, nm, roots.map(named), { data: true });
  assert.deepEqual(roots.flatMap((n) => lowered.refused.has(named(n)) ? [`${n}: ${lowered.refused.get(named(n))}`] : []), []);
  const r = makeRunner(code, info, { print: () => {}, names: nm });
  const ev = (n: string, ...xs: unknown[]) => [...r.call(r.value(named(n)), ...(xs as never[]))][0];
  const pairs: [number, number][] = [[0, 0], [3, 3], [3, 4], [4, 3], [0, 2], [12, 12], [12, 11]];
  const triples: [number, number, number][] = [[3, 1, 2], [3, 2, 1], [3, 2, 2], [0, -1, 1], [5, 1e-12, 0]];
  const want = [...two.flatMap((d) => pairs.map((p) => ev(d, ...p))), ...three.flatMap((d) => triples.map((p) => ev(d, ...p)))];
  assert.ok(want.includes(-1) && want.includes(0) && want.includes(1));
  // WebAssembly.
  const m = emitWasm(lowered);
  assert.ok(WebAssembly.validate(m.bytes));
  const w = (await instantiate(m)) as unknown as Record<string, (...xs: number[]) => number>;
  assert.deepEqual([...two.flatMap((d) => pairs.map((p) => w[d](...p))), ...three.flatMap((d) => triples.map((p) => w[d](...p)))], want);
  // C, where every call frees every cell it made.
  if (!haveC) return;
  const out = emitC(lowered, { harness: true });
  assert.deepEqual([...out.refused.values()], []);
  const dir = mkdtempSync(join(tmpdir(), "compare-c-")), exe = join(dir, "compare");
  writeFileSync(`${exe}.c`, out.c);
  execFileSync(cc, [...CFLAGS, "-pthread", "-Wall", "-Werror", "-Wno-unknown-warning-option", "-Wno-unused-function", "-Wno-maybe-uninitialized", "-Wno-free-nonheap-object", "-Wno-unused-but-set-variable", "-Wno-unused-variable", "-Wno-unknown-pragmas", ...(process.env.NATIVE_CFLAGS ?? "").split(" ").filter(Boolean), "-o", exe, `${exe}.c`, "-lm"]);
  const fn = (n: string) => lowered.funcs.findIndex((f) => f.def === named(n) && !f.inner);
  const hex = (x: number) => new BigUint64Array(new Float64Array([x]).buffer)[0].toString(16);
  const got = execFileSync(exe, { input: [
    ...two.flatMap((d) => pairs.map((p) => `${fn(d)} ${p.map(hex).join(" ")}`)), ...three.flatMap((d) => triples.map((p) => `${fn(d)} ${p.map(hex).join(" ")}`)),
  ].join("\n") + "\n" }).toString().trim().split("\n").map((l) => l.trim().split(/\s+/));
  assert.deepEqual(got.map((ws) => ws.at(-1)), got.map(() => ";0"));
  // The answers are Ints, written in decimal.
  assert.deepEqual(got.map((ws) => Number(ws[0])), want.map(Number));
});
