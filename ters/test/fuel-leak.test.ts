// A run from outside after one that `with fuel` cut off (I295): it is
// under no fuel. The innermost `with fuel` a builtin call last saw
// (run.ts `ambient`) was left behind, run out, so the next run's calls
// into a definition that may not end each found no fuel: countdown's
// search had no answers after a cut run of it.

import { test } from "node:test";
import assert from "node:assert/strict";
import { B } from "../src/prelude.ts";
import { Lang } from "../src/lang/dsl.ts";
import { infer } from "../src/lang/infer.ts";
import { makeRunner } from "../src/lang/run.ts";
import { base, baseNames, checkOptions } from "../src/lang/load.ts";
import { LIBRARY } from "../src/lang/library.ts";
import { S } from "../src/lang/std.ts";

const L = (name: string) => LIBRARY.modules[0].exports.find((d) => LIBRARY.names[d] === name)!;

test("a run after one that with fuel cut off is under no fuel (I295)", () => {
  const k = new Lang(LIBRARY.code);
  // down(n): n calls the checker can't see end.
  const down = k.def("down");
  k.define(down, k.fn(["n"], (n) => k.if(k.call(S.less, n, k.lit(0.5)), k.lit(0), k.call(B.add, k.lit(1), k.call(down, k.call(B.sub, n, k.lit(1)))))));
  // Each item's walk, under all: one of 10, 20, 30, then a builtin (map)
  // calling back in, so the machine records the fuel it is under.
  const walks = () => k.call(S.all, k.thunk(() => k.call(down, k.call(S.oneOf, k.list(k.lit(10), k.lit(20), k.lit(30))))));
  const bare = k.def("bare"), cut = k.def("cut");
  k.define(bare, k.fn(["u"], () => k.call(L("sum"), k.call(L("map"), walks(), k.fn(["x"], (x) => k.call(down, x))))));
  k.define(cut, k.fn(["u"], () => k.call(S.first, k.thunk(() => k.call(S.fuel, k.lit(25), k.thunk(() => k.call(L("sum"), k.call(L("map"), walks(), k.fn(["x"], (x) => k.call(down, x))))))), k.thunk(() => k.lit(-1)))));
  const code = base(k.code), names = baseNames(k.names);
  const info = infer(code, names, undefined, checkOptions);
  assert.deepEqual(info.errors.map((e) => e.message), []);
  const r = makeRunner(code, info, { print: () => {}, names });
  const one = (d: string) => { for (const v of r.call(r.value(d), 0)) return v; return "no answer"; };
  assert.equal(one(bare), 60);
  assert.equal(one(cut), -1);
  assert.equal(one(bare), 60);
});
