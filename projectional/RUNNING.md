# How programs run

One page for a newcomer: what happens when you press Run, and every other
way a program can run. The long design notes are COMPILER.md, WASM.md,
NATIVE.md, WEB.md and AUDIO.md; this page is their summary, current on
2026-10-24.

## One program, several runners

A program is the tree the editor saves (`code.json` and its names), not
text. The type checker reads it once and works out each definition's type
and **effects**: whether it may choose between answers (`Choice`), print
(`Console`), touch files (`Files`), fail with a reason (`Abort`), keep
state on a page (`Cells`), or run without a proof that it stops
(`Diverge`). Every runner below starts from that same checked tree. None
of them parses anything.

| runner | what it is | where you meet it |
|---|---|---|
| **evaluator** | walks the tree directly; the definition of the language | the editor's Run and Show values, `lab run` |
| **JavaScript** | the tree compiled to plain JS | `lab compile`, every page (`lab build-web`, `lab build-app`), the audio thread |
| **WebAssembly** | compiled to WASM with the host's garbage collector, or as a WASI command needing no JavaScript | `npm run wasi -- wc` in compiler/, then wasmtime |
| **native** | compiled to C, built with `cc`, memory by reference counting | `lab native` |
| **GPU** | a pixel function compiled to a WGSL shader | the editor's live picture, shaders.html |

The evaluator is the reference. Every compiled target is tested against
it: the same input must give the same output, bit for bit for numbers.
When a target can't take a definition, it refuses with a reason (for
example "has effects (Choice)" for a shader), the way a type error is
reported, and the editor shows that reason.

## What you see in the editor

- **Run** runs the definition you're looking at with the evaluator, in a
  worker, so a slow program doesn't freeze the page (Stop ends it). You
  give it some inputs; a function built from `equal` and `and` can also
  be run backwards, given its outputs.
- **Show values** runs it and shows the value every node made.
- A **picture** (a function of x, y and time giving a colour) is compiled
  to WGSL and drawn live on the GPU above Run.
- A **page** (a `main` that returns `Html`) is previewed live above Run by
  the evaluator. Buttons write cells, and only the parts that read them
  redraw. Restart runs `main` again from the first values.
- A page with **sound** (the guitar pedal) plays through the browser's
  audio thread, which runs the compiled JavaScript, because the evaluator
  is too slow for 375 blocks a second.

## From the command line

In `projectional/`, with `node cli/lab.ts` (or `lab` if linked):

```sh
lab run examples/wc a.txt         # main with the evaluator, the real console and files
lab check examples/wc             # types of every definition
lab compile examples/wc -o wc.mjs # a JavaScript module that runs main
lab native examples/wc -o wc      # a native program through C
lab build-web examples/dice       # one HTML file running the page
lab build-app examples/dice       # the page as a phone app (PWA + Capacitor)
lab render examples/pedal in.wav  # play a sound over a WAV file
```

`main` gets the arguments as a list of texts and returns the exit code. An
`Abort` nothing handles prints its reason and exits with 1.

## How the effects become code

The types decide the shape of the compiled code, so nothing is guessed at
run time:

- **No effects**: a plain function.
- **`Choice`** (`one of`, `fail`): a search. In JavaScript it's nested
  loops in generators; in WebAssembly and C the rest of the search is
  passed in as a function and called on each answer (Mercury's approach).
  `first`, `all` and `count` stop early, collect, or count. Eight queens
  becomes the backtracking loop you would write by hand.
- **One answer or none**: each call returns a status beside its answer,
  and a failure jumps straight to the nearest handler.
- **`Abort`**: a third status, carrying the reason.
- **`Console`, `Files`**: calls into the host's world: Node, the browser,
  WASI, or the C library.
- **`Diverge`**: a fuel counter, checked only where the checker couldn't
  prove a definition stops.
- **`solve`** (running a relation in a chosen direction): planned at
  compile time and written out as arithmetic where it can be; otherwise
  the solver runs at run time.

## What each target is for

- **JavaScript** is the main target. It runs in every browser, so pages
  and apps use it, and it's 6× to 600× faster than the evaluator on the
  examples.
- **WebAssembly** reaches hosts with no JavaScript (wasmtime, edge workers,
  plugins). Whole programs run there, searches included; Countdown's
  search runs as fast as hand-written JavaScript.
- **Native** starts in a millisecond, holds only what it uses, and links
  into anything (an audio plugin, a phone app). It's the fastest target:
  a cell nobody else holds is reused in place (Koka's Perceus, Lean's
  reset/reuse).
- **GPU** runs a pixel function for every pixel at once. It allows no
  recursion except a loop, and nothing that might not stop unless it has a
  budget, because a hung shader freezes the tab.

## Same meaning, different storage

A type can be stored differently from how it's defined, without the
program changing. Peano numbers can be stored as an Int, and a `Map` uses a
balanced tree when the program's jobs make that cheaper (NUMBERS.md,
DATA-STRUCTURES.md). The chooser decides from the costs of the jobs the
program uses. Show, equal and compare still see the defined meaning, so
the output is the same either way.

## Where to read more

| about | read |
|---|---|
| why compile, the JS backend, shaders | COMPILER.md |
| WebAssembly and WASI | WASM.md |
| native through C, memory, measurements | NATIVE.md |
| pages, cells, apps | WEB.md |
| sound and the pedal | AUDIO.md |
| how far compiled code is from hand-written | compiler/GAPS.md |
| the language itself | TUTORIAL.md, LANGUAGE.md |
