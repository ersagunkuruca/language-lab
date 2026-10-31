// A Float64 to a fixed number of decimals (BACKLOG I93): show decimals,
// rounding half away from 0 and keeping trailing zeros. Evaluated and
// compiled to JS, which must agree.

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
import { showType } from "../src/lang/types.ts";
import type { Id } from "../src/model.ts";
import { compile } from "../../compiler/src/compile.ts";

const runtime = pathToFileURL(join(import.meta.dirname, "../../compiler/src/runtime.js")).href;
const lib = (name: string) => LIBRARY.modules.flatMap((m) => m.exports).find((d) => LIBRARY.names[d] === name)!;

test("show decimals: fixed places, trailing zeros kept, no -0", async () => {
  const k = new Lang(LIBRARY.code);
  const cases: [number, number, string][] = [
    [3.14159, 2, "3.14"], [2.5, 3, "2.500"], [-1.25, 1, "-1.3"], [0.5, 0, "1"], [-0.0004, 3, "0.000"],
    [-0.0006, 3, "-0.001"], [1234.5678, 2, "1234.57"], [0.05, 1, "0.1"], [7, 0, "7"], [0.999, 2, "1.00"], [0.007, 3, "0.007"],
  ];
  const names = cases.map(([x, p], i) => { const d = k.def(`case ${i}`); k.define(d, k.call(lib("show decimals"), k.lit(x), k.lit(p))); return `case ${i}`; });
  const code = base(k.code), nm = baseNames(k.names), info = infer(code, nm, undefined, checkOptions);
  assert.deepEqual(info.errors.map((e) => e.message), []);
  assert.equal(showType(info.subst.zonk(info.typeOf.get(lib("show decimals"))!), nm), "(Float64, Float64) -> Text");
  const r = makeRunner(code, info, { print: () => {}, names: nm });
  const defOf = (n: string) => code.defs.find((d) => nm[d] === n)! as Id;
  assert.deepEqual(names.map((n) => r.value(defOf(n)) as Value), cases.map(([, , want]) => want));
  const path = join(mkdtempSync(join(tmpdir(), "show-decimals-")), "show-decimals.js");
  writeFileSync(path, compile(code, info, nm, { runtime, exports: names }));
  const defs = (await import(pathToFileURL(path).href)).defs as Record<string, unknown>;
  assert.deepEqual(names.map((n) => (typeof defs[n] === "function" ? (defs[n] as () => Value)() : defs[n])), cases.map(([, , want]) => want));
});
