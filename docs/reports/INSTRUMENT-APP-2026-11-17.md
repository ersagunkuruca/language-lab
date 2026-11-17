# A tuner, metronome and looper in Ters: where we stand

Written 2026-11-17 for Ersagun's ask: "A universal instrument tuner,
metronome, looper app. This I really want to develop." Tuning systems
(12, 24 and 53-TET, just intonation and more), polyphonic tuning, frets
on instruments whose frets move, a looper that finds and makes up for
its latency, and a metronome with odd meters, uneven groupings, polymeter
and polyrhythm. This report says what Ters has today, what is missing,
and a plan in stages. The rows are in BACKLOG.md (L267 to L278, C260 to
C262). Nothing is built yet: Ersagun decides after reading this.

## The short answer

The hard part is already there. A sound in Ters is a block function on
the audio thread with its state in cells (AUDIO.md), and it runs today
in a browser page (AudioWorklet), in the editor's preview, offline over
a WAV file (`ters render`), and in the native Android and iPhone apps
(AAudio in low-latency mode, AVAudioEngine; C217). The guitar pedal
proves it: compiled through the core IR it takes 0.031 ms for a block
of 128 samples, about 80 times faster than real time, with arrays and no
garbage in the audio loop (C196). The evaluator and the compiled code
give the same bits, so the tests can listen to a sound offline.

What is missing is mostly plumbing between the audio thread and the
rest, and two libraries:

1. **The audio thread can't tell the page anything.** Cell writes go one
   way, page to audio (AUDIO.md). A tuner whose reading never reaches the
   screen is no tuner. This is the first and biggest gap (L267).
2. **A sound must have an input.** `Input` is the microphone or a
   recording; a metronome wants neither (L268).
3. **The block function doesn't know the sample rate.** Every pitch and
   every click time depends on it (L269).
4. **Mono only.** Stereo was left for later (L270).
5. **No latency figures from the platform** (C260), and nothing yet that
   keeps minutes of audio in a cell without copying it each block (C261),
   or saves a recording as a file (L271).
6. **No FFT and no tunings in the library** (L272, L273).

None of these needs a new kind of program or a new node. Each is a row
of size S or M, except the buffer (C261), which is a measurement first
and may turn up compiler work. With those in, the tuner, metronome and
looper are ordinary programs, and they are good ones for the language:
exact fractions for rhythm and just intonation, units on Hz and cents,
and the fret calculation is one relation run both ways.

## What works today

| need | today | where |
|---|---|---|
| microphone in, sound out, live | yes: block function on the audio thread, 128 samples a block; the mic asked for without echo cancelling, noise suppression or gain riding | AUDIO.md A2, audio-page.ts |
| state across blocks | yes: cells, read and written by the block function | AUDIO.md |
| controls from the page | yes: page cell writes reach the audio thread by creation order | sound-thread.ts |
| sample-accurate timing | yes in principle: the block function sees every sample, so a counter in a cell places a click on the exact sample; nothing waits on a timer | AUDIO.md "Latency?" |
| speed | pedal 0.031 ms a block compiled, about 80× real time; within 1.7× hand-written JS | DONE.md C196, GAPS.md round 4 |
| offline tests | `ters render` over WAV, two block sizes, evaluator and compiled agree | AUDIO.md A1 |
| Android, iPhone | page sound plays natively (AAudio low-latency mode; AVAudioEngine); microphone permission asked | NATIVE-APPS.md, C217 |
| drawing | pages draw SVG (also natively on Android); `on("frame")` comes each frame | LIBRARY.md "Cells and pages" |
| numbers | Float64, Int, exact Rational (just intonation ratios, rhythm positions), Complex, units in types | LIBRARY.md "Numbers", L252 |
| arrays | arrays written in place when nothing else holds them | LIBRARY.md, C196 |

## Each part of the app

### Tuner (monophonic)

Needs: the reading back to the page (L267), the sample rate (L269), an
FFT (L272) and tunings (L273). Pitch by YIN (de Cheveigné and Kawahara,
2002) or the McLeod pitch method (McLeod and Wyvill, 2005), both
autocorrelation methods that do well on plucked strings; done by FFT,
a 2048-sample window several times a second is a small fraction of the
audio thread's time. Both are adapted algorithms and get credited on the
page and in CREDITS.md. The display: a needle in cents and a strobe (the
strobe tuner is Peterson's, prior art), drawn in SVG each frame from the
latest reading.

Tuning systems are data, which fits the language: a tuning is a
reference pitch and steps over a period. n-EDO is 2^(k/n) (12, 24, 53 or
any n); just intonation is a list of Rationals, exact; any scale can be
read from a Scala .scl file (Manuel Op de Coul's format, prior art), so
"universal" comes for free from the many scales already written in it.
53-TET with its comma names, and the 24-tone Arel–Ezgi–Uzdilek subset
used to write Turkish makam music, are credited as the systems they are.
Cents and Hz as named units, so a cents offset can't be added to a
frequency by mistake.

### Metronome

Needs: a sound with no input (L268) and the sample rate (L269). Then it
is a program. A rhythm is exact: positions in a bar are Rationals, so
3 against 2, or 5 against 4, land on the same sample every bar with no
drift. A meter is a list of groups (2+2+3 for a 7/8, 2+2+2+3 for a 9/8
aksak); polymeter is several cycles on one pulse; polyrhythm is several
divisions of one bar. Accents, a different click per voice, tempo
changes and tap tempo (tap times from the page's clock). The clicks are
synthesized in the block function and placed to the sample.

### Looper

Needs: the playhead back to the page (L267), stereo out (L270), the
platform's latency figures (C260), minutes of audio in a cell (C261),
saving a loop (L271), and the metronome to sync to (L275).

Latency: the platform's own figures are a guess, often wrong on Android
and on Bluetooth. The looper measures the round trip instead: it plays
a chirp, finds it in the input by cross-correlation (FFT, L272), and
shifts every recording back by that many samples. Since output and
input are in the same block call, the count is exact to the sample. The
measured figure is kept per device, and the platform's figure is shown
beside it. A loopback measurement like this is standard practice in
DAWs (Ardour's, REAPER's); credited as prior art.

Record, play, overdub, undo (the previous take kept), several tracks,
start and stop on the bar. A loop of a minute at 48 kHz is 2.9 million
samples a track; written a block at a time, it must be written in place.
C261 measures that first (Float32 storage would halve the memory).

### Polyphonic tuning

A strum checked string by string. With the instrument's strings known,
this is a much easier problem than general multi-pitch: for each string,
look for its fundamental and its harmonics near where the tuning says it
should be. The spectrum by FFT (L272); prior art is TC Electronic's
PolyTune (the product idea) and Klapuri's iterative multi-pitch
estimation (2003) if the general case is wanted. L277, after the
monophonic tuner.

### Frets that move

Where each fret goes on an instrument with tied or movable frets (saz,
bağlama, oud with frets added, a fretless guitar with marks): for a
scale length L and a step of ratio r above the open string, the fret
sits L·(1 − 1/r) from the nut. Run backwards, the same relation says
from a measured fret what ratio it plays. Then the tuner closes the loop:
play the fretted note, and the page says which way to move that fret
and by how many millimetres. L278. A good showcase for running
functions backwards with units.

## The UI

Pages are good enough for this: buttons, sliders, SVG drawn each frame,
and the house look (styles in one `styles` def). Mobile is where an
instrument app lives, and dice, pig and tumble already run natively on
Ersagun's phone. What to watch: big touch targets, the screen kept on
while the metronome plays, and the app's audio surviving the screen
turning off (a native setting, C260's neighbour). No editor work is
needed to start; a spectrum or scope view in the editor's sound preview
would help later.

## Risks

- **The Language lane is redoing the compiler** (compiler redesign,
  2026-11-17). Stage 0's language rows touch std.ts and the page runtime,
  not the compiler, so they can run beside it, but C261 depends on how
  the new lowering writes arrays inside cells.
- **The big buffer (C261).** If writing a block into a cell's array
  copies the array, a looper is impossible. A measurement first, then
  the fix, in the compiler's "defaults first" spirit.
- **The FFT's speed.** Complex arithmetic over arrays is new ground for
  the compiled code; keep the real and imaginary parts as two Float64
  arrays (columns), and compare against a hand-written FFT (C262).
- **Browsers.** Firefox and Safari differ on AudioWorklet latency and
  the latency figures they report; that is why the looper measures.
- **iPhone on a real device** still needs Ersagun's Apple signing.

## Stages

Each stage ends with something Ersagun can use on his phone.

| stage | what | rows | gives |
|---|---|---|---|
| 0 | plumbing: sound tells the page, sound without input, sample rate, stereo, latency figures, big buffers, saving audio | L267, L268, L269, L270, C260, C261, L271 | nothing to play with yet; each row has its small example and test |
| 1 | tuner | L272, L273, L274 | a tuner in any tuning, web and Android |
| 2 | metronome | L275 | odd meters, groupings, polymeter, polyrhythm |
| 3 | looper | L276 | record, overdub, undo, latency measured and made up for |
| 4 | further | L277, L278 | polyphonic tuning, fret placement |
| ∗ | measured against hand-written code | C262 | the bigger-program round on the app (FFT, YIN, the looper's buffer) |

Stage 0's rows are independent of one another, so the tuner can start as
soon as L267, L269 and the two libraries are in. The metronome needs only
L268 and L269 and could come first if Ersagun wants something to use
sooner.

## Prior art and credits to give when built

- YIN: Alain de Cheveigné and Hideki Kawahara, "YIN, a fundamental
  frequency estimator for speech and music", JASA 2002 (adaptation).
- McLeod pitch method: Philip McLeod and Geoff Wyvill, "A smarter way
  to find pitch", ICMC 2005 (adaptation, if used).
- FFT: Cooley and Tukey, 1965 (textbook; credited in the library doc).
- Scala scale format: Manuel Op de Coul (prior art, file format).
- 53-TET and the Arel–Ezgi–Uzdilek system for Turkish makam music
  (prior art: the tuning systems themselves).
- Strobe tuners: Peterson (prior art, display idea).
- Polyphonic tuning: TC Electronic PolyTune (prior art); Anssi Klapuri,
  multiple-F0 estimation, 2003 (if adapted).
- Loopback latency measurement in DAWs (Ardour, REAPER): prior art.
- Faust, SuperCollider, Elementary Audio: already credited in AUDIO.md.
