# How programs run

One page for a newcomer: what happens when you press Run, and every other
way a program can run. The long design notes are COMPILER.md, WASM.md,
NATIVE.md, WEB.md and AUDIO.md; this page is their summary, current on
2026-10-30.

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

## How the compiler makes code faster

The compiler doesn't search. It runs a fixed series of passes over the
checked tree, and each pass recognises some shapes and rewrites them in
one way. Same program in, same code out, every time. Two decisions are
made by comparing costs. One is how an interface field left to its ways
is computed (WAYS.md: the cheapest set of ways that ends in real code, for
each type and target). The other is the representation of a type
(above), which is always the compiler's choice, never the program's: the
chooser in `src/lang/represent.ts` looks at which jobs the
program uses (`put`, `value at`, `match`, …), reads each candidate's
declared cost per job (`1`, `log n`, `n`, …) and takes the one whose worst
job is cheapest.

**A worked example: a fold over a range.** Both of these say "add up i²
for i from 0 to n − 1":

```
squares(n) =                       squares via let(n) =
  fold range(n)                      let xs = range(n)
    nil → 0                          fold xs
    cons(i) with r → i · i + r         nil → 0
                                       cons(i) with r → i · i + r
```

The first compiles to a counted loop, with no list made at all:

```js
let r = 0;
for (let i = Math.floor(n) - 1; i >= 0; i--) r = i * i + r;
```

That's because `foldPlan` (represent.ts) looks at what the fold's input is
*made by*. `range` has a row in the representation table, `counted`: a
list 0 … n − 1 stored as just n, whose fold is a loop counting down. The
rule is the representation's law read backwards: folding `range(n)` gives
the same answer as running the counted fold on n, so the list in between
never needs to exist. This is deforestation (Wadler, 1990) in GHC's
short-cut fusion form (Gill, Launchbury and Peyton Jones, 1993). Here each
fusion is a row of the table, not a rule of its own, and `characters(t)`
fuses the same way through the `text` row.

The second one compiles to the same loop. A let whose value is such a
list (`range`, `characters`), made from names and builtins with no
effects, and whose name is used once in a place that runs at most once
(not inside a function or a fold's arm), is first put where its name is
(compiler/src/inline-lets.ts, BACKLOG C49). So the fold sees what made
its input. A list used twice is still made once, and walked as a list.

Note that the ordinary fold isn't a generator or an iterator. A fold
without `Choice` is always a plain loop (COMPILER.md, "Folds are loops").
Generators are only for code that can give several answers.

**The passes.** Representations are picked before compiling (`src/lang/library-reps.ts`), the rest in `compiler/src/compile.ts`:

| pass | what it recognises | what it does | kind |
|---|---|---|---|
| one `+` per type | a generic `+ − · <` at a known type | the type's own operation; a generic definition gets a copy per type (monomorphisation, as MLton does) | fixed rule |
| ways | an interface field left to its ways (`by its ways`) | the cheapest grounded set of ways for the type and target (Knuth 1977), `src/lang/ways.ts` | cost-based |
| representations | a type the program uses | the chooser's pick replaces its constructors, matches and jobs; `lab check` says what it picked | cost-based |
| derivatives and inverses | `derivative(f)`, `inverse(f, …)` of a known `f` | the derivative's code; a solve | fixed rule |
| folds | `fold` of `range(n)` or `characters(t)`; a fold that only adds Ints | a counted loop; a loop over the text; an accumulator from the front | fixed rule (the table) |
| list chains | `keep`- and `map`-shaped steps between `split` and `length` | one loop, no list between | fixed rule |
| lists as arrays | a list that is only walked whole | kept as a JS array | whole-program analysis |
| in place | a list nobody else holds | its cells reused (Perceus, PLDI 2021, decided at compile time) | whole-program analysis |
| calls | a call of itself as the last step | a loop | fixed rule |

The C target adds reference counting with reuse at run time (Perceus;
Lean 4's reset/reuse), NATIVE.md.

**What about trying many rewrites and keeping the best?** That strategy
exists. It's called equality saturation: put every way of writing the
program that the rules allow into one shared structure (an e-graph), then
extract the cheapest by a cost function (Tate, Stepp, Tatlock and Lerner,
POPL 2009; the `egg` library, Willsey et al., POPL 2021). Its strength is
that no rule has to be applied first, so one rewrite can't block a better
one (the phase-ordering problem). It works well for small algebraic
rewrites such as `x · 2 → x + x` or loop fusion, and is used in Cranelift
and in tensor compilers. Its costs are compile time and a cost model,
since picking the cheapest program when parts are shared is NP-hard.

We don't do that, for two reasons. First, the big wins here come from how
data is stored (a count instead of a list, a string instead of
characters, a tree instead of a sorted list), and each of those is one
representation with laws that the tests check against the evaluator.
Second, the order problem is small while the passes are few and don't
compete. Where a real search could pay off later is choosing a
representation per value instead of per type, since conversions at the
boundaries make it a small optimisation problem over the data flow
(NUMBERS.md, "Costs and the chooser"). If that comes, an e-graph is the
first prior art to try.

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
