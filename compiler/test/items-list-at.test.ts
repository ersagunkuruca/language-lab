// C321: `byte at` and `byte count` on Bytes in compiled JavaScript read the
// array under the bytes' list (the runtime's ItemsList) in place, as an
// array's item is read: walked a cell at a time from the start, reading
// every byte of 200,000 took minutes (mnist-page's digits, 3 s a batch).
import { test } from "node:test";
import assert from "node:assert/strict";
import { Lang } from "../../ters/src/lang/dsl.ts";
import { infer } from "../../ters/src/lang/infer.ts";
import { base, baseNames, checkOptions } from "../../ters/src/lang/load.ts";
import { LIBRARY } from "../../ters/src/lang/library.ts";
import { INT_OPS } from "../../ters/src/lang/std.ts";
import { compiledDefs } from "../src/core-js.ts";

test("byte at and byte count on 200,000 bytes read each byte at once", () => {
  const k = new Lang(LIBRARY.code);
  const lib = (name: string) => LIBRARY.code.defs.find((x) => LIBRARY.names[x] === name)!;
  const def = (name: string, body: string) => { const d = k.def(name); k.define(d, body); return d; };
  // "ab" 100,000 times: 97, 98, 97, 98, …
  const data = def("data", k.call(lib("utf8 of"), k.call(lib("repeated"), k.lit("ab"), k.int(100000))));
  def("count", k.fn([], () => k.call(lib("byte count"), k.x(data))));
  def("total", k.fn([], () => k.call(lib("sum"), k.call(lib("map"), k.call(INT_OPS.range, k.call(lib("byte count"), k.x(data))), k.fn(["i"], (i) => k.call(lib("byte at"), k.x(data), i, k.int(0)))))));
  def("outside", k.fn([], () => k.call(lib("byte at"), k.x(data), k.int(200000), k.int(-1))));
  def("below", k.fn([], () => k.call(lib("byte at"), k.x(data), k.int(-1), k.int(-2))));
  const code = base(k.code), names = baseNames(k.names), info = infer(code, names, undefined, checkOptions);
  assert.deepEqual(info.errors.map((e) => e.message), []);
  const defs = compiledDefs(code, info, names, ["count", "total", "outside", "below"]) as Record<string, () => unknown>;
  const began = performance.now();
  assert.equal(Number(defs.count()), 200000);
  assert.equal(Number(defs.total()), 100000 * (97 + 98));
  assert.equal(Number(defs.outside()), -1);
  assert.equal(Number(defs.below()), -2);
  assert.ok(performance.now() - began < 2000, `${Math.round(performance.now() - began)} ms`);
});
