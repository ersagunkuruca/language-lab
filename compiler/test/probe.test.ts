// I155: deciding how a list parameter is passed wrote code. A view copy (a
// definition whose list comes in as an array and a position) first looks
// through its body for calls that hand on a rest; one such call took
// `split(show(h), "1")`, and the look wrote that text's JavaScript before
// the definition's own names were set up ("Cannot access 'boolFns' before
// initialization"). The look writes nothing now. Found by the fuzz test
// (compiler/test/fuzz.test.ts, C129).

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { Lang } from "../../ters/src/lang/dsl.ts";
import { base, baseNames, checkOptions } from "../../ters/src/lang/load.ts";
import { infer } from "../../ters/src/lang/infer.ts";
import { LIBRARY } from "../../ters/src/lang/library.ts";
import { CONS, INT_OPS, NIL, TEXT_OPS } from "../../ters/src/lang/std.ts";
import { compile } from "../src/compile.ts";
import { $toList } from "../src/runtime.js";

const runtime = pathToFileURL(join(import.meta.dirname, "../src/runtime.js")).href;
const lib = (name: string) => LIBRARY.code.defs.find((x) => LIBRARY.names[x] === name)!;

test("a view copy whose body splits a text it works out compiles and runs (I155)", async () => {
  const k = new Lang(LIBRARY.code);
  // Each item twice, built as it goes: its list can be written into an
  // array, so `count` gets a view of one.
  const twice = k.def("twice");
  k.define(twice, k.fn(["xs"], (xs) => k.match(xs, [
    { variant: NIL, names: [], body: () => k.list() },
    { variant: CONS, names: ["x", "rest"], body: ([x, rest]) => k.call(CONS, x, k.call(CONS, x, k.call(twice, rest))) },
  ])));
  // For each item, how many of the pieces of its digits split at "1"
  // pair with the items after it.
  const count = k.def("count");
  k.define(count, k.fn(["xs", "a"], (xs, a) => k.match(xs, [
    { variant: NIL, names: [], body: () => a },
    { variant: CONS, names: ["h", "t"], body: ([h, t]) => k.call(INT_OPS.add,
      k.call(lib("length"), k.call(lib("zipped"), k.call(TEXT_OPS.split, k.call(INT_OPS.show, h), k.lit("1")), t)),
      k.call(count, t, a)) },
  ])));
  k.define(k.def("main"), k.fn(["xs"], (xs) => k.call(count, k.call(twice, xs), k.int(0))));
  const code = base(k.code), names = baseNames(k.names);
  const info = infer(code, names, undefined, checkOptions);
  assert.deepEqual(info.errors.map((e) => e.message), []);
  const dir = mkdtempSync(join(tmpdir(), "probe-"));
  writeFileSync(join(dir, "out.mjs"), compile(code, info, names, { runtime, exports: ["main"] }));
  const defs = (await import(pathToFileURL(join(dir, "out.mjs")).href)).defs as Record<string, (l: unknown) => unknown>;
  // 2 2 101 101 3 3: "2" is one piece, "101" three ("", "0", ""), each
  // paired with at most the items after it (5 4 3 2 1 0).
  assert.equal(Number(defs.main($toList([2n, 101n, 3n]))), 1 + 1 + 3 + 2 + 1 + 0);
});
