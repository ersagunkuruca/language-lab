// An array made from a mapped range is filled where it is made (L271c,
// fill-arrays.ts): `array of(map(range(n), f))`, and the same after a
// written list, `array of(append(xs, map(range(n), f)))`, are one loop
// pushing into the array, with no list of the range or of its images.
// On the core IR's JavaScript, WebAssembly and C they give what the
// evaluator does.

import { test } from "node:test";
import assert from "node:assert/strict";
import type { Id } from "../../ters/src/model.ts";
import { Lang } from "../../ters/src/lang/dsl.ts";
import { infer } from "../../ters/src/lang/infer.ts";
import { base, baseNames } from "../../ters/src/lang/load.ts";
import { LIBRARY } from "../../ters/src/lang/library.ts";
import { makeRunner, type Value } from "../../ters/src/lang/run.ts";
import { PRELUDE_DEFS } from "../../ters/src/lang/prelude-ids.ts";
import { ARRAY_OPS, INT_OPS } from "../../ters/src/lang/std.ts";
import { kids, lowerScalar, type SExpr } from "../src/scalar.ts";
import { loadCoreJs, lowerCore } from "../src/core-js.ts";
import { emitWasm, instantiate } from "../src/wasm.ts";
import { emitC } from "../src/c.ts";
import { build, skip as noC } from "./c-harness.ts";

const sum = LIBRARY.modules.flatMap((m) => m.exports).find((d) => LIBRARY.names[d] === "sum")!;

// squares(n): the sum of an array of the first n squares; joined(n): of
// 7, 8 and then 1 to n.
function program() {
  const k = new Lang(LIBRARY.code);
  const squares = k.def("squares"), joined = k.def("joined");
  const summed = (a: Id) => k.call(sum, k.call(ARRAY_OPS.items, a));
  k.define(squares, k.fn(["n"], (n) => summed(k.call(ARRAY_OPS.of, k.call(PRELUDE_DEFS["map"], k.call(INT_OPS.range, n), k.fn(["x"], (x) => k.call(INT_OPS.mul, x, x)))))));
  k.define(joined, k.fn(["n"], (n) => summed(k.call(ARRAY_OPS.of, k.call(PRELUDE_DEFS["append"], k.listOf(k.int(7), k.int(8)),
    k.call(PRELUDE_DEFS["map"], k.call(INT_OPS.range, n), k.fn(["x"], (x) => k.call(INT_OPS.add, x, k.int(1)))))))));
  const code = base(k.code), names = baseNames(k.names);
  const info = infer(code, names);
  assert.deepEqual(info.errors.map((e) => e.message), []);
  return { code, names, info, squares, joined };
}

test("an array of a mapped range is filled with no list, and gives what the evaluator does (L271c)", async () => {
  const p = program();
  const r = makeRunner(p.code, p.info, { print: () => {}, names: p.names });
  const ev = (d: Id, x: number) => { for (const v of r.call(r.value(d), x)) return v as Value; };
  const core = lowerCore(p.code, p.info, p.names, [p.squares, p.joined]);
  const all = (e: SExpr): SExpr[] => [e, ...kids(e).flatMap(all)];
  assert.ok(core.funcs.some((f) => f.name === "filled"), "a fill loop made");
  for (const d of [p.squares, p.joined]) {
    const f = core.funcs.find((g) => g.def === d && !g.inner)!;
    assert.ok(!all(f.body).some((e) => e.k === "rt" && (e.fn === "int.range" || /^array\.of\./.test(e.fn))), `${p.names[d]} makes no list`);
  }
  const fs = loadCoreJs(core);
  const at = (d: Id) => core.funcs.findIndex((f) => f.def === d && !f.inner);
  for (const n of [0, 1, 5, 300]) {
    assert.equal(fs[at(p.squares)](n), ev(p.squares, n), `squares ${n}`);
    assert.equal(fs[at(p.joined)](n), ev(p.joined, n), `joined ${n}`);
  }
  const lowered = lowerScalar(p.code, p.info, p.names, [p.squares, p.joined], { data: true });
  assert.deepEqual([...lowered.refused.entries()], []);
  const w = await instantiate(emitWasm(lowered)) as unknown as Record<string, (...xs: unknown[]) => unknown>;
  const fq = lowered.funcs.find((f) => f.def === p.squares)!, fj = lowered.funcs.find((f) => f.def === p.joined)!;
  assert.equal(w[fq.name](300), ev(p.squares, 300));
  assert.equal(w[fj.name](300), ev(p.joined, 300));
  if (!noC) {
    assert.deepEqual([...emitC(lowered).refused.entries()], []);
    const got = build(lowered)([[lowered.funcs.indexOf(fq), [300]], [lowered.funcs.indexOf(fj), [300]]]);
    assert.deepEqual(got.map((g) => g.value), [ev(p.squares, 300), ev(p.joined, 300)]);
  }
});
