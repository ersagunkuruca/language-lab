// contains text and after prefix (L169, REVIEW-2026-11-02d §4): a text's
// inside. Evaluated and compiled.

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
import { S, SHOW_ANY } from "../src/lang/std.ts";
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
  const path = join(mkdtempSync(join(tmpdir(), "text-inside-")), "out.mjs");
  writeFileSync(path, compile(code, info, names, { runtime, exports: ["main"] }));
  const compiled: string[] = [];
  $setPrint((s: string) => compiled.push(s));
  try { (await import(pathToFileURL(path).href)).defs.main(); } finally { $setPrint((s: string) => console.log(s)); }
  return [ran, compiled];
}

const info = (() => { const code = base(LIBRARY.code), names = baseNames(LIBRARY.names); return { names, info: infer(code, names) }; })();
const type = (name: string) => showType(info.info.typeOf.get(L(name))!, info.names, info.info.subst.arith);

test("L169: contains text and after prefix, evaluated and compiled", async () => {
  const want = ["true", "false", "true", '"7"', '"r7"', '""', "true"];
  const [ran, compiled] = await both((k) => {
    const has = (t: string, p: string) => k.call(L("contains text"), k.lit(t), k.lit(p));
    const after = (t: string, p: string) => k.call(S.first, k.thunk(() => k.call(L("after prefix"), k.lit(t), k.lit(p))), k.thunk(() => k.lit(t)));
    return [has("to do list", "do"), has("to do list", "done"), has("", ""), after("r7", "r"), after("r7", "#"), after("#", "#"),
      k.call(S.equal, k.call(L("contains text"), k.lit("Sketch the BOARD"), k.lit("BOARD")), k.true)];
  });
  assert.deepEqual(ran, want);
  assert.deepEqual(compiled, want);
  assert.equal(type("contains text"), "(Text, Text) -> Bool");
  assert.equal(type("after prefix"), "(Text, Text) -[Choice]-> Text");
});
