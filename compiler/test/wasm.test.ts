// The scalar profile compiled to WebAssembly must give exactly the
// evaluator's numbers, and refuse what it can't run, with a reason.

import { test } from "node:test";
import assert from "node:assert/strict";
import { Aborted, bool, fromList, makeRunner, runProgram, toList, type Value, type World } from "../../projectional/src/lang/run.ts";
import { TRUE } from "../../projectional/src/lang/std.ts";
import { norm } from "../../projectional/src/lang/int.ts";
import { isData, isFn, isRecord, lowerScalar, type LType } from "../src/scalar.ts";
import { emitWasm, fromInt, fromText, instantiate, runMain, toInt, toText } from "../src/wasm.ts";
import { load } from "../src/program.ts";
import { area, choices, recursiveLets, closures, escapes, fractionInputs, fractions, maths, ordered, orderedInputs, roses, sameLists, searches, several, texts, worldly } from "../src/fixtures.ts";
import { nodeWorld } from "../../projectional/src/lang/world.ts";
import { WASI } from "node:wasi";
import { closeSync, mkdirSync, mkdtempSync, openSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { book } from "../gaps/ledger.ts";

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
  assert.ok(m.exports.includes("scale") && m.exports.some((e) => /^scale\(/.test(e)), m.exports.join(" "));
});

// Values across the boundary, through the module's own makers and readers.
type Exports = Record<string, (...xs: unknown[]) => unknown>;
type Data = { tag: string; fields: Value[] };
const helper = (w: Exports, name: string, key: string) => w[`${name}(${key})`] ?? w[name];
function toWasm(w: Exports, v: Value, t: LType): unknown {
  if (t === "f64") return v;
  if (t === "text") return toText(w, v as string);
  if (t === "int") return toInt(w, BigInt(v as number | bigint));
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
  if (t === "int") return norm(fromInt(w, x));
  if (t === "i32") return bool(x === 1);
  if (isFn(t)) throw new Error("no readers for functions");
  if (!isData(t)) return { tag: t.variant, fields: t.fields.map((f) => fromWasm(w, helper(w, `${t.name}.${f.name}`, t.key)(x), f.t)) };
  // Along a list's tails iteratively, so a long one needs no stack.
  const top: Data = { tag: "", fields: [] };
  let into = top, at = x;
  for (;;) {
    const c = t.cases[helper(w, `${t.name}.case`, t.key)(at) as number], last = c.fields.length - 1;
    const read = (j: number) => helper(w, `${t.name}.${c.name}.${c.fields[j].name}`, t.key)(at);
    const d: Data = { tag: c.variant, fields: c.fields.map((f, j) => (j === last && f.t === t ? null : fromWasm(w, read(j), f.t))) as Value[] };
    into.fields.push(d);
    if (last < 0 || c.fields[last].t !== t) return top.fields[0];
    at = read(last);
    d.fields.pop();
    into = d;
  }
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
  for (const [xs, ys] of [[[1, 2, 3], [1, 2, 3]], [[1, 2, 3], [1, 2]], [[], []], [[0.1 + 0.2], [0.3]], [[1e12], [1e12 + 1]], [[2], [3]], [[Infinity], [-Infinity]], [[1e308], [Infinity]], [[Infinity], [Infinity]], [[1e308], [-1e308]]]) {
    const want = first(r.call(r.value(p.same), toList(xs), toList(ys)));
    assert.deepStrictEqual(fromWasm(w, w.same(toWasm(w, toList(xs), t), toWasm(w, toList(ys), t)), "i32"), want, `${xs} = ${ys}`);
  }
  // A million numbers each: the tail is a return_call.
  let a = w["List.nil"](), b = w["List.nil"]();
  for (let i = 0; i < 1e6; i++) { a = w["List.cons"](i, a); b = w["List.cons"](i, b); }
  assert.equal(w.same(a, b), 1);
});

test("folds over nested data in WebAssembly: a rose tree's List of children, a grove's List of Lists, the evaluator's answers", async () => {
  const p = roses();
  const lowered = lowerScalar(p.code, p.info, p.names, Object.values(p.defs), { data: true });
  assert.deepEqual([...lowered.refused.entries()], []);
  const w = await instantiate(emitWasm(lowered)) as unknown as Exports;
  const r = makeRunner(p.code, p.info, { print: () => {} });
  const node = (v: number, ...kids: Value[]): Value => ({ tag: p.rose.v.node, fields: [v, toList(kids)] });
  const leaf = (v: number): Value => ({ tag: p.grove.v.leaf, fields: [v] });
  const rows = (...xs: Value[][]): Value => ({ tag: p.grove.v.rows, fields: [toList(xs.map(toList))] });
  let n = 0;
  const grow = (d: number): Value => node(n++ % 7 - 3, ...Array.from({ length: d > 0 ? (n * 5) % 4 : 0 }, () => grow(d - 1)));
  const trees = [node(1), node(1, node(2), node(3, node(4))), grow(4), grow(6),
    node(0, ...Array.from({ length: 50_000 }, (_, i) => node(i))), Array.from({ length: 300 }, (_, i) => i).reduce((t, i) => node(i, t), node(-1))];
  const groves = [leaf(5), rows(), rows([], [leaf(1)]), rows([leaf(1), rows([leaf(2), leaf(3)], [])], [rows([leaf(4)])])];
  const cases: [keyof typeof p.defs, Value[][]][] = [
    ["total", trees.map((t) => [t])], ["depth", trees.map((t) => [t])], ["mirror", trees.slice(0, 4).map((t) => [t])],
    ["scaled", trees.map((t) => [3, t])], ["groveTotal", groves.map((g) => [g])],
    ["ways", trees.slice(0, 2).map((t) => [t])], ["firstOver", [5, 9, 100].flatMap((x) => trees.slice(0, 2).map((t) => [x, t]))],
  ];
  for (const [name, inputs] of cases) {
    const def = p.defs[name], f = lowered.funcs.find((g) => g.def === def)!;
    for (const xs of inputs) {
      const want = first(r.call(r.value(def), ...xs));
      const got = fromWasm(w, (w[f.name] as (...a: unknown[]) => unknown)(...xs.map((x, i) => toWasm(w, x, f.params[i]))), f.result);
      assert.deepStrictEqual(got, want, name);
    }
  }
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

// Ints past an i64 (W5b): around each edge (i31, i64), and random ones of up to 300 bits.
const bigs = (() => {
  let seed = 12345n;
  const next = () => (seed = (seed * 6364136223846793005n + 1442695040888963407n) % 2n ** 64n);
  const edges = [2n ** 30n, 2n ** 31n, 2n ** 32n, 2n ** 62n, 2n ** 63n, 2n ** 64n, 2n ** 96n, 10n ** 18n, 10n ** 19n].flatMap((x) => [x - 1n, x, x + 1n]);
  const random = Array.from({ length: 24 }, (_, i) => { let v = 0n; for (let j = 0; j <= i % 5; j++) v = (v << 64n) | next(); return v >> (next() % 64n); });
  return [...edges, ...random].flatMap((x) => [x, -x]);
})();
// As the evaluator spells them (int.ts): a number while it's safe.
// Big divisions (W5c): by one limb and by several, signs every way, and
// quotients whose first guess is too big (Knuth's D6, with v's top limb just over half).
const divisions = [...bigs.flatMap((a, i) => [[a, bigs[(i * 5 + 1) % bigs.length]], [a, 7n], [a, -(2n ** 32n) + 1n], [a * 3n + 1n, a], [-(2n ** 63n), -1n]]),
  [2n ** 128n - 1n, 2n ** 64n + 1n], [2n ** 96n, (2n ** 63n + 1n) * 2n ** 32n + 2n ** 31n], [0x7fffffff800000010000000000000000n, 0x800000000000000000000003n],
  [0x800000000000000000000000n * 0x10000n - 1n, 0x800000000000000000000001n]].map((xs) => xs.map(norm));
const bigPairs = bigs.flatMap((a, i) => [[a, bigs[(i * 7 + 3) % bigs.length]], [a, a], [a, 3n], [-(2n ** 63n), a]].map((xs) => xs.map(norm)));

// BACKLOG C49: a fold over characters named by a let first is fused too.
test("a fold over characters named by a let first walks the text in WebAssembly, with no list", async () => {
  const { Lang } = await import("../../projectional/src/lang/dsl.ts");
  const { LIBRARY } = await import("../../projectional/src/lang/library.ts");
  const { base, baseNames } = await import("../../projectional/src/lang/load.ts");
  const { infer } = await import("../../projectional/src/lang/infer.ts");
  const { CONS, INT_OPS, NIL, S, TEXT_OPS } = await import("../../projectional/src/lang/std.ts");
  const k = new Lang(LIBRARY.code);
  const count = k.def("count");
  k.define(count, k.fn(["t"], (t) => k.let("cs", k.call(TEXT_OPS.characters, k.call(S.concat, t, k.lit(""))), (cs) => k.fold(cs, [
    { variant: NIL, names: [], body: () => k.int(0) },
    { variant: CONS, names: ["c", "rest"], results: [null, "r"], body: (_, [, r]) => k.call(INT_OPS.add, r!, k.int(1)) },
  ]))));
  const code = base(k.code), names = { ...baseNames(), ...k.names }, info = infer(code, names);
  const lowered = lowerScalar(code, info, names, [count], { data: true });
  assert.deepEqual([...lowered.refused.entries()], []);
  const m = emitWasm(lowered);
  assert.match(m.wat, /fold\.characters/);
  const w = await instantiate(m) as unknown as Exports;
  const r = makeRunner(code, info, { print: () => {} });
  const f = lowered.funcs.find((g) => g.def === count)!;
  for (const t of ["", "héllo 🎉"]) assert.equal(flat(answer(w, f, (w[f.name] as (...a: unknown[]) => unknown)(toWasm(w, t, "text")))), flat(outcome(r, count, [t])));
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
    shown: [0, -0, 1, -7, 0.5, 1 / 3, -2 / 3, 1e-6, 1.5e-7, 123456.789, 1e6 + 0.25, 2 ** 53, 1e20, 1e21, 1e300, 0.1 + 0.2, NaN, Infinity, -Infinity, 2.0000000001,
      // Written by the runtime: tiny ones as JavaScript does (1e-7 and below), wholes below 2⁵³; the rest by the host.
      1e-7, -1e-7, 1.5e-7, 5.5e-8, 1e-9, -9.99e-7, 1.23e-8, 9.99e-9, 1e-10, -1e-10, 4.9e-10, 5e-10, -5e-10, 3e-300, 5e-324, 1e-6 - 1e-22, 2 ** 53 - 1, 2 ** 53 + 2, -(2 ** 60), 9.3e18, 123456789012345, 1234567890123.5].map((x) => [x]),
    arith: [[0, 0], [6, 7], [-3, 5], [123456789, 1000], [2 ** 31, 2 ** 31], ...bigPairs],
    smaller: [[1, 2], [5, -5], [0, 0], ...bigPairs],
    sameInt: [[1, 1], [-1, 1], [0, 0], ...bigPairs, ...bigs.map((x) => [norm(x), norm(x < 0n ? -x : x)])],
    // mod, from musl's fmod: exact, b's sign, NaN and the infinities as JavaScript's.
    remainder: [7, -7, 0, -0, 0.5, 1e300, -1e-300, 5e-324, 2 ** 53 + 1, NaN, Infinity, -Infinity, 1e22, 0.1, 6.283185307179586].flatMap((a) =>
      [3, -3, 0.1, 2.5, 1e-310, 5e-324, 1e300, 2 ** -1074 * 3, Infinity, -Infinity, NaN, 0, 1 / 3].map((b) => [a, b])),
  };
  for (const [name, inputs] of Object.entries(cases)) {
    const def = p.defs[name as keyof typeof p.defs], f = lowered.funcs.find((g) => g.def === def)!;
    for (const xs of inputs) {
      const want = first(r.call(r.value(def), ...xs));
      const got = fromWasm(w, (w[f.name] as (...a: unknown[]) => unknown)(...xs.map((x, i) => toWasm(w, x, f.params[i]))), f.result);
      assert.deepStrictEqual(got, want, `${name}(${xs.map((x) => (typeof x === "bigint" ? `${x}n` : JSON.stringify(x))).join(", ")})`);
    }
  }
  // mod is the module's own: alone it imports nothing, not even texts.
  const alone = emitWasm(lowerScalar(p.code, p.info, p.names, [p.defs.remainder], { data: true }));
  assert.ok(!alone.wat.includes("(import") && !alone.wat.includes("$bytes"), "mod needs no host");
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

// Ryū's shortest digits (wasm-rt.ts number.js), which show uses past the
// plain decimals, so no host is asked: JavaScript's own String, on every
// binary exponent, the decimal powers, and random bit patterns.
test("a Float64's text in WebAssembly is JavaScript's String: the shortest digits that read back, with no host", async () => {
  const p = texts();
  const m = emitWasm(lowerScalar(p.code, p.info, p.names, [p.defs.shown], { data: true }));
  assert.deepEqual(WebAssembly.Module.imports(new WebAssembly.Module(m.bytes)), []);
  const w = await instantiate(m) as unknown as Exports;
  const text = (x: number) => fromText(w, (w["Number.text"] as (x: number) => unknown)(x));
  const bits = new Float64Array(1), word = new Uint32Array(bits.buffer);
  const xs = [0, -0, 0.1, 0.2 + 0.1, 1 / 3, 5e-324, -5e-324, 1.7976931348623157e308, 2.2250738585072014e-308, 2.225073858507201e-308, 1e21, 1e-7, 1e-6, 1e22, 1e23, 2 ** 60, 2 ** 64, 4.35, 5e-310, NaN, Infinity, -Infinity];
  for (let e = -1074; e < 1024; e++) for (const d of [1, 3, 0.75]) xs.push(d * 2 ** e, -d * 2 ** e);
  for (let i = 1; i < 10; i++) for (let k = -324; k < 309; k++) xs.push(Number(`${i}e${k}`));
  let seed = 1;
  const next = () => (seed = (Math.imul(seed, 1103515245) + 12345) >>> 0);
  for (let i = 0; i < 20000; i++) { word[0] = next() ^ (next() << 16); word[1] = next() ^ (next() << 16); xs.push(bits[0]); }
  for (const x of xs) assert.equal(text(x), String(x));
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
  // Ints in their one spelling (int.ts): past 2^28 a BigInt.
  const ints = [0, 1, -1, 2, -2, 3, 7, -7, 10, 2 ** 31, -(2 ** 31), 2 ** 40 + 3].map((x) => norm(BigInt(x)));
  const texts = ["", "0", "-0", "00", "007", "42", "-42", "+5", "4 2", "-", "9223372036854775807", "-9223372036854775808", "12a", "a", "é", "日", "🎉", "ab", "héllo wörld", "a🎉b"];
  const codes = [-1, 0, 65, 127, 128, 233, 2047, 2048, 0xd7ff, 0xd800, 0xdfff, 0xe000, 0xffff, 0x10000, 0x1f389, 0x10ffff, 0x110000];
  const lists = [[], ["1", "2", "3"], ["4", "x", "5"], ["-0"], Array.from({ length: 1e4 }, (_, i) => String(i))].map((xs) => toList(xs));
  const cases: Record<keyof typeof p.defs, Value[][]> = {
    quotient: [...ints.flatMap((a) => ints.map((b) => [a, b])), ...divisions],
    remainder: [...ints.flatMap((a) => ints.map((b) => [a, b])), ...divisions],
    power: [[2, 10], [-3, 3], [0, 0], [5, -1], [-1, 63], [1, 2 ** 40], [2, 62], [-2, 63], [10, 18], [2, 64], [-3, 200], [10n ** 20n, 7], [7, 1000],
      [0, 2n ** 70n], [1, 2n ** 70n], [-1, 2n ** 70n], [-1, 2n ** 70n + 1n], [5, -(2n ** 70n)]].map((xs) => xs.map((x) => norm(BigInt(x)))),
    whole: [0, -0, 0.5, -0.5, 3.99, -3.01, 1e15 + 0.5, 2 ** 60, 2 ** 63, -(2 ** 63), 2 ** 64 + 4096, -1.5e19, 1e300, -Number.MAX_VALUE, NaN, Infinity, -Infinity].map((x) => [x]),
    reread: [...texts, ...bigs.map(String), "9223372036854775808", "-9223372036854775809", "0123456789012345678901", "-", "12345678901234567890x"].map((t) => [t]),
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
      assert.deepStrictEqual(got, want, `${name}(${xs.map((x) => (typeof x === "object" ? "[list]" : typeof x === "bigint" ? `${x}n` : JSON.stringify(x))).join(", ")})`);
      compared++;
    }
  }
  assert.ok(compared > 500);
  assert.ok(lowered.funcs.find((g) => g.def === p.defs.plusOne)!.partial);
});

// A value as text without recursion, to compare long lists.
function flat(v: unknown): string {
  const out: string[] = [], todo: unknown[] = [v];
  while (todo.length) {
    const x = todo.pop();
    if (x && typeof x === "object" && "tag" in x) { out.push(`(${(x as Data).tag}`); todo.push(")", ...[...(x as Data).fields].reverse()); }
    else out.push(x === ")" ? ")" : typeof x === "bigint" ? `${x}n` : JSON.stringify(x) ?? "undefined");
  }
  return out.join(" ");
}
// A partial function's answer comes with its status; none is undefined, as first() of no answers.
// An abort (status 2) is its reason, as the evaluator's Aborted is.
function answer(w: Exports, f: { partial?: boolean; result: LType }, got: unknown): Value | { aborted: string } | undefined {
  if (!f.partial) return fromWasm(w, got, f.result);
  const [v, status] = got as [unknown, number];
  return status === 0 ? fromWasm(w, v, f.result) : status === 2 ? { aborted: fromText(w, w["Abort.reason"]()) } : undefined;
}
function outcome(r: ReturnType<typeof makeRunner>, def: string, xs: Value[]): Value | { aborted: string } | undefined {
  try { return first(r.call(r.value(def), ...xs)); } catch (e) { if (e instanceof Aborted) return { aborted: e.reason }; throw e; }
}

test("a program's own effects that never return, in WebAssembly as Abort is: handled, through other handlers and first, an arm performing its sibling", async () => {
  const p = escapes();
  const lowered = lowerScalar(p.code, p.info, p.names, Object.values(p.defs), { data: true });
  assert.deepEqual([...lowered.refused.entries()], []);
  const m = emitWasm(lowered);
  assert.ok(WebAssembly.validate(m.bytes));
  const w = await instantiate(m) as unknown as Exports;
  const r = makeRunner(p.code, p.info, { print: () => {} });
  for (const def of Object.values(p.defs)) {
    const f = lowered.funcs.find((g) => g.def === def)!;
    for (const t of ["", "x", "a", "y", "q", "b"]) {
      const got = answer(w, f, (w[f.name] as (...a: unknown[]) => unknown)(toWasm(w, t, "text")));
      assert.equal(flat(got), flat(outcome(r, def, [t])), `${p.names[def]}(${JSON.stringify(t)})`);
    }
  }
});

test("choosing one of a list in WebAssembly: a loop per choice, keep with a test that may have none, chapters' and calc's functions", async () => {
  const p = searches();
  const lowered = lowerScalar(p.code, p.info, p.names, Object.values(p.defs), { data: true });
  assert.deepEqual([...lowered.refused.entries()], []);
  const m = emitWasm(lowered);
  assert.ok(WebAssembly.validate(m.bytes));
  // The loop over the list is a tail call to itself, so long lists run in constant stack.
  assert.match(m.wat, /return_call \$\w+choose\d+/);
  const w = await instantiate(m) as unknown as Exports;
  const r = makeRunner(p.code, p.info, { print: () => {} });
  const lists = [[], ["1"], ["3", "x", "5", "2", "007", "9"], ["b", "a", "c"], ["é", "e", "🎉"], Array.from({ length: 2e4 }, (_, i) => String(i % 50))].map((xs) => toList(xs));
  const short = lists.slice(0, 5);
  const cases: Record<keyof typeof p.defs, Value[][]> = {
    kept: lists.map((xs) => [xs]),
    pairs: short.flatMap((xs) => short.map((ys) => [xs, ys])),
    many: short.flatMap((xs) => short.map((ys) => [xs, ys])),
    firstPair: short.flatMap((xs) => short.map((ys) => [xs, ys])),
    some: short.flatMap((xs) => short.map((ys) => [xs, ys])),
    read: lists.map((xs) => [xs]),
    readCount: lists.map((xs) => [xs]),
    // map is a recursion that isn't a tail call (not a fold), so short lists.
    mapped: short.map((xs) => [xs]),
    applied: ["", "12", "-3", "x", "05"].map((t) => [t]),
    caught: ["", "12", "x", "y"].map((t) => [t]),
    budgetAbort: [-1, 0, 3, 4, 5, 9].map((n) => [n]),
    uncaught: ["", "12", "y"].map((t) => [t]),
  };
  for (const [name, inputs] of Object.entries(cases)) {
    const def = p.defs[name as keyof typeof p.defs], f = lowered.funcs.find((g) => g.def === def)!;
    for (const xs of inputs) {
      const want = outcome(r, def, xs);
      const got = answer(w, f, (w[f.name] as (...a: unknown[]) => unknown)(...xs.map((x, i) => toWasm(w, x, f.params[i]))));
      assert.equal(flat(got), flat(want), `${name}(${xs.map((x) => (typeof x === "object" ? "[list]" : JSON.stringify(x))).join(", ")})`);
    }
  }
  // Programs: every function of chapters and calc that takes texts, Ints and lists of texts.
  const lines = ["# One", "## Two words here", "plain text, with words.", "", "   ", "#", "Ünïcode Héading 🎉", "1. numbered", "1 + 2*3", "(x - 4) / y", "  12.5^2 ", "a = 3", "!?"];
  const pool: Record<string, Value[]> = { text: lines, int: [0, 3, 12], "std.list<type.string<>>": [toList([]), toList(lines.slice(0, 4)), toList(lines)] };
  for (const name of ["chapters", "calc"]) {
    const q = load(name);
    const l = lowerScalar(q.code, q.info, q.pres.names, q.own.defs, { data: true });
    assert.deepEqual([...l.refused.entries()].filter(([, why]) => /one of|Choice/.test(why)), [], `${name}: nothing refused for its searches`);
    // Each with a world of its own, which the same calls change the same way.
    const wm = await instantiate(emitWasm(l), fakeWorld({}, "").rt) as unknown as Exports;
    const rr = makeRunner(q.code, q.info, fakeWorld({}, "").rt);
    let compared = 0;
    for (const f of l.funcs) {
      const keys = f.params.map((t) => (typeof t === "string" ? t : t.key));
      if (f.inner || !f.params.length || !keys.every((k) => pool[k])) continue;
      const inputs = keys.reduce<Value[][]>((acc, k) => acc.flatMap((xs) => pool[k].map((v) => [...xs, v])), [[]]).slice(0, 60);
      for (const xs of inputs) {
        const want = outcome(rr, f.def, xs);
        const got = answer(wm, f, wm[f.name](...xs.map((x, i) => toWasm(wm, x, f.params[i]))));
        assert.deepStrictEqual(got, want, `${name}: ${f.name}(${xs.map((x) => (typeof x === "object" ? "[list]" : JSON.stringify(x))).join(", ")})`);
        compared++;
      }
    }
    assert.ok(compared > 20, `${name}: ${compared} compared`);
  }
});

test("Abort in WebAssembly: status 2 and a reason, through first and budgets; calc parses and ledger reads and reports as the evaluator does", async () => {
  // calc: tokens, then the parser (which aborts on what it can't read), then evaluate.
  const calc = load("calc");
  const lc = lowerScalar(calc.code, calc.info, calc.pres.names, calc.own.defs, { data: true });
  for (const fn of ["tokens", "whole expression", "evaluate"]) assert.ok(lc.funcs.some((g) => g.name === fn && !g.inner), `calc: ${fn} compiles (${lc.refused.get(calc.named(fn))})`);
  const wc = await instantiate(emitWasm(lc)) as unknown as Exports;
  const rc = makeRunner(calc.code, calc.info, { print: () => {} });
  const fnOf = (l: typeof lc, name: string) => l.funcs.find((g) => g.name === name && !g.inner)!;
  const [tokens, whole, evaluate] = ["tokens", "whole expression", "evaluate"].map((x) => fnOf(lc, x));
  let aborted = 0;
  for (const line of ["1 + 2*3", "(1+2)*3", "2^10", "2^-1", "7 - -2", "10 / 3", "10 / 0", "x", "1 +", ")", "((4))", "", "3 4", "1+2+3+4+5+6+7+8+9", "-(2*3)^2"]) {
    const t = first(rc.call(rc.value(tokens.def), line))!;
    const wt = wc.tokens(toText(wc, line));
    assert.equal(flat(fromWasm(wc, wt, tokens.result)), flat(t), `tokens(${line})`);
    const e = outcome(rc, whole.def, [t]);
    const we = wc["whole expression"](wt) as [unknown, number];
    assert.equal(flat(answer(wc, whole, we)), flat(e), `whole expression(${line})`);
    if (e && typeof e === "object" && "aborted" in e) { aborted++; continue; }
    const none = toList([]);
    assert.equal(flat(answer(wc, evaluate, wc.evaluate(we[0], toWasm(wc, none, evaluate.params[1])))), flat(outcome(rc, evaluate.def, [e as Value, none])), `evaluate(${line})`);
  }
  assert.ok(aborted >= 3, `${aborted} lines abort`);
  // ledger: the lines of a file into entries (aborting on a bad one), then the report.
  const ledger = load("ledger");
  const ll = lowerScalar(ledger.code, ledger.info, ledger.pres.names, ledger.own.defs, { data: true });
  const wl = await instantiate(emitWasm(ll)) as unknown as Exports;
  const rl = makeRunner(ledger.code, ledger.info, { print: () => {} });
  const [entries, report] = ["entries", "report"].map((x) => fnOf(ll, x));
  // book(15000): past the stack before entries became a loop (C24).
  for (const file of ["# a comment\n2026-09-01,salary,350000,pay\n2026-09-02,rent,-120000,flat\n\n2026-10-03,coffee,-450,beans\n2026-10-07,coffee,-5,gum\n", book(2000), book(15000), "2026-01-01,a,1,x\n2026-01-02,b,2\n", "2026-01-01,a,1,x,y\n", "\n2026-01-01,a,1.5,x\n"]) {
    const lines = toList(file.split("\n"));
    const want = outcome(rl, entries.def, [lines, 1]);
    const got = wl.entries(toWasm(wl, lines, entries.params[0]), wl["Int.of"](1n)) as [unknown, number];
    assert.equal(flat(answer(wl, entries, got)), flat(want), `entries of a file of ${file.length} bytes`);
    if (want && typeof want === "object" && "aborted" in want) continue;
    assert.equal(answer(wl, report, wl.report(got[0])), outcome(rl, report.def, [want as Value]), "report");
  }
});

test("what isn't in the profile is refused, with the reason", () => {
  const p = load("calculus");
  const { refused } = lowerScalar(p.code, p.info, p.pres.names, p.own.defs);
  const why = (n: string) => refused.get(p.named(n));
  assert.match(why("sinc")!, /Choice/);
  // polynomial takes its coefficients as a list, so it isn't in the
  // profile; parabola gives it a list written down, so its call is worked
  // out when compiled (stage.ts, C65) and is plain arithmetic.
  assert.match(why("polynomial")!, /other than Float64 or Bool/);
  assert.equal(why("parabola"), undefined);
});

test("Math with no JavaScript host: V8's fdlibm in WebAssembly, the same bits as Node's Math", async () => {
  const p = maths();
  const lowered = lowerScalar(p.code, p.info, p.names, Object.values(p.defs), { data: true });
  const m = emitWasm(lowered, { wasi: true });
  assert.ok(!m.wat.includes(`(import "Math"`), "no Math imported");
  const stub = new Proxy({}, { get: () => () => 0 });
  const { instance } = await WebAssembly.instantiate(m.bytes, { wasi_snapshot_preview1: stub }) as unknown as { instance: { exports: Exports } };
  const w = instance.exports;
  const F = { sin: Math.sin, cos: Math.cos, tan: Math.tan, exp: Math.exp, log: Math.log, pow: Math.pow, atan2: Math.atan2 } as Record<string, (x: number, y: number) => number>;
  let seed = 7n;
  const next = () => Number((seed = (seed * 6364136223846793005n + 1442695040888963407n) % 2n ** 64n) >> 11n) / 2 ** 53;
  const anyBits = () => new Float64Array(new BigUint64Array([BigInt(Math.floor(next() * 2 ** 32)) << 32n | BigInt(Math.floor(next() * 2 ** 32))]).buffer)[0];
  // Small, around a period, large (rem_pio2's long path past 2²⁰·π/2), tiny, the edges, and any bits at all.
  const pick = () => { const k = next(); return k < 0.3 ? (next() - 0.5) * 20 : k < 0.5 ? (next() - 0.5) * 2e7 : k < 0.6 ? next() * 1e-5 : k < 0.65 ? [0, -0, NaN, Infinity, -Infinity, 1, -1, 0.5, 2, 1e22, 1e300, 5e-324][Math.floor(next() * 12)] : anyBits(); };
  for (const [op, f] of Object.entries(F)) {
    const fn = lowered.funcs.find((g) => g.def === p.defs[op as keyof typeof p.defs])!.name;
    for (let i = 0; i < 20000; i++) {
      const x = pick(), y = op === "pow" && next() < 0.4 ? Math.round(pick() % 20) : pick();
      assert.ok(Object.is(w[fn](x, y), f(x, y)), `${op}(${x}, ${y}): ${w[fn](x, y)}, not ${f(x, y)}`);
    }
  }
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

// A world in memory: files in a map, input from a string, everything written collected.
function fakeWorld(files: Record<string, string>, input: string) {
  const lines = input.split("\n");
  const out = { printed: [] as string[], errors: [] as string[], files: { ...files } };
  const world: Partial<World> = {
    error: (l) => out.errors.push(l), input: () => input,
    readLine: () => (lines.length > 1 || lines[0] ? lines.shift()! : null),
    readFile: (p) => { if (!(p in out.files)) throw new Error(`no such file: ${p}`); return out.files[p]; },
    writeFile: (p, t) => { out.files[p] = t; }, appendFile: (p, t) => { out.files[p] = (out.files[p] ?? "") + t; },
    fileExists: (p) => p in out.files, listFolder: () => Object.keys(out.files).sort(),
  };
  return { rt: { print: (s: string) => out.printed.push(s), world }, out };
}

test("whole programs in WebAssembly: wc, ledger, chapters and calc's mains print, write files and exit as the evaluator's do", async () => {
  const files = {
    "a.txt": "one two\nthree\n", "book.md": "# One\nhello world\n# Two\nmore words here\n",
    "sums.txt": "1+2\nlet x = 3\nx*x\n1 +\n", "ledger.csv": "2026-09-01,salary,350000,pay\n2026-09-02,rent,-120000,flat\n", "big.csv": book(500),
    "u.txt": "naïve café 🎉 ok\n日本語\n",
  };
  const argsets = [[], ["a.txt"], ["u.txt"], ["-l", "a.txt", "nope"], ["-w", "-c", "book.md"], ["book.md", "out"], ["sums.txt"], ["ledger.csv"], ["big.csv"], ["nope"]];
  for (const name of ["wc", "ledger", "chapters", "calc"]) {
    const p = load(name);
    const l = lowerScalar(p.code, p.info, p.pres.names, p.own.defs, { data: true });
    assert.ok(l.funcs.some((g) => g.name === "main"), `${name}: main compiles (${l.refused.get(p.named("main"))})`);
    const m = emitWasm(l);
    // wc's count folds over characters with no list between (C23).
    if (name === "wc") assert.match(m.wat, /fold\.characters/);
    for (const args of argsets) for (const input of ["3*4\nlet\n", ""]) {
      const want = fakeWorld(files, input), got = fakeWorld(files, input);
      const exit = runProgram(p.code, p.info, p.named("main"), args, { ...want.rt, names: p.pres.names });
      assert.deepEqual([await runMain(l, m, "main", args, got.rt), got.out], [exit, want.out], `${name} ${args.join(" ")}`);
    }
  }
});

// The same programs as WASI commands (wasm-rt.ts's world over
// wasi_snapshot_preview1), under node:wasi in a folder of their own,
// against the evaluator with Node's world in another folder with the same files.
test("whole programs as WASI commands: files, console, arguments and exit codes as the evaluator's with Node's world", async () => {
  const scratch = mkdtempSync(join(tmpdir(), "wasi-"));
  const files: Record<string, string> = {
    "a.txt": "one two\nthree\n", "book.md": "# One\nhello world\n# Two\nmore words here\n", "sums.txt": "1+2\nlet x = 3\nx*x\n1 +\n",
    "ledger.csv": "2026-09-01,salary,350000,pay\n2026-09-02,rent,-120000,flat\n", "big.csv": book(500), "out/.keep": "", "Ünï 🎉.txt": "é\n",
  };
  let runs = 0;
  const folder = () => {
    const dir = mkdtempSync(join(scratch, "d-"));
    for (const [p, t] of Object.entries(files)) { mkdirSync(join(dir, dirname(p)), { recursive: true }); writeFileSync(join(dir, p), t); }
    return dir;
  };
  const contents = (dir: string): Record<string, string> => Object.fromEntries((readdirSync(dir, { recursive: true }) as string[]).sort()
    .map((p) => [p, statSync(join(dir, p)).isDirectory() ? "(folder)" : readFileSync(join(dir, p), "utf8")]));
  const w = worldly();
  const programs = [
    ...["wc", "ledger", "chapters", "calc"].map((name) => { const p = load(name); return { name, code: p.code, info: p.info, names: p.pres.names, roots: p.own.defs, main: p.named("main") }; }),
    { name: "worldly", code: w.code, info: w.info, names: w.names, roots: [w.main], main: w.main },
  ];
  const argsets = [[], ["a.txt", "Ünï 🎉.txt"], ["-l", "a.txt", "nope", "out"], ["book.md", "out"], ["book.md", "gone"], ["ledger.csv"], ["big.csv"], ["out", "a.txt"], ["."]];
  for (const p of programs) {
    const m = emitWasm(lowerScalar(p.code, p.info, p.names, p.roots, { data: true }), { wasi: true });
    const module = await WebAssembly.compile(m.bytes);
    for (const args of argsets) for (const input of ["3*4\nlet\n", "a\r\nb"]) {
      const want = folder(), got = folder();
      const printed: string[] = [], errors: string[] = [], lines = input.split("\n");
      const cwd = process.cwd();
      process.chdir(want);
      let exit: number;
      try {
        exit = runProgram(p.code, p.info, p.main, args, { print: (l) => printed.push(l), names: p.names, world: {
          ...nodeWorld(), error: (l) => errors.push(l), input: () => lines.splice(0).join("\n"),
          readLine: () => (lines.length > 1 || lines[0] ? lines.shift()!.replace(/\r$/, "") : null),
        } });
      } finally { process.chdir(cwd); }
      const io = join(scratch, `io-${runs++}`);
      writeFileSync(`${io}.in`, input);
      const [stdin, stdout, stderr] = [openSync(`${io}.in`, "r"), openSync(`${io}.out`, "w"), openSync(`${io}.err`, "w")];
      const wasi = new WASI({ version: "preview1", args: [p.name, ...args], preopens: { ".": got }, stdin, stdout, stderr, returnOnExit: true });
      const code = wasi.start(await WebAssembly.instantiate(module, wasi.getImportObject() as WebAssembly.Imports));
      [stdin, stdout, stderr].forEach((fd) => closeSync(fd));
      const lined = (xs: string[]) => xs.map((l) => `${l}\n`).join("");
      assert.deepEqual(
        { code, out: readFileSync(`${io}.out`, "utf8"), err: readFileSync(`${io}.err`, "utf8"), files: contents(got) },
        { code: exit, out: lined(printed), err: lined(errors), files: contents(want) },
        `${p.name} ${args.join(" ")} < ${JSON.stringify(input)}`);
    }
  }
  rmSync(scratch, { recursive: true });
  assert.equal(runs, programs.length * argsets.length * 2);
});

// Searches with several answers inside called functions (W4d): each
// function that chooses takes the rest of the search, so the answers come
// in the evaluator's order, and queens runs whole.
test("several answers in WebAssembly: choices in called functions, arguments and folds, under each handler; queens' main as the evaluator's", async () => {
  const p = several();
  const lowered = lowerScalar(p.code, p.info, p.names, Object.values(p.defs), { data: true });
  assert.deepEqual([...lowered.refused.entries()], []);
  const m = emitWasm(lowered);
  assert.ok(WebAssembly.validate(m.bytes));
  const w = await instantiate(m) as unknown as Exports;
  const r = makeRunner(p.code, p.info, { print: () => {} });
  const lists = [[], [1], [3, -2, 5], [4, 1, 2, 8], Array.from({ length: 12 }, (_, i) => (i * 7) % 11)].map((xs) => toList(xs));
  const cases: Record<keyof typeof p.defs, Value[][]> = {
    firstBig: lists.flatMap((xs) => [0, 5, 13, 100].map((n) => [xs, n])),
    allSums: lists.map((xs) => [xs]),
    pairs: lists.slice(0, 4).flatMap((xs) => lists.slice(0, 4).map((ys) => [xs, ys])),
    howMany: lists.map((xs) => [xs]),
    some: lists.flatMap((xs) => [0, 4, 9].map((n) => [xs, n])),
    checked: lists.map((xs) => [xs]),
    caught: lists.map((xs) => [xs]),
  };
  let compared = 0;
  for (const [name, inputs] of Object.entries(cases)) {
    const def = p.defs[name as keyof typeof p.defs], f = lowered.funcs.find((g) => g.def === def && !g.inner)!;
    for (const xs of inputs) {
      const got = answer(w, f, (w[f.name] as (...a: unknown[]) => unknown)(...xs.map((x, i) => toWasm(w, x, f.params[i]))));
      assert.equal(flat(got), flat(outcome(r, def, xs)), `${name}(${xs.map((x) => (typeof x === "object" ? "[list]" : JSON.stringify(x))).join(", ")})`);
      compared++;
    }
  }
  assert.equal(compared, 71);
  // queens: a fold that chooses each row's column, under first, all and count.
  const q = load("queens");
  const lq = lowerScalar(q.code, q.info, q.pres.names, q.own.defs, { data: true });
  const want: string[] = [], got: string[] = [];
  const exit = runProgram(q.code, q.info, q.named("main"), [], { print: (l) => want.push(l), names: q.pres.names });
  assert.equal(await runMain(lq, emitWasm(lq), "main", [], { print: (l) => got.push(l) }), exit);
  assert.deepEqual(got, want);
  assert.ok(want.includes("solutions for 8: 92"), want.join("\n"));
});

test("fractions in WebAssembly: the evaluator's answers in lowest terms, past 2⁶⁴ too, none at a zero bottom", async () => {
  const p = fractions();
  const lowered = lowerScalar(p.code, p.info, p.names, Object.values(p.defs), { data: true });
  const w = await instantiate(emitWasm(lowered)) as unknown as Exports;
  const r = makeRunner(p.code, p.info, { print: () => {} });
  for (const def of Object.values(p.defs)) {
    const f = lowered.funcs.find((g) => g.def === def)!;
    for (const xs of fractionInputs(f.params.length, 150).map((ys) => ys.map(norm))) {
      const got = answer(w, f, (w[f.name] as (...a: unknown[]) => unknown)(...xs.map((x, i) => toWasm(w, x, f.params[i]))));
      assert.equal(flat(got), flat(outcome(r, def, xs)), `${p.names[def]}(${xs.join(", ")})`);
    }
  }
});

test("compare and sort in WebAssembly: the evaluator's order on every plain type", async () => {
  const p = ordered();
  const lowered = lowerScalar(p.code, p.info, p.names, Object.values(p.defs), { data: true });
  const w = await instantiate(emitWasm(lowered)) as unknown as Exports;
  const r = makeRunner(p.code, p.info, { print: () => {} });
  const inputs = orderedInputs();
  const value = (x: unknown): Value => (typeof x === "bigint" ? norm(x) : Array.isArray(x) ? toList(x.map(value)) : x as Value);
  for (const [name, def] of Object.entries(p.defs)) {
    const f = lowered.funcs.find((g) => g.def === def)!;
    for (const xs of inputs[name].map((ys) => ys.map(value))) {
      const got = answer(w, f, (w[f.name] as (...a: unknown[]) => unknown)(...xs.map((x, i) => toWasm(w, x, f.params[i]))));
      assert.equal(flat(got), flat(outcome(r, def, xs)), name);
    }
  }
});

test("a recursive let in WebAssembly: lifted to a definition, the evaluator's answers (BACKLOG L84)", async () => {
  const p = recursiveLets();
  assert.deepEqual(p.info.errors, []);
  const lowered = lowerScalar(p.code, p.info, p.names, [p.scaledSum], { data: true });
  assert.deepEqual([...lowered.refused.entries()], []);
  const w = await instantiate(emitWasm(lowered)) as unknown as Exports;
  const r = makeRunner(p.code, p.info, { print: () => {} });
  const t = lowered.funcs.find((f) => f.name === "scaled sum")!.params[0];
  for (const [xs, c] of [[[1, 2, 3], 2], [[], 5], [[0.5, -1.5], -2]] as [number[], number][]) {
    assert.equal(w["scaled sum"](toWasm(w, toList(xs), t), c), first(r.call(r.value(p.scaledSum), toList(xs), c)), `${xs} · ${c}`);
  }
});
