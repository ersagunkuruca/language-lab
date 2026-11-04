// Known bits of an Int on the core IR (C150d): each std word's `bits`
// field is found under 2ⁿ from the word's construction sites, in a program
// that hashes with FNV-1a and steps xorshift32; a field also given an
// unbounded Int, and a plain Int record, have no bound.

import { test } from "node:test";
import assert from "node:assert/strict";
import { Lang } from "../../ters/src/lang/dsl.ts";
import { infer } from "../../ters/src/lang/infer.ts";
import { base, baseNames, checkOptions } from "../../ters/src/lang/load.ts";
import { LIBRARY } from "../../ters/src/lang/library.ts";
import { ARITH, BITS_V, INT_OPS, WORD_V } from "../../ters/src/lang/std.ts";
import { INT } from "../../ters/src/lang/types.ts";
import type { Id } from "../../ters/src/model.ts";
import { lowerScalar } from "../src/scalar.ts";
import { fieldKey, knownBits } from "../src/known-bits.ts";

const lib = (name: string) => LIBRARY.code.defs.find((d) => LIBRARY.names[d] === name)!;
const op = (name: string) => `${BITS_V}.${name}`;

test("a word's bits are known to fit its width, from where words are made", () => {
  const k = new Lang(LIBRARY.code);
  const def = (name: string, body: () => Id) => { const d = k.def(name); k.define(d, body()); return d; };
  const w = (n: 8 | 32 | 64, x: number | bigint) => k.call(lib(`as word${n}`), k.int(x));
  const hash = def("fnv1a", () => k.fn(["offset", "prime", "word", "bytes"], (offset, prime, word, bytes) => k.fold(bytes, [
    { variant: "std.list.nil", names: [], body: () => offset },
    { variant: "std.list.cons", names: ["byte", "rest"], results: [null, "h"], body: ([byte], [, h]) => k.call(ARITH.mul, k.call(op("bits xor"), h!, k.call(word, byte)), prime) },
  ])));
  const bytes = () => k.list(...[..."foobar"].map((c) => k.int(c.charCodeAt(0))));
  const h32 = def("h32", () => k.call(lib("show word32"), k.call(hash, w(32, 2166136261), w(32, 16777619), k.x(lib("as word32")), bytes())));
  const h64 = def("h64", () => k.call(lib("show word64"), k.call(hash, w(64, 14695981039346656037n), w(64, 1099511628211n), k.x(lib("as word64")), bytes())));
  const step = def("xorshift32", () => k.fn(["x"], (x) =>
    k.let("a", k.call(op("bits xor"), x, k.call(op("shifted up"), x, k.int(13))), (a) =>
      k.let("b", k.call(op("bits xor"), a, k.call(op("shifted down"), a, k.int(17))), (b) =>
        k.call(op("bits xor"), b, k.call(op("shifted up"), b, k.int(5)))))));
  const xs = def("xs", () => k.call(lib("show word32"), k.call(step, k.call(step, w(32, 1)))));
  const small = def("small", () => k.call(lib("show word8"), k.call(ARITH.add, w(8, 255), w(8, 1))));
  const code = base(k.code), names = baseNames(k.names), info = infer(code, names, undefined, checkOptions);
  assert.deepEqual(info.errors.map((e) => e.message), []);
  const ir = lowerScalar(code, info, names, [h32, h64, xs, small], { data: true });
  const kb = knownBits(ir);
  const bitsOf = (n: 8 | 32 | 64) => {
    const r = ir.records.find((t) => t.variant === WORD_V[n]);
    const d = ir.data.find((t) => t.cases.some((c) => c.variant === WORD_V[n]));
    assert.ok(r || d, `word${n} is lowered`);
    return kb.fields.get(r ? fieldKey(r, 0, 0) : fieldKey(d!, d!.cases.findIndex((c) => c.variant === WORD_V[n]), 0));
  };
  assert.equal(bitsOf(32), 2n ** 32n - 1n);
  assert.equal(bitsOf(64), 2n ** 64n - 1n);
  assert.equal(bitsOf(8), 2n ** 8n - 1n);
});

test("a field given an Int with no bound has none, and nor does plain arithmetic", () => {
  const k = new Lang();
  const mk = k.type("Pair", [], [["pair", [["masked", () => k.tref(INT)], ["sum", () => k.tref(INT)]]]]).v.pair;
  const make = k.def("make");
  k.define(make, k.fn(["a", "b"], (a, b) => k.call(mk, k.call(INT_OPS.bitAnd, a, k.int(255)), k.call(INT_OPS.add, a, b))));
  const read = k.def("read");
  k.define(read, k.fn(["a", "b"], (a, b) => k.match(k.call(make, a, b), [{ variant: mk, names: ["m", "s"], body: ([m, s]) => k.call(INT_OPS.add, m, s) }])));
  const code = base(k.code), names = { ...baseNames(), ...k.names }, info = infer(code, names);
  assert.deepEqual(info.errors.map((e) => e.message), []);
  const ir = lowerScalar(code, info, names, [read], { data: true });
  const kb = knownBits(ir);
  const r = ir.records.find((t) => t.variant === mk);
  const d = ir.data.find((t) => t.cases.some((c) => c.variant === mk));
  const key = (i: number) => (r ? fieldKey(r, 0, i) : fieldKey(d!, 0, i));
  assert.equal(kb.fields.get(key(0)), 255n);
  assert.equal(kb.fields.get(key(1)), null);
});
