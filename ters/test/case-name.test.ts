// case name (L162, GAPS round 9 MG1): the name of the case a value was
// made by, as text. Evaluated and compiled.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { compile } from "../../compiler/src/compile.ts";
import { $setPrint } from "../../compiler/src/runtime.js";
import { Lang } from "../src/lang/dsl.ts";
import { infer } from "../src/lang/infer.ts";
import { base, baseNames, checkOptions } from "../src/lang/load.ts";
import { LIBRARY } from "../src/lang/library.ts";
import { runMain } from "../src/lang/run.ts";
import { CASE_NAME, NONE, S, SOME } from "../src/lang/std.ts";
import { INT } from "../src/lang/types.ts";

const runtime = pathToFileURL(join(import.meta.dirname, "../../compiler/src/runtime.js")).href;

test("L162: case name, evaluated and compiled", async () => {
  const k = new Lang(LIBRARY.code);
  const int = () => k.tref(INT);
  const Instr = k.type("Instr", [], [["halt", []], ["add", [["to", int], ["from", int]]], ["jump", [["at", int]]]]);
  const instr = Instr.v;
  const main = k.def("main");
  const name = (v: string) => k.call(S.print, k.call(CASE_NAME, v));
  k.define(main, k.thunk(() => k.seq(
    name(k.x(instr.halt)), name(k.call(instr.add, k.int(1), k.int(2))), name(k.call(instr.jump, k.int(4))),
    name(k.call(SOME, k.int(3))), name(k.x(NONE)), name(k.list()), name(k.list(k.int(1))),
    name(k.int(7)), name(k.lit("text")), name(k.true),
  )));
  const code = base(k.code), names = baseNames(k.names);
  const info = infer(code, names, undefined, checkOptions);
  assert.deepEqual(info.errors.map((e) => e.message), []);
  const want = ["halt", "add", "jump", "some", "none", "nil", "cons", "", "", "true"];
  const ran: string[] = [];
  runMain(code, info, main, { print: (s) => ran.push(s), names });
  assert.deepEqual(ran, want);
  const path = join(mkdtempSync(join(tmpdir(), "case-name-")), "out.mjs");
  writeFileSync(path, compile(code, info, names, { runtime, exports: ["main"] }));
  const compiled: string[] = [];
  $setPrint((s: string) => compiled.push(s));
  try { (await import(pathToFileURL(path).href)).defs.main(); } finally { $setPrint((s: string) => console.log(s)); }
  assert.deepEqual(compiled, want);
});
