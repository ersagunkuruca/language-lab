// Text has the one < (BACKLOG L152, REVIEW-2026-11-02 §3): at most,
// smaller, larger and a definition of your own over < take Text, which is
// ordered alphabetically, as compare and sort order it; + − · don't, and a
// definition that uses both + and < still wants a Number. Evaluated and
// compiled.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { compile } from "../../compiler/src/compile.ts";
import { $setPrint } from "../../compiler/src/runtime.js";
import type { Id } from "../src/model.ts";
import { Lang } from "../src/lang/dsl.ts";
import { infer } from "../src/lang/infer.ts";
import { base, baseNames, checkOptions } from "../src/lang/load.ts";
import { LIBRARY } from "../src/lang/library.ts";
import { runMain } from "../src/lang/run.ts";
import { ARITH, S, SHOW_ANY } from "../src/lang/std.ts";
import { COMPLEX_TYPE, schemeArith, showType } from "../src/lang/types.ts";
const L = (name: string) => LIBRARY.modules[0].exports.find((d) => LIBRARY.names[d] === name)!;

const runtime = pathToFileURL(join(import.meta.dirname, "../../compiler/src/runtime.js")).href;

function check(build: (k: Lang) => void) {
  const k = new Lang(LIBRARY.code);
  build(k);
  const code = base(k.code), names = baseNames(k.names);
  return { k, code, names, info: infer(code, names, undefined, checkOptions) };
}

// What main's lines print, shown: evaluated, then compiled to JS.
async function both(lines: (k: Lang, own: Record<string, Id>) => Id[], defs: (k: Lang) => Record<string, Id> = () => ({})): Promise<[string[], string[]]> {
  let main = "";
  const { code, names, info } = check((k) => { const own = defs(k); main = k.def("main"); k.define(main, k.thunk(() => k.seq(...lines(k, own).map((v) => k.call(S.print, k.call(SHOW_ANY, v)))))); });
  assert.deepEqual(info.errors.map((e) => e.message), []);
  const ran: string[] = [];
  runMain(code, info, main, { print: (s) => ran.push(s), names });
  const path = join(mkdtempSync(join(tmpdir(), "text-ordered-")), "out.mjs");
  writeFileSync(path, compile(code, info, names, { runtime, exports: ["main"] }));
  const compiled: string[] = [];
  $setPrint((s: string) => compiled.push(s));
  try { (await import(pathToFileURL(path).href)).defs.main(); } finally { $setPrint((s: string) => console.log(s)); }
  return [ran, compiled];
}

test("smaller, larger, at most and <, at Text: alphabetical, evaluated and compiled", async () => {
  const [ran, compiled] = await both((k, own) => [
    k.call(L("smaller"), k.lit("b"), k.lit("a")),
    k.call(L("larger"), k.lit("apple"), k.lit("banana")),
    k.call(L("at most"), k.lit("a"), k.lit("a")),
    k.call(L("more than"), k.lit("a"), k.lit("b")),
    k.call(ARITH.less, k.lit("Z"), k.lit("a")),
    k.call(own.first, k.lit("pear"), k.lit("fig")),
    k.call(own.first, k.int(3), k.int(2)),
  ], (k) => {
    // A definition of your own over the one <: Text and Int both take it.
    const first = k.def("earlier");
    k.define(first, k.fn(["a", "b"], (a, b) => k.if(k.call(ARITH.less, b, a), b, a)));
    return { first };
  });
  const want = ['"a"', '"banana"', "true", "false", "true", '"fig"', "2"];
  assert.deepEqual(ran, want);
  assert.deepEqual(compiled, want);
});

test("a definition over < says `a has <`; Text still has no +, and one over + and < still wants a Number", () => {
  const sc = check(() => {}).info.schemes.get(L("smaller"))!;
  const smaller = showType(sc.type, baseNames(LIBRARY.names), schemeArith(sc));
  assert.equal(smaller, "(a, a) -> a where a has <");
  const plus = check((k) => { const d = k.def("joined"); k.define(d, k.call(ARITH.add, k.lit("a"), k.lit("b"))); });
  assert.equal(plus.info.errors.length, 1);
  assert.match(plus.info.errors[0].message, /works only on a Number/);
  // Both + and <: a Number with <, which Text isn't (no + slips in by <).
  const both = check((k) => {
    const f = k.def("sum if less");
    k.define(f, k.fn(["a", "b"], (a, b) => k.if(k.call(ARITH.less, a, b), k.call(ARITH.add, a, b), a)));
    const d = k.def("use"); k.define(d, k.call(f, k.lit("a"), k.lit("b")));
  });
  assert.equal(both.info.errors.length, 1);
  assert.match(both.info.errors[0].message, /works only on a Number with </);
  // Complex has + but no <.
  const cx = check((k) => { const d = k.def("use"); k.define(d, k.call(L("smaller"), k.at(COMPLEX_TYPE, 1), k.at(COMPLEX_TYPE, 2))); });
  assert.equal(cx.info.errors.length, 1);
  assert.match(cx.info.errors[0].message, /works only on a type with </);
});
