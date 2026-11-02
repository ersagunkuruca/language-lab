// Small list rows from bigger-program round 8 (GAPS.md, BACKLOG L161):
// what board wrote for itself, now in the prelude. Evaluated and compiled.

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
  const path = join(mkdtempSync(join(tmpdir(), "round8-")), "out.mjs");
  writeFileSync(path, compile(code, info, names, { runtime, exports: ["main"] }));
  const compiled: string[] = [];
  $setPrint((s: string) => compiled.push(s));
  try { (await import(pathToFileURL(path).href)).defs.main(); } finally { $setPrint((s: string) => console.log(s)); }
  return [ran, compiled];
}

const info = (() => { const code = base(LIBRARY.code), names = baseNames(LIBRARY.names); return { names, info: infer(code, names) }; })();
const type = (name: string) => showType(info.info.typeOf.get(L(name))!, info.names, info.info.subst.arith);
const ends = (name: string) => { const t = info.info.typeOf.get(L(name))!; return t.t !== "fn" || !t.eff.effs.includes(DIVERGE); };

test("L161: searching a list", async () => {
  const [ran, compiled] = await both((k) => {
    const big = () => k.fn(["x"], (x) => k.call(INT_OPS.less, k.int(5), x));
    return [
      k.call(L("first where"), k.list(k.int(3), k.int(8), k.int(9)), big()), k.call(L("first where"), k.list(k.int(3)), big()),
      k.call(L("position of"), k.list(k.lit("a"), k.lit("b"), k.lit("b")), k.lit("b")), k.call(L("position of"), k.list(k.lit("a")), k.lit("c")),
      k.call(L("contains"), k.list(k.int(1), k.int(2)), k.int(2)), k.call(L("contains"), k.list(), k.int(2)),
    ];
  });
  const want = ["some(8)", "none", "some(1)", "none", "true", "false"];
  assert.deepEqual(ran, want);
  assert.deepEqual(compiled, want);
  assert.equal(type("first where"), "(List a, (a) -[e]-> Bool) -[e]-> Optional a");
  assert.equal(type("position of"), "(List a, a) -> Optional Int");
  assert.equal(type("contains"), "(List a, a) -> Bool");
  assert.equal(type("largest of"), "(List a) -> Optional a where a has <");
  assert.equal(type("smallest of"), "(List a) -> Optional a where a has <");
  assert.equal(type("inserted at"), "(List a, Int, a) -> List a");
  for (const n of ["position of", "contains", "largest of", "smallest of", "inserted at"]) assert.ok(ends(n), n);
});

test("L161: largest, smallest, inserted at", async () => {
  const [ran, compiled] = await both((k) => [
    k.call(L("largest of"), k.list(k.int(3), k.int(9), k.int(4))), k.call(L("smallest of"), k.list(k.int(3), k.int(9), k.int(4))),
    k.call(L("largest of"), k.list(k.lit("pear"), k.lit("apple"))), k.call(L("largest of"), k.list(k.lit(1.5), k.lit(-2))),
    k.call(L("inserted at"), k.list(k.int(1), k.int(3)), k.int(1), k.int(2)), k.call(L("inserted at"), k.list(k.int(1)), k.int(0), k.int(0)),
    k.call(L("inserted at"), k.list(k.int(1)), k.int(5), k.int(9)),
  ]);
  const want = ["some(9)", "some(3)", 'some("pear")', "some(1.5)", "[1, 2, 3]", "[0, 1]", "[1, 9]"];
  assert.deepEqual(ran, want);
  assert.deepEqual(compiled, want);
});
