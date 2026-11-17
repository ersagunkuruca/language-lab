// The tuner (L274, examples/tuner): its McLeod pitch finder on tones made
// here, a pure sine, a string's harmonics and a plucked string
// (Karplus–Strong), each read to within a few cents, by the evaluator and
// as the core IR's JavaScript.

import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { root } from "../src/io.ts";
import { loadProgram } from "../src/lang/load.ts";
import { infer } from "../src/lang/infer.ts";
import { evaluatorCall } from "../src/lang/html.ts";
import { runMain, toList, type Data, type Value } from "../src/lang/run.ts";
import { Lang } from "../src/lang/dsl.ts";
import { merge } from "../src/model.ts";
import { loadCoreJs, lowerCore } from "../../compiler/src/core-js.ts";
import { coreCall } from "../../compiler/src/core-rt.ts";

const p = loadProgram(join(root, "examples/tuner"));

function finder(): { evaluator: (xs: number[], rate: number) => Data; core: (xs: number[], rate: number) => Data } {
  const k = new Lang(p.code), d = k.def("the finder");
  k.define(d, k.thunk(() => p.named("pitch heard")));
  const code = merge(p.code, k.code), names = { ...p.pres.names, ...k.names };
  const info = infer(code, names);
  assert.deepEqual(info.errors.map((e) => e.message), []);
  const f = runMain(code, info, d, { print: () => {}, names });
  const ir = lowerCore(code, info, names, [d]);
  assert.equal(ir.refused.get(d), undefined);
  const fi = ir.funcs.findIndex((g) => g.name === names[d] && !g.inner && !g.budgeted);
  const g = loadCoreJs(ir, { print: () => {} })[fi]() as Value;
  return { evaluator: (xs, r) => evaluatorCall(f, toList(xs), r) as Data, core: (xs, r) => coreCall(g, toList(xs), r) as Data };
}

const N = 4096;
const sine = (f: number, rate: number) => Array.from({ length: N }, (_, i) => 0.5 * Math.sin((2 * Math.PI * f * i) / rate));
// A string's first eight harmonics, falling off as 1/n, the fundamental weak.
const harmonics = (f: number, rate: number) => Array.from({ length: N }, (_, i) => [1, 2, 3, 4, 5, 6, 7, 8].reduce((s, n) => s + ((n === 1 ? 0.3 : 1) / n) * Math.sin((2 * Math.PI * f * n * i) / rate + n), 0) * 0.3);
// A plucked string: noise in a delay line, averaged as it goes round
// (Kevin Karplus and Alex Strong, 1983), its pitch rate / (delay − ½); heard 0.2 s after the pluck.
function plucked(f: number, rate: number): number[] {
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
  const d = Math.round(rate / f + 0.5);
  const out: number[] = [];
  const line = Array.from({ length: d }, rnd);
  let at = 0;
  for (let i = 0; i < N + rate * 0.2; i++) {
    const a = line[at % line.length], b = line[(at + 1) % line.length];
    const y = 0.5 * (a + b) * 0.996;
    out.push(a);
    line[at % line.length] = y;
    at++;
  }
  return out.slice(out.length - N);
}
const cents = (got: number, want: number) => 1200 * Math.log2(got / want);

const ways = finder();
for (const way of ["evaluator", "core"] as const) {
  test(`a sine and a string's harmonics are read within 1 cent, low E to a high A (${way})`, () => {
    for (const rate of [44100, 48000]) for (const f of [41.2, 82.41, 110, 146.83, 196, 246.94, 329.63, 440, 880]) {
      for (const [kind, xs] of [["sine", sine(f, rate)], ["harmonics", harmonics(f, rate)]] as const) {
        const h = ways[way](xs, rate);
        const [pitch, clarity] = h.fields as number[];
        assert.ok(Math.abs(cents(pitch, f)) < 1, `${kind} ${f} Hz at ${rate}: read ${pitch} (${cents(pitch, f).toFixed(2)} cents), clarity ${clarity}`);
        assert.ok(clarity > 0.9, `${kind} ${f}: clarity ${clarity}`);
      }
    }
  });

  test(`a plucked string is read within 1 cent, and silence and noise give none (${way})`, () => {
    for (const f of [82.41, 110, 196, 329.63]) {
      const d = Math.round(48000 / f + 0.5);
      // Each new sample averages the ones d and d − 1 back: a delay of
      // d − ½, so the pitch is rate / (d − ½).
      const want = 48000 / (d - 0.5);
      const [pitch] = ways[way](plucked(f, 48000), 48000).fields as number[];
      assert.ok(Math.abs(cents(pitch, want)) < 1, `${f}: read ${pitch}, want ${want} (${cents(pitch, want).toFixed(2)} cents)`);
    }
    assert.deepEqual(ways[way](Array(N).fill(0), 48000).fields, [0, 0]);
    let s = 3;
    const noise = Array.from({ length: N }, () => ((s = (s * 16807) % 2147483647) / 2147483647) - 0.5);
    const [, clarity] = ways[way](noise, 48000).fields as number[];
    assert.ok(clarity < 0.6, `noise clarity ${clarity}`);
  });
}
