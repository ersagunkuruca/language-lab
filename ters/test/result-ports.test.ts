// Named result ports (PORTS-2026-11-01.md, BACKLOG L128b): a function
// written with results gives a tuple of that many, each part named; the
// names are found from a use (ports.ts) and the types checked.

import { test } from "node:test";
import assert from "node:assert/strict";
import { Lang } from "../src/lang/dsl.ts";
import { infer } from "../src/lang/infer.ts";
import { base, baseNames, checkOptions } from "../src/lang/load.ts";
import { resultPorts } from "../src/lang/ports.ts";
import { runMain } from "../src/lang/run.ts";
import { ARITH, S, SHOW_ANY, tuplePart, tupleVariant } from "../src/lang/std.ts";
import { showType } from "../src/lang/types.ts";

test("a function with two named results gives a tuple, its parts read by position and named from the function", () => {
  const k = new Lang();
  const part = k.def("part");
  // part(speed, time) → drift, drop = speed · time, time · time
  k.define(part, k.gives(["speed", "time"], ["drift", "drop"], (v, t) => k.call(tupleVariant(2), k.call(ARITH.mul, v, t), k.call(ARITH.mul, t, t))));
  const main = k.def("main");
  const use = k.call(part, k.lit(3), k.lit(2));
  k.define(main, k.thunk(() => k.let("r", use, (r) => k.call(S.print, k.call(SHOW_ANY, k.call(tuplePart(2, 1), r))))));
  const code = base(k.code), names = baseNames(k.names);
  const info = infer(code, names, undefined, checkOptions);
  assert.deepEqual(info.errors.map((e) => e.message), []);
  assert.equal(showType(info.typeOf.get(part)!, names, info.subst.arith), "(a, a) -> (a, a) where a is a Number");
  const ports = resultPorts(code, (code.nodes[use] as { fn: string }).fn)!;
  assert.deepEqual(ports.map((p) => names[p]), ["drift", "drop"]);
  const printed: string[] = [];
  runMain(code, info, main, { print: (s) => printed.push(s), names });
  assert.deepEqual(printed, ["4"]);
});

test("a body that doesn't give as many results as it names is an error; one result is the value itself", () => {
  const k = new Lang();
  const two = k.def("two");
  k.define(two, k.gives(["x"], ["a", "b"], () => k.lit("just one")));
  const one = k.def("one");
  k.define(one, k.gives(["x"], ["doubled"], (x) => k.call(ARITH.add, x, x)));
  const code = base(k.code), names = baseNames(k.names);
  const info = infer(code, names, undefined, checkOptions);
  assert.deepEqual(info.errors.map((e) => e.message), ["this function gives 2 results: expected (a, b), got Text"]);
  assert.match(showType(info.typeOf.get(one)!, names, info.subst.arith), /^\(a\) -> a/);
});
