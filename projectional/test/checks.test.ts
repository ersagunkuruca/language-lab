// Test results kept by hash (TESTS-IN-THE-LANGUAGE.md §4, BACKLOG T7c):
// the key changes when the test, anything it uses or what examples.json
// saves for it changes, and a test that could answer differently isn't kept.

import { test } from "node:test";
import assert from "node:assert/strict";
import { Lang } from "../src/lang/dsl.ts";
import { infer } from "../src/lang/infer.ts";
import { base, baseNames } from "../src/lang/load.ts";
import { LIBRARY } from "../src/lang/library.ts";
import { CHECK_OP, INT_OPS, RANDOM_OP, S } from "../src/lang/std.ts";
import { evaluatorHash, resultKeys } from "../cli/checks.ts";
import type { Id } from "../src/model.ts";

function program(limit: number) {
  const k = new Lang(LIBRARY.code);
  const def = (name: string, params: string[], body: (...xs: Id[]) => Id) => { const d = k.def(name); k.define(d, k.fn(params, body)); return d; };
  const small = def("small", ["n"], (n) => k.call(INT_OPS.less, n, k.int(limit)));
  const law = def("small law", ["n"], (n) => k.call(CHECK_OP, k.call(small, n), k.lit("n is small")));
  const other = def("other law", ["n"], (n) => k.call(CHECK_OP, k.equal(n, n), k.lit("n is n")));
  const dice = def("dice law", ["n"], (n) => k.call(CHECK_OP, k.call(S.less, k.call(RANDOM_OP), k.lit(1)), k.lit("random is below 1")));
  const code = base(k.code), names = { ...baseNames(), ...k.names }, info = infer(code, names);
  assert.deepEqual(info.errors.map((e) => e.message), []);
  return { code, info, law, other, dice, defs: [small, law, other, dice] };
}

test("a kept result's key follows what the test uses", () => {
  const build = "b";
  const a = program(3), b = program(4);
  const ka = resultKeys(a.code, a.info, a.defs, {}, build), kb = resultKeys(b.code, b.info, b.defs, {}, build);
  // The law uses `small`, whose limit changed; the other law didn't change.
  assert.ok(ka.has(a.law) && kb.has(b.law));
  assert.notEqual(ka.get(a.law), kb.get(b.law));
  assert.equal(ka.get(a.other), kb.get(b.other));
  // What examples.json saves, and the evaluator's build, are in the key.
  assert.notEqual(resultKeys(a.code, a.info, a.defs, { [a.other]: [{ inputs: ["1"], answer: "2" }] }, build).get(a.other), ka.get(a.other));
  assert.notEqual(resultKeys(a.code, a.info, a.defs, {}, "c").get(a.other), ka.get(a.other));
  // A test that draws random numbers is never kept.
  assert.equal(ka.has(a.dice), false);
  assert.match(evaluatorHash(), /^[0-9a-f]{64}$/);
});
