// A match on plain values (L164c, GAPS round 9 MG3, REVIEW-2026-11-02d
// §3): each case a literal, the rest arm required. Evaluated and compiled.

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
import { relate, toValue } from "../src/lang/relate.ts";
import { runMain } from "../src/lang/run.ts";
import { S, SHOW_ANY } from "../src/lang/std.ts";

const runtime = pathToFileURL(join(import.meta.dirname, "../../compiler/src/runtime.js")).href;

function program(build: (k: Lang) => { main: Id }) {
  const k = new Lang(LIBRARY.code);
  const { main } = build(k);
  const code = base(k.code), names = baseNames(k.names);
  return { k, code, names, main, info: infer(code, names, undefined, checkOptions) };
}

const ops = (k: Lang) => {
  const op = k.def("op");
  k.define(op, k.fn(["name"], (name) => k.byValue(name, [[k.lit("add"), k.int(1)], [k.lit("jump"), k.int(2)], [k.lit("halt"), k.int(3)]], k.int(0))));
  const words = k.def("words");
  k.define(words, k.fn(["n"], (n) => k.byValue(n, [[k.lit(1), k.lit("one")], [k.lit(2), k.lit("two")]], k.lit("many"))));
  return { op, words };
};

test("L164c: a match on values, by Text and by number, evaluated and compiled", async () => {
  let fns!: { op: Id; words: Id };
  const p = program((k) => {
    fns = ops(k);
    const main = k.def("main");
    k.define(main, k.thunk(() => k.seq(...[
      k.call(fns.op, k.lit("jump")), k.call(fns.op, k.lit("halt")), k.call(fns.op, k.lit("nop")),
      k.call(fns.words, k.int(2)), k.call(fns.words, k.int(7)),
    ].map((v) => k.call(S.print, k.call(SHOW_ANY, v))))));
    return { main };
  });
  assert.deepEqual(p.info.errors.map((e) => e.message), []);
  const ran: string[] = [];
  runMain(p.code, p.info, p.main, { print: (s) => ran.push(s), names: p.names });
  const want = ["2", "3", "0", '"two"', '"many"'];
  assert.deepEqual(ran, want);
  const path = join(mkdtempSync(join(tmpdir(), "literal-match-")), "out.mjs");
  writeFileSync(path, compile(p.code, p.info, p.names, { runtime, exports: ["main"] }));
  const compiled: string[] = [];
  $setPrint((s: string) => compiled.push(s));
  try { (await import(pathToFileURL(path).href)).defs.main(); } finally { $setPrint((s: string) => console.log(s)); }
  assert.deepEqual(compiled, want);
  // Backwards too: which names give 2.
  const param = (fn: Id) => ((p.code.nodes[(p.code.nodes[fn] as { body: Id }).body] as { params: Id[] }).params[0]);
  assert.equal(toValue([...relate(p.code, fns.op, { [param(fns.op)]: "add" })][0].values.out), 1);
});

test("L164c: the rest arm is required, a value comes once, and each is the scrutinee's type", () => {
  const errors = (cases: (k: Lang) => [Id, Id][], otherwise: boolean) => program((k) => {
    const f = k.def("f");
    k.define(f, k.fn(["x"], (x) => k.byValue(k.call(S.concat, x, k.lit("")), cases(k), otherwise ? k.int(0) : undefined)));
    return { main: f };
  }).info.errors.map((e) => e.message);
  assert.deepEqual(errors((k) => [[k.lit("a"), k.int(1)]], false), ["a choice by value needs a case for every other value"]);
  assert.deepEqual(errors((k) => [[k.lit("a"), k.int(1)], [k.lit("a"), k.int(2)]], true), ['"a" is handled twice']);
  assert.equal(errors((k) => [[k.lit("a"), k.int(1)], [k.lit(3), k.int(2)]], true).length, 1);
});
