// Case, graphemes and collation on C and WebAssembly (L214e5): the cases
// module's `table uppercase`, `table lowercase`, `table graphemes` and
// `table collated` run where a use of uppercase, lowercase, graphemes or
// collate is, and print what the evaluator prints, in English and Turkish
// (and collation in a few more, L214e5b4).

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { Lang } from "../../ters/src/lang/dsl.ts";
import { base, baseNames } from "../../ters/src/lang/load.ts";
import { infer } from "../../ters/src/lang/infer.ts";
import { runProgram } from "../../ters/src/lang/run.ts";
import { LOCALE_V, ORDER_V, S, TEXT_OPS } from "../../ters/src/lang/std.ts";
import { lowerScalar } from "../src/scalar.ts";
import { emitC } from "../src/c.ts";
import { emitWasm, runMain } from "../src/wasm.ts";
import { compile, skip } from "./c-harness.ts";

// Pairs collate orders, each in a locale with a tailoring and in root.
const PAIRS: [string, string, string][] = [["çay", "cevap", "tr"], ["ıl", "il", "tr"], ["ñu", "nz", "es"], ["бык", "bus", "ru"], ["łza", "lza", "pl"], ["cote", "côte", "en"]];
const LINES = ["Hello, World", "straße", "İstanbul DIŞ ıi Iİ", "ΟΔΟΣ ΟΔΟΣ. Σ ΑΣ", "ǅungla ﬃ", "é 👍🏽 🇹🇷 각"];

function program() {
  const k = new Lang();
  const main = k.def("main");
  const loc = (tag: string) => k.call(LOCALE_V, k.lit(tag));
  k.define(main, k.thunk(() => k.seq(...LINES.flatMap((l) => [
    ...["en", "tr"].flatMap((tag) => [
      k.call(S.print, k.call(TEXT_OPS.uppercase, k.lit(l), loc(tag))),
      k.call(S.print, k.call(TEXT_OPS.lowercase, k.lit(l), loc(tag)))]),
    k.call(S.print, k.call(TEXT_OPS.joinAll, k.call(TEXT_OPS.graphemes, k.lit(l)), k.lit("|"))),
  ]), ...PAIRS.flatMap(([a, b, tag]) => [tag, "und"].map((t) => k.call(S.print, k.match(k.call(TEXT_OPS.collate, k.lit(a), k.lit(b), loc(t)), [
    { variant: ORDER_V.before, names: [], body: () => k.lit(`${a} < ${b} in ${t}`) },
    { variant: ORDER_V.same, names: [], body: () => k.lit(`${a} = ${b} in ${t}`) },
    { variant: ORDER_V.after, names: [], body: () => k.lit(`${a} > ${b} in ${t}`) },
  ])))))));
  const code = base(k.code), names = { ...baseNames(), ...k.names };
  return { code, names, info: infer(code, names), main };
}

function evaluator(p: ReturnType<typeof program>): string {
  const out: string[] = [];
  runProgram(p.code, p.info, p.main, [], { print: (l) => out.push(l), names: p.names });
  return out.map((l) => `${l}\n`).join("");
}


test("C runs the cases module's uppercase, lowercase and graphemes, as the evaluator does", { skip }, () => {
  const p = program();
  assert.deepEqual(p.info.errors.map((e) => e.message), []);
  const exe = compile(emitC(lowerScalar(p.code, p.info, p.names, [p.main], { data: true }), { main: p.main }).c);
  const r = spawnSync(exe, [], { maxBuffer: 1 << 24 });
  assert.equal(r.status, 0, r.stderr.toString());
  assert.equal(r.stdout.toString(), evaluator(p));
});

test("WebAssembly runs them too", async () => {
  const p = program();
  const l = lowerScalar(p.code, p.info, p.names, [p.main], { data: true });
  assert.equal(l.refused.get(p.main), undefined);
  const out: string[] = [];
  assert.equal(await runMain(l, emitWasm(l), "main", [], { print: (s) => out.push(s) }), 0);
  assert.equal(out.map((x) => `${x}\n`).join(""), evaluator(p));
});
