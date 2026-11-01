// A definition generic in its number type runs, at another type, as a copy
// (arith.ts); entering the copy reports the definition's own lambda, so the
// editor's Run on it opens with what main gave it (I29).

import { test } from "node:test";
import assert from "node:assert/strict";
import { Lang } from "../src/lang/dsl.ts";
import { base, baseNames, checkOptions } from "../src/lang/load.ts";
import { infer } from "../src/lang/infer.ts";
import { makeRunner } from "../src/lang/run.ts";
import { ARITH } from "../src/lang/std.ts";
import { LIBRARY } from "../src/lang/library.ts";
import type { NodeOf } from "../src/model.ts";

test("entering a copy at Int reports the generic definition's lambda", () => {
  const k = new Lang(LIBRARY.code);
  const twice = k.def("twice");
  k.define(twice, k.fn(["x"], (x) => k.call(ARITH.add, x, x)));
  const main = k.def("main");
  k.define(main, k.fn([], () => k.call(twice, k.int(21))));
  const code = base(k.code), names = { ...baseNames(k.names) }, info = infer(code, names, undefined, checkOptions);
  assert.deepEqual(info.errors, []);
  const lambda = (code.nodes[twice] as NodeOf<"def">).body!;
  const entered: [string, unknown[]][] = [];
  const r = makeRunner(code, info, { print: () => {}, names, entered: (l, args) => entered.push([l, args]) });
  for (const v of r.call(r.value(main))) assert.equal(Number(v), 42);
  const got = entered.find(([l]) => l === lambda);
  assert.ok(got, "twice's own lambda is entered");
  assert.deepEqual(got![1].map(Number), [21]);
});
