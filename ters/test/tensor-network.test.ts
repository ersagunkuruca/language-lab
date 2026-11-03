// A bigger tensor program (L51d, TENSORS-2026-11-03.md step d): the
// forward pass of a small neural network, two dense layers with a ReLU
// between, 6 inputs, 8 hidden and 3 outputs. Each layer is one
// contraction (W · x) plus a bias, + item by item through Tensor's
// Arithmetic (L51c); ReLU is tensor map. Bigger than a 4 × 4 matrix, which
// is NUMBERS.md stage 6's trigger. The evaluator and compiled JavaScript
// give the answer worked out by hand in plain JavaScript below.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { compile } from "../../compiler/src/compile.ts";
import type { Id } from "../src/model.ts";
import { Lang } from "../src/lang/dsl.ts";
import { infer } from "../src/lang/infer.ts";
import { LIBRARY } from "../src/lang/library.ts";
import { base, baseNames, checkOptions } from "../src/lang/load.ts";
import { runMain } from "../src/lang/run.ts";
import { ARITH, PAIR_V, SHOW_ANY } from "../src/lang/std.ts";

const runtime = pathToFileURL(join(import.meta.dirname, "../../compiler/src/runtime.js")).href;
const lib = (name: string) => LIBRARY.modules.flatMap((m) => m.exports).find((d) => LIBRARY.names[d] === name)!;

// Small whole weights, so every engine's answer is exact.
const weights = (rows: number, cols: number, seed: number) => Array.from({ length: rows * cols }, (_, i) => ((i * 5 + seed * 3) % 7) - 3);
const W1 = weights(8, 6, 1), B1 = weights(8, 1, 2), W2 = weights(3, 8, 3), B2 = weights(3, 1, 4), X = [1, -2, 3, 0, 2, -1];

// The same pass in plain JavaScript.
const dense = (w: number[], b: number[], x: number[]) => b.map((bi, r) => bi + x.reduce((s, xj, j) => s + w[r * x.length + j] * xj, 0));
const expected = dense(W2, B2, dense(W1, B1, X).map((v) => Math.max(0, v)));

function network() {
  const k = new Lang(LIBRARY.code);
  const tensor = (shape: number[], xs: number[]) => k.call(lib("tensor of"), k.listOf(...shape.map((n) => k.int(n))), k.listOf(...xs.map((x) => k.lit(x))));
  const def = (name: string, body: () => Id) => { const d = k.def(name); k.define(d, body()); return d; };
  const times = (w: Id, x: Id) => k.call(lib("contracted"), w, x, k.listOf(k.call(PAIR_V, k.int(1), k.int(0))));
  const relu = def("relu", () => k.fn(["v"], (v) => k.if(k.call(ARITH.less, k.x(v), k.lit(0)), k.lit(0), k.x(v))));
  const layer = def("layer", () => k.fn(["w", "b", "x"], (w, b, x) => k.call(ARITH.add, times(k.x(w), k.x(x)), k.x(b))));
  // Inside main: a tensor of stops when its items don't fill the shape.
  const main = k.def("main");
  k.define(main, k.thunk(() => {
    const hidden = k.call(lib("tensor map"), k.x(relu), k.call(k.x(layer), tensor([8, 6], W1), tensor([8], B1), tensor([6], X)));
    const out = k.call(k.x(layer), tensor([3, 8], W2), tensor([3], B2), hidden);
    return k.call(SHOW_ANY, k.call(lib("tensor items"), out));
  }));
  const code = base(k.code), names = baseNames(k.names), info = infer(code, names, undefined, checkOptions);
  return { code, names, info, main };
}

test("a two-layer network's forward pass, evaluated and compiled, is the hand-worked answer", async () => {
  const p = network();
  assert.deepEqual(p.info.errors.map((e) => e.message), []);
  const want = `[${expected.join(", ")}]`;
  assert.equal(runMain(p.code, p.info, p.main, { print: () => {}, names: p.names }), want);
  const path = join(mkdtempSync(join(tmpdir(), "tensor-network-")), "main.mjs");
  writeFileSync(path, compile(p.code, p.info, p.names, { runtime, exports: ["main"] }));
  const defs = (await import(pathToFileURL(path).href)).defs as Record<string, () => unknown>;
  assert.equal(typeof defs.main === "function" ? defs.main() : defs.main, want);
});
