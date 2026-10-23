// The scalar profile compiled to WebAssembly must give exactly the
// evaluator's numbers, and refuse what it can't run, with a reason.

import { test } from "node:test";
import assert from "node:assert/strict";
import { bool, fromList, makeRunner, toList, type Value } from "../../projectional/src/lang/run.ts";
import { TRUE } from "../../projectional/src/lang/std.ts";
import { isData, lowerScalar, type LType } from "../src/scalar.ts";
import { emitWasm, instantiate } from "../src/wasm.ts";
import { load } from "../src/program.ts";
import { area } from "../src/fixtures.ts";

const first = (xs: Iterable<Value>) => { for (const x of xs) return x; };

for (const [name, expected] of [
  ["calculus", ["cubic", "wave", "kink", "bump", "cubic′", "wave′", "kink′", "bump′"]],
  ["physics", ["fall", "period"]],
] as const) {
  test(`${name}: scalar definitions compile to WebAssembly with the evaluator's exact numbers`, async () => {
    const p = load(name);
    const lowered = lowerScalar(p.code, p.info, p.pres.names, p.own.defs);
    for (const e of expected) assert.ok(lowered.funcs.some((f) => f.name === e), `${e} compiles`);
    const m = emitWasm(lowered);
    assert.ok(WebAssembly.validate(m.bytes));
    const w = await instantiate(m);
    const r = makeRunner(p.code, p.info, { print: () => {} });
    let compared = 0;
    for (const f of lowered.funcs) {
      for (const x of [-2.5, -1, 0, 0.5, 2, 3.7, 1e6]) {
        const args = f.params.map((_, i) => x + i);
        const want = first(r.call(r.value(f.def), ...args));
        const got = w[f.name](...args);
        if (f.result === "i32") assert.equal(got === 1, (want as { tag: string }).tag === "std.bool.true", `${f.name}(${args})`);
        else assert.ok(Object.is(got, want), `${f.name}(${args}): ${got} ≠ ${want}`);
        compared++;
      }
    }
    assert.ok(compared > 10);
  });
}

test("records are WasmGC structs: the ray marcher's colours in WebAssembly, exactly the evaluator's", async () => {
  const p = load("raymarch");
  const lowered = lowerScalar(p.code, p.info, p.pres.names, p.own.defs, { records: true });
  assert.deepEqual(lowered.records.map((r) => r.name), ["Vec", "Colour"]);
  const m = emitWasm(lowered);
  assert.ok(WebAssembly.validate(m.bytes));
  assert.match(m.wat, /\(type \$Colour\d+ \(struct \(field \$\w+ f64\)/);
  assert.match(m.wat, /struct\.new \$Vec/);
  const w = await instantiate(m) as unknown as Record<string, (...xs: unknown[]) => unknown>;
  const r = makeRunner(p.code, p.info, { print: () => {} });
  const colour = lowered.funcs.find((f) => f.name === "colour" && f.params.every((t) => t === "f64"))!;
  const fields = (lowered.records[1]).fields.map((x) => x.name);
  for (const [x, y, t] of [[0, 0, 0], [0.3, -0.2, 1.5], [-0.9, 0.7, 4], [0.5, 0.5, 10]]) {
    const want = first(r.call(r.value(colour.def), x, y, t)) as { fields: number[] };
    const got = w.colour(x, y, t);
    fields.forEach((name, i) => assert.ok(Object.is(w[`Colour.${name}`](got), want.fields[i]), `colour(${x}, ${y}, ${t}).${name}: ${w[`Colour.${name}`](got)} ≠ ${want.fields[i]}`));
  }
  // A generic definition at two types is exported once by its name, then by its types.
  assert.ok(m.exports.includes("plus") && m.exports.some((e) => /^plus\(/.test(e)), m.exports.join(" "));
});

// Values across the boundary, through the module's own makers and readers.
type Exports = Record<string, (...xs: unknown[]) => unknown>;
type Data = { tag: string; fields: Value[] };
const helper = (w: Exports, name: string, key: string) => w[`${name}(${key})`] ?? w[name];
function toWasm(w: Exports, v: Value, t: LType): unknown {
  if (t === "f64") return v;
  if (t === "i32") return (v as Data).tag === TRUE ? 1 : 0;
  if (!isData(t)) throw new Error("no makers for records");
  const d = v as Data, c = t.cases.find((x) => x.variant === d.tag)!;
  return helper(w, `${t.name}.${c.name}`, t.key)(...c.fields.map((x, j) => toWasm(w, d.fields[j], x.t)));
}
function fromWasm(w: Exports, x: unknown, t: LType): Value {
  if (t === "f64") return x as number;
  if (t === "i32") return bool(x === 1);
  if (!isData(t)) return { tag: t.variant, fields: t.fields.map((f) => fromWasm(w, helper(w, `${t.name}.${f.name}`, t.key)(x), f.t)) };
  const c = t.cases[helper(w, `${t.name}.case`, t.key)(x) as number];
  return { tag: c.variant, fields: c.fields.map((f) => fromWasm(w, helper(w, `${t.name}.${c.name}.${f.name}`, t.key)(x), f.t)) };
}

test("data in WebAssembly: lists, expression trees, matches and folds give the evaluator's answers", async () => {
  const cases: [string, string, () => Value[][]][] = [
    ["sort", "sort", () => [[toList([3, 1, 2, 5, -0.5, 4, 1])], [toList([])], [toList(Array.from({ length: 200 }, (_, i) => (i * 37) % 101))]]],
    ["sort", "insert", () => [[2.5, toList([1, 2, 3, 4])], [0, toList([])]]],
    ["calculus", "polynomial", () => [[toList([1, -2, 0.5]), 3], [toList([]), 1], [toList([2, 0, 0, 1]), -1.5]]],
    ["calculus", "∂polynomial/∂x", () => [[toList([1, -2, 0.5]), 3], [toList([2, 0, 0, 1]), -1.5]]],
    ["countdown", "valid", () => [0, 1, 2, 3].flatMap((k) => [[k, 6, 3], [k, 2, 4]])],
    ["countdown", "combine", () => [0, 1, 2, 3].map((k) => [k, 6, 3])],
    ["algebra", "derivative", () => []],
  ];
  for (const [name, fn, inputs] of cases) {
    const p = load(name);
    const lowered = lowerScalar(p.code, p.info, p.pres.names, p.own.defs, { data: true });
    const f = lowered.funcs.find((g) => g.name === fn && !g.inner);
    assert.ok(f, `${name}: ${fn} compiles (${lowered.refused.get(p.named(fn))})`);
    const m = emitWasm(lowered);
    assert.ok(WebAssembly.validate(m.bytes), `${name} validates`);
    const w = await instantiate(m) as unknown as Exports;
    const r = makeRunner(p.code, p.info, { print: () => {} });
    let args = inputs();
    // Op's cases by number; algebra's sample expressions from the program.
    if (name === "countdown") args = args.map(([k, ...xs]) => [{ tag: (f.params[0] as { cases: { variant: string }[] }).cases[k as number].variant, fields: [] }, ...xs]);
    if (name === "algebra") args = fromList(r.value(p.named("samples"))).map((e) => [e]);
    assert.ok(args.length);
    if (name === "countdown") assert.match(lowered.refused.get(p.named("subsequence"))!, /List of a value of any type/);
    for (const xs of args) {
      const want = first(r.call(r.value(f.def), ...xs));
      const got = fromWasm(w, w[fn](...xs.map((x, i) => toWasm(w, x, f.params[i]))), f.result);
      assert.deepStrictEqual(got, want, `${name}: ${fn}`);
    }
  }
});

test("what isn't in the profile is refused, with the reason", () => {
  const p = load("calculus");
  const { refused } = lowerScalar(p.code, p.info, p.pres.names, p.own.defs);
  const why = (n: string) => refused.get(p.named(n));
  assert.match(why("sinc")!, /Choice/);
  assert.match(why("parabola")!, /calls polynomial/);
  assert.match(why("polynomial")!, /other than Number or Bool/);
});

test("tail calls are return_call: a million steps of recursion in constant stack", async () => {
  const a = area();
  const lowered = lowerScalar(a.code, a.info, a.names, [a.integral]);
  assert.deepEqual([...lowered.refused.keys()], []);
  const m = emitWasm(lowered);
  assert.match(m.wat, /return_call \$area/);
  const w = await instantiate(m);
  const r = makeRunner(a.code, a.info, { print: () => {} });
  // Small enough for the evaluator: the same number, exactly.
  assert.ok(Object.is(w.integral(0, 0.01, 200), first(r.call(r.value(a.integral), 0, 0.01, 200))));
  // ∫₀² x³ − x − 1 dx = 4 − 2 − 2 = 0, in a million strips.
  assert.ok(Math.abs(w.integral(0, 2e-6, 1e6)) < 1e-4);
});

test("a loop that might not finish runs only under a budget, and runs out where the evaluator does", async () => {
  const a = area();
  const lowered = lowerScalar(a.code, a.info, a.names, [a.area, a.capped]);
  // The loop itself isn't a place to start: its type has Diverge.
  assert.match(lowered.refused.get(a.area)!, /may not finish \(its type has Diverge\)[\s\S]*with fuel/);
  const m = emitWasm(lowered);
  assert.deepEqual(m.exports, ["capped", "f"]);
  const w = await instantiate(m);
  const r = makeRunner(a.code, a.info, { print: () => {} });
  // Ten calls: nine strips and the call that stops. Ten strips is one too many.
  for (const steps of [0, 1, 9, 10, 11, 1e9]) {
    const want = first(r.call(r.value(a.capped), 0, 0.25, steps));
    assert.ok(Object.is(w.capped(0, 0.25, steps), want), `${steps} strips: ${w.capped(0, 0.25, steps)} in WASM, ${want} in the evaluator`);
  }
  assert.equal(w.capped(0, 0.25, 10), -1);
  assert.notEqual(w.capped(0, 0.25, 9), -1);
});
