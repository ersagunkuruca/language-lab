// Lists as arrays on the core IR's JavaScript (C138a): where the chooser
// stores a program's lists as `array of List` (library-reps.ts, written in
// the language), lowerCore prints its jobs as the runtime's two-ended
// arrays (array.at, array.first, array.rest), as WebAssembly and C do
// (ters/test/library-reps.test.ts, C30d3c), with the evaluator's answers.
// So the core IR takes lists as arrays from the representation layer, not
// from compile.ts's own CONS/NIL tests.

import { test } from "node:test";
import assert from "node:assert/strict";
import { Lang } from "../../ters/src/lang/dsl.ts";
import { infer } from "../../ters/src/lang/infer.ts";
import { base, baseNames, checkOptions } from "../../ters/src/lang/load.ts";
import { LIBRARY } from "../../ters/src/lang/library.ts";
import { withLibraryRepresentations } from "../../ters/src/lang/library-reps.ts";
import { makeRunner } from "../../ters/src/lang/run.ts";
import { CONS, NIL, S } from "../../ters/src/lang/std.ts";
import { B } from "../../ters/src/prelude.ts";
import { emitCoreJs, loadCoreJs, lowerCore } from "../src/core-js.ts";

const L = (n: string) => LIBRARY.modules.flatMap((m) => m.exports).find((d) => LIBRARY.names[d] === n)!;

test("a list read by position and taken apart is an array on the core IR's JavaScript, with the evaluator's answers", () => {
  const k = new Lang(LIBRARY.code);
  const xs = k.def("xs");
  k.define(xs, k.call(L("map"), k.call(S.range, k.lit(50)), k.fn(["i"], (i) => k.call(B.mul, i, i))));
  const at = k.def("at");
  k.define(at, k.fn(["i"], (i) => k.call(B.add, k.call(L("item at"), k.x(xs), i, k.lit(-1)), k.lit(50))));
  const head = k.def("head plus");
  k.define(head, k.fn(["n"], (n) => k.match(k.x(xs), [
    { variant: NIL, names: [], body: () => n },
    { variant: CONS, names: ["x", "rest"], body: ([x]) => k.call(B.add, x, n) },
  ])));
  // The second item, from a match on the rest.
  const second = k.def("second");
  k.define(second, k.fn(["n"], (n) => k.match(k.x(xs), [
    { variant: NIL, names: [], body: () => n },
    { variant: CONS, names: ["x", "rest"], body: ([, rest]) => k.match(rest, [
      { variant: NIL, names: [], body: () => n },
      { variant: CONS, names: ["y", "more"], body: ([y]) => k.call(B.add, y, n) },
    ]) },
  ])));
  const code = base(k.code), names = baseNames(k.names);
  const info = infer(code, names, undefined, checkOptions);
  const ours = [xs, at, head, second];
  const c = withLibraryRepresentations(code, info, names, at, ours);
  assert.deepEqual(c.chosen, ["List as array of List"]);
  const info2 = infer(c.code, c.names, undefined, { ...checkOptions, insiders: [...checkOptions.insiders!, ...c.insiders] });
  assert.deepEqual(info2.errors.map((e) => e.message), []);
  const core = lowerCore(c.code, info2, c.names, [at, head, second]);
  assert.deepEqual([...core.refused.entries()], []);
  const js = emitCoreJs(core).js;
  for (const op of ["array.at", "array.first", "array.rest"]) assert.ok(js.includes(op), op);
  const fs = loadCoreJs(core);
  const fn = (d: string) => fs[core.funcs.findIndex((g) => g.def === d && !g.inner)];
  // The evaluator on the program as written, lists and all.
  const r = makeRunner(code, info, { print: () => {}, names });
  const ev = (d: string, x: number) => { for (const v of r.call(r.value(d), x)) return v; };
  for (const i of [0, 3, 49, 50, -1]) assert.equal(fn(at)(i), ev(at, i), `at ${i}`);
  for (const n of [0, 4]) {
    assert.equal(fn(head)(n), ev(head, n));
    assert.equal(fn(second)(n), ev(second, n));
  }
  assert.equal(fn(second)(0), 1);
});
