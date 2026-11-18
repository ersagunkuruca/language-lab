// Frets (L278, examples/frets): where each fret goes for a scale length,
// the same relation run backwards from a measured place, and how far to
// move a fret from the pitch it plays, as the core IR's JavaScript and as
// the evaluator runs it.

import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { root } from "../src/io.ts";
import { loadProgram } from "../src/lang/load.ts";
import { infer } from "../src/lang/infer.ts";
import { fromList, type Data } from "../src/lang/run.ts";
import { compiledDefs } from "../../compiler/src/core-js.ts";

const p = loadProgram(join(root, "examples/frets"));
const fns = compiledDefs(p.code, infer(p.code, p.pres.names, undefined, p.options), p.pres.names, ["frets of", "fret system", "ratio at", "move", "place"]);
const frets = (which: string, scale: number, n: number) => fromList(fns["frets of"](fns["fret system"](which), scale, n) as never).map((f) => {
  const d = f as unknown as { f0?: number; f1?: number; f2?: number; fields?: number[] };
  return { number: Number(d.f0 ?? d.fields![0]), cents: (d.f1 ?? d.fields![1]) as number, at: (d.f2 ?? d.fields![2]) as number };
});

test("12-TET frets on a 650 mm scale sit at L(1 − 2^(−k/12)), the 12th at half the string", () => {
  const fs = frets("12", 650, 24);
  assert.equal(fs.length, 24);
  fs.forEach((f, i) => {
    assert.equal(f.number, i + 1);
    assert.ok(Math.abs(f.cents - 100 * (i + 1)) < 1e-9, `fret ${i + 1} cents ${f.cents}`);
    assert.ok(Math.abs(f.at - 650 * (1 - 2 ** (-(i + 1) / 12))) < 1e-9, `fret ${i + 1} at ${f.at}`);
  });
  assert.ok(Math.abs(fs[11].at - 325) < 1e-9 && Math.abs(fs[23].at - 487.5) < 1e-9);
});

test("the bağlama's frets are Tura's seventeen ratios an octave, the second octave twice them", () => {
  const R = [18 / 17, 12 / 11, 9 / 8, 81 / 68, 27 / 22, 81 / 64, 4 / 3, 24 / 17, 16 / 11, 3 / 2, 27 / 17, 18 / 11, 27 / 16, 16 / 9, 32 / 17, 64 / 33, 2];
  const fs = frets("bağlama", 580, 23);
  fs.forEach((f, i) => {
    const r = i < 17 ? R[i] : 2 * R[i - 17];
    assert.ok(Math.abs(f.at - 580 * (1 - 1 / r)) < 1e-6, `fret ${i + 1} at ${f.at}, wanted ${580 * (1 - 1 / r)}`);
  });
});

test("a measured place read backwards gives the ratio that plays there, and a fret 10 cents sharp is moved toward the nut", () => {
  for (const r of [18 / 17, 4 / 3, 3 / 2, 2]) assert.ok(Math.abs((fns["ratio at"](580, fns["place"](580, r)) as number) - r) < 1e-6, `ratio ${r}`);
  const fifth = frets("12", 650, 7)[6];
  const sharp = 110 * 2 ** (710 / 1200), d = fns["move"](650, { tag: "", fields: [7, fifth.cents, fifth.at] } as unknown as Data, sharp, 110) as number;
  // Sharp plays as if the fret sat further from the nut: a negative move.
  const want = fifth.at - 650 * (1 - 1 / 2 ** (710 / 1200));
  assert.ok(d < 0 && Math.abs(d - want) < 1e-9, `move ${d}, wanted ${want}`);
  assert.ok(Math.abs(d + 2.5) < 0.01, `about 2.5 mm: ${d}`);
});
