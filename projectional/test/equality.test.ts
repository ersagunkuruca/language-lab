// equal has one meaning (run.ts sameNumber, REVIEW-2026-10-22b.md §2), so
// the answer can't depend on how a comparison is reached: written directly,
// through a generic function, inside data, or run backwards. Same-meaning
// tests between evaluator and compiler can't find a wrong meaning, so this
// pits the four ways against each other on the boundary values where the
// old meanings differed. The compiler's side is compiler/test/equality.test.ts.

import { test } from "node:test";
import assert from "node:assert/strict";
import { Lang } from "../src/lang/dsl.ts";
import { infer } from "../src/lang/infer.ts";
import { base, baseNames } from "../src/lang/load.ts";
import { relate } from "../src/lang/relate.ts";
import { runMain, sameNumber } from "../src/lang/run.ts";
import { S, SHOW_ANY, STD_IMPL } from "../src/lang/std.ts";
import { get, type Id } from "../src/model.ts";
import { NUMBER } from "../src/lang/types.ts";
import { B } from "../src/prelude.ts";
import { PAIRS } from "./helpers.ts";

test("equal says the same directly, through a generic function, inside data, and run backwards", () => {
  const k = new Lang();
  const same = k.def("same");
  k.define(same, k.fn(["x", "y"], (x, y) => k.equal(x, y)));
  // At Float64: a whole literal left open would be an Int, compared exactly.
  const lit = (v: number) => (Number.isFinite(v) ? k.at(NUMBER, v) : k.call(B.div, k.lit(Number.isNaN(v) ? 0 : 1), k.lit(0)));
  const backs: Id[] = [];
  const main = k.def("main");
  k.define(main, k.thunk(() => k.call(S.print, k.call(SHOW_ANY, k.list(...PAIRS.flatMap(([a, b]) => [
    k.equal(lit(a), lit(b)), k.call(same, lit(a), lit(b)), k.equal(k.list(lit(a)), k.list(lit(b))),
  ]))))));
  for (const [, b] of PAIRS) {
    const f = k.def(`one of ${b}`);
    k.define(f, k.thunk(() => k.call(S.oneOf, k.list(lit(b)))));
    backs.push(f);
  }
  const code = base(k.code), names = baseNames(k.names);
  const info = infer(code, names);
  assert.deepEqual(info.errors, []);
  const out: string[] = [];
  runMain(code, info, main, { print: (s) => out.push(s) });
  const got = out[0].slice(1, -1).split(", ").map((x) => x === "true");
  PAIRS.forEach(([a, b], i) => {
    const want = sameNumber(a, b);
    assert.deepEqual(got.slice(3 * i, 3 * i + 3), [want, want, want], `${a} = ${b}: direct, generic, in a list`);
    // Backwards: one of([b]) asked for a has an answer exactly when a = b.
    if (Number.isNaN(a)) return; // NaN can't be asked for: it's no value to unify with
    let steps = 0;
    const answers = [...relate(code, backs[i], { out: a }, { spend: () => ++steps < 1000 })];
    assert.equal(answers.length > 0, want, `one of([${b}]) = ${a} backwards`);
  });
});

test("whole numbers compare exactly, so equal is an equivalence on Ints", () => {
  const ints = [0, 1, -1, 1e12, 1e12 + 1, 2 ** 53 - 1, 2 ** 53];
  for (const a of ints) for (const b of ints) for (const c of ints) {
    assert.equal(sameNumber(a, a), true);
    assert.equal(sameNumber(a, b), sameNumber(b, a));
    if (sameNumber(a, b) && sameNumber(b, c)) assert.ok(sameNumber(a, c), `${a} ${b} ${c}`);
  }
});

// show rounds to 9 decimals, so show(0.1 + 0.2) is "0.3" (Ersagun's call,
// 2026-10-23: kept, rather than "0.30000000000000004" in every output). It
// is off by at most 5·10^-10, inside equal's 10^-9, so the text read back
// is always a number equal to the one shown: forward, and run backwards.
test("show then read gives back an equal number", () => {
  const k = new Lang();
  const shown = k.def("shown");
  k.define(shown, k.fn(["x"], (x) => k.call(S.show, x)));
  const code = base(k.code);
  for (const x of [0.1 + 0.2, 1 / 3, -2 / 3, 1e6 / 7, 123456.789012345, 4e-10, -6e-10, 1e-9, 0.5, 2 ** 53, 1e15 + 0.3, 1e21, -0]) {
    const text = (STD_IMPL[S.show] as (x: number) => string)(x);
    assert.ok(sameNumber(Number(text), x), `show(${x}) = "${text}" reads back as ${Number(text)}`);
    const [x0] = get(code, get(code, shown, "def").body!, "lambda").params;
    const back = [...relate(code, shown, { out: text })].map((a) => a.values[x0]);
    assert.ok(back.length === 1 && typeof back[0] === "number" && sameNumber(back[0], x), `show(x) = "${text}" backwards gives ${back}, not ${x}`);
  }
});
