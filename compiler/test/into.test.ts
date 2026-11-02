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
import { Lang } from "../../ters/src/lang/dsl.ts";
import { base, baseNames } from "../../ters/src/lang/load.ts";
import { infer } from "../../ters/src/lang/infer.ts";
import { CONS, NIL, PAIR_V } from "../../ters/src/lang/std.ts";
import { B } from "../../ters/src/prelude.ts";
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

// I149: a recursive definition handing on `map(keep(numbered(rest), …), …)`
// asked, while working out its copy, whether that argument could be a view
// on an array, and wrote the callee's code to find out, before the writer
// was set up ("Cannot access 'boolFns' before initialization"). Asking now
// writes nothing.
test("a definition handing on keep of numbered compiles, and answers as evaluated (I149)", async () => {
  const { LIBRARY } = await import("../../ters/src/lang/library.ts");
  const { checkOptions } = await import("../../ters/src/lang/load.ts");
  const { INT_OPS, S } = await import("../../ters/src/lang/std.ts");
  const { makeRunner } = await import("../../ters/src/lang/run.ts");
  const L = (name: string) => LIBRARY.code.defs.find((d) => LIBRARY.names[d] === name)!;
  const k = new Lang(LIBRARY.code);
  // The first item, plus f of the rest without its i-th item, at i + 1.
  const f = k.def("f");
  const second = (pair: string, pick: 0 | 1) => k.match(pair, [{ variant: PAIR_V, names: ["j", "row"], body: (parts) => parts[pick] }]);
  k.define(f, k.fn(["rows", "i"], (rows, i) => k.match(rows, [
    { variant: NIL, names: [], body: () => k.lit(0) },
    { variant: CONS, names: ["x", "rest"], body: ([x, rest]) => k.call(B.add, x, k.call(f,
      k.call(L("map"), k.call(L("keep"), k.call(L("numbered"), rest), k.fn(["pair"], (p) => k.call(S.not, k.call(S.equal, second(p, 0), i)))), k.fn(["q"], (q) => second(q, 1))),
      k.call(INT_OPS.add, i, k.int(1)))) },
  ])));
  const answer = k.def("answer");
  k.define(answer, k.thunk(() => k.call(f, k.list(...[1, 2, 4, 8, 16, 32].map((x) => k.lit(x))), k.int(0))));
  const code = base(k.code), names = baseNames(k.names);
  const info = infer(code, names, undefined, checkOptions);
  assert.deepEqual(info.errors.map((e) => e.message), []);
  const file = join(dir, "i149.mjs");
  writeFileSync(file, compile(code, info, names, { runtime, exports: ["answer"] }));
  const compiled = ((await import(pathToFileURL(file).href)).defs.answer as () => unknown)();
  const r = makeRunner(code, info, { print: () => {} });
  const [want] = r.call(r.value(answer)) as Iterable<unknown>;
  // 1, then [2, 4, 8, 16, 32]'s rest without its item 0, [4, 8, 16, 32];
  // 4, then [8, 16, 32] without item 1, [8, 32]; 8, then [32]; 32.
  assert.equal(want, 1 + 4 + 8 + 32);
  assert.equal(compiled, want);
});
