// The library checks itself (TESTS-IN-THE-LANGUAGE.md): the prelude's
// laws are definitions that perform Check, run here as `lab test` runs a
// program's. First laws: the complex ones (POLAR.md L97e); Bytes' round
// trips through Base64, hex and UTF-8 (T7e4); dates', instants' and
// durations' text read back (T7e5).

import { test } from "node:test";
import assert from "node:assert/strict";
import { infer } from "../src/lang/infer.ts";
import { base, baseNames } from "../src/lang/load.ts";
import { LIBRARY } from "../src/lang/library.ts";
import { runTests, testsIn } from "../src/lang/tests.ts";
import { isUse, subtree, useTarget } from "../src/model.ts";

test("the prelude's laws hold on small values", () => {
  const code = base(LIBRARY.code), names = { ...baseNames(), ...LIBRARY.names }, info = infer(code, names);
  const laws = testsIn(info, LIBRARY.code.defs);
  assert.deepEqual(laws.map((d) => names[d]).sort(), ["acos by unpolar agrees at Float64", "asin by unpolar agrees at Float64", "bytes of base64 undoes base64 of", "bytes of hex undoes hex of", "cos by polar agrees at Float64", "cos by sin agrees at Float64", "date read undoes date text", "duration read undoes duration text", "from polar undoes modulus and angle", "instant read undoes instant text", "polar by sincos agrees at Float64", "polar undoes unpolar", "sin by cos agrees at Float64", "sin by polar agrees at Float64", "text of utf8 undoes utf8 of"]);
  for (const r of runTests(code, info, names, laws)) {
    assert.equal(r.error, undefined, r.name);
    assert.ok(r.cases >= 10, `${r.name}: ${r.cases}`);
    assert.deepEqual(r.failures, [], r.name);
  }
});

// WAYS.md step 4 (L96d): every way the prelude gives is checked by a law
// against a field it stands for, so a new way comes with its law.
test("every way in the prelude has a law that runs it", () => {
  const code = base(LIBRARY.code), names = { ...baseNames(), ...LIBRARY.names }, info = infer(code, names);
  const laws = testsIn(info, LIBRARY.code.defs);
  const reached = new Set(laws.flatMap((d) => subtree(code, d).flatMap((id) => { const n = code.nodes[id]; return n.kind === "ref" ? [n.target] : isUse(n) ? [useTarget(code.nodes, n)] : []; })));
  const ways = LIBRARY.code.defs.filter((d) => (code.nodes[d] as { way?: string }).way);
  assert.ok(ways.length >= 7, `${ways.length} ways`);
  assert.deepEqual(ways.filter((w) => !reached.has(w)).map((w) => names[w]), []);
});
