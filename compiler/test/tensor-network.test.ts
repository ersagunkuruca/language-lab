// The two-layer network of ters/test/tensor-network.test.ts (L51d) on the
// core IR (C160): its JavaScript, WebAssembly and C each give the
// evaluator's three outputs (−26, −102, 67), through `contracted`,
// Tensor's + item by item (L51c), `tensor map` and `tensor of`; and a
// tensor whose items don't fill its shape aborts with the evaluator's
// words on each.

import { test } from "node:test";
import assert from "node:assert/strict";
import { Lang } from "../../ters/src/lang/dsl.ts";
import { infer } from "../../ters/src/lang/infer.ts";
import { LIBRARY } from "../../ters/src/lang/library.ts";
import { base, baseNames, checkOptions } from "../../ters/src/lang/load.ts";
import { makeRunner } from "../../ters/src/lang/run.ts";
import { ARITH, PAIR_V } from "../../ters/src/lang/std.ts";
import type { Id } from "../../ters/src/model.ts";
import { loadCoreJs, lowerCore } from "../src/core-js.ts";
import { lowerScalar } from "../src/scalar.ts";
import { emitWasm, fromText, instantiate } from "../src/wasm.ts";
import { build, skip as noC } from "./c-harness.ts";

const lib = (name: string) => LIBRARY.modules.flatMap((m) => m.exports).find((d) => LIBRARY.names[d] === name)!;
// The same weights as ters/test/tensor-network.test.ts.
const weights = (rows: number, cols: number, seed: number) => Array.from({ length: rows * cols }, (_, i) => ((i * 5 + seed * 3) % 7) - 3);
const W1 = weights(8, 6, 1), B1 = weights(8, 1, 2), W2 = weights(3, 8, 3), B2 = weights(3, 1, 4), X = [1, -2, 3, 0, 2, -1];

// output(i): the network's i-th output, or −999 past the last; short(s):
// a 2 × 2 tensor given three items, summed with s.
function network() {
  const k = new Lang(LIBRARY.code);
  const tensor = (shape: number[], xs: number[]) => k.call(lib("tensor of"), k.listOf(...shape.map((n) => k.int(n))), k.listOf(...xs.map((x) => k.lit(x))));
  const def = (name: string, body: () => Id) => { const d = k.def(name); k.define(d, body()); return d; };
  const times = (w: Id, x: Id) => k.call(lib("contracted"), w, x, k.listOf(k.call(PAIR_V, k.int(1), k.int(0))));
  const relu = def("relu", () => k.fn(["v"], (v) => k.if(k.call(ARITH.less, k.x(v), k.lit(0)), k.lit(0), k.x(v))));
  const layer = def("layer", () => k.fn(["w", "b", "x"], (w, b, x) => k.call(ARITH.add, times(k.x(w), k.x(x)), k.x(b))));
  const output = def("output", () => k.fn(["i"], (i) => {
    const hidden = k.call(lib("tensor map"), k.x(relu), k.call(k.x(layer), tensor([8, 6], W1), tensor([8], B1), tensor([6], X)));
    const out = k.call(k.x(layer), tensor([3, 8], W2), tensor([3], B2), hidden);
    return k.call(lib("item at"), k.call(lib("tensor items"), out), i, k.lit(-999));
  }));
  const short = def("short", () => k.fn(["s"], (s) => k.call(ARITH.add, s, k.call(lib("sum"), k.call(lib("tensor items"), tensor([2, 2], [1, 2, 3]))))));
  const code = base(k.code), names = baseNames(k.names), info = infer(code, names, undefined, checkOptions);
  assert.deepEqual(info.errors.map((e) => e.message), []);
  return { code, names, info, output, short };
}

const positions = [0, 1, 2, 3];
const outputs = [-26, -102, 67, -999];

test("the network on the core IR's JavaScript and WebAssembly: the evaluator's outputs, and its words for a tensor too short", async () => {
  const p = network();
  const r = makeRunner(p.code, p.info, { print: () => {}, names: p.names });
  // WebAssembly's Aborted carries the words as its reason.
  const tried = (f: () => unknown) => { try { return f(); } catch (e) { return { stop: (e as { reason?: string }).reason ?? (e as Error).message }; } };
  const ev = (d: Id, x: number) => tried(() => { for (const v of r.call(r.value(d), x)) return v; });
  assert.deepEqual(positions.map((i) => ev(p.output, i)), outputs);
  const stop = ev(p.short, 0) as { stop: string };
  assert.ok(stop.stop, "the evaluator stops");
  const core = lowerCore(p.code, p.info, p.names, [p.output, p.short]);
  assert.deepEqual([...core.refused.entries()], []);
  const fs = loadCoreJs(core);
  const at = (d: Id) => fs[core.funcs.findIndex((g) => g.def === d && !g.inner)];
  assert.deepEqual(positions.map((i) => at(p.output)(i)), outputs);
  assert.deepEqual(tried(() => at(p.short)(0)), stop);
  const lowered = lowerScalar(p.code, p.info, p.names, [p.output, p.short], { data: true });
  assert.deepEqual([...lowered.refused.entries()], []);
  const w = (await instantiate(emitWasm(lowered))) as unknown as Record<string, (x: number) => unknown>;
  const name = (d: Id) => lowered.funcs.find((g) => g.def === d && !g.inner)!.name;
  const one = (v: unknown) => (Array.isArray(v) ? v[0] : v);
  assert.deepEqual(positions.map((i) => one(w[name(p.output)](i))), outputs);
  // A partial function's answer comes with its status; 2 is an Abort, its
  // words from Abort.reason.
  const [, status] = w[name(p.short)](0) as [unknown, number];
  assert.equal(status, 2);
  assert.deepEqual({ stop: fromText(w as never, (w as unknown as Record<string, () => unknown>)["Abort.reason"]()) }, stop);
});

test("the network in C: the evaluator's outputs and words, every cell freed", { skip: noC }, () => {
  const p = network();
  const r = makeRunner(p.code, p.info, { print: () => {}, names: p.names });
  let words = "";
  try { for (const _ of r.call(r.value(p.short), 0)) break; } catch (e) { words = (e as Error).message; }
  const lowered = lowerScalar(p.code, p.info, p.names, [p.output, p.short], { data: true });
  const at = (d: Id) => lowered.funcs.findIndex((g) => g.def === d && !g.inner);
  const got = build(lowered)([...positions.map((i) => [at(p.output), [i]] as [number, number[]]), [at(p.short), [0]]]);
  assert.deepEqual(got.map((g) => g.value), [...outputs, { aborted: words }]);
  assert.deepEqual(got.map((g) => g.live), got.map(() => 0));
});
