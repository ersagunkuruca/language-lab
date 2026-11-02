// Small list rows from bigger-program round 9 (GAPS.md, BACKLOG L164):
// what machine wrote for itself, now in the prelude. Evaluated and compiled.

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
import { DIVERGE, showType } from "../src/lang/types.ts";
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
  const path = join(mkdtempSync(join(tmpdir(), "round9-")), "out.mjs");
  writeFileSync(path, compile(code, info, names, { runtime, exports: ["main"] }));
  const compiled: string[] = [];
  $setPrint((s: string) => compiled.push(s));
  try { (await import(pathToFileURL(path).href)).defs.main(); } finally { $setPrint((s: string) => console.log(s)); }
  return [ran, compiled];
}

const info = (() => { const code = base(LIBRARY.code), names = baseNames(LIBRARY.names); return { names, info: infer(code, names) }; })();
const type = (name: string) => showType(info.info.typeOf.get(L(name))!, info.names, info.info.subst.arith);
const ends = (name: string) => { const t = info.info.typeOf.get(L(name))!; return t.t !== "fn" || !t.eff.effs.includes(DIVERGE); };

test("L164: zipped, numbered and copies", async () => {
  const [ran, compiled] = await both((k) => [
    k.call(L("zipped"), k.list(k.int(1), k.int(2), k.int(3)), k.list(k.lit("a"), k.lit("b"))),
    k.call(L("zipped"), k.list(), k.list(k.int(1))),
    k.call(L("numbered"), k.list(k.lit("a"), k.lit("b"))),
    k.call(L("numbered"), k.list()),
    k.call(L("copies"), k.int(3), k.int(0)),
    k.call(L("copies"), k.int(0), k.lit("x")),
  ]);
  const want = ['[(1, "a"), (2, "b")]', "[]", '[(0, "a"), (1, "b")]', "[]", "[0, 0, 0]", "[]"];
  assert.deepEqual(ran, want);
  assert.deepEqual(compiled, want);
  for (const n of ["zipped", "numbered", "copies"]) assert.ok(ends(n), n);
  assert.equal(type("zipped"), "(List a, List b) -> List (a, b)");
  assert.equal(type("numbered"), "(List a) -> List (Int, a)");
  assert.equal(type("copies"), "(Int, a) -> List a");
  assert.equal(type("all pass"), "(List a, (a) -[e]-> Bool) -[e]-> Bool");
  assert.equal(type("any pass"), "(List a, (a) -[e]-> Bool) -[e]-> Bool");
});

test("L164: all pass and any pass", async () => {
  const want = ["true", "false", "true", "false", "true", "false"];
  const [ran, compiled] = await both((k) => {
    const pos = () => k.fn(["x"], (x) => k.call(INT_OPS.less, k.int(0), x));
    return [
      k.call(L("all pass"), k.list(k.int(1), k.int(2)), pos()), k.call(L("all pass"), k.list(k.int(1), k.int(-2)), pos()), k.call(L("all pass"), k.list(), pos()),
      k.call(L("any pass"), k.list(k.int(-1), k.int(-2)), pos()), k.call(L("any pass"), k.list(k.int(-1), k.int(2)), pos()), k.call(L("any pass"), k.list(), pos()),
    ];
  });
  assert.deepEqual(ran, want);
  assert.deepEqual(compiled, want);
});
