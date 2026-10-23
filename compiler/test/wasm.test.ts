// The scalar profile compiled to WebAssembly must give exactly the
// evaluator's numbers, and refuse what it can't run, with a reason.

import { test } from "node:test";
import assert from "node:assert/strict";
import { bool, fromList, makeRunner, toList, type Value } from "../../projectional/src/lang/run.ts";
import { TRUE } from "../../projectional/src/lang/std.ts";
import { isData, isFn, isRecord, lowerScalar, type LType } from "../src/scalar.ts";
import { emitWasm, fromText, instantiate, toText } from "../src/wasm.ts";
import { load } from "../src/program.ts";
import { area, choices, closures, sameLists, texts } from "../src/fixtures.ts";

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
  if (t === "text") return toText(w, v as string);
  if (t === "i64") return BigInt(v as number | bigint);
  if (isRecord(t)) return helper(w, `${t.name}.${t.case}`, t.key)(...t.fields.map((f, j) => toWasm(w, (v as Data).fields[j], f.t)));
  if (t === "i32") return (v as Data).tag === TRUE ? 1 : 0;
  if (!isData(t)) throw new Error("no makers for functions");
  // Down a list's tails first, then built from the end, so a long one needs no stack.
  const spine: Data[] = [];
  let d = v as Data;
  for (;;) {
    const c = t.cases.find((x) => x.variant === d.tag)!, last = c.fields.length - 1;
    if (last < 0 || c.fields[last].t !== t) break;
    spine.push(d);
    d = d.fields[last] as Data;
  }
  const make = (d: Data, rest: unknown[]) => {
    const c = t.cases.find((x) => x.variant === d.tag)!;
    return helper(w, `${t.name}.${c.name}`, t.key)(...c.fields.slice(0, c.fields.length - rest.length).map((x, j) => toWasm(w, d.fields[j], x.t)), ...rest);
  };
  return spine.reduceRight((acc, x) => make(x, [acc]), make(d, []));
}
function fromWasm(w: Exports, x: unknown, t: LType): Value {
  if (t === "f64") return x as number;
  if (t === "text") return fromText(w, x);
  // An Int is a JS number while it's safe, as in the evaluator (int.ts).
  if (t === "i64") { const n = x as bigint; return n >= -(2n ** 53n) + 1n && n <= 2n ** 53n - 1n ? Number(n) : n; }
  if (t === "i32") return bool(x === 1);
  if (isFn(t)) throw new Error("no readers for functions");
  if (!isData(t)) return { tag: t.variant, fields: t.fields.map((f) => fromWasm(w, helper(w, `${t.name}.${f.name}`, t.key)(x), f.t)) };
  const c = t.cases[helper(w, `${t.name}.case`, t.key)(x) as number];
  return { tag: c.variant, fields: c.fields.map((f) => fromWasm(w, helper(w, `${t.name}.${c.name}.${f.name}`, t.key)(x), f.t)) };
}

test("data in WebAssembly: lists, expression trees, matches and folds give the evaluator's answers", async () => {
  const cases: [string, string, () => Value[][]][] = [
    ["sort", "sort", () => [[toList([3, 1, 2, 5, -0.5, 4, 1])], [toList([])], [toList(Array.from({ length: 200 }, (_, i) => (i * 37) % 101))]]],
    ["sort", "insert", () => [[2.5, toList([1, 2, 3, 4])], [0, toList([])]]],
    // A hundred thousand coefficients: the fold is a loop, in constant stack.
    ["calculus", "polynomial", () => [[toList([1, -2, 0.5]), 3], [toList([]), 1], [toList([2, 0, 0, 1]), -1.5], [toList(Array.from({ length: 1e5 }, (_, i) => (i % 7) / 1e3)), 0.999]]],
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

test("equal on data in WebAssembly: the evaluator's rule on each number, two long lists in constant stack", async () => {
  const p = sameLists();
  const lowered = lowerScalar(p.code, p.info, p.names, [p.same], { data: true });
  assert.deepEqual([...lowered.refused.keys()], []);
  const m = emitWasm(lowered);
  assert.ok(WebAssembly.validate(m.bytes));
  const w = await instantiate(m) as unknown as Exports;
  const r = makeRunner(p.code, p.info, { print: () => {} });
  const t = lowered.funcs.find((f) => f.name === "same")!.params[0];
  for (const [xs, ys] of [[[1, 2, 3], [1, 2, 3]], [[1, 2, 3], [1, 2]], [[], []], [[0.1 + 0.2], [0.3]], [[1e12], [1e12 + 1]], [[2], [3]]]) {
    const want = first(r.call(r.value(p.same), toList(xs), toList(ys)));
    assert.deepStrictEqual(fromWasm(w, w.same(toWasm(w, toList(xs), t), toWasm(w, toList(ys), t)), "i32"), want, `${xs} = ${ys}`);
  }
  // A million numbers each: the tail is a return_call.
  let a = w["List.nil"](), b = w["List.nil"]();
  for (let i = 0; i < 1e6; i++) { a = w["List.cons"](i, a); b = w["List.cons"](i, b); }
  assert.equal(w.same(a, b), 1);
});

test("functions as values in WebAssembly: closures, call_ref, a definition by name, constants", async () => {
  const p = closures();
  const lowered = lowerScalar(p.code, p.info, p.names, [p.shifted, p.squaredTwice], { data: true });
  assert.deepEqual([...lowered.refused.keys()], []);
  const m = emitWasm(lowered);
  assert.ok(WebAssembly.validate(m.bytes));
  assert.match(m.wat, /return_call_ref/);
  assert.match(m.wat, /ref\.func/);
  const w = await instantiate(m) as unknown as Exports;
  const r = makeRunner(p.code, p.info, { print: () => {} });
  for (const [d, x] of [[2, 3], [-0.5, 7], [0, 1e3]]) assert.ok(Object.is(w.shifted(d, x), first(r.call(r.value(p.shifted), d, x))), `shifted(${d}, ${x})`);
  for (const x of [3, -1.5]) assert.ok(Object.is(w["squared twice"](x), first(r.call(r.value(p.squaredTwice), x))));
  // Programs: queens' safe folds a list into a function; numbers' factorial uses a constant.
  for (const [name, fn, inputs] of [
    ["queens", "safe", [[3, toList([1, 4, 2])], [2, toList([1, 4])], [5, toList([])], [1, toList([3, 1])]]],
    ["numbers", "factorial", [0, 1, 4].map((n) => [Array.from({ length: n }).reduce<Value>((x) => ({ tag: "", fields: [x] }), { tag: "", fields: [] })])],
  ] as const) {
    const q = load(name);
    const l = lowerScalar(q.code, q.info, q.pres.names, q.own.defs, { data: true });
    const f = l.funcs.find((g) => g.name === fn && !g.inner)!;
    assert.ok(f, `${name}: ${fn} compiles`);
    const wm = await instantiate(emitWasm(l)) as unknown as Exports;
    const rr = makeRunner(q.code, q.info, { print: () => {} });
    for (let xs of inputs as unknown as Value[][]) {
      // Nat's cases by position: zero, then succ.
      if (name === "numbers") { const nat = f.params[0] as { cases: { variant: string }[] }; const fix = (v: Data): Data => (v.fields.length ? { tag: nat.cases[1].variant, fields: [fix(v.fields[0] as Data)] } : { tag: nat.cases[0].variant, fields: [] }); xs = [fix(xs[0] as Data)]; }
      const want = first(rr.call(rr.value(f.def), ...xs));
      assert.deepStrictEqual(fromWasm(wm, wm[fn](...xs.map((x, i) => toWasm(wm, x, f.params[i]))), f.result), want, `${name}: ${fn}`);
    }
  }
});

test("Int and Text in WebAssembly: the runtime gives the evaluator's answers, characters counted, not bytes", async () => {
  const p = texts();
  const lowered = lowerScalar(p.code, p.info, p.names, Object.values(p.defs), { data: true });
  assert.deepEqual([...lowered.refused.entries()], []);
  const m = emitWasm(lowered);
  assert.ok(WebAssembly.validate(m.bytes));
  const w = await instantiate(m) as unknown as Exports;
  const r = makeRunner(p.code, p.info, { print: () => {} });
  const words = ["", "a", "héllo wörld", "naïve café 🎉 ok", "a,b,,c", "aaa", "Zebra", "zebra", "日本語のテキスト"];
  const cases: Record<keyof typeof p.defs, Value[][]> = {
    sliced: words.flatMap((t) => [[t, 0, 3], [t, 2, 99], [t, -5, 1], [t, 4, 2], [t, 1, 1]]),
    length: words.map((t) => [t]),
    pieces: words.flatMap((t) => [[t, ","], [t, ""], [t, "aa"], [t, " "], [t, "ö"]]),
    chars: words.map((t) => [t]),
    before: words.flatMap((a) => words.map((b) => [a, b])),
    same: words.flatMap((a) => words.map((b) => [a, b])),
    glued: [["", ""], ["héllo", "🎉"]],
    shown: [0, -0, 1, -7, 0.5, 1 / 3, -2 / 3, 1e-6, 1.5e-7, 123456.789, 1e6 + 0.25, 2 ** 53, 1e20, 1e21, 1e300, 0.1 + 0.2, NaN, Infinity, -Infinity, 2.0000000001].map((x) => [x]),
    arith: [[0, 0], [6, 7], [-3, 5], [123456789, 1000], [2 ** 31, 2 ** 31]],
    smaller: [[1, 2], [5, -5], [0, 0]],
  };
  for (const [name, inputs] of Object.entries(cases)) {
    const def = p.defs[name as keyof typeof p.defs], f = lowered.funcs.find((g) => g.def === def)!;
    for (const xs of inputs) {
      const want = first(r.call(r.value(def), ...xs));
      const got = fromWasm(w, (w[f.name] as (...a: unknown[]) => unknown)(...xs.map((x, i) => toWasm(w, x, f.params[i]))), f.result);
      assert.deepStrictEqual(got, want, `${name}(${xs.map((x) => JSON.stringify(x)).join(", ")})`);
    }
  }
  // Past 2⁶³ an Int traps, a runtime error rather than a wrong answer (big Ints are W5).
  assert.throws(() => w.arith(2n ** 62n, 4n), WebAssembly.RuntimeError);
  // Programs: wc's and chapters' text functions, the evaluator's answers.
  for (const [name, fn, inputs] of [
    ["wc", "blank", [[""], ["  "], ["a b"], ["\t x"]]],
    ["wc", "pad", [[0], [7], [12345], [-3]]],
    ["chapters", "two digits", [[0], [5], [42], [123]]],
    ["ledger", "money", [[0], [5], [1234567], [-250], [-5]]],
    ["ledger", "pad", [["7", 3], ["12345", 2], ["", 4]]],
    ["ledger", "with point", [["12345"], ["5"], ["123"]]],
  ] as const) {
    const q = load(name);
    const l = lowerScalar(q.code, q.info, q.pres.names, q.own.defs, { data: true });
    const f = l.funcs.find((g) => g.name === fn && !g.inner)!;
    assert.ok(f, `${name}: ${fn} compiles`);
    const wm = await instantiate(emitWasm(l)) as unknown as Exports;
    const rr = makeRunner(q.code, q.info, { print: () => {} });
    for (const xs of inputs as unknown as Value[][]) {
      const want = first(rr.call(rr.value(f.def), ...xs));
      assert.deepStrictEqual(fromWasm(wm, wm[fn](...xs.map((x, i) => toWasm(wm, x, f.params[i]))), f.result), want, `${name}: ${fn}(${xs})`);
    }
  }
});

test("one answer or none in WebAssembly: a status after the answer, handlers as blocks, the evaluator's answers", async () => {
  const p = choices();
  const lowered = lowerScalar(p.code, p.info, p.names, Object.values(p.defs), { data: true });
  assert.deepEqual([...lowered.refused.entries()], []);
  const m = emitWasm(lowered);
  assert.ok(WebAssembly.validate(m.bytes));
  // index calls itself in tail position: a partial function's tail call stays one.
  assert.match(m.wat, /return_call \$index\d+/);
  const w = await instantiate(m) as unknown as Exports;
  const r = makeRunner(p.code, p.info, { print: () => {} });
  const ints = [0, 1, -1, 2, -2, 3, 7, -7, 10, 2 ** 31, -(2 ** 31), 2 ** 40 + 3];
  const texts = ["", "0", "-0", "00", "007", "42", "-42", "+5", "4 2", "-", "9223372036854775807", "-9223372036854775808", "12a", "a", "é", "日", "🎉", "ab", "héllo wörld", "a🎉b"];
  const codes = [-1, 0, 65, 127, 128, 233, 2047, 2048, 0xd7ff, 0xd800, 0xdfff, 0xe000, 0xffff, 0x10000, 0x1f389, 0x10ffff, 0x110000];
  const lists = [[], ["1", "2", "3"], ["4", "x", "5"], ["-0"], Array.from({ length: 1e4 }, (_, i) => String(i))].map((xs) => toList(xs));
  const cases: Record<keyof typeof p.defs, Value[][]> = {
    quotient: ints.flatMap((a) => ints.map((b) => [a, b])),
    remainder: ints.flatMap((a) => ints.map((b) => [a, b])),
    power: [[2, 10], [-3, 3], [0, 0], [5, -1], [-1, 63], [1, 2 ** 40], [2, 62], [-2, 63], [10, 18]],
    whole: [0, -0, 0.5, -0.5, 3.99, -3.01, 1e15 + 0.5, 2 ** 60, NaN, Infinity, -Infinity].map((x) => [x]),
    reread: texts.map((t) => [t]),
    found: ["", "abc", "héllo wörld", "a🎉b🎉c", "aaa"].flatMap((t) => ["", "a", "b", "ö", "🎉", "c", "wörld", "aa", "zz"].map((q) => [t, q])),
    code: texts.map((t) => [t]),
    character: codes.map((n) => [n]),
    position: ["1", "3", "x", "9999", "nope"].flatMap((key) => lists.map((xs) => [key, xs])),
    sums: lists.map((xs) => [xs]),
    readable: texts.map((t) => [t]),
    unwrapped: texts.map((t) => [t]),
    plusOne: texts.filter((t) => t !== "9223372036854775807").map((t) => [t]),
    budgeted: [-1, 0, 1, 3, 4, 5, 6, 100].map((n) => [n]),
    inside: [-1, 0, 1, 3, 4, 5, 6, 100].map((n) => [n]),
  };
  let compared = 0;
  for (const [name, inputs] of Object.entries(cases)) {
    const def = p.defs[name as keyof typeof p.defs], f = lowered.funcs.find((g) => g.def === def)!;
    for (const xs of inputs) {
      const want = first(r.call(r.value(def), ...xs));
      let got: unknown = (w[f.name] as (...a: unknown[]) => unknown)(...xs.map((x, i) => toWasm(w, x, f.params[i])));
      // A partial function's answer comes with its status.
      if (f.partial) { const [v, status] = got as [unknown, number]; got = status === 0 ? fromWasm(w, v, f.result) : undefined; }
      else got = fromWasm(w, got, f.result);
      assert.deepStrictEqual(got, want, `${name}(${xs.map((x) => (typeof x === "object" ? "[list]" : JSON.stringify(x))).join(", ")})`);
      compared++;
    }
  }
  assert.ok(compared > 500);
  assert.ok(lowered.funcs.find((g) => g.def === p.defs.plusOne)!.partial);
  // Past 2⁶³ an Int traps (big Ints are W5): reading one, or the smallest over -1.
  assert.throws(() => w["reread"](toText(w, "9223372036854775808")), WebAssembly.RuntimeError);
  assert.throws(() => w["quotient of"](-(2n ** 63n), -1n), WebAssembly.RuntimeError);
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
