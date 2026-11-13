// derivative(f) of a function value on the core IR's JavaScript (C137c20):
// the evaluator's derivative, looking inside the printed closure (which
// carries its lambda), and what it gives called as a function, a second
// time too.

import { test } from "node:test";
import assert from "node:assert/strict";
import { Lang } from "../../ters/src/lang/dsl.ts";
import { infer } from "../../ters/src/lang/infer.ts";
import { base, baseNames } from "../../ters/src/lang/load.ts";
import { makeRunner } from "../../ters/src/lang/run.ts";
import { S } from "../../ters/src/lang/std.ts";
import { LIBRARY } from "../../ters/src/lang/library.ts";
import { NUMBER } from "../../ters/src/lang/types.ts";
import type { Id } from "../../ters/src/model.ts";
import { B } from "../../ters/src/prelude.ts";
import { emitCoreJs, loadCoreJs, loadPrinted, lowerCore, printed } from "../src/core-js.ts";
import { lowerScalar } from "../src/scalar.ts";
import { emitWasm, instantiate } from "../src/wasm.ts";
import { build, skip } from "./c-harness.ts";
import { spawnSync } from "node:child_process";
import { closeSync, mkdtempSync, openSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WASI } from "node:wasi";

test("derivative and gradient of a function value, and a second derivative, as the evaluator gives them", () => {
  const k = new Lang();
  const cube = k.def("cube"), slope = k.def("slope"), bend = k.def("bend"), steep = k.def("steep"), at2 = k.def("at 2");
  k.define(cube, k.fn(["x"], (x) => k.call(B.mul, x, k.call(B.mul, x, k.call(B.add, x, k.lit(1))))));
  k.define(slope, k.fn(["f", "x"], (f, x) => k.call(k.call(S.derivative, f), x)));
  k.define(bend, k.fn(["f", "x"], (f, x) => k.call(k.call(S.derivative, k.call(S.derivative, f)), x)));
  k.define(steep, k.fn(["f", "x"], (f, x) => k.call(k.call(S.gradient, f), x)));
  k.define(at2, k.fn(["x"], (x) => k.call(B.add, k.call(slope, cube, x), k.call(B.add, k.call(bend, cube, x), k.call(steep, cube, x)))));
  const code = base(k.code), names = baseNames(k.names), info = infer(code, names);
  assert.deepEqual(info.errors.map((e) => e.message), []);
  const r = makeRunner(code, info, { print: () => {}, names });
  const ev = (x: number) => { for (const v of r.call(r.value(at2), x)) return v; };
  const core = lowerCore(code, info, names, [at2]);
  assert.deepEqual([...core.refused.entries()], []);
  // A derivative's result asked for its derivative again (bend): the
  // evaluator's, looking inside the closure, which carries its lambda.
  const js = emitCoreJs(core).js;
  assert.match(js, /R\.rt\("derive:builtin\.derivative"/, "the evaluator's derivative, not one written in place");
  assert.match(js, /"lambda":/);
  const f = loadCoreJs(core)[core.funcs.findIndex((g) => g.def === at2 && !g.inner)];
  // x³ + x²: 3x² + 2x, then 6x + 2, then 3x² + 2x again.
  for (const x of [0, 1, 2, -1.5]) assert.equal(f(x), ev(x), `at ${x}`);
  assert.equal(f(2), 16 + 14 + 16);
  // Printed, it is given only the nodes the closures it looks inside
  // reach (C167d), and says the same.
  const shown = printed(core), n = Object.keys(shown.code!.nodes).length;
  assert.ok(n > 0 && n < Object.keys(core.code.nodes).length / 2, `${n} nodes`);
  const g = loadPrinted(shown, { print: () => {} }, shown.code)[core.funcs.findIndex((h) => h.def === at2 && !h.inner)];
  for (const x of [0, 1, 2, -1.5]) assert.equal(g(x), ev(x), `printed, at ${x}`);
});

// A first derivative of a function chosen at run time (I245): the
// function carries it, made ahead, so the printed program has no
// evaluator and no nodes, and newton's slope, handed on to newton again,
// is still only applied.
test("a function chosen at run time carries its derivative (I245)", () => {
  const k = new Lang();
  const cube = k.def("cube"), wave = k.def("wave"), pick = k.def("pick"), newton = k.def("newton"), root = k.def("root"), at = k.def("at");
  k.define(cube, k.fn(["x"], (x) => k.call(B.sub, k.call(B.mul, x, k.call(B.mul, x, x)), k.lit(2))));
  k.define(wave, k.fn(["x"], (x) => k.call(B.sub, k.call(B.mul, x, x), k.lit(3))));
  k.define(pick, k.fn(["n"], (n) => k.if(k.call(S.less, n, k.lit(1)), cube, wave)));
  k.define(newton, k.fn(["f", "slope", "x", "n"], (f, slope, x, n) => k.if(k.call(S.less, n, k.lit(1)), x,
    k.call(newton, f, slope, k.call(B.sub, x, k.call(B.div, k.call(f, x), k.call(slope, x))), k.call(B.sub, n, k.lit(1))))));
  k.define(root, k.fn(["n"], (n) => k.let("f", k.call(pick, n), (f) => k.call(newton, f, k.call(S.derivative, f), k.lit(1), k.lit(30)))));
  k.define(at, k.fn(["n", "x"], (n, x) => k.call(B.add, k.call(root, n), k.call(k.call(S.derivative, k.call(pick, n)), x))));
  const code = base(k.code), names = baseNames(k.names), info = infer(code, names);
  assert.deepEqual(info.errors.map((e) => e.message), []);
  const r = makeRunner(code, info, { print: () => {}, names });
  const ev = (n: number, x: number) => { for (const v of r.call(r.value(at), n, x)) return v; };
  const core = lowerCore(code, info, names, [at]);
  assert.deepEqual([...core.refused.entries()], []);
  const js = emitCoreJs(core).js;
  assert.doesNotMatch(js, /R\.rt\("derive:/);
  assert.doesNotMatch(js, /"lambda":/);
  const f = loadCoreJs(core)[core.funcs.findIndex((g) => g.def === at && !g.inner)];
  for (const [n, x] of [[0, 2], [1, 2], [0, -1.5], [1, 0.5]]) assert.equal(f(n, x), ev(n, x), `at ${n}, ${x}`);
});

test("a lambda that captures, chosen at run time, carries its derivative over its captures (I245)", () => {
  const k = new Lang();
  const scaled = k.def("scaled"), at = k.def("at");
  k.define(scaled, k.fn(["a"], (a) => k.fn(["y"], (y) => k.call(B.mul, a, k.call(B.mul, y, k.call(B.sin, y))))));
  k.define(at, k.fn(["a", "x"], (a, x) => k.call(k.call(S.derivative, k.call(scaled, a)), x)));
  const code = base(k.code), names = baseNames(k.names), info = infer(code, names);
  assert.deepEqual(info.errors.map((e) => e.message), []);
  const r = makeRunner(code, info, { print: () => {}, names });
  const core = lowerCore(code, info, names, [at]);
  const js = emitCoreJs(core).js;
  assert.doesNotMatch(js, /R\.rt\("derive:/);
  assert.doesNotMatch(js, /"lambda":/);
  const f = loadCoreJs(core)[core.funcs.findIndex((g) => g.def === at && !g.inner)];
  for (const [a, x] of [[2, 3], [-1, 0.5], [0.25, -2]]) { let want; for (const v of r.call(r.value(at), a, x)) { want = v; break; } assert.equal(f(a, x), want, `at ${a}, ${x}`); }
});

// A lambda whose derivative asks for another's (of the function it
// captured) would need that carried at its order too: the evaluator's
// derivative stays, with the closures saying what they are.
test("a derivative that asks for another: the evaluator's derivative still (I245)", () => {
  const k = new Lang();
  const cube = k.def("cube"), twice = k.def("twice"), at = k.def("at");
  k.define(cube, k.fn(["x"], (x) => k.call(B.mul, x, k.call(B.mul, x, x))));
  k.define(twice, k.fn(["h"], (h) => k.fn(["y"], (y) => k.call(B.mul, k.lit(2), k.call(h, y)))));
  k.define(at, k.fn(["x"], (x) => k.call(k.call(S.derivative, k.call(twice, cube)), x)));
  const code = base(k.code), names = baseNames(k.names), info = infer(code, names);
  assert.deepEqual(info.errors.map((e) => e.message), []);
  const r = makeRunner(code, info, { print: () => {}, names });
  const core = lowerCore(code, info, names, [at]);
  assert.deepEqual([...core.refused.entries()], []);
  assert.match(emitCoreJs(core).js, /R\.rt\("derive:/);
  const f = loadCoreJs(core)[core.funcs.findIndex((g) => g.def === at && !g.inner)];
  for (const x of [2, 0.5, -1]) { let want; for (const v of r.call(r.value(at), x)) { want = v; break; } assert.equal(f(x), want, `at ${x}`); }
});

// The same on WebAssembly and C (I245 step 3): a carried derivative's
// closure holds its maker after its code, and `derivative(f)` calls it.
function newtonAndScaled() {
  const k = new Lang();
  const cube = k.def("cube"), wave = k.def("wave"), pick = k.def("pick"), newton = k.def("newton"), root = k.def("root"), at = k.def("at");
  const scaled = k.def("scaled"), steep = k.def("steep");
  k.define(cube, k.fn(["x"], (x) => k.call(B.sub, k.call(B.mul, x, k.call(B.mul, x, x)), k.lit(2))));
  k.define(wave, k.fn(["x"], (x) => k.call(B.sub, k.call(B.mul, x, x), k.lit(3))));
  k.define(pick, k.fn(["n"], (n) => k.if(k.call(S.less, n, k.lit(1)), cube, wave)));
  k.define(newton, k.fn(["f", "slope", "x", "n"], (f, slope, x, n) => k.if(k.call(S.less, n, k.lit(1)), x,
    k.call(newton, f, slope, k.call(B.sub, x, k.call(B.div, k.call(f, x), k.call(slope, x))), k.call(B.sub, n, k.lit(1))))));
  k.define(root, k.fn(["n"], (n) => k.let("f", k.call(pick, n), (f) => k.call(newton, f, k.call(S.derivative, f), k.lit(1), k.lit(30)))));
  k.define(at, k.fn(["n", "x"], (n, x) => k.call(B.add, k.call(root, n), k.call(k.call(S.derivative, k.call(pick, n)), x))));
  k.define(scaled, k.fn(["a"], (a) => k.fn(["y"], (y) => k.call(B.mul, a, k.call(B.mul, y, k.call(B.sin, y))))));
  k.define(steep, k.fn(["a", "x"], (a, x) => k.call(k.call(S.derivative, k.call(scaled, a)), x)));
  const code = base(k.code), names = baseNames(k.names), info = infer(code, names);
  assert.deepEqual(info.errors.map((e) => e.message), []);
  const r = makeRunner(code, info, { print: () => {}, names });
  const ev = (d: string, xs: number[]) => { for (const v of r.call(r.value(d), ...xs)) return v as number; };
  return { code, names, info, at, steep, ev };
}
const inputs: [number, number][] = [[0, 2], [1, 2], [0, -1.5], [1, 0.5], [2, 3], [-1, 0.5], [0.25, -2]];

test("a carried derivative on WebAssembly: the evaluator's numbers (I245)", async () => {
  const p = newtonAndScaled();
  const lowered = lowerScalar(p.code, p.info, p.names, [p.at, p.steep], { data: true });
  assert.ok(lowered.derived?.size, "closures carry a maker");
  const w = await instantiate(emitWasm(lowered));
  for (const d of [p.at, p.steep]) {
    const f = lowered.funcs.find((g) => g.def === d && !g.inner)!;
    // A partial function gives its value and a status (0: an answer).
    const got = (xs: number[]) => { const r = w[f.name](...xs) as unknown; return f.partial ? (r as [number, number])[1] === 0 ? (r as [number, number])[0] : undefined : r; };
    for (const xs of inputs) assert.equal(got(xs), p.ev(d, xs), `${d}(${xs})`);
  }
});

test("a carried derivative in C: the evaluator's numbers, every cell freed (I245)", { skip }, () => {
  const p = newtonAndScaled();
  const lowered = lowerScalar(p.code, p.info, p.names, [p.at, p.steep], { data: true });
  const run = build(lowered);
  const calls = [p.at, p.steep].flatMap((d) => inputs.map((xs): [number, number[]] => [lowered.funcs.findIndex((g) => g.def === d && !g.inner), xs]));
  const got = run(calls);
  calls.forEach(([i, xs], j) => assert.equal(got[j].value, p.ev(lowered.funcs[i].def, xs), `${lowered.funcs[i].name}(${xs})`));
});

// calculus as a program (I238, I245): ters wasi and ters native print what
// ters run prints.
test("calculus through ters wasi and ters native prints what ters run prints (I245)", async () => {
  const lab = join(import.meta.dirname, "../../ters/cli/ters.ts"), calculus = join(import.meta.dirname, "../../ters/examples/calculus");
  const dir = mkdtempSync(join(tmpdir(), "calculus-"));
  const want = spawnSync(process.execPath, [lab, "run", calculus], { encoding: "utf8" });
  assert.equal(want.status, 0, want.stderr);
  assert.match(want.stdout, /^cubic: f\(2\) = 5, f′\(2\) = 11/);
  const made = spawnSync(process.execPath, [lab, "wasi", calculus, "-o", join(dir, "p.wasm")], { encoding: "utf8" });
  assert.equal(made.status, 0, made.stderr);
  const of = join(dir, "out.txt"), fd = openSync(of, "w");
  const w = new WASI({ version: "preview1", args: ["p"], preopens: { ".": dir }, stdout: fd, stderr: fd, returnOnExit: true });
  w.start(new WebAssembly.Instance(await WebAssembly.compile(readFileSync(join(dir, "p.wasm"))), w.getImportObject() as WebAssembly.Imports));
  closeSync(fd);
  assert.equal(readFileSync(of, "utf8"), want.stdout, "ters wasi");
  if (skip) return;
  const built = spawnSync(process.execPath, [lab, "native", calculus, "-o", join(dir, "p")], { encoding: "utf8" });
  assert.equal(built.status, 0, built.stderr);
  assert.equal(spawnSync(join(dir, "p"), [], { encoding: "utf8" }).stdout, want.stdout, "ters native");
});

// A lambda capturing a list, its slope a sum over a map of it (round 15):
// the carried derivative is made from the code as staged, before a fold
// of a map is fused (it gave the first item's slope, 1, once), and where
// one can't be made the evaluator's derive is given the library nodes it
// writes into a derivative (a pair's second, which nothing else reached).
test("a derivative through sum(map(xs, …)) of a captured list: the slope, compiled and by ters run (I245, L245, round 15)", () => {
  const k = new Lang(LIBRARY.code);
  const lib = (name: string) => LIBRARY.modules.flatMap((m) => m.exports).find((d) => LIBRARY.names[d] === name)!;
  const f = k.def("f"), at = k.def("at");
  k.define(f, k.fn(["xs"], (xs) => k.fn(["q"], (q) => k.call(lib("sum"), k.call(lib("map"), xs, k.fn(["x"], (x) => k.call(B.mul, q, x)))))));
  k.define(at, k.fn(["q"], (q) => k.call(k.call(S.derivative, k.call(f, k.listOf(k.lit(1), k.lit(2)))), q)));
  const code = base(k.code), names = { ...baseNames(), ...k.names }, info = infer(code, names);
  assert.deepEqual(info.errors.map((e) => e.message), []);
  const core = lowerCore(code, info, names, [at]);
  assert.deepEqual([...core.refused.entries()], []);
  const g = loadPrinted(printed(core), { print: () => {} }, printed(core).code)[core.funcs.findIndex((h) => h.def === at && !h.inner)];
  for (const q of [1, -2, 0.5]) assert.equal(g(q), 3, `at ${q}`);
  // And `ters run` gives the same (L245: forward mode through the list).
  const r = makeRunner(code, info, { print: () => {} });
  for (const q of [1, -2, 0.5]) assert.deepEqual([...r.call(r.value(at), q)], [3], `ters run at ${q}`);
});

// gradient(f) of a function of a record chosen at run time (I247, round
// 15's fit): carried as a derivative is, on JavaScript with no nodes, and
// on WebAssembly and C.
function gradientProgram() {
  const k = new Lang();
  const AB = k.type("AB", [], [["ab", [["a", () => k.tref(NUMBER)], ["b", () => k.tref(NUMBER)]]]]);
  const v = AB.v.ab, part = (p: Id, i: number) => k.call(AB.f[i ? "ab.b" : "ab.a"], p);
  const model = k.def("model"), at = k.def("at");
  // model(m, x): a·e^(b·x) or a + b·x, as a function of (a, b).
  k.define(model, k.fn(["m", "x"], (m, x) => k.if(k.call(S.less, m, k.lit(1)),
    k.fn(["p"], (p) => k.call(B.mul, part(p, 0), k.call(B.exp, k.call(B.mul, part(p, 1), x)))),
    k.fn(["p"], (p) => k.call(B.add, part(p, 0), k.call(B.mul, part(p, 1), x))))));
  // at(m, x, a, b): the gradient's two parts, a + 10·b.
  k.define(at, k.fn(["m", "x", "a", "b"], (m, x, a, b) => k.let("g", k.call(k.call(S.gradient, k.call(model, m, x)), k.call(v, a, b)), (g) =>
    k.call(B.add, part(g, 0), k.call(B.mul, k.lit(10), part(g, 1))))));
  const code = base(k.code), names = baseNames(k.names), info = infer(code, names);
  assert.deepEqual(info.errors.map((e) => e.message), []);
  const r = makeRunner(code, info, { print: () => {}, names });
  const ev = (xs: number[]) => { for (const y of r.call(r.value(at), ...xs)) return y as number; };
  return { code, names, info, at, ev };
}
const gradientInputs = [[0, 2, 1.5, 0.3], [1, 2, 1.5, 0.3], [0, -1, 2, -0.5], [1, 0.5, 0, 0]];

test("a function of a record chosen at run time carries its gradient (I247)", async () => {
  const p = gradientProgram();
  const core = lowerCore(p.code, p.info, p.names, [p.at]);
  assert.deepEqual([...core.refused.entries()], []);
  const js = emitCoreJs(core).js;
  assert.doesNotMatch(js, /R\.rt\("derive:/);
  assert.doesNotMatch(js, /"lambda":/);
  const f = loadCoreJs(core)[core.funcs.findIndex((g) => g.def === p.at && !g.inner)];
  for (const xs of gradientInputs) assert.equal(f(...xs), p.ev(xs), `JS at ${xs}`);
  const lowered = lowerScalar(p.code, p.info, p.names, [p.at], { data: true });
  const fi = lowered.funcs.findIndex((g) => g.def === p.at && !g.inner), fn = lowered.funcs[fi];
  const w = await instantiate(emitWasm(lowered));
  const got = (xs: number[]) => { const y = w[fn.name](...xs) as unknown; return fn.partial ? (y as [number, number])[1] === 0 ? (y as [number, number])[0] : undefined : y; };
  for (const xs of gradientInputs) assert.equal(got(xs), p.ev(xs), `WebAssembly at ${xs}`);
  if (skip) return;
  const run = build(lowered), out = run(gradientInputs.map((xs): [number, number[]] => [fi, xs]));
  gradientInputs.forEach((xs, j) => assert.equal(out[j].value, p.ev(xs), `C at ${xs}`));
});
