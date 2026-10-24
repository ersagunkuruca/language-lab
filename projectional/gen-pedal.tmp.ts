import { B } from "./src/prelude.ts";
import { Lang } from "./src/lang/dsl.ts";
import { LIBRARY } from "./src/lang/library.ts";
import { CELL_OPS, CONS, HTML_V, NIL, PAIR_V, S } from "./src/lang/std.ts";
import type { Id } from "./src/model.ts";
import { save } from "./src/io.ts";
import { mkdirSync } from "node:fs";

const k = new Lang(LIBRARY.code);
const lib = (name: string) => { const d = LIBRARY.code.defs.find((x) => LIBRARY.names[x] === name); if (!d) throw new Error(name); return d; };
const conjugate = lib("conjugate"), map = lib("map");
const n = (v: number) => k.lit(v);
const comments: Record<string, string> = {};

// atanh, written with x once so running it backwards is one answer
const sat = k.def("into saturation");
k.define(sat, k.fn(["x"], (x) => k.call(B.div, k.call(B.log, k.call(B.sub, k.call(B.div, n(2), k.call(B.sub, n(1), x)), n(1))), n(2))));
comments[sat] = "A sample as a point of saturation space: atanh, written as log(2 / (1 − x) − 1) / 2 so x appears once and running it backwards is one answer (tanh).";

const drive = k.def("drive");
k.define(drive, k.fn(["amount", "x"], (amount, x) =>
  k.call(S.first, k.thunk(() => k.call(k.call(conjugate, sat, k.fn(["y"], (y) => k.call(B.mul, amount, y))), x)), k.thunk(() => x))));
comments[drive] = "Overdrive: scale the sample in saturation space and come back, tanh(amount · atanh(x)). It keeps −1 to 1, is the sample itself at amount 1, and pushes towards ±1 as amount grows, a soft clipper whose way back nobody wrote.";

const bands = k.def("bands");
k.define(bands, k.fn(["samples"], (samples) => k.match(samples, [
  { variant: NIL, names: [], body: () => k.list() },
  { variant: CONS, names: ["a", "rest"], body: ([a, rest]) => k.match(rest, [
    { variant: NIL, names: [], body: () => k.call(S.fail) },
    { variant: CONS, names: ["b", "more"], body: ([b, more]) => k.let("fast", k.call(B.sub, a, b), (fast) => k.call(CONS,
      k.call(PAIR_V, k.call(B.add, b, k.call(B.div, fast, n(2))), fast),
      k.call(bands, more))) },
  ]) },
])));
comments[bands] = "Haar's split in lifting steps: each pair of samples as their difference (the fast band) and the second plus half of it, their average (the slow band). Each step has one unknown when run backwards, so the join is plain arithmetic. An odd sample out is no split.";

const lows = k.def("driven lows");
k.define(lows, k.fn(["amount", "bands"], (amount, bs) => k.call(map, bs, k.fn(["band"], (band) => k.match(band, [
  { variant: PAIR_V, names: ["slow", "fast"], body: ([slow, fast]) => k.call(PAIR_V, k.call(drive, amount, slow), fast) },
])))));
comments[lows] = "Overdrive the slow band and leave the fast one: the low strings break up, the pick attack stays clean.";

// A compressor (A3): the block's level, followed from block to block in a
// cell, and a gain that brings a level over the threshold down by 4 to 1.
const louder = k.def("louder");
k.define(louder, k.fn(["a", "b"], (a, b) => k.if(k.call(S.less, a, b), b, a)));
comments[louder] = "The larger of two numbers.";
const peak = k.def("peak");
k.define(peak, k.fn(["samples"], (xs) => k.fold(xs, [
  { variant: NIL, names: [], body: () => n(0) },
  { variant: CONS, names: ["x", "rest"], results: [null, "rest's peak"], body: ([x], [, r]) => k.call(louder, k.call(S.abs, x), r!) },
])));
comments[peak] = "The loudest sample of a block.";
const gainFor = k.def("gain for");
k.define(gainFor, k.fn(["threshold", "level"], (threshold, level) =>
  k.if(k.call(S.less, threshold, level), k.call(B.exp, k.call(B.mul, k.call(B.log, k.call(B.div, threshold, level)), n(0.75))), n(1))));
comments[gainFor] = "Over the threshold, the gain takes the level three quarters of the way back to it, in log terms: 4 to 1.";
const following = k.def("following");
k.define(following, k.fn(["threshold", "level", "samples"], (threshold, level, xs) => k.match(xs, [
  { variant: NIL, names: [], body: () => k.call(PAIR_V, k.list(), level) },
  { variant: CONS, names: ["x", "rest"], body: ([x, rest]) =>
    k.let("now", k.call(louder, k.call(S.abs, x), k.call(B.mul, level, n(0.99976))), (now) =>
      k.match(k.call(following, threshold, now, rest), [
        { variant: PAIR_V, names: ["more", "last"], body: ([more, last]) => k.call(PAIR_V, k.call(CONS, k.call(B.mul, x, k.call(gainFor, threshold, now)), more), last) },
      ])) },
])));
comments[following] = "The samples, each at its gain, and the level after the last: the level is the sample, or the last level a little lower (it falls by half in about 0.06 s at 48 kHz), so it rises at once and falls slowly.";
const compress = k.def("compress");
k.define(compress, k.fn(["threshold", "level", "block"], (threshold, level, block) =>
  k.match(k.call(following, threshold, k.call(CELL_OPS.read, level), block), [
    { variant: PAIR_V, names: ["out", "last"], body: ([out, last]) => k.seq(k.call(CELL_OPS.write, level, last), out) },
  ])));
comments[compress] = "A compressor: the level follows the samples from one to the next and from block to block, in a cell, so it is the same whatever size the blocks are.";

const pedalWith = k.def("pedal on");
k.define(pedalWith, k.fn(["amount", "level"], (amount, level) =>
  k.fn(["block"], (block) => k.call(compress, n(0.5), level, k.call(S.first,
    k.thunk(() => k.call(k.call(conjugate, bands, k.fn(["bands"], (bs) => k.call(lows, k.call(CELL_OPS.read, amount), bs))), block)),
    k.thunk(() => block))))));
comments[pedalWith] = "The pedal: a block of samples split into bands, the slow one driven, joined again, by as much as the amount cell says when the block comes (so a knob can turn it while it plays), then compressed so it comes out at an even level (AUDIO.md).";

const pedal = k.def("pedal");
k.define(pedal, k.thunk(() => k.call(pedalWith, k.call(CELL_OPS.cell, n(8)), k.call(CELL_OPS.cell, n(0)))));
comments[pedal] = "The pedal with its drive at 8: what `lab render examples/pedal --main pedal in.wav` plays over a WAV file.";

// The page: a pedal, two inputs and a knob.
const el = (tag: string, attrs: Id[], children: Id[]) => k.call(HTML_V.element, k.lit(tag), k.list(...attrs), k.list(...children));
const words = (t: () => Id) => k.call(HTML_V.text, k.thunk(t));
const main = k.def("main");
k.define(main, k.thunk(() => k.let("amount", k.call(CELL_OPS.cell, n(8)), (amount) => k.let("play", k.call(pedalWith, amount, k.call(CELL_OPS.cell, n(0))), (play) => {
  const turn = (label: string, by: number) => el("button", [k.call(HTML_V.on, k.lit("click"), k.fn(["event"], () =>
    k.call(CELL_OPS.write, amount, k.call(B.mul, k.call(CELL_OPS.read, amount), n(by)))))], [words(() => k.lit(label))]);
  return el("main", [], [
    el("h1", [], [words(() => k.lit("Pedal"))]),
    el("p", [], [words(() => k.lit("Overdrive in saturation space, on the slow band of Haar's split. Click to play, click again to stop; headphones for the microphone."))]),
    el("button", [k.call(HTML_V.listen, k.x(HTML_V.microphone), play)], [words(() => k.lit("Guitar in (microphone)"))]),
    el("button", [k.call(HTML_V.listen, k.call(HTML_V.recording, k.lit("strum.wav")), play)], [words(() => k.lit("A strum"))]),
    el("p", [], [turn("Softer", 0.5), words(() => k.call(S.concat, k.lit(" drive "), k.call(S.show, k.call(CELL_OPS.read, amount)))), turn("Harder", 2)]),
  ]);
}))));
comments[main] = "The pedal as a page: each button plays the pedal on an input, and Softer and Harder turn its drive. The drive is a cell the audio thread reads too, so it turns while the sound plays.";
comments["program"] = "A guitar pedal by conjugation, twice: drive is a scaling done in saturation space (atanh, there and back), and it is done to one band of Haar's split (split, drive, join). Each way back is the way there run backwards.\nPlay it: the Pedal page (apps/pedal.html), or `lab render examples/pedal --main pedal in.wav`.\nPrior art: Haar's wavelet (Alfréd Haar, 1910), split by lifting (Wim Sweldens, 1996); tanh soft clipping is textbook distortion; a multiband pedal splits with a crossover where this uses Haar. Conjugation is Ersagun's idea from Rubik's cube commutators.";

if (!process.env.SCRATCH) { mkdirSync("examples/pedal", { recursive: true });
save("examples/pedal/code.json", k.code);
save("examples/pedal/names.default.json", k.names);
save("examples/pedal/comments.json", comments); }
// scratch: a direct inverse
const back = k.def("back");
k.define(back, k.fn(["y"], (y) => k.call(S.first, k.thunk(() => k.call(lib("inverse"), sat, y)), k.thunk(() => y))));
mkdirSync("/tmp/claude-0/pedal2", { recursive: true });
save("/tmp/claude-0/pedal2/code.json", k.code);
save("/tmp/claude-0/pedal2/names.default.json", k.names);
const satParam = (k.code.nodes[(k.code.nodes[sat] as any).body] as any).params[0];
const back2 = k.def("back2");
k.define(back2, k.fn(["y"], (y) => k.call(S.first, k.thunk(() => k.solve(sat, { out: y }, { [satParam]: "x" }, (b) => b[satParam])), k.thunk(() => y))));
save("/tmp/claude-0/pedal2/code.json", k.code);
save("/tmp/claude-0/pedal2/names.default.json", k.names);
