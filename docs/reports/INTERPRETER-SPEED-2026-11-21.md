# Interpreter speed on real programs, 2026-11-21

Ersagun asked why the interpreter is so slow on real programs: the
looper's main took 12.8 s interpreted in the editor, and its whole start
was about 19 s until sound pages were previewed compiled (E285, #2965).
This note says where the time goes, page by page, and names the causes.
The rows are L281a to L281g in BACKLOG.md.

## How it was measured

Each page example opened the way the editor's preview opens it
(`showPage` in `ters/src/lang/page.ts`, with a fake document), in node 22,
one process per example, cold. "main + first drawing" is the time from
`showPage` to its return. A counter in `Machine.apply` recorded each
lambda the step-by-step machine ran and why it wasn't run directly
(under `with fuel`, kept on the machine after stops, or its type says it
acts); a second counter in `enter` recorded why direct runs stopped. The
counters are not committed. Profiles: `node --cpu-prof`.

## Where the time goes

The evaluator has two ways of running a call. A direct run (L118c) runs
a function that only computes as plain JavaScript; the machine runs
anything else step by step, with its continuation on the heap. A direct
run that would need the machine stops, and the call starts again on the
machine. The machine is about ten times slower per call.

| page | main + first drawing, before | after L281a and L281b | where the rest goes |
|---|---|---|---|
| looper | 19.1 s | 3.5 s | building its tapes, 5.8 million list cells, now directly |
| countdown | 14.9 s | 13.9 s | `with fuel`: every call on the machine (L281c) |
| pond | 7.1 s | 6.0 s | `lookup entry`, 2.3 million machine calls (L281d) |
| crew | 3.8 s | 3.6 s | resolving arithmetic, 3.1 s (L281g) |
| break | 3.4 s | 3.6 s | resolving arithmetic, 3.2 s (L281g) |
| spacetime | 1.1 s | 1.0 s | |
| every other page | 0.4 to 0.9 s | the same | |

Numbers vary by about 10% from run to run.

## The causes

1. **A call made last took a JavaScript frame (L281a, fixed).** The
   looper makes each tape with `copies onto`, which calls itself last
   once per sample: millions of times for a few minutes of sound. Run
   directly, that ran out of JavaScript stack; the whole call started
   again on the machine, and after four such stops `copies onto` stayed
   on the machine for the rest of the run. That was 5.8 million machine
   calls, almost all of the looper's 19 s. A call made last now runs in
   its caller's loop.
2. **So did a call made last inside a constructor (L281b, fixed).**
   `map` builds `cons(change(item), map(rest, change))`: the call is the
   constructor's last part. On a long list it ran out of stack the same
   way (moths 9,008 machine calls, flock 6,009, pond 11,940). The
   constructor is now made first and its last part filled in from the
   loop. This is tail recursion modulo cons (prior art: Friedman and
   Wise, "Unwinding stylized recursions into iterations", 1975; OCaml's
   `[@tail_mod_cons]`), as the compiler already does it.
3. **`with fuel` turns direct runs off (L281c).** A call counted against
   fuel always runs on the machine. Countdown's page searches under fuel,
   so all of its 14 s is there (`join` and `valid`, 1.7 million calls
   each).
4. **A function that may choose always runs on the machine (L281d).**
   `lookup entry` and `value at` say in their type that they may give no
   answer (row `choice`). Outside a search run directly, that keeps every
   call on the machine. Pond calls them 2.3 million times.
5. **A function that stops four times stays on the machine (L281e).**
   The looper's `map` is sometimes given a change that reads a cell,
   which a direct run can't do. After four of those, every later `map`
   runs on the machine, also those given a change that only computes.
6. **The machine is slow per call (L281f).** About 3 µs a call: each
   step looks its node up, makes a frame for each part and copies the
   parts so far. Effects and handlers always run there (crew's
   scheduler).
7. **Resolving arithmetic before main (L281g).** `makeRunner` checks the
   program again to pick each operator's number type. In node, cold, that
   is 3.1 s of crew's 3.5 s and 3.2 s of break's 3.4 s. The editor's
   warm-up may already pay it; measure there first.

Before these fixes, the looper's main was slow mostly because of the
first cause. Countdown and pond are slow because of the third and
fourth.
