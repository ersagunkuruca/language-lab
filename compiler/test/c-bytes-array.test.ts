// A byte a slot in C (L189f2, as std.ts does it for JavaScript, L189f1):
// an array of 16 or more Ints all from 0 to 255 is kept as bytes, and is
// the same array as one kept an Int a slot: an item that isn't a byte
// copies it wide, a push copies it when shared, older versions stay.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { Lang } from "../../ters/src/lang/dsl.ts";
import { base, baseNames } from "../../ters/src/lang/load.ts";
import { infer } from "../../ters/src/lang/infer.ts";
import { runMain } from "../../ters/src/lang/run.ts";
import { ARRAY_OPS, CONS, INT_OPS, NIL, S, SHOW_ANY } from "../../ters/src/lang/std.ts";
import type { Id } from "../../ters/src/model.ts";
import { lowerScalar } from "../src/scalar.ts";
import { emitC } from "../src/c.ts";
import { compile, skip } from "./c-harness.ts";

function program(n: number) {
  const k = new Lang();
  // [i·13 and 255 for i from i to n]
  const from = k.def("bytes from");
  k.define(from, k.fn(["i", "n"], (i, m) => k.if(k.call(INT_OPS.less, i, m),
    k.call(CONS, k.call(INT_OPS.bitAnd, k.call(INT_OPS.mul, i, k.int(13)), k.int(255)), k.call(from, k.call(INT_OPS.add, i, k.int(1)), m)),
    k.x(NIL))));
  const sum = k.def("sum");
  k.define(sum, k.fn(["xs", "acc"], (xs, acc) => k.match(xs, [
    { variant: NIL, names: [], body: () => acc },
    { variant: CONS, names: ["x", "rest"], body: ([x, rest]) => k.call(sum, rest, k.call(INT_OPS.add, acc, x)) }])));
  const show = (e: Id) => k.call(S.print, k.call(SHOW_ANY, e));
  const main = k.def("main");
  k.define(main, k.thunk(() => k.let("a", k.call(ARRAY_OPS.of, k.call(from, k.int(0), k.int(n))), (a) => k.seq(
    show(k.call(sum, k.call(ARRAY_OPS.items, a), k.int(0))),
    show(k.call(ARRAY_OPS.items, k.call(ARRAY_OPS.replaceAt, a, k.int(3), k.int(1000)))),
    show(k.call(ARRAY_OPS.items, k.call(ARRAY_OPS.replaceAt, a, k.int(0), k.int(5)))),
    show(k.call(ARRAY_OPS.items, k.call(ARRAY_OPS.push, a, k.int(300)))),
    show(k.call(ARRAY_OPS.items, k.call(ARRAY_OPS.pushFront, a, k.int(7)))),
    show(k.call(ARRAY_OPS.items, k.call(ARRAY_OPS.push, k.call(ARRAY_OPS.pushFront, a, k.int(9)), k.int(-4)))),
    show(k.call(S.first, k.thunk(() => k.call(ARRAY_OPS.at, a, k.int(n - 1))), k.thunk(() => k.int(-1)))),
    show(k.call(ARRAY_OPS.length, a)),
    show(k.call(ARRAY_OPS.items, a))))));
  const code = base(k.code), names = baseNames(k.names);
  return { code, names, info: infer(code, names), main };
}

test("C keeps an array of bytes a byte a slot, the same array as the evaluator's when changed", { skip }, () => {
  for (const n of [20, 15]) {
    const p = program(n);
    assert.deepEqual(p.info.errors.map((e) => e.message), []);
    const want: string[] = [];
    runMain(p.code, p.info, p.main, { print: (l) => want.push(l), names: p.names });
    const l = lowerScalar(p.code, p.info, p.names, [p.main], { data: true });
    assert.deepEqual([...l.refused.values()], []);
    const c = emitC(l, { main: p.main }).c;
    assert.match(c, /uint8_t bytes;/);
    const r = spawnSync(compile(c), []);
    assert.equal(r.status, 0, r.stderr.toString());
    assert.deepEqual(r.stdout.toString().split("\n").filter((x) => x), want, String(n));
  }
});
