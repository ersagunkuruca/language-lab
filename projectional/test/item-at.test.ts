// A list's items by position (BACKLOG I83): item at and replace at,
// counting from 0, with no Choice outside the list. Evaluated and compiled.

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
import { SHOW_ANY } from "../src/lang/std.ts";
import { showType } from "../src/lang/types.ts";
import type { Id } from "../src/model.ts";
import { compile } from "../../compiler/src/compile.ts";

const runtime = pathToFileURL(join(import.meta.dirname, "../../compiler/src/runtime.js")).href;
const lib = (name: string) => LIBRARY.modules.flatMap((m) => m.exports).find((d) => LIBRARY.names[d] === name)!;

test("item at and replace at: by position from 0, outside the list harmless", async () => {
  const k = new Lang(LIBRARY.code);
  const def = (name: string, body: () => Id) => { const d = k.def(name); k.define(d, body()); return d; };
  const list = () => k.list(...["a", "b", "c"].map((x) => k.lit(x)));
  const cases: [string, () => Id, string][] = [
    ["first", () => k.call(lib("item at"), list(), k.lit(0), k.lit("none")), '"a"'],
    ["last", () => k.call(lib("item at"), list(), k.lit(2), k.lit("none")), '"c"'],
    ["past the end", () => k.call(lib("item at"), list(), k.lit(3), k.lit("none")), '"none"'],
    ["before the start", () => k.call(lib("item at"), list(), k.lit(-1), k.lit("none")), '"none"'],
    ["replace the middle", () => k.call(lib("replace at"), list(), k.lit(1), k.lit("B")), '["a", "B", "c"]'],
    ["replace past the end", () => k.call(lib("replace at"), list(), k.lit(7), k.lit("B")), '["a", "b", "c"]'],
  ];
  const names = cases.map(([n, x]) => { def(`case ${n}`, () => k.call(SHOW_ANY, x())); return `case ${n}`; });
  const code = base(k.code), nm = baseNames(k.names), info = infer(code, nm, undefined, checkOptions);
  assert.deepEqual(info.errors.map((e) => e.message), []);
  assert.equal(showType(info.subst.zonk(info.typeOf.get(lib("item at"))!), nm), "(List a, Float64, a) -> a");
  const r = makeRunner(code, info, { print: () => {}, names: nm });
  const got = names.map((n) => r.value(code.defs.find((d) => nm[d] === n)!));
  assert.deepEqual(got, cases.map(([, , want]) => want));
  const path = join(mkdtempSync(join(tmpdir(), "item-at-")), "item-at.js");
  writeFileSync(path, compile(code, info, nm, { runtime, exports: names }));
  const defs = (await import(pathToFileURL(path).href)).defs as Record<string, unknown>;
  assert.deepEqual(names.map((n) => (typeof defs[n] === "function" ? (defs[n] as () => Value)() : defs[n])), got);
});
