// Float32 stored as binary32 in C (C309): the Float32 record's struct
// holds a `float`, an array of them four bytes a slot, and the program
// prints what the evaluator prints.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { Lang } from "../../ters/src/lang/dsl.ts";
import { base, baseNames } from "../../ters/src/lang/load.ts";
import { infer } from "../../ters/src/lang/infer.ts";
import { runMain } from "../../ters/src/lang/run.ts";
import { LIBRARY } from "../../ters/src/lang/library.ts";
import { ARITH, ARRAY_OPS, CONS, DIVIDE, INT_OPS, NIL, S, SHOW_ANY } from "../../ters/src/lang/std.ts";
import type { Id } from "../../ters/src/model.ts";
import { lowerScalar } from "../src/scalar.ts";
import { emitC } from "../src/c.ts";
import { compile, skip } from "./c-harness.ts";

const lib = (name: string) => LIBRARY.code.defs.find((d) => LIBRARY.names[d] === name && (LIBRARY.code.nodes[d] as { body?: Id }).body !== undefined)!;

export function float32Program() {
  const k = new Lang(LIBRARY.code);
  const f32 = (x: Id) => k.call(lib("as float32"), x);
  const ok = (e: Id, or: Id) => k.call(S.first, k.thunk(() => e), k.thunk(() => or));
  // [as float32(i / 7) for i from i to n]
  const from = k.def("sevenths from");
  k.define(from, k.fn(["i", "n"], (i, m) => k.if(k.call(INT_OPS.less, i, m),
    k.call(CONS, f32(ok(k.call(DIVIDE, k.call(INT_OPS.toNumber, i), k.lit(7)), k.lit(0))), k.call(from, k.call(INT_OPS.add, i, k.int(1)), m)),
    k.x(NIL))));
  const sum = k.def("sum");
  k.define(sum, k.fn(["xs", "acc"], (xs, acc) => k.match(xs, [
    { variant: NIL, names: [], body: () => acc },
    { variant: CONS, names: ["x", "rest"], body: ([x, rest]) => k.call(sum, rest, ok(k.call(ARITH.add, acc, x), acc)) }])));
  const show = (e: Id) => k.call(S.print, k.call(SHOW_ANY, e));
  const main = k.def("main");
  k.define(main, k.thunk(() => k.let("a", k.call(ARRAY_OPS.of, k.call(from, k.int(0), k.int(40))), (a) => k.seq(
    show(k.call(sum, k.call(ARRAY_OPS.items, a), f32(k.lit(0)))),
    show(k.call(ARRAY_OPS.items, k.call(ARRAY_OPS.replaceAt, a, k.int(3), f32(k.lit(0.1))))),
    show(k.call(ARRAY_OPS.items, k.call(ARRAY_OPS.push, a, f32(k.lit(1e30))))),
    show(ok(k.call(ARRAY_OPS.at, a, k.int(39)), f32(k.lit(-1)))),
    show(ok(k.call(lib("square root float32"), k.call(ARRAY_OPS.at, a, k.int(5))), f32(k.lit(-1)))),
    show(k.call(ARRAY_OPS.length, a))))));
  const code = base(k.code), names = baseNames(k.names);
  return { code, names, info: infer(code, names), main };
}

test("C keeps a Float32 as a float, an array of them four bytes a slot, as the evaluator computes (C309)", { skip }, () => {
  const p = float32Program();
  assert.deepEqual(p.info.errors.map((e) => e.message), []);
  const want: string[] = [];
  runMain(p.code, p.info, p.main, { print: (l) => want.push(l), names: p.names });
  const l = lowerScalar(p.code, p.info, p.names, [p.main], { data: true });
  assert.deepEqual([...l.refused.values()], []);
  const c = emitC(l, { main: p.main }).c;
  assert.match(c, /typedef struct \{ float f0; \}/);
  const r = spawnSync(compile(c), []);
  assert.equal(r.status, 0, r.stderr.toString());
  assert.deepEqual(r.stdout.toString().split("\n").filter((x) => x), want);
});
