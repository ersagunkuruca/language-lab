// A baked answer's words (G16a, docs/design/targets/BAKING.md): the
// prelude helpers a bake's decoder reads its leaves with, from bytes
// written here by hand as a DataView writes them. Each word reads back as
// the number written, exactly, evaluated and compiled the same.

import { test } from "node:test";
import assert from "node:assert/strict";
import { Lang } from "../src/lang/dsl.ts";
import { infer } from "../src/lang/infer.ts";
import { makeRunner, type Value } from "../src/lang/run.ts";
import { base, baseNames, checkOptions } from "../src/lang/load.ts";
import { LIBRARY } from "../src/lang/library.ts";
import { OUTCOME_V, SHOW_ANY } from "../src/lang/std.ts";
import type { Id } from "../src/model.ts";
import { compiledDefs } from "../../compiler/src/core-js.ts";

const lib = (name: string) => LIBRARY.code.defs.find((d) => LIBRARY.names[d] === name)!;

// The bytes of these words, little-endian, one after another.
const bytesOf = (words: number[], kind: "f32" | "i32" | "f64"): number[] => {
  const n = kind === "f64" ? 8 : 4, v = new DataView(new ArrayBuffer(n * words.length));
  words.forEach((w, i) => (kind === "f32" ? v.setFloat32(4 * i, w, true) : kind === "f64" ? v.setFloat64(8 * i, w, true) : v.setInt32(4 * i, w, true)));
  return [...new Uint8Array(v.buffer)];
};

test("baked float32 at, float64 at and int32 at read each word back exactly, evaluated and compiled the same (G16a, G16b1, G16b3b)", () => {
  const floats = [0, 1.5, -2.25, Math.fround(0.1), Math.fround(-1e-3), 3.4028234663852886e38, 2 ** -149, 2 ** -126, Math.fround(123456.789)];
  const ints = [0, -1, 1, 2 ** 31 - 1, -(2 ** 31), 123456789];
  const doubles = [0, 0.1, -2.5, Math.PI, 1e300, -1.7976931348623157e308, 5e-324, 2.2250738585072014e-308, 123456789.123456789];
  const k = new Lang(LIBRARY.code);
  const def = (name: string, body: () => Id) => { const d = k.def(name); k.define(d, body()); return d; };
  // Each a byte, so bytes of never stops; attempted, as it may.
  const exported = (name: string) => LIBRARY.modules.flatMap((m) => m.exports).find((d) => LIBRARY.names[d] === name)!;
  const bytes = (xs: number[]) => k.match(k.call(exported("attempt"), k.thunk(() => k.call(exported("bytes of"), k.list(...xs.map((x) => k.int(x)))))), [
    { variant: OUTCOME_V.done, names: ["bytes"], body: ([b]) => b },
    { variant: OUTCOME_V.refused, names: ["why"], body: () => k.call(exported("utf8 of"), k.lit("")) },
  ]);
  const NAMES: string[] = [];
  floats.forEach((x, i) => { NAMES.push(`float ${i}`); def(`float ${i}`, () => k.call(SHOW_ANY, k.equal(k.call(lib("baked float32 at"), bytes(bytesOf(floats, "f32")), k.int(4 * i)), k.lit(x)))); });
  ints.forEach((x, i) => { NAMES.push(`int ${i}`); def(`int ${i}`, () => k.call(SHOW_ANY, k.equal(k.call(lib("baked int32 at"), bytes(bytesOf(ints, "i32")), k.int(4 * i)), k.int(x)))); });
  doubles.forEach((x, i) => { NAMES.push(`double ${i}`); def(`double ${i}`, () => k.call(SHOW_ANY, k.equal(k.call(lib("baked float64 at"), bytes(bytesOf(doubles, "f64")), k.int(8 * i)), k.lit(x)))); });
  // As written, a bake's bytes are none: its decoder gives the body.
  NAMES.push("no bytes");
  def("no bytes", () => k.call(SHOW_ANY, k.call(lib("baked bytes"), k.lit("some key"))));
  // Past the bytes, 0.
  NAMES.push("past the end");
  def("past the end", () => k.call(SHOW_ANY, k.equal(k.call(lib("baked float32 at"), bytes(bytesOf([1.5], "f32")), k.int(4)), k.lit(0))));
  // Partly past the bytes: those past them read as 0, so 1.5's last two
  // bytes (0xC0, 0x3F) then two 0s. Compiled JavaScript reads the word
  // with a DataView (G16b3b), and agrees.
  NAMES.push("straddling");
  def("straddling", () => k.call(SHOW_ANY, k.call(lib("baked int32 at"), bytes(bytesOf([1.5], "f32")), k.int(2))));
  const code = base(k.code), names = baseNames(k.names);
  const info = infer(code, names, undefined, checkOptions);
  assert.deepEqual(info.errors.map((e) => e.message), []);
  const r = makeRunner(code, info, { print: () => {}, names });
  const evaluated = NAMES.map((n) => r.value(code.defs.find((d) => names[d] === n)!));
  assert.deepEqual(evaluated, NAMES.map((n) => (n === "no bytes" ? "none" : n === "straddling" ? "16320" : "true")));
  const defs = compiledDefs(code, info, names, NAMES) as unknown as Record<string, unknown>;
  assert.deepEqual(NAMES.map((n) => (typeof defs[n] === "function" ? (defs[n] as () => Value)() : defs[n])), evaluated);
});
