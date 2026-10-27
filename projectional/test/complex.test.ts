// Complex numbers (NUMBERS.md, BACKLOG L40): a record of two Float64s with
// the one generic + − · −x (arith.ts resolves them to the prelude's
// complex arithmetic, · the complex product), no <, and the vectors
// module's part-by-part operations still fit. Evaluated and compiled the
// same.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { Lang } from "../src/lang/dsl.ts";
import { infer } from "../src/lang/infer.ts";
import { makeRunner, type Value } from "../src/lang/run.ts";
import { base, baseNames, checkOptions } from "../src/lang/load.ts";
import { LIBRARY } from "../src/lang/library.ts";
import { ARITH, COMPLEX_V, S } from "../src/lang/std.ts";
import { showType } from "../src/lang/types.ts";
import { subtree, type Id } from "../src/model.ts";
import { compile } from "../../compiler/src/compile.ts";

const runtime = pathToFileURL(join(import.meta.dirname, "../../compiler/src/runtime.js")).href;
const lib = (name: string) => LIBRARY.code.defs.find((d) => LIBRARY.names[d] === name)!;

function program() {
  const k = new Lang(LIBRARY.code);
  const def = (name: string, body: () => Id) => { const d = k.def(name); k.define(d, body()); return d; };
  const fn = (name: string, params: string[], body: (...xs: Id[]) => Id) => { const d = k.def(name); k.define(d, k.fn(params, body)); return d; };
  const [show, i, divide, exp, conj, modulus, angle, polar, asC, magnitude] =
    ["show complex", "i", "divide complex", "complex exp", "complex conjugate", "modulus", "angle of", "polar", "as complex", "magnitude"].map(lib);
  const z = (re: number, im: number) => k.call(COMPLEX_V, k.lit(re), k.lit(im));
  const all = (body: () => Id) => k.call(S.all, k.thunk(body));
  const im = (v: Id) => k.match(v, [{ variant: COMPLEX_V, names: ["re", "im"], body: ([, b]) => b }]);
  const square = fn("square", ["x"], (x) => k.call(ARITH.mul, x, x));
  const defs = {
    square,
    added: def("added", () => k.call(show, k.call(ARITH.add, z(1, 2), z(3, -4)))),
    subtracted: def("subtracted", () => k.call(show, k.call(ARITH.sub, z(1, 2), z(3, -4)))),
    multiplied: def("multiplied", () => k.call(show, k.call(ARITH.mul, z(1, 2), z(3, 4)))),
    iSquared: def("i squared", () => k.call(show, k.call(square, k.x(i)))),
    negated: def("negated", () => k.call(show, k.call(ARITH.neg, z(1, -2)))),
    quotient: def("quotient", () => all(() => k.call(show, k.call(divide, z(-5, 10), z(3, 4))))),
    byZero: def("by zero", () => all(() => k.call(divide, z(1, 1), z(0, 0)))),
    euler: def("euler", () => k.call(show, k.call(exp, k.call(ARITH.mul, k.x(i), k.call(asC, k.lit(Math.PI)))))),
    conjugated: def("conjugated", () => k.call(show, k.call(ARITH.mul, z(3, 4), k.call(conj, z(3, 4))))),
    size: def("size", () => k.call(modulus, z(3, 4))),
    // the vectors module's magnitude, part by part: the same |z|
    sizeAsVector: def("size as vector", () => k.call(magnitude, z(3, 4))),
    turn: def("turn", () => k.call(angle, k.call(polar, k.lit(2), k.lit(1)))),
    // The slope of im((x + i)²) = 2x is 2: · differentiates as the complex product.
    slope: def("slope", () => k.call(k.call(S.derivative, k.fn(["x"], (x) => im(k.call(square, k.call(ARITH.add, k.call(asC, x), k.x(i)))))), k.lit(3))),
    // < isn't defined on Complex.
    ordered: def("ordered", () => k.call(ARITH.less, z(1, 0), z(2, 0))),
  };
  const code = base(k.code), names = baseNames(k.names);
  return { code, names, info: infer(code, names, undefined, checkOptions), defs };
}

const NAMES = ["added", "subtracted", "multiplied", "i squared", "negated", "quotient", "by zero", "euler", "conjugated", "size", "size as vector", "turn", "slope"];
const items = (v: Value): Value[] => { const out: Value[] = []; let l = v as { fields: Value[] }; while (l.fields.length) { out.push(l.fields[0]); l = l.fields[1] as { fields: Value[] }; } return out; };
const errorsIn = (p: ReturnType<typeof program>, d: Id) => p.info.errors.filter((e) => subtree(p.code, d).includes(e.id)).map((e) => e.message);

test("Complex takes the one + − · −x, a generic definition takes it, and < is refused", () => {
  const p = program();
  for (const [name, d] of Object.entries(p.defs)) if (name !== "ordered") assert.deepEqual(errorsIn(p, d), [], name);
  assert.match(errorsIn(p, p.defs.ordered).join("; "), /less than/);
  assert.equal(showType(p.info.schemes.get(p.defs.added)!.type, p.names), "Text");
});

async function both() {
  const p = program();
  const ok = new Set(NAMES.map((n) => p.code.defs.find((d) => p.names[d] === n)!));
  const r = makeRunner(p.code, p.info, { print: () => {} });
  const byName = (n: string) => p.code.defs.find((d) => p.names[d] === n)!;
  const run = (v: Value): Value => { if (typeof v !== "function") return v; for (const x of r.call(v)) return x; throw new Error("no value"); };
  const listy = new Set(["quotient", "by zero"]);
  const evaluated = Object.fromEntries(NAMES.map((n) => { const v = run(r.value(byName(n))); return [n, listy.has(n) ? items(v) : v]; }));
  const clean = { ...p.info, errors: p.info.errors.filter((e) => [...ok].some((d) => subtree(p.code, d).includes(e.id))) };
  const path = join(mkdtempSync(join(tmpdir(), "complex-")), "complex.js");
  writeFileSync(path, compile(p.code, clean, p.names, { runtime, exports: NAMES }));
  const defs = (await import(pathToFileURL(path).href)).defs as Record<string, unknown>;
  const compiled = Object.fromEntries(NAMES.map((n) => { const v = typeof defs[n] === "function" ? (defs[n] as () => Value)() : defs[n]; return [n, listy.has(n) ? items(v as Value) : v]; }));
  return { evaluated, compiled };
}

test("the answers: the complex product, i · i = −1, e^(iπ) = −1, no answer dividing by 0", async () => {
  const { evaluated: e } = await both();
  assert.equal(e.added, "4 − 2i");
  assert.equal(e.subtracted, "-2 + 6i");
  assert.equal(e.multiplied, "-5 + 10i");
  assert.equal(e["i squared"], "-1 + 0i");
  assert.equal(e.negated, "-1 + 2i");
  assert.deepEqual(e.quotient, ["1 + 2i"]);
  assert.deepEqual(e["by zero"], []);
  assert.equal(e.euler, "-1 + 0i");
  assert.equal(e.conjugated, "25 + 0i");
  assert.equal(e.size, 5);
  assert.equal(e["size as vector"], 5);
  assert.ok(Math.abs((e.turn as number) - 1) < 1e-12);
  assert.equal(e.slope, 2);
});

test("compiled JavaScript gives the evaluator's answers", async () => {
  const { evaluated, compiled } = await both();
  for (const n of NAMES) {
    if (n === "slope") continue; // derivatives are the evaluator's (derive.ts)
    assert.deepEqual(compiled[n], evaluated[n], n);
  }
});

test("on the GPU a Complex is a vec2f, and WebAssembly gives the evaluator's number", async () => {
  const { lowerScalar } = await import("../../compiler/src/scalar.ts");
  const { emitWgsl } = await import("../../compiler/src/wgsl.ts");
  const { emitWasm, instantiate } = await import("../../compiler/src/wasm.ts");
  const k = new Lang(LIBRARY.code);
  const grow = k.def("grow");
  k.define(grow, k.fn(["c"], (c) => k.call(ARITH.add, k.call(ARITH.mul, c, c), c)));
  const step = k.def("step");
  k.define(step, k.fn(["x", "y"], (x, y) => k.call(lib("modulus"), k.call(grow, k.call(COMPLEX_V, x, y)))));
  const code = base(k.code), names = baseNames(k.names);
  const info = infer(code, names, undefined, checkOptions);
  const low = lowerScalar(code, info, names, [step], { records: true });
  assert.deepEqual([...low.refused.keys()], []);
  const s = emitWgsl(low);
  assert.match(s.wgsl, /fn multiply_complex_\d+\(p0: vec2f, p1: vec2f\) -> vec2f/);
  const w = (await instantiate(emitWasm(low))) as unknown as Record<string, (x: number, y: number) => number>;
  const r = makeRunner(code, info, { print: () => {} });
  assert.equal(w.step(1, 2), [...r.call(r.value(step), 1, 2)][0]);
  assert.equal(w.step(1, 2), Math.hypot(1 - 4 + 1, 4 + 2));
});

// QA-2026-10-24b: show of a fraction printed ratio(1, 2). Float64 types show
// as numbers, evaluated and compiled (the compiled runtime shows with the
// same function).
test("show prints a fraction as 1/2 and a complex number as 3 − 4i, in lists too", async () => {
  const { SHOW_ANY } = await import("../src/lang/std.ts");
  const k = new Lang(LIBRARY.code);
  const fraction = lib("fraction");
  const shown = k.def("shown");
  k.define(shown, k.call(S.all, k.thunk(() => k.call(SHOW_ANY, k.list(k.call(fraction, k.int(2), k.int(4)), k.call(fraction, k.int(6), k.int(3)))))));
  const shownC = k.def("shown complex");
  k.define(shownC, k.call(SHOW_ANY, k.list(k.call(COMPLEX_V, k.lit(3), k.lit(-4)), k.call(COMPLEX_V, k.lit(0.5), k.lit(2)))));
  const code = base(k.code), names = baseNames(k.names);
  const info = infer(code, names, undefined, checkOptions);
  const r = makeRunner(code, info, { print: () => {} });
  const run = (v: Value): Value => { if (typeof v !== "function") return v; for (const x of r.call(v)) return x; throw new Error("no value"); };
  assert.deepEqual(items(run(r.value(shown))), ["[1/2, 2]"]);
  assert.equal(r.value(shownC), "[3 − 4i, 0.5 + 2i]");
  const path = join(mkdtempSync(join(tmpdir(), "show-")), "show.js");
  writeFileSync(path, compile(code, info, names, { runtime, exports: ["shown", "shown complex"] }));
  const defs = (await import(pathToFileURL(path).href)).defs as Record<string, unknown>;
  assert.deepEqual(items((defs.shown as () => Value)()), ["[1/2, 2]"]);
  assert.equal(typeof defs["shown complex"] === "function" ? (defs["shown complex"] as () => Value)() : defs["shown complex"], "[3 − 4i, 0.5 + 2i]");
});

// L40b: examples/mandelbrot, z ↦ z · z + c with the one + and · at Complex,
// goes to the GPU whole (Complex as vec2f), and the evaluator draws the set
// black and the rest in colour.
test("the Mandelbrot shader: one + and · at Complex, lowered to WGSL whole", async () => {
  const { loadProgram } = await import("../src/lang/load.ts");
  const { lowerScalar } = await import("../../compiler/src/scalar.ts");
  const { emitWgsl } = await import("../../compiler/src/wgsl.ts");
  const e = loadProgram(join(import.meta.dirname, "../examples/mandelbrot"));
  const info = infer(e.code, e.pres.names);
  assert.deepEqual(info.errors.map((x) => x.message), []);
  const lowered = lowerScalar(e.code, info, e.pres.names, [e.named("colour")], { records: true });
  assert.deepEqual([...lowered.refused.values()], []);
  assert.match(emitWgsl(lowered).wgsl, /fn escape_at_Float64_\d+\(a0: vec2f, a1: vec2f, a2: f32\) -> f32 \{\n {2}var p0 = a0;[\s\S]*loop \{/);
  const r = makeRunner(e.code, info, { print: () => {} });
  const at = (x: number, y: number) => { for (const v of r.call(r.value(e.named("colour")), x, y, 0)) return (v as { fields: number[] }).fields; return []; };
  // At time 0 the picture is 3 wide around −0.7436 + 0.1318i: (0.36, −0.09) is
  // −0.204 − 0.003i, inside the set's main body; (−1, −1) is −2.24 − 1.37i, outside it.
  assert.deepEqual(at(0.36, -0.09), [0, 0, 0]);
  assert.ok(at(-1, -1).some((v) => v > 0.2));
});

// L40b step 2 (ALGEBRA-TABLES.md): Complex's · is its multiplication table
// given to table product, which is written in the language.
test("table product with complex table is the complex product, evaluated and compiled", async () => {
  const lib = (name: string) => LIBRARY.code.defs.find((d) => LIBRARY.names[d] === name)!;
  const k = new Lang(LIBRARY.code);
  const z = (re: number, im: number) => k.call(COMPLEX_V, k.lit(re), k.lit(im));
  const pairs: [number, number, number, number][] = [[1, 2, 3, -4], [0.5, 0, 0, 1], [-2, 1.5, 2, 0.25], [0, 0, 7, 7]];
  const defs = pairs.map(([a, b, c, d], i) => {
    const def = k.def(`pair ${i}`);
    k.define(def, k.thunk(() => k.list(k.call(lib("table product"), k.x(lib("complex table")), z(a, b), z(c, d)), k.call(ARITH.mul, z(a, b), z(c, d)))));
    return def;
  });
  const code = base(k.code), names = baseNames(k.names);
  const info = infer(code, names, undefined, checkOptions);
  assert.deepEqual(info.errors.filter((e) => defs.some((d) => subtree(code, d).includes(e.id))).map((e) => e.message), []);
  assert.equal(showType(info.schemes.get(lib("table product"))?.type ?? info.typeOf.get(lib("table product"))!, names), "(List (Table entry a), a, a) -> a");
  const r = makeRunner(code, info, { print: () => {} });
  const items = (v: Value): Value[] => { const out: Value[] = []; let l = v as { fields: Value[] }; while (l.fields.length) { out.push(l.fields[0]); l = l.fields[1] as { fields: Value[] }; } return out; };
  const run = (v: Value): Value => { if (typeof v !== "function") return v; for (const x of r.call(v)) return x; throw new Error("no value"); };
  for (const d of defs) {
    const [table, direct] = items(run(r.value(d))) as { fields: number[] }[];
    table.fields.forEach((x, i) => assert.ok(Math.abs(x - direct.fields[i]) < 1e-12, `${names[d]}: ${table.fields} vs ${direct.fields}`));
  }
  const path = join(mkdtempSync(join(tmpdir(), "table-")), "table.js");
  writeFileSync(path, compile(code, info, names, { runtime, exports: defs.map((d) => names[d]) }));
  const compiled = (await import(pathToFileURL(path).href)).defs as Record<string, () => Value>;
  for (const d of defs) {
    const [table, direct] = items(compiled[names[d]]()) as { fields: number[] }[];
    table.fields.forEach((x, i) => assert.ok(Math.abs(x - direct.fields[i]) < 1e-12, `compiled ${names[d]}`));
  }
});
