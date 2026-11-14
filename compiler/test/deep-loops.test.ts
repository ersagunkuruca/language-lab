// C222: functions going down a list stored as an array item by item, not
// in tail position, are loops on WebAssembly, whose stack holds some
// thousands of frames (trek at 10,000 fixes, GAPS.md round 16 R3):
// building a list from the front (`cons(x, f(more))`) and `x and
// f(more)` carry what they have so far (cons-loops.ts); anything else
// worked out on the way back up keeps its frames on the heap
// (deep-loops.ts). A hundred thousand items deep, with the answers the
// functions give as written.

import { test } from "node:test";
import assert from "node:assert/strict";
import { B } from "../../ters/src/prelude.ts";
import { Lang } from "../../ters/src/lang/dsl.ts";
import { infer } from "../../ters/src/lang/infer.ts";
import { base, baseNames, checkOptions } from "../../ters/src/lang/load.ts";
import { LIBRARY } from "../../ters/src/lang/library.ts";
import { withLibraryRepresentations } from "../../ters/src/lang/library-reps.ts";
import { CONS, FALSE, NIL, S, TRUE } from "../../ters/src/lang/std.ts";
import { lowerScalar, type CoreIR } from "../src/scalar.ts";
import { consLoops } from "../src/cons-loops.ts";
import { deepLoops } from "../src/deep-loops.ts";
import { emitWasm, instantiate } from "../src/wasm.ts";

const L = (name: string) => LIBRARY.modules[0].exports.find((d) => LIBRARY.names[d] === name)!;

// bumped(ys): each item one more, consed. ascending(ys): each item less
// than the next, by `and`. anyAbove(ys, m): an item more than m, by `or`.
// weighted(i, ys): the sum of each item times its place, added on the
// way back up. run(n): all four on 0, 1, …, n − 1.
function program() {
  const k = new Lang(LIBRARY.code);
  const bumped = k.def("bumped"), ascending = k.def("ascending"), anyAbove = k.def("any above"), weighted = k.def("weighted"), run = k.def("run");
  k.define(bumped, k.fn(["ys"], (ys) => k.match(ys, [
    { variant: NIL, names: [], body: () => k.x(NIL) },
    { variant: CONS, names: ["y", "more"], body: ([y, more]) => k.call(CONS, k.call(B.add, y, k.lit(1)), k.call(bumped, more)) },
  ])));
  k.define(ascending, k.fn(["ys"], (ys) => k.match(ys, [
    { variant: NIL, names: [], body: () => k.x(TRUE) },
    { variant: CONS, names: ["y", "more"], body: ([y, more]) => k.match(more, [
      { variant: NIL, names: [], body: () => k.x(TRUE) },
      { variant: CONS, names: ["z", "rest"], body: ([z]) => k.call(S.and, k.call(S.less, y, z), k.call(ascending, more)) },
    ]) },
  ])));
  k.define(anyAbove, k.fn(["ys", "m"], (ys, m) => k.match(ys, [
    { variant: NIL, names: [], body: () => k.x(FALSE) },
    { variant: CONS, names: ["y", "more"], body: ([y, more]) => k.call(S.or, k.call(S.less, m, y), k.call(anyAbove, more, m)) },
  ])));
  k.define(weighted, k.fn(["i", "ys"], (i, ys) => k.match(ys, [
    { variant: NIL, names: [], body: () => k.lit(0) },
    { variant: CONS, names: ["y", "more"], body: ([y, more]) => k.let("r", k.call(weighted, k.call(B.add, i, k.lit(1)), more), (r) => k.call(B.add, r, k.call(B.mul, i, y))) },
  ])));
  // Read by position too, so the lists are arrays.
  k.define(run, k.fn(["n"], (n) => k.let("ys", k.call(L("map"), k.call(S.range, n), k.fn(["j"], (j) => k.call(B.add, j, k.lit(0)))), (ys) =>
    k.call(B.add, k.call(weighted, k.lit(0), k.call(bumped, ys)), k.call(B.add, k.if(k.call(ascending, ys), k.lit(1), k.lit(0)),
      k.call(B.add, k.if(k.call(anyAbove, ys, k.call(B.sub, n, k.lit(2))), k.lit(10), k.lit(0)), k.call(L("item at"), ys, k.int(3), k.lit(-1))))))));
  const code = base(k.code), names = baseNames(k.names);
  const info = infer(code, names, undefined, checkOptions);
  assert.deepEqual(info.errors.map((e) => e.message), []);
  const c = withLibraryRepresentations(code, info, names, run, [bumped, ascending, anyAbove, weighted, run]);
  assert.deepEqual(c.chosen, ["List as array of List"]);
  const info2 = infer(c.code, c.names, undefined, { ...checkOptions, insiders: [...checkOptions.insiders!, ...c.insiders] });
  return { lower: () => lowerScalar(c.code, info2, c.names, [run], { data: true }), run };
}

// Σ j(j + 1) for j < n, ascending, an item above n − 2, the item at 3.
const want = (n: number) => { let s = 0; for (let j = 0; j < n; j++) s += j * (j + 1); return s + 1 + (n > 0 ? 10 : 0) + (n > 3 ? 3 : -1); };

test("lists as arrays a hundred thousand items deep on WebAssembly: consing, and, or, and the way back up are loops (C222)", async () => {
  const p = program();
  const call = async (ir: CoreIR) => {
    assert.deepEqual([...ir.refused.values()], []);
    const w = (await instantiate(emitWasm(ir))) as unknown as Record<string, (x: number) => number>;
    const f = ir.funcs.find((g) => g.def === p.run && !g.inner)!;
    return (n: number) => w[f.name](n);
  };
  // As lowered, the stack runs out.
  const plain = await call(p.lower());
  assert.equal(plain(5), want(5));
  assert.throws(() => plain(100_000), RangeError);
  const ir = p.lower();
  assert.equal(consLoops(ir), 3, "bumped, ascending, any above");
  assert.equal(deepLoops(ir), 1, "weighted");
  const looped = await call(ir);
  for (const n of [0, 1, 2, 5, 3000, 100_000]) assert.equal(looped(n), want(n), `n = ${n}`);
});
