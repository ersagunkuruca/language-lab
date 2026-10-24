// Fractions (NUMBERS.md stage 1, BACKLOG L39): Rational is exact, kept in
// lowest terms, and has the one generic + − · −x < (arith.ts resolves them
// to the prelude's fraction arithmetic); `fraction` and `÷` have no answer
// at a zero bottom. Evaluated and compiled the same.

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
import { ARITH, S } from "../src/lang/std.ts";
import { showType } from "../src/lang/types.ts";
import { subtree, type Id } from "../src/model.ts";
import { compile } from "../../compiler/src/compile.ts";

const runtime = pathToFileURL(join(import.meta.dirname, "../../compiler/src/runtime.js")).href;
const lib = (name: string) => LIBRARY.code.defs.find((d) => LIBRARY.names[d] === name)!;

function program() {
  const k = new Lang(LIBRARY.code);
  const def = (name: string, body: () => Id) => { const d = k.def(name); k.define(d, body()); return d; };
  const fn = (name: string, params: string[], body: (...xs: Id[]) => Id) => { const d = k.def(name); k.define(d, k.fn(params, body)); return d; };
  const [fraction, divide, show, asNumber, whole] = ["fraction", "divide fractions", "show fraction", "fraction as number", "as fraction"].map(lib);
  // Every answer, as a list: [] when there is none.
  const all = (body: () => Id) => k.call(S.all, k.thunk(body));
  const f = (a: number, b: number) => k.call(fraction, k.int(a), k.int(b));
  const twice = fn("twice", ["x"], (x) => k.call(ARITH.add, x, x));
  const smaller = fn("smaller", ["a", "b"], (a, b) => k.if(k.call(ARITH.less, a, b), a, b));
  const defs = {
    twice,
    total: def("total", () => all(() => k.call(show, k.call(ARITH.add, f(1, 2), f(1, 3))))),
    // 1/10 + 2/10 is 3/10 exactly, where Numbers give 0.30000000000000004.
    tenths: def("tenths", () => all(() => k.call(S.equal, k.call(ARITH.add, f(1, 10), f(2, 10)), f(3, 10)))),
    lowest: def("lowest", () => all(() => k.call(show, f(6, -8)))),
    product: def("product", () => all(() => k.call(show, k.call(ARITH.mul, f(2, 3), k.call(ARITH.neg, f(9, 4)))))),
    difference: def("difference", () => all(() => k.call(show, k.call(ARITH.sub, f(1, 2), k.call(whole, k.int(3)))))),
    doubled: def("doubled", () => all(() => k.call(show, k.call(twice, f(5, 6))))),
    least: def("least", () => all(() => k.call(show, k.call(smaller, f(1, 2), f(1, 3))))),
    quotient: def("quotient", () => all(() => k.call(show, k.call(divide, f(3, 4), f(3, 8))))),
    byZero: def("by zero", () => all(() => k.call(divide, f(1, 2), f(0, 5)))),
    noBottom: def("no bottom", () => all(() => f(1, 0))),
    near: def("near", () => all(() => k.call(asNumber, f(1, 4)))),
    // Past 2⁵³: still exact.
    big: def("big", () => all(() => k.call(show, k.call(ARITH.mul, k.call(fraction, k.int("9007199254740993"), k.int(2)), f(2, 3))))),
  };
  const code = base(k.code), names = baseNames(k.names);
  return { code, names, info: infer(code, names, undefined, checkOptions), defs };
}

const NAMES = ["total", "tenths", "lowest", "product", "difference", "doubled", "least", "quotient", "by zero", "no bottom", "near", "big"];
const items = (v: Value): Value[] => { const out: Value[] = []; let l = v as { fields: Value[] }; while (l.fields.length) { out.push(l.fields[0]); l = l.fields[1] as { fields: Value[] }; } return out; };
const plain = (v: unknown): unknown => JSON.parse(JSON.stringify(v, (_, x) => (typeof x === "bigint" ? `${x}n` : x)));

test("fractions type-check with the one generic + − · <, and a generic definition takes them", () => {
  const p = program();
  const errors = p.info.errors.filter((e) => Object.values(p.defs).some((d) => subtree(p.code, d).includes(e.id)));
  assert.deepEqual(errors.map((e) => e.message), []);
  assert.equal(showType(p.info.schemes.get(p.defs.doubled)!.type, p.names), "List Text");
});

async function both() {
  const p = program();
  const r = makeRunner(p.code, p.info, { print: () => {} });
  const byName = (n: string) => p.code.defs.find((d) => p.names[d] === n)!;
  // A definition that acts (all runs a Choice) is a computation: run it.
  const run = (v: Value): Value => { if (typeof v !== "function") return v; for (const x of r.call(v)) return x; throw new Error("no value"); };
  const evaluated = Object.fromEntries(NAMES.map((n) => [n, items(run(r.value(byName(n))))]));
  const path = join(mkdtempSync(join(tmpdir(), "rational-")), "rational.js");
  writeFileSync(path, compile(p.code, p.info, p.names, { runtime, exports: NAMES }));
  const defs = (await import(pathToFileURL(path).href)).defs as Record<string, () => Value>;
  const compiled = Object.fromEntries(NAMES.map((n) => [n, items(defs[n]())]));
  return { evaluated, compiled };
}

test("exact answers, in lowest terms; no answer at a zero bottom", async () => {
  const { evaluated: e } = await both();
  assert.deepEqual(e.total, ["5/6"]);
  assert.deepEqual(e.tenths.map((b) => (b as { tag: string }).tag), ["std.bool.true"]);
  assert.deepEqual(e.lowest, ["-3/4"]);
  assert.deepEqual(e.product, ["-3/2"]);
  assert.deepEqual(e.difference, ["-5/2"]);
  assert.deepEqual(e.doubled, ["5/3"]);
  assert.deepEqual(e.least, ["1/3"]);
  assert.deepEqual(e.quotient, ["2"]);
  assert.deepEqual(e["by zero"], []);
  assert.deepEqual(e["no bottom"], []);
  assert.deepEqual(e.near, [0.25]);
  assert.deepEqual(e.big, ["3002399751580331"]);
});

test("compiled JavaScript gives the evaluator's answers", async () => {
  const { evaluated, compiled } = await both();
  for (const n of NAMES) assert.deepEqual(plain(compiled[n]), plain(evaluated[n]), n);
});

// QA-2026-10-24b: smaller, larger and ≤ > ≥ were Number's only while + − · <
// were generic. They're over the one < now, and the Number-only versions
// stay published (hidden) so programs saved before still open.
test("smaller, larger and at most work on Int and fractions too; the old Number-only ones are kept", () => {
  const k = new Lang(LIBRARY.code);
  const [smaller, larger, atMost, fraction, show] = ["smaller", "larger", "at most", "fraction", "show fraction"].map((n) => LIBRARY.modules.flatMap((m) => m.exports).find((d) => LIBRARY.names[d] === n)!);
  const def = (name: string, body: () => Id) => { const d = k.def(name); k.define(d, body()); return d; };
  const f = (a: number, b: number) => k.call(fraction, k.int(a), k.int(b));
  const ints = def("ints", () => k.call(larger, k.int(3), k.int(7)));
  const fracs = def("fracs", () => k.call(S.all, k.thunk(() => k.call(show, k.call(smaller, f(1, 2), f(1, 3))))));
  const ordered = def("ordered", () => k.call(S.all, k.thunk(() => k.call(atMost, f(2, 4), f(1, 2)))));
  const code = base(k.code), names = baseNames(k.names);
  const info = infer(code, names, undefined, checkOptions);
  for (const d of [ints, fracs, ordered]) assert.deepEqual(info.errors.filter((e) => subtree(code, d).includes(e.id)).map((e) => e.message), [], names[d]);
  const r = makeRunner(code, info, { print: () => {} });
  const run = (v: Value): Value => { if (typeof v !== "function") return v; for (const x of r.call(v)) return x; throw new Error("no value"); };
  assert.equal(Number(r.value(ints)), 7);
  assert.deepEqual(items(run(r.value(fracs))), ["1/3"]);
  assert.deepEqual(items(run(r.value(ordered))).map((b) => (b as { tag: string }).tag), ["std.bool.true"]);
  const named = (n: string) => LIBRARY.code.defs.filter((d) => LIBRARY.names[d] === n);
  for (const n of ["smaller", "larger", "at most", "more than", "at least"]) assert.equal(named(n).length, 2, n);
});

// QA-2026-10-24b (L75): a literal can be at Rational ("3/4", or a whole
// number) or at Complex (its real part), so ratio(1, 2) + 1 needs no
// `as fraction`. arith.ts spells each as its constructor's call.
test("literals at Rational and Complex: exact, in lowest terms, checked, and printed as written", async () => {
  const { COMPLEX_TYPE, RATIONAL_TYPE } = await import("../src/lang/types.ts");
  const { renderBlocks } = await import("../src/lang/render.ts");
  const k = new Lang(LIBRARY.code);
  const def = (name: string, body: () => Id) => { const d = k.def(name); k.define(d, body()); return d; };
  const half = k.at(RATIONAL_TYPE, "1/2");
  const sum = def("sum of literals", () => k.call(lib("show fraction"), k.call(ARITH.add, half, k.at(RATIONAL_TYPE, 1))));
  const lowest = def("lowest literal", () => k.call(lib("show fraction"), k.at(RATIONAL_TYPE, "6/8")));
  const cx = def("complex literal", () => k.call(lib("show complex"), k.call(ARITH.mul, k.at(COMPLEX_TYPE, 2.5), k.x(lib("i")))));
  const bad = def("bad literal", () => k.at(RATIONAL_TYPE, "1/0"));
  const code = base(k.code), names = baseNames(k.names);
  const info = infer(code, names, undefined, checkOptions);
  const errs = (d: Id) => info.errors.filter((e) => subtree(code, d).includes(e.id)).map((e) => e.message);
  for (const d of [sum, lowest, cx]) assert.deepEqual(errs(d), [], names[d]);
  assert.match(errs(bad).join("; "), /isn't a fraction/);
  const r = makeRunner(code, info, { print: () => {} });
  assert.equal(r.value(sum), "3/2");
  assert.equal(r.value(lowest), "3/4");
  assert.equal(r.value(cx), "0 + 2.5i");
  const path = join(mkdtempSync(join(tmpdir(), "literal-")), "literal.js");
  const clean = { ...info, errors: info.errors.filter((e) => !subtree(code, bad).includes(e.id)) };
  writeFileSync(path, compile(code, clean, names, { runtime, exports: ["sum of literals", "lowest literal", "complex literal"] }));
  const defs = (await import(pathToFileURL(path).href)).defs as Record<string, unknown>;
  const val = (x: unknown) => (typeof x === "function" ? (x as () => unknown)() : x);
  assert.deepEqual([val(defs["sum of literals"]), val(defs["lowest literal"]), val(defs["complex literal"])], ["3/2", "3/4", "0 + 2.5i"]);
  // Drawn as written: 1/2, not "1/2".
  const pres = { names, comments: {}, hints: {}, style: { view: "blocks", notation: {} } } as unknown as Parameters<typeof renderBlocks>[1];
  assert.match(renderBlocks(code, pres, info, sum), /1\/2/);
  assert.doesNotMatch(renderBlocks(code, pres, info, sum), /"1\/2"/);
});
