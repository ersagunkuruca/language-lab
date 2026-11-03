// Wrapping integers (BACKLOG L193): Word8, Word16, Word32 and Word64 are
// arithmetic mod 2ⁿ through the one + − · < and Bits' and, or, xor and
// shifts. FNV-1a is written once for any width and gives the published
// 32- and 64-bit hashes; xorshift32 gives Marsaglia's sequence. Evaluated
// and compiled agree.

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
import { ARITH, BITS_V, INT_OPS, SHOW_ANY, WORD_V } from "../src/lang/std.ts";
import type { Id } from "../src/model.ts";
import { compile } from "../../compiler/src/compile.ts";

const runtime = pathToFileURL(join(import.meta.dirname, "../../compiler/src/runtime.js")).href;
const lib = (name: string) => LIBRARY.code.defs.find((d) => LIBRARY.names[d] === name)!;
const op = (name: string) => `${BITS_V}.${name}`;

// FNV-1a by hand (Fowler, Noll and Vo): xor in each byte, then multiply.
const fnv = (bytes: number[], bits: bigint, offset: bigint, prime: bigint) => bytes.reduce((h, b) => ((h ^ BigInt(b)) * prime) & ((1n << bits) - 1n), offset);
// xorshift32 by hand (Marsaglia, "Xorshift RNGs", 2003): 13, 17, 5.
const xorshift = (x: number) => { x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; return x >>> 0; };

test("words wrap, compare unsigned, and hash and generate as C's unsigned types do, evaluated and compiled", async () => {
  const k = new Lang(LIBRARY.code);
  const def = (name: string, body: () => Id) => { const d = k.def(name); k.define(d, body()); return d; };
  const w = (n: 8 | 16 | 32 | 64, x: number | bigint) => k.call(lib(`as word${n}`), k.int(x));
  const names: string[] = [];
  // A word shows through its Shown in the evaluator; compiled show any
  // doesn't ask Shown yet (C148), so the words are shown by their own.
  const show = (name: string, v: () => Id, n?: 8 | 16 | 32 | 64) => { names.push(name); def(name, () => k.call(n ? lib(`show word${n}`) : SHOW_ANY, v())); };
  show("300 at Word8", () => w(8, 300), 8);
  show("−1 at Word8", () => w(8, -1), 8);
  show("255 + 1", () => k.call(ARITH.add, w(8, 255), w(8, 1)), 8);
  show("a 16-bit sample wraps", () => k.call(ARITH.add, w(16, 32767), w(16, 32769)), 16);
  show("0 − 1 at Word32", () => k.call(ARITH.sub, w(32, 0), w(32, 1)), 32);
  show("−x at Word64", () => k.call(ARITH.neg, w(64, 1)), 64);
  show("product at Word32", () => k.call(ARITH.mul, w(32, 0x10001), w(32, 0x10001)), 32);
  show("unsigned less", () => k.call(ARITH.less, w(8, 1), w(8, -1)));
  show("shifted up drops the top", () => k.call(op("shifted up"), w(8, 0x81), k.int(1)), 8);
  show("Int xor", () => k.call(op("bits xor"), k.int(5), k.int(3)));
  show("Int and of a negative", () => k.call(op("bits and"), k.int(-1), k.int(0xff)));
  show("bits field", () => k.match(w(32, -2), [{ variant: WORD_V[32], names: ["bits"], body: ([b]) => k.call(INT_OPS.add, b, k.int(2)) }]));
  // One FNV-1a for any width: the offset, the prime and how a byte
  // becomes a word are its inputs.
  const hash = def("fnv1a", () => k.fn(["offset", "prime", "word", "bytes"], (offset, prime, word, bytes) => k.fold(bytes, [
    { variant: "std.list.nil", names: [], body: () => offset },
    { variant: "std.list.cons", names: ["byte", "rest"], results: [null, "h"], body: ([byte], [, h]) => k.call(ARITH.mul, k.call(op("bits xor"), h!, k.call(word, byte)), prime) },
  ])));
  // The fold goes from the end, so the bytes are given reversed.
  const text = [...new TextEncoder().encode("foobar")];
  const bytes = () => k.list(...[...text].reverse().map((b) => k.int(b)));
  show("fnv1a 32 of foobar", () => k.call(hash, w(32, 2166136261), w(32, 16777619), k.x(lib("as word32")), bytes()), 32);
  show("fnv1a 64 of foobar", () => k.call(hash, w(64, 14695981039346656037n), w(64, 1099511628211n), k.x(lib("as word64")), bytes()), 64);
  const step = def("xorshift32", () => k.fn(["x"], (x) =>
    k.let("a", k.call(op("bits xor"), x, k.call(op("shifted up"), x, k.int(13))), (a) =>
      k.let("b", k.call(op("bits xor"), a, k.call(op("shifted down"), a, k.int(17))), (b) =>
        k.call(op("bits xor"), b, k.call(op("shifted up"), b, k.int(5)))))));
  show("xorshift32 three steps from 1", () => k.call(step, k.call(step, k.call(step, w(32, 1)))), 32);
  def("shown by show any", () => k.call(SHOW_ANY, k.list(w(8, 300), w(8, 301))));
  const code = base(k.code), nm = baseNames(k.names), info = infer(code, nm, undefined, checkOptions);
  assert.deepEqual(info.errors.map((e) => e.message), []);
  const r = makeRunner(code, info, { print: () => {}, names: nm });
  const at = (n: string) => code.defs.find((d) => nm[d] === n)!;
  const got = Object.fromEntries(names.map((n) => [n, r.value(at(n))]));
  assert.deepEqual(got, {
    "300 at Word8": "44", "−1 at Word8": "255", "255 + 1": "0", "a 16-bit sample wraps": "0", "0 − 1 at Word32": "4294967295", "−x at Word64": String(2n ** 64n - 1n),
    "product at Word32": String((0x10001n * 0x10001n) & 0xffffffffn), "unsigned less": "true", "shifted up drops the top": "2",
    "Int xor": "6", "Int and of a negative": "255", "bits field": String(2 ** 32),
    "fnv1a 32 of foobar": String(fnv(text, 32n, 2166136261n, 16777619n)), "fnv1a 64 of foobar": String(fnv(text, 64n, 14695981039346656037n, 1099511628211n)),
    "xorshift32 three steps from 1": String(xorshift(xorshift(xorshift(1)))),
  });
  assert.equal(r.value(at("shown by show any")), "[44, 45]");
  // The published test vectors (FNV's own page): foobar is 0xbf9cf968 and
  // 0x85944171f73967e8.
  assert.equal(got["fnv1a 32 of foobar"], String(0xbf9cf968));
  assert.equal(got["fnv1a 64 of foobar"], String(0x85944171f73967e8n));
  const path = join(mkdtempSync(join(tmpdir(), "words-")), "words.js");
  writeFileSync(path, compile(code, info, nm, { runtime, exports: names }));
  const defs = (await import(pathToFileURL(path).href)).defs as Record<string, unknown>;
  assert.deepEqual(Object.fromEntries(names.map((n) => [n, typeof defs[n] === "function" ? (defs[n] as () => Value)() : defs[n]])), got);
});

test("a word made by its constructor is refused: as word8 keeps the rule", () => {
  const k = new Lang(LIBRARY.code);
  const d = k.def("too big");
  k.define(d, k.call(WORD_V[8], k.int(300)));
  const code = base(k.code), nm = baseNames(k.names), info = infer(code, nm, undefined, checkOptions);
  assert.ok(info.errors.some((e) => /as word8/.test(e.message)), info.errors.map((e) => e.message).join("; "));
});
