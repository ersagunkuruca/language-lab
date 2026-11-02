// random item (L171, REVIEW-2026-11-02d §4): an item drawn at random, none
// of an empty list. Seeded, evaluated and compiled draw the same.

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
import { INT_OPS, S, SHOW_ANY } from "../src/lang/std.ts";
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
  const path = join(mkdtempSync(join(tmpdir(), "random-item-")), "out.mjs");
  writeFileSync(path, compile(code, info, names, { runtime, exports: ["main"] }));
  const compiled: string[] = [];
  $setPrint((s: string) => compiled.push(s));
  try { (await import(pathToFileURL(path).href)).defs.main(); } finally { $setPrint((s: string) => console.log(s)); }
  return [ran, compiled];
}

const info = (() => { const code = base(LIBRARY.code), names = baseNames(LIBRARY.names); return { names, info: infer(code, names) }; })();
const type = (name: string) => showType(info.info.typeOf.get(L(name))!, info.names, info.info.subst.arith);

test("L171: random item draws each item, the same seeded in both, and none of an empty list", async () => {
  const [ran, compiled] = await both((k) => [
    k.call(S.seeded, k.lit(7), k.thunk(() => k.call(L("map"), k.call(INT_OPS.range, k.int(40)), k.fn(["i"], () => k.call(S.first, k.thunk(() => k.call(L("random item"), k.list(k.lit("a"), k.lit("b"), k.lit("c")))), k.thunk(() => k.lit("none"))))))),
    k.call(S.first, k.thunk(() => k.call(L("random item"), k.x("std.list.nil"))), k.thunk(() => k.lit("none"))),
  ]);
  assert.deepEqual(ran, compiled);
  const draws = JSON.parse(ran[0]);
  assert.equal(draws.length, 40);
  assert.deepEqual([...new Set(draws)].sort(), ["a", "b", "c"]);
  assert.equal(ran[1], '"none"');
  assert.equal(type("random item"), "(List a) -[Choice, Random]-> a");
});
