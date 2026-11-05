// std's number types show through the prelude's own Shown (C139a), not
// cases of theirs named in scalar.ts: Rational, Complex and Fixed show as
// the evaluator shows them, in the core IR's JavaScript, WebAssembly and
// C. Fixed was refused on WebAssembly and C before.

import { test } from "node:test";
import assert from "node:assert/strict";
import { load } from "../src/program.ts";
import { lowerScalar } from "../src/scalar.ts";
import { emitWasm, instantiate, fromText } from "../src/wasm.ts";
import { lowerCore, loadCoreJs } from "../src/core-js.ts";
import { build, skip } from "./c-harness.ts";
import { Lang } from "../../ters/src/lang/dsl.ts";
import { infer } from "../../ters/src/lang/infer.ts";
import { makeRunner, type Value } from "../../ters/src/lang/run.ts";
import { merge, type Id } from "../../ters/src/model.ts";
import { CONS, NIL, COMPLEX_V, FIXED_V, SHOW_ANY } from "../../ters/src/lang/std.ts";

const p = load("sort");
const named = (n: string) => Object.entries(p.pres.names).find(([id, x]) => x === n && p.code.nodes[id]?.kind === "def")![0];
const shows: [string, string, (k: Lang) => Id, boolean][] = [
  ["Rational", "[3/2, -5]", (k) => k.call(CONS, k.call(named("fraction"), k.int(6), k.int(4)), k.call(CONS, k.call(named("fraction"), k.int(-5), k.int(1)), k.x(NIL))), false],
  ["Complex", "[1.5 − 2i, 0 + 0.25i]", (k) => k.call(CONS, k.call(COMPLEX_V, k.lit(1.5), k.lit(-2)), k.call(CONS, k.call(COMPLEX_V, k.lit(0), k.lit(0.25)), k.x(NIL))), true],
  ["Fixed", "[1.5, -0.25]", (k) => k.call(CONS, k.call(FIXED_V, k.int(3 * 2 ** 31)), k.call(CONS, k.call(FIXED_V, k.int(-(2 ** 30))), k.x(NIL))), true],
];

for (const [type, want, list, total] of shows) test(`a list of ${type} shows through the prelude's Shown on every target (C139a)`, async () => {
  const k = new Lang(p.code), d = k.def("go");
  k.define(d, k.fn([], () => k.call(SHOW_ANY, list(k))));
  const code = merge(k.code, p.code), names = { ...p.pres.names, ...k.names };
  const info = infer(code, names, undefined, p.options);
  assert.deepEqual(info.errors.map((e) => e.message), []);
  const r = makeRunner(code, info, { print: () => {}, names });
  let ev: Value | undefined;
  for (const x of r.call(r.value(d))) { ev = x; break; }
  assert.equal(ev, want);
  const core = lowerCore(code, info, names, [d]);
  const fns = loadCoreJs(core, { print: () => {} }) as ((...xs: unknown[]) => unknown)[];
  assert.equal(fns[core.funcs.findIndex((f) => f.name === "go")](), want);
  const ir = lowerScalar(code, info, names, [d], { data: true });
  assert.equal(ir.refused.get(d), undefined);
  // A total go gives its text as it is; Rational's may fail (a fraction
  // over 0), so its WebAssembly answer is wrapped and only C is read.
  if (total) {
    const ex = await instantiate(emitWasm(ir)) as unknown as Record<string, (...xs: never[]) => unknown>;
    assert.equal(fromText(ex, ex.go()), want);
  }
  if (!skip) assert.equal(build(ir)([[ir.funcs.findIndex((f) => f.name === "go"), []]])[0].value, want);
});
