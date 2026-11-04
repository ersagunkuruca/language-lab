// The steady module (L210a): sin, cos, exp and log written in Ters as
// fdlibm writes them, so every engine gives the same bits. V8's Math.exp
// and Math.log are fdlibm's (and on Node 22 so are its sin and cos), so
// the evaluator is checked against them to the bit, and the compiled
// JavaScript, both printers, against the evaluator.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { compile } from "../../compiler/src/compile.ts";
import { loadCoreJs, lowerCore } from "../../compiler/src/core-js.ts";
import { Lang } from "../src/lang/dsl.ts";
import { infer } from "../src/lang/infer.ts";
import { base, baseNames } from "../src/lang/load.ts";
import { LIBRARY, STEADY } from "../src/lang/library.ts";
import { makeRunner, type Value } from "../src/lang/run.ts";

const runtime = pathToFileURL(join(import.meta.dirname, "../../compiler/src/runtime.js")).href;
const steady = (name: string) => STEADY.exports.find((d) => LIBRARY.names[d] === name)!;
const FNS = { sin: Math.sin, cos: Math.cos, exp: Math.exp, log: Math.log } as const;

// Inputs over each one's range, and the edges fdlibm's branches turn on.
let seed = 11;
const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
const inputs = (f: keyof typeof FNS): number[] => [
  ...Array.from({ length: 400 }, (_, i) => f === "log" ? Math.exp((rnd() - 0.5) * 1400) : f === "exp" ? (rnd() - 0.5) * 1400 : (rnd() - 0.5) * [10, 2e5, 3e6][i % 3]),
  ...{
    exp: [0, 1, -1, 2 ** -29, 0.34657, 0.3466, 1.0397, 1.04, 709.78, -745.13, -708.4, -720],
    log: [1, 2, 0.5, 5e-324, 2.2250738585072014e-308, 1.7976931348623157e308, 1 + 2 ** -52, 1 - 2 ** -53, Math.SQRT2, 1.4142112731933594, 10, 1e-10],
    sin: [0, 1e-9, 2 ** -28, 0.785398, Math.PI / 4, Math.PI / 2, Math.PI, 2.356194, -100.5, 1647099, ...Array.from({ length: 34 }, (_, i) => (i + 1) * Math.PI / 2)],
    cos: [0, 1e-9, 0.3, 0.78125, 0.79, Math.PI / 4, Math.PI / 2, Math.PI, -3, ...Array.from({ length: 34 }, (_, i) => (i + 1) * Math.PI / 2)],
  }[f],
];

function program() {
  const k = new Lang(LIBRARY.code);
  const own = Object.keys(FNS).map((f) => { const d = k.def(`my ${f}`); k.define(d, k.fn(["x"], (x) => k.call(steady(`steady ${f}`), x))); return d; });
  const code = base(k.code), names = baseNames(k.names);
  return { code, names, info: infer(code, names), own };
}

test("steady sin, cos, exp and log give fdlibm's bits, which are V8's Math's", () => {
  const p = program();
  assert.deepEqual(p.info.errors.map((e) => e.message), []);
  const r = makeRunner(p.code, p.info, { print: () => {} });
  for (const [i, [f, g]] of Object.entries(FNS).entries()) {
    const bad = inputs(f as keyof typeof FNS).filter((x) => { const [y] = r.call(r.value(p.own[i]), x as Value) as Iterable<unknown>; return !Object.is(y, g(x)); });
    assert.deepEqual(bad.map((x) => `${f}(${x})`), []);
  }
});

test("compiled JavaScript gives the evaluator's bits, from compile.ts and from the core IR", async () => {
  const p = program();
  const r = makeRunner(p.code, p.info, { print: () => {} });
  const path = join(mkdtempSync(join(tmpdir(), "steady-")), "main.mjs");
  writeFileSync(path, compile(p.code, p.info, p.names, { runtime, exports: p.own.map((d) => p.names[d]) }));
  const defs = (await import(pathToFileURL(path).href)).defs as Record<string, (x: number) => number>;
  const ir = lowerCore(p.code, p.info, p.names, p.own);
  assert.deepEqual([...ir.refused.values()], []);
  const fs = loadCoreJs(ir);
  p.own.forEach((d, i) => {
    const f = Object.keys(FNS)[i] as keyof typeof FNS;
    const core = fs[ir.funcs.findIndex((g) => g.name === p.names[d] && !g.inner)];
    for (const x of inputs(f)) {
      const [y] = r.call(r.value(d), x as Value) as Iterable<unknown>;
      // exp and log have Choice (no answer past their range), so
      // compile.ts gives their answers as a generator.
      const c = defs[p.names[d]](x) as unknown;
      assert.ok(Object.is(typeof c === "object" ? [...(c as Iterable<number>)][0] : c, y), `compile.ts ${f}(${x})`);
      assert.ok(Object.is(core(x), y), `core IR ${f}(${x})`);
    }
  });
});

test("sin past 2^20·π/2 stops with its reason, until Payne and Hanek's reduction is written", () => {
  const p = program();
  const r = makeRunner(p.code, p.info, { print: () => {} });
  assert.throws(() => [...(r.call(r.value(p.own[0]), 2e6 as Value) as Iterable<unknown>)], /below 1,647,100/);
});
