// calc's printer read backwards by recursive descent (C110 s3 and s4,
// GRAMMAR-DESCENT-2026-11-05.md): each line reads to what relate.ts's
// search reads it to, in one pass.

import { test } from "node:test";
import assert from "node:assert/strict";
import { load } from "../src/program.ts";
import { descentReader } from "../../ters/src/lang/descent.ts";
import { writeReader } from "../../ters/src/lang/reader.ts";
import { PRELUDE_DEFS } from "../../ters/src/lang/prelude-ids.ts";
import { lowerScalar } from "../src/scalar.ts";
import { withInverses } from "../src/inverses.ts";
import { emitWasm, fromText, instantiate, toText } from "../src/wasm.ts";
import { build, skip } from "./c-harness.ts";
import { makeRunner, showValue, type Value } from "../../ters/src/lang/run.ts";
import { Lang } from "../../ters/src/lang/dsl.ts";
import { infer } from "../../ters/src/lang/infer.ts";
import { merge } from "../../ters/src/model.ts";
import { S, SHOW_ANY } from "../../ters/src/lang/std.ts";
import { lowerCore, loadCoreJs } from "../src/core-js.ts";

const p = load("calc");
const r = makeRunner(p.code, p.info, { print: () => {} });
const shown = (v: Value) => showValue(v, p.code, p.pres.names);
const searched = (line: string) => [...r.call(r.value(p.named("read expression")), line)].map(shown);
const descent = descentReader(p.code, p.named("expression text"), p.pres.names);
const read = (line: string) => { const v = descent(line, 0); return v === null ? [] : [shown(v)]; };

test("calc's lines without an operator read by descent as the search reads them (C110 s3)", () => {
  for (const line of ["12", "x", "abc", "-2", "--x", "(-x)", "((1))", "-(-x)", "(x)", "-(12)"]) assert.deepEqual(read(line), searched(line), line);
});

test("a line that isn't an expression has no reading by descent either (C110 s3)", () => {
  for (const line of ["", "-", "(1", "1)", "x1", "1x", "( 1)"]) assert.deepEqual(read(line), searched(line), line);
});

// The binary arm starts with the printer itself: read by precedence
// climbing from its own condition for parentheses and the levels it
// prints its operands at (C110 s4). calc-grammar.test.ts's lines.
test("calc's lines with operators read by precedence climbing as the search reads them (C110 s4)", () => {
  for (const line of ["1 + 2", "1+2*x", "1 + 2 * 3", "(1 + 2) * 3", "1 - 2 - 3", "1 - (2 - 3)", "2 ^ 3 ^ 2", "(2 ^ 3) ^ 2",
    "-2 ^ 2", "-(1 + 2)", "a * (b + c) / d", "1 + 2 * 3 - 4 / x ^ 2 + (y - 1) * -z", "((1 + 2)) * (3)", "2 ^ -3"]) assert.deepEqual(read(line), searched(line), line);
  for (const line of ["1 +", "(1 + 2", "1 2", "+", "1 + + 2", "(1 + 2))"]) assert.deepEqual(read(line), searched(line), line);
});

// Random expressions printed by calc's printer read back to themselves
// (C110 s4): the printer and its reading by descent agree, which the
// search, at about a second a line, is too slow to check at this size.
test("calc's printer, read back by descent, gives each of 300 random expressions back (C110 s4)", () => {
  // The printer's arms, one per case: literal, variable, negative, binary.
  const printer = p.code.nodes[(p.code.nodes[p.named("expression text")] as { body: string }).body] as { body: string };
  const [lit, vari, neg, bin] = (p.code.nodes[printer.body] as { arms: string[] }).arms.map((a) => (p.code.nodes[a] as { variant: string }).variant);
  let seed = 7;
  const rand = (n: number) => ((seed = (seed * 1103515245 + 12345) % 2147483648), seed % n);
  const make = (depth: number): Value => {
    const k = depth === 0 ? rand(2) : rand(4);
    if (k === 0) return { tag: lit, fields: [rand(100)] };
    if (k === 1) return { tag: vari, fields: [["x", "y", "ab"][rand(3)]] };
    if (k === 2) return { tag: neg, fields: [make(depth - 1)] };
    return { tag: bin, fields: [["+", "-", "*", "/", "^"][rand(5)], make(depth - 1), make(depth - 1)] };
  };
  const print = (e: Value) => [...r.call(r.value(p.named("expression text")), e, 0)][0] as string;
  for (let i = 0; i < 300; i++) {
    const e = make(4), line = print(e);
    assert.equal(read(line)[0], shown(e), line);
  }
});

// Compiled, calc's `read expression` (inverse of `e ↦ expression text(e,
// 0)`) is a solve on the printer itself (inverses.ts), read by descent
// (core-solve.ts) with the evaluator's answers (C110 s5): about 0.4 ms
// a line on the core IR's JavaScript, where the search took 760.
test("calc's read expression, compiled, reads by descent with the evaluator's answers (C110 s5)", () => {
  const k = new Lang(p.code), go = k.def("go");
  k.define(go, k.fn(["line"], (line) => k.call(S.first, k.thunk(() => k.call(SHOW_ANY, k.call(p.named("read expression"), line))), k.thunk(() => k.lit("no reading")))));
  const code = merge(k.code, p.code), names = { ...p.pres.names, ...k.names };
  const info = infer(code, names, undefined, p.options);
  const core = lowerCore(code, info, names, [go]);
  assert.deepEqual([...core.refused.values()], []);
  const f = (loadCoreJs(core, { print: () => {} }) as ((line: string) => string)[])[core.funcs.findIndex((g) => g.name === "go" && !g.inner)];
  for (const line of ["1 + 2 * 3 - 4 / x ^ 2 + (y - 1) * -z", "2 ^ 3 ^ 2", "-(1 + 2)", "((1))", "1 +", "2 ^ -3", ""]) {
    const want = searched(line);
    assert.equal(f(line), want.length ? want[0] : "no reading", line);
  }
});

// The reader written as a definition in the language (reader.ts): the
// arms that don't start with the printer (C110 s7a), and its operators by
// precedence climbing (s7b). It reads each line as descent.ts does, in the
// evaluator and compiled to C.
test("calc's reader, written as a definition, reads each line as descent does, in the evaluator and in C (C110 s7a, s7b)", { skip }, () => {
  const names = { ...Object.fromEntries(Object.entries(PRELUDE_DEFS).map(([n, d]) => [d, n])), ...p.pres.names };
  const w = writeReader(p.code, p.named("expression text"), names);
  const code = merge(w.code, p.code), all = { ...names, ...w.names };
  const info = infer(code, all, undefined, p.options);
  assert.deepEqual(info.errors.map((e) => e.message), []);
  const lines = ["12", "x", "abc", "-2", "--x", "(-x)", "((1))", "-(-x)", "(x)", "-(12)", "", "-", "(1", "1)", "x1", "1x", "( 1)",
    "1 + 2", "1+2*x", "1 + 2 * 3", "(1 + 2) * 3", "1 - 2 - 3", "1 - (2 - 3)", "2 ^ 3 ^ 2", "(2 ^ 3) ^ 2", "-2 ^ 2", "-(1 + 2)", "a * (b + c) / d",
    "1 + 2 * 3 - 4 / x ^ 2 + (y - 1) * -z", "((1 + 2)) * (3)", "2 ^ -3", "1 +", "(1 + 2", "1 2", "+", "1 + + 2", "(1 + 2))"];
  const rw = makeRunner(code, info, { print: () => {} });
  const want = lines.map((line) => { const v = descent(line, 0); return v === null ? "none" : shown(v); });
  const evaluated = lines.map((line) => [...rw.call(rw.value(w.line), line, 0)].map((v) => { const o = v as { tag: string; fields: Value[] }; return o.tag === "std.optional.some" ? shown(o.fields[0]) : "none"; })[0]);
  assert.deepEqual(evaluated, want);
  const lowered = lowerScalar(code, info, all, [w.line], { data: true });
  assert.deepEqual([...lowered.refused.values()], []);
  const fi = lowered.funcs.findIndex((f) => f.def === w.line);
  const inC = build(lowered)(lines.map((line) => [fi, [line, 0]])).map((r) => { const o = r.value as { tag: string; fields: Value[] } | undefined; return o?.tag === "std.optional.some" ? shown(o.fields[0]) : "none"; });
  assert.deepEqual(inC, want);
});

// calc's `read expression` compiled (C110 s7c, s7d): its inverse of the
// printer is a call of the printer's reader written out (inverses.ts), so
// C and WebAssembly run it, where they couldn't run the solve, and read
// each line as the evaluator does.
const goCalc = () => {
  const k = new Lang(p.code), go = k.def("go");
  k.define(go, k.fn(["line"], (line) => k.call(S.first, k.thunk(() => k.call(SHOW_ANY, k.call(p.named("read expression"), line))), k.thunk(() => k.lit("no reading")))));
  const code = merge(k.code, p.code), names = { ...p.pres.names, ...k.names };
  const q = withInverses(code, infer(code, names, undefined, p.options), names);
  const lowered = lowerScalar(q.code, q.info, q.names, [go], { data: true });
  return { go, lowered };
};
const readLines = ["1 + 2 * 3 - 4 / x ^ 2 + (y - 1) * -z", "2 ^ 3 ^ 2", "-(1 + 2)", "((1))", "1 +", "2 ^ -3", ""];
test("calc's read expression compiled to WebAssembly reads through the written reader (C110 s7d)", async () => {
  const { go, lowered } = goCalc();
  assert.deepEqual([...lowered.refused.values()], []);
  const w = await instantiate(emitWasm(lowered)) as unknown as Record<string, (...xs: never[]) => unknown>;
  const f = lowered.funcs.find((g) => g.def === go)!;
  const got = readLines.map((line) => fromText(w, (w[f.name] as (t: unknown) => unknown)(toText(w, line))));
  assert.deepEqual(got, readLines.map((line) => { const want = searched(line); return want.length ? want[0] : "no reading"; }));
});
test("calc's read expression compiled to C reads through the written reader (C110 s7c)", { skip }, () => {
  const { go, lowered } = goCalc();
  assert.deepEqual([...lowered.refused.values()], []);
  const fi = lowered.funcs.findIndex((f) => f.def === go);
  const got = build(lowered)(readLines.map((line) => [fi, [line]])).map((r) => r.value);
  assert.deepEqual(got, readLines.map((line) => { const w = searched(line); return w.length ? w[0] : "no reading"; }));
});
