// Functions take all their inputs at once; one at a time is asked for
// (BACKLOG L87): curry, uncurry, partially and flip in the prelude, the
// same in the evaluator and compiled JS.

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
import { ARITH, SHOW_ANY } from "../src/lang/std.ts";
import { showType } from "../src/lang/types.ts";
import type { Id } from "../src/model.ts";
import { compile } from "../../compiler/src/compile.ts";

const runtime = pathToFileURL(join(import.meta.dirname, "../../compiler/src/runtime.js")).href;
const lib = (name: string) => LIBRARY.modules.flatMap((m) => m.exports).find((d) => LIBRARY.names[d] === name)!;

function program() {
  const k = new Lang(LIBRARY.code);
  const def = (name: string, body: () => Id) => { const d = k.def(name); k.define(d, body()); return d; };
  const show = (x: Id) => k.call(SHOW_ANY, x);
  const five = () => k.lit(5), three = () => k.lit(3);
  const minus = () => k.fn(["a", "b"], (a, b) => k.call(ARITH.sub, a, b));
  def("one at a time", () => show(k.call(k.call(k.call(lib("curry"), minus()), five()), three())));
  def("back to two", () => show(k.call(k.call(lib("uncurry"), k.call(lib("curry"), minus())), five(), three())));
  def("one more each", () => show(k.call(lib("map"), k.list(k.lit(1), k.lit(2), k.lit(3)), k.call(lib("partially"), k.fn(["a", "b"], (a, b) => k.call(ARITH.add, a, b)), k.lit(1)))));
  def("swapped", () => show(k.call(k.call(lib("flip"), minus()), five(), three())));
  const code = base(k.code), names = baseNames(k.names);
  return { code, names, info: infer(code, names, undefined, checkOptions) };
}
const NAMES = ["one at a time", "back to two", "one more each", "swapped"];

test("curry, uncurry, partially and flip: their types, and what they give, evaluated and compiled", async () => {
  const p = program();
  assert.deepEqual(p.info.errors.map((e) => e.message), []);
  const t = (name: string) => showType(p.info.schemes.get(lib(name))!.type, p.names);
  assert.match(t("curry"), /^\(\(a, b\) -\[(\w+)\]-> c\) -> \(a\) -> \(b\) -\[\1\]-> c$/);
  assert.match(t("uncurry"), /^\(\(a\) -\[(\w+)\]-> \(b\) -\[(\w+)\]-> c\) -> \(a, b\) -\[\1, \2\]-> c$|^\(\(a\) -\[(\w+)\]-> \(b\) -\[\3\]-> c\) -> \(a, b\) -\[\3\]-> c$/);
  assert.match(t("partially"), /^\(\(a, b\) -\[(\w+)\]-> c, a\) -> \(b\) -\[\1\]-> c$/);
  assert.match(t("flip"), /^\(\(a, b\) -\[(\w+)\]-> c\) -> \(b, a\) -\[\1\]-> c$/);
  const r = makeRunner(p.code, p.info, { print: () => {}, names: p.names });
  const at = (n: string) => p.code.defs.find((d) => p.names[d] === n)!;
  assert.deepEqual(NAMES.map((n) => r.value(at(n))), ["2", "2", "[2, 3, 4]", "-2"]);
  const path = join(mkdtempSync(join(tmpdir(), "curry-")), "curry.js");
  writeFileSync(path, compile(p.code, p.info, p.names, { runtime, exports: NAMES }));
  const defs = (await import(pathToFileURL(path).href)).defs as Record<string, unknown>;
  for (const n of NAMES) {
    const c = typeof defs[n] === "function" ? (defs[n] as () => Value)() : defs[n];
    assert.deepEqual(c, r.value(at(n)), n);
  }
});
