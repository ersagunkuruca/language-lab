// Run's search for a function run backwards (editor/backSearch.ts, BACKLOG
// E127): cut short, it keeps the answers it found and says there may be
// more, so the page shows the first answer at once.

import { test } from "node:test";
import assert from "node:assert/strict";
import { Lang } from "../src/lang/dsl.ts";
import { base, baseNames } from "../src/lang/load.ts";
import { B } from "../src/prelude.ts";
import { searchBackwards } from "../../editor/backSearch.ts";

const inputs = (a: { values: Record<string, string> }) => Object.entries(a.values).filter(([k]) => k !== "out").map(([, v]) => v);

// The Fibonacci numbers with signs that take turns (1, 1, 0, 1, −1, 2, −3,
// 5, −8, 13, …): signed(a, b, k) = if k = 0 then a else signed(b, a − b,
// k − 1). They go both ways, so nothing tells the search a second answer
// can't come (fibFast's walk stops since L83b).
function signedFib() {
  const k = new Lang();
  const signed = k.def("signed"), fast = k.def("signedFib");
  k.define(signed, k.fn(["a", "b", "k"], (a, b, i) => k.if(k.equal(i, k.lit(0)), a, k.call(signed, b, k.call(B.sub, a, b), k.call(B.sub, i, k.lit(1))))));
  k.define(fast, k.fn(["n"], (n) => k.call(signed, k.lit(1), k.lit(1), n)));
  return { code: base(k.code), names: baseNames(k.names), fast };
}

test("cut short after the first answer, the search keeps it and says there may be more", () => {
  const { code, names, fast } = signedFib();
  // Found in a few steps; the search for a second one goes on for thousands.
  const steps = { n: 0 };
  const cut = searchBackwards(code, fast, { out: 13 }, names, () => ++steps.n > 400);
  assert.equal(cut.cut, true);
  assert.equal(cut.error, undefined);
  assert.deepEqual(cut.answers.map(inputs), [["9"]]);
});

test("a search that ends on its own isn't cut", () => {
  const k = new Lang();
  const twice = k.def("twice");
  k.define(twice, k.fn(["x"], (x) => k.call(B.add, x, x)));
  const r = searchBackwards(base(k.code), twice, { out: 8 }, baseNames(k.names), () => false);
  assert.equal(r.cut, undefined);
  assert.deepEqual(r.answers.map(inputs), [["4"]]);
});
