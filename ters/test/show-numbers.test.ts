// show writes every number type as the number it stands for (BACKLOG
// L153, REVIEW-2026-11-02 §4): a Fixed by `show fixed`'s digits, an
// Extended as its number or ±∞. Evaluated and compiled.

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
const L = (name: string) => LIBRARY.modules[0].exports.find((d) => LIBRARY.names[d] === name)!;

const runtime = pathToFileURL(join(import.meta.dirname, "../../compiler/src/runtime.js")).href;

// What main's lines print, shown: evaluated, then compiled to JS.
async function both(lines: (k: Lang) => Id[]): Promise<[string[], string[]]> {
  const k = new Lang(LIBRARY.code);
  const main = k.def("main");
  k.define(main, k.thunk(() => k.seq(...lines(k).map((v) => k.call(S.print, k.call(SHOW_ANY, v))))));
  const code = base(k.code), names = baseNames(k.names);
  const info = infer(code, names, undefined, checkOptions);
  assert.deepEqual(info.errors.map((e) => e.message), []);
  const ran: string[] = [];
  runMain(code, info, main, { print: (s) => ran.push(s), names });
  const path = join(mkdtempSync(join(tmpdir(), "show-numbers-")), "out.mjs");
  writeFileSync(path, compile(code, info, names, { runtime, exports: ["main"] }));
  const compiled: string[] = [];
  $setPrint((s: string) => compiled.push(s));
  try { (await import(pathToFileURL(path).href)).defs.main(); } finally { $setPrint((s: string) => console.log(s)); }
  return [ran, compiled];
}

// divide fixed has no answer at 0, so it is a Choice: first takes its one.
const dv = (k: Lang, a: Id, b: Id) => k.call(S.first, k.thunk(() => k.call(L("divide fixed"), a, b)), k.thunk(() => k.call(L("as fixed"), k.int(0))));

test("L153: show writes a Fixed and an Extended as numbers, inside lists too", async () => {
  const fixed = (k: Lang, x: Id) => k.call(L("as fixed"), x);
  const want = ["3", "-2", "[3, 0.5]", "0.0999999999", "3", "+∞", "−∞", "[1, +∞]"];
  const [ran, compiled] = await both((k) => [
    fixed(k, k.int(3)), fixed(k, k.int(-2)),
    k.list(fixed(k, k.int(3)), dv(k, fixed(k, k.int(1)), fixed(k, k.int(2)))),
    dv(k, fixed(k, k.int(1)), fixed(k, k.int(10))),
    k.call(L("maximum"), k.list(k.int(3))), k.call(L("minimum"), k.list()), k.call(L("maximum"), k.list()),
    k.list(k.call(L("maximum"), k.list(k.int(1))), k.call(L("minimum"), k.list())),
  ]);
  assert.deepEqual(ran, want);
  assert.deepEqual(compiled, want);
});

test("L153: show agrees with show fixed on every step it tries", async () => {
  // 1/3, 2/3, 1/7, 1/10 (divide rounds down, so 0.0999999999) and a negative: Steele and White's digits, both ways.
  const xs = (k: Lang) => [[1, 3], [2, 3], [1, 7], [1, 10], [-5, 9], [1000, 1]].map(([a, b]) => dv(k, k.call(L("as fixed"), k.int(a)), k.call(L("as fixed"), k.int(b))));
  const [shown] = await both((k) => xs(k));
  const [own] = await both((k) => xs(k).map((x) => k.call(L("show fixed"), x)));
  assert.deepEqual(shown, own.map((t) => JSON.parse(t)));
});

test("L154: a Float64 shows to 9 decimals, and one below 10⁻⁶ in size by the shortest text that reads back to it", async () => {
  const want = ["0.3", "0.333333333", "1e-12", "-5e-7", "0.000001", "0", "2.5"];
  const [ran, compiled] = await both((k) => [
    k.lit(0.1 + 0.2), k.lit(1 / 3), k.lit(1e-12), k.lit(-5e-7), k.lit(1e-6), k.lit(0), k.lit(2.5),
  ].map((x) => k.call(S.show, x)));
  assert.deepEqual(ran.map((t) => JSON.parse(t)), want);
  assert.deepEqual(compiled.map((t) => JSON.parse(t)), want);
});
