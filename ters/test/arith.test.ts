// One + for every number type (NUMBERS.md, "One `+` for every number
// system"): the generic operations (std.ts ARITH), the constraint that types
// them (types.ts requireArith), and arith.ts resolving them to each type's
// own operation before the evaluator and the compiler see the program.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { Lang } from "../src/lang/dsl.ts";
import { infer } from "../src/lang/infer.ts";
import { makeRunner, type Value } from "../src/lang/run.ts";
import { relate } from "../src/lang/relate.ts";
import { base, baseNames, checkOptions } from "../src/lang/load.ts";
import { LIBRARY } from "../src/lang/library.ts";
import { ARITH, INT_OPS, S } from "../src/lang/std.ts";
import { resolveArithmetic, usesGenericArithmetic } from "../src/lang/arith.ts";
import { NUMBER, STRING, schemeArith, showType } from "../src/lang/types.ts";
import { subtree, type Id, type NodeOf } from "../src/model.ts";
import { compile } from "../../compiler/src/compile.ts";

const runtime = pathToFileURL(join(import.meta.dirname, "../../compiler/src/runtime.js")).href;

function program() {
  const k = new Lang(LIBRARY.code);
  const num = () => k.tref(NUMBER);
  const Vec = k.type("Vec", [], [["vec", [["x", num], ["y", num], ["z", num]]]]);
  const Named = k.type("Named", [], [["named", [["label", () => k.tref(STRING)], ["size", num]]]]);
  const vec = (...xs: number[]) => k.call(Vec.v.vec, ...xs.map((x) => k.lit(x)));
  const def = (name: string, body: () => Id) => { const d = k.def(name); k.define(d, body()); return d; };
  const fn = (name: string, params: string[], body: (...xs: Id[]) => Id) => { const d = k.def(name); k.define(d, k.fn(params, body)); return d; };
  // Generic definitions: no literal, so nothing says which number type.
  const twice = fn("twice", ["x"], (x) => k.call(ARITH.add, x, x));
  const smaller = fn("smaller", ["a", "b"], (a, b) => k.if(k.call(ARITH.less, a, b), a, b));
  const spread = fn("spread", ["a", "b"], (a, b) => k.call(ARITH.mul, k.call(ARITH.sub, a, b), k.call(twice, k.call(ARITH.neg, b))));
  const defs = {
    twice, smaller, spread,
    intTwice: def("int twice", () => k.call(twice, k.int(21))),
    // Past 2⁵³: Int's own +, not floating point.
    bigTwice: def("big twice", () => k.call(twice, k.int("9007199254740993"))),
    numberTwice: def("number twice", () => k.call(twice, k.lit(1.25))),
    vecTwice: def("vec twice", () => k.call(twice, vec(1, 2, 3))),
    intSmaller: def("int smaller", () => k.call(smaller, k.int(7), k.int(3))),
    numberSmaller: def("number smaller", () => k.call(smaller, k.lit(2.5), k.lit(4))),
    // (a − b) · twice(−b) at three types; a generic calling a generic.
    intSpread: def("int spread", () => k.call(spread, k.int(10), k.int(4))),
    numberSpread: def("number spread", () => k.call(spread, k.lit(0.5), k.lit(0.25))),
    vecSpread: def("vec spread", () => k.call(spread, vec(1, 2, 3), vec(3, 2, 1))),
    // The operation itself, passed as a value.
    intNegated: def("int negated", () => k.call(LIBRARY_MAP(), k.list(k.int(1), k.int(-2)), k.x(ARITH.neg))),
    vecsNegated: def("vecs negated", () => k.call(LIBRARY_MAP(), k.list(vec(1, 0, -1)), k.x(ARITH.neg))),
    // The slope of x·x + x at 3: the generic ops differentiate as Float64's.
    slope: def("slope", () => k.call(k.call(S.derivative, k.fn(["x"], (x) => k.call(ARITH.add, k.call(ARITH.mul, x, x), x))), k.lit(3))),
    // Mistakes the checker catches.
    textTwice: def("text twice", () => k.call(twice, k.lit("ab"))),
    vecSmaller: def("vec smaller", () => k.call(smaller, vec(1, 2, 3), vec(0, 0, 0))),
    namedTwice: def("named twice", () => k.call(twice, k.call(Named.v.named, k.lit("a"), k.lit(1)))),
  };
  const code = base(k.code), names = baseNames(k.names);
  return { code, names, info: infer(code, names, undefined, checkOptions), defs, Vec };
}
const LIBRARY_MAP = () => LIBRARY.code.defs.find((d) => LIBRARY.names[d] === "map")!;

const errorAt = (p: ReturnType<typeof program>, d: Id) => {
  const inside = new Set(subtree(p.code, d));
  return p.info.errors.filter((e) => inside.has(e.id)).map((e) => e.message);
};
const plain = (v: unknown): unknown => JSON.parse(JSON.stringify(v, (_, x) => (typeof x === "bigint" ? `${x}n` : x)));
const fields = (v: Value) => (v as { fields: unknown[] }).fields;
const items = (v: Value): Value[] => { const out: Value[] = []; let l = v as { fields: Value[] }; while (l.fields.length) { out.push(l.fields[0]); l = l.fields[1] as { fields: Value[] }; } return out; };

test("a definition with no literal works on every number type, and its type says so", () => {
  const p = program();
  const ok = [p.defs.slope, p.defs.twice, p.defs.smaller, p.defs.spread, p.defs.intTwice, p.defs.bigTwice, p.defs.numberTwice, p.defs.vecTwice, p.defs.intSmaller, p.defs.numberSmaller, p.defs.intSpread, p.defs.numberSpread, p.defs.vecSpread, p.defs.intNegated, p.defs.vecsNegated];
  for (const d of ok) assert.deepEqual(errorAt(p, d), [], p.names[d]);
  const sc = (d: Id) => p.info.schemes.get(d)!;
  assert.equal(showType(sc(p.defs.twice).type, p.names), "(a) -> a");
  assert.equal(sc(p.defs.twice).arith?.length, 1);
  assert.equal(sc(p.defs.smaller).ordered?.length, 1);
  assert.equal(showType(sc(p.defs.intTwice).type, p.names), "Int");
  assert.equal(showType(sc(p.defs.vecTwice).type, p.names), "Vec");
  // Printed, the type says what a may be.
  const shown = (d: Id) => showType(sc(d).type, p.names, schemeArith(sc(d)));
  assert.equal(shown(p.defs.twice), "(a) -> a where a is a Number");
  assert.equal(shown(p.defs.smaller), "(a, a) -> a where a is a Number with <");
  assert.equal(shown(p.defs.intTwice), "Int");
  assert.equal(showType(p.info.subst.zonk(p.info.typeOf.get(p.defs.spread)!), p.names, p.info.subst.arith), "(a, a) -> a where a is a Number");
});

test("text, a record that isn't all Float64s, and < on a record are type errors", () => {
  const p = program();
  assert.match(errorAt(p, p.defs.textTwice).join("; "), /Text isn.t a Number|works only on a Number/);
  assert.match(errorAt(p, p.defs.namedTwice).join("; "), /a Number \(/);
  assert.match(errorAt(p, p.defs.vecSmaller).join("; "), /a Number with </);
});

test("resolved by type: Int's own operations at Int, Float64's at Float64, part by part on a record", () => {
  const p = program();
  assert.ok(usesGenericArithmetic(p.code));
  const r = resolveArithmetic(p.code, p.info, p.names);
  assert.ok(!usesGenericArithmetic(r.code), "no generic operation is left");
  const targets = (d: Id) => subtree(r.code, d).map((id) => r.code.nodes[id]).filter((n) => n.kind === "ref").map((n) => (n as NodeOf<"ref">).target);
  // twice itself is its Float64 version; Int's and Vec's are copies.
  const copies = r.code.defs.filter((d) => r.names[d]?.startsWith("twice at"));
  // (and at Text and Named, for the two definitions that are type errors)
  assert.deepEqual(copies.map((d) => r.names[d]).sort(), ["twice at Int", "twice at Named", "twice at Text", "twice at Vec"]);
  const intCopy = copies.find((d) => r.names[d] === "twice at Int")!;
  assert.ok(targets(intCopy).includes(INT_OPS.add));
  assert.ok(targets(copies.find((d) => r.names[d] === "twice at Vec")!).includes(S.zipParts));
  assert.ok(targets(p.defs.intTwice).includes(intCopy));
  // A definition with no generic operation, and no literal that is just
  // some Number, comes back as it was.
  const k = new Lang();
  const d = k.def("plain");
  k.define(d, k.at(NUMBER, 1));
  const code = base(k.code);
  const info = infer(code, baseNames(k.names));
  const back = resolveArithmetic(code, info).code;
  for (const id of subtree(code, d)) assert.equal(back.nodes[id], code.nodes[id]);
});

async function evaluatedAndCompiled() {
  const p = program();
  const names = ["slope", "int twice", "big twice", "number twice", "vec twice", "int smaller", "number smaller", "int spread", "number spread", "vec spread", "int negated", "vecs negated"];
  const r = makeRunner(p.code, p.info, { print: () => {} });
  const byName = (n: string) => p.code.defs.find((d) => p.names[d] === n)!;
  const evaluated = Object.fromEntries(names.map((n) => [n, r.value(byName(n))]));
  const path = join(mkdtempSync(join(tmpdir(), "arith-")), "arith.js");
  const ok = new Set(names.map(byName));
  const clean = { ...p.info, errors: p.info.errors.filter((e) => [...ok].some((d) => subtree(p.code, d).includes(e.id))) };
  writeFileSync(path, compile(p.code, clean, p.names, { runtime, exports: names }));
  const compiled = (await import(pathToFileURL(path).href)).defs as Record<string, unknown>;
  return { evaluated, compiled, names };
}

test("the evaluator gives each type's answer", async () => {
  const { evaluated: e } = await evaluatedAndCompiled();
  assert.equal(e.slope, 7);
  assert.equal(e["int twice"], 42);
  assert.equal(e["big twice"], 18014398509481986n);
  assert.equal(e["number twice"], 2.5);
  assert.deepEqual(fields(e["vec twice"]), [2, 4, 6]);
  assert.equal(e["int smaller"], 3);
  assert.equal(e["number smaller"], 2.5);
  assert.equal(e["int spread"], -48);
  assert.equal(e["number spread"], -0.125);
  assert.deepEqual(fields(e["vec spread"]), [12, -0, -4]);
  assert.deepEqual(items(e["int negated"]), [-1, 2]);
  assert.deepEqual(items(e["vecs negated"]).map(fields), [[-1, -0, 1]]);
});

test("compiled JavaScript gives the evaluator's values", async () => {
  const { evaluated, compiled, names } = await evaluatedAndCompiled();
  for (const n of names) assert.deepEqual(plain((compiled[n] as () => unknown)()), plain(evaluated[n]), n);
});

test("run backwards, a generic definition is its Float64 version: which x has twice(x) = 7?", () => {
  const p = program();
  const lam = p.code.nodes[(p.code.nodes[p.defs.twice] as NodeOf<"def">).body!] as NodeOf<"lambda">;
  const answers = [...relate(p.code, p.defs.twice, { out: 7 })];
  assert.equal(answers.length, 1);
  assert.equal(answers[0].values[lam.params[0]], 3.5);
});

test("a whole literal nothing fixes is an Int, one with a fraction part a Float64 (L86b)", async () => {
  const { runMain } = await import("../src/lang/run.ts");
  const { SHOW_ANY } = await import("../src/lang/std.ts");
  const k = new Lang();
  const inc = k.def("inc");
  k.define(inc, k.fn(["x"], (x) => k.call(ARITH.add, x, k.lit(1))));
  const main = k.def("main");
  const say = (e: Id) => k.call(S.print, k.call(SHOW_ANY, e));
  k.define(main, k.thunk(() => k.seq(say(k.call(ARITH.add, k.lit(2), k.lit(3))), say(k.call(ARITH.mul, k.lit(1e12), k.lit(1e12))), say(k.call(inc, k.lit(2.5))), say(k.call(ARITH.add, k.lit(0.5), k.lit(1))))));
  const code = base(k.code), names = baseNames(k.names);
  const info = infer(code, names);
  assert.deepEqual(info.errors, []);
  const out: string[] = [];
  runMain(code, info, main, { print: (s) => out.push(s), names });
  // 10^12 · 10^12 is exact: an Int never overflows.
  assert.deepEqual(out, ["5", "1000000000000000000000000", "3.5", "1.5"]);
  // On its own inc is an Int function; inc(2.5) uses a Float64 copy.
  const r = resolveArithmetic(code, info, names);
  assert.equal(showType(r.info.subst.zonk(r.info.typeOf.get(inc)!), names), "(Int) -> Int");
});

// L86d: a definition is at its own defaults, so a use at another type gets
// a copy. When inc's default became Int (L86b), a use at Float64 kept
// calling it: inc(2.5) ran Int's +, and 0.5 · inc(0) was refused on the GPU.
test("a use at Float64 of a definition whose default is Int gets a Float64 copy", () => {
  const k = new Lang();
  const inc = k.def("inc");
  k.define(inc, k.fn(["x"], (x) => k.call(ARITH.add, x, k.lit(1))));
  const half = k.def("half");
  k.define(half, k.fn(["y"], () => k.call(ARITH.mul, k.lit(0.5), k.call(inc, k.lit(0)))));
  const direct = k.def("direct");
  k.define(direct, k.thunk(() => k.call(inc, k.lit(2.5))));
  const code = base(k.code), names = baseNames(k.names);
  const info = infer(code, names);
  assert.deepEqual(info.errors, []);
  const r = resolveArithmetic(code, info, names);
  for (const d of [half, direct]) {
    const called = subtree(r.code, d).map((id) => r.code.nodes[id]).find((n) => n.kind === "ref" && n.target !== inc && r.code.defs.includes(n.target) && !(n.target in code.nodes));
    assert.ok(called && called.kind === "ref", names[d]);
    assert.equal(showType(r.info.subst.zonk(r.info.typeOf.get(called.target)!), names), "(Float64) -> Float64", names[d]);
  }
});
