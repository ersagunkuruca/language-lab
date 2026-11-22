// Arrays as versions in WebAssembly (C285, as compiled JS keeps them): a
// replace that owned-arrays.ts can't make in place writes the slot and
// leaves the array it was given a note, and reading an older array puts
// its slots back first, in place when no other view shares the buffer and
// in a copy of its own when one does. Every way the older and newer
// arrays are read, after one replace, a branch of two, a rest and a push
// into the room, and a chain of thousands, is the evaluator's.

import { test } from "node:test";
import assert from "node:assert/strict";
import { Lang } from "../../ters/src/lang/dsl.ts";
import { base, baseNames } from "../../ters/src/lang/load.ts";
import { infer } from "../../ters/src/lang/infer.ts";
import { runMain } from "../../ters/src/lang/run.ts";
import { ARRAY_OPS, CONS, INT_OPS, NIL, S, SHOW_ANY } from "../../ters/src/lang/std.ts";
import type { Id } from "../../ters/src/model.ts";
import { lowerScalar } from "../src/scalar.ts";
import { emitWasm, runMain as runWasm } from "../src/wasm.ts";

function program(n: number) {
  const k = new Lang();
  const upTo = k.def("up to");
  k.define(upTo, k.fn(["i", "n"], (i, m) => k.if(k.call(INT_OPS.less, i, m), k.call(CONS, i, k.call(upTo, k.call(INT_OPS.add, i, k.int(1)), m)), k.x(NIL))));
  // Each slot from i on doubled, one replace at a time.
  const doubled = k.def("doubled from");
  k.define(doubled, k.fn(["a", "i"], (a, i) => k.if(k.call(INT_OPS.less, i, k.call(ARRAY_OPS.length, a)),
    k.call(doubled, k.call(ARRAY_OPS.replaceAt, a, i, k.call(INT_OPS.mul, i, k.int(2))), k.call(INT_OPS.add, i, k.int(1))), a)));
  const sum = k.def("sum");
  k.define(sum, k.fn(["xs", "acc"], (xs, acc) => k.match(xs, [
    { variant: NIL, names: [], body: () => acc },
    { variant: CONS, names: ["x", "rest"], body: ([x, rest]) => k.call(sum, rest, k.call(INT_OPS.add, acc, x)) }])));
  const show = (e: Id) => k.call(S.print, k.call(SHOW_ANY, e));
  const items = (e: Id) => show(k.call(ARRAY_OPS.items, e));
  const total = (e: Id) => show(k.call(sum, k.call(ARRAY_OPS.items, e), k.int(0)));
  const main = k.def("main");
  k.define(main, k.thunk(() => k.let("a", k.call(ARRAY_OPS.of, k.call(upTo, k.int(0), k.int(8))), (a) =>
    k.let("b", k.call(ARRAY_OPS.replaceAt, a, k.int(3), k.int(100)), (b) =>
      k.let("c", k.call(ARRAY_OPS.replaceAt, b, k.int(4), k.int(200)), (c) =>
        k.let("d", k.call(ARRAY_OPS.replaceAt, b, k.int(5), k.int(300)), (d) =>
          k.let("e", k.call(ARRAY_OPS.replaceAt, a, k.int(0), k.int(7)), (e) =>
            k.let("r", k.call(ARRAY_OPS.rest, e), (r) =>
              k.let("p", k.call(ARRAY_OPS.push, e, k.int(9)), (p) =>
                k.let("big", k.call(ARRAY_OPS.of, k.call(upTo, k.int(0), k.int(n))), (big) =>
                  k.let("twice", k.call(doubled, big, k.int(0)), (twice) => k.seq(
                    items(c), items(a), items(d), items(b), items(c),
                    items(r), items(p), items(a), items(e), items(r), items(p), items(d),
                    total(twice), total(big), total(twice), total(big)))))))))))));
  const code = base(k.code), names = baseNames(k.names);
  return { code, names, info: infer(code, names), main };
}

test("WebAssembly's arrays are versions: every older and newer array reads as the evaluator's", async () => {
  const p = program(3000);
  assert.deepEqual(p.info.errors.map((e) => e.message), []);
  const want: string[] = [];
  runMain(p.code, p.info, p.main, { print: (l) => want.push(l), names: p.names });
  const l = lowerScalar(p.code, p.info, p.names, [p.main], { data: true });
  assert.deepEqual([...l.refused.values()], []);
  const m = emitWasm(l);
  // The replace leaves a note, and older arrays read through array.cur.
  assert.match(m.wat, /struct\.new \$note\b/);
  assert.match(m.wat, /call \$array\.cur\.a\d+/);
  const got: string[] = [];
  assert.equal(await runWasm(l, m, "main", [], { print: (x: string) => got.push(x) }), 0);
  assert.deepEqual(got, want);
});
