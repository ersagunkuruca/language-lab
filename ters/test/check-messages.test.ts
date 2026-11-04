// Two of the checker's messages (from building the problems table, L187a):
// a function of one input says "1 input", and a built-in type used as a
// value says it is a type, as a data type of the program's own does.
import { test } from "node:test";
import assert from "node:assert/strict";
import { Lang } from "../src/lang/dsl.ts";
import { infer } from "../src/lang/infer.ts";
import { base, baseNames } from "../src/lang/load.ts";
import { S } from "../src/lang/std.ts";
import { NUMBER } from "../src/lang/types.ts";
import { TRUE } from "../src/lang/std.ts";

const messages = (build: (k: Lang) => void) => {
  const k = new Lang();
  build(k);
  return infer(base(k.code), baseNames(k.names)).errors.map((e) => e.message);
};

test("a function of one input given two says 1 input", () => {
  const got = messages((k) => { const f = k.def("f"); k.define(f, k.fn(["a"], (a) => k.call(S.not, a))); k.define(k.def("p"), k.call(f, k.x(TRUE), k.x(TRUE))); });
  assert.ok(got.some((m) => /^f takes 1 input, given 2$/.test(m)), got.join("; "));
});

test("Float64 used as a value is a type, not a value", () => {
  const got = messages((k) => { k.define(k.def("p"), k.x(NUMBER)); });
  assert.ok(got.some((m) => /^Float64 is a type, not a value$/.test(m)), got.join("; "));
});
