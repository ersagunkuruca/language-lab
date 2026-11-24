// A page's step budget, compiled (I291, the countdown page): a step only
// where `with fuel` would spend one, the calls into a definition the
// checker can't see end, and none inside a `with fuel`, which counts its
// own. Before, each continuation of countdown's search took a step too
// (3.47M where the evaluator takes 442k), and so did every call under the
// page's `with fuel`, so the page said "didn't finish".

import { test } from "node:test";
import assert from "node:assert/strict";
import { load } from "../src/program.ts";
import { Lang } from "../../ters/src/lang/dsl.ts";
import { infer } from "../../ters/src/lang/infer.ts";
import { LIBRARY } from "../../ters/src/lang/library.ts";
import { counted, makeRunner } from "../../ters/src/lang/run.ts";
import { ARITH, S } from "../../ters/src/lang/std.ts";
import { merge } from "../../ters/src/model.ts";
import { loadCoreJs, lowerCore } from "../src/core-js.ts";

const L = (name: string) => LIBRARY.modules[0].exports.find((d) => LIBRARY.names[d] === name)!;

test("countdown's search spends about the evaluator's page steps compiled, and none under with fuel (I291)", () => {
  const p = load("countdown");
  const k = new Lang(p.code);
  // A smaller round than the page's, so the evaluator is quick.
  const solved = () => k.call(L("length"), k.call(p.named("solutions"), k.list(...[1, 3, 7, 10, 25].map((x) => k.lit(x))), k.lit(100)));
  const bare = k.def("bare"), fueled = k.def("fueled");
  k.define(bare, k.fn(["u"], () => solved()));
  k.define(fueled, k.fn(["u"], () => k.call(L("sum"), k.call(S.all, k.thunk(() => k.call(S.fuel, k.lit(16000000), k.thunk(solved)))))));
  const code = merge(k.code, p.code), names = { ...p.pres.names, ...k.names };
  const info = infer(code, names, undefined, p.options);
  assert.deepEqual(info.errors.map((e) => e.message), []);
  const r = makeRunner(code, info, { print: () => {}, names });
  const ir = lowerCore(code, info, names, [bare, fueled]);
  assert.deepEqual([...ir.refused.values()], []);
  const fns = loadCoreJs(ir), fn = (n: string) => fns[ir.funcs.findIndex((f) => f.name === n && !f.inner)];
  const steps = (f: () => unknown) => { const used = { n: 0 }; const v = counted(1e9, f, used); return { v, n: used.n }; };
  const ev = steps(() => { for (const v of r.call(r.value(bare), 0)) return v; });
  const js = steps(() => fn("bare")(0));
  assert.equal(js.v, ev.v);
  assert.ok(ev.n > 1000, `${ev.n}`);
  // Every call of `results`: 18,120, as the search written out by hand
  // makes them, the evaluator too since I293 (a call made again for each
  // choice in its inputs spends each time; it counted 17,795).
  assert.equal(js.n, 18120);
  assert.equal(ev.n, 18120);
  const under = steps(() => fn("fueled")(0));
  assert.deepEqual(under, { v: ev.v, n: 0 });
});

// C303: a count down guarded by ≤ (`if n ≤ 0 then acc else …(n − 1)`)
// surely ends where its count is an Int: the checker reads ≤, > and ≥ as
// the < they are (counting.ts). Generic, the definition may not finish (a
// Float64 count can stop moving); compiled where every call counts an
// Int, it spends no page step. mnist-page's `dot` spent a page's million
// steps a frame.
test("a generic count down by ≤ compiled with an Int count spends no page steps (C303)", () => {
  const k = new Lang(LIBRARY.code);
  const cd = k.def("count down"), use = k.def("use");
  k.define(cd, k.fn(["n", "acc"], (n, acc) => k.if(k.call(L("at most"), n, k.lit(0)), acc, k.call(cd, k.call(ARITH.sub, n, k.lit(1)), k.call(ARITH.add, acc, k.lit(2))))));
  k.define(use, k.fn(["u"], () => k.call(cd, k.int(300000), k.int(0))));
  const code = merge(k.code, LIBRARY.code), names = { ...LIBRARY.names, ...k.names };
  const info = infer(code, names);
  assert.deepEqual(info.errors.map((e) => e.message), []);
  assert.ok(info.divergent.has(cd), "the checker can't see a generic count end");
  const ir = lowerCore(code, info, names, [use]);
  const fns = loadCoreJs(ir), fn = (n: string) => fns[ir.funcs.findIndex((f) => f.name === n && !f.inner)];
  const used = { n: 0 };
  assert.equal(Number(counted(1e9, () => fn("use")(0), used)), 600000);
  assert.equal(used.n, 0);
});
