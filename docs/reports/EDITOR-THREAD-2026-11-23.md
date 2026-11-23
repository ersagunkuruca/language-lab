# The editor's thread: what runs on it (2026-11-23)

Ersagun, 2026-11-23: the editor has had its share of hangs and slowness.
Any code that runs in it should either run on another thread (a worker or
a frame) or be analyzed as bounded work that doesn't grow much.

This is the audit behind rows E319a to E319i. It covers every place the
editor, on its own thread, runs program code, checks a program, or
compiles one. "Read" means the bound comes from reading the code;
"measured" means it was timed. E319a turns each row into a timed probe
before its fix.

## What already runs off the thread

The run worker (editor/runWorker.ts, started by `newWorker`) takes:

- Run main;
- warming a run;
- Choices (`choicesFor`);
- Build targets (`whereAnswers`);
- compiling a page and Save page (`compilePageProgram`, `compileSavedPage`);
- running a function backwards (`searchBackwards`), at most a minute.

A hang in any of these leaves the editor drawing, and Stop ends the
worker.

## What runs on the editor's thread

| # | Where | What it runs | Bound now | Grows with | Row |
|---|---|---|---|---|---|
| 1 | runViews.ts `lawPanel`, main.ts `upgradeModules` | `runTests`: a test's saved inputs, then small values of each input's type | none (tests.ts has no step or time budget) | the program's own code: a slow or looping definition holds the editor | E319b |
| 2 | picture.ts `drawPicture` | lowering the picture (`lowerScalar`, `emitWgsl`, `emitJs`, `emitWasm`), its Float32 copy and that copy's check, the evaluator at the comparison points | none for the lowering; the evaluator's points run unbudgeted | the picture's reach, and its code at each point | E319c |
| 3 | pictureDraw.ts, no WebGPU | the picture's WebAssembly or JavaScript for every pixel, frame after frame | sliced across frames | the canvas, and the program's work per pixel | E319c |
| 4 | pagePanel.ts `swapCompiled` | the compiled page: its script evaluated with `new Function`, its handlers and frame callbacks | none: a compiled handler that loops holds the editor for good | the program's own code | E319d |
| 5 | pagePanel.ts `showPage` (interpreted page) | the page's view and handlers | `PAGE_STEPS` per update, and `drawWithin` for the first drawing (TooSlow) | bounded | (kept) |
| 6 | pagePanel.ts `runCode` (Pause on a compiled page) | `checkedForRun`: the program checked and its representations chosen for running | none (bounce about 2 s the first time, from its comment) | the program | E319d |
| 7 | main.ts `boundedTrace` (values on the graph's wires) | `trace` of the open definition | 200 ms, or 3 s for given values and definitions without inputs; none where the given definition is one the check calls divergent | the definition's run | E319e |
| 8 | seeds.ts | `trace` of main for its seed values; `resolvedFor` and `warmCalls` | trace in steps (`withSteps`); resolving has no bound (calc 0.6 s, runWorker.ts's comment) | the program and the library it reaches | E319f |
| 9 | typed.ts `infer` (every edit, every render's types) | `inferEdited` over a recent check, else the whole check | the incremental check grows with the edit and the users of a changed type (I304); the whole check runs on open and on a miss | the whole program, on open and on a miss | E319g |
| 10 | typed.ts edit actions (wiring, drops, fills, lift) and palette.ts `fillings` | an `infer` of each derived program, over its base's check | as row 9, incremental | the edit, plus the holes the palette fills | E319g |
| 11 | backwards.ts | `relationFor`, `analyze` (invertible), `unitInfer` of the open definition | none | the definition | E319h |
| 12 | selectedParts.ts | `unitInfer` of the open definition for the selection's unit | none | the definition | E319h |
| 13 | main.ts `algebrasOf`, changesPanel.ts `diffPrograms` | a program's algebras; the diff between versions | kept per check and per version | the program | E319h |
| 14 | htmlPart.ts | an HTML value mounted in a frame of the editor's document | `mountHtml`'s update budget; no live handlers (`live: () => false`) | bounded | (kept) |
| 15 | graphLayout.ts, typedGraph.ts | the graph's layout and drawing | none | the open definition | E319h |

Rows 1, 2, 4 and 6 run code the program wrote with nothing to stop it.
Those four are the hangs; the rest is slowness that grows. Row 7's
divergent case needs a look: its comment says the check keeps a looping
definition from running there, but the call passes no budget.

## How each is fixed

- **Move it to the worker** where the editor only needs the answer: tests
  (1), the picture's lowering, its Float32 check and its comparison points
  (2), the CPU picture into an `OffscreenCanvas` the worker draws (3),
  Pause's `checkedForRun` (6), seeds' resolving (8). Each gets Stop, as
  Run does.
- **The compiled page (4)** can't move to a worker as it is: its elements
  are made in the editor's document. The bound comes from its runtime
  instead. A handler and a frame callback run under a time budget, as the
  interpreted page's do (5), and past it they stop with "ran longer than
  …". The runtime's loops and calls check a deadline every so many
  iterations; a page opened in its own tab keeps running without it. A
  page running in a worker, with its elements sent over, is the larger
  change and the one that also bounds memory; E319d measures both before
  choosing.
- **Traces (7)** stay on the thread, since the wires draw from them, but
  the budget drops to about 50 ms. A longer run, given values included,
  goes to the worker and the wires fill in when it answers.
- **The check (9, 10)** stays on the thread for edits, where it is bounded
  by the edit. The whole check moves to the worker: on open, and on a miss
  in the recent checks. The editor draws the program at once, unchecked,
  and draws the types when they come, as the page does for its compile.
  The whole check is the largest piece of work the editor does.
- **What grows with the open definition (11, 12, 13, 15)** gets measured
  on the largest examples. Whatever passes 16 ms (one frame) at their size
  moves, or is kept per version so it runs once.

## The test that keeps it so

E319a adds two checks:

1. **A list in the test.** It names every editor-thread call into the
   evaluator, the checker and the compiler, each with its bound. These are
   `runTests`, `trace`, `makeRunner`, `evaluatorCall`, `infer`,
   `inferEdited`, `lowerCore`, `lowerScalar`, `emitWasm`, `emitJs`,
   `emitWgsl`, `represented`, `checkedForRun`, `resolvedFor`, `analyze`,
   `relate` and `unitInfer`, reached from editor/ files the main bundle
   includes. A new call fails the test until it is put on the list with its
   bound, or moved to the worker.
2. **A browser probe** in the editor's smoke test. It opens a program
   whose definitions loop, or take seconds, in each place above: a test, a
   picture, a page handler, a wire's value, a seed. It records the
   editor's long tasks with a `PerformanceObserver` and fails on any task
   over 200 ms. Before each fix, the probe shows the hang; after, it shows
   none.
