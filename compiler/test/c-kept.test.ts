// A definition's value is worked out once in C too (C173b): bounce's
// Clifford table (`flat`) is held in a static from its first call, each
// step given a count of it, and the harness lets go of it after each call,
// so no cell is left over. The answers are the evaluator's.

import { test } from "node:test";
import assert from "node:assert/strict";
import { load } from "../src/program.ts";
import { lowerScalar } from "../src/scalar.ts";
import { emitC } from "../src/c.ts";
import { build, skip } from "./c-harness.ts";
import { Lang } from "../../ters/src/lang/dsl.ts";
import { infer } from "../../ters/src/lang/infer.ts";
import { makeRunner, type Value } from "../../ters/src/lang/run.ts";
import { merge, type Id } from "../../ters/src/model.ts";
import { CONS, INT_OPS, NIL } from "../../ters/src/lang/std.ts";

test("a definition's value is held once in C, and freed by the harness (C173b)", { skip }, () => {
  const p = load("bounce");
  const k = new Lang(p.code), d = k.def("bench");
  k.define(d, k.fn(["n"], (n) => k.fold(k.call(INT_OPS.range, n), [
    { variant: NIL, names: [], body: () => k.x(p.named("flat bodies")) },
    { variant: CONS, names: ["i", "t"], results: [null, "b"], body: (_: Id[], rs: (Id | null)[]) => k.call(p.named("step"), k.x(p.named("flat")), rs[1]!) },
  ])));
  const code = merge(k.code, p.code), names = { ...p.pres.names, ...k.names };
  const info = infer(code, names, undefined, p.options);
  assert.deepEqual(info.errors.map((e) => e.message), []);
  const ir = lowerScalar(code, info, names, [d], { data: true });
  const flat = ir.funcs.findIndex((f) => f.name === "flat"), at = ir.funcs.findIndex((f) => f.name === "bench");
  assert.deepEqual([...ir.refused.values()], []);
  assert.match(emitC(ir, { harness: true }).c, new RegExp(`if \\(!lab_m${flat}_has\\) \\{ lab_m${flat} = `));
  const got = build(ir)([[at, [3n as unknown as Value]], [at, [3n as unknown as Value]]]);
  const r = makeRunner(code, info, { print: () => {}, names });
  let want: Value | undefined;
  for (const x of r.call(r.value(d), 3n as unknown as Value)) { want = x; break; }
  const bits = (v: unknown) => JSON.stringify(v, (_, x) => (typeof x === "bigint" ? `${x}n` : x));
  for (const g of got) { assert.equal(g.live, 0); assert.equal(bits(g.value), bits(want)); }
});
