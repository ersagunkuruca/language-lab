// Deep recursion that isn't a tail call on the core IR's JavaScript
// (C137c18): past a thousand calls deep a function in such a cycle runs
// its copy on the heap (core-js.ts), so a list as long as memory allows is
// summed by `x + sum(rest)`, as the evaluator sums it.

import { test } from "node:test";
import assert from "node:assert/strict";
import { Lang } from "../../ters/src/lang/dsl.ts";
import { infer } from "../../ters/src/lang/infer.ts";
import { base, baseNames } from "../../ters/src/lang/load.ts";
import { LIBRARY } from "../../ters/src/lang/library.ts";
import { makeRunner, type Value } from "../../ters/src/lang/run.ts";
import { ABORT_OP, CONS, NIL, S } from "../../ters/src/lang/std.ts";
import { B } from "../../ters/src/prelude.ts";
import { emitCoreJs, loadCoreJs, lowerCore } from "../src/core-js.ts";

const sum = LIBRARY.modules.flatMap((m) => m.exports).find((d) => LIBRARY.names[d] === "sum")!;

// total(n): the library's sum of 1..n. down(n): n + down(n − 1), through
// a second function (a cycle of two). guarded(n): down's shape, aborting
// at the bottom, caught at the top; then a shallow call after it.
function program() {
  const k = new Lang(LIBRARY.code);
  const total = k.def("total"), upTo = k.def("up to"), down = k.def("down"), step = k.def("step"), guarded = k.def("guarded"), deepAbort = k.def("deep abort");
  k.define(upTo, k.fn(["n", "acc"], (n, acc) => k.if(k.call(S.less, n, k.lit(1)), acc, k.call(upTo, k.call(B.sub, n, k.lit(1)), k.call(CONS, n, acc)))));
  k.define(total, k.fn(["n"], (n) => k.call(sum, k.call(upTo, n, NIL))));
  k.define(down, k.fn(["n"], (n) => k.if(k.call(S.less, n, k.lit(1)), k.lit(0), k.call(step, n))));
  k.define(step, k.fn(["n"], (n) => k.call(B.add, n, k.call(down, k.call(B.sub, n, k.lit(1))))));
  k.define(deepAbort, k.fn(["n"], (n) => k.if(k.call(S.less, n, k.lit(1)), k.call(ABORT_OP, k.lit("bottom")), k.call(B.add, k.lit(1), k.call(deepAbort, k.call(B.sub, n, k.lit(1)))))));
  k.define(guarded, k.fn(["n"], (n) => k.handle(k.call(S.show, k.call(deepAbort, n)), [{ variant: ABORT_OP, names: ["why"], body: ([why]) => k.call(S.concat, why, k.call(S.show, k.call(down, k.lit(3)))) }])));
  const code = base(k.code), names = baseNames(k.names), info = infer(code, names);
  assert.deepEqual(info.errors.map((e) => e.message), []);
  return { code, names, info, defs: { total, down, guarded } };
}

test("x + sum(rest) a hundred thousand deep on the core IR's JavaScript, as the evaluator", () => {
  const p = program();
  const r = makeRunner(p.code, p.info, { print: () => {}, names: p.names });
  const ev = (d: string, x: number) => { for (const v of r.call(r.value(d), x)) return v as Value; };
  const roots = Object.values(p.defs);
  const core = lowerCore(p.code, p.info, p.names, roots);
  assert.deepEqual([...core.refused.entries()], []);
  assert.match(emitCoreJs(core).js, /R\.drive/);
  const fs = loadCoreJs(core);
  const at = (d: string) => fs[core.funcs.findIndex((f) => f.def === d && !f.inner)];
  for (const n of [0, 5, 3000]) assert.equal(at(p.defs.total)(n), ev(p.defs.total, n), `total ${n}`);
  assert.equal(at(p.defs.total)(100_000), 100_000 * 100_001 / 2);
  for (const n of [0, 7, 2500, 100_000]) assert.equal(at(p.defs.down)(n), n * (n + 1) / 2, `down ${n}`);
  for (const n of [0, 4, 2500]) assert.equal(at(p.defs.guarded)(n), ev(p.defs.guarded, n), `guarded ${n}`);
  // Caught a hundred thousand deep, and the calls after start shallow again.
  for (let i = 0; i < 3; i++) assert.equal(at(p.defs.guarded)(100_000), "bottom6");
  assert.equal(at(p.defs.down)(10), 55);
});

// A big frame (C339): wide(n, x) holds 120 locals and calls itself after
// making them, 1100 deep. Under the thousand plain calls it ran out of
// Node's stack (housefit's pass back, 88 locals); a big frame counts for
// more toward the thousand.
test("a recursion with a big frame goes to the heap before the stack runs out", () => {
  const k = new Lang(LIBRARY.code);
  const wide = k.def("wide"), K = 120;
  k.define(wide, k.fn(["n", "x"], (n, x) => {
    const vs: string[] = [];
    const lets = (i: number): string => {
      if (i === K) {
        const sum = vs.map((v, j) => k.call(B.mul, v, vs[(j * 7) % K])).reduce((a, b) => k.call(B.add, a, b));
        return k.if(k.call(S.less, n, k.lit(1)), x, k.call(B.add, k.call(wide, k.call(B.sub, n, k.lit(1)), k.call(B.add, x, k.lit(1))), sum));
      }
      return k.let(`v${i}`, k.call(B.add, k.call(B.mul, x, k.lit(i + 2)), n), (v) => (vs.push(v), lets(i + 1)));
    };
    return lets(0);
  }));
  const code = base(k.code), names = baseNames(k.names), info = infer(code, names);
  assert.deepEqual(info.errors.map((e) => e.message), []);
  const core = lowerCore(code, info, names, [wide]);
  assert.deepEqual([...core.refused.entries()], []);
  assert.match(emitCoreJs(core).js, /depth \+= \d+/);
  const at = loadCoreJs(core)[core.funcs.findIndex((f) => f.def === wide && !f.inner)];
  const expect = (n: number, x: number): number => { let r = x + n; for (let m = 1; m <= n; m++) { const xm = x + n - m, v = (i: number) => xm * (i + 2) + m; let s = 0; for (let j = 0; j < K; j++) s += v(j) * v((j * 7) % K); r += s; } return r; };
  for (const n of [0, 3, 1100]) assert.equal(Number(at(n, 1)), expect(n, 1), `wide ${n}`);
});
