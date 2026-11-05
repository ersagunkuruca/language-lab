// unit parts (BACKLOG L230): a record of Float64s' basis, one record per
// field with a 1 in its own place, so clifford algebra needs only the
// signature: `clifford algebra([1, 1, 1, 0], unit parts(1))`.

import { test } from "node:test";
import assert from "node:assert/strict";
import { Lang } from "../src/lang/dsl.ts";
import { LIBRARY } from "../src/lang/library.ts";
import { infer } from "../src/lang/infer.ts";
import { makeRunner } from "../src/lang/run.ts";
import { base, baseNames } from "../src/lang/load.ts";
import { S, SHOW_ANY } from "../src/lang/std.ts";
import { NUMBER } from "../src/lang/types.ts";

test("unit parts: a record's basis in field order, and a Float64's is [1]", () => {
  const k = new Lang(LIBRARY.code);
  const V = k.type("V3", [], [["v3", [["x", () => k.tref(NUMBER)], ["y", () => k.tref(NUMBER)], ["z", () => k.tref(NUMBER)]]]]);
  const d = k.def("basis");
  k.define(d, k.call(SHOW_ANY, k.call(S.unitParts, k.call(V.v.v3, k.lit(5), k.lit(6), k.lit(7)))));
  const one = k.def("one");
  k.define(one, k.call(SHOW_ANY, k.call(S.unitParts, k.lit(2.5))));
  const code = base(k.code), names = baseNames(k.names), info = infer(code, names);
  assert.deepEqual(info.errors.map((e) => e.message), []);
  const r = makeRunner(code, info, { print: () => {}, names });
  assert.equal(r.value(d), "[v3(1, 0, 0), v3(0, 1, 0), v3(0, 0, 1)]");
  assert.equal(r.value(one), "[1]");
});
