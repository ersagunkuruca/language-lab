// Optional Float64 and Extended Float64 as one f64 (L125e,
// FLOAT-VALUES-2026-11-01.md §4, Rust's niche): every Float64 is finite,
// so NaN is free to be none and ±∞ to be Extended's infinities. In
// WebAssembly and C they are no data at all, inside: some(x) and finite(x)
// are x, a match tests which f64 it is, a list of them holds f64s. A host
// still gives and gets the data. And a search's body gives no answer, not a stop, where a
// division by 0 has none (optional's none, first's fallback).

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Lang } from "../../ters/src/lang/dsl.ts";
import { infer } from "../../ters/src/lang/infer.ts";
import { makeRunner } from "../../ters/src/lang/run.ts";
import { base, baseNames, checkOptions } from "../../ters/src/lang/load.ts";
import { LIBRARY } from "../../ters/src/lang/library.ts";
import { COMPARE, CONS, EXTENDED_V, NIL, NONE, ORDER_V, S, SOME } from "../../ters/src/lang/std.ts";
import { B } from "../../ters/src/prelude.ts";
import { lowerScalar } from "../src/scalar.ts";
import { emitWasm, instantiate } from "../src/wasm.ts";
import { CFLAGS, emitC } from "../src/c.ts";

const cc = process.env.CC ?? "cc";
let haveC = true;
try { execFileSync(cc, ["--version"], { stdio: "ignore" }); } catch { haveC = false; }

test("Optional Float64 and Extended Float64 are one f64 in WebAssembly and C (NaN for none, ±∞ for the infinities): the evaluator's answers", async () => {
  const k = new Lang(LIBRARY.code);
  const def = (name: string, body: () => string) => { const d = k.def(name); k.define(d, body()); return d; };
  const lit = (x: number) => k.lit(x);
  const ratio = def("ratio", () => k.fn(["a", "b"], (a, b) => k.call(S.optional, k.thunk(() => k.call(B.div, a, b)))));
  const or = (o: string, d: string) => k.match(o, [{ variant: NONE, names: [], body: () => d }, { variant: SOME, names: ["x"], body: ([x]) => x }]);
  def("ratio or", () => k.fn(["a", "b"], (a, b) => or(k.call(ratio, a, b), lit(-1))));
  def("first ratio", () => k.fn(["a", "b"], (a, b) => k.call(S.first, k.thunk(() => k.call(B.div, a, b)), k.thunk(() => lit(-2)))));
  def("same ratios", () => k.fn(["a", "b", "c"], (a, b, c) => k.if(k.call(S.equal, k.call(ratio, a, b), k.call(ratio, a, c)), lit(1), lit(0))));
  def("listed", () => k.fn(["a", "b"], (a, b) => k.fold(k.list(k.call(ratio, a, b), k.call(ratio, b, a), k.call(ratio, a, a)), [
    { variant: NIL, names: [], body: () => lit(0) },
    { variant: CONS, names: ["x", "t"], results: [null, "r"], body: ([x], [, r]) => k.call(B.add, or(x, lit(100)), r!) },
  ])));
  // Extended Float64: a below b is finite(a), a above b plus infinity, a
  // the same as b minus infinity; and an optional one, none where b is 0.
  const bound = def("bound", () => k.fn(["a", "b"], (a, b) => k.if(k.call(S.less, a, b), k.call(EXTENDED_V.finite, a), k.if(k.call(S.less, b, a), EXTENDED_V.plus, EXTENDED_V.minus))));
  const read = (e: string) => k.match(e, [
    { variant: EXTENDED_V.minus, names: [], body: () => lit(-100) },
    { variant: EXTENDED_V.finite, names: ["x"], body: ([x]) => x },
    { variant: EXTENDED_V.plus, names: [], body: () => lit(100) },
  ]);
  const sign = (o: string) => k.match(o, [
    { variant: ORDER_V.before, names: [], body: () => lit(-1) },
    { variant: ORDER_V.same, names: [], body: () => lit(0) },
    { variant: ORDER_V.after, names: [], body: () => lit(1) },
  ]);
  def("bound read", () => k.fn(["a", "b"], (a, b) => read(k.call(bound, a, b))));
  def("bounds compared", () => k.fn(["a", "b"], (a, b) => k.call(B.add, k.call(B.mul, lit(10), sign(k.call(COMPARE, k.call(bound, a, b), k.call(bound, b, a)))),
    k.if(k.call(S.equal, k.call(bound, a, b), k.call(bound, b, a)), lit(1), lit(0)))));
  def("maybe bound", () => k.fn(["a", "b"], (a, b) => or(k.call(S.optional, k.thunk(() => k.call(bound, k.call(B.div, a, b), b))), k.call(EXTENDED_V.finite, lit(-7)))));
  def("maybe bound read", () => k.fn(["a", "b"], (a, b) => read(or(k.call(S.optional, k.thunk(() => k.call(bound, k.call(B.div, a, b), b))), k.call(EXTENDED_V.finite, lit(-7))))));
  const code = base(k.code), nm = baseNames(k.names), info = infer(code, nm, undefined, checkOptions);
  assert.deepEqual(info.errors.map((e) => e.message), []);
  const named = (n: string) => code.defs.find((d) => nm[d] === n)!;
  const two = ["ratio or", "first ratio", "listed", "bound read", "bounds compared", "maybe bound read"], three = ["same ratios"];
  const roots = [...two, ...three, "ratio", "maybe bound"];
  const lowered = lowerScalar(code, info, nm, roots.map(named), { data: true });
  assert.deepEqual(roots.flatMap((n) => lowered.refused.has(named(n)) ? [`${n}: ${lowered.refused.get(named(n))}`] : []), []);
  // Inside, ratio gives an f64; the host still gets an Optional from it,
  // through a wrapper, the only place the data type is left.
  assert.equal(lowered.funcs.find((f) => f.name === "ratio.f64")!.result, "f64");
  const wrapped = new Set(["ratio", "maybe bound", "bound"]);
  assert.deepEqual(lowered.funcs.filter((f) => !wrapped.has(f.name) && [...f.params, ...f.locals, f.result].some((t) => typeof t === "object" && "cases" in t && ["Optional", "Extended"].includes(t.name))).map((f) => f.name), []);
  assert.deepEqual(lowered.data.map((d) => d.name).sort(), ["Extended", "List", "List.frames", "Optional", "Order"]);
  const r = makeRunner(code, info, { print: () => {}, names: nm });
  const ev = (n: string, ...xs: unknown[]) => [...r.call(r.value(named(n)), ...(xs as never[]))][0];
  const pairs: [number, number][] = [[1, 2], [1, 0], [0, 0], [-3, 4], [4, -3], [2, 2], [6, 2]], triples: [number, number, number][] = [[1, 0, 0], [1, 0, 2], [1, 2, 2], [1, 2, 3]];
  const want = [...two.flatMap((d) => pairs.map((p) => ev(d, ...p))), ...three.flatMap((d) => triples.map((p) => ev(d, ...p)))].map(Number);
  assert.ok(want.includes(-1) && want.includes(-2) && want.includes(101) && want.includes(100) && want.includes(-100) && want.includes(-7) && want.includes(-10) && want.includes(10) && want.includes(1));
  const w = (await instantiate(emitWasm(lowered))) as unknown as Record<string, (...xs: number[]) => number>;
  assert.deepEqual([...two.flatMap((d) => pairs.map((p) => w[d](...p))), ...three.flatMap((d) => triples.map((p) => w[d](...p)))], want);
  if (!haveC) return;
  const out = emitC(lowered, { harness: true });
  assert.deepEqual([...out.refused.values()], []);
  const dir = mkdtempSync(join(tmpdir(), "niche-c-")), exe = join(dir, "niche");
  writeFileSync(`${exe}.c`, out.c);
  execFileSync(cc, [...CFLAGS, "-pthread", "-Wall", "-Werror", "-Wno-unknown-warning-option", "-Wno-unused-function", "-Wno-maybe-uninitialized", "-Wno-free-nonheap-object", "-Wno-unused-but-set-variable", "-Wno-unused-variable", "-Wno-unknown-pragmas", ...(process.env.NATIVE_CFLAGS ?? "").split(" ").filter(Boolean), "-o", exe, `${exe}.c`, "-lm"]);
  const fn = (n: string) => lowered.funcs.findIndex((f) => f.def === named(n) && !f.inner);
  const hex = (x: number) => new BigUint64Array(new Float64Array([x]).buffer)[0].toString(16);
  const unhex = (x: string) => new Float64Array(new BigUint64Array([BigInt(`0x${x}`)]).buffer)[0];
  const got = execFileSync(exe, { input: [
    ...two.flatMap((d) => pairs.map((p) => `${fn(d)} ${p.map(hex).join(" ")}`)), ...three.flatMap((d) => triples.map((p) => `${fn(d)} ${p.map(hex).join(" ")}`)),
  ].join("\n") + "\n" }).toString().trim().split("\n").map((l) => l.trim().split(/\s+/));
  assert.deepEqual(got.map((ws) => ws.at(-1)), got.map(() => ";0"));
  // same ratios' answer is an Int, written in decimal; the others are Float64s.
  assert.deepEqual(got.map((ws, i) => (i < two.length * pairs.length ? unhex(ws[0]) : Number(ws[0]))), want);
});
