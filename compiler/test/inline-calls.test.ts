// Functions called from one place put in place (inline-small.ts
// inlineCalls, Ersagun 2026-11-16: "why so many functions where we could
// inline lots of function calls?"): fewer functions printed, the same
// lines out, and none left that is plainly called from one place.

import { test } from "node:test";
import assert from "node:assert/strict";
import { load } from "../src/program.ts";
import { lowerCore, printedMain, reachedFuncs, runPrintedMain } from "../src/core-js.ts";

const run = (name: string, inline: boolean) => {
  if (inline) delete process.env.NO_INLINE_CALLS; else process.env.NO_INLINE_CALLS = "1";
  try {
    const p = load(name), main = p.named("main");
    const ir = lowerCore(p.code, p.info, p.pres.names, [main]);
    const fi = ir.funcs.findIndex((g) => g.def === main && !g.inner);
    const lines: string[] = [];
    runPrintedMain({ ...printedMain(ir, p.pres.names[main]) } as never, [], { print: (s: string) => lines.push(s), names: p.pres.names } as never);
    return { reached: reachedFuncs(ir, [fi]).size, lines };
  } finally { delete process.env.NO_INLINE_CALLS; }
};

for (const name of ["collatz", "queens", "countdown", "wc"]) {
  test(`${name}: functions called from one place are put in place, the same lines out`, () => {
    const with_ = run(name, true), without = run(name, false);
    assert.deepEqual(with_.lines, without.lines);
    assert.ok(with_.lines.length > 0);
    assert.ok(with_.reached <= without.reached, `${with_.reached} > ${without.reached}`);
  });
}

// A page: nothing printed, its functions counted.
test("dice prints fewer functions", () => {
  assert.ok(run("dice", true).reached < run("dice", false).reached);
});
