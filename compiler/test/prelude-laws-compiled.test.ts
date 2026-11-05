// The prelude's laws hold compiled too (T7e2): each runs on the core IR's
// JavaScript under a handler of its Check written in the language
// (tests.ts checkedTests), on the inputs the evaluator's run uses, so a
// difference between the two (a platform's sin, say) shows as a law.

import { test } from "node:test";
import assert from "node:assert/strict";
import { infer } from "../../ters/src/lang/infer.ts";
import { base, baseNames } from "../../ters/src/lang/load.ts";
import { LIBRARY } from "../../ters/src/lang/library.ts";
import type { Value } from "../../ters/src/lang/run.ts";
import { checkedTests, checksAgain, compiledValue, testsIn } from "../../ters/src/lang/tests.ts";
import { FAIL, loadCoreJs, lowerCore } from "../src/core-js.ts";

test("the prelude's laws hold on the compiled program too", () => {
  const code = base(LIBRARY.code), names = { ...baseNames(), ...LIBRARY.names }, info = infer(code, names);
  const laws = testsIn(info, LIBRARY.code.defs);
  const c = checkedTests(code, names, laws);
  const cinfo = infer(c.code, c.names);
  assert.deepEqual(cinfo.errors.map((e) => e.message), []);
  const ir = lowerCore(c.code, cinfo, c.names, [...c.wrappers.values()]);
  const fns = loadCoreJs(ir, { print: () => {} });
  const results = checksAgain(code, info, names, laws, {}, (d) => {
    const w = c.wrappers.get(d)!;
    const why = ir.refused.get(w);
    if (why) return why;
    const i = ir.funcs.findIndex((g) => g.def === w && !g.inner);
    if (i < 0 || ir.funcs[i].multi) return "searches";
    return (args) => { try { return { value: fns[i](...args.map(compiledValue)) as Value }; } catch (e) { if (e === FAIL) return { none: true }; throw e; } };
  });
  assert.ok(results.length >= 9, `${results.length} laws`);
  for (const r of results) {
    assert.equal(r.skipped, undefined, r.name);
    assert.equal(r.error, undefined, r.name);
    assert.ok(r.cases >= 10, `${r.name}: ${r.cases}`);
    assert.deepEqual(r.failures, [], r.name);
  }
});
