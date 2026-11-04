// A stop in compiled code knows where it is (C143): the core IR's
// JavaScript throws Stopped, and WebAssembly's host its Abort, with the
// node the stop was lowered from and its definition; C says the reason as
// before. Here an overflow used by show.

import { test } from "node:test";
import assert from "node:assert/strict";
import { Lang } from "../../ters/src/lang/dsl.ts";
import { infer } from "../../ters/src/lang/infer.ts";
import { base, baseNames, checkOptions } from "../../ters/src/lang/load.ts";
import { S } from "../../ters/src/lang/std.ts";
import { B } from "../../ters/src/prelude.ts";
import { lowerScalar } from "../src/scalar.ts";
import { loadCoreJs, lowerCore, Stopped } from "../src/core-js.ts";
import { emitWasm, instantiate } from "../src/wasm.ts";
import { build, skip } from "./c-harness.ts";

function program() {
  const k = new Lang();
  const big = k.def("grow");
  let shown = "";
  k.define(big, k.fn(["x"], (x) => (shown = k.call(S.show, k.call(B.mul, k.call(B.mul, x, k.lit(1e300)), k.lit(1e300))))));
  const code = base(k.code), names = { ...baseNames(), ...k.names }, info = infer(code, names, undefined, checkOptions);
  return { code, names, info, big, shown };
}

test("a stop says the node and definition it came from, on the core IR's JavaScript and WebAssembly (C143)", async () => {
  const p = program();
  assert.deepEqual(p.info.errors.map((e) => e.message), []);
  const core = lowerCore(p.code, p.info, p.names, [p.big]);
  const f = loadCoreJs(core)[core.funcs.findIndex((g) => g.def === p.big && !g.inner)];
  assert.equal(f(1e-300), "1e+300");
  assert.throws(() => f(1e10), (e: unknown) => e instanceof Stopped && e.message === "the answer is too big for a Float64 (overflow)" && e.def === p.big && e.node === p.shown);
  const lowered = lowerScalar(p.code, p.info, p.names, [p.big], { data: true });
  const w = (await instantiate(emitWasm(lowered))) as unknown as Record<string, (x: number) => unknown>;
  const name = lowered.funcs.find((g) => g.def === p.big)!.name;
  assert.throws(() => w[name](1e10), (e: unknown) => (e as Error & { reason: string }).reason === "the answer is too big for a Float64 (overflow)" && (e as { def?: string }).def === p.big && (e as { node?: string }).node === p.shown);
});

test("C says the reason of a stop with a site as before (C143)", { skip }, () => {
  const p = program();
  const lowered = lowerScalar(p.code, p.info, p.names, [p.big], { data: true });
  const at = lowered.funcs.findIndex((g) => g.def === p.big);
  assert.deepEqual(build(lowered)([[at, [1e10]]])[0].value, { aborted: "the answer is too big for a Float64 (overflow)" });
});
