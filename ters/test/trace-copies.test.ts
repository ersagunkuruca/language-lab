// A definition run at other number types (BACKLOG I125): the program runs
// a copy of it at each (arith.ts), and as written it is Float64's. Given
// what a caller gave its copy, the wire values run that copy and show its
// values on the nodes it copies.
import { test } from "node:test";
import assert from "node:assert/strict";
import { Lang } from "../src/lang/dsl.ts";
import { infer } from "../src/lang/infer.ts";
import { base, baseNames } from "../src/lang/load.ts";
import { ARITH, RATIO } from "../src/lang/std.ts";
import { trace } from "../src/lang/trace.ts";
import { showValue, type Value } from "../src/lang/run.ts";
import type { Id, NodeOf } from "../src/model.ts";

test("values on the wires of a definition main runs at another number type", () => {
  const k = new Lang();
  const twice = k.def("twice");
  let sum = "";
  k.define(twice, k.fn(["x"], (x) => (sum = k.call(ARITH.add, x, x))));
  const main = k.def("main");
  k.define(main, k.fn([], () => k.call(twice, k.call(RATIO, k.lit(1), k.lit(3)))));
  const code = base(k.code), names = baseNames(k.names), info = infer(code, names);
  const lam = (code.nodes[twice] as NodeOf<"def">).body!;
  let given: Value[] | undefined;
  trace(code, info, main, [], undefined, (l: Id, args: Value[]) => { if (l === lam) given = args; });
  assert.ok(given);
  // As written, twice adds Float64s: a fraction doesn't go in.
  assert.ok(trace(code, info, twice, given!).error);
  const t = trace(code, info, twice, given!, undefined, undefined, true);
  assert.equal(t.error, undefined);
  assert.equal(showValue(t.values.get(sum)!, code, names), showValue(t.result!, code, names));
  assert.match(showValue(t.result!, code, names), /2.*3/);
});
