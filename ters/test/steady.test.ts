// The steady module (L210): sin, cos, tan, exp, log, pow, atan, atan2, asin and acos written in Ters as
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
const FNS = { sin: Math.sin, cos: Math.cos, tan: Math.tan, exp: Math.exp, log: Math.log, atan: Math.atan, asin: Math.asin, acos: Math.acos } as const;

// Inputs over each one's range, and the edges fdlibm's branches turn on.
let seed = 11;
const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
const inputs = (f: keyof typeof FNS): number[] => [
  ...Array.from({ length: 400 }, (_, i) => f === "log" ? Math.exp((rnd() - 0.5) * 1400) : f === "exp" ? (rnd() - 0.5) * 1400
    : f === "atan" ? [1e-20, 0.3, 0.6, 1, 1.5, 2.4, 3, 1e3, 1e30][i % 9] * (rnd() * 2 - 1) : f === "asin" || f === "acos" ? (i % 5 === 0 ? 1e-9 : 1) * (rnd() * 2 - 1)
    : (rnd() - 0.5) * [10, 2e5, 3e6][i % 3]),
  ...{
    exp: [0, 1, -1, 2 ** -29, 0.34657, 0.3466, 1.0397, 1.04, 709.78, -745.13, -708.4, -720],
    log: [1, 2, 0.5, 5e-324, 2.2250738585072014e-308, 1.7976931348623157e308, 1 + 2 ** -52, 1 - 2 ** -53, Math.SQRT2, 1.4142112731933594, 10, 1e-10],
    sin: [0, 1e-9, 2 ** -28, 0.785398, Math.PI / 4, Math.PI / 2, Math.PI, 2.356194, -100.5, 1647099, ...Array.from({ length: 34 }, (_, i) => (i + 1) * Math.PI / 2)],
    tan: [0, 1e-9, 2 ** -29, -(2 ** -29), 0.6744, 0.6745, -0.7, 0.785398, Math.PI / 4, 1.5707963267948966, 1.5, -1.5, 3, 100, ...Array.from({ length: 34 }, (_, i) => (i + 1) * Math.PI / 4)],
    atan: [0, 1e-30, 0.4375, 0.6875, 1.1875, 2.4375, -2.4375, 7e19, 1e300],
    asin: [0, 2 ** -28, 0.5, -0.5, 0.975, 0.9751, 1, -1],
    acos: [0, 1e-18, 0.5, -0.5, 0.9, -0.9, 1, -1],
    cos: [0, 1e-9, 0.3, 0.78125, 0.79, Math.PI / 4, Math.PI / 2, Math.PI, -3, ...Array.from({ length: 34 }, (_, i) => (i + 1) * Math.PI / 2)],
  }[f],
];

function program() {
  const k = new Lang(LIBRARY.code);
  const own = Object.keys(FNS).map((f) => { const d = k.def(`my ${f}`); k.define(d, k.fn(["x"], (x) => k.call(steady(`steady ${f}`), x))); return d; });
  const code = base(k.code), names = baseNames(k.names);
  return { code, names, info: infer(code, names), own };
}

test("steady sin, cos, tan, exp, log, atan, asin and acos give fdlibm's bits, which are V8's Math's", () => {
  const p = program();
  assert.deepEqual(p.info.errors.map((e) => e.message), []);
  const r = makeRunner(p.code, p.info, { print: () => {} });
  for (const [i, [f, g]] of Object.entries(FNS).entries()) {
    const bad = inputs(f as keyof typeof FNS).filter((x) => { const [y] = r.call(r.value(p.own[i]), x as Value) as Iterable<unknown>; return !Object.is(y, g(x) === 0 ? 0 : g(x)); });
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
    const at = ir.funcs.findIndex((g) => g.name === p.names[d] && !g.inner);
    assert.ok(at >= 0, `${p.names[d]} not among ${ir.funcs.map((g) => g.name + (g.inner ? "*" : "")).join(", ")}; refused ${[...ir.refused].join(" ")}`);
    const core = fs[at];
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

// pow takes two inputs: its own cases, the edges of fdlibm's branches
// among them (y whole or not, x near 1 with a huge y, results that
// overflow, underflow or are subnormal).
async function twoInputs(name: "pow" | "atan2", g: (a: number, b: number) => number, cases: [number, number][]) {
  const k = new Lang(LIBRARY.code);
  const d = k.def(`my ${name}`);
  k.define(d, k.fn(["x", "y"], (x, y) => k.call(steady(`steady ${name}`), x, y)));
  const code = base(k.code), names = baseNames(k.names), info = infer(code, names);
  assert.deepEqual(info.errors.map((e) => e.message), []);
  const r = makeRunner(code, info, { print: () => {} });
  const path = join(mkdtempSync(join(tmpdir(), `steady-${name}-`)), "main.mjs");
  writeFileSync(path, compile(code, info, names, { runtime, exports: [`my ${name}`] }));
  const compiled = (await import(pathToFileURL(path).href)).defs[`my ${name}`] as (x: number, y: number) => unknown;
  const ir = lowerCore(code, info, names, [d]);
  assert.deepEqual([...ir.refused.values()], []);
  const core = loadCoreJs(ir)[ir.funcs.findIndex((f) => f.name === `my ${name}` && !f.inner)];
  for (const [x, y] of cases) {
    const want = g(x, y);
    if (!Number.isFinite(want)) continue;
    const [got] = r.call(r.value(d), x as Value, y as Value) as Iterable<unknown>;
    assert.ok(Object.is(got, want === 0 ? 0 : want), `${name}(${x}, ${y}) = ${got}, Math's ${want}`);
    const c = compiled(x, y);
    assert.ok(Object.is(typeof c === "object" ? [...(c as Iterable<number>)][0] : c, got), `compile.ts ${name}(${x}, ${y})`);
    assert.ok(Object.is(core(x, y), got), `core IR ${name}(${x}, ${y})`);
  }
}

test("steady pow gives fdlibm's bits, which are V8's Math.pow's, and compiled JavaScript gives the same", async () => {
  const cases: [number, number][] = [[2, 10], [2, 0.5], [0, 2], [-1, 3], [1, 1e300], [10, 308], [2, -1074], [2, -1075], [2, 1023], [0.5, 1074], [-2, 3], [-2, 1023], [1.0000001, 1e12], [0.9999999, 1e12], [3, 2 ** 40], [7, -0.5], [1e-310, 0.25]];
  for (let i = 0; i < 300; i++) {
    const kind = i % 5;
    const x = kind === 0 ? rnd() * 10 : kind === 1 ? -Math.ceil(rnd() * 20) : kind === 2 ? 1 + (rnd() - 0.5) * 1e-7 : kind === 3 ? Math.exp((rnd() - 0.5) * 1400) : rnd() * 1e-300;
    const y = kind === 1 ? Math.round((rnd() - 0.5) * 40) || 1 : kind === 2 ? (rnd() - 0.5) * 1e10 : (rnd() - 0.5) * 60;
    cases.push([x, y]);
  }
  await twoInputs("pow", Math.pow, cases);
});

// atan2(y, x): one zero, so atan2(0, x) for a negative x is π.
test("steady atan2 gives fdlibm's bits, which are V8's Math.atan2's, and compiled JavaScript gives the same", async () => {
  const spread = (i: number) => [1e-20, 1e-8, 0.3, 0.6, 1, 1.5, 2.4, 3, 1e3, 1e20, 1e30][i % 11] * (rnd() * 2 - 1);
  const cases: [number, number][] = [[0, -1], [0, 1], [0, 0], [1, 0], [-1, 0], [1e300, 1e-300], [1e-300, -1e300], [-1e-300, -1e300], [3, 1], [-0.5, -0.5]];
  for (let i = 0; i < 300; i++) cases.push([spread(i), spread(i + 3 + (i % 4))]);
  await twoInputs("atan2", Math.atan2, cases);
});
