// A "//" inside a text the program writes (an address) isn't a comment:
// the compiler keeps the definitions a line calls after one (L191c found
// `utf8 of` dropped after "http://…", and the run stopped on it).
import { test } from "node:test";
import assert from "node:assert/strict";
import { Lang } from "../../ters/src/lang/dsl.ts";
import { infer } from "../../ters/src/lang/infer.ts";
import { base, baseNames } from "../../ters/src/lang/load.ts";
import { runMain } from "../../ters/src/lang/run.ts";
import { ARITH, SHOW_ANY, tupleVariant } from "../../ters/src/lang/std.ts";
import { compiledDefs } from "../src/core-js.ts";


test("a call after a text with // in it on the same line is compiled", async () => {
  const k = new Lang();
  const next = k.def("next");
  k.define(next, k.fn(["x"], (x) => k.call(ARITH.add, x, k.lit(1))));
  const main = k.def("main");
  k.define(main, k.thunk(() => k.call(SHOW_ANY, k.call(tupleVariant(2), k.lit("http://example.com/'a'"), k.call(next, k.lit(1))))));
  const code = base(k.code), names = baseNames(k.names), info = infer(code, names);
  assert.deepEqual(info.errors.map((e) => e.message), []);
  const want = runMain(code, info, main, { print: () => {}, names });
  const defs = compiledDefs(code, info, names, ["main"]);
  assert.equal(defs.main(), want);
});
