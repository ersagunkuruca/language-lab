// C255: a pure call with every input written down is worked out while
// compiling, and its answer written in, when the answer is small next to the
// work (bake.ts). A big answer built from little work stays code.

import { test } from "node:test";
import assert from "node:assert/strict";
import { Lang } from "../../ters/src/lang/dsl.ts";
import { base, baseNames } from "../../ters/src/lang/load.ts";
import { infer } from "../../ters/src/lang/infer.ts";
import { runProgram } from "../../ters/src/lang/run.ts";
import { CONS, INT_OPS, NIL, S, SHOW_ANY } from "../../ters/src/lang/std-ids.ts";
import type { Id, NodeOf } from "../../ters/src/model.ts";
import { bakeCalls } from "../src/bake.ts";
import { lowerScalar, reachedWithShows } from "../src/scalar.ts";
import { emitWasm, runMain } from "../src/wasm.ts";

function program() {
  const k = new Lang();
  // The sum of i·i for i from i to n, by recursion: work, and one number.
  const squares = k.def("sum of squares");
  k.define(squares, k.fn(["i", "n"], (i, n) => k.if(k.call(INT_OPS.less, n, i), k.int(0),
    k.call(INT_OPS.add, k.call(INT_OPS.mul, i, i), k.call(squares, k.call(INT_OPS.add, i, k.int(1)), n)))));
  // The numbers from i to n: as big as the work that makes it.
  const upto = k.def("upto");
  k.define(upto, k.fn(["i", "n"], (i, n) => k.if(k.call(INT_OPS.less, n, i), k.x(NIL),
    k.call(CONS, i, k.call(upto, k.call(INT_OPS.add, i, k.int(1)), n)))));
  const show = (e: Id) => k.call(S.print, k.call(SHOW_ANY, e));
  const main = k.def("main");
  const worked = k.call(squares, k.int(1), k.int(300)), table = k.call(upto, k.int(1), k.int(300));
  k.define(main, k.thunk(() => k.seq(show(worked), show(table))));
  const code = base(k.code), names = { ...baseNames(), ...k.names };
  return { code, names, info: infer(code, names), main, worked, table };
}

test("a call worked out while compiling: its answer written in, a big table left as code", () => {
  const p = program();
  assert.deepEqual(p.info.errors.map((e) => e.message), []);
  const b = bakeCalls(reachedWithShows(p.code, [p.main], p.info), p.info, p.names);
  assert.deepEqual(b.baked, [p.worked]);
  const n = b.code.nodes[p.worked] as NodeOf<"lit">;
  assert.equal(n.kind, "lit");
  assert.equal(n.value, (300 * 301 * 601) / 6);
  assert.equal(b.code.nodes[p.table], p.code.nodes[p.table]);
});

test("compiled with it, the program prints what the evaluator prints", async () => {
  const p = program();
  const out: string[] = [];
  runProgram(p.code, p.info, p.main, [], { print: (l) => out.push(l), names: p.names });
  const ir = lowerScalar(p.code, p.info, p.names, [p.main], { data: true });
  const got: string[] = [];
  await runMain(ir, emitWasm(ir), "main", [], { print: (l: string) => got.push(l) });
  assert.deepEqual(got, out);
  assert.equal(out[0], "9045050");
});
