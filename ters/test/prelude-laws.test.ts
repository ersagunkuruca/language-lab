// The library checks itself (TESTS-IN-THE-LANGUAGE.md): the prelude's
// laws are definitions that perform Check, run here as `lab test` runs a
// program's. First laws: the complex ones (POLAR.md L97e).

import { test } from "node:test";
import assert from "node:assert/strict";
import { infer } from "../src/lang/infer.ts";
import { base, baseNames } from "../src/lang/load.ts";
import { LIBRARY } from "../src/lang/library.ts";
import { runTests, testsIn } from "../src/lang/tests.ts";

test("the prelude's laws hold on small values", () => {
  const code = base(LIBRARY.code), names = { ...baseNames(), ...LIBRARY.names }, info = infer(code, names);
  const laws = testsIn(info, LIBRARY.code.defs);
  assert.deepEqual(laws.map((d) => names[d]).sort(), ["from polar undoes modulus and angle", "polar undoes unpolar"]);
  for (const r of runTests(code, info, names, laws)) {
    assert.equal(r.error, undefined, r.name);
    assert.ok(r.cases >= 10, `${r.name}: ${r.cases}`);
    assert.deepEqual(r.failures, [], r.name);
  }
});
