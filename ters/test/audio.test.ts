// Sounds (AUDIO.md, stage A1): a sound is what its maker returns, a
// function on blocks of samples with its state in cells. Played over the
// same samples, the evaluator and the core IR's JavaScript give the same
// numbers, at any block size a sound mustn't depend on; `ters render` writes what it
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
import { audioProblem, playBlocks, playStereoBlocks, soundStereo } from "../src/lang/audio.ts";
import { createContext, runInContext, runInNewContext } from "node:vm";
import { runMain } from "../src/lang/run.ts";
import { corePageRuntimes, coreSoundWorklet, coreWorkletRuntimes, webCorePage } from "../cli/web.ts";
import { FakeEl, fakeDoc } from "./fakedom.ts";
import { emitCoreJs, hostOpsOf, lowerCore, solvesSlowly } from "../../compiler/src/core-js.ts";
import { corePageFile, coreWorkletFile, soundFile } from "../src/lang/page.ts";
import { close } from "../src/lang/run.ts";
import { CELL_OPS, HTML_V, NOW_OP, PAIR_V, RANDOM_OP, S } from "../src/lang/std.ts";
import { recordingWorld } from "../src/lang/audio-page.ts";
import { replaying } from "../src/lang/sound-thread.ts";
import type { World } from "../src/lang/run.ts";
import { B } from "../src/prelude.ts";
import { soundOf, stereoSoundOf } from "../cli/sound.ts";
import { represented, type Program } from "../cli/represented.ts";
import { readWav, writeWav } from "../cli/wav.ts";

const lab = join(import.meta.dirname, "../cli/ters.ts");
const dir = mkdtempSync(join(tmpdir(), "audio-"));
const peak = (xs: ArrayLike<number>) => Math.max(...Array.from(xs, Math.abs));
const rms = (xs: ArrayLike<number>) => Math.sqrt(Array.from(xs, (x) => x * x).reduce((a, b) => a + b, 0) / xs.length);
const sine = (n: number, amp: number) => Array.from({ length: n }, (_, i) => amp * Math.sin((2 * Math.PI * 220 * i) / 48000));
// The page main returns, from the evaluator.
const pedal = () => {
  const p = loadProgram(join(import.meta.dirname, "../examples/pedal"));
  return { p: { code: p.code, info: infer(p.code, p.pres.names, undefined, p.options), names: p.pres.names }, main: p.named("pedal"), page: p.named("main") };
};

test("the pedal: the evaluator and the core IR's JavaScript play the same samples, at blocks of 128 and of 256", async () => {
  const { p, main } = pedal();
  assert.equal(audioProblem(p.info, main, p.names), null);
  const input = sine(512, 0.3);
  const ways = await Promise.all((["evaluator", "core"] as const).flatMap((way) => [128, 256].map(async (size) => playBlocks(await soundOf(p, main, way), input, size))));
  for (const w of ways) assert.deepEqual(w.silent, []);
  // Each way the same bits at either block size; the two ways near each
  // other (run.ts close, `near` in the language: the interpreter runs atanh
  // backwards with fractions, the core IR's plan with floats, C137d8).
  assert.deepEqual(ways[1].out, ways[0].out);
  assert.deepEqual(ways[3].out, ways[2].out);
  ways[0].out.forEach((x, i) => assert.ok(close(x, ways[2].out[i]), `sample ${i}: ${x} against ${ways[2].out[i]}`));
  // It drives, compresses and comes back as loud as it went in: once the
  // loudnesses have followed it in (a few hundredths of a second), a sine
  // comes out as loud, its peaks squashed towards it; silence stays silent.
  const after = ways[0].out.slice(128), dry = input.slice(128);
  assert.ok(Math.abs(rms(after) / rms(dry) - 1) < 0.2, `loudness ${rms(after)} against ${rms(dry)}`);
  assert.ok(peak(after) / rms(after) < 0.85 * (peak(dry) / rms(dry)), `crest ${peak(after) / rms(after)}`);
  assert.deepEqual([...playBlocks(await soundOf(p, main, "core"), new Float64Array(256)).out], new Array(256).fill(0));
});

// The pedal's solves (Haar's join and tanh, each run backwards) have their
// plans written out on the core IR (C137d8), so its page is the core IR's
// (C137d9). calculus's derivative once ran the evaluator's on every call;
// its functions now carry their derivatives (I245), so it is quick too.
test("the pedal solves quickly on the core IR, and calculus's derivative does too", () => {
  // Its page, where listen gives the block function its rate's type.
  const { p, page } = pedal();
  const ir = lowerCore(p.code, p.info, p.names, [page]);
  assert.equal(solvesSlowly(ir), false);
  // Each gives one answer or none, so each is a call with no list of its
  // answers to choose from, though it's inside a search (C184).
  const js = emitCoreJs(ir).js;
  assert.equal((js.match(/^}, (?:\[[^\]]*\], \[[^\]]*\], )?"one", /gm) ?? []).length, 2);
  assert.doesNotMatch(js, /solveAll/);
  const c = loadProgram(join(import.meta.dirname, "../examples/calculus"));
  const info = infer(c.code, c.pres.names, undefined, c.options);
  assert.equal(solvesSlowly(lowerCore(c.code, info, c.pres.names, [c.named("main")])), false);
});

// A sound whose state carries from block to block: each block is scaled by
// how many blocks came before it, counted in a cell. The block function
// writes the cell; the maker only makes it.
function counting() {
  const k = new Lang(LIBRARY.code);
  const map = LIBRARY.code.defs.find((d) => LIBRARY.names[d] === "map")!;
  const main = k.def("main");
  k.define(main, k.thunk(() => k.let("blocks", k.call(CELL_OPS.cell, k.lit(0)), (blocks) =>
    k.fn(["block", "rate"], (block) => k.seq(
      k.call(CELL_OPS.write, blocks, k.call(B.add, k.call(CELL_OPS.read, blocks), k.lit(1))),
      k.call(map, block, k.fn(["x"], (x) => k.call(B.mul, x, k.call(CELL_OPS.read, blocks)))))))));
  const loud = k.def("loud");
  k.define(loud, k.thunk(() => k.fn(["block", "rate"], (block) => k.seq(k.call(S.print, k.lit("hi")), block))));
  const code = merge(LIBRARY.code, k.code), names = { ...LIBRARY.names, ...k.names };
  return { p: { code, info: infer(code, names), names }, main, loud };
}

test("a sound's cells carry from block to block, the same way compiled; a block function that prints isn't a sound", async () => {
  const { p, main, loud } = counting();
  assert.equal(audioProblem(p.info, main, p.names), null);
  const ones = new Array(8).fill(1);
  for (const way of ["evaluator", "core"] as const) {
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

test("ters render: the pedal over a WAV file, written as one; a program whose main isn't a sound is refused", () => {
  const input = join(dir, "in.wav"), out = join(dir, "out.wav");
  writeFileSync(input, writeWav({ rate: 48000, samples: Float64Array.from(sine(300, 0.3)) }));
  const r = spawnSync(process.execPath, [lab, "render", join(import.meta.dirname, "../examples/pedal"), "--main", "pedal", input, "-o", out, "--compiled"], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  const wav = readWav(readFileSync(out));
  assert.equal(wav.rate, 48000);
  assert.equal(wav.samples.length, 300);
  const bad = spawnSync(process.execPath, [lab, "render", join(import.meta.dirname, "../examples/wc"), input], { encoding: "utf8" });
  assert.equal(bad.status, 2);
  assert.match(bad.stderr, /main can't be a sound/);
  // No WAV file (L268): so many seconds of silence in, at the rate asked.
  const quiet = join(dir, "quiet.wav");
  const none = spawnSync(process.execPath, [lab, "render", join(import.meta.dirname, "../examples/pedal"), "--main", "pedal", "--seconds", "0.5", "--rate", "8000", "-o", quiet, "--compiled"], { encoding: "utf8" });
  assert.equal(none.status, 0, none.stderr);
  const q = readWav(readFileSync(quiet));
  assert.equal(q.rate, 8000);
  assert.equal(q.samples.length, 4000);
});

// The rate a sound plays at reaches its block function (L269), by the
// evaluator and compiled alike; one that never reads it plays all the same.
test("a sound's block function is given the rate it plays at", async () => {
  const k = new Lang(LIBRARY.code);
  const map = LIBRARY.code.defs.find((d) => LIBRARY.names[d] === "map")!;
  const main = k.def("main");
  k.define(main, k.thunk(() => k.fn(["block", "rate"], (block, rate) => k.call(map, block, k.fn(["x"], (x) => k.call(B.add, x, rate))))));
  const code = merge(LIBRARY.code, k.code), names = { ...LIBRARY.names, ...k.names };
  const p = { code, info: infer(code, names), names };
  assert.equal(audioProblem(p.info, main, p.names), null);
  for (const way of ["evaluator", "core"] as const) {
    assert.deepEqual([...playBlocks(await soundOf(p, main, way), new Array(4).fill(0), 2, 44100).out], [44100, 44100, 44100, 44100], way);
  }
});

// A sound's lists as arrays (C196): stored for `ters render --compiled`,
// the pedal's blocks are arrays, built and read with no cons cell, and it
// plays the samples its lists as written play.
test("the pedal stored as a sound keeps its blocks as arrays, and plays what its lists play", async () => {
  const pr = loadProgram(join(import.meta.dirname, "../examples/pedal"));
  const p = { code: pr.code, info: infer(pr.code, pr.pres.names, undefined, pr.options), names: pr.pres.names };
  const pedal = pr.named("pedal");
  const stored = represented<Program>({ title: "pedal", ...p, own: pr.own.defs, reps: [], options: pr.options }, pedal, true, false, true);
  assert.deepEqual(stored.chosen, ["List as array of List"]);
  const block = sine(128, 0.4);
  const [lists, arrays] = [await soundOf(p, pedal, "core"), await soundOf(stored, pedal, "core")];
  for (let i = 0; i < 3; i++) assert.deepEqual(arrays(block, 48000), lists(block, 48000));
});

// A page's HTML as its scripts draw it.
const drawn = (html: string) => {
  const body = new FakeEl("body"), store = new Map<string, string>();
  const localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) };
  const context = createContext({ document: { ...fakeDoc(), body }, localStorage, console, TextEncoder, requestAnimationFrame: () => 0 });
  for (const [, js] of html.matchAll(/<script>([\s\S]*?)<\/script>/g)) runInContext(js, context);
  return (body.kids[0] as FakeEl).html();
};

// The same from the core IR (C137d4): its audio thread's script plays what
// the core IR's sound plays offline, and the page's writes reach it.
test("the pedal page's worklet from the core IR plays the pedal, and the page's cell writes reach it", async () => {
  const { p, main, page } = pedal();
  const ir = lowerCore(p.code, p.info, p.names, [page]);
  const source = await coreSoundWorklet(ir, p.names[page]);
  const made: (new (o: object) => { port: { onmessage: ((e: { data: unknown }) => void) | null }; process(i: Float32Array[][], o: Float32Array[][]): boolean })[] = [];
  const said: unknown[] = [];
  class AudioWorkletProcessor { port = { onmessage: null, postMessage: (m: unknown) => said.push(m) }; }
  runInNewContext(source, { registerProcessor: (_: string, processor: never) => made.push(processor), AudioWorkletProcessor, sampleRate: 48000, console, TextEncoder, TextDecoder });
  assert.equal(made.length, 1);
  const node = new made[0]({ processorOptions: { index: 0 } });
  const input = [...Float32Array.from(sine(256, 0.3))], offline = playBlocks(await soundOf(p, main, "core"), input, 128).out;
  const play = (at: number) => {
    const out = [new Float32Array(128)];
    assert.equal(node.process([[Float32Array.from(input.slice(at, at + 128))]], [out]), true);
    return out[0];
  };
  assert.deepEqual([...play(0)], [...Float32Array.from(offline.slice(0, 128))]);
  node.port.onmessage!({ data: { cell: 1, value: 0 } });
  assert.deepEqual([...play(128)], input.slice(128));
  assert.deepEqual(said, []);
  // And `ters build-web` makes the pedal's page from the core IR, carrying
  // it.
  const html = await webCorePage("Pedal", p.code, p.info, p.names, page);
  assert.match(html, /registerProcessor/);
  assert.match(drawn(html), /Clean/);
});

// What a sound's block function writes to main's cells reaches the page
// (L267), at most once a frame, the latest value of each: the pedal's
// levels, which its block function follows. A write the page sent isn't
// sent back.
test("a sound's writes to main's cells are sent to the page once a frame", async () => {
  const { p, page } = pedal();
  const source = await coreSoundWorklet(lowerCore(p.code, p.info, p.names, [page]), p.names[page]);
  const made: (new (o: object) => { port: { onmessage: ((e: { data: unknown }) => void) | null }; process(i: Float32Array[][], o: Float32Array[][]): boolean })[] = [];
  const said: { writes?: { cell: number; value: unknown }[] }[] = [];
  class AudioWorkletProcessor { port = { onmessage: null, postMessage: (m: never) => said.push(m) }; }
  runInNewContext(source, { registerProcessor: (_: string, processor: never) => made.push(processor), AudioWorkletProcessor, sampleRate: 48000, console, TextEncoder, TextDecoder });
  const node = new made[0]({ processorOptions: { index: 0 } });
  node.port.onmessage!({ data: { cell: 0, value: 64 } });
  const input = Float32Array.from(sine(128 * 14, 0.3));
  for (let b = 0; b < 14; b++) node.process([[input.slice(b * 128, b * 128 + 128)]], [[new Float32Array(128)]]);
  // 48000 / 60 = 800 samples: sent after the 7th block and the 14th.
  assert.equal(said.length, 2);
  const cells = [...said[0].writes!.map((w) => w.cell)].sort();
  // The compressor's level and the two loudnesses, all main made; not the
  // drive, which the page wrote.
  assert.deepEqual(cells, [2, 3, 4]);
  for (const w of said[0].writes!) assert.ok(typeof w.value === "number" && w.value > 0, JSON.stringify(w));
});

// The core IR's, made in a browser (C137d6): the prebuilt runtimes and the
// printed program taking its helpers from them, for the editor's "Save
// page". Its worklet plays what the bundled one plays; its page draws the
// bundled one's.
test("a core IR page and worklet made without a bundler play and draw what the bundled ones do", async () => {
  const { p, page } = pedal();
  const play = (source: string) => {
    const made: (new (o: object) => { process(i: Float32Array[][], o: Float32Array[][]): boolean })[] = [];
    class AudioWorkletProcessor { port = { onmessage: null, postMessage: () => {} }; }
    runInNewContext(source, { registerProcessor: (_: string, processor: never) => made.push(processor), AudioWorkletProcessor, sampleRate: 48000, console, TextEncoder, TextDecoder });
    const node = new made[0]({ processorOptions: { index: 0 } });
    const out = [new Float32Array(128)];
    node.process([[Float32Array.from(sine(128, 0.3))]], [out]);
    return [...out[0]];
  };
  const ir = lowerCore(p.code, p.info, p.names, [page]);
  const worklet = await coreWorkletRuntimes();
  assert.deepEqual(play(coreWorkletFile(worklet, ir, p.names[page])), play(await coreSoundWorklet(ir, p.names[page])));
  const file = corePageFile("Pedal", await corePageRuntimes(), p.code, p.info, p.names, page, worklet);
  assert.equal(drawn(file), drawn(await webCorePage("Pedal", p.code, p.info, p.names, page)));
});

// L60: main may read the clock and draw random numbers on a page with
// sound. The page's world keeps what it answered main (recordingWorld),
// and the audio thread's run of main is answered the same, in order
// (replaying), so it makes the same cells: the first clock reading makes
// the clock's cell on both sides.
// A page with sound whose main asks its hosts/js.js (FOREIGN.md) is
// made from the core IR too (C137d10): the audio thread runs main again
// and asks the same host there.
test("a core IR page with sound and hosts/js.js: its audio thread asks the host as main runs again", async () => {
  const { p, main, page } = pedal();
  const k = new Lang(p.code);
  const dev = k.effect("Device", [["battery", [], () => k.tref("type.number")]]);
  const powered = k.def("powered main");
  k.define(powered, k.fn([], () => k.let("b", k.call(dev.op.battery), () => k.call(page))));
  const code = merge(p.code, k.code), names = { ...p.names, ...k.names };
  const info = infer(code, names, undefined, loadProgram(join(import.meta.dirname, "../examples/pedal")).options);
  assert.deepEqual(info.errors.map((e) => e.message), []);
  const hosts = join(mkdtempSync(join(tmpdir(), "hosts-")), "js.js");
  writeFileSync(hosts, `export default { ${JSON.stringify(dev.op.battery)}: () => { globalThis.asked = (globalThis.asked ?? 0) + 1; return 0.5; } };\n`);
  const ir = lowerCore(code, info, names, [powered]);
  const source = await coreSoundWorklet(ir, names[powered], { file: hosts, ops: hostOpsOf(code, names) });
  const made: (new (o: object) => { process(i: Float32Array[][], o: Float32Array[][]): boolean })[] = [];
  class AudioWorkletProcessor { port = { onmessage: null, postMessage: () => {} }; }
  const scope: Record<string, unknown> = { registerProcessor: (_: string, processor: never) => made.push(processor), AudioWorkletProcessor, sampleRate: 48000, console, TextEncoder, TextDecoder };
  runInNewContext(source, scope);
  const node = new made[0]({ processorOptions: { index: 0 } });
  const input = Float32Array.from(sine(128, 0.3)), out = [new Float32Array(128)];
  assert.equal(node.process([[input]], [out]), true);
  assert.deepEqual([...out[0]], [...Float32Array.from(playBlocks(await soundOf(p, main, "core"), [...input], 128).out)]);
  assert.equal(scope.asked, 1);
  // And the page itself is the core IR's, its worklet with it.
  assert.match(await webCorePage("Pedal", code, info, names, powered, hosts), /registerProcessor/);
});

test("a page with sound may read the clock and draw random numbers in main: the audio thread is answered the same", async () => {
  const { p, page } = pedal();
  const k = new Lang(p.code);
  const noisy = k.def("noisy main");
  k.define(noisy, k.fn([], () => k.let("t", k.call(NOW_OP), () => k.let("r", k.call(RANDOM_OP), () => k.call(page)))));
  const code = merge(p.code, k.code), names = { ...p.names, ...k.names };
  const info = infer(code, names, undefined, loadProgram(join(import.meta.dirname, "../examples/pedal")).options);
  assert.deepEqual(info.errors.map((e) => e.message), []);
  // The page's side: what main is answered, kept only while it's asked for.
  const world = recordingWorld({ random: () => 0.25, now: () => 1000 } as World);
  world.keep = { random: [], now: [] };
  runMain(code, info, noisy, { print: () => {}, names, world });
  const answers = world.keep;
  world.keep = null;
  world.random();
  assert.deepEqual(answers, { random: [0.25], now: [1000] });
  // The audio thread's side, given them.
  const source = await coreSoundWorklet(lowerCore(code, info, names, [noisy]), names[noisy]);
  const start = (processorOptions: object) => {
    const made: (new (o: object) => { port: { onmessage: ((e: { data: unknown }) => void) | null }; process(i: Float32Array[][], o: Float32Array[][]): boolean })[] = [];
    const said: unknown[] = [];
    class AudioWorkletProcessor { port = { onmessage: null, postMessage: (m: unknown) => said.push(m) }; }
    runInNewContext(source, { registerProcessor: (_: string, processor: never) => made.push(processor), AudioWorkletProcessor, sampleRate: 48000, console, TextEncoder, TextDecoder });
    return { node: new made[0]({ processorOptions }), said };
  };
  const { node, said } = start({ index: 0, answers });
  assert.deepEqual(said, []);
  // The clock's cell came first, so Clean or Driven is the third cell now.
  const input = sine(128, 0.3);
  node.port.onmessage!({ data: { cell: 2, value: 0 } });
  const out = [new Float32Array(128), new Float32Array(128)];
  node.process([[Float32Array.from(input)]], [out]);
  assert.deepEqual([...out[0]], [...Float32Array.from(input)]);
  // Without the page's answers the clock can't be read there, and it says why.
  assert.match(String((start({ index: 0 }).said[0] as { said: string }).said), /read the clock/);
});

test("the audio thread's answers: the page's, in order, then seeded random numbers; the first clock reading makes a cell", () => {
  const made: unknown[] = [];
  const w = replaying({ random: [0.5, 0.75], now: [10, 20] }, { cell: (v: unknown) => { made.push(v); return v as never; } });
  assert.deepEqual([w.random(), w.random()], [0.5, 0.75]);
  const seeded = replaying(undefined, { cell: () => null as never }).random();
  assert.equal(w.random(), seeded);
  assert.deepEqual([w.now(), w.now()], [10, 20]);
  assert.deepEqual(made, [10]);
  assert.throws(() => w.now(), /read the clock/);
});

// The preview's sound (C197): the audio thread's program has its lists
// stored as `ters build-web` stores them, the pedal's sound on arrays
// beside its page's Html lists as written (C196).
test("the preview's audio thread plays the pedal's sound on arrays", () => {
  const pr = loadProgram(join(import.meta.dirname, "../examples/pedal"));
  const info = infer(pr.code, pr.pres.names, undefined, pr.options);
  const file = soundFile("", pr.code, info, pr.pres.names, pr.named("main"));
  assert.match(file, /array\.pushFront/);
});

test("a page with sound copies its recording beside it, and carries its program for the audio thread", () => {
  const out = join(dir, "pedal.html");
  const r = spawnSync(process.execPath, [lab, "build-web", join(import.meta.dirname, "../examples/pedal"), "-o", out], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stderr, /strum\.wav beside it/);
  assert.deepEqual(readFileSync(join(dir, "strum.wav")), readFileSync(join(import.meta.dirname, "../examples/pedal/strum.wav")));
  assert.match(readFileSync(out, "utf8"), /lab-sound/);
});

// The metronome (L275): a sound with no input. Its clicks land on the
// samples its tempo puts them at, at any rate, the evaluator and compiled
// alike: 2+2+3 at 120 pulses a minute is a click each half second, the
// bar's first loudest and each group's first next.
test("the metronome clicks on its samples at any rate, the bar and group starts accented", async () => {
  const m = loadProgram(join(import.meta.dirname, "../examples/metronome"));
  const p = { code: m.code, info: infer(m.code, m.pres.names, undefined, m.options), names: m.pres.names };
  const main = m.named("metronome");
  assert.equal(audioProblem(p.info, main, p.names), null);
  for (const rate of [44100, 48000]) {
    const silence = new Float64Array(rate * 4);
    const ways = await Promise.all((["evaluator", "core"] as const).map(async (way) => playBlocks(await soundOf(p, main, way), way === "core" ? silence : silence.subarray(0, rate), 128, rate).out));
    ways[0].forEach((x, i) => assert.ok(close(x, ways[1][i]), `${rate}: sample ${i}: ${x} against ${ways[1][i]}`));
    const out = ways[1], peaks: number[] = [];
    for (let k = 0; k < 8; k++) {
      const at = Math.round((k * rate) / 2);
      // Silent just before each click, sounding just after.
      if (at > 0) assert.ok(Math.abs(out[at - 1]) < 1e-9, `${rate}: before click ${k}`);
      peaks.push(peak(out.subarray(at, at + rate / 20)));
    }
    // Parts 0, 2 and 4 of 7 start groups; part 0 starts the bar (and again at 7).
    const [bar, group, rest] = [peaks[0], peaks[2], peaks[1]];
    assert.ok(bar > group && group > rest && rest > 0.1, `${rate}: ${peaks}`);
    assert.deepEqual(peaks.map((x) => (x > bar * 0.9 ? 0 : x > group * 0.9 ? 1 : 2)), [0, 2, 1, 2, 1, 2, 2, 0], `${rate}`);
  }
});

// A sound in stereo (L270): its block function takes a pair of blocks,
// left and right, and gives a pair back, by the evaluator and compiled
// alike; `ters render` writes the pair as a WAV file's two channels. One
// that takes a pair and gives one block isn't a sound.
test("a sound in stereo plays a pair of blocks, and renders to two channels", async () => {
  const k = new Lang(LIBRARY.code);
  const map = LIBRARY.code.defs.find((d) => LIBRARY.names[d] === "map")!;
  const main = k.def("main"), half = k.def("half");
  // Left and right swapped, the new right twice as loud.
  k.define(main, k.thunk(() => k.fn(["blocks", "rate"], (blocks) => k.match(blocks, [{ variant: PAIR_V, names: ["left", "right"], body: ([l, r]) => k.call(PAIR_V, r, k.call(map, l, k.fn(["x"], (x) => k.call(B.mul, x, k.lit(2))))) }]))));
  k.define(half, k.thunk(() => k.fn(["blocks", "rate"], (blocks) => k.match(blocks, [{ variant: PAIR_V, names: ["left", "right"], body: ([l]) => l }]))));
  const code = merge(LIBRARY.code, k.code), names = { ...LIBRARY.names, ...k.names };
  const p = { code, info: infer(code, names), names };
  assert.equal(audioProblem(p.info, main, p.names), null);
  assert.equal(soundStereo(p.info, main), true);
  assert.match(audioProblem(p.info, half, p.names)!, /a sound in stereo takes a pair of blocks and gives a pair back/);
  const left = [1, 2, 3, 4, 5], right = [-1, -2, -3, -4, -5];
  for (const way of ["evaluator", "core"] as const) {
    const played = playStereoBlocks(await stereoSoundOf(p, main, way), left, right, 2);
    assert.deepEqual([[...played.out], [...played.right]], [right, [2, 4, 6, 8, 10]], way);
  }
  const back = readWav(writeWav({ rate: 8000, samples: Float64Array.from(left), channels: [Float64Array.from(left), Float64Array.from(right)] }));
  assert.deepEqual(back.channels!.map((c) => [...c]), [left, right]);
  // On a page, `listen in stereo`: its worklet takes the input's two
  // channels and gives the speakers the pair.
  const page = k.def("page");
  k.define(page, k.fn([], () => k.call(HTML_V.element, k.lit("button"), k.list(k.call(HTML_V.listenStereo, k.x(HTML_V.noInput), k.call(main))), k.list())));
  const code2 = merge(LIBRARY.code, k.code), names2 = { ...LIBRARY.names, ...k.names };
  const info2 = infer(code2, names2);
  assert.deepEqual(info2.errors.map((e) => e.message), []);
  const source = await coreSoundWorklet(lowerCore(code2, info2, names2, [page]), names2[page]);
  const made: (new (o: object) => { process(i: Float32Array[][], o: Float32Array[][]): boolean })[] = [];
  class AudioWorkletProcessor { port = { onmessage: null, postMessage: () => {} }; }
  runInNewContext(source, { registerProcessor: (_: string, processor: never) => made.push(processor), AudioWorkletProcessor, sampleRate: 48000, console, TextEncoder, TextDecoder });
  const node = new made[0]({ processorOptions: { index: 0 } });
  const l = Float32Array.from({ length: 128 }, (_, i) => i / 128), r = Float32Array.from({ length: 128 }, (_, i) => -i / 256);
  const out = [new Float32Array(128), new Float32Array(128)];
  assert.equal(node.process([[l, r]], [out]), true);
  assert.deepEqual([[...out[0]], [...out[1]]], [[...r], [...l].map((x) => 2 * x)]);
});
