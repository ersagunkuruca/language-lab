// The grammar pieces (L70a, GRAMMARS-2026-11-02): spaced and optional
// parens print one way and, run backwards, read several.
import { test } from "node:test";
import assert from "node:assert/strict";
import { get, type Code, type Id } from "../src/model.ts";
import { Lang } from "../src/lang/dsl.ts";
import { infer } from "../src/lang/infer.ts";
import { LIBRARY } from "../src/lang/library.ts";
import { preludeDef } from "../src/lang/arith.ts";
import { base, baseNames } from "../src/lang/load.ts";
import { relate, showTerm } from "../src/lang/relate.ts";
import { bool, makeRunner } from "../src/lang/run.ts";
import { S } from "../src/lang/std.ts";

const params = (code: Code, def: Id) => get(code, get(code, def, "def").body!, "lambda").params;

function program(build: (k: Lang, spaced: Id, parens: Id) => void) {
  const k = new Lang(LIBRARY.code);
  build(k, preludeDef("spaced")!, preludeDef("optional parens")!);
  const code = base(k.code), names = baseNames(k.names);
  const info = infer(code);
  const named = (n: string) => code.defs.find((d) => names[d] === n)!;
  return { code, info, named };
}

// read(t) is the parts of a sum "a + b", one of them maybe in parentheses.
const p = program((k, spaced, parens) => {
  const sum = k.def("plus line");
  k.define(sum, k.fn(["a", "b", "wrap"], (a, b, w) => k.call(S.concat, k.call(parens, w, a), k.call(S.concat, k.call(spaced, k.lit("+")), b))));
  const pad = k.def("padded op");
  k.define(pad, k.fn(["t"], (t) => k.call(spaced, t)));
  const paren = k.def("maybe parens");
  k.define(paren, k.fn(["t"], (t) => k.call(parens, k.false, t)));
  const needed = k.def("parens needed");
  k.define(needed, k.fn(["t"], (t) => k.call(parens, k.true, t)));
});

const backwards = (def: string, out: string) => {
  const ps = params(p.code, p.named(def));
  return [...relate(p.code, p.named(def), { out })].map((a) => ps.map((x) => showTerm(a.values[x])).join(" "));
};

test("spaced and optional parens print one way (L70a)", () => {
  const r = makeRunner(p.code, p.info, { print: () => {} });
  const once = (def: string, ...xs: unknown[]) => [...r.call(r.value(p.named(def)), ...(xs as never[]))];
  assert.deepEqual(once("padded op", "+"), [" + "]);
  assert.deepEqual(once("maybe parens", "ab"), ["ab"]);
  assert.deepEqual(once("parens needed", "ab"), ["(ab)"]);
  assert.deepEqual(once("plus line", "x", "y", bool(true)), ["(x) + y"]);
  assert.deepEqual(once("plus line", "x", "y", bool(false)), ["x + y"]);
  assert.deepEqual(p.info.errors.map((e) => e.message), []);
});

test("spaced reads any spaces around, or none (L70a)", () => {
  assert.deepEqual(backwards("padded op", "+"), ['"+"']);
  assert.deepEqual(backwards("padded op", "   + "), ['"+"']);
  assert.deepEqual(backwards("padded op", " a b "), ['"a b"']);
});

test("optional parens reads the text bare or in one matched pair (L70a)", () => {
  assert.deepEqual(backwards("maybe parens", "ab").sort(), ['"ab"']);
  assert.deepEqual(backwards("maybe parens", "(ab)").sort(), ['"(ab)"', '"ab"']);
  assert.deepEqual(backwards("maybe parens", "(a)(b)").sort(), ['"(a)(b)"']);
  assert.deepEqual(backwards("maybe parens", "((ab))").sort(), ['"((ab))"', '"(ab)"', '"ab"']);
  assert.deepEqual(backwards("parens needed", "(ab)"), ['"ab"']);
  assert.deepEqual(backwards("parens needed", "ab"), []);
});

test("a printer written with them reads its own text back (L70a)", () => {
  // Parentheses read whether or not they were needed; without them, only
  // when they weren't.
  // The spaces around "+" may also be read as part of a text that allows
  // them: here `a` is any text, so "(x) " is an answer; an atom such as a
  // number (show backwards) refuses spaces, and calc's grammar has only
  // those.
  const tidy = (xs: string[]) => xs.map((a) => a.replace("std.bool.", "").replace(/_\d+$/, "_")).sort();
  assert.deepEqual(tidy(backwards("plus line", "(x) +y")), ['"(x) " "y" false', '"(x)" "y" false', '"x" "y" _']);
  assert.deepEqual(tidy(backwards("plus line", "x+ y")), ['"x" " y" false', '"x" "y" false']);
});
