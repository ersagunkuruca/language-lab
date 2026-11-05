// read number (L176, GAPS round 10 KL3): the Float64 a text spells.
// Evaluated and compiled.

import { test } from "node:test";
import assert from "node:assert/strict";
import { compiledDefs } from "../../compiler/src/core-js.ts";
import type { Id } from "../src/model.ts";
import { Lang } from "../src/lang/dsl.ts";
import { infer } from "../src/lang/infer.ts";
import { base, baseNames, checkOptions } from "../src/lang/load.ts";
import { LIBRARY } from "../src/lang/library.ts";
import { runMain } from "../src/lang/run.ts";
import { S, SHOW_ANY, TEXT_OPS } from "../src/lang/std.ts";
const L = (name: string) => LIBRARY.modules[0].exports.find((d) => LIBRARY.names[d] === name)!;


async function both(lines: (k: Lang) => Id[]): Promise<[string[], string[]]> {
  const k = new Lang(LIBRARY.code);
  const main = k.def("main");
  k.define(main, k.thunk(() => k.seq(...lines(k).map((v) => k.call(S.print, k.call(SHOW_ANY, v))))));
  const code = base(k.code), names = baseNames(k.names);
  const info = infer(code, names, undefined, checkOptions);
  assert.deepEqual(info.errors.map((e) => e.message), []);
  const ran: string[] = [];
  runMain(code, info, main, { print: (s) => ran.push(s), names });
  const compiled: string[] = [];
  compiledDefs(code, info, names, ["main"], { print: (s: string) => compiled.push(s) })["main"]();
  return [ran, compiled];
}

test("L176: read number reads decimals, signs and exponents, and nothing else", async () => {
  const texts = ["30.5", "-2", ".5", "1e-3", "+7.25E2", "0.1", "-0", "5.", "", "1,5", "abc", "1e400", "--1", "1e"];
  const want = ["30.5", "-2", "0.5", "0.001", "725", "0.1", "0", "5", "none", "none", "none", "none", "none", "none"];
  const [ran, compiled] = await both((k) => texts.map((t) => k.call(S.first, k.thunk(() => k.call(S.show, k.call(TEXT_OPS.readNumber, k.lit(t)))), k.thunk(() => k.lit("none")))));
  const unquote = (xs: string[]) => xs.map((x) => JSON.parse(x));
  assert.deepEqual(unquote(ran), want);
  assert.deepEqual(unquote(compiled), want);
});
