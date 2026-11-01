// The pedal (ters/examples/pedal, AUDIO.md) against real time: a
// block of 128 samples every 2.7 ms is 375 blocks a second at 48 kHz. The
// compiled program, the evaluator, and the pedal written by hand in
// JavaScript over a Float64Array (the ideal, as gaps/*.ideal.js are for the
// other programs), on the same blocks, giving the same samples.
// Run: node gaps/bench-audio.ts   (AUDIO.md A5 has the numbers)

import assert from "node:assert/strict";
import { join } from "node:path";
import { soundOf, type Play } from "../../ters/cli/sound.ts";
import { loadProgram } from "../../ters/src/lang/load.ts";
import { infer } from "../../ters/src/lang/infer.ts";

const p = loadProgram(join(import.meta.dirname, "../../ters/examples/pedal"));
const prog = { code: p.code, info: infer(p.code, p.pres.names, undefined, p.options), names: p.pres.names };

// By hand: Haar's split in lifting steps, tanh(32 atanh x) on the slow
// band, the join, the compressor (4 to 1 over 0.5, level falling by
// 0.99976 a sample), then back to the loudness that came in (mean squares
// following by 0.9995 a sample, gain at most 4, samples under 0.95).
function ideal(): Play {
  let level = 0, dry = 0, wet = 0;
  return (block) => {
    const n = block.length, out = new Array<number>(n);
    for (let i = 0; i + 1 < n; i += 2) {
      const fast = block[i] - block[i + 1], slow = block[i + 1] + fast / 2;
      const driven = Math.abs(slow) < 1 ? Math.tanh(32 * Math.atanh(slow)) : slow;
      const b = driven - fast / 2;
      out[i] = fast + b; out[i + 1] = b;
    }
    for (let i = 0; i < n; i++) {
      level = Math.max(Math.abs(out[i]), level * 0.99976);
      out[i] *= level > 0.5 ? Math.exp(Math.log(0.5 / level) * 0.75) : 1;
      dry = dry * 0.9995 + block[i] * block[i] * 0.0005;
      wet = wet * 0.9995 + out[i] * out[i] * 0.0005;
      const g = wet < 1e-12 ? 1 : Math.min(4, Math.sqrt(dry / wet));
      out[i] = Math.abs(out[i]) * g > 0.95 ? (out[i] * 0.95) / Math.abs(out[i]) : out[i] * g;
    }
    return out;
  };
}

const blocks = Array.from({ length: 64 }, (_, b) => Array.from({ length: 128 }, (_, i) => 0.4 * Math.sin((2 * Math.PI * 110 * (b * 128 + i)) / 48000)));
const ways: [string, Play, number][] = [
  ["compiled", await soundOf(prog, p.named("pedal"), "compiled"), 2000],
  ["evaluator", await soundOf(prog, p.named("pedal"), "evaluator"), 4],
  ["by hand", ideal(), 20000],
];
const firsts = ways.map(([, play]) => play(blocks[0]));
firsts.slice(1).forEach((f) => f.forEach((x, i) => assert.ok(Math.abs(x - firsts[0][i]) < 1e-9, `sample ${i}: ${x} against ${firsts[0][i]}`)));
const rate: Record<string, number> = {};
for (const [name, play, n] of ways) {
  for (let i = 0; i < Math.min(n, 200); i++) play(blocks[i % blocks.length]);
  // The best of five runs: a laptop's other work only ever adds time.
  let ms = Infinity;
  for (let r = 0; r < 5; r++) {
    const t = performance.now();
    for (let i = 0; i < n; i++) play(blocks[i % blocks.length]);
    ms = Math.min(ms, (performance.now() - t) / n);
  }
  rate[name] = 1000 / ms;
  console.log(`${name.padEnd(10)} ${ms.toFixed(4)} ms a block, ${Math.round(1000 / ms)} blocks/s, ${(1000 / ms / 375).toFixed(1)}× real time`);
}
console.log(`compiled is ${(rate["by hand"] / rate.compiled).toFixed(1)}× the hand-written pedal's time`);
