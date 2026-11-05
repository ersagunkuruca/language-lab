// A search's later answers spend from the `with fuel` they were made under
// (BACKLOG I174). A choice point resumed after the fuel's body gave its
// first answer used to run its search with no fuel at all, so
// `with fuel(10, inverse(most, y))` over dice's `most` (a list's largest)
// ran on for minutes: the inverse law of T7e14 hung there.

import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { root } from "../src/io.ts";
import { Lang } from "../src/lang/dsl.ts";
import { infer } from "../src/lang/infer.ts";
import { loadProgram } from "../src/lang/load.ts";
import { CHECK_OP, S } from "../src/lang/std.ts";
import { runTests } from "../src/lang/tests.ts";

test("with fuel bounds a search's later answers too", () => {
  const p = loadProgram(join(root, "examples", "dice"));
  const k = new Lang(p.code);
  const inverse = p.named("inverse"), most = p.named("most");
  const law = k.def("inverse undoes");
  k.define(law, k.fn(["f", "x"], (f, x) => k.let("y", k.call(f, x), (y) =>
    k.call(CHECK_OP, k.equal(k.call(f, k.call(S.fuel, k.int(10), k.thunk(() => k.call(inverse, f, y)))), y), k.lit("f(inverse(f, f(x))) is f(x)")))));
  const code = { ...p.code, nodes: { ...p.code.nodes, ...k.code.nodes }, defs: [...p.code.defs, ...k.code.defs] };
  const names = { ...p.pres.names, ...k.names }, info = infer(code, names);
  assert.deepEqual(info.errors.map((e) => e.message), []);
  const t0 = performance.now();
  const r = runTests(code, info, names, [law, most]).find((x) => x.def === law)!;
  assert.deepEqual(r.failures, []);
  assert.equal(r.cases, 6);
  assert.ok(performance.now() - t0 < 15_000, `${Math.round(performance.now() - t0)} ms`);
});
