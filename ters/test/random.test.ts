// Random (LANGUAGE.md "Random"): `seeded` gives the same numbers every run,
// a match can answer `random()`, the world answers what nothing handles,
// and a search may draw.

import { test } from "node:test";
import assert from "node:assert/strict";
import type { Id } from "../src/model.ts";
import { Lang } from "../src/lang/dsl.ts";
import { infer } from "../src/lang/infer.ts";
import { base, baseNames } from "../src/lang/load.ts";
import { runMain } from "../src/lang/run.ts";
import { seededGenerator } from "../src/lang/random.ts";
import { RANDOM_OP, S, SHOW_ANY } from "../src/lang/std.ts";
import { showType } from "../src/lang/types.ts";
import { B } from "../src/prelude.ts";

function program(build: (k: Lang) => Id, random = () => 0.5) {
  const k = new Lang();
  const main = build(k);
  const code = base(k.code), names = baseNames(k.names);
  const info = infer(code, names);
  const printed: string[] = [];
  const run = () => { runMain(code, info, main, { print: (s) => printed.push(s), names, world: { random } }); return printed; };
  return { run, info, names, main, errors: info.errors.map((e) => e.message) };
}
// A draw as a whole number, exactly: every bit of the Float64 shows.
const bits = (k: Lang, x: Id) => k.call(S.show, k.call(B.mul, x, k.lit(2 ** 53)));
const draw = (k: Lang) => k.call(RANDOM_OP);

test("the generator: xoshiro128** seeded by SplitMix32, checked against a separate implementation", () => {
  // From a Python port of Vigna's C (prng.di.unimi.it), seed 42.
  const g = seededGenerator(42);
  assert.deepEqual([g.next(), g.next(), g.next()].map((x) => x * 2 ** 53), [5950297428061403, 1006121846472570, 712520312224652]);
  for (let i = 0; i < 10000; i++) { const x = g.next(); assert.ok(x >= 0 && x < 1); }
});

test("seeded: the same seed, the same numbers; another seed, others", () => {
  const p = program((k) => {
    const three = k.def("three");
    k.define(three, k.fn(["seed"], (seed) => k.call(S.seeded, seed, k.thunk(() => k.text(bits(k, draw(k)), k.lit(" "), bits(k, draw(k)), k.lit(" "), bits(k, draw(k)))))));
    const main = k.def("main");
    k.define(main, k.thunk(() => k.seq(k.call(S.print, k.call(three, k.lit(42))), k.call(S.print, k.call(three, k.lit(42))), k.call(S.print, k.call(three, k.lit(7))))));
    return main;
  });
  assert.deepEqual(p.errors, []);
  const [a, b, c] = p.run();
  assert.equal(a, "5950297428061403 1006121846472570 712520312224652");
  assert.equal(a, b);
  assert.notEqual(a, c);
  // seeded removes Random from the type: main needs nothing of the world.
  assert.equal(showType(p.info.typeOf.get(p.main)!, p.names).includes("Random"), false);
});

test("a match answers random(), and the world answers what nothing handles", () => {
  const p = program((k) => {
    const main = k.def("main");
    k.define(main, k.thunk(() => k.seq(
      k.call(S.print, k.call(S.show, k.handle(draw(k), [{ variant: RANDOM_OP, names: [], body: () => k.lit(0.25) }]))),
      k.call(S.print, k.call(S.show, draw(k))))));
    return main;
  }, () => 0.75);
  assert.deepEqual(p.errors, []);
  assert.deepEqual(p.run(), ["0.25", "0.75"]);
});

test("a search may draw: Random isn't the world", () => {
  const p = program((k) => {
    const main = k.def("main");
    k.define(main, k.thunk(() => k.call(S.print, k.call(SHOW_ANY, k.call(S.seeded, k.lit(1), k.thunk(() =>
      k.call(S.all, k.thunk(() => k.let("x", k.call(S.oneOf, k.list(k.lit(1), k.lit(2), k.lit(3))), (x) =>
        k.if(k.call(S.less, draw(k), k.lit(2)), x, k.call(S.fail)))))))))));
    return main;
  });
  assert.deepEqual(p.errors, []);
  assert.deepEqual(p.run(), ["[1, 2, 3]"]);
});
