// Small library rows from bigger-program round 6 (GAPS.md, BACKLOG L133 to
// L136): what notebook and calc wrote for themselves, now in the prelude.

import { test } from "node:test";
import assert from "node:assert/strict";
import type { Id } from "../src/model.ts";
import { Lang } from "../src/lang/dsl.ts";
import { infer } from "../src/lang/infer.ts";
import { base, baseNames, checkOptions } from "../src/lang/load.ts";
import { LIBRARY } from "../src/lang/library.ts";
import { runMain } from "../src/lang/run.ts";
import { S, SHOW_ANY } from "../src/lang/std.ts";
import { showType } from "../src/lang/types.ts";

export const L = (name: string) => LIBRARY.modules[0].exports.find((d) => LIBRARY.names[d] === name)!;

// Prints each value main's lines give, shown.
export function prints(lines: (k: Lang) => Id[]): string[] {
  const k = new Lang(LIBRARY.code);
  const main = k.def("main");
  k.define(main, k.thunk(() => k.seq(...lines(k).map((v) => k.call(S.print, k.call(SHOW_ANY, v))))));
  const code = base(k.code), names = baseNames(k.names);
  const info = infer(code, names, undefined, checkOptions);
  assert.deepEqual(info.errors.map((e) => e.message), []);
  const out: string[] = [];
  runMain(code, info, main, { print: (s) => out.push(s), names });
  return out;
}

const type = (name: string) => {
  const code = base(LIBRARY.code), names = baseNames(LIBRARY.names), info = infer(code, names);
  return showType(info.typeOf.get(L(name))!, names, info.subst.arith);
};

test("L136: one sum for every number type, as + is", () => {
  assert.match(type("sum"), /^\(List a\) -> a where a is a Number/);
  assert.deepEqual(prints((k) => [
    k.call(L("sum"), k.list(k.int(1), k.int(2), k.int(3))),
    k.call(L("sum"), k.list(k.lit(0.5), k.lit(0.25))),
    k.call(L("sum"), k.list()),
  ]), ["6", "0.75", "0"]);
});
