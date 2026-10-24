// Lists written into arrays (GAPS.md P4, destination passing): a block
// function that builds its list gives the same items as an array
// ($arrayOf, what the audio runtimes call) as it does as cells, and a
// list as long as you like takes no stack.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { Lang } from "../../projectional/src/lang/dsl.ts";
import { base, baseNames } from "../../projectional/src/lang/load.ts";
import { infer } from "../../projectional/src/lang/infer.ts";
import { CONS, NIL, PAIR_V } from "../../projectional/src/lang/std.ts";
import { B } from "../../projectional/src/prelude.ts";
import { compile } from "../src/compile.ts";
import { $arrayOf, $fromList, $toList } from "../src/runtime.js";

const runtime = pathToFileURL(join(import.meta.dirname, "../src/runtime.js")).href;
const dir = mkdtempSync(join(tmpdir(), "into-"));

test("a block function's list as an array: the same items as its cells, and no stack for a long one", async () => {
  const k = new Lang();
  // A running sum, as the compressor follows its level: each item plus
  // the sum so far, and the sum after the last.
  const running = k.def("running");
  k.define(running, k.fn(["sum", "xs"], (sum, xs) => k.match(xs, [
    { variant: NIL, names: [], body: () => k.call(PAIR_V, k.list(), sum) },
    { variant: CONS, names: ["x", "rest"], body: ([x, rest]) => k.let("now", k.call(B.add, sum, x), (now) =>
      k.match(k.call(running, now, rest), [
        { variant: PAIR_V, names: ["more", "last"], body: ([more, last]) => k.call(PAIR_V, k.call(CONS, k.call(B.mul, x, now), more), last) },
      ])) },
  ])));
  const sums = k.def("sums");
  k.define(sums, k.fn(["xs"], (xs) => k.match(k.call(running, k.lit(0), xs), [
    { variant: PAIR_V, names: ["out", "last"], body: ([out]) => out },
  ])));
  // Each item twice: two cells a step.
  const twice = k.def("twice");
  k.define(twice, k.fn(["xs"], (xs) => k.match(xs, [
    { variant: NIL, names: [], body: () => k.list() },
    { variant: CONS, names: ["x", "rest"], body: ([x, rest]) => k.call(CONS, x, k.call(CONS, k.call(B.neg, x), k.call(twice, rest))) },
  ])));
  k.define(k.def("summing"), k.thunk(() => k.fn(["block"], (block) => k.call(sums, block))));
  k.define(k.def("doubling"), k.thunk(() => k.fn(["block"], (block) => k.call(twice, block))));
  const code = base(k.code), names = { ...baseNames(), ...k.names };
  const info = infer(code, names);
  assert.deepEqual(info.errors, []);
  writeFileSync(join(dir, "into.js"), compile(code, info, names, { runtime, exports: ["summing", "doubling"] }));
  const defs = (await import(pathToFileURL(join(dir, "into.js")).href)).defs as Record<string, () => (l: unknown) => unknown>;
  const xs = [1, 2, 3, 0.5];
  assert.deepEqual($arrayOf(defs.summing(), $toList(xs)), [1, 6, 18, 3.25]);
  assert.deepEqual($arrayOf(defs.doubling(), $toList(xs)), [1, -1, 2, -2, 3, -3, 0.5, -0.5]);
  const long = Array.from({ length: 200_000 }, (_, i) => i % 7);
  for (const name of ["summing", "doubling"]) {
    const f = defs[name]();
    assert.deepEqual($arrayOf(f, $toList(long)), $fromList(f($toList(long))), name);
  }
});
