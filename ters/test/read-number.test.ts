// read number (L176, GAPS round 10 KL3): the Float64 a text spells.
// Evaluated and compiled.

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
import { S, SHOW_ANY, TEXT_OPS } from "../src/lang/std.ts";
import { showType } from "../src/lang/types.ts";
const L = (name: string) => LIBRARY.modules[0].exports.find((d) => LIBRARY.names[d] === name)!;

const runtime = pathToFileURL(join(import.meta.dirname, "../../compiler/src/runtime.js")).href;

async function both(lines: (k: Lang) => Id[]): Promise<[string[], string[]]> {
  const k = new Lang(LIBRARY.code);
  const main = k.def("main");
  k.define(main, k.thunk(() => k.seq(...lines(k).map((v) => k.call(S.print, k.call(SHOW_ANY, v))))));
  const code = base(k.code), names = baseNames(k.names);
  const info = infer(code, names, undefined, checkOptions);
  assert.deepEqual(info.errors.map((e) => e.message), []);
  const ran: string[] = [];
  runMain(code, info, main, { print: (s) => ran.push(s), names });
  const path = join(mkdtempSync(join(tmpdir(), "read-number-")), "out.mjs");
  writeFileSync(path, compile(code, info, names, { runtime, exports: ["main"] }));
  const compiled: string[] = [];
  $setPrint((s: string) => compiled.push(s));
  try { (await import(pathToFileURL(path).href)).defs.main(); } finally { $setPrint((s: string) => console.log(s)); }
  return [ran, compiled];
}

test("L176: read number reads decimals, signs and exponents, and nothing else", async () => {
  const texts = ["30.5", "-2", ".5", "1e-3", "+7.25E2", "0.1", "-0", "5.", "", "1,5", "abc", "1e400", "--1", "1e"];
  const want = ["30.5", "-2", "0.5", "0.001", "725", "0.1", "0", "5", "none", "none", "none", "none", "none", "none"];
  const [ran, compiled] = await both((k) => texts.map((t) => k.call(S.first, k.thunk(() => k.call(S.show, k.call(TEXT_OPS.readNumber, k.lit(t)))), k.thunk(() => k.lit("none")))));
  const unquote = (xs: string[]) => xs.map((x) => JSON.parse(x));
  assert.deepEqual(unquote(ran), want);
  assert.deepEqual(unquote(compiled), want);
});
