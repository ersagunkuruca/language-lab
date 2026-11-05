# Gaps: what the compiler emits vs what it should

This doc comes back with each compiler milestone. Each round goes like this.
Write a program in the language that's bigger than the last one. Write by
hand the JavaScript a good compiler would emit for it: same program, same
algorithm, same output, same value representation. Then put that next to
what `compiler/src/compile.ts` actually emits. What differs is a gap. Each
gap below gets its evidence, a fix and a rank.

The programs are original, written for this purpose.

**Rounds so far (2026-11-05):** 1 calc, 2 Countdown and chapters, 3
ledger, 4 the guitar pedal, 5 routes, 6 notebook, 7 sheet (written in the
editor), 8 board (a page, written in the editor), 9 machine (an assembler
and interpreter, on every target), 10 clinic (a simulation, written in
the editor), 11 crew (workers as fibers). Each round's gaps are
below, as written then. The gaps still open are rows in BACKLOG.md, lane
C (C30, C31, C59, C63, C64, C70 to C73, C85 to C88, C91 to C96), and the next round's
program is chosen when the weekly round is due.

## Round 1: calc (2026-10-22)

`ters/examples/calc` is a calculator for whole numbers of any size.
It reads lines from standard input. A line can be an expression with
`+ - * / % ^` and parentheses, `let name = expression`, or `? expression`,
which shows how the expression was read with every operation in
parentheses. A line that fails prints its reason with the line number to
standard error, and the session carries on. The exit code is 1 if any line
failed.

```
$ printf 'let x = 2 ^ 100\nx * x - 1\n? -2 ^ 2 + 3 * (4 - 5)\n7 / 0\n' | node ters/cli/lab.ts run ters/examples/calc
x = 1267650600228229401496703205376
1606938044258990275541962092341162602522202993782792835301375
((-(2 ^ 2)) + (3 * (4 - 5)))
calc: line 4: division by zero
```

It has 27 definitions, against wc's 13. It uses five data types, one of them
a recursive tree (`Expr`). The tokenizer is a fold over the characters that
runs from the end. The parser is a recursive descent with one definition per
precedence level, and it carries `Diverge`, because the checker can't see it
end. The evaluator and the printer are folds over the tree. Abort is
raised in eight places and caught once per line. `Choice` comes in through
`read whole number`, `quotient`, `remainder` and `power`, which can have no
answer and are turned into Aborts with `first`, and through the prelude's
`keep`.

Files:

- `compiler/out/calc.js` is what the compiler emits (`npm run build`).
- `compiler/gaps/calc.ideal.js` is the hand-written ideal. Each place where it
  differs is marked with the gap's number.
- `compiler/gaps/bench.ts` (`npm run gaps`) runs the evaluator, the compiled
  code and the ideal on the same random sessions. It checks that all three
  print the same thing, times them, and probes where each one runs out of
  stack.
- `compiler/test/calc.test.ts` checks all three on fixed sessions.

### Results

All three ways print the same lines and return the same exit code on every
session tried. The times below are for one process with the output
collected, so they measure the program, not Node's start-up or the console:

| lines | evaluator | compiled | ideal | compiled / ideal |
|---:|---:|---:|---:|---:|
| 500 | 543 ms | 12 ms | 3.2 ms | 3.7× |
| 2,000 | 2,256 ms | 44 ms | 15 ms | 2.9× |
| 4,000 | (skipped) | 88 ms | 22 ms | 4.0× |

Where each way runs out of stack:

| input | evaluator | compiled | ideal |
|---|---|---|---|
| lines in a session | 10,000 work (no limit but memory) | **fails at 5,000** | 100,000 work |
| nested parentheses | 20,000 work | **fails at 5,000** | fails at 20,000 |
| terms in one sum (`1 + 1 + …`) | 10,000 work | **fails at 10,000** | 200,000 work |

From the command line (`lab compile`, then `node calc.mjs < input`), with a
4,000-line session: compiled 310 ms against ideal 135 ms. Start-up alone,
with empty input: compiled 123 ms, ideal 72 ms, bare `node` 22 ms. Run from
the command line, the compiled program's limits are lower than in the
table: it fails at 1,200 nested parentheses.

### The gaps, ranked

Correctness first, then by measured cost. The perf numbers come from
patching the emitted `calc.js` by hand, one gap at a time, on the
4,000-line session (88 ms before). G2, G4, G7 and G1's fuel part together
bring it to 47 ms. The ideal takes 22 ms.

**G0. `equal` on Int is approximate (correctness, the language itself).**
`equal(1000000000000, 1000000000001)` is `true` in both the evaluator and
the compiled code. Numbers are compared to within 1e-9 relative, which is
right for `Number`. An `Int` is a JS number while it's a safe integer,
though, so at run time it can't be told apart from a `Number`, and it gets
the tolerance too. The differential tests can't catch this, because both
sides have the same bug. The hand-written ideal compares Int exactly, so
this round found it. calc doesn't trip on it (it compares text, not Ints),
but any program that compares counts or ids above about a million can.
*Fix:* make equality type-directed. The checker already knows the type
at each `equal`, so it should record it. The evaluator and the compiler
then use exact comparison at `Int`, at `Text`, and at data with no `Number`
inside, and keep the tolerance only where a `Number` is compared. This
touches `src/lang/run.ts` and `infer.ts`, so it's a language change, not a
compiler change. **Done**: the checker records how numbers compare at each
`equal` (exact where there are only Ints, near where there are only
Numbers, and where a type variable could be either, whole numbers exactly),
and the evaluator and the compiler both use it. No example's output
changed. The inline form (G2) is done too (C15). *Later* (second review):
that made a generic `equal` answer differently from a direct one, so it
is now one rule for every type, whole numbers exactly and others near
(NOTES.md, "Equality: one rule").

**G1. Recursion uses the JS stack (correctness).** The compiled calc
crashes with `RangeError` on a 5,000-line input. The evaluator, which keeps
its continuations on the heap, doesn't crash. There are three kinds of
recursion:
- *Self tail calls*: `run lines` (one call per line), `sum rest` and
  `product rest` (one call per operator), and `lookup`. Each one returns a
  call to itself. *Fix:* compile them as loops. This is COMPILER.md stage
  2½. **Done** (the PR after round 1). Compiled calc now takes 100,000
  lines and a 200,000-term sum, like the ideal.
- *Real nesting*: parentheses go through
  `atom → expression → sum → product → unary → power → atom`, so each
  level costs six frames. The ideal has the same problem, only later,
  because its frames are smaller. *Fix:* the cheap fix is to run `main` on
  a big stack. `lab compile` can start it in a `Worker` with
  `resourceLimits.stackSizeMb`, or with `node --stack-size`. The full fix
  is heap continuations for the recursive definitions that aren't tail
  calls, the same way the evaluator does it, and only for those (the
  checker knows which they are). **Cheap fix done**: a program
  `lab compile` writes runs `main` in a worker thread with a 1 GB stack
  (dropped in C26, once the full fix made it only a start-up cost).
  **Full fix done** (C21): a definition in a cycle of calls also gets a
  generator copy whose calls in the cycle yield, and past 1,000 such calls
  the call runs it under `$drive` (runtime.js), so pages and modules take
  100,000 nested parentheses on the default stack.
  20,000 and 100,000 nested parentheses work. It costs about 130 ms of
  start-up for now, because the module, with its heavy runtime, loads
  twice. G8's lazy runtime brings that down.
  *Checked again (2026-10-23, Backlog C10):* a `lab compile` calc takes
  1,000,000 nested parentheses (10k: 0.3 s, 100k: 1.2 s, 300k: 5.8 s,
  1M: 25 s; the time grows faster than the depth, likely the collector
  walking a deep stack). On the default stack, where a web page or an
  imported module runs, compiled calc and the hand-written ideal both stop
  between 1,000 and 2,000 levels, so there is no gap with the ideal. What's
  left is the full fix, heap continuations for recursion that isn't a tail
  call, for pages and modules (Backlog C21).
- *Fuel*: every call into a `Diverge` definition does `$spendOrThrow()`,
  even though nothing in calc ever installs `with fuel`. Removing those
  calls saves 6 to 10 ms of the 88. *Fix:* look at the whole program. If no
  `with fuel` can be on the stack when a function runs, don't emit the
  check. Starting from `main`, that's a reachability question.
  **Done** (Backlog C13): a definition spends only if a `with fuel`'s
  arguments reach it, or it is used as a value; a page's step budget still
  counts every call, so only `lab compile`'s programs drop the rest.
  Compiled calc has none left. On a 40,000-line session the gain is within
  noise (about 1.4 s either way).

**G4. A pure test passed to `keep` becomes a generator (perf, the largest
part of the gap: 15 to 25 ms of 88).** The prelude's `keep` has the type
`(List a, (a) -[Choice, e]-> Bool) -[e]-> List a`. Its parameter's row lists
`Choice`, so the compiler makes every function passed to it a generator.
calc's test, `t ≠ gap`, is pure, and it pays for a generator object and an
iterator protocol call on every token. This isn't the known imprecision in
COMPILER.md, where a lambda written inside `Choice` code gets `Choice`.
Here the parameter's type itself says `Choice`. *Fix:* specialize the callee
on what the argument really does. When the lambda at the call site is
inferred pure, call a copy `keep$pure`, where the test is a plain call and
its "no answer" can't happen. This is the same one-bit specialization the
compiler already does for effect variables, applied to a parameter whose
row is fixed. It also makes `keep` cheaper everywhere else (wc uses it too). **Done**: compiled calc on 4,000 lines went from 88 ms to 69 ms. The
ideal takes 22 ms, so compiled is now 2.7× slower instead of 4×. The
compiler makes the plain copy only for a parameter the callee never passes
on or stores, and only in programs that don't reflect.

**G7. Text comparisons go through the general builtin (perf: 12 to 15
ms).** `digit` and `letter` call `$text.less(c, "0")`. That function runs a
surrogate regex over both texts on every call, so code points order
correctly. When one side is a constant with no surrogates, plain `<` gives
the same answer. *Fix:* special-case `less` with a constant side at
compile time. **Done**: when one side is a text constant whose characters
all come before U+D800, `comes before` compiles to `<`. The constant-folding also helps `slice` and `length` on
texts known to be narrow, but those don't show up in this profile. The
bigger form of G7 is *fusion*. `fold(characters(line))` builds a list of
one-character strings, then walks it into a spine array, then folds the
array. The ideal walks the string from the end. `keep` after it builds a
second list. Fusing a fold with the builtin that produced its input is the
first case of the "fold-as-loop as a representation" item (ROADMAP 5).
**Fusion done** there: `characters(t)` is a representation of a list
(NUMBERS.md, "Folds run the way their value is stored"), and a fold over
it runs on the text from the end. About 35 ms → 31 ms on 4,000 lines.

**G2. Equality with a constructed constant (perf: 3 to 5 ms).** `t =
word("let")` compiles to `$eq(t, { tag: …, fields: ["let"] })`. That
allocates a token, then compares it through a general loop with its own
stack. The ideal is `t.tag === WORD && t.fields[0] === "let"`. *Fix:*
when the type is known, inline equality: a tag test, then field by field,
and `===` for Text and Int. This is the compiled half of G0. **Done** (Backlog C15):
a name compared with a value built in place, of literals, names and such
values again, is a tag test and then each field by its type (`===`,
`$sameNumber`, or `$eq` where a field's type is generic). calc's three
`$eq`s and algebra's simplifier's `= number(0)` tests are gone.

**G3. Bool is an object (perf, not measured on its own).** Every function
that returns `Bool` returns `$T` or `$F`, and callers test `.tag ===
"std.bool.true"`. A match in expression position becomes an
immediately-called arrow function (`if ((() => { switch … })().tag ===
…)`), for example `isMark` in `sum rest`. *Fix:* represent Bool as a JS
boolean everywhere in compiled code and convert only where a value goes to
the evaluator. Also lift a match out of expression position into
statements with a temporary, instead of an IIFE. The same goes for the
26-character variant ids in `switch`. Small integers are cheaper, but
values have to stay comparable with the evaluator's, so measure this
before changing it. **Measured, then partly done**: in the profile the
parser, where these are, is about 8% of compiled calc's time, while
`tokens` (the G7 fusion) and the garbage collector are about 40%. A
copy of `calc.js` patched by hand came out about 5% faster. So the change
is kept to what stays inside compiled code. A function that returns
`Bool` returns a JS boolean when it's called directly (`blank`, `digit`,
`letter`, queens' `safe`). Where it's used as a value it's wrapped to give
Bool data. A match that decides a condition (`isMark`) sets a JS boolean
in statements, with no function called in place. Measured in one process
against the previous output, compiled calc is 3 to 7% faster. Bool stays
data in values and in lists, and in functions passed as arguments, which
`keep`'s test still is. The variant ids stay as they are.

**G8. Start-up and output (perf of a command-line program, not of the
code).** The compiled module imports `runtime.js`, which imports the
evaluator (`run.ts`, for `$showAny`), the standard library and the
relation solver, all through type stripping, before `main` runs. That's 50
ms more start-up than the ideal. Then every `print` is a `console.log`, a
synchronous write per line. Across the 4,000-line session that comes to
about 100 ms from the command line, against about 40 ms buffered. *Fix:*
load the evaluator and the solver lazily (only `backwards` and `calculus`
need them), and buffer standard output in `nodeWorld` (flushing before any
standard-error write and at exit, so the two streams still interleave
correctly). Single-file output (ROADMAP 3, "open") then removes the
absolute file URLs too. **Start-up done** another way: `lab compile` now
bundles the program and its runtime into one file with esbuild. That's
54 KB for calc, with no type stripping at run time and no imports from the
checkout. Start-up went from about 270 ms to about 90 ms, worker thread
(G1) included. Bare `node` takes 24 ms. **Buffered output done**: standard output is written
in 64 KB pieces, flushed before standard error and before any read, and
written straight to the descriptors from the worker. That also fixed a bug
the worker brought in: a worker's stdout and stderr were relayed separately,
so errors could come out of order. A 40,000-line session takes 605 ms
instead of 1,071 ms.

**G9. Small allocations (perf, not measured on its own).** `Parsed` is
returned by every parsing step and taken apart at once, so it could be two
return values. Data cases with no fields (`gap`, `nil`, a session's empty
bindings) are built at each use, where one shared constant would do. The
tree folds push `{ v, i, rs }` frames and look up an index table by tag,
when the arity is known per case. The garbage collector is 15% of the
compiled profile. *Fix:* hoist nullary variants as constants (cheap). Do
the rest once G1 to G7 are done, if the profile still shows it.

**G10. Readability of the output (cosmetic).** The indentation goes wrong
after an `if` with a nested `match` inside a case (see `atom` in
`out/calc.js`). It doesn't change what runs, but the output is meant to be
read. **Done** (Backlog C16): brackets inside text and comments
no longer count, and a line that opens several brackets is one level,
closed by the line that starts by closing them.

### Proposed order

1. G1, self tail calls as loops, and G1's big stack for `lab compile`.
   Each is a small PR, and together they fix the crashes.
2. G0, type-directed equality, in the evaluator and the compiler. The
   compiler's inline form (G2) comes with it.
3. G4, `keep` with a pure test.
4. G7's constant-side `less`, then G8: a lazy runtime and buffered
   output.
5. G3, Bool as a JS boolean and matches without IIFEs.
6. G7's fusion. It belongs with ROADMAP 5, so it's done there, not as a
   compiler special case.

Left after the fusion (for round 2, not changed in calc): the tokenizer
still builds its token list and `keep` builds a second one (neither fold
can be fused: the tokenizer's arms look at the tokens already made), and
`evaluate` allocates a `{ v, i, rs }` frame per tree node (G9). Compiled
calc on 4,000 lines is about 31 ms against the ideal's 21.

Next round: a bigger program with more `Choice` in it (a solver or a
search, not one with `Choice` only at the edges), and one that writes
files, so the handler stack and generators get measured too.

## Round 2: Countdown (2026-10-22)

Round 1's programs were all generated from TypeScript with the DSL. This
round's first program was written in the editor instead, by clicks:
headless Chromium driving the built page the way a person would (palette
picks, typed values, the case and field forms, renames, *Add a value
here*), then *Save file* and `examples/unpack.ts`. Nothing was edited by
hand. What the editor made hard is listed at the end.

`ters/examples/countdown` is the Countdown numbers game: every way
to reach a target from some of the numbers with `+ − × ÷`, each number used
at most once. The search is Graham Hutton's, from "The countdown problem",
*Journal of Functional Programming* 12(6), 2002
(https://www.cs.nott.ac.uk/~pszgmh/countdown.pdf). It uses his `valid`,
which skips answers that only differ by commutativity or by 1. For 765 from
1, 3, 7, 10, 25 and 50 it finds his 49 solutions.

```
$ node ters/cli/lab.ts run ters/examples/countdown | head -2
(((3 − 1) + 7) × (10 + (25 + 50)))
(((3 − 1) + 7) × ((10 + 25) + 50))
```

It has 17 definitions: four data types and 13 functions. Unlike calc,
`Choice` is the whole program, not its edges. `split`, `subsequence`,
`insert anywhere`, `permutation`, `choices`, `join` and `results` all have
`Choice` in their types. `one of` picks a Bool or an operator, `fail` prunes,
`all` collects the answers. `results` recurses on the halves `split` gives,
so the checker can't see it end and it carries `Diverge`.

Files: `compiler/out/countdown.js` (what the compiler emits),
`compiler/gaps/countdown.ideal.js` (the ideal, marked with gap numbers),
`compiler/gaps/bench-countdown.ts` (`npm run gaps` runs it after calc's),
`compiler/test/countdown.test.ts`.

### Results

All three ways give the same answers in the same order. In one process:

| instance | answers | evaluator | compiled | ideal | compiled / ideal |
|---|---:|---:|---:|---:|---:|
| 1 3 7 10 25 → 765 | 0 | 783 ms | 9.2 ms | 1.5 ms | 6.3× |
| 2 3 5 7 11 → 100 | 30 | 830 ms | 11 ms | 1.7 ms | 6.3× |
| 1 3 7 10 25 50 → 765 | 49 | (17 s from `lab run`) | 248 ms | 40 ms | 6.1× |
| 4 6 8 25 50 100 → 952 | 118 | (skipped) | 339 ms | 60 ms | 5.6× |

So a program made of `Choice` is 6× slower than the ideal, against 1.5 to 2×
for calc. The evaluator is another 80× slower than compiled code. No stack
limits were hit: the depth of the search is the count of numbers.

In a profile of the compiled code, `results` alone is 56% of the time, then
`join` 11%, the garbage collector 9% and `split` 6%. The perf numbers below
come from patching the emitted code by hand, one gap at a time, on Hutton's
instance (240 ms before).

### The gaps, ranked

**G14. A Choice function with at most one answer is still a generator
(perf: 240 → 159 ms, the largest single gap). DONE (2026-10-23): on
Hutton's instance, compiled went from 542 to 355 ms on the same machine,
against the ideal's 80 ms (6.8× to 4.5×; this machine was slower than the
one the table above was measured on). COMPILER.md, "Two calling
conventions".** `join` either gives one
`found` or fails. It's compiled as a generator, and `results` drains it
with `for (const r of join(…)) yield r`, so every operator tried makes a
generator object and runs the iterator protocol.
*Fix:* when every path through a `Choice` function ends in one value or
`fail`, with no `one of` and no call that can give more than one, compile it
as a plain function that returns the value or a "no answer" sentinel. The
caller tests the sentinel. This is the effect-type version of "this
function returns an Optional". `valid`-style tests (`if test then x else
fail()`) are common in search code, so this pays everywhere.

**G9 again. Constant data is rebuilt each time (perf: 240 → 202 ms).
DONE (2026-10-23), after G14: Hutton's instance 361 → 273 ms on the same
machine (4.0× → 3.5× the ideal).**
`one of([plus, minus, times, over])` builds four operator objects and four
cons cells on every combination of two results. Round 1 found the cheap
part of G9 (hoist nullary variants as constants); here it's worth 16%. *Fix:*
a closed constant expression (no variables, no effects) is built once, at
module level. That covers nullary variants and lists of them.

**G11. Choice is compiled as nested generators (perf: most of what's left,
116 → 40 ms).** Each `Choice` function is a generator, and each answer of
`results` passes up through every enclosing `for … of … yield` of the
recursion. The ideal passes the rest of the search down as a callback `k`
and calls it once per answer, so an answer costs one call, whatever the
depth. *Fix:* compile `Choice` functions in continuation-passing style when
their callers are all compiled code (no `first` that has to stop a
search halfway: that needs either generators or an exception to unwind,
so `first` would keep the generator form or throw a sentinel). This is the
big one, and it changes the calling convention of a whole class of
functions, so it needs its own design note in COMPILER.md before code.
*DONE:* COMPILER.md, "Searches in continuation-passing style". A search
called by name has a `$k` copy that takes the rest of the search as a
function, and handlers written in place and other `$k` copies call it.
Countdown, biggest instance: 322 → 189 ms, from 2.9× the ideal to 1.5×.
What's left is mostly G13 and the closures themselves.

**G13. Records taken apart at once are still built (perf: part of G11's
remainder).** `split` returns a `halves` and `results` a `found`, and the
caller matches on it straight away. With G11, they become two arguments to
`k`. Without it, they're the "return two values" form of G9 from round 1.
*DONE:* a `$k` copy whose answers are all one record passes its fields to
`k`. The caller's closure binds them, and builds the record only if
something keeps it whole. Countdown, biggest instance: 198 → 185 ms (median
of alternating runs, noisy), now about 1.4× the ideal. `join`, which has one
answer (G14), still builds its `found`; the same idea for single-answer
functions would be returning several values.

**G1 again (fuel).** `if ($spend())` before each recursive call: unmeasurable
here (240 → 242 ms), because `$spend` is cheap when no fuel is active. The
whole-program "no `with fuel` reachable" check from round 1 would still
remove it. Low priority. **Done** (C13, above).

**G12. `one of([true, false])` is a list and a loop.** It builds the list
each time (hoisting it: 240 → 234 ms) and tests the Bool it picked. The
ideal runs the two branches one after the other. Small, and G9 covers the
building part. **Done** (Backlog C14): `one of` a list of up to four
constants written in place runs the rest once for each, in order, with no
list; the rest is shared as a local function when it is long. Countdown's
timing doesn't change measurably.

The cheap ones together (G14, G9, G1, G12, all patched by hand) bring 240 ms
to 116 ms. The remaining 3× to the ideal is G11 and G13.

### What the editor made hard

Countdown took about 150 palette picks in 17 definitions, and the search
ran the first time it was run. Filling holes is fast: after each pick the
next hole is selected, typed values work (`[1, 3, 7, 10, 25, 50]`, `"+"`),
`match` and `fold` are offered for every value with cases, and *Add a
value here* plus a rename gave `main` its named list. What got in the way:

1. **A field can't be an `Int`.** The field form's "Holding" list has
   Number, Text, Bool, Unit, the web types, the program's own types, and
   Lists of those. There's no Int, no type parameter, no Pair or Optional.
   So the Countdown numbers are `Number`, not `Int` as they should be.
2. **Field reads aren't in the palette.** Neither std `Pair`'s `fst`/`snd`
   nor the program's own record fields (`front`, `back`) are offered, so a
   record can only be read with a `match`. (`fillings` in `infer.ts` offers
   variants, not fields.)
3. **Std types other than Bool and List can't be matched on.** `match □ ·
   Pair` isn't offered. Together with 2, std `Pair` can't be taken apart at
   all, so the program has its own `Halves` and `Found` records.
4. **Nested matches name their binders the same.** A `match tail` inside
   `cons(head, tail)` gets `cons(head, tail)` again. The palette then offers
   two `head`s and two `tail`s, with nothing telling them apart. They have
   to be renamed first.
5. **Search hides exact matches.** The palette shows at most 40 rows, and
   the query also matches descriptions, so typing `all` doesn't show
   `all(□)`. Typing `all(` does. A row whose name starts with the query
   should come first.
6. **Bug: deleting the open definition throws.** *Delete* in the
   Definition panel raises "TypeError: Cannot read properties of undefined
   (reading 'kind')" in the page, every time (seen three times).
7. **A rename only changes the current naming.** Renames made with
   *Descriptive* names on go to `names.descriptive.json`. `names.default.json`,
   which `lab` and the compiler use, keeps `head` and `tail`, and the dot
   named `numbers` comes out of the compiler as `x`. Names of deleted nodes
   stay in the file.
8. **The Definition panel is behind Escape.** While a hole is selected,
   the tab row shows *Selected*, and the panel with *Delete*, *Inputs* and
   the type only comes back after Escape.

## Round 2, second program: chapters (2026-10-22)

Countdown was all `Choice` and no world. The second program is the other
kind: plain text work that ends in files. `ters/examples/chapters`
splits a Markdown book into one file per chapter (at each `# ` heading),
writes `contents.md`, a list of them with links and word counts, and adds a
line per chapter to `chapters.log`. It reads with `read file`, writes with
`write file` and `append file`, and stops with `Abort` when the book is
missing or has no text. `main` handles that `Abort` and turns it into a
message and exit code 1 (2 for a wrong command line).

```
$ mkdir out && node ters/cli/lab.ts run ters/examples/chapters book.md out
wrote 4 chapters and contents.md to out (36 words)
$ cat out/contents.md
# Contents

1. [Preface](01-preface.md) — 9 words
2. [The Beginning](02-the-beginning.md) — 12 words
…
```

It has 21 definitions: three record types (`Section`, `Pile`, `Chapter`)
and 18 functions. File names come from `slug` (lower-case letters and
digits, a dash for each run of anything else) and `unique` (the second
`Notes` is `notes-2`). `sections` is a fold from the end of the file that
carries a `Pile` of pending lines and finished sections.

This one was generated from TypeScript with the DSL, not built by clicks:
`Chapter` has `Int` fields (its number and word count), and the editor's
field form can't make one (Countdown's item 1 below).

Files: `compiler/out/chapters.js`, `compiler/gaps/chapters.ideal.js` (the
ideal, marked with gap numbers), `compiler/gaps/chapters.ts` (the three
ways, on files kept in memory), `compiler/gaps/bench-chapters.ts` (`npm run
gaps` runs it last), `compiler/test/chapters.test.ts`.

### Results

All three ways print the same, leave the same files byte for byte and exit
the same way. That includes a missing book, a book with no words and a write
that fails halfway, which stops the run with what was already written. No
correctness gap this time. On books generated by `book()` in
`gaps/chapters.ts` (titles with punctuation, capitals, accents and
repeats), with files in memory:

| book | evaluator | compiled | ideal | compiled / ideal |
|---|---:|---:|---:|---:|
| 10 chapters, 5 KB | 23 ms | 0.69 ms | 0.15 ms | 4.5× |
| 100 chapters, 48 KB | 158 ms | 3.1 ms | 0.73 ms | 4.3× |
| 1000 chapters, 485 KB | 1.8 s | 48 ms | 9.2 ms | 5.2× |
| 3000 chapters, 1.4 MB | (skipped) | 226 ms | 45 ms | 5.0× |

So straight-line text code is 4 to 5× from the ideal, between calc (1.5 to
2×) and Countdown (6×). The evaluator is about 40× slower than compiled.
`unique` counts the names before it, so all three are quadratic in the
count of chapters, and the 3000 line shows it.

On disk, end to end, for the 1000-chapter book (1003 files): `lab compile`'s
module takes 210 to 310 ms and `node chapters.ideal.js` 75 to 180 ms, noisy
because of the file system. Start-up alone (the usage message) is 77 ms
against 27 ms. That's G8 again: the runtime's imports, and now also the
worker thread with a 1 GB stack that `lab compile` starts, which every
compiled program pays. (Gone since C26: with C21's heap continuations main runs on
Node's own stack, and queens' start-up went from 214 ms to 76.)

In a profile of the compiled code on the 1000-chapter book, `times in` is
17% of the time, the garbage collector 17%, the `split` builtin 12% and
`words in` 10%. The numbers below come from patching the emitted code by
hand, one gap at a time, each in its own process (51 ms before).

### The gaps, ranked

**G15. A fold from the end keeps a spine (perf: 51 → 41.5 ms, the largest). DONE for Int `+` and `×`, also under a test (PR #140, 2026-10-23): 96 → 84 ms on a slower machine.**
`words in`, `total words`, `times in` and std `length` are folds from the end
whose step is `+`. Each one first walks the list pushing every cell on an
array, then walks the array back calling a step closure. The ideal is a
loop from the front with a counter.
*Fix:* when a fold's step for `cons` is `op(f(head), rest)` with `op`
associative and `nil` gives op's unit (`+` and `0`, `×` and `1`, `and`,
`or`, `++` and `""`), compile it as a loop from the front. Folds that
really need the end first (like `sections`) keep the spine, but when the
list is an array (G21) there's no spine to build.

**G19. Text positions count the whole text (perf: 51 → 44 ms).** `heading`
asks `length(line)`, then `slice(line, 0, 2)`. Each builtin first scans the
line for characters outside the basic plane (`text.ts`, `wide`), so a
prefix test reads the whole line twice. The ideal is
`line.startsWith("# ")`.
*Fix:* in `text.ts`, slices near the start only need to look that far, and
`length` can stop scanning once it knows the answer is the JS length. In the
compiler, `slice(t, 0, k) = "lit"` with a literal is `startsWith`.
*Half DONE:* `slice` now walks the text only up to `to` and never counts its
length, so `slice(t, 0, 2)` of a 1.2 MB text with emoji went from 33 ms to
0.02 ms. chapters doesn't move: its lines are short and have no emoji, and
the regex scan for wide characters is cheap. What's left is the compiler
part, `startsWith` for a slice compared with a literal, and `length(t) > k`
without the scan.
I tried the `startsWith` part after that, and it compiles as planned
(`line.startsWith("# ")`), but chapters didn't move beyond the noise once
`slice` stopped scanning. It isn't merged; the code is too small to be
worth carrying for no measured gain.

**G16. Builders feed consumers through whole lists (perf: 51 → 43 ms for
`words` alone).** `words` is `length(keep(split(line, " "), w ≠ ""))`: the
split makes a list, `keep` makes another, `length` folds it (G15). The
ideal counts as it cuts. `slug` is worse on paper, with `characters`, `map`,
`join all`, `split`, `keep` and `join all` again, but titles are short.
*Fix:* builder/consumer fusion (`docs/design/numbers/NUMBERS.md`, after its
table of fold rows), now with a measured case. `length ∘ keep` and `join all ∘ map`
are the first two to do.
*DONE for chains of known steps:* COMPILER.md, "Folds are loops". `words`
and `slug`'s `joinAll(map(characters …))` are now one loop each, with no
list. chapters, 3000 chapters, 21 runs: 550 → 200 ms (the ideal: 86 ms),
mostly garbage the lists no longer make; at 1000 chapters it's 67 → 59 ms
(the ideal: 19). Not yet: `slug`'s second chain starts from a `let`
(`parts`), and the test lambda is still called rather than inlined (G3).

**G3 again. A test passed to `keep` returns a Bool object (perf: 51 →
46.5 ms).** `keep(parts, p => p ≠ "")` compiles the lambda to `p =>
$bool(!(p === ""))`, and `keep` tests `.tag === "std.bool.true"`. Round 1's
fix made named functions return JS booleans, but lambdas still box.
*Fix:* the same `Spec.bool` for a lambda whose result type is Bool, and for
`keep`'s parameter.
**Done** (C4): when `keep` or another step is fused (G16), a test written in
place is bound as a lambda that returns a JS boolean, and the step calls it
in its condition: `const test = (p) => !(p === "")`.

**G17. A generic function compares with `$eq` (perf: 51 → 48.5 ms;
437 → 393 ms on 3000 chapters).** `times in : (a, List a) -> Int` doesn't
know it's only used on Text, so its equality is the runtime's `$eq`, which
checks types first. It's the inner loop of the quadratic part, so the gap
grows with the book.
*Fix:* specialize a generic function for each type it's called with when
the types are closed (a copy per type, like Rust or MLton), or at least
when it's called at one type only. Then `equalityAt` (round 1's G0) picks
`===`.
*Partly DONE:* `$eq` answers plain values (text, numbers) at once, before
it sets up its stack of pairs: about 610 → 570 ms on 3000 chapters, compiled.
*DONE for one type:* a generic definition that the program uses at one type
only, and doesn't export, now compares as that type, so `times in` uses
`===`. Uses are followed through generic callers. On top of the faster `$eq`
that change is within the noise on chapters (about 545 ms either way); the
win is smaller code and a compare V8 can inline. A copy per type,
for generics used at several types, was measured and left (Backlog C11):
no example program compiles a generic `$eq` any more.

**G14 again. `heading` is a generator (perf: 51 → 48 ms).** It has one
answer or none, and `sections` wraps it in `optional`, which drains it with
`for … of`. Same fix as Countdown's. `lower`'s `first(fromCode(code(c) +
32))` is the builtin version: `code` and `fromCode` answer through
iterables too.

**G20. Int addition checks for overflow (perf: no change).**
`$int.add(n, 1)` checks the result is a safe integer before every count.
Replacing it with `+` measured nothing here; V8 handles the check well.
Ranges ("a count of things in memory is below 2^53") would remove it, but
there's no measured reason to yet.
Measured again after G15 and G17, with `acc + 1` for a fold that counts
from 0: still within the noise (about 3% on 3000 chapters), so it stays.

**G18. The Abort handler is a handler stack (perf: once per run, not
measurable).** `main`'s `handle … abort(why) → …` pushes a handler, and
every failure goes through `$perform`, which walks the stack and throws an
`Escape`. The ideal is a try/catch. It matters only when a handler is
entered in a loop. *Fix:* a handler whose operations all escape (none
resumes) around a call is `try`/`catch` on a class of its own. Low
priority. **Done** (Backlog C12): such a match is compiled inline,
`$enter` before the body, `$caught` in the catch and `$leave` in the
finally, with no tables of cases or closure for the body. calc enters one
per line; on a 40,000-line session the gain is within noise, though a
micro-benchmark of a million entries, half of them aborting, takes 0.55 s instead of 0.9.

All of the above together, patched by hand: 51 → 30 ms. The rest, 30 →
9 to 12 ms, is the data representation:

**G21. Lists that are only walked are cons cells.** `split` returns an
array, the runtime turns it into cons cells, and the program walks them
once. The ideal keeps the array. Most std lists in this program are built
by a builtin and read front to back. *Fix:* the `array` row
of `docs/design/numbers/NUMBERS.md`'s fold table: a list that's never consed onto,
only walked or folded, is an array.
*Design written:* NUMBERS.md, "The `array` row". A walk-only list parameter
gets an `$arr` copy taking an array and a start, chosen by a whole-program
fixpoint. Conversions to cons cells happen only where a value stops being
walked.
*First part built:* lists walked whole. A parameter or let whose every use
is a fold (that doesn't read the rest of the list), `join all`, `one of`,
or handing it on to another such binder holds the array `split` or
`characters` made; definitions get an `$arr` copy for calls that pass one.
chapters' lines go from `split` to `sections` with no cells and no spine:
3000 chapters, 199 → 167 ms (median of 31, alternating runs; ideal 86).
*Second part built:* lists built by consing and then walked. A binder whose
uses are walks, or a `cons` onto it whose result is again walked or consed
onto, is kept from the other end: `{ a, n }`, the list a[n − 1], …, a[0].
`cons` pushes when nothing has pushed past n yet and copies otherwise, so
older lists never change (runtime.js `$snoc`). An empty list handed to such
a binder starts as `{ a: [], n: 0 }`. chapters' `taken` grows by one push
per chapter, and `times in` walks an array. Against the code before G21,
3000 chapters go from about 3.4× the ideal to about 1.9× (same process,
alternating, median of 31; the machine was noisy, so ratios rather than ms).
*Left:* lists that are matched on (the array and a start, as designed).

**G13 again.** `sections` builds a `Pile` record per line and takes it
apart in the next step. The ideal carries two locals.
*DONE (the fold part):* a fold whose answer is one record, and whose
steps only read the fields of the folded rest, carries the fields in
locals and builds the record once (`foldArms` in compile.ts). Within the
machine's noise on chapters (one record fewer per line). Left: a
single-answer function such as `join` still builds its record to return
it; that needs a way to return several values.
**Done** (Backlog C6): a single-answer function whose answers are all
one record, called where the search goes on with its answer, has a
`$fields` copy that leaves the fields in `$got` and returns whether it
has an answer; the caller reads them into locals and builds the record
only if it keeps it whole, as G13's `$k` copies do. Countdown's `join`
builds no `found`: biggest instance 1.47× → 1.30× the ideal (median of
eight alternating runs against main, noisy).

### Running it backwards

Not a compiler gap, but this round found it. The check that runs every
example's functions backwards (`ters/test/agreement.test.ts`) fails on
three of chapters' text functions in `relate.ts`:

1. `words` backwards from 0 overflows the stack. (`words` is
   `length(keep(split(line, " "), w ≠ ""))`.)
2. So does `words` backwards from 1.
3. `words in(["", "ab"]) = 1` with both sides known gives no answer, but the
   evaluator gives 1. That's a wrong answer, not only a slow one.

The check also took 13 minutes on chapters alone, so the step budget doesn't
bound this search. These went to `relate.ts`, not to the compiler, and are fixed by PR #142: whole-number add and subtract and `split` run backwards, and the chapters check takes under a second.

## Round 3: ledger (2026-10-23)

`ters/examples/ledger` reads a file of money entries, one per line
(`date,account,cents,memo`; blank lines and `#` comments skipped), and
prints totals by account, largest first, totals by month, the smallest
entry and the grand total. A line that doesn't have four fields, or whose
amount isn't a whole number of cents, stops the run with its line number.

```
$ node ters/cli/lab.ts run ters/examples/ledger ledger.csv
By account
salary             7000.00 × 2
coffee               -4.50 × 1
groceries           -81.54 × 3
rent              -2400.00 × 2
...
smallest: -1200.00 on 2026-09-02, flat
total: 4513.96 in 8 entries
```

It has 32 definitions, against chapters' 21: two record types and 30
functions. Totals are a list updated by a recursion (`add to`), sorted by
an insertion sort (`insert`, `sort`) that orders either by amount or by
name; money is printed from Int cents with text alone (`zeros`, `with
point`); padding is a fold over `range`, so the checker sees it end.
`Choice` comes in through `read whole number` and the `character(10)` that
gives `newline`; `Abort` through `bad line`, `amount` and `show ledger`.

It was built in the editor by clicks, the way Countdown was: headless
Chromium driving the built page (palette picks, typed values, the case and
field forms, renames, the graph's *Add a value here…*), then *Save file*
and `examples/unpack.ts`. Nothing was edited by hand, and the DSL wasn't
used. What the editor made hard is listed at the end.

Files:
- `compiler/gaps/ledger.ideal.js`: the hand-written ideal, with the gaps
  marked.
- `compiler/gaps/ledger.ts`: the three ways in one process, and a generator
  of entries.
- `compiler/test/ledger.test.ts`: all three agree on output and exit code,
  failures included.
- `compiler/gaps/bench-ledger.ts`: the numbers below.

### Results

```
file                        evaluator   compiled      ideal  compiled/ideal
100 entries, 3 KB               74 ms    0.98 ms    0.49 ms  2.0×
1000 entries, 35 KB            208 ms    3.27 ms    1.40 ms  2.3×
3000 entries, 107 KB           870 ms    9.46 ms    2.75 ms  3.4×
4000 entries, 143 KB        (skipped)      14 ms    3.10 ms  4.4×
```

All three agree everywhere they run. The first result of this round is a
correctness gap, not a speed one: past about 5000 lines the compiled code
runs out of JavaScript stack in a process with the default stack, which
is how the editor and the browser run it. `lab compile` output still
runs, because it re-runs itself with G1's 1 GB stack: 50,000 entries take
0.69 s there, 0.15 s for the ideal, and 9.1 s in the evaluator.

### The gaps, ranked

**G22. A recursion that builds a list keeps its frame (correctness: stack
overflow past about 5000 items without G1's big stack; perf too).**
`entries` is `cons(parse(line, n), entries(rest, n + 1))`, `add to` and
`insert` are `cons(t, add to(rest, …))`. The call to itself isn't the last
thing done, so stage 2½'s jumps don't apply, and each item is a JS frame.
The ideal is a loop that appends. *Fix:* tail recursion modulo cons: when
the only thing after the self-call is putting it in a constructor's last
field, build the cell first with a hole for that field, pass the cell
down, and loop. Prior art: Friedman and Wise, "Unwinding stylized
recursions into iterations" (1975); OCaml 4.14's `[@tail_mod_cons]`
(Bour, Clément and Scherer, 2021). With G21's arrays, a list made this way
and only walked could be an array pushed in order, too.
**Done** (C19, the PR after round 3): a constructor whose last field is a
call of the definition to itself, in a tail position, makes its cell with
that field empty, hangs it in the last hole, and jumps. Every other answer
goes into the last hole, and the first cell is returned. ledger now runs
10,000 and 50,000 lines in one process (2.7× and 3.9× the ideal).

**G25. A list nobody else holds is copied to change one item (perf: the
biggest gap left, measured after G22).** `add to` is a persistent update:
each entry copies the totals before its account, about 20 new cells per
line, and `insert` does the same for sort. A profile of compiled ledger at
50,000 lines puts `by account` and `by month` (with `add to` inlined) at a
third of the time and the garbage collector at a fifth. Giving the ideal
the same copying `add to` takes it from about 55 to 100 ms, so this alone
is most of the distance. The totals are the fold's own accumulator: the
previous step made them and nothing else holds them, so the cells could be
changed in place. *Fix:* reuse of cells known to be unique, decided at
compile time: the accumulator of a fold whose step only passes it to a
function that takes it apart and builds it again. Prior art: Koka's
Perceus and "functional but in place" (Reinking, Xie, de Moura and Leijen,
PLDI 2021; Lorenzen, Leijen and Swierstra, ICFP 2023), already the plan
for native code.
**Done** (C20, COMPILER.md "Data"): `$own` copies of `add to` and `insert`
change the matched cells. `by account` alone went from 35 to 25 ms on
50,000 entries (the ideal takes 11 ms); the whole run is about 10%
faster. What is left of the distance: a new `total` record per entry (the
items of an owned list aren't owned yet), and the loop around each cell.
calc's `tokens` reuses its accumulator's cells too.

**G23. Folds from the end over a list built by cons walk its spine first
(perf: four spines of every entry).** `by account`, `by month`, `smallest`
and `sort` fold the list of entries from the end, so each copies the whole
list into a spine array before it starts. The ideal walks an array from
the end. *Fix:* G21's arrays for a list that `entries` builds (with G22, a
push per item), or the matched-list part of G21 for `split`'s lines,
which `entries` takes apart with `match`. This is the first program where
an array from `split` reaches a `match` (also in `parse`, four levels deep
on `split(line, ",")`).
*Part done:* a list from `split` or `characters` taken apart by matches,
whose cons arms only match the rest again, is an index into the array
(`viewOf` in compile.ts): `parse` makes no cells, about 5 to 10% on the
ledger (noisy). Left: `entries`, which hands the rest of its lines to
itself, would need the `$arr` copy to take an array and an index, and the
four folds from the end still walk a spine of cells, since `entries`
builds its list with G22's holes.
*Second part done* (Backlog C22): a list parameter that is only taken
apart by matches, whose rests are only matched or handed to such a
parameter again, gets an `$arr` copy taking the array and an index when
it is given `split`'s array or such a rest. `entries` and calc's `run
lines` walk their lines this way, a loop with no cells. Ledger at 50,000
lines: about 159 → 148 ms (noisy). Left: the four folds from the end over
the entries, which `entries` builds with holes.
*Measured, and left as it is* (Backlog C22): the compiled ledger patched by
hand so that `entries` also pushes each entry to an array and three of
the folds from the end walk that array instead of a spine of cells ran
50,000 lines in 146 ms against 138 ms unpatched, within the noise. A
spine walk is one load and one push per cell; each step's `add to` is
the cost. So the arrays aren't worth the analysis that would pass them
through `show ledger` and `report` to the folds.

**G24. A Choice builtin with at most one answer is a generator under
`first` (perf: once per entry).** `first(() => read whole number(field), …)`
loops over `$many["builtin.int.read"]`, which makes an array of zero or one
answers, inside a closure called in place. The ideal is one regular
expression test. The same holds for `newline`'s `character(10)`. *Fix:*
G14's single-answer copies for builtins: `read`, `code`, `fromCode`,
`quotient`, `remainder` and `find` have at most one answer.
**Done** (C5): every Choice builtin is partial (std.ts `choice`), so a
call runs `$partial`, the answer or `$no`, and counts as one answer for
G14. A `first` whose body has at most one answer runs it in place, with no
search to stop: `amount` is a read and a test, and chapters' `lower` too.

**G3 again. A Bool parameter is data.** `sort(…, false)` passes `$F`, and
`goes before` tests `.tag === "std.bool.true"` for each comparison. G3's
JS booleans cover results, not parameters.
**Done** (C4): a definition only ever called by name, and not exported,
takes its Bool parameters as JS booleans. Tests read them as they are, and
a use as data boxes them (`flag ? $T : $F`).

**G19 again. Text positions are counted per call.** `with point` asks for
the length of the same text three times, and `blank`, `month` and the pads
go through `$impl["builtin.text.slice"]` and `length`, which count code
points. For texts the program made from digits (`show`) or read from a
file of ASCII dates, a prefix test or a UTF-16 slice is the same thing; the
compiler can't know that yet.

### What the editor made hard

ledger took about 230 palette picks in 30 functions. Filling is fast, and
three things from round 2 are fixed: fields can be `Int`, field reads are
in the palette (`name(□)`), and nested matches can be renamed as they go.
What got in the way, roughly in order of cost:

1. **A function parameter can't be called until its type is known.** The
   insertion sort was meant to take `before : (Total, Total) -> Bool`. The
   palette offers `before` as a value but no `before(□, □)`, and nothing
   gives the parameter a type first, so `insert` and `sort` take a Bool
   `by name` and choose with an `if` (`goes before`). Blocking for any
   higher-order definition written from scratch.
2. **A text can't hold a newline.** The literal field is one line, and
   `"\n"` typed in the palette is a backslash and an n. `newline` is
   `first(() => character(10), () => "")`. Splitting a file into lines
   needs it, so every program that reads files does.
3. **A step can only go at the top of a definition.** *Add a value here…*
   (the graph's menu on empty space) adds a dot before the definition's
   result, never inside a match arm. "Print the usage, then return 2" in
   one arm of `main` needs its own definition (`usage`, `failed`).
4. **An Int is not offered for a number typed in an Int hole.** Typing `0`
   in `slice`'s position offers nothing; the way in is to search "int",
   pick *an integer*, then type the value in the Literal panel (E21).
5. **Several rows have the same label.** `show(□)` comes three times
   (Number, Int, any) and `cents(□)` twice (Entry, Total); only the type
   line under each tells them apart.
6. **Spaces in a typed text are collapsed.** `"  × "` comes out as
   `" × "`.
7. **The Text view drops brackets around an `if` inside `++`.** `money`
   reads `if c < 0 then "-" else "" ++ with point(…)`, as if the join were
   part of the `else`.
8. **Effects run while editing.** Writing `usage` printed "usage: ledger
   file.csv" to the page's console: the editor evaluated a definition
   with `Console` as soon as it was complete.

## Round 4: the pedal (2026-10-24)

`ters/examples/pedal` is a guitar pedal (AUDIO.md). Each block of
128 samples goes through four steps:

1. Haar's split into a slow band and a fast band, written as lifting steps.
2. Overdrive of the slow band in saturation space: `conjugate(into saturation, y => amount · y)`, which is tanh(amount · atanh x). The way back is atanh run backwards.
3. The join, which is the split run backwards.
4. A compressor whose level follows the samples one by one and carries over in a cell.

It is the first program of the rounds that has to keep up with a clock:
375 blocks a second at 48 kHz.

Unlike rounds 2 and 3, the pedal was not built in the editor: a script
wrote it with the TypeScript DSL (`Lang`) and saved it
(`ters/gen-pedal.tmp.ts`, committed by accident in #332 and
removed later; it is in the history). So this round says nothing about
what the editor makes hard (REVIEW-2026-10-26.md §3).

Files:
- `compiler/gaps/bench-audio.ts`: the compiled pedal, the evaluator, and
  the pedal written by hand over arrays, on the same blocks. It first
  checks that all three give the same samples.

### Results

```
                 ms a block   blocks/s   × real time
compiled (A5)        0.069      14 500        39
compiled (P1)        0.060      16 600        44
by hand              0.012      84 000       224
evaluator          122              8          0.02
```

The compiled pedal was 6× the hand-written one, and is 5× after P1. A
profile of the compiled pedal before P1 put a third of its time in two
places. One was `$clean`, the solver's rounding to 12 digits, done
through a string by `toPrecision`. The other was the key and the set
that tell a solve's answers apart, even when a solve has only one way to
an answer (A5 removed those).

### The gaps, ranked

**P1. The solver's rounding goes through a string.** Each answer of a
solve is rounded to 12 digits, so the compiled code gives exactly the
evaluator's numbers. Drive runs atanh backwards once a sample, so the
round trip through a string happens 128 times a block.
*Fix:* round with arithmetic instead. Take the 12 digits as a whole
number n, then divide n by a power of ten. Division rounds correctly, the
same way reading the digits back does. Where n could be off by a half, or
the power of ten is out of range, fall back to `toPrecision`.
`test/clean.test.ts` checks it against `toPrecision` on 300,000 values.
**Done** (C27): rounding is 6× faster, and the pedal went from 6.0× to
5.1× the hand-written time.

**P2. A solve with one answer comes back as a list of lists.** `drive` is
`first(() => conjugate(…)(x), () => x)`. Compiled, each sample builds
`[[x]]` inside a closure, then walks it with `for … of` inside another
closure.
*Fix:* when the solve has one way to an answer, have it give the value or
`$no`, and compile `first` over it as a plain test.
**Done** (C28): such a solve also has `name$one`, its binds or `$no`, and
`first` over it is a test: 5.1× to 4.6×.

**P3. Mode functions try their arms in closures.** Written out,
`bands$mode0` (Haar's join):
- wraps each arm in an `(() => …)()`;
- returns each answer as a one-item array;
- tests for an empty list with `$eq(p, $nil)` instead of its tag;
- keeps the arm that only fails (it builds a nil and returns `$no`).

*Fix:* when the arms build the result with different cases, test the
tag, write the arms as blocks, and return the value itself. Drop an arm
whose plan only fails.
**Done** (C29): arms are labelled blocks, nil is a tag test, the arm
that only fails is gone, and one output comes back as itself: 4.6× to
3.6×.

**P4. A block is a linked list, made again at every step.** One block
allocates:
- 128 cells on the way in, and the same on the way out;
- 64 pairs and 64 cells in the split;
- 64 more of each when driving the slow band;
- 128 cells in the join;
- 128 cells and 128 pairs in the compressor.

The hand-written pedal changes one array. *Fix:* Wadler's fusion (C11 measured it on lists, G21 has
arrays), with the AudioWorklet's Float32Array as the representation of a
block's List Number. This is the biggest gap and the biggest change.

**P5. The compressor returns a pair for every sample.** `following`
gives back the samples so far and the level, so each level of its
recursion makes a Pair. It also counts its depth for the heap fallback
(C21). *Fix:* return the pair's two fields without the record. This is
tail recursion modulo a constructor, carried through a Pair's first field.

*Measured* by hand (`$got` for the pair's fields): 3%. It waits for P4,
where the compressor's list goes into an array and the level is a local.

**P6. The drive still runs in closures** (C32). After P2 and P3, `drive`
was a closure for `first`, another for the let inside the solve's given,
and a one-item array for its one answer. **Done**: `first` of one answer
given back from a definition is its statements in place, a let among a
search's parts is statements, and a solve with one bind gives the value
itself. 3.6× to 3.5×.

**Where this leaves P4.** Two hand-written versions of the compiled pedal
show how far arrays go. The first keeps every definition, with blocks as
arrays between them: views in and destination passing out (each copy
pushes its list onto an array it is handed). That runs at 2.3 to 2.8×.
The second fuses the split, drive and join into one loop and drops the
pairs: 2.1×. So getting within 2× needs both P4 and fusion across the
conjugation. Views exist in the plain path (G23); destination passing is
new, and has to be done in all three of the compiler's paths (plain
definitions, ones with Choice, and written-out modes). Prior art:
destination-passing style (Minamide, "A functional representation of
data structures with a hole", POPL 1998; Shaikhha, Fitzgibbon, Peyton
Jones and Vytiniotis, FHPC 2017), and OCaml's tail modulo cons (Bour,
Clément and Scherer, 2021).

**P4a. Destination passing for plain definitions** (C30). **Done**: a
plain definition that builds its list front to back has an `$into` copy
that pushes onto an array it is handed. A two-field record holding the
list is written the same way and returns the other field, which covers
the compressor (samples and level). A block function has a version the
audio runtimes call (`$arrayOf`). The compressor is a loop with its level
in a local, and the block reaches the runtime as an array: 3.5× to 2.9×
(best of five runs; `bench-audio.ts` now takes that).
Next, by what the hand versions say is left:
- (b) the split (`bands`, which can fail, so it is on the Choice path)
  writing into an array;
- (c) the join (a written-out mode) taking a view and writing into one;
- (d) the block coming in as an array.

**P4a again** (2026-10-28): #338's off switch (`out = as loud as(…)`,
then the block itself when the pedal is off) had taken the block off the
`$into` path without anyone noticing, since nothing measured it. A let
whose value writes the list and whose name is one of the answers is now
written first, and another answer resets the array and writes its own
(`letInto`). Best of six: 0.0417 to 0.0327 ms a block, about 22%; a test
in compile.test.ts checks the block has its array version.

**C30, step 1** (2026-10-28): a list that an `$into` copy writes, handed to
a definition that only takes it apart, now goes in as an array view
(`$intoArray`) instead of being built as cons cells and walked. In the
pedal this is the block on the Choice path. Best of six: 0.037 to 0.031 ms
a block, about 16%, with the same samples. Next: the search (the split,
`driven_lows`' map and the join) on arrays.

**C30, step 2** (2026-10-28): a mode written out (modes.ts) whose one
unknown is a list built front to back has an `$into` copy too. It pushes
the items, and a call of itself where nothing else would be tried is a
jump. `first` whose answer is such a solve's bind, handed to a definition
that only takes it apart, comes as an array (`firstArray`). In the pedal
this is Haar's join run backwards, walked by the compressor. Best of six:
0.0305 to 0.0271 ms a block, about 11%, with the same samples. Next: the
split and `driven_lows`' map on arrays.

**Where round 4 stops** (2026-10-24): 2.9× the hand-written pedal, from 6×.
The rest is open (BACKLOG C30). Measured on hand edits of the compiled
pedal:
- (d) alone, the block handed in as an array and the split walking it by
  index, buys about 8%.
- (b) and (c) only pay together. The split's array is no use to the join
  unless the join takes it as a view, and the join's array is no use to
  the compressor unless it arrives as one.
- (b) to (d) together come to about 25%, about 2.2×.
- Fusing the split, drive and join into one loop adds about 5% (2.1×).

No single next stage buys 10%, so the stages stop here. Done again, (b)
to (d) are one stage. Within 2× would also need the solver's 12-digit
rounding (`$clean`, about 6% of the time) to be cheaper or not needed.

## Round 5: routes (2026-10-29)

`ters/examples/routes` reads a file of roads between towns and
answers questions about them. It prints how many towns, roads and parts
there are, the length of the cheapest network that joins every town that
can be joined (Kruskal's method, 1956, over a union-find forest joined by
size, Galler and Fischer, 1964), and the town farthest from the first one.
Then, for each `trip` line, it prints the shortest route (Dijkstra's
method, 1959), and for each `near` line, the towns within so many km.

```
$ node ters/cli/lab.ts run --as-defined ters/examples/routes ters/examples/routes/roads.txt
7 towns, 8 roads, 2 parts
cheapest network: 570 km in 5 roads
farthest from Arden: Eskar, 460 km
Arden → Brisk → Dunmore → Eskar: 460 km
Eskar → Dunmore → Brisk → Arden: 460 km
Arden → Gant: no route
within 250 km of Brisk: Arden 120, Colm 150, Dunmore 200
Gant → Fallow: 70 km
```

It has 39 definitions, against ledger's 32: 6 types and 33 functions. It
is the first program of the rounds that is built on std's `Map` and `Set`
(DATA-STRUCTURES.md). Before it, no example used them:

- the graph is a `Map Text (List (Pair Text Int))`;
- Dijkstra's frontier is a `Set (Pair Int Text)`, nearest first;
- the best way to each town is a `Map Text Best`;
- the union-find forest is two maps in a record.

Three recursions the checker can't see end (`settle`, `way back`, `root`)
give it `Diverge`. It sorts records with the prelude's `sort` through
`compare`. `Abort` is raised in three places and handled once.

It was written with the TypeScript DSL (`Lang`) by a script that isn't
kept, as the pedal was, so this round says nothing about what the editor
makes hard. It can't be opened and run in the editor yet anyway (M2).

Files:
- `compiler/gaps/routes.ideal.js`: the hand-written ideal, with the gaps
  marked. Maps are JS Maps changed in place, and the frontier is a
  binary heap whose stale pairs are skipped when popped. The pairs that
  count come out in the same order as from the program's set.
- `compiler/gaps/routes.ts`: five ways in one process (the evaluator and
  the compiled code, each on maps and sets as defined and as trees, and
  the ideal), and a generator of made-up countries.
- `compiler/test/routes.test.ts`: all five agree on output and exit code,
  failures included, apart from the two open gaps below (marked todo).
- `compiler/gaps/bench-routes.ts`: the first table below.
- `compiler/gaps/bench-routes-edits.ts`: the compiled program edited by
  hand, one gap at a time, for the second table.

### Results

```
country               evaluator  evaluator,   compiled  compiled,     ideal  compiled/  trees/
                                     trees                  trees              ideal    ideal
100 towns, 6 KB         2229 ms    1815 ms      101 ms     20 ms    1.35 ms      75×    15.0×
300 towns, 18 KB       21910 ms    5806 ms      549 ms     75 ms    3.81 ms     144×    19.6×
1000 towns, 61 KB     (skipped)  (skipped)     8049 ms    422 ms      12 ms     683×    35.8×
3000 towns, 183 KB    (skipped)  (skipped)    93313 ms   2710 ms      60 ms    2190×    45.3×
```

Each country has its towns, twice as many roads again, and 10 trips and
nears. Each trip or near is a Dijkstra search from its town, and so is
the summary. "Trees" means the weight-balanced trees the chooser picks
for Map and Set. The 93 s is from one run; the bench now skips it.

This is the widest gap of the five rounds, and the only one that grows
with the input: 15× to 45× with the trees, and worse than quadratic as
defined. The first two findings are correctness gaps:

- the compiled code gets one input wrong (M1);
- `lab run` and the editor refuse the program (M2).

What each fix would buy was measured by editing the compiled program by
hand (best of 7, against the same ideal time per size):

```
edit, each on top of the last        1000 towns   3000 towns
as compiled, on trees                   22.4×        70.0×
M3 the smallest item, not items of      15.2×        33.8×
M4 compare at its type                   7.2×        15.5×
M5 no depth counting in the trees        7.3×        13.9×
M7 value at as a loop, one lookup        6.9×        14.8×
```

Timings on this machine move by about 20% from run to run, so the last
two rows are within the noise. M3 and M4 together take the program from
70× to about 15× at 3000 towns. Most of what's left is M6, the trees
themselves.

### The gaps, ranked

**M1. `map` or `keep` straight over `split` compiles to the list unchanged
(correctness: wrong output).** `words(line)` is `keep(split(line, " "),
w => not(w = ""))`. The compiled `words` binds the test and never calls
it:

```js
function words(line6) {
  return (() => {
    const test = ((w) => !(w === ""));
    const out$39 = [];
    for (const x$40 of $text.split(line6, " ")) out$39.push(x$40);
    return $toList(out$39);
  })();
}
```

So `road E  F 1` (two spaces) is a bad line compiled, and a road from E
to F in the evaluator. `map(split(t, " "), f)` as a definition's answer
gives the words without `f` in the same way. This was checked on a
two-line program: `"a  b"` gives `a,b` against `a,,b` for keep, and
`a!,!,b!` against `a,,b` for map. The cause is in `fused`
(compile.ts). When the outermost call is itself a step (`stepOf` says
so for `map` and `keep`), `sinkOf` makes it a sink that pushes each item.
That sink's own step is never applied. A chain of steps under it hides
this, because the chain's steps are applied. The empty chain over an
array source, allowed since G21 part 1 (0bed298), is where nothing
applies it. Inside a step chain, or with `join all` as the sink, the
answer is right.

*Fix:* in `sinkOf`, apply the step's `emit` to each item before pushing,
or don't take a step definition as the sink when the chain is empty. A
test in compile.test.ts with `map` and `keep` straight over `split` and
`characters`. `routes.test.ts` has a todo that turns green with the fix.

*Fixed:* `sinkOf` applies the step's own `emit` before pushing (BACKLOG M1).

**M2. A map or set in a field of the program's own type can't take the
tree (correctness: refused).** `lab run` without `--as-defined` says
"routes doesn't check on Map as weight-balanced tree, …: search needs
Set (Pair Int Text) here, got Set tree (Pair Int Text); …". The
chooser picks the trees, and `represent` rewrites the definitions it is
handed. lab.ts's `represented` and the editor's runWorker.ts hand it
only the definitions that aren't types, so `Search`, `Forest` and the
record of `Best`s keep fields typed `Map` and `Set`, while the code that
fills them now makes trees. The editor's Run fails the same way, so the
program can't run there at all. Handing `withLibraryRepresentations`
every definition, the types too, makes it check and run, and print what
the definition prints. The tree columns above are measured that way.
`asMeanings` already turns a case's fields into meanings, so equal, show
and compare on such a record should be right. That needs a test, since
no example compares one.

*Fix:* pass the program's types to the rewrite in lab.ts and
runWorker.ts, with a test that a record holding a map is equal, shown
and compared by meaning. That makes it a Language-lane change with an
editor line, so it needs the editor lane's go-ahead. `routes.test.ts`
has a todo for it.

*Fixed* (BACKLOG M2) in lab.ts; the editor lane makes runWorker.ts's
line. The test found show wrong: a record of the program's own type
didn't count as holding a map, and once it did, its meanings couldn't be
built in the same type, which the rewrite changes. They are built in a
copy of the type that the rewrite leaves alone.

**M3. Taking the head of `items of` walks the whole set (perf: n per
step, so n² per search).** `settle` is `match items of(frontier) | nil →
… | cons(next, later) → …`, and `later` is never used. Compiled, each
step makes the whole set into a list (`set_tree_onto`) to read its first
item. The trees module already has `set tree smallest`, which walks down
the left. *Fix:* a law the compiler reads: a match on `items of(s)`
(also `keys of`, `entries of`) whose cons arm doesn't use the rest is
the representation's smallest, or nil when it's empty. The lists those
jobs give are walked once, front to back, so a lazy `items of` would do
it too (ROADMAP 5's folds as representations). In the library, a
`smallest item` (Choice) with a tree job would let the program say what
it means (language gap LG1 below). *Measured:* 70× to 34× at 3000 towns,
22× to 15× at 1000.

*Fixed* (BACKLOG M3): the trees' rows carry `heads`, a list of the first
item only for each of those jobs, and library-reps.ts uses it for such a
match. At 3000 towns, compiled on the trees, it went from 2630 to 1433 ms
(72× to 30× the ideal), and at 1000 from 410 to 294 ms.

**M4. `compare` is the evaluator's, at run time (perf).** Every step in
a tree compares keys through `$compare`, which is `compareValues` in
run.ts. Each call does four things:

- allocates a stack of pairs;
- tests each text against a regular expression for characters outside
  the basic plane;
- looks up each case's place in a Map;
- returns an Order record, which is then switched on by its tag string.

Keys here are a Text, or a Pair of Int and Text. *Fix:* compile `compare`
at its type, as G0 did for `equal`:

- Text: `<` and `===`, with code points only when a text has a
  character outside the basic plane;
- Int: numbers, with a bigint path;
- a record: field by field, in line;
- the answer: -1, 0 or 1, switched on as a number.

The tree jobs in the trees module call `compare` generically, so this
needs them compiled at the key type: copies per type, which L38's generic
code already makes. *Measured:* 34× to 15.5× at 3000 towns, 15× to 7×
at 1000.

*Fixed* (BACKLOG M4): `orderOf` in compile.ts, and a copy per type for a
generic definition that compares its type variables (Spec `at`). At 3000
towns, compiled on the trees, it went from 1433 to 643 ms (30× to 16× the
ideal), and at 1000 from 294 to 132 ms. A copy is made for each type every
variable is called at, the value's too (`tree put$Text_Int`,
`tree put$Text_Text`). Copying only the compared ones would make less code.
That is done now (BACKLOG M4 again): 64.3 KB to 53.8 KB, at the same speed.

**M5. The trees count their depth (perf, small).** Every tree job that
recurses (`tree put`, `set tree add`, …) increments and decrements
`$rec.d` and checks it against 1000, for C21's switch to the heap. A
weight-balanced tree is never more than about 2·log₂ n deep, so the
check never fires. *Fix:* a representation's jobs can say they recurse
only on a balanced shape, and the compiler leaves the count out of
those. *Measured:* about 10% at 3000 towns, nothing at 1000, so within
the noise. It waits for M6, after which the trees are a larger share of
the time.
Measured again after M4, it is still within the noise (IN-PLACE.md).

**M6. The maps are persistent, the ideal's are changed in place (perf:
most of what's left).** Each `put`, `add item` and `remove item` copies
the path from the root, making log n new nodes, and rebalances.
`improve` does three of these each time a road makes a town nearer, and
`settle` removes one more. After M3 to M5, a profile at 3000 towns has
`tree value at` at 26% and `relax` (with `improve` in it) at 21%. The
tree builders (`add`, `put`, `balance`, `node`) come to 20%, and GC to 8%.
The ideal's JS Map hashes a town once and changes one entry. In `settle`,
`shortest` and `cheapest`, every map and set has one owner: each
version is used once, to make the next. *Fix:* reuse in place when the
old version is dead (Perceus, Reinking, Xie, de Moura and Leijen, PLDI
2021; native N5c already finds unique values), then the in-place table
row of DATA-STRUCTURES.md ("later representations"), for maps that are
only looked up. This is the large one, and it needs a design note first.

*Design:* docs/design/data/IN-PLACE.md (BACKLOG C56, C62, C63). After M4, a
profile has lookups at 27% and node building at 20%, so the table (C63)
matters more than reuse in place (C62).

*Status (2026-11-01):* the table is built (C63b) and routes compiled takes
it for its maps (C63c): 319 ms at 3000 towns against 654 ms on the trees,
8.8× the ideal instead of 18×. Sets keep the tree.

**M7. Lookups done twice and in closures (perf, small).** `improve`
reads `value at(found, town)` twice: once for the test and once to
remove the old pair. Each read is wrapped in an `(() => …)()` for its
`first`, and the test goes through `$bool(…).tag === "std.bool.true"`.
`tree value at` is a recursion that checks `$no` after each call,
though its calls are in tail position. *Fix:*
- the same pure call with the same arguments in one body, done once;
- `first` over a lookup as statements (P6 did this for a solve with one
  answer);
- a Choice definition whose recursive call is the arm's answer, as a
  jump.

*Measured* (a loop for `value at`, one lookup in `improve`): within the
noise, so it waits.

**M8. The evaluator takes seconds (not the compiler's, but the editor
runs it).** With the trees, 300 towns take 5.8 s in the evaluator, 1,500
times the ideal, and 22 s as defined. When M2 lets the editor's Run take
the trees, a file this size will still hold Run for seconds. This is a
note for the Language lane, not a compiler gap: the evaluator's cost per
step of the tree jobs.

### Language gaps

These are the places where routes declares a type, defines a helper or
wraps a call only because the language lacks something (WORKFLOW.md,
"Language gaps, every round"):

- **LG1. No way to take a set's smallest item.** `settle` takes it apart
  with `items of` (M3). A `smallest item(s)` (Choice: none when empty),
  with `largest item` and the same for a map's keys, says what is meant
  and gives the tree a job. No other example uses sets yet.
- **LG2. No "change the value at a key".** `connect` is
  `put(g, a, cons(x, neighbours(g, a)))`, where `neighbours` exists only
  for its default. `size of` exists the same way. `improve` looks the
  same key up twice (M7). An `update(m, k, default, f)` would remove
  `neighbours`, `size of` and the double lookup. ledger's `add to`
  writes around the same thing with a list, as round 3 shows. That makes
  two examples, so P2 by the workflow's rule.
- **LG3. Sorting by a key needs a type.** `Span` exists only so that
  `compare` puts the length first, so `sort` orders roads shortest first.
  A `sort by(list, key)` or `sort with(list, before)` would use the
  `road` lines as they are. ledger writes its own insertion sort for the
  same reason (it sorts by amount or by name). Two examples, so P2.
- **LG4. A word splitter.** `words` is `keep(split(line, " "), …)`.
  It's small, but it is where M1 bit, and wc and calc split their input
  their own ways.

### Proposed order

1. M1, the miscompile. It is a small PR, and the most urgent: a program
   prints the wrong thing.
2. M2, so routes runs in `lab run` and the editor. It needs the Language
   lane, with the editor lane's say for runWorker.ts.
3. M3, the smallest item, with LG1 if the Language lane takes it, so the
   law and the operation come together.
4. M4, compare at its type: about 2× on its own.
5. M6's design note: in-place reuse of maps and sets that have one owner.
6. M5 and M7 after M6, when they can be measured above the noise.

These go into BACKLOG.md's Inbox for the coordinator's triage: M1 to M7
as C rows, and LG1 to LG3 as L rows.

## Round 6: notebook (2026-11-01)

`ters/examples/notebook` reads a file of notes and questions about them.
It indexes every note's words once, prints a summary (how many notes,
terms and different terms, the most common terms, the longest note), and
then answers each question from the index: `find` (the notes with every
word, best first), `any` (the notes with some of them), `like` (the other
notes that share the most and the rarest terms with one) and `seen` (the
terms that come most often in the notes with a word).

```
$ node ters/cli/lab.ts run ters/examples/notebook ters/examples/notebook/notes.txt
6 notes, 58 terms, 48 different terms
most common: tide 6, bay 2, harbour 2, make 2, moon 2
longest: ferries, 12 terms
find tide: lighthouse 3000, moon 3000, ferries 1500, harbour 1500
find tide harbour: harbour 4500
any moon bread: moon 12000, bakery 6000
like harbour: bakery 3000, lighthouse 3000, moon 3000, ferries 1500
seen tide: bay 2, make 2, moon 2, all 1, boat 1
find whale: nothing
```

It has 51 definitions, against routes' 39: 3 types and 48 functions. It
was chosen to build its data once and then read it many times (BACKLOG
C59), and to hold maps inside maps:

- the index is a record of two maps: every note by name, and an inverted
  index `Map Text (Map Text Int)`, term → note → times;
- each note holds its own `Map Text Int` of term counts;
- every `any`, `like` and `seen` adds its scores up in a fresh
  `Map Text Int` with `update at`;
- answers are ranked with `sort by` on a `Pair Int Text`, highest first.

A term's weight is inverse document frequency (Spärck Jones, 1972, prior
art) as a whole-number ratio. `Abort` is raised in five places and handled
once. It was written with the TypeScript DSL (`Lang`) by a script kept in
the project's files (`gaps-round6/build.ts`), not in the editor, so this
round says nothing about what the editor makes hard.

Files:
- `compiler/gaps/notebook.ideal.js`: the hand-written ideal, with the
  gaps marked. Maps are JS Maps filled in place; nothing else differs.
- `compiler/gaps/notebook.ts`: six ways in one process (the evaluator and
  the compiled code on the program as defined and as the chooser stores
  it, the compiled code with the hash table allowed, and the ideal), and
  a generator of made-up notes (Zipf-like word counts, capitals,
  punctuation, plurals, stop words).
- `compiler/test/notebook.test.ts`: all six agree on output and exit
  code, failures included.
- `compiler/gaps/bench-notebook.ts`: the table below.

### Results

```
notebook              evaluator   compiled   compiled,   ideal   compiled/   trees/
                                            trees (N1)            ideal      ideal
100 notes, 14 KB        3200 ms      95 ms       —       5.9 ms      16×        —
300 notes, 38 KB      (skipped)     433 ms      81 ms     15 ms      29×        5×
1000 notes, 126 KB    (skipped)    3751 ms     269 ms     44 ms      86×        6×
3000 notes, 378 KB    (skipped)   30155 ms    1112 ms    133 ms     226×        9×
```

Each notebook has its notes (10 to 40 words each) and 100 questions,
a quarter of each kind. The compiled columns as they are today are all
the same: the chooser picks the trees only for the stop words' `Set`
and keeps every `Map` as its sorted list (N1), so `put` and `update at`
are linear and the program is quadratic. The "trees (N1)" column is the
same program with N1's check turned off by hand in library-reps.ts, which
then picks the weight-balanced trees for Map; it is measured, not
estimated. Timings move by about 20% from run to run.

At 3000 notes, with the trees, building the index takes 391 ms against
the ideal's 46 ms (8.5×), and each question about 8 ms against the
ideal's 0.8 to 1 ms (8×). The evaluator is not the compiler's, but the
editor's Run uses it: 3.2 s for 100 notes as defined (9.3 s on a busy
machine), 1.2 s with the trees, and 3.6 s for 300 notes with the trees.

A profile of the compiled program on trees at 3000 notes (runtime only):
`tree update at` and `tree balance` 21%, GC 14%, walking a tree into a
list for `entries of` and `keys of` (`tree onto`) 6%, `sort by`'s merge
and its key closures 5%, `tree put` and `tree value at` 3%.

### The gaps, ranked

**N1. One generic call keeps every Map as a sorted list (perf: the whole
program quadratic).** `most common` is
`map(entries of(postings), (e) → pair(term, total(values of(notes))))`:
`map`'s item type is `Pair Text (Map Text Int)`, a type variable that
holds a Map. `generic` in library-reps.ts takes any such call as a place
where a definition might see the tree's shape (through show, equal or
compare), so the chooser keeps Map as defined for the whole program. It
is the only such call here; nothing tells the author. `map` never looks at
its items. *Fix:* count only the definitions whose type variable reaches
show, equal or compare: what M4's copies per compared type already work
out (Spec `at`), or a scheme flag "looks at a". `first`, `map`, `keep`,
`sort by`, `for each`, `length` and the program's own pass-through helpers
(`ranked`, `credit`, `counted` here) then don't count. *Measured* (the
check off): 29× to 5× at 300 notes, 86× to 6× at 1000, 226× to 9× at
3000; the evaluator 3.2 to 1.2 s at 100 notes. The program's output is the
same either way (the test checks it). **Done (C70):** `generic` counts only a callee
that looks at the value (library-reps.ts `looked`); 3000 notes compiled
on the trees: 235× to 9× the ideal.

**N2. The hash table is all or nothing for a type (perf: about a quarter
of what's left).** Every `any`, `like` and `seen` adds its scores up in a
fresh `Map Text Int` that has one holder: made empty, changed by
`update at`, read once by `ranked`. The ideal changes a JS Map in place.
The one-holder check (C63a) is asked about Map as a whole, and fails here
for reasons that have nothing to do with the score maps: "a Map that holds
another" (the inverted index) and "summary: all is given twice to one
call, and taken" (a list of notes, which hold maps). So no map gets the
table. The postings and a note's counts are `Map Text Int` too, so the
choice can't be made per type either: it has to be per value, from where
it is made (`empty map` in `like line`, `any line`, `seen line`) and
whether that value has one holder. *Fix:* run the one-holder check per
place a map is made and follow each value; let a value that fails keep
the tree. *Estimate:* `tree update at`, `tree balance` and the GC they
cause are about a third of the time at 3000 notes; routes' table bought
2× (C63c). **Done (C71), another way:** every
version of a table stays a value (std.ts `Table`, rerooted), so the table
no longer needs one holder per map and is chosen for the whole type. 3000
notes compiled: 8× to 6× the ideal (940 to 688 ms in one run).

**N3. Data built once and then only read (perf, C59's case).** *Measured
again after C71 and C72 (2026-11-01):* with the maps as hash tables
notebook is 4.4× the ideal at 3000 notes (510 ms against 117), and no one
place stands out: the garbage collector 14%, listing a table's entries
the first time 5%, a put's write 4.5%, the sort's merges 3.6%. A frozen
form (sorted arrays) would take the listing and some of the writes, about
10%, so C59 stays P3.
 The index
is built in one pass (`index of`, one holder all the way) and then only
read by 100 questions. Today each step of the build copies a path of the
tree and rebalances (build 8.5× the ideal), and each read walks the tree
again (`entries of` makes a list of it: N4). A representation for "built,
then frozen": filled in place while it has one holder (as N2), then kept
flat, a sorted array of keys and one of values (C59, FlatBuffers-like),
where `entries of` is the array itself and `value at` a binary search. This
is the program C59 asked for; measure C59 on it.

**N4. `entries of` and `keys of` made into a list only to be walked once
(perf, small).** `credit` walks `entries of(postings(t))` once, front to
back; `find hits` keeps over `keys of(…)`; `seen with` walks a note's
`entries of`. On the trees each one is `tree_list`, a whole new list per
call. *Fix:* where the list is consumed once by a fold or a structural
recursion, walk the tree in order instead (the representation's own fold,
ROADMAP 5's folds as representations; M3's `heads` did this for the first
item only). *Measured* from the profile: `tree onto` 6% at 3000 notes, and
part of the GC. **Hash-table side done (C72, #947):** once C71 made the
maps hash tables, sorting them for `entries of` was 34% of the run; each
version now keeps its sorted list the first time it is asked for (a
version never changes), and notebook's table run at 3000 notes went from
700 ms to 510 (median of 21). The trees' side, walking in order, is open.

**N5. Top five of a full sort (perf, both sides).** `hits text` takes 5
of `ranked`, which sorts every hit. The ideal does the same, so it is not
in the ratios, but a `take(sort by(xs, key), k)` is a selection: a heap
of k, n log k. A law the compiler reads, as M3 did for the smallest item.
Small here: the sort and its key closures are 5%. **Checked, put back
(C73, 2026-11-01):** a law for `take(sort by(xs, key), n)` was written and
gave the sort's answers, ties included, but notebook never writes that
shape where it counts: `hits text` takes 5 of a list `ranked` sorted in
another definition, and notebook uses its own Int `take`, not the
prelude's. Reading it there needs inlining across definitions first, for
a few percent, so the law isn't kept; C73's row in DONE.md says how it
went, for when a program writes the shape directly.

**N6. The evaluator (not the compiler's).** 3.2 s for 100 notes as
defined; the profile is the evaluator's own machine (`go`, `step`,
`resume`, `refValue`: about half). This is BACKLOG L118c (closure
compilation), now with a program a user would write: the editor's Run of
`main` on a notebook of a few hundred notes takes several seconds even with
the trees.

### Language gaps

Where notebook defines a helper only because the language lacks something
(WORKFLOW.md, "Language gaps, every round"):

- **NG1. No case folding or character classes.** `lower`, `wordy` and
  `between` (three definitions) exist to make `Cities` into `cities` and
  to keep letters, digits and apostrophes, by character codes. A
  `lowercase(text)` (and `uppercase`), and `is letter` / `is digit`, would
  say it. calc writes its own `digit` and `letter` by comparing texts, so
  this is the second program to work around it.
- **NG2. No `starts with` or `ends with`.** `ends with` is written with
  `length` and `slice`; `blank` tests `slice(line, 0, 1) = "#"`. Routes'
  `blank` does the same.
- **NG3. No `take` (or `drop`).** `take` is written to keep the best five.
- **NG4. `sum` is Float64 only.** `total` adds up Ints. One `sum` for every
  number type, as `+` is (NUMBERS.md "One `+`"), would remove it.
- **NG5. A lookup the program knows will succeed.** `seen with` reads a
  note it has just found in the postings and still has to say what to do
  if it isn't there (`abort("the index has lost a note")`). No row: two
  maps kept in step is an invariant the language can't state, and the
  Abort is honest.

### Proposed order

1. N1: a small change in library-reps.ts, and the largest gain (up to 25×
   here). Any program that maps over a list of pairs holding a map loses
   the trees today.
2. N2, the table per value: the next 2× or so here, and it is what C56
   and C62 need anyway.
3. N3 with C59: measure flat frozen maps on this program once N1 and N2
   are in.
4. N4 and N5 after those, when they can be measured above the noise.

These are BACKLOG rows C70 (N1), C71 (N2), C72 (N4) and C73 (N5); N3 is
added to C59. NG1 to NG4 are L133 to L136.

## Round 7: sheet, written in the editor (2026-11-02)

`ters/examples/sheet` is a small spreadsheet. It reads a file of cells,
one per line (`B2 = A1 * 12 + max(A1:A3)`), parses each formula, works
out every cell once, finds cycles, and prints the sheet as a grid and
the cells that went wrong. It also writes a report beside the file, each
formula as it was read with its value, so it is the first round to write
a file.

```
$ node ters/cli/lab.ts run ters/examples/sheet ters/examples/sheet/budget.txt
           A       B       C       D
   1    1200   14400     750  #cycle
   2     450    5400     820  #cycle
   3     380    4560     676  #div/0
   4    2030   24360    -670  #parse
line 14: D1 is #cycle
line 15: D2 is #cycle
line 16: D3 is #div/0
line 17: D4 is #parse
$ cat ters/examples/sheet/budget.txt.out
A1 = 1200 → 1200
...
C2 = (MAX(A1:A3) - MIN(A1:A3)) → 820
D4 = ? → #parse
```

It has 90 definitions, against notebook's 51: 6 types (`Token`, `Expr`,
`Parsed`, `Many`, `Value`, `Entry`) and 84 functions. A tokenizer over the
characters, a recursive-descent parser of eleven mutually recursive
definitions (sums, products, unary minus, brackets, cells, spans `A1:B3`
and calls `SUM(…)`), cell names and spans, a depth-first evaluation that
threads a `Map Text Value` of results and a `Set Text` of the cells on
the way (a cell met again on the way is a cycle), errors as values
(`ok(n)` or `error(reason)`) that pass through arithmetic, five functions
over spans, and the grid, the problems and the report. `Choice` comes in
through reading numbers, cell names and the parser, and is handled per
formula (`first`); `Abort` only for a line with no `=`. The program is
original; spreadsheet evaluation and recursive descent are common
knowledge.

**This round was written in the editor, not with the DSL.** Ersagun's
ask for the round was that it mainly show what is hard or impossible to
write in the editor. Every definition was made in the built editor
(`npm run build-editor`, opened from disk in headless Chromium, the same
page the site serves): *+ New definition* for functions, values and the
six data types (cases and fields through the type's panel), the palette
for every fill (typed expressions where the palette reads them, picks
where it doesn't), `match x · T` from the palette, *Give … its own body*
on a case, *Clear it*, *Let it loosen*, *Add a value before this…* and
the dot's *Name* for `run`'s steps, *Add the input* for main's arguments,
and *Save file*, then `examples/unpack.ts`. Nothing was edited by hand.
It took about 160 fills, picks and menu gestures plus 96 cases given
their own body. The driver script and the saved file are in the
project's files (`gaps-round7/`). What the editor made hard is below the
compiler's gaps.

The program lived in `compiler/gaps/sheet` at first: among the examples,
`ters/test/modes.test.ts` "forward, a definition ends exactly when the
checker finds no Diverge of its own" failed, because the checker typed
`show formula` and `shown args` as Diverge where the modes see them end
(SL1 below). With that fixed (L146), it is in `ters/examples/sheet`.

Files:
- `compiler/gaps/sheet.ideal.js`: the hand-written ideal, with the gaps
  marked (S1 to S4 there are this round's S-numbers).
- `compiler/gaps/sheet.ts`: five ways in one process (the evaluator and
  the compiled code, as defined and as `lab run` stores it, and the
  ideal) with files kept in memory, and a generator of sheets.
- `compiler/test/sheet.test.ts`: all five agree on output, report and
  exit code, failures included.
- `compiler/gaps/bench-sheet.ts`: the table below.

### Results

```
sheet               evaluator  evaluator,  compiled  compiled,   ideal  chosen/
                               chosen                chosen              ideal
50 rows, 300 cells    2822 ms    1485 ms     43 ms     26 ms    3.7 ms     7×
200 rows, 1200 cells 33731 ms   14858 ms    453 ms    235 ms    8.0 ms    29×
1000 rows, 6000 cells (skipped) (skipped)  stack overflow     41 ms
3000 rows            (skipped) (skipped)  stack overflow    126 ms
```

"Chosen" is the program as `lab run` and `lab compile` store it: Map as
the hash table, Set as the weight-balanced tree. Each generated row is six
cells (an amount, a running total, sums, maxima and averages over a
window of rows, a share that is sometimes divided by zero), one row in
fifty has a cycle and one a formula that can't be read. All five ways
agree wherever they run.

From the command line (`lab compile`, then `node sheet.mjs file`, with
`--stack-size=60000` so it gets past S1), best of three:

```
rows   compiled   by hand: S2 hoisted   ideal
  50     218 ms        193 ms           45 ms
 200     461 ms        263 ms           57 ms
 500    1329 ms        386 ms           83 ms
 800    3663 ms        454 ms          106 ms
```

The compiled module is 3.4 MB (113,000 lines) for 90 definitions, and
its start-up is most of the 50-row time. A profile of the compiled
program at 300 rows (runtime only, 468 ms a run): `grid` 42% of it, of
which `columns used` 28% and `width of` 13% (S2); `set tree of items`
22% inside those two; `evaluate all` 13%; the garbage collector 10%.

### The gaps, ranked

**S1. A `map` that can't fail, inside a `first`, is compiled as a search
(correctness: stack overflow from about 6,000 items).** `width of` is
`2 + first(() => largest item(as set(map(values of(results), (v) =>
length(show value(v))))), () => 0)`. The lambda performs nothing; only
`largest item` has no answer for an empty set. The compiler puts the
whole `map` in Choice's mode because it is inside `first`'s scope, and
emits `map$choice$arr$k`: a generator and a continuation per item, and a
JS frame per item. At 1000 rows (6000 results) it runs out of stack,
in the harness and in `lab compile`'s output alike (G1's big stack didn't
save it here). `cells between` has the same shape with a lambda that can
fail (`row of`), where the search is right but still a frame per item.
*Fix:* type-directed: a call whose function argument's row has no Choice
is compiled in its plain mode whatever handler it sits under; and make
`map$choice`'s one-answer case a loop. *Measured:* every run past 1000
rows fails today. *Fixed (C80):* the copy is plain when
the lambda makes no choice; 3,000 rows (18,000 cells) run. `map$choice`'s
one-answer case is still a frame per item where the lambda can fail.

**S2. A pure call that doesn't depend on a lambda's input is worked out
again on every call of the lambda (perf: the program quadratic).** `grid`
is `cons(header(columns used(sheet), width of(results)), map(numbers
from(1, last row(sheet)), (r) => grid row(r, columns used(sheet), width
of(results), results)))`. `columns used` and `width of` walk every cell,
and run once per row. The ideal works them out once. The program was
written this way because typed text has no `let` (E178 below): naming the
two needs *Add a value before this…* and the dot's panel, which is a lot
to do for a reader who just wants the value twice. *Fix:* hoist a call
with no effects whose inputs are all bound outside the lambda out of a
lambda handed to `map`, `keep`, `for each` (loop-invariant code motion;
in GHC it is the full-laziness transformation, prior art). *Measured* by
hoisting the two calls by hand in the compiled module: 800 rows 3663 →
454 ms, 500 rows 1329 → 386 ms; the ideal is 106 and 83 ms. *Fixed (C81, compiler/src/hoist.ts):* as the
chooser stores it, 800 rows 1622 → 142 ms on the same machine (ideal 31).

**S3. What's left after S2: about 4×.** The results are a persistent
hash table threaded through every cell (C71's rerooted versions), and the
cells on the way a weight-balanced tree; `as set` then `items of` and
`largest item` sort through a tree to drop duplicates; tokens are a list
of one-character texts (the program reads `characters(text)`, the ideal
walks the text once). None stands out alone; measure again after S1 and
S2, with C59 and C62 in mind.

*Measured again after S1, S2 and S4 (C82b, 2026-11-02):* 2,000 rows
(12,000 cells) in about 340 ms against the ideal's 60 to 85 (a busy
machine), about 5×. A profile of the run: `evaluate all` 33%, of which
reading each formula (`formula of`, tokenizing and parsing) 21%; `cells
between` 16%; the garbage collector 20%. The tokenizer was a search: `classify` (a number or a word, or
no answer) calls `uppercase`, whose row is open only so its caller's row
can stand there, and the compiler counted that as a call that may
choose, so `classify`, `flush` and `tokens` each took the rest of the
search as a continuation, a closure per character. *Fixed (C82b,
compile.ts `ownsNoChoice`):* they are one-answer functions now, and
`tokens` went from 21% of the run to 9%. Left: `cells between`'s `map`
over a lambda that can fail (`row of`) is still a search with a JS frame
per item (S1's rest), though a map whose lambda has at most one answer
has at most one answer itself (C84).

**S4. Start-up.** 3.4 MB of JavaScript for a 90-definition program: the
module carries the library it doesn't use, and at 50 rows start-up is
most of the time (218 ms against 45 ms). Emit only what `main` reaches.

**S5. The evaluator (not the compiler's).** 34 s for 200 rows as defined,
15 s as chosen: the editor's Run of a definition over a sheet of a few
hundred cells takes tens of seconds. L118c again.

### What the editor made hard

In the order they cost time. Each is a BACKLOG row (E173 to E184).

1. **Typing in the palette freezes the editor (E173).** The palette reads
   what's typed on every keystroke and on every redraw. Typing the 81
   characters of `"line " ++ show(e.line) ++ ": " ++ e.name ++ " is " ++
   cell text(results, e.name)` one key at a time took 114 s: the last 40
   keys took 96 s, 2.4 s a key. With a refused expression left in the
   search box, one click on another definition took 89 s to open it (the
   next click: 0.1 s). Fills that are pasted whole take 0.5 to 1.5 s.
2. **A refused expression never says why (E174).** Every refusal of
   typed text reads "Nothing that fits matches. Values and arithmetic can
   be typed too…", whatever the reason: a definition that doesn't exist
   yet (`more terms`), a type that doesn't fit, a type held while the
   definition has a hole, a name bound in only some cases. `fillValue`
   has the reason (I115's "there's no function named …"); the palette
   shows it only for a missing interface.
3. **A name with several meanings is settled once, when typed, and then
   blocks later edits (E175).** `show(n)` with nothing else about `n`
   takes Float64's `show`, so `n` becomes Float64, and the later
   `entry(…, n)` (an Int field) is refused. `show(n + 0)` is still
   Float64's: the meanings are tried one by one, each with the literal
   first as Int, then as any number, and Float64's comes first. Only a
   palette pick of the Int row gets Int's `show`. `length(show value(v))`
   typed while `show value` was a stub took the List's `length`, and
   filling `show value` with text was then refused, silently, from
   another definition. `range` is Float64-only (L147), which makes
   `spaces` and `padded` Float64 too.
4. **More than 16 readings and the right one is never tried (E176).**
   `readings()` keeps the first 16 combinations. `.name` is a field of
   three cases (Entry's, `cell`'s and `call`'s), `show` has three
   meanings and `++` more than one, so the line in item 1 is refused
   though each part is accepted alone. Written as two definitions
   (`problem line`, `what is wrong`) it goes in.
5. **A fresh match reads as one case (E177).** Picking `match chars ·
   List` gives `match chars / otherwise → □` in the text: one hole that
   stands for both cases, so the first fill is made in both ("Made in
   all 2 places"), and `cons`'s binders (`head`, `tail`) don't show until
   *Give cons(head, tail) its own body* on the right-click menu. The
   graph draws the two holes apart, so the two views disagree about
   what's there. The shared hole's scope is only what every case binds:
   `text`, bound in `word` and `symbol` but not `number`, is refused
   (silently, item 2). 96 of this program's cases were split this way.
6. **Two `print`s, and one of them doesn't run (L145).** The palette
   lists `print(□: Text) (Text) -[Console]-> Unit` twice, the same label
   and type. Typed `print("usage: sheet <file>")` in an action took the
   second, Console's operation, which type-checks with Console, but
   `lab run`, the evaluator and the compiled code all stop with "nothing
   handles print". Picking the first row from the palette fixed it.
7. **Typed text can't write what the text prints (E178).** The Blocks
   text prints `first(x, else y)`, `[name]` and steps; the palette reads
   only `first(() => x, () => y)`, lists of literals (`[k]`, `[show(1)]`
   are refused), no `let` (a value used twice needs *Add a value
   before this…*, then naming the dot in its panel), no `□` to leave a
   hole for later, no `match`. Building `abort("line " ++ show(n) ++
   …)` with Int's `show` took seven palette steps.
8. **Clearing to fix a mistake keeps the mistake (E179).** *Clear it*
   holds the definition's type while it has a hole, so the corrected
   body (`numbers from` held at Float64) is refused without a reason.
   *Let it loosen* is on the hole's panel only; reloading the page drops
   every hold without saying so.
9. **Mutual recursion needs stubs made first (E180).** A typed call to a
   definition that doesn't exist yet is refused (silently, item 2). The
   parser's eleven definitions were made empty first and filled after.
   No "make a definition named this" from the palette.
10. **Smaller ones (E181 to E184).** A function made with no inputs is an
   action `() -> Set Text`, not a value, and can't be turned into one
   (`has item(symbols, c)` refused; `symbols()` needed). A definition of
   one's own named like a library one (`values of`) silently wins in
   typed text. Steps added as values read `‹•1› = for each(…)` in the
   text, not as steps. Adding a case to a data type selects the new
   case, so the next one needs the type selected again; a whole infix
   body (`a + b`) is selected only by clicking its operator.

### Language gaps

Where sheet defines a helper only because the language or the editor
lacks something (WORKFLOW.md, "Language gaps, every round"):

- **SL1. Recursion through `map` over a case's list field is typed
  Diverge.** `show formula(call(name, args))` calls `shown args(args)`,
  which maps `show formula` over `args`: it ends (the modes say so), but
  the checker types both, and `report line`, Diverge. This is what keeps
  sheet out of `ters/examples` (above). L146.
- **SL2. No Int `range`.** `range` is Float64, so `numbers from` and
  `spaces` are written as recursions (and typed Diverge). With L140.
  L147.
- **SL3. No flatten (or flat map) for lists.** `flattened` (`joined` is
  HTML's). L148.
- **SL4. No padding or repeating a text.** `spaces` and `padded`. With
  SL2 they'd be one line each. L148.
- **SL5. Nested matches on the same type clash binder names.** `match
  a / ok(number) → match b / ok(number) → …`: the inner `number` hides
  the outer, so `arithmetic` calls a helper `with left` to keep the left
  value. The binders can be renamed in the editor, one by one; no row,
  but E177's split could name them apart.
- **SL6. One definition per shared value.** `problem line`, `what is
  wrong`, `with left`, `joined`, `negated`, `closed`, `called`,
  `settled`, `with formula`: nine of the 84 functions exist to give a
  value a name or to dodge E176, where a `let` typed in the palette would
  do (E178).

### Proposed order

1. E173 and E174 first: the freeze and the missing reasons cost more
   than everything else together, and every program written in the
   editor meets them.
2. L145: a program that type-checks and stops at run with "nothing
   handles print" is a soundness bug.
3. S1 (C80): every sheet past a thousand rows fails.
4. E175, E177, E176, then the rest of the editor's.
5. S2 (C81), then S4 (C82); S3 when S1 and S2 are in.
6. SL1 (L146), so sheet can join the examples; SL2 to SL4 (L147, L148).

## Round 8: board, a page written in the editor (2026-11-02)

`compiler/gaps/board` is a task board: a page with three columns (To do,
Doing, Done) of cards. A card has a title, points, tags and the time spent
on it. Cards are added through one field (`Fix the timer #code #ui +3`
reads as a title, two tags and three points), moved left and right,
renamed in place, given more or fewer points and deleted. Every edit is
kept in a history and can be undone and redone (buttons, or the keys z and
y). A tag's chip filters the board, a search field filters by title, and
the counts and points of each column and a progress bar follow the
filter. A focus timer counts down 25 minutes on one card, a frame at a
time, and adds the time to the card. The board is saved to a file and
loaded back, and a button picks a random card to do next.

It is the first round that is an interactive app: cells, formulas,
`for each` rows, event handlers (click, input, change, keydown), frames
(state over time), files and Random. It has 112 definitions, against
sheet's 90: 9 types (`Stage`, `Card`, `Board`, `Edit`, `History`,
`State`, `Filter`, `Timer`, `Quick`) and 103 functions and values. The
state is one cell holding a `State` (the board and the history); each edit
is an `Edit` value (`added`, `removed`, `moved`, `renamed`, `pointed`)
that `applied` and `unapplied` run forwards and back. The filter, the
timer, the quick-add field and the note under the buttons are cells of
their own. The program is original; a task board with columns, undo
through a list of edits and a countdown are common knowledge.

**It was written in the editor**, as round 7 was: the built editor
(`npm run build-editor`) opened from disk in headless Chromium, every
definition made with *+ New definition* and the palette (typed text where
the palette reads it, picks where it doesn't), `match x · T` from the
palette with *Give … its own body* and *Replace with…* for the cases,
*Clear it* and *Let it loosen* to fix a wrong type, *Add a value before
this…* for a handler's first step, the case panel's *Name* to rename a
case, and the program's *Title*. Nothing was edited by hand. About 120
typed fills, 25 matches (68 cases), 4 steps added and 7 bodies cleared and
written again. The page ran in the editor's Run panel throughout, and was
clicked through there (add, move, filter, undo, focus, save, pick, rename;
screenshot and driver scripts in the project's files, `gaps-round8/`).
*Make it a function* was tried on two picked calls (`percent done` and
`points at` in `progress text`): it made a part with two results read as
`results.‹value 1›` and `results.‹value 2›`, and was undone.

Files:
- `compiler/gaps/board/`: the program as the editor saved it
  (`examples/unpack.ts`).
- `compiler/gaps/board.ideal.js`: the hand-written ideal, the same page by
  hand over the same document interface (B1 and B2 marked there).
- `compiler/gaps/board.ts`: three ways in one process (the evaluator and
  the compiled page drawn into the fake document of `test/fakedom.ts`,
  and the ideal), a scripted session of fifteen phases, files in memory
  and Random from a fixed sequence, frames at 60 a second.
- `compiler/test/board.test.ts`: the three draw the same page at the start
  and after every phase.
- `compiler/gaps/bench-board.ts`: the table below.

### Results

The session: `n` cards added through the field; ten moved to Doing; one
given three more points; one renamed; the board filtered by a tag and
back; searched and cleared; five undos and two redos; the focus timer on
a card for 120 frames, paused for 10 and stopped; 120 frames with no
timer; saved and loaded; a random pick; five cards deleted. All three
ways draw the same page after every phase.

```
cards  way        whole session  add, per card  frame   idle frame
   50  evaluator        851 ms       3.30 ms   3.92 ms   0.03 ms
   50  compiled          88 ms       0.34 ms   0.43 ms   0.01 ms
   50  ideal           4.71 ms       0.01 ms   0.00 ms   0.00 ms
  200  evaluator       3377 ms       6.75 ms     13 ms   0.09 ms
  200  compiled         337 ms       0.94 ms   0.63 ms   0.06 ms
  200  ideal             19 ms       0.02 ms   0.00 ms   0.00 ms
 1000  compiled        4241 ms       3.63 ms   1.81 ms   0.43 ms
 1000  ideal             96 ms       0.01 ms   0.01 ms   0.00 ms
 2000  compiled       15707 ms       7.11 ms   4.09 ms   1.40 ms
 2000  ideal            194 ms       0.01 ms   0.02 ms   0.00 ms
```

Best of three, one process (`node compiler/gaps/bench-board.ts 50 200
1000 2000`); the evaluator is skipped past 200 cards.

"Add" is one card through the field, Enter included; "frame" is one frame
with the timer running (the card's time and the timer's line change);
"idle frame" one with no timer. The compiled module is 58 KB (C82 keeps
only what main reaches).

Loading a saved board of `n` cards and running the timer on its last card
for 60 frames (compiled, once each, the ideal in brackets):

```
cards   load              60 frames, timer running
 1000    150 ms (15)       275 ms (5)
 2000    270 ms (25)       436 ms (11); the timer's line stays "No focus timer running" (B3)
10000   1037 ms (133)     1225 ms (54), and a RangeError in the console each frame
30000   5153 ms (406)     6251 ms (100)
```

A profile of the compiled page at 1,000 cards: in 300 adds, the cells'
`recompute` 46% of the time by itself (formulas run again and their old
and new values compared), the three columns' `shown cards` and the rows'
matching most of the rest; in 600 running frames, `recompute` 33% and the
garbage collector 9%; in 2,000 idle frames, `recompute` 35% and `write`
13%, comparing a state with itself.

### The gaps, ranked

**B1. An unchanged write compares the whole value with itself (perf,
every page).** Each frame, the timer's handler writes the state:
`write(stc, spent for(read(stc), read(timer), dt))`. With no timer
running, `spent for` gives back the very state it read, and the write
walks it twice to find it equal (`plainOf`, then `$eq`), because `$eq`
compares a pair of objects field by field even when they are the same
object. 0.43 ms an idle frame at 1,000 cards, 1.4 ms at 2,000, against 0.
*Fix:* `$eq` (and the evaluator's `equal`) skip a pair that is the same
object, and a write of the value the cell already holds returns at once.
*Measured* by adding `if (x === y) continue;` to `$eq` by hand: 2,000 idle
frames at 1,000 cards 564 → 4 ms, 600 running frames 985 → 738 ms (the
history and the parts of the board a frame doesn't change are shared). C85.

**B2. A write of a whole new value wakes every reader of the cell (perf:
state over time).** A running frame changes one card's time, but the
state is one value: the three columns' `shown cards` formulas run again
and their lists of cards are compared, `for each` matches every row, and
the headings, the progress, the tags and the history run again. 1.8 ms a
frame at 1,000 cards, 4.1 ms at 2,000, about 20 ms at 10,000 (more than a
frame's 16.7 ms) and 100 ms at 30,000, against the ideal's 0.01 to 1.7,
which changes two texts. Adding a card is the same shape: 3.6 ms at 1,000
cards and 7.1 ms at 2,000 against the ideal's 0.01, which appends one row
and counts on (`append` copies the list; every column's cards, every tag
and the progress are worked out again). The language has the other way already, `write at` a path (L98), but
a path to a list item is by its position, and the program's edits are
whole values (`applied(board, edit)`), as undo wants them. *Fix,* two
halves: the runtime compares the old and the new value once, skipping
what they share, and wakes only the readers of the places that differ
(Solid's `reconcile`, which diffs a new immutable value into a store and
notifies only the changed paths, is prior art), C86; and a path to the
list item with a given key, so a handler can write one card's field (Solid
stores' path filters, `setState("todos", t => t.id === id, "done", true)`,
prior art), L160.

**B3. A one-answer search down a list whose result is taken apart is a
generator per item (correctness: stack overflow from about 2,000
items).** `card of(cards, id)` is a recursion: `nil → fail()`, `cons →
if head.id = id then head else card of(tail, id)`. Where `card name`
reads `card of(b.cards, id).title`, the compiler makes `card_of$fields`
(the result's fields handed back in `$got`): each level is a `function*`
whose body calls the next level, rebuilds the card from `$got` and yields
it. Two JS frames and a card a level. From about 2,000 cards, a card near
the end overflows the stack: clicking Focus on it writes the timer, but
the timer's line throws a RangeError (logged to the console, every frame)
and keeps saying "No focus timer running". The ideal is a loop. *Fix:* a
one-answer recursion whose recursive call is the case's answer is a loop,
as `read words` already is (the `for (;;)` with its inputs rebound), with
`$fields` or without. C87.

**B4. A `first`'s fallback is worked out before it's needed (perf,
small).** `take word(q, w) = first(with tag(q, tag word(w)), else
first(with points(q, points word(w)), else with word(q, w)))` compiles to
`const with_word_once = with_word(q4, w3)` before `points_word` is tried:
`with word` builds a new `Quick` for every word, the ones that are points
included. Pure and total here, so only waste, but the fallback is a
lambda that runs only when the search has no answer; it shouldn't be
moved out of it. C88.

**B5. The evaluator (not the compiler's).** 3.3 ms a card added at 50
cards and 6.8 ms at 200, 13 ms a frame at 200 cards: the editor's Run panel
draws the page with the evaluator for the first few seconds (I109's
hand-over), and at a few hundred cards a frame there takes most of the
frame's time. L118c again.

### What the editor made hard

In the order they cost time. Each is a BACKLOG row (E185 to E192).

1. **A field read on an input nothing has settled takes the first type
   with that field, silently (E186).** `Quick` and `Card` both have
   `title`, `tags` and `points`. `with tag(q, word) = quick(q.title,
   append(q.tags, [word]), q.points)` went in as `(Card, Text) -> Quick`;
   nothing said so, and the refusal came two definitions later, in `read
   words` ("read words needs Card here, got Quick"). `new card(b, q)` the
   same. Fixed by clearing the body, *Let it loosen*, and `match q · Quick`
   to name the type. (`length(w)` in a stub likewise took List's length
   though its one caller passes a Text.)
2. **A value definition named inside a call is refused with "points at
   nothing" (E187).** `cell(state(starting board, history(nil, nil)))`,
   `tag("main", [styles, …])` and `file exists(save name)` were refused
   with infer's "points at nothing", a reference to a node that isn't in
   the code; `cell(starting board)` and `write file(save name, …)` went
   in. main was written with two `□`s and the names filled in alone; the
   file's name is written out twice instead of using `save name`.
3. **The comparisons read as the hidden Float64-only ones (E185).**
   `length(w) > 1` is refused: "more than needs Float64 here, got Int".
   `>`, `≥` and `≤` (and `>=`, `<=`) read as the prelude's old Float64-only
   `more than`, `at least`, `at most`, kept hidden so old files open. Written
   as `not(w = "#")`.
4. **A match's cases after the first are one hole that can't be split
   (E189).** After the first case is filled the rest read as one
   `otherwise → □`, and a hole has no *Give … its own body*; its scope is
   what every case binds, so a body using a case's own fields is refused
   ("nothing is named id here"). Each match of cases with different
   fields took a placeholder in the otherwise (`b`, `""`, `true`), then
   *Give … its own body* and a fill per case, then *Replace with…* on the
   last case, which is no longer under the otherwise. A case given its own
   hole goes back under `otherwise` in the text if the next one is split
   before it's filled.
5. **Names that read as something else (E188).** The case `done` of
   `Stage` can't be typed (std's `Outcome` has `done(value)`): "nothing
   is named done here", and `[todo, doing, done]` is refused with the
   generic message; it was renamed `finished`. Bare `unit` is the vectors
   module's `unit` (normalize): "this case: expected (a) -[Choice]-> a,
   got Unit"; `unit()` works. `random()` reads as the function `() -[Random]->
   Float64`, so `random() · n` is refused ("multiply needs Float64 here, got
   () -[Random]-> Float64"); `□ · n` was typed and `random()` picked from
   the palette into the hole.
6. **No sequence of actions in typed text (E190).** `write(a, x); write(b,
   y)` is refused ("no case named write at 6"). Four handlers do two
   things; each was written as its last action, then *Add a value before
   this…* for the first (*Add a step before this…* isn't offered on a
   one-call body).
7. **Smaller (E191, E192).** `≠` and `!=` aren't read: "there's no field
   named id ≠ id" (the field read takes the rest of the line as the
   field's name); `not(a = b)` instead, and the language has no ≠. After
   *Clear it* and *Let it loosen*, the palette's case analysis still offers
   only the old type (`match q · Card`) until the callers change. `1500.0`
   typed is any number, not a Float64.

What went well, for the record: every view and handler (lambdas, `on`,
`property`, `text`, `part`, `for each`, `formula`) went in typed whole,
first time, once the names above were avoided; the page drew in the Run
panel at once and stayed live while editing; `first(…, else …)`, lists of
expressions, `□` and `name = value; rest` (E178) carried most of the
program.

### Language gaps

Where board defines a helper only because the language or the library
lacks something (WORKFLOW.md, "Language gaps, every round"):

- **BL1. No whole number from text.** `digit of`, `digits value` and
  `whole number` (three definitions) read `+3` and the saved file's
  numbers. L161.
- **BL2. No search in a list.** `card of`, `position of`, `tag in` and
  `largest id` are recursions: `has item` and `find` are Set's and Text's,
  and there's no largest of a list. L161.
- **BL3. No Float64 to Int.** `floor` gives a Float64, so picking a random
  card is `nth card`, a recursion on a Float64 index, and `random below`
  exists to get `random()` in at all (E188). L161.
- **BL4. No `++` on lists, no `≠`.** `inserted` is two appends; `not(a =
  b)` everywhere. L161, E191.
- **BL5. No path to a list item by key.** One card's time is written by
  rewriting the whole state each frame (B2). L160.
- **BL6. Undo written twice.** `applied` and `unapplied` are ten cases,
  each the other's inverse by hand. The language runs functions backwards,
  but `removed`'s position and `moved`'s stage are what the edit records,
  so `unapplied` isn't `applied` solved for the board; no row.

### Proposed order

1. C85 first: a one-line change that takes idle frames to nothing and a
   quarter off running frames on every page.
2. C87: a board of 2,000 cards fails silently today.
3. E186, E187 and E185: each cost a definition written again and a
   refusal that didn't say why; then E189 (25 matches) and E188, E190.
4. C86 with L160: frames and adds that grow with the board.
5. C88, L161, E191, E192.

## Round 9: machine, an assembler and interpreter on every target (2026-11-02)

`compiler/gaps/machine` is a small register machine and its tools. It
reads assembly (labels, `.data` and `.zero` for named memory, twenty-one
instructions over eight registers `r0` to `r7`: `set add sub mul div mod
load store jump jz jnz jlt jeq call ret push pop out outc halt nop`),
assembles it in two passes (labels, then the code with the labels
resolved), checks it (registers, jump targets, labels; and the lines
nothing reaches, found with a worklist over a `Set Int`), optimizes it
(constant folding, `x + 0` and `x × 1`, tests of numbers decided, jumps to
jumps threaded, a jump to the next instruction dropped, `push a; pop d`
and `store a b; load d b` paired, what never runs dropped, the nops taken
out and every jump renumbered, repeated until a round takes nothing out),
and runs the program as written and as optimized, step by step, to check
they print the same. It can print the listing, a trace and a profile (the
hot instructions and the mix of instruction names, from a count per
instruction kept as the machine runs).

```
$ node ters/cli/lab.ts run compiler/gaps/machine --profile compiler/gaps/machine/hello.asm
== compiler/gaps/machine/hello.asm
never runs: line 8
  Hello, machine!
12 instructions, 9 after optimizing (3 taken out)
steps: 132 as written, 100 optimized (24.2% fewer)
hot spots:
  17.0%  line 6    jlt r1 r2 4
  ...
mix: jlt 17.0%, load 17.0%, set 17.0%, add 16.0%, jump 16.0%, outc 16.0%
```

It has 141 definitions, against board's 112: 8 types (`Arg`, `Instr`,
`Item`, `Program`, `Machine`, `Options`, `Hot`, `Run`) and 133 functions
and values. Five programs for it come in the folder: `primes.asm` (the
sieve of Eratosthenes below 5000, in memory), `sort.asm` (400 numbers from
a linear congruential generator, insertion sorted, and a checksum),
`fib.asm` (the 20th Fibonacci number by the slow recursion: calls, returns
and the stack), `collatz.asm` (the longest Collatz chain from below 3000:
registers only) and `hello.asm`. The machine, its assembly and the five
programs are original; two-pass assembly, peephole optimization and jump
threading are common knowledge.

It was chosen to be what the compiler's representation stages (C30) are
for: the machine's registers, memory, code and profile counts are lists
read with `item at` and changed with `replace at` at every step, the way a
program written without arrays in mind would hold them. It was written
with the DSL, as round 6 was, since this round aims at the compiler and
its targets (the build script is in the project's files,
`gaps-round9/build.ts`); it checked on its first try.

Files:
- `compiler/gaps/machine/`: the program and the five `.asm` programs.
- `compiler/gaps/machine.ideal.js`: the hand-written ideal: the same
  program with arrays changed in place (M1 marked there).
- `compiler/gaps/machine.ts`: four ways in one process (the evaluator,
  the compiled code as `lab compile` stores it, the WebAssembly as a WASI
  command, and the ideal), and the programs at other sizes.
- `compiler/test/machine.test.ts`: the evaluator, the compiled code and
  the ideal print and exit the same, on the five programs, a listing, a
  trace, a profile and fifteen failures; the WebAssembly is a todo until
  M3.
- `compiler/gaps/bench-machine.ts`: the table below (C from `lab native`,
  or a binary given in `MACHINE_NATIVE` while M2 is open).

### Results

Every way prints the same and exits the same on every program and every
failure tried, once M2 and M3 are worked around by hand (one line each,
below).

```
program       steps   evaluator  compiled   wasm    native  ideal   compiled/ideal
fib 15        13811     2513 ms     10 ms    14 ms   17 ms   5.6 ms     2×
fib 24      1050343   (skipped)    501 ms   601 ms  582 ms   130 ms     4×
collatz 3000 1382338  (skipped)    747 ms   933 ms  827 ms   101 ms     7×
primes 500     7619     7384 ms     48 ms    99 ms   66 ms   0.7 ms    70×
primes 5000   82280   (skipped)   2197 ms  4605 ms 3892 ms   5.5 ms   400×
primes 20000 342983   (skipped)  47933 ms 63825 ms 62875 ms   43 ms  1119×
sort 400     357792   (skipped)   2356 ms  4016 ms 3013 ms    25 ms    94×
sort 1000   2231180   (skipped)  23199 ms 36686 ms 28160 ms  126 ms   183×
hello           132      195 ms    0.7 ms   4.2 ms  7.4 ms   0.3 ms     2×
```

Median of three in one process (`node compiler/gaps/bench-machine.ts`),
each run being the whole command: assemble, check, optimize, run both
programs. "Steps" is the program as written; the optimized run is about
10% fewer. `lab compile` chose the hash table for Map and Set and nothing
for List. The evaluator takes about 90 µs a step (L118c again).

Where the compiled code's time goes, by the profile: in `primes 5000`,
`stored` (a `replace at` on memory, inlined) 39%, `loaded` (an `item at`)
15%, the garbage collector 14%, `length` 8% (the memory's length, walked
again at every load and store to check the address); in `collatz 3000`,
which touches only registers, the step loop itself 23%, `set register`
8% and the collector 7%.

### The gaps, ranked

**M1. Lists read and written by position stay lists (perf: 400× to
1100× on memory, 7× on registers).** Every load walks the memory list to
the address, every store copies it up to there, and every step walks the
code to the program counter and the registers to the one it reads. The
chooser has `array of List` and `tree of List`, and picks the tree for
this program's lists, but it gives List up program-wide for each of three
reasons, all of which machine has (library-reps.ts `choiceOf`):
(a) a list of lists anywhere (`keyed`): `data values` flattens a `List
(List Int)` and `problems of` another; (b) another library type was
chosen first: lists become arrays only when nothing else does, and Map
and Set are hash tables here; (c) a value of a library type that holds a
list (`listBoundary`'s `libraryHolder`): the labels, a `Map Text Int`,
which as written is a list of entries, in `assembled`. And `array of
List` has no `replace at` job, so a write would still go through the list.
*Measured* by editing the compiled output by hand so that the machine's
registers, memory, code and counts are arrays (made when the machine
starts; `item at`, `replace at` and `length` on an array read it, copy it
with one item changed, or read its length):

```
                     as compiled   arrays, copied   arrays, in place   ideal
primes 5000            1740 ms         95 ms             90 ms         5.5 ms
primes 20000          47.6 s          7.2 s             0.11 s         43 ms
sort 400               2310 ms        130 ms            105 ms          25 ms
sort 1000             23.2 s          0.63 s            0.26 s         126 ms
collatz 3000            640 ms        315 ms            295 ms         101 ms
```

(whole command, less the 290 ms that `hello` takes: starting node and
assembling). "In place" changes the array a write is given: each run's
machine is the only holder of its memory, so no one can see it change.
*Fix:* choose a representation per value, or at least stop one list of
lists, one Map or one other choice from deciding for every list (the same
shape as C70 and C71 for maps); give `array of List` a `replace at` job
(one copy); then in place where a value has one holder (C56). C93, part
of C30.

**M2. The C output doesn't build (correctness: `lab native` fails).**
`listing` numbers the pairs of instructions and lines, so `numbered` is
lowered at `(Int, (Instr, Int))`, an unboxed pair holding an unboxed
pair. The C declares `Tuple2_3 { lab_int f0; Tuple2_4 f1; }` before
`Tuple2_4`, and `Tuple2_3_dup` before `Tuple2_4_dup`: six errors, the
first "unknown type name 'Tuple2_4'". Moving the inner pair's typedef and
its dup, drop and dec above the outer's by hand, it builds and agrees with
the ideal everywhere. *Fix:* emit tuple typedefs and their helpers in the
order they hold each other. C91.

**M3. The WebAssembly doesn't load (correctness).** `WebAssembly.compile`
refuses the module: "Duplicate export name 'length(List)'". A generic
definition lowered at several types is exported under its name once, then
under its name with its parameters' type names (wasm.ts `exportName`),
and `length` at `List Instr` and at `List Int` both read `length(List)`.
Adding the function's index to the second name, it loads and agrees
everywhere. *Fix:* names that tell the types' arguments apart, or a
counter when two collide. C92.

**M4. In C, a record read after a call is shared during it (perf,
native).** `stepped(code, m)` is `executed(item at(code, m.pc), m)` and
then reads `m.pc` again to count the step; the C passes
`Machine_dup(p1)` to `lab_executed`, so the registers, memory and stack
lists have two holders while the instruction runs, and the reuse of a
cell with one holder (`rc == 1`) can't happen in `replace at`. Native is
slower than the compiled JS on every program here (fib 24: 582 against
501 ms). *Fix:* read the fields a function still needs (an Int here)
before handing the record on, so the call gets the only reference
(Perceus's borrowing and drop specialisation, Reinking, Xie, de Moura and
Leijen 2021, prior art, already credited for C56). Not measured. C94.

**M5. Two records a step (perf, small).** `executed` builds a new
`Machine` for each instruction, and `stepped` at once copies it with the
step counted (and the profile count changed). The first has one holder
and is never seen again: it could be changed in place. *Measured* on top
of the arrays in place, by setting the two fields on `executed`'s record:
collatz 3000 295 → 210 ms, primes 5000 90 → 50 ms. C95.

**M6. `lab check` hashes every input order (tools).** `lab check
compiler/gaps/machine` takes 10.9 s (sheet 4.5 s), against 2.9 s for `lab
compile`: 77% of it is `orderFreeHash` (modules.ts), which for "same as
another definition up to the order of its inputs" hashes every
permutation of every definition's inputs, up to five (120 orders), each
time copying the program's whole node table. machine has many
definitions of four and five inputs. *Fix:* one hash with the inputs as
a multiset where the body allows it, or hash each order without copying
the table. C96.

### Language gaps

Where machine defines something only because the language or the library
lacks it (WORKFLOW.md, "Language gaps, every round"):

- **MG1. A type's fields by their type.** `Instr` has 21 cases. Seven
  definitions match all 21 only to reach the `Arg`s in them or the
  case's name: `args mapped` (an instruction with a function applied to
  every `Arg`), `problems of`, `threaded`, `moved`, `targets`,
  `disassembled`, `op name`. The DSL wrote them with a loop; in the
  editor they are 147 cases. A map and a fold over every field of a given
  type, in any case, and a case's name as text, would make each one line.
  Prior art: Haskell's `deriving Functor`, GHC Generics and "Scrap your
  boilerplate" (Lämmel and Peyton Jones, 2003) for the first, `showConstr`
  in Haskell's Data.Data for the second. L162.
- **MG2. A value with one place changed.** A step changes one or two of
  `Machine`'s eight fields, and every change writes all eight out
  (`mwith` in the build script, twelve places), and a register write is
  `replace at` on a field of it. Paths exist (`path`, `item path`, `then
  path`), but only `write at` on a cell uses them. A `changed(value, path,
  part)` for any value would be one call, and would tell the compiler
  which field changes. Prior art: lenses (van Laarhoven; Kmett's `lens`),
  and OCaml's and Elm's `{ r with f = v }`. L163.
- **MG3. Library.** `zipped` (no zip), `numbered` (no list of positions
  and items), `zeros` (no list of n copies: `repeated` is Text's), `all
  digits` (no "all" or "any" over a list); and `instruction of` is a
  21-way `if op = "set" … else if …`: no match on Text values. L164.

### Proposed order

1. C91 and C92: the C and WebAssembly ways fail to build or load; each is
   small.
2. C93: lists as arrays (and the tree) for a program like this one; the
   chooser's three refusals first, then `replace at` on arrays. It is the
   largest gap any round has measured.
3. C94 and C95, then C96.
4. L162, L163 and L164 for the language lane.

## Round 10: clinic, a simulation written in the editor (2026-11-02)

`compiler/gaps/clinic` simulates a day at a walk-in clinic, one event at
a time. Patients arrive at random (exponential gaps), each routine, soon
or urgent, with a patience and a time they need. They wait in a waiting
room ordered by arrival or by urgency, and a desk takes the next one when
it is free: the first free desk, the least busy one, or one at random.
Desks take a 30-minute break each; a patient whose patience runs out
before a desk takes them walks out. The program reads a `clinic.txt` of
settings (`desks 6`, `rate 30.5`, `order arrival`, `pick random`), prints a
report (waits with their mean, spread, median and 90th percentile, a
histogram, a table per urgency and per desk, the waiting room's average
size, the last eight events, an hour-by-hour table), then runs the same
day every other way, with 2 to 7 desks and over ten seeds, finds how many
desks keep the 90th percentile under 15 minutes with nobody walking out,
and writes every visit to `clinic.csv`.

It is a new kind of program for the rounds: a discrete-event simulation,
with its own generic data structures. It has **146 definitions**, against
machine's 141: 13 types and 133 functions, ten of them tests (`expect`).
It is the first round with **type parameters on the program's own types**
(E198): `Heap a`, a leftist heap of 13 functions used at two types (`Heap
Happening` for the events, `Heap Patient` for the waiting room), and
`Queue a`, a two-list queue of the last events; and the first with
**private cases** (E209) on both. The program is original; a
discrete-event loop, an exponential arrival process and a histogram are
common knowledge. The leftist heap and the two-list queue follow Okasaki's
*Purely Functional Data Structures* (1998; the leftist heap is Crane's,
1972), and the running mean and spread are Welford's method (1962): both
adaptations, credited in the program's comment (the editor's Program
panel) and in CREDITS.md.

**It was written in the editor**, as rounds 7 and 8 were: the built editor
in headless Chromium, every definition made with *+ New definition*, the
types with the type panel (its new *Add the type parameter* and *Private*),
bodies typed into the palette, matches from `match x · T`. Nothing was
edited by hand. About 180 typed fills, 30 matches (75 cases), about 20
refusals, three names and one field's type changed through
the panels. Type parameters and private cases went in first time, and a
fresh match now keeps one hole per case (E189), so each case was simply
filled in turn. The finished program ran in the editor's Run panel (5 s
for the report) and printed what `lab run` prints. Driver and scripts are
in the project's files, `gaps-round10/`.

Files:
- `compiler/gaps/clinic/`: the program as the editor saved it.
- `compiler/gaps/clinic.ideal.js`: the same report by hand, with binary
  heaps in arrays, desks changed in place and the language's own seeded
  generator (`ters/src/lang/random.ts`), so it draws the same numbers.
- `compiler/gaps/clinic.ts`: the three ways (`lab run`, `lab compile`'s
  module, the ideal) in a folder whose `clinic.txt` sets the hours.
- `compiler/test/clinic.test.ts`: the three print the same report at 8
  hours, and the compiled one and the ideal at 40.
- `compiler/gaps/bench-clinic.ts`: the table below.

### Results

```
hours  way        whole report   against the ideal
    8  evaluator       6406 ms       189x
    8  compiled         246 ms         7.3x
    8  ideal             34 ms
   40  evaluator      29451 ms       235x
   40  compiled         424 ms         3.4x
   40  ideal            125 ms
  200  compiled        1458 ms         6.4x
  200  ideal            227 ms
 1000  compiled        8272 ms         5.8x
 1000  ideal           1414 ms
```

`node compiler/gaps/bench-clinic.ts 8 40 200 1000`, once each; the
evaluator and compiled times include starting node (about 40 ms) and
`lab run` reading the program. A day of 8 hours is about 140 patients and
1,000 events; the whole report runs 30 days (the six ways, six desk
counts, ten seeds, the search for enough desks). All three print the same
report up to 200 hours. At 1,000 hours the two "random free" lines differ
by a few patients: a patient needs at least 2.0 minutes, so two desks can
finish at the same moment, and the leftist heap and the ideal's binary
heap take equal keys in a different order, which changes who gets which
random draw. Neither is wrong.

**C and WebAssembly don't run it** (C106): `lab native` says "main isn't
in C: calls day, which uses seeded, which isn't in the scalar profile".

A profile of the compiled module at 200 hours: the garbage collector 23%
by itself; `run` 74% inclusive, of which `arrived` 29%, `assigned` 20%,
`finished with` 15%, `noted` 12% (the clock text of every event's line,
as the ideal does too); the runtime's `setPath` 3 to 6% by itself.

### The gaps, ranked

**K1. A generic number result is counted in `Fixed` (perf and a wrong
type, L175).** `heap size` is `1 + heap size(left) + heap size(right)`;
nothing pins the literals, so its type is `(Heap a) -> b where b is a
Number`, and `advanced` reads `as float64(heap size(c.waiting))`. Of
`as float64`'s four types (Int, Rational, Fixed, Algebraic) the checker
took `Fixed`'s, and the compiled module counts the waiting room in
fixed-point records of BigInt steps (`heap_size_at_Fixed`, `add_fixed`).
The answer is the same; nothing in the editor says which `as float64` it
is (E223). *Measured* by replacing it with a count in numbers by hand:
1661 → 1527 ms at 200 hours (8 to 12%). The same defaulting made
`urgency rank`, `largest count` and `power of ten` generic, and a
`let` of `largest count(...)` was taken as a Float64 (below).

**K2. `set` is a generic path walk (perf, every program that updates a
record, C105).** Each `set((x) ↦ x.events, c, …)` compiles to the
runtime's `setPath(c, [1], …)`: an array for the path, `fields.slice()`,
and `{ ...record, fields }`. clinic has 30 of them, and a chain on one
record (`advanced` sets `queue area` then `now`; `arrived` four in a row)
copies the ten-field `Clinic` once per link. *Measured:* only a one-field
fast path in `setPath` (no recursion, `{ tag, fields }`) took 1527 → 1335
to 1560 ms (noisy, 2 to 12%). The fix is a set on a known record type
compiled as the constructor with one field changed, and a chain of sets on
one record as one copy; L167 (several fields at once) is the language
half.
Done (C105): each set is the record made again by a function of the
program's own, and a chain of them one copy; clinic about 10% faster.

**K3. Copies per event (perf, C107).** The garbage collector is 23% of
the compiled time: an event copies the `Clinic` six to nine times
(`advanced` 2, the events taken off, `scheduled`, `noted`, `with desk`,
`visited`). Every copy but the last is dead at once. K2's fusion takes
some; reuse in place when the old record has no other holder (C62, C94's
rc==1 reuse) the rest.
Closed after measuring (C107): even every set of the ten-field record
changed in place buys 0 to 7%; the rest of the collector's time is the
heaps, lists and texts each event makes.

**K4. No seeded Random in C or WebAssembly (target gap, C106).** Every
simulation, game and test that wants the same numbers each run is
JavaScript-only. The C and WebAssembly runtimes need `seeded` with the
generator in `ters/src/lang/random.ts`, so all targets draw the same.
Done (C106, #1143 and the `set` step after it): `lab native` builds
clinic and gives `lab run`'s report and CSV byte for byte.

**K5. The evaluator (not the compiler's).** 6.4 s for a day's report, 29 s
for 40 hours: the Run panel's 5 s is the evaluator's. L118c again.

### What the editor made hard

In the order they cost time. Each is a BACKLOG row.

1. **A program type named like a library type is taken silently, and then
   every message says "needs Event here, got Event" (E217).** `Event` is
   std's (a page's event). The program's own `Event` was accepted; the
   field type picker lists both as "Event" and took std's for `Clinic`'s
   `events: Heap Event`. From then on `started`, `arrived`, `break
   started`, `opened` and `run` were refused with "scheduled needs Event
   here, got Event", "handled needs Event here, got Event", or messages
   about `show` and `as float64` (item 3). Found by renaming the type
   `Happening` and seeing the field still read `Heap Event`; fixed by
   picking the field's type again in its panel.
2. **The palette crashes on a name the program shares with a module
   (E218).** The program's `div(a, b)` (a total quotient) shares its name
   with the html module's `div(children)`. Typing `div(n, top)` where n
   and top weren't settled throws in typed.ts (`leaveOpen`'s `fixedAt`
   reads `r.params[i]` past html `div`'s one input: "Cannot read
   properties of undefined (reading 't')"), and the picker never opens on
   that hole. `div` was renamed `quotient of`. In `clock text`, where the
   inputs were settled, `div(t, 60)` had gone in.
3. **Refusals name an overload that has nothing to do with the cause
   (E219).** About half of the refusals named the last of an overloaded
   function's types: "as float64 needs Fixed here, got Int" (the cause:
   the program's `ratio` read as the library's private `ratio` case, item
   4), "show needs Float64 here, got Int" (the cause: item 1), "scaled
   needs Int here, got Float64" (a let of a generic number, L175), "item
   at needs Int here, got Fixed". Each took a bisection by probing
   smaller texts to find.
4. **The library's names win over the program's (E220).** With the
   inputs not yet settled, the program's `ratio(a, b)` was read as the
   library's `ratio`, Rational's private case ("ratio is private to the
   library, which keeps Rational's rule"); renamed `share`. With item 2,
   two of the program's names had to change for the library's sake. A
   program's own definition should shadow a library name, and another
   program's private case shouldn't be read at all.
5. **One long typed body fails where small definitions pass (E222).**
   `with sample` (Welford's update) as one text with three lets was
   refused; the same as four small definitions (`new mean`, `new m2`, `new
   low`, `new high`) went in. `histogram lines` as one map over
   `numbered(counts)` was refused three ways (tuple fields `first` and
   `second` "More than one type has these fields", a let of a generic
   number, `as float64` of a range's item); it went in as `count at`,
   `histogram line` and a map over `range from(0, 12)`. Six definitions
   exist only to settle types one at a time.
6. **A list literal as a call's only input loses its brackets (E221).**
   `flatten([a, b, c])` is shown `flatten(a, b, c)`, `histogram([0.0,
   4.9])` as `histogram(0.0, 4.9)` and `heap of([tuple(…), …])` as
   `heap of(tuple(…), …)`: read as calls of several inputs, which since
   L128a's tuples could mean something else.
7. **Smaller (E223, E224).** A call never says which of a function's
   types it took (`as float64` at Fixed, K1). A new program's palette
   lists `extended less`, `extended add`, `extended negate` first under
   "calls" for main's hole.

What went well, for the record: type parameters (*Add the type
parameter*, then fields of type `a`, `List a`, `Heap a`) and private cases
(a tick) went in first time; matches keep one hole per case now; `set`,
`case name`, `first where`, `any pass`, `sort by`, `range from`, `padded
start`, `repeated`, `seeded` and the ten tests (`lab test` passes them)
carried the program; the report ran in the Run panel once the program was
whole, the same as `lab run`.

Named result ports weren't used: typed text has no `a, b = f(x)` yet
(L128c's reading it back).

### Language gaps

Where clinic defines a helper only because the language or the library
lacks something:

- **KL1. Division, log and whole part are Choice where they can't fail
  here.** `share(a, b) = first(a / b, else 0.0)`, `safe log`, `int of =
  first(whole part(floor(x)), else 0)`, `quotient of` and `mod int`: five
  definitions to end a Choice with a default. Since L125 a Float64 is
  finite, so `floor` to an Int always has an answer. L174.
- **KL2. Number literals make generic results.** `heap size`, `urgency
  rank`, `largest count`, `power of ten` and `count at` came out `where a
  is a Number`; one was then counted in Fixed (K1), one taken as a Float64
  by a let. L175.
- **KL3. No Float64 from text.** `read decimal`, `power of ten` and `read
  int` read "30.5"; no sign, no exponent. L176.
- **KL4. No priority queue or queue in the library.** Heap (13
  definitions) and Queue (6) are written by hand, as most simulations,
  schedulers and searches would need. L177.
- **KL5. A record's eleven settings by key.** `with setting` is an eleven-way
  `if` on the key, one `set` each; L167 (several fields) and L168 don't
  cover it, and a field named by text would be reflection. No row.

### Proposed order

1. E217, E218 and E220: a crash and two silent wrong readings, each
   costing a definition renamed.
2. E219, then E222: the messages that sent each refusal into a bisection.
3. L175 (and K1's Fixed), C106 (seeded on C and WebAssembly).
4. C105 with L167, then C107.
5. E221, E223, E224, L174, L176, L177.

## Round 11: crew, workers as fibers (2026-11-05)

`compiler/gaps/crew` reads a project plan (each task's minutes and what
it waits for, `workers 3`), checks it (whole numbers, a name twice, an
unknown task, a cycle, each with its line), sorts it (Kahn, 1962), finds
the critical path and every task's slack with the critical path method's
forward and backward passes (Kelley and Walker, 1959), and runs the plan
with a crew in simulated minutes, ready tasks handed out longest tail
first (Hu 1961, Graham 1966) or by line. It prints the run's log, how busy
each worker was, and a table of crews of 1 to n+2 workers both ways
against the lower bound.

What is new for the rounds: **each worker is a fiber**. A worker is a
loop that performs `next job`, `spend(minutes)` and `done with(task)`
from the `Work` effect, whose three operations are answered later
(L54a). The scheduler is written in the language: `fiber` runs a worker
under a handler that turns each operation into a `Step` holding the rest
of the run; the `Floor` keeps the idle workers' rests and a timer per
spending worker, and `run floor` moves the clock to the earliest timer
and resumes that rest. It is the first round with a hand-written
scheduler of continuations, file input through `read file`, and a usage
exit code. **66 definitions** (8 types, an effect, 57 functions), 2,594
nodes with the library. It was generated once with the DSL (build script
in the project's files, `gaps-round11/build.ts`), not built through `lab
mcp` or the editor.

Files:
- `compiler/gaps/crew/`: the program, its README (credits) and a sample
  `plan.txt`.
- `compiler/gaps/crew.ideal.js`: the same program by hand. Each worker
  is a JS generator resumed by the scheduler with its answer; maps are JS
  Maps and the ready tasks and timers binary heaps, changed in place.
- `compiler/gaps/crew.ts`: the four ways in one process (the evaluator,
  compile.ts's module, the core IR's, the ideal) on the representations
  `lab run` and `lab compile` choose, with a world whose files are in
  memory, and a generator of made-up plans.
- `compiler/test/crew.test.ts`: the four print the same and exit the same
  way on the sample, ties, eleven failures and a usage error, and the
  compiled ones and the ideal on 300 tasks.
- `compiler/gaps/bench-crew.ts`: the table below.

All four agree on everything tried, failures included: the evaluator,
compile.ts and the core IR needed no fix. The program reads the plan
with folds from the end, so of two bad `workers` lines the last is the
one reported, and a task named twice is reported at its second-last
line; the ideal does the same on purpose.

### Results

```
 tasks  way          whole report   against the ideal
    50  evaluator        819 ms        354x
    50  compiled          18 ms          8.0x
    50  core              20 ms          8.4x
    50  ideal            2.3 ms
   200  evaluator       4868 ms        852x
   200  compiled          75 ms         13x
   200  core              66 ms         12x
   200  ideal            5.7 ms
  1000  compiled         393 ms         19x
  1000  core             354 ms         17x
  1000  ideal             21 ms
```

`node compiler/gaps/bench-crew.ts 50 200 1000`, in one process, after a
warm-up run. The report runs the crew 13 times (the run it logs, then 1
to 6 workers, both ways of ranking). At 4,000 tasks the core IR's module
takes 1.2 to 1.4 s and the ideal 0.10 to 0.14 s.

Before the harness used the representations lab chooses, it ran the
program as defined (maps and sets as sorted lists): compiled 70x the ideal
at 1,000 tasks and 570x at 5,000 (`value at` and `put` walking lists).
That was the harness's mistake, not lab's; it is noted because a program
handed to `compile` directly, as the older harnesses do, still gets it.

A profile of the core IR's module at 4,000 tasks (`lab compile`, then
node): `simulate` 76% inclusive of `main`, of which `step` 54% and
`released` 28%; the weight-balanced tree's insert, balance and lookup are
the largest self times, then `text.less` with its surrogate regular
expression (about 10% of the samples together), and the collector 7%.

### The gaps, ranked

**K1. One representation per type, so every Map is a tree (perf, C93).**
On JavaScript the chooser may store a Map as a hash table changed in
place (C63b), and crew's maps each have one holder. It still picks the
weight-balanced tree for all of them: the cost of a type's representation
is its dearest job, and one map (`idle`, the parked workers) is read with
`smallest key`, which a hash table does in n log n. So `waiting`,
`rank`, `busy`, `tasks`, `users`, `start` and `tail`, which only `put`,
`value at` and walk, pay log n tree steps with text comparisons.
*Measured* by making the hash table's costs all constant for one run (the
rows in `LIBRARY.reps`, in a script): at 4,000 tasks the core IR's module
goes from 1.2 to 1.4 s down to 0.53 to 0.66 s, about 2.2x, and prints the
same. Sets stay trees: `ready` and `timers` are priority queues read with
`smallest item`, and as hash sets the run took 45 to 50 s. The same
holds for any program that uses std's `Priority queue` (a Map) or
`smallest key` once: all of its maps lose the table. The fix is C93's
choice per value (its steps s1 to s5), with crew as the Map witness beside
machine's List: crew's maps split into one group read in order (`idle`)
and one only looked up.

**K2. Text comparison tests both texts for surrogates on every compare
(perf, small).** `text.ts less` runs `/[\uD800-\uDFFF]/` over both texts
before `<`, and the trees compare task names at every step. *Measured* by
comparing code units up to the first difference and looking at
surrogates only there: 1.56 to 1.70 s → 1.54 to 1.59 s at 4,000 tasks,
under 5%. Below the 10% bar, so no row; worth folding into any change to
`text.ts`.

**K3. What is left after K1 (about 5x at 4,000 tasks).** Not attributed
yet: the ideal's heaps are arrays, the program's priority queues are
persistent trees of pairs; every change to the ten-field `Floor` is a new
record (C105 makes a chain of sets one copy; C107 found the rest is the
structures each step makes); each worker's rest is a closure where the
ideal resumes a generator. No row until K1 is done and the profile is
taken again.

**K4. The evaluator (not the compiler's).** 0.8 s at 50 tasks, 4.9 s at
200, 350x to 850x the ideal. L118c again.

The compiled module is 211 KB for the 66 definitions: the trees module,
and a generator twin (`$h`) beside every recursive function for deep
recursion. Not measured as a cost; noted for the size of a page.

### Language gaps

- **CL1. A scheduler of fibers writes the effect twice.** `Step`'s cases
  (`asking`, `spending`, `finishing`, each with its `rest`) are `Work`'s
  three operations again, and `fiber`'s handler is three cases that only
  wrap the operation and its rest in a `Step`. Every program that drives
  fibers itself (the scheduler in ters/test/later.test.ts, crew) writes
  this pair by hand, and must spell each rest's type with `Diverge`. A
  library form that runs a computation to its next operation and gives
  back the operation as data, with its rest, would replace both: a
  shallow handler's view (Hillerström and Lindley, "Shallow effect
  handlers", APLAS 2018; OCaml 5's `Effect.Shallow`). L229.
- **CL2. Error order from folds from the end.** Reading lines with a
  fold reports the last bad line, not the first (above). Folding the
  lines reversed, or a `first where` over the lines, fixes it in the
  program; the fold's direction is the language's (G15, G23) and well
  documented. No row.
- **CL3. `value at` with a default.** All 21 of crew's `value at`s sit
  in a `first(…, else …)` (0, nil, a task's needs). `update at` took a default for the
  same reason (round 5, LG2); a lookup with one is the other half. Small;
  no row unless another round shows it.

### Proposed order

1. C93's choice per value (s1 to s5), with crew's maps as a second
   witness: the largest measured gap here (2.2x).
2. L229, the steps of an effect, in the language lane, before more
   programs write schedulers.
3. After C93, the K3 profile again.
