// case of (L164b, GAPS round 9 MG3): a choice by value, the first case
// whose key equals the key. Evaluated and compiled.

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
import { PAIR_V, S, SHOW_ANY } from "../src/lang/std.ts";
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
  const path = join(mkdtempSync(join(tmpdir(), "case-of-")), "out.mjs");
  writeFileSync(path, compile(code, info, names, { runtime, exports: ["main"] }));
  const compiled: string[] = [];
  $setPrint((s: string) => compiled.push(s));
  try { (await import(pathToFileURL(path).href)).defs.main(); } finally { $setPrint((s: string) => console.log(s)); }
  return [ran, compiled];
}

const info = (() => { const code = base(LIBRARY.code), names = baseNames(LIBRARY.names); return { names, info: infer(code, names) }; })();
const type = (name: string) => showType(info.info.typeOf.get(L(name))!, info.names, info.info.subst.arith);

test("L164b: case of, by Text and by Int, evaluated and compiled", async () => {
  const want = ["2", "1", "0", '"two"', '"many"'];
  const [ran, compiled] = await both((k) => {
    const ops = (name: string) => k.call(L("case of"), k.lit(name), k.list(
      k.call(PAIR_V, k.lit("add"), k.thunk(() => k.int(1))), k.call(PAIR_V, k.lit("jump"), k.thunk(() => k.int(2))), k.call(PAIR_V, k.lit("add"), k.thunk(() => k.int(9)))),
      k.thunk(() => k.int(0)));
    const words = (n: number) => k.call(L("case of"), k.int(n), k.list(k.call(PAIR_V, k.int(1), k.thunk(() => k.lit("one"))), k.call(PAIR_V, k.int(2), k.thunk(() => k.lit("two")))), k.thunk(() => k.lit("many")));
    return [ops("jump"), ops("add"), ops("halt"), words(2), words(7)];
  });
  assert.deepEqual(ran, want);
  assert.deepEqual(compiled, want);
  assert.equal(type("case of"), "(a, List (a, () -[e]-> b), () -[e]-> b) -[e]-> b");
});
