// Text from the world in NFC on C (C151): what a native program reads
// (standard input, a line, a file, a folder's names) is normalised where it
// comes in, as the evaluator's border.ts does. Checked against Node's
// String.prototype.normalize on every code point, on marks in every order
// after bases that compose with them, and on Hangul.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Lang } from "../../ters/src/lang/dsl.ts";
import { base, baseNames } from "../../ters/src/lang/load.ts";
import { infer } from "../../ters/src/lang/infer.ts";
import { runProgram } from "../../ters/src/lang/run.ts";
import { nodeWorld } from "../../ters/src/lang/world.ts";
import { CONS, IO, NIL, NONE, S, SOME } from "../../ters/src/lang/std.ts";
import { lowerScalar } from "../src/scalar.ts";
import { emitC } from "../src/c.ts";
import { compile, skip } from "./c-harness.ts";

// main: a line, then the rest of the input, then a file, then the folder's names.
function program() {
  const k = new Lang();
  const each = k.def("each");
  k.define(each, k.fn(["xs"], (xs) => k.match(xs, [
    { variant: NIL, names: [], body: () => k.lit("") },
    { variant: CONS, names: ["x", "rest"], body: ([x, rest]) => k.seq(k.call(S.print, x), k.call(each, rest)) },
  ])));
  const main = k.def("main");
  k.define(main, k.thunk(() => k.seq(
    k.match(k.call(IO.readLine), [{ variant: NONE, names: [], body: () => k.lit("") }, { variant: SOME, names: ["l"], body: ([l]) => k.seq(k.call(S.print, l), l) }]),
    k.call(S.print, k.call(IO.readInput)),
    k.call(S.print, k.call(IO.readFile, k.lit("f.txt"))),
    k.call(each, k.call(IO.listFolder, k.lit("names"))))));
  const code = base(k.code), names = { ...baseNames(), ...k.names };
  return { code, names, info: infer(code, names), main };
}

// Every code point but the surrogates, each on its own; then marks after
// bases, in orders NFD must sort and NFC must compose past.
function corpus(): string {
  const all: string[] = [];
  for (let c = 1; c < 0x110000; c++) { if (c === 0xd800) c = 0xe000; if (c !== 10 && c !== 13) all.push(String.fromCodePoint(c)); }
  const marks = [0x301, 0x300, 0x308, 0x304, 0x323, 0x327, 0x328, 0x31b, 0x342, 0x345, 0x334, 0x5b0, 0x93c, 0x94d, 0x3099, 0x309a, 0x1d165, 0x1d16e, 0x5c4, 0x0b57, 0x0bbe, 0x0cd5, 0x102e];
  const bases = [0x41, 0x61, 0x45, 0x65, 0x4f, 0x6f, 0x55, 0x75, 0x3b1, 0x3c9, 0x928, 0x304b, 0x1d158, 0x5d0, 0xb47, 0xbc6, 0xcc6, 0x1025, 0xfc, 0x1e63, 0x17f];
  let seed = 5;
  const next = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31);
  const mixed: string[] = [];
  for (let i = 0; i < 4000; i++) {
    let s = String.fromCodePoint(bases[next() % bases.length]);
    for (let j = next() % 5; j > 0; j--) s += String.fromCodePoint(marks[next() % marks.length]);
    if (next() % 4 === 0) s += String.fromCodePoint(bases[next() % bases.length]);
    mixed.push(s);
  }
  // Hangul: syllables split into jamo, and jamo that don't make one.
  const hangul = ["가", "각", "각", "각ᆨ", "ᄀ́ᅡ", "힣", "ᆨᅡ"];
  return [all.join(" "), mixed.join(" "), hangul.join(" ")].join("\n");
}

test("text from the world is in NFC on C: input, lines, files and names, as the evaluator gives it", { skip }, () => {
  const p = program();
  const exe = compile(emitC(lowerScalar(p.code, p.info, p.names, [p.main], { data: true }), { main: p.main }).c);
  const dir = mkdtempSync(join(tmpdir(), "nfc-"));
  const text = corpus();
  writeFileSync(join(dir, "f.txt"), text);
  spawnSync("mkdir", [join(dir, "names")]);
  for (const n of ["é", "éx", "ǟ", "plain", "가"]) writeFileSync(join(dir, "names", n), "");
  const input = `Café Å\n${text}`;
  const r = spawnSync(exe, [], { cwd: dir, input, maxBuffer: 1 << 28 });
  assert.equal(r.status, 0, r.stderr.toString());
  // The evaluator with Node's world, in the same folder.
  const printed: string[] = [], lines = input.split("\n");
  const cwd = process.cwd();
  process.chdir(dir);
  try {
    runProgram(p.code, p.info, p.main, [], { print: (l) => printed.push(l), names: p.names, world: {
      ...nodeWorld(), input: () => lines.splice(0).join("\n"), readLine: () => (lines.length ? lines.shift()! : null),
    } });
  } finally { process.chdir(cwd); }
  const want = printed.map((l) => `${l}\n`).join(""), got = r.stdout.toString();
  if (got !== want) {
    const a = got.split(/[ \n]/), b = want.split(/[ \n]/), i = a.findIndex((x, j) => x !== b[j]);
    const hex = (s: string) => [...s].map((c) => c.codePointAt(0)!.toString(16)).join(" ");
    assert.fail(`differs at piece ${i}: C [${hex(a[i] ?? "")}] vs evaluator [${hex(b[i] ?? "")}]`);
  }
  // And the evaluator's is NFC.
  assert.ok(want.includes("Café Å\n") && want.includes(text.normalize("NFC")));
});
