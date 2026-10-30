# Audio: a sound is a function on blocks, the speaker is a world

**Status (2026-10-30).** All five stages are built: sounds offline
(`lab render`), live in a page (apps/pedal.html), the compressor, the
editor's preview, and the measurements (39× real time compiled). What
follows is how each stage went.

A1 is done: `lab render` plays a sound over a WAV file, and
`examples/pedal` makes sound, the evaluator and compiled to the same bits.
Compiled, it played 17 blocks a second of the 375 real time needs: both ways
back (atanh's, Haar's) ran in the relational interpreter for each call.
A1b is done: `inverse` and `conjugate` of a named function compile to a
solve on it (compiler/src/inverses.ts), so drive is tanh in closed form and
the pedal plays 41 blocks a second. A1c is done: Haar's split is written
in lifting steps (one unknown each run backwards), a match whose arms build
its result with different cases has one answer run backwards, and the join
compiles to arithmetic: the pedal plays 3258 blocks a second compiled,
nearly nine times real time. A2 is done: `listen(microphone, pedal)` on a
button plays live in a page (`lab build-web examples/pedal`, and
apps/pedal.html on the site), from the microphone or a recording, with
Softer and Harder turning the drive as it plays and Clean/Driven to compare; test/sound-browser.ts
plays it in Chromium from a fake microphone. A3 is done: the pedal ends in
a compressor whose level follows the samples one by one, across blocks, in
a cell (so it is the same at any block size), 4 to 1 over 0.5; compiled it
plays 2063 blocks a second. A filter crossover is left out: a filter keeps
state, so its join (the sum) isn't its split run backwards, and conjugation
doesn't apply; deeper Haar splits are the invertible way to finer bands.
A5 is measured (`node gaps/bench-audio.ts` in compiler/): compiled, the
pedal takes 0.069 ms a block, 14 500 blocks a second, 39 times real time;
the same pedal by hand in JavaScript is 6 times quicker, and the evaluator
plays 8 blocks a second. Half the compiled time was telling apart the
answers of a solve that has one way to an answer (atanh run backwards,
128 times a block): it is now just the answer. Bigger-program round 4 (compiler/GAPS.md) then took the
compiled pedal from 6× to 2.9× the hand-written one: rounding without a
string, one-answer solves and modes written plainly, and the compressor
writing its block straight into an array.
A4 is done: the editor's preview plays the pedal (Editor lane).
The pedal you can hear (BACKLOG L30): Softer and Harder sounded like
volume, because at drive 8 a quiet strum mostly got louder. Now the
output is brought back to the loudness that came in, sample by sample
(`as loud as`: two mean squares following over about 2000 samples, in
cells, so it is the same at any block size; the gain at most 4 and every
sample under 0.95, so Harder can't turn a microphone hearing the speakers
up into feedback); the drive starts at 32 and stops at 256; a Clean/Driven
switch plays the input as it came, for A/B; and the page draws a sine
before and after the drive. The strum comes out as loud with its crest
8.8 to 5.4. Compiled 63 times real time, the hand-written pedal 4 times
quicker (the matching is plain recursion building pairs).
What goes wrong with a microphone is said under its button, in words
(BACKLOG L31): not allowed, none found, in use or its driver refused, a
page without https, or three seconds of silence (a muted headset). The
microphone is asked for without echo cancelling, noise suppression or
gain riding, and nothing about its rate or channels; a headset whose rate
the browser won't connect across (Firefox) gets an AudioContext of its own
at that rate, and a stereo input is mixed to mono.

This is the design for the audio target (BACKLOG.md C25), written before the
code, in the shape of WEB.md, WASM.md and NATIVE.md. It is the smallest model
that runs a guitar pedal live: no new node kinds, no new kind of program. A
pedal is an ordinary function from a block of samples to a block of samples,
its state lives in cells (as a page's does), and a page plays it through one
more attribute. The pedal the conjugation showcase (`examples/conjugate`,
NOTES.md "Conjugation and commutators") has been waiting for is the first
real program.

## Short answers

- **What is a sound program?** A function

  ```
  pedal : (List Float64) -[Cells, Update, Random]-> List Float64
  ```

  that takes a block of samples (mono, each in -1 to 1, 128 of them) and
  gives the block to play. Making one is an ordinary function that makes
  its cells and returns the block function, the way a page's `main` makes
  its cells and returns the page:

  ```
  echo() =
    let past = cell(silence(4800))   -- a tenth of a second at 48 kHz
    fn(block) =
      let out = add(block, scale(0.5, take(128, read(past))))
      write(past, append(drop(128, read(past)), out))
      out
  ```

  A synthesizer is the same thing ignoring its input. There is no `Sound`
  data type with a variant per oscillator and filter: those are prelude
  functions on blocks, the way buttons are functions that build `element`s
  (the uniformity rule).
- **Why blocks, not samples?** Two reasons. The things the showcase wants
  are not per sample: Haar's split works on pairs, an FFT on 2ⁿ samples,
  and conjugating by a band split needs the whole block to split and join.
  And the browser hands the program 128 frames at a time anyway
  (AudioWorklet's render quantum, Web Audio API), so a block costs one call
  where samples would cost 128. A per-sample effect is `map` over the block,
  and the compilers already turn that into a loop over an array.
- **Where is the state?** In cells, as in a page: an envelope follower's
  level, a delay line, a filter's last outputs. The block function reads and
  writes them; nothing else can. That is Faust's `~` (a feedback loop with a
  one-sample delay) made explicit and by block.
- **What can a block function do?** Its row is closed, named once in std.ts
  as `AUDIO_BLOCK`, like `PAGE_VIEW` and `PAGE_HANDLER`: `Cells` and
  `Update` (its state, read and written), `Random` (noise; the runtime seeds it, so a render repeats) and
  `Diverge` under a step budget. No `Console`, `Files`, `Time` or `Log`:
  the audio thread can't wait, and 375 blocks a second must not print. A
  block that runs out of steps, aborts or gives a block of the wrong length
  plays silence for that block, and the page says so once.
- **What does the pedal look like?** Conjugation twice, both from
  `conjugate(f, g)` in the prelude, with f⁻¹ found by running f backwards:
  - *Drive in saturation space.* `drive(k) = conjugate(atanh, scale(k))` per
    sample is `tanh(k · atanh(x))`: it maps -1..1 onto itself, is the
    identity at k = 1, and pushes towards ±1 as k grows, a soft clipper
    whose inverse nobody writes. `atanh(x) = log(2 / (1 - x) - 1) / 2` uses
    x once, so running it backwards should be one answer, which compiles
    to plain JavaScript (#250); A1 checks that it does.
  - *Multiband.* `conjugate(haar, both(drive(8), keep))`: split into the
    slow and fast bands, overdrive only the slow one, join. Then a
    crossover in place of Haar, and a compressor with an envelope cell in
    place of the drive, make it a real multiband compressor.
- **How does it play in the browser?** One more `Attribute` variant,
  `listen(to: Input, play: (List Float64) -[AUDIO_BLOCK]-> List Float64)`,
  on any element: the page runtime makes an `AudioContext` when that
  element is first clicked (browsers start audio only on a gesture),
  opens the input (`microphone`, or `file(name)` for a sample the page
  holds), and runs the block function in an AudioWorkletProcessor. Not a
  new `Html` variant: like `on`, it is something an element does.
- **But a function can't cross into the audio thread.** Right: the worklet
  has its own JavaScript realm, and the closure `echo()` returned lives in
  the page's. So the worklet loads the same compiled program and runs
  `main` itself, with a world that prints nothing, and takes the processor
  from its own copy of the page. Both runs make their cells in the same
  order, so cell n in one is cell n in the other, and the page sends each
  write to a cell the processor reads over the worklet's port. That is how
  a knob works: a range input's `on("input", …)` writes `gain`, the
  processor reads `gain`, and the write crosses at the next block. Writes
  go one way only, page to audio; the audio thread's own cells (the
  envelope) stay there. `main` must make the same cells each run, so a page
  with sound may not draw random numbers or read the clock in `main`
  (checked: its row loses `Random` and `Time`).
- **And offline?** `lab render <program> --main pedal in.wav -o out.wav`
  runs the block function over a WAV file (16-bit or float PCM, mono, or
  the first channel), block by block, with the evaluator or compiled. This
  is how the tests hear it: a sine through `drive(1)` is the sine, and
  through `drive(8)` its peaks flatten; the evaluator and the compiled
  program give the same bits.
- **Latency?** The worklet adds no buffering of its own: one block in, one
  block out, 128 / 48000 = 2.7 ms, plus the browser's input and output
  latency (`latencyHint: "interactive"`; typically 10 to 30 ms in total on a
  laptop, which a guitarist feels past about 10). An effect that needs a
  bigger window (an FFT of 1024) keeps its own buffer in a cell and pays its
  latency in the open, as a delay line does. The block size is the
  runtime's, not the program's: 128 in the browser, any multiple of 2 in
  `lab render`, so a program must not depend on it, and the tests render
  with two sizes and compare.
- **Which compiler?** The JavaScript one first: the worklet scope runs
  JavaScript, and compiled JS already turns maps and folds over lists into
  loops over arrays. WebAssembly (WASM.md) next if the profile asks for it,
  since a worklet can instantiate a module too; and natively (`lab native`,
  NATIVE.md) when the pedal wants to be a plugin, because a C function from
  a block to a block is exactly what LV2, VST3 and CLAP host. Native comes
  for nothing only once cells are in C, so it waits.
- **Stereo?** Later, and in the language: a stereo block is a pair of
  blocks, `listen` takes a function on pairs.

## Stages, one PR each

1. **A1. Blocks offline.** `AUDIO_BLOCK` in std.ts; `lab render` with a WAV
   reader and writer; the drive and Haar pedal as `examples/pedal`;
   evaluator and compiled render the same bits, at block sizes 128 and 256.
   The pedal first makes sound here, in a file.
2. **A2. Live in a page.** `listen` and `Input` in std.ts; the page runtime's
   worklet (compiled program in a Blob module), microphone and file input,
   cell writes over the port; `lab build-web` pages play. Checked in
   Chromium with a fake microphone (`--use-fake-device-for-media-stream`)
   and an OfflineAudioContext.
3. **A3. A real pedal.** Envelope follower and compressor; knobs. (A
   Linkwitz–Riley crossover was planned as an invertible split beside
   Haar, but a filter's state makes its join a sum, not its inverse.)
4. **A4. In the editor.** A Run panel for sound like the one for pages
   (Editor lane, thread "Writing programs in the editor"; this lane's edits
   to projectional/editor purely additive).
5. **A5. Measure.** Blocks per second against the 375 real time needs, in
   compiled JS and, if it is short, WebAssembly in the worklet.

## Playing a sound from the editor (A4's hook)

The editor previews a page with the evaluator, but the audio thread runs
compiled code, made in the browser with no bundler. These pieces are
ready for the Run panel:

- `WORKLET_RUNTIME` (editor/build.ts defines it, as `PAGE_RUNTIME` is):
  cli/web.ts `workletRuntime()`. This is the compiler's runtime and
  `startSound` (src/lang/worklet-runtime.ts), prebuilt as a script that
  sets `$lab` on the audio thread.
- `workletFile(WORKLET_RUNTIME, code, info, names, main)` (src/lang/page.ts):
  the script for the audio thread. The program is compiled there and
  then, with `link: "global"`, and runs `main` again on the audio thread.
  `hasSound(code)` says whether a program needs it.
- `soundPlayer(cells, worklet, () => main())` (src/lang/audio-page.ts):
  - run around the preview's `main`, with the preview's cells;
  - gives `{ page, listen }`: mount `page`, and pass `listen` as
    `Mount.listen` (src/lang/html.ts);
  - each element with a `listen` attribute then plays on click and stops
    on a second click;
  - the preview's cell writes reach the audio thread by creation order,
    so the evaluator's cells and the compiled program's line up.
- "Save page": `pageFile(title, PAGE_RUNTIME, code, info, names, main,
  WORKLET_RUNTIME)` gives a page that plays, as `lab build-web`'s does.

test/audio.test.ts checks that a worklet made this way plays the same
samples as the bundled one.

The editor does this (A4): showPage (src/lang/page.ts) takes `worklet`,
the guitar pedal is one of the editor's examples, and its preview plays.
Recordings are read from apps/, where the build puts them beside the
pages. A page's sound stops when the page is left, edited or restarted,
and a Stop sound button ends whatever it plays. `node editor/sound-smoke.ts`
plays the strum through the built editor's preview and checks that it is
driven (as loud, peaks squashed), that Clean reaches the audio thread,
and that nothing plays after leaving the page or pressing Stop sound.

## Prior art

- **Faust** (Yann Orlarey, Dominique Fober, Stéphane Letz, Grame, 2002 on):
  a pure functional language for signal processing that compiles to C++,
  WebAssembly and plugins. The model here is close in spirit (signal
  processors as pure functions, state as feedback), but by block, with
  state in cells rather than Faust's `~`, and inside a general language.
- **SuperCollider** (James McCartney, 1996): unit generators run on blocks
  (its control period, 64 samples by default), a server running the graph
  apart from the language that builds it, like the worklet and the page.
- **Elementary Audio** (Nick Thompson): audio graphs as values in
  JavaScript, rendered by a native or Web Audio runtime.
- **Web Audio API** (W3C), AudioWorklet: the 128-frame render quantum, the
  processor in its own global scope, `MessagePort` between them.
- **The pedal**: Haar's split (Alfréd Haar, 1910); `tanh` soft clipping is
  textbook distortion; a multiband compressor splits with a crossover
  (Linkwitz and Riley, 1976); the output matched to the input's loudness
  is level-matched A/B, as listening tests do (ITU-R BS.1116). Conjugation itself is Ersagun's idea from
  Rubik's cube commutators (NOTES.md).
