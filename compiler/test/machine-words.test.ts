// Words as machine words (C150e, C150f): a record's Int field proved to
// fit 32 bits is stored as an i32 read unsigned, and a word's masked + − ×,
// negate and shifts are the machine's wrapping ones, on WebAssembly and C.
// Each answer is the evaluator's; FNV-1a and xorshift32 are the published
// values (as ters/test/words.test.ts checks them on compiled JS).

import { test } from "node:test";
import assert from "node:assert/strict";
import { Lang } from "../../ters/src/lang/dsl.ts";
import { infer } from "../../ters/src/lang/infer.ts";
import { makeRunner } from "../../ters/src/lang/run.ts";
import { base, baseNames, checkOptions } from "../../ters/src/lang/load.ts";
import { LIBRARY } from "../../ters/src/lang/library.ts";
import { ARITH, BITS_V, INT_OPS, SHOW_ANY, WORD_V } from "../../ters/src/lang/std.ts";
import type { Id } from "../../ters/src/model.ts";
import { kids, lowerScalar, type SExpr } from "../src/scalar.ts";
import { emitWasm, fromText, instantiate } from "../src/wasm.ts";
import { build, skip } from "./c-harness.ts";

const lib = (name: string) => LIBRARY.code.defs.find((d) => LIBRARY.names[d] === name)!;
const op = (name: string) => `${BITS_V}.${name}`;
// The fold takes the last byte first, so this is FNV-1a of the bytes reversed.
const fnv = (s: string, bits: bigint, offset: bigint, prime: bigint) => [...s].reverse().reduce((h, c) => ((h ^ BigInt(c.charCodeAt(0))) * prime) & ((1n << bits) - 1n), offset);
const xorshift = (x: number) => { x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; return x >>> 0; };

function program() {
  const k = new Lang(LIBRARY.code);
  const defs: [string, Id][] = [];
  const def = (name: string, body: () => Id) => { const d = k.def(name); k.define(d, body()); defs.push([name, d]); return d; };
  const helper = (name: string, body: () => Id) => { const d = k.def(name); k.define(d, body()); return d; };
  const w = (n: 8 | 32 | 64, x: number | bigint) => k.call(lib(`as word${n}`), k.int(x));
  const show = (n: 8 | 32 | 64, x: Id) => k.call(lib(`show word${n}`), x);
  const hash = helper("fnv1a", () => k.fn(["offset", "prime", "word", "bytes"], (offset, prime, word, bytes) => k.fold(bytes, [
    { variant: "std.list.nil", names: [], body: () => offset },
    { variant: "std.list.cons", names: ["byte", "rest"], results: [null, "h"], body: ([byte], [, h]) => k.call(ARITH.mul, k.call(op("bits xor"), h!, k.call(word, byte)), prime) },
  ])));
  const bytes = () => k.list(...[..."foobar"].map((c) => k.int(c.charCodeAt(0))));
  def("h32", () => show(32, k.call(hash, w(32, 2166136261), w(32, 16777619), k.x(lib("as word32")), bytes())));
  def("h64", () => show(64, k.call(hash, w(64, 14695981039346656037n), w(64, 1099511628211n), k.x(lib("as word64")), bytes())));
  const step = helper("xorshift32", () => k.fn(["x"], (x) =>
    k.let("a", k.call(op("bits xor"), x, k.call(op("shifted up"), x, k.int(13))), (a) =>
      k.let("b", k.call(op("bits xor"), a, k.call(op("shifted down"), a, k.int(17))), (b) =>
        k.call(op("bits xor"), b, k.call(op("shifted up"), b, k.int(5)))))));
  def("xs", () => show(32, k.call(step, k.call(step, k.call(step, w(32, 1))))));
  def("sub", () => show(32, k.call(ARITH.sub, w(32, 3), w(32, 5))));
  def("neg", () => show(32, k.call(ARITH.neg, w(32, 1))));
  def("square", () => show(32, k.call(ARITH.mul, w(32, 4294967295), w(32, 4294967295))));
  def("wrapped", () => show(32, w(32, -1)));
  // Past an i64, and negative past one: a $huge's lowest limb.
  def("huge", () => show(32, w(32, 2n ** 70n + 5n)));
  def("hugeNeg", () => show(32, k.call(lib("as word32"), k.call(INT_OPS.neg, k.int(2n ** 70n + 5n)))));
  def("and", () => show(32, k.call(op("bits and"), w(32, 4294967295), w(32, 4042322160))));
  def("less", () => k.call(SHOW_ANY, k.call(lib("word32 less than"), w(32, 1), w(32, 4294967295))));
  def("shifts", () => show(32, k.call(op("bits or"), k.call(op("shifted down"), w(32, 4294967295), k.int(40)), k.call(op("shifted up"), w(32, 1), k.int(31)))));
  def("byte", () => show(8, k.call(ARITH.add, w(8, 255), w(8, 3))));
  def("sub8", () => show(8, k.call(ARITH.sub, w(8, 3), w(8, 5))));
  def("mul8", () => show(8, k.call(ARITH.mul, w(8, 200), w(8, 3))));
  def("neg8", () => show(8, k.call(ARITH.neg, w(8, 1))));
  def("shift8", () => show(8, k.call(op("bits or"), k.call(op("shifted up"), w(8, 3), k.int(7)), k.call(op("shifted up"), w(8, 1), k.int(40)))));
  def("add16", () => k.call(lib("show word16"), k.call(ARITH.add, k.call(lib("as word16"), k.int(65535)), k.call(lib("as word16"), k.int(2)))));
  // 64 bits: past 2⁶³ (an Int of two limbs when shown), wrapping, and
  // compared unsigned across 2⁶³.
  def("sub64", () => show(64, k.call(ARITH.sub, w(64, 3), w(64, 5))));
  def("neg64", () => show(64, k.call(ARITH.neg, w(64, 1))));
  def("square64", () => show(64, k.call(ARITH.mul, w(64, 2n ** 64n - 1n), w(64, 2n ** 64n - 1n))));
  def("top64", () => show(64, k.call(ARITH.add, w(64, 2n ** 63n), w(64, 2n ** 62n))));
  def("huge64", () => show(64, w(64, 2n ** 70n + 2n ** 40n + 5n)));
  def("hugeNeg64", () => show(64, k.call(lib("as word64"), k.call(INT_OPS.neg, k.int(2n ** 70n + 5n)))));
  def("shifts64", () => show(64, k.call(op("bits xor"), k.call(op("shifted down"), w(64, 2n ** 64n - 1n), k.int(60)), k.call(op("shifted up"), w(64, 3), k.int(62)))));
  def("less64", () => k.call(SHOW_ANY, k.call(lib("word64 less than"), w(64, 2n ** 62n), w(64, 2n ** 63n + 1n))));
  const code = base(k.code), names = baseNames(k.names), info = infer(code, names, undefined, checkOptions);
  return { code, names, info, defs };
}

const walk = (e: SExpr, f: (x: SExpr) => void) => { f(e); kids(e).forEach((x) => walk(x, f)); };

test("a word's field is a machine word, and its ops wrap on WebAssembly and C as the evaluator's (C150e to C150h)", { skip }, async () => {
  const p = program();
  assert.deepEqual(p.info.errors.map((e) => e.message), []);
  const lowered = lowerScalar(p.code, p.info, p.names, p.defs.map(([, d]) => d), { data: true });
  assert.deepEqual([...lowered.refused.values()], []);
  // Word8 and Word32 are i32s, Word64 an i64 (C150h), with no record
  // around them (C150g).
  const record = (n: 8 | 32 | 64) => lowered.records.find((t) => t.variant === WORD_V[n]);
  assert.deepEqual([record(8), record(32), record(64)], [undefined, undefined, undefined]);
  const typeOf = (name: string) => { const f = lowered.funcs.find((g) => g.name === name)!; return [...f.params, f.result]; };
  assert.deepEqual([typeOf("multiply word32"), typeOf("multiply word64")], [["i32", "i32", "i32"], ["i64", "i64", "i64"]]);
  // multiply word32 makes no Int: one wrapping multiply.
  const mul = lowered.funcs.find((f) => f.name === "multiply word32")!, ops: string[] = [];
  walk(mul.body, (e) => { if (e.k === "op" || e.k === "rt") ops.push(e.k === "op" ? e.op : e.fn); });
  assert.deepEqual(ops, ["umul"]);
  // And every other op of Word32 the program uses is the machine's.
  const all = new Set<string>();
  for (const f of lowered.funcs) if (/word32/.test(f.name)) walk(f.body, (e) => { if (e.k === "op") all.add(e.op); if (e.k === "rt") all.add(e.fn); });
  for (const o of ["umul", "usub", "uneg", "uand", "uor", "uxor", "uless", "word32.shiftDown"]) assert.ok(all.has(o), o);
  // Word8's + is the machine's, then its mask.
  const add8: string[] = [];
  walk(lowered.funcs.find((f) => f.name === "add word8")!.body, (e) => { if (e.k === "op") add8.push(e.op); if (e.k === "rt") add8.push(e.fn); });
  assert.deepEqual(add8, ["uand", "uadd", "word32.narrow"]);
  const all64 = new Set<string>();
  for (const f of lowered.funcs) if (/word64/.test(f.name)) walk(f.body, (e) => { if (e.k === "op") all64.add(e.op); if (e.k === "rt") all64.add(e.fn); });
  for (const o of ["u64mul", "u64add", "u64sub", "u64neg", "u64xor", "u64less", "word64.shiftDown"]) assert.ok(all64.has(o), o);
  for (const o of ["int.mul", "int.sub", "int.bitXor", "int.less"]) assert.ok(!all.has(o), o);
  const r = makeRunner(p.code, p.info, { print: () => {} });
  const wasm = (await instantiate(emitWasm(lowered))) as unknown as Record<string, () => unknown>;
  const at = (d: Id) => lowered.funcs.findIndex((f) => f.def === d);
  const c = build(lowered)(p.defs.map(([, d]) => [at(d), []]));
  p.defs.forEach(([name, d], i) => {
    const want = r.value(d);
    assert.equal(fromText(wasm as never, wasm[lowered.funcs[at(d)].name]()), want, `WebAssembly ${name}`);
    assert.equal(c[i].value, want, `C ${name}`);
  });
  const answer = (name: string) => r.value(p.defs.find(([n]) => n === name)![1]);
  assert.equal(answer("h32"), String(fnv("foobar", 32n, 2166136261n, 16777619n)));
  assert.equal(answer("h64"), String(fnv("foobar", 64n, 14695981039346656037n, 1099511628211n)));
  assert.equal(answer("xs"), String(xorshift(xorshift(xorshift(1)))));
});
