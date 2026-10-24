// Sounds (AUDIO.md, stage A1): a sound is what its maker returns, a
// function on blocks of samples with its state in cells. Played over the
// same samples, the evaluator and the compiled program give the same bits,
// at any block size a sound mustn't depend on; `lab render` writes what it
// played to a WAV file.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { merge, type Id } from "../src/model.ts";
import { Lang } from "../src/lang/dsl.ts";
import { LIBRARY } from "../src/lang/library.ts";
import { infer } from "../src/lang/infer.ts";
import { loadProgram } from "../src/lang/load.ts";
import { audioProblem, playBlocks } from "../src/lang/audio.ts";
import { CELL_OPS, S } from "../src/lang/std.ts";
import { B } from "../src/prelude.ts";
import { soundOf } from "../cli/sound.ts";
import { readWav, writeWav } from "../cli/wav.ts";

const lab = join(import.meta.dirname, "../cli/lab.ts");
const dir = mkdtempSync(join(tmpdir(), "audio-"));
const sine = (n: number, amp: number) => Array.from({ length: n }, (_, i) => amp * Math.sin((2 * Math.PI * 220 * i) / 48000));
const pedal = () => {
  const p = loadProgram(join(import.meta.dirname, "../examples/pedal"));
  return { p: { code: p.code, info: infer(p.code, p.pres.names, undefined, p.options), names: p.pres.names }, main: p.named("main") };
};

test("the pedal: the evaluator and the compiled program play the same bits, at blocks of 128 and of 256", async () => {
  const { p, main } = pedal();
  assert.equal(audioProblem(p.info, main, p.names), null);
  const input = sine(512, 0.3);
  const ways = await Promise.all((["evaluator", "compiled"] as const).flatMap((way) => [128, 256].map(async (size) => playBlocks(await soundOf(p, main, way), input, size))));
  for (const w of ways) assert.deepEqual(w.silent, []);
  for (const w of ways.slice(1)) assert.deepEqual(w.out, ways[0].out);
  // It drives: a quiet note comes out louder, and silence stays silent.
  const peak = (xs: ArrayLike<number>) => Math.max(...Array.from(xs, Math.abs));
  assert.ok(peak(ways[0].out) > 2 * peak(input), `peak ${peak(ways[0].out)}`);
  assert.deepEqual([...playBlocks(await soundOf(p, main, "compiled"), new Float64Array(256)).out], new Array(256).fill(0));
});

// A sound whose state carries from block to block: each block is scaled by
// how many blocks came before it, counted in a cell. The block function
// writes the cell; the maker only makes it.
function counting() {
  const k = new Lang(LIBRARY.code);
  const map = LIBRARY.code.defs.find((d) => LIBRARY.names[d] === "map")!;
  const main = k.def("main");
  k.define(main, k.thunk(() => k.let("blocks", k.call(CELL_OPS.cell, k.lit(0)), (blocks) =>
    k.fn(["block"], (block) => k.seq(
      k.call(CELL_OPS.write, blocks, k.call(B.add, k.call(CELL_OPS.read, blocks), k.lit(1))),
      k.call(map, block, k.fn(["x"], (x) => k.call(B.mul, x, k.call(CELL_OPS.read, blocks)))))))));
  const loud = k.def("loud");
  k.define(loud, k.thunk(() => k.fn(["block"], (block) => k.seq(k.call(S.print, k.lit("hi")), block))));
  const code = merge(LIBRARY.code, k.code), names = { ...LIBRARY.names, ...k.names };
  return { p: { code, info: infer(code, names), names }, main, loud };
}

test("a sound's cells carry from block to block, the same way compiled; a block function that prints isn't a sound", async () => {
  const { p, main, loud } = counting();
  assert.equal(audioProblem(p.info, main, p.names), null);
  const ones = new Array(8).fill(1);
  for (const way of ["evaluator", "compiled"] as const) {
    assert.deepEqual([...playBlocks(await soundOf(p, main, way), ones, 2).out], [1, 1, 2, 2, 3, 3, 4, 4], way);
  }
  assert.match(audioProblem(p.info, loud, p.names)!, /runs on the audio thread, so it can't have Console/);
  assert.match(audioProblem(p.info, p.code.defs.find((d) => p.names[d] === "map") as Id, p.names)!, /a sound takes nothing/);
});

test("a block that gives the wrong number of samples plays silence, and says so", () => {
  const played = playBlocks((b) => (b[0] > 0 ? b.slice(1) : b), [1, 1, -1, -1, 1, 1], 2);
  assert.deepEqual([...played.out], [0, 0, -1, -1, 0, 0]);
  assert.deepEqual(played.silent.map((s) => s.block), [0, 2]);
  assert.match(played.silent[0].why, /gave 1 samples for 2/);
});

test("WAV files: 16-bit PCM read as -1 to 1, floats written and read back as they were", () => {
  const pcm = new Uint8Array(44 + 6), v = new DataView(pcm.buffer);
  const tag = (at: number, t: string) => [...t].forEach((c, i) => (pcm[at + i] = c.charCodeAt(0)));
  tag(0, "RIFF"); v.setUint32(4, 42, true); tag(8, "WAVE"); tag(12, "fmt "); v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, 8000, true); v.setUint32(28, 16000, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  tag(36, "data"); v.setUint32(40, 6, true); v.setInt16(44, -32768, true); v.setInt16(46, 16384, true); v.setInt16(48, 0, true);
  assert.deepEqual(readWav(pcm), { rate: 8000, samples: Float64Array.from([-1, 0.5, 0]) });
  const back = readWav(writeWav({ rate: 48000, samples: Float64Array.from([0.25, -0.75, 1]) }));
  assert.deepEqual(back, { rate: 48000, samples: Float64Array.from([0.25, -0.75, 1]) });
  assert.throws(() => readWav(new Uint8Array(12)), /not a WAV file/);
});

test("lab render: the pedal over a WAV file, written as one; a program whose main isn't a sound is refused", () => {
  const input = join(dir, "in.wav"), out = join(dir, "out.wav");
  writeFileSync(input, writeWav({ rate: 48000, samples: Float64Array.from(sine(300, 0.3)) }));
  const r = spawnSync(process.execPath, [lab, "render", join(import.meta.dirname, "../examples/pedal"), input, "-o", out, "--compiled"], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  const wav = readWav(readFileSync(out));
  assert.equal(wav.rate, 48000);
  assert.equal(wav.samples.length, 300);
  const bad = spawnSync(process.execPath, [lab, "render", join(import.meta.dirname, "../examples/wc"), input], { encoding: "utf8" });
  assert.equal(bad.status, 2);
  assert.match(bad.stderr, /main can't be a sound/);
});
