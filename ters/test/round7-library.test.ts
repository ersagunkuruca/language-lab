// Small library rows from bigger-program round 7 (GAPS.md, BACKLOG L148):
// what sheet wrote for itself, now in the prelude. Evaluated and compiled.

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
import { DIVERGE, showType } from "../src/lang/types.ts";
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
  const path = join(mkdtempSync(join(tmpdir(), "round7-")), "out.mjs");
  writeFileSync(path, compile(code, info, names, { runtime, exports: ["main"] }));
  const compiled: string[] = [];
  $setPrint((s: string) => compiled.push(s));
  try { (await import(pathToFileURL(path).href)).defs.main(); } finally { $setPrint((s: string) => console.log(s)); }
  return [ran, compiled];
}

const info = (() => { const code = base(LIBRARY.code), names = baseNames(LIBRARY.names); return { names, info: infer(code, names) }; })();
const type = (name: string) => showType(info.info.typeOf.get(L(name))!, info.names, info.info.subst.arith);
const ends = (name: string) => { const t = info.info.typeOf.get(L(name))!; return t.t !== "fn" || !t.eff.effs.includes(DIVERGE); };

test("L148: a text repeated, padded at its start or end", async () => {
  const want = ['"ababab"', '""', '""', '"007"', '"1234"', '"xyxy7"', '"ab.."', '"ab"', '"ab"'];
  const [ran, compiled] = await both((k) => [
    k.call(L("repeated"), k.lit("ab"), k.int(3)), k.call(L("repeated"), k.lit("ab"), k.int(0)), k.call(L("repeated"), k.lit("ab"), k.int(-2)),
    k.call(L("padded start"), k.lit("7"), k.int(3), k.lit("0")), k.call(L("padded start"), k.lit("1234"), k.int(3), k.lit("0")),
    k.call(L("padded start"), k.lit("7"), k.int(5), k.lit("xy")),
    k.call(L("padded end"), k.lit("ab"), k.int(4), k.lit(".")), k.call(L("padded end"), k.lit("ab"), k.int(1), k.lit(".")),
    k.call(L("padded end"), k.lit("ab"), k.int(4), k.lit("")),
  ]);
  assert.deepEqual(ran, want);
  assert.deepEqual(compiled, want);
  assert.equal(type("repeated"), "(Text, Int) -> Text");
  assert.equal(type("padded start"), "(Text, Int, Text) -> Text");
  for (const n of ["repeated", "padded start", "padded end"]) assert.ok(ends(n), n);
});

test("L148: flatten and flat map", async () => {
  const want = ["[1, 2, 3]", "[]", "[1, 1, 2, 2]", "[]"];
  const [ran, compiled] = await both((k) => [
    k.call(L("flatten"), k.list(k.list(k.int(1), k.int(2)), k.list(), k.list(k.int(3)))),
    k.call(L("flatten"), k.list()),
    k.call(L("flat map"), k.list(k.int(1), k.int(2)), k.fn(["x"], (x) => k.list(x, x))),
    k.call(L("flat map"), k.list(k.int(1)), k.fn(["x"], () => k.list())),
  ]);
  assert.deepEqual(ran, want);
  assert.deepEqual(compiled, want);
  assert.equal(type("flatten"), "(List (List a)) -> List a");
  for (const n of ["flatten", "flat map"]) assert.ok(ends(n), n);
});

test("L147: range from, the Ints from start up to end", async () => {
  const want = ["[2, 3, 4]", "[]", "[]", "[-2, -1, 0]"];
  const [ran, compiled] = await both((k) => [
    k.call(L("range from"), k.int(2), k.int(5)), k.call(L("range from"), k.int(5), k.int(5)), k.call(L("range from"), k.int(5), k.int(2)),
    k.call(L("range from"), k.int(-2), k.int(1)),
  ]);
  assert.deepEqual(ran, want);
  assert.deepEqual(compiled, want);
  assert.equal(type("range from"), "(Int, Int) -> List Int");
  assert.ok(ends("range from"));
});
