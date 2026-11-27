# Gaps: what the compiler emits vs what it should

This doc comes back with each compiler milestone. Each round goes like this.
Write a program in the language that's bigger than the last one. Write by
hand the JavaScript a good compiler would emit for it: same program, same
algorithm, same output, same value representation. Then put that next to
what `compiler/src/compile.ts` actually emits. What differs is a gap. Each
gap below gets its evidence, a fix and a rank.

The programs are original, written for this purpose.

**Rounds so far (2026-11-26):** 1 calc, 2 Countdown and chapters, 3
ledger, 4 the guitar pedal, 5 routes, 6 notebook, 7 sheet (written in the
editor), 8 board (a page, written in the editor), 9 machine (an assembler
and interpreter, on every target), 10 clinic (a simulation, written in
the editor), 11 crew (workers as fibers), 12 break (written through the
MCP), 13 pond (stable references, free lists and threads), 14 rota (a
search written with Choice), 15 fit (gradients of functions chosen at
run time), 16 trek (a hiking track with units), 17 depot, 18 pack, 19
scan (regular expressions made automata), 20 strings, 21 mini, 22 mnist,
23 bazaar, 24 typeset and 25 larder (exact fractions, and lines read by
running their printers backwards). Each round's gaps are
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

### clinic again, 11-26 (Language lane)

The 11-26 sweep had clinic at 7.9x the ideal in core JS. `bench-clinic.ts` now:

| hours | core IR | ideal | ratio |
|---|---|---|---|
| 8 | 206 ms | 30 ms | 6.9x |
| 40 | 457 ms | 43 ms | 10.6x |
| 200 | 1752 ms | 295 ms | 5.9x |
| 1000 | 5985 ms | 1334 ms | 4.5x |

The core IR column includes starting node (about 90 ms for an hour's
clinic), and the ideal runs in the bench's own process.

**Workers.** At 40 hours a run is 0.45 s with workers and 0.34 s with
TERS_WORKERS=0. At 200 hours the two are about even (1.57 against
1.50 s), and at 1000 hours workers win (4.6 against 5.2 s). With them the
process uses twice the CPU. Each of the three maps that get shared (the six
ways, the desk sweep, the ten seeds) runs once, so a site's first job is
its only job, and a worker meets each site's code cold. At 200 hours the
first, six units of 31 ms alone, takes 231 ms shared: the main thread
does its unit by 40 ms, waits out the patience (twice a unit), runs one
of the workers' units again, and waits again. Taking a site's first
units back at once instead of waiting was tried: 6% faster at 40 hours,
even at 200, 8% slower at 1000. Not kept.

**One thread, by part.** Profiled at 200 hours with TERS_WORKERS=0 (the
main thread 1.15 s, the ideal 0.22 s):

- `day` is 712 ms against the ideal's 168 (4.2x). Of that, `assigned` is
  282 ms (the ideal's assign is 31), and the collector is 23% of the
  whole: every event makes the `Clinic` again (K3), along with the heaps
  and the log line's text.
- `heap size` is about 75 ms. The program counts its waiting room by
  walking the heap at every event, where the ideal keeps a count. That's
  the program as written.
- `percentile` is 170 ms: `sort` on lists stored as arrays. The library's
  merge sort cons-builds its result, which on an array is a call deep for
  every item, past 1000 deep a generator step each. A profile makes this
  look like 60% of the run (deep stacks are slow to sample); timed, it is
  about 12%. Swapping it by hand for the JS array's own sort in the
  printed module: 200 hours 1353 → 1192 ms, 1000 hours 5909 → 5474 ms,
  40 hours −4%, the same report. A bottom-up merge sort over positions,
  written in the language as `array of List`'s sort, was slower than the
  merge as compiled (a tuple and two failing reads a step). Not kept.

What would clear the bar is a sort that runs as the target's own over an
array (stable, by `compare`, so the same order as the merge): about 12%
at 200 hours. That's C355: a builtin on every target (JS, C, wasm) and a job
on `array of List`. The rest is spread out, and is mostly K3's copies.

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

## Round 12: break, a pool break written through the MCP (2026-11-06)

`compiler/gaps/break` plays a pool break event by event: sixteen balls
rolling in straight lines and slowing by friction, an elastic collision
when two meet, a bounce off a cushion, a drop into one of six pockets, a
rest. Each step finds the soonest of every next event (about 120 pairs,
the cushions, the pockets, the rests), moves every ball to it and applies
it. When a ball touches something is a relation (L120d): the `Toucher`
interface's `gap at(obstacle, ball, t)` read the other way is `first
touch`, in closed form for a cushion and by its way, conservative
advancement, for a pocket and for another ball. **86 definitions** (7
types, an interface, 78 functions and values), against round 11's 66.

What is new for the rounds: **it was written through the MCP server**
(`lab mcp`'s tools, called in process by a driver script in the project's
files, `gaps-round12/drive.ts`), one `define` and one `replace` of text a
definition. What the MCP couldn't write was made first with the DSL
(`gaps-round12/seed.ts`): the types' fields, the interface's ports and the
way's mark. Driving all 86 took about 3 minutes, most of it rechecks.

Files:
- `compiler/gaps/break/`: the program and its README (credits).
- `compiler/gaps/break.ideal.js`: the same break by hand: balls as objects
  changed in place, the same order of events and the same arithmetic.
- `compiler/gaps/break.ts`: the evaluator, the core IR's module and the
  ideal in one process, on the representations `lab run` chooses.
- `compiler/test/break.test.ts`: the core IR's main prints the ideal's 200
  lines.
- `compiler/gaps/bench-break.ts`: the table below.

All three print the same 200 lines, the evaluator included; nothing needed
a fix.

### Results

```
way          main (3 breaks)   against the ideal
ideal             4.3 ms
core             62.4 ms           14.6x
evaluator     42,919   ms       10,026x
```

`node compiler/gaps/bench-break.ts 9 --evaluator`, the median of 9 runs
after a warm-up (the evaluator's one run). `lab run` takes the core IR's
way, 4.7 s in all with the check and the choosing.

### The gaps, ranked

**B1. A list read by position, built afresh each step, stays a cons list
(perf, 2.2x).** `soonest from(es, i, best)` reads the step's candidate
events with `item at(es, i)` and `length(es)`, so each step walks the list
O(n²) times: 55% of the samples. The chooser's groups (rep-groups.ts) do
want `array of List` for `soonest`, but `splitByGroups` drops a group whose
root is called from a loop of the rest's, since its lists would be
converted at every turn (machine's `items of words`). Here a conversion a
step is O(n) against O(n²) of walks. *Measured* by scanning the list once
in the printed module (`soonest` rewritten by hand): 59 to 27 ms, the same
200 lines. A cheaper fix in the program, a scan written as a match on the
list, needs a match, which the MCP can't write (I184). Row C188.
*Fixed (C188):* the split is tried where the whole program can't take
arrays (break's list of lists), and keeps a group looped by position
(`item at` in a definition that calls itself) though a loop calls it:
main 62 to 28 ms, the same 200 lines.

**B2. `first(a / b, else c)` and `first(sqrt(x), else c)` lower to a
try/catch (perf, with B3 1.4x).** Division and `sqrt` give no answer as a
value (R.FAIL), and nothing else in those bodies throws, yet each is
printed as a try with the depth saved and restored, and checked for FAIL
too. The module has 274 try blocks. `length of`, `rest time` and
`heading`, called several times for every ball at every step, are all
such.

**B3. Small pure functions called again with the same input (perf).**
`moved(b, t)` calls `heading(b)` twice and `speed(b)` three times (once
through `rest time`), each a square root; nothing inlines or shares them.
The ideal works each out once. *Measured* with B2: `moved` working
`heading` and `speed` out once, and `rest time` and `length of` without
the try, on top of B1: 27 to 17-19 ms, the same lines. Row C189 for both.
*Fixed in part (C189):* an attempt whose body throws nothing prints with
no try (core-js.ts; 40 to 20 in break's module, no measurable time on
V8), and a pure call made twice with the same inputs where both always
run is made once (share-calls.ts: `moved`'s `heading`): 28 to 25 ms,
measured in one process against the same module without it. Sharing
across calls (`speed` in `moved` and again in `rest time`, which it
calls) needs inlining: row C194.

**B4. What is left (about 4x after B1 to B3).** The collector is 16% of
the samples: every move makes a new Ball and two Vecs, where the ideal
changes its objects in place (C56's one holder, as in round 11's K3).
The candidate events are made as records in lists, then flattened. No row
until B1 to B3 are in and the profile is taken again.

**B5. The evaluator (not the compiler's).** 43 s for main, 10,000x the
ideal: every ball's motion is many small calls. L118c again.

### What the MCP couldn't do

Each was worked around, and the workaround is in the driver or the seed.

- **M1. A type's fields, an interface's ports, a way's mark.** `define`
  with kind type takes one case's name, so `ball(x: Float64, …)` became a
  case named with all that text. Nothing writes an interface field's
  ports, an implementation's `by its ways` ("nothing is named by its ways
  here") or a definition's `way` and `cost`. Made with the DSL instead;
  `by its ways` was filled into the saved file after the drive. Row I183.
  *Fixed (I183):* `define` takes a first case with its fields and an
  interface's first operation with its type, `add_case`, `add_field`
  (types as view prints them, ports too), `ports`, `add_way` and `cost`
  write the rest, `replace` takes `by its ways`, and `view` shows ports
  and a way's mark.
- **M2. A match's cases.** `split` on an input whose type nothing fixes yet
  is "that variable's type has no cases" (I116 fixed this in the editor,
  not in the MCP), and once a dummy `if e = quiet` fixed it, `replace`
  of the `meets` case with `time` was "a name alone is listed already".
  The Event type was made a record with a `kind` number instead, and every
  loop over a list became recursion over an index with `item at`. That
  is B1's cause. Row I184.
  *Fixed (I184):* `split` takes `as`, the type to split by, and
  `replace` with a name alone takes the nearest in scope, an arm's field
  first.
- **M3. A relation's solve can't be written.** `t = gap at(obstacle = o,
  ball = b, gap = 0)` is "nothing is named obstacle here", `gap at(o, b,
  □, 0)` is "takes 3 inputs, given 4", and the form the view prints,
  `gap at(a = o, b = b, d = 0)`, is "nothing is named a here". That view
  shows the solve's ports as letters and its binder as a 26-character id
  (impact's `until it touches`). `touch time` calls `first touch`
  directly, so the program reads the relation one way only. Row L231.
  *Fixed (L231):* the view names a field's ports (`gap at(body = b, wall
  = w, gap = 0)`), the MCP reads that form back, and `touch time` is the
  solve now.
- **M4. Shared names read wrong, far from the cause.** `p.place` in
  `pocket gap at` read Ball's `place` (Pocket had one too) with nothing
  said, so `pocket toucher` was typed `Toucher Ball` and refused as a
  second implementation two definitions later; the field was renamed
  `middle`. The rack written as one expression found no reading ("as
  float64 needs Fixed here, got Int") though each part read alone; it is
  three definitions now. `show` can't be given as a function
  (`map(ns, show)`: "nothing is named show here"). Row I187.
- **M5. eval of anything recursive.** "played performs Diverge, which
  nothing here handles": the loop could only be tried through `main`
  and `lab run`. And eval shows `= 5 : a` and `List a` where the type is
  known. Row I188.
  *Fixed (I188):* eval runs its text as an action of no inputs, as main
  runs, within its steps, and shows a type with what it needs.
- **M6. crew opens with five errors.** The MCP session reports `released`,
  `give`, `step`, `run floor` and `fresh floor` as wrong ("expected (a,
  b), got std.pair Int Int") where `lab check` finds none: the session
  doesn't bring a saved program's older shapes up to date as `lab` does.
  Row I185.
  *Fixed (I185):* the MCP reads a folder through `onTodaysIds`, as lab does.
- **M7. No sharing.** Nothing publishes, fetches or upgrades: `lab
  publish compiler/gaps/break shifted apart` works from the command line
  (`Vec`, `shifted` and `apart` at version 1), not through the MCP. Row
  I186.
  *Fixed (I186):* the MCP has publish, fetch, upgrade and downgrade, which
  run lab's own command on the open program and open it again after.

### Proposed order

1. C188, a candidate list read by position in a loop stored as an array
   (2.2x).
2. M1 and M2 (I183, I184): with them the program could have been
   written whole through the MCP, cases and all.
3. C189, `first` over a division without a try and small functions
   shared (1.4x).
4. L231, a relation's solve written as text, so a program reads it both
   ways.

## herd: entities by key, on several cores (2026-11-11)

examples/herd keeps about 2,000 animals in a `Map Int Animal`, each
following another by key; 50 are born and some 50 go each tick, and each
tick maps every animal through a function that only computes (128 sines).
compiler/gaps/herd.ideal.c is the same written by hand: arrays by id, the
live ids in order, the new states computed on 4 threads then applied. 200
ticks, 4 cores:

| | one core | 4 cores |
|---|---|---|
| by hand (C) | 1.31 s | 0.40 s |
| `ters native` | 1.36 s | 0.46 s (was 1.40: C61f) |
| `ters compile` | 2.0 s | 1.0 s (C209a; was 2.0, no worker used) |
| `ters wasi` | 2.07 s | |

- **H1. A map on the threads stopped the C printer** (readFirst asked the
  runtime about `par:map`). *Fixed in C61f.*
- **H2. A table could not be shared with the threads**, so a map whose
  function reads one ran on one thread. *Fixed in C61f*: its newest
  version is shared.
- **H3. A map waited a millisecond of items each call before sharing**:
  200 ms of herd's 200 ticks. *Fixed in C61f*: it shares once the items
  done say all of them would take a millisecond.
- **H4. Compiled JavaScript runs herd's map on no worker** (2.0 s): its
  function reads a Map. *Measured in C208*: letting workers start on time counted over the ticks, and a Map cross as its entries, uses them but buys 6% (2.0 to 1.88 s) for twice the CPU, as each tick copies the animals both ways; shared memory would be needed. By hand with columns in a SharedArrayBuffer (compiler/gaps/herd.shared.mjs): 0.49 s on 4 cores. *Halved in C209a* (2.0 to 1.0 s: the table and the answers cross as columns in a SharedArrayBuffer). The rest, measured in C209: a steady tick's map is balanced (main and 3 workers end within 0.2 ms); the tick's work is 10.6 ms against 8.5 by hand (each loop step's fuel and Int checks, records), and 1.4 ms a tick runs on the main thread alone (table sent 0.4, answers made records 0.25, storing and births 0.5, workers' start 0.3), each under 10%. Closing more would take the table kept as columns between ticks, not made from records each tick: measured 2026-11-11, that saves at most the table's sending (70 ms in a profile) and the answers made records (recv 32 + 18 ms), about 12% of 1.0 s before the puts it would still make, so under 10% once built; not built.
- **H5. One core, JavaScript and WebAssembly are 1.5x native** (2.0 and
  2.07 s against 1.36): the sines are most of it; *measured in C208*: mostly V8's sine (the plain loop 0.89 s in JavaScript against 0.73 in C).


## Round 13: pond, stable references, free lists and threads together (2026-11-11)

`compiler/gaps/pond` lives a pond a tick at a time: fish in a `Pool`
(keys that are a slot and a generation, a free list of slots), each
following a leader by its key; food patches in a `Map Int Patch`; six
herons in a `Map Int Heron`, each hunting a fish by its key. Each tick
every fish's plan is made from the pond as it was by a `map` over the
pool's keys that only computes (the threads' part), then carried out in
turn: eat, die, have young or move; then the herons strike and the food
grows. **105 definitions** (6 types, 99 functions and values), against
round 12's 86. 300 ticks from 400 fish, about 750 alive at a time.

It was written whole through the MCP's tools, types included, by a
driver in the project's files (`gaps-round13/drive.ts`): no DSL seed this
time (round 12's M1 is fixed).

Files:
- `compiler/gaps/pond/`: the program and its README (credits).
- `compiler/gaps/pond.ideal.js`: by hand as a data-oriented JavaScript
  developer would: the fish as columns of typed arrays by slot, a
  generation a slot and a free list, the food one Float64Array.
- `compiler/gaps/pond.ideal.c`: the same in C, with `-DTHREADS` making
  the plans on 4 pthreads.

The evaluator, `ters compile`, `ters wasi`, `ters native` and both ideals
print the same lines, to the bit.

### Results

```
way                      300 ticks, 400 fish   against its ideal
ideal C, 4 threads            0.099 s
ideal C                       0.175 s
ideal JS                      0.47 s
ters native                  18.2 s                104x
ters wasi                    17.9 s
ters compile                 20.9 s                 45x
with P1 fixed (next PR):
ters native, one thread       4.2 s                 24x
ters native, 4 threads        8.3 s
ters wasi                     5.9 s
ters compile                  6.2 s                 13x
ters compile, workers         7.1 s
```

One run each, `TERS_WORKERS=0` for one thread; native at -O2.

### The gaps, ranked

**P1. Lists stayed cons lists, so the Pool was walked (perf, 3.4x JS,
4.4x native).** The Pool's items and generations are lists; `pool item`
walked them (native: `lab_item_at` 31%, `lab_int_sub` 18%). The chooser
wanted `array of List` but the program refused to check once rewritten,
for two reasons:
- `show decimals` (the library's) calls `padded digits`, which folds over
  `range`. The rewrite copies the library definitions with lists in their
  types (padded digits) for the program, but not one that only calls
  them (show decimals), so it went on calling the library's own, which
  the rewrite then reached through it and changed: "items of array needs
  Array a here, got List Float64".
- A list as an array is matched by `front of array`, which the
  termination check didn't count as taking its input apart, so `seeded
  over` (a match recursion over a list) was held to Diverge, which `start
  patches`, a value, can't.
*Fixed locally*, both one-line rules (library-reps.ts: copy what calls a
copy too; infer.ts: an array's front is as large as the array): the
numbers above; the same lines (#2410).

**P2. The pool is copied for every fish carried out (perf, about 25% of
native after P1, O(n²)).** `applied(p, plan)` makes a new Pond with the
fish replaced in the school; the old Pond still holds the school, so the
replace copies the pool's arrays (`lab__copy_a1` 9%, `Pool_drop` 15%,
`lab_dec` 15%). The ideal changes one slot in place. This is the stable
references goal: a Pool held by one Pond that the next one replaces is
one holder (C56/C58p's in-place rule, for records' fields).
*Fixed on C (G13-P2):* a record given whole to a function that makes a
new one of its type is given only the fields that function reads, zeros
for the rest, so the caller takes the school with one holder: native 4.2
to 3.1 s, the same lines.

**P3. `sum(map(offsets, …))` builds lists, and `offsets` is made afresh
each call (perf, scent is 71% of native).** The smell of food sums a
5 by 5 block: two nested `sum(map(offsets, …))`. `offsets`, a value
(`[-2, -1, 0, 1, 2]`), is rebuilt at every call (`lab_offsets` 18%),
and each map makes a list that the sum then folds. The ideal is two
counted loops over a 25-entry weight table.
*Fixed in part on C (G13-P3):* `offsets` was made afresh because a
definition's value isn't kept where threads run (C173b kept it only
without them). It is now made once by whichever thread asks first and
kept uncounted for every thread: native one thread 2.9 to 1.9 s, 4
threads 1.1 to 0.86 s. The lists `sum(map(…))` makes are left.

**P4. Int arithmetic through the generic runtime (perf, about 15%).**
`first(remainder(c, side cells), else 0)`: `remainder` is a Choice (none
for 0), and on JS goes through the runtime's generic `remainder` with
type checks (11.5% of JS's samples); on C `lab__floordiv` isn't inlined
(8%) and Int adds are checked calls (`lab_int_add` 6%).
*Fixed on C (G13-P4):* a function that only computes on Ints, called
rather than looping, now gets a copy on int64s as C207i's loops do, with
`side cells` its literal, the remainder by 48 worked out in place and
`wrapped cell` and `cell key` written into `neighbour`; inputs out of the
small range go to it as written. Native one thread 2.0 to 1.35 s; then
`weight of`, a Float64 made from Ints, the same way (G13-P4b): 1.28 to
1.12 s. On JS (G13-P4c) the remainder by 48 is worked out with no try:
6.7 to 5.4 s. JS's Int adds through the generic runtime, and WebAssembly,
are left: plain adds in `neighbour` measured under 10% by hand. The food
map is read as an array on JS since C215: 5.2 to 4.3 s.
On WebAssembly (G13-P4d) the same int64 copies: WASI 5.6 to 3.3 s.

**P5. Threads make it slower (perf, the multithreading goal).** Native on
4 threads takes 8.3 s against 4.2 on one (25 s of CPU); JS's workers 7.1
against 6.2. The ideal gains 1.8x from 4 threads. The plans map does run
on them (`lab_par_one`); to measure: the reference counts' atomics once
the pond is shared (`lab_dec` is 15% on one thread), and what each tick
sends the workers on JS.
*Fixed on C (G13-P5):* the floor's count. `food at`, read at 25 cells for
8 directions of every fish, took the floor's table owned, so each read
dup'd and dropped it, atomically once it was shared with the threads, all
of them on one count. A table only read is lent now, as an array is:
native on 4 threads 6.5 to 1.1 s (one thread 2.9 s), the ideal's 4-thread
gain about matched (2.6x against its 1.8x). JS's workers are still left.

**P6. The evaluator (not the compiler's).** Agrees, slowly; L118c again.

### What the MCP couldn't do

- **M1. A match still can't be read from text** (round 12's I184 fixed
  `split`, not the text). Each of 7 recursions over a list was a
  `define`, a `split` on the list, then a `replace` per case.
- **M2. A field name a library type has too needs `as`.** `p.x` in 7
  definitions was refused until `as: "Vec"` was given; the driver reads
  the type out of the refusal and retries. The editor would offer the
  choice; text has no way to say whose field.
- **M3. A loop over an index can't be a value.** `if n = 0 then … else
  seeded(n - 1)` is "performs Diverge" in a value, as round 12's M5 was
  for eval; each became a match recursion over `range from(0, n)`. The
  termination check counts an Int towards a bound (L46) only in a
  function.

### Proposed order

1. P1, lists as arrays (its PR is ready to open).
2. P2, the pool replaced in place: the stable references goal, O(n²) to
   O(n).
3. P5, why the threads cost more than they buy: the multithreading goal.
4. P3 and P4, measured again after those.
5. M1, a match read from text.

*Where it stands (2026-11-11):* P1, P2, P5, P3 (in part) and P4 fixed
(#2410 to #2423): native one thread 18.2 to 1.12 s (ideal 0.175), 4
threads 0.63 s (ideal 0.099); JS 20.9 to 5.4 s (ideal 0.47).
I212 (M1, a match from text) and C215 (JS food map as an array) since
done: JS 4.3 s.

## Round 14: rota, a search written with Choice (2026-11-12)

`compiler/gaps/rota` reads a plan (the days, each shift and how many
people it needs, each person with the most shifts they work and the shifts
they can work, days off, rest rules such as no early shift after a night),
checks it line by line, and finds a rota by backtracking: every place of
every shift of every day, each chosen with `one of`. The place filled
next is the one the fewest people can take (Golomb and Baumert, 1965), a
branch is given up as soon as a place has nobody left (forward checking,
Haralick and Elliott, 1980) or the places left outnumber the shifts people
may still work, and a shift's people are taken in order of name so each
set is tried once. It prints the fairest rota (the first under the lowest
cap on anyone's shifts that has one: `optional` per cap), counts every way
to staff the first day (`count`), and finds who the rota can't do without
(a search without each person). **89 definitions** (6 types, 83 functions
and values).

What is new for the rounds: **a search written with Choice** at a size
where it matters. Round 2's Countdown searched with `one of`, but small;
here every report is several thousand `one of`s deep, a `count` over
hundreds of thousands of rotas at the bench's sizes, and 16 to 18 failed
or found searches for "needed". It was written through the MCP like rounds
12 and 13 (`gaps-round14/drive.ts` in the project's files): 89 `define`s,
90 `replace`s, no DSL seed. Driving all 89 took about 3 minutes.

Files:
- `compiler/gaps/rota/`: the program, its README (credits) and a sample
  `plan.txt`.
- `compiler/gaps/rota.ideal.js`: the same search by hand, as a constraint
  solver would write it: people and shifts by number, the rota in typed
  arrays changed in place and undone on the way back (a trail), and the
  program's Choice as a recursive search that calls back for each rota.
- `compiler/gaps/rota.ts`: the evaluator, the core IR's module and the
  ideal in one process, on the representations `ters run` chooses, with a
  world whose files are in memory, and a generator of made-up plans.
- `compiler/test/rota.test.ts`: the three print the same and exit the same
  way on the sample, a rest rule, no rota, 18 failures and a usage error,
  and the core IR's module and the ideal on a made-up fortnight.
- `compiler/gaps/bench-rota.ts`: the table below.

The evaluator, the core IR's module (`ters compile`), `ters wasi` and
`ters native` (once B1 below is worked round by hand) print the same as
the ideal on everything tried; nothing needed a fix to agree.

### Results

```
plan      way          whole report   against the ideal
7 x 9     evaluator       2838 ms        330x
7 x 9     core              59 ms          6.8x
7 x 9     ideal            8.6 ms
14 x 12   core             428 ms         13.9x
14 x 12   ideal             31 ms
14 x 16   core             941 ms         17.1x
14 x 16   ideal             55 ms
21 x 18   core            2239 ms         15.9x
21 x 18   ideal            141 ms
```

`node compiler/gaps/bench-rota.ts`: days x people, the median of 3 runs in
one process after a warm-up (the evaluator's one run). From the command
line on the 14 x 16 plan, starting node included, the same output each:

```
ideal JS                       0.12 to 0.16 s
ters wasi (in Node)            0.39 to 0.43 s
ters native, one thread        0.71 to 0.82 s
ters native, 4 threads         1.23 to 1.35 s
ters compile, bundled          0.78 to 1.07 s   (one thread 1.05 to 1.25 s)
ters compile, runtime from the checkout   1.28 to 1.34 s
```

Without esbuild (`npm ci` in ters/), `ters compile`'s module imports the
runtime's TypeScript from the checkout, and each worker thread strips its
types again on start (180 ms each), so the workers bought nothing; bundled,
they buy 1.1 to 1.3x.

A profile of the bundled module on one thread at 14 x 16: `fill` 82% of
the samples; `needed` (the search without each person) 53%, `first day
count` 18%. **`tableRead` 39%, of which the tuple key's `spelling` 27%**;
the collector 9%; `sort by`'s merge 3%.

### The gaps, ranked

**B1. `ters native` doesn't build: a definition named `cell` (bug, I214).**
The C names a definition `lab_` and its name, and the runtime's own type
is `lab_cell`, so `lab_cell *lab_cell(lab_cell *p0, lab_int p1)` is
"'lab_cell' redeclared as different kind of symbol". Renaming the function
by hand in the C builds it, and it prints the same. Any program with a
definition called `cell`, `closure`, `reason`, … (the runtime's names)
fails the same way. The fix: the C names definitions where no runtime name
can be (a prefix of their own, or the runtime's names checked against).

**R1. A tuple key is spelled as text at every read (perf, JS, I215).**
rota's `Rota` keeps who is on a shift by `(day, shift)`, and which shift a
person works by `(person, day)`: maps with tuple keys, hash tables on
JavaScript (C63f). Every `value at` and `put` spells the key: `"(" +
JSON.stringify(...) + "," + ... + ")"` through `map` and `join`, 27% of the
samples, and the table read around it 12% more. *Measured* by spelling a
two-part key with plain concatenation, and a text part with
`JSON.stringify` only when it holds a quote, a backslash or a control
character: 14 x 16, one thread, 0.89 to 1.05 s → 0.68 to 0.80 s (about
1.25x), the same output. The fix proper is a key compiled for its type
(an `(Int, Text)` key needs no spelling of the Int, nor quotes when the
texts are plain), or a table of tables by the first part.

**R2. Threads make the native search slower (perf, I216).** `needed` is a
`keep` of the people by a test that only searches: shared out to 4
threads it takes native from 0.71 to 0.82 s up to 1.23 to 1.35 s; the
ideal would gain from it, since the 16 searches are half the run. On JS
bundled it buys 1.1 to 1.3x. Not profiled yet; round 13's P5 found reads
of a shared table counted atomically, and this search reads three shared
tables (the plan's off set, and the rota's maps, copied per branch).

**R3. Native slower than WebAssembly (perf, to measure, I216).** On one thread
native takes 0.71 to 0.82 s and WASI 0.39 to 0.43 s, on the same C-like
tables (C63h to C63k). Not profiled; recorded so the next look at R2 also
looks here.

**R4. The rest of JS's 17x after R1.** The rota is persistent maps (a
branch's versions kept, std's `change`), where the ideal changes arrays
and undoes them; each place's candidates are a `keep`, a `sort by` on
tuples and a `map`; the search's `one of` runs through the branches
runtime (`attempt`, `shared`). To profile again after R1.

**R5. The evaluator (not the compiler's).** 330x at 7 x 9; L118c again.

### What the MCP couldn't read

The view prints each of these; `replace` didn't read them back, so the
driver wrote the program round them (I217):

- **M1. A tuple type**, `Set (Text, Int)`: written `Set (Tuple2 Text
  Int)`. And after an argument in parentheses a one-word argument isn't
  read: `Map (Tuple2 Text Int) Text` is "can't read the type at Text",
  `Map (Tuple2 Text Int) (Text)` reads.
- **M2. A list pattern**, `[name, need] →`: written as `length(rest) = 2`
  and `item at`.
- **M3. `otherwise →`** in a match: each of five matches on `Entry` names
  all five cases.
- **M4. A match on anything but a name**, and a name made on the line
  before it (`ds = …` then `match ds`): two `replace`s, the second filling
  the hole the first left, in seven definitions.
- **M5. Lets on lines of their own in a case** (`c = …`, then `k = …`,
  then the body): written on one line with `;`.
- **M6. `tuple(a, b) = e`**: read as `.first` and `.second`.
- **M7. `handle … abort(reason) → …`**: main uses `attempt` and a match on
  its `Outcome` instead.

And names that read as something else, silently or with a message far
from the cause (I218):

- **M8. `unit` is std's Choice `unit`**, `(a) -[Choice]-> a`, not the Unit
  value, so `if … then unit else abort(…)` typed `check shift` as
  returning a function; `unit()` is the value.
- **M9. A case's field named like a library value**: `rest line(after,
  before, line) → [tuple(after, before)]` read `after` and `before` as
  Order's, and the error came at `problem of`: "needs List (Text, Text),
  got List (Order, Order)".
- **M10. Overloads picked before the type is known**: `length(x)` in
  `widest` took List's (written `length(x ++ "")`), and `for each` in
  `check off` took html's three-input one ("takes 3 inputs, given 2").
- **M11. A field two of the program's types have** (`name`, `line` on
  Shift and Person): the first type offered was Shift, which typed
  `first person` on shifts, and `as` given one type name ("Person") was
  refused for its "Person, a Problem, a Shift" form. The fields were
  renamed (`shift name`, `person name`).
- **M12. No `fold`** in text: `as set` and a recursion instead.

### Language gaps

- **RL1. A search's state is copied, not undone.** Each `one of` branch
  makes a new `Rota` (three persistent maps); the ideal changes one and
  undoes it when the branch ends. Choice already knows when a branch ends,
  so a value only the search holds could be changed in place and undone
  (a trail, as Prolog's WAM and constraint solvers keep), the stable
  references goal applied to Choice. A design note first; no row until
  R1 and R4 are measured again.
- **RL2. "nobody works more than 1 shifts".** No plural helper; written
  without one here, the sample never shows it. No row.

### Proposed order

1. B1 (I214), a build that fails on a common name.
2. R1 (I215), the tuple key compiled for its type: 1.25x measured.
3. R2 and R3 (I216), the native search on threads and against WASI.
4. I217 and I218, the MCP reading back what it prints.

## Round 15: fit, gradients of functions chosen at run time (2026-11-13)

`compiler/gaps/fit` fits four two-parameter models to a file of
measurements: a + b·x, a·e^(b·x), a·x^b and a / (1 + e^(−b·x)). It uses
damped Gauss-Newton: each step solves (JᵀJ) δ = Jᵀr by Cramer's rule, and
is halved until it lowers the squared residuals. It prints each fit and
names the best. Each model is a function of its parameters (a record)
**picked by name at run time**, closing over the x it is at, and a
residual's slopes are `gradient` of that function. **44 definitions**
(4 types, 40 functions and values).

New for the rounds is calculus at run time. Round 14's search was
Choice; here the program asks `gradient` of closures the compiler can't
see until they run, which is what I245 had just made `derivative` do on
every target.

It was written through the MCP, like rounds 12 to 14
(`gaps-round15/drive.ts` in the project's files): 44 `define`s, 62
`replace`s, and 6 `as` answers. Before it, a probe with small programs
found I246 and L245 below.

Files:
- `compiler/gaps/fit/`: the program, its README (credits) and a sample
  `data.txt` (20 readings of a growing culture).
- `compiler/gaps/fit.ideal.js`: the same fit by hand. Each model's value
  and partial derivatives are written out, and the sums are taken in one
  loop over arrays.
- `compiler/gaps/fit.ts`: the evaluator, the core IR's module and the
  ideal, in one process, with a generator of made-up measurements.
- `compiler/test/fit.test.ts`: the three print the same and exit the same
  way on the sample, data with a negative x (no power fit), bad lines and
  usage, and 500 made-up points. `ters wasi` and `ters native` print what
  `ters run` prints.
- `compiler/gaps/bench-fit.ts`: the table below.

After G1 and B1 were fixed (I247, I246), the evaluator, the core IR's
module, `ters wasi`, `ters native` and the ideal print the same on
everything tried.

### Results

```
points  way          all four fits   against the ideal
20      evaluator       3760 ms       1262x
20      core             7.2 ms        2.4x
20      ideal            3.0 ms
20      native           7.9 ms        2.6x   (a process, start-up included)
20      wasi              76 ms         26x   (a process in Node)
500     evaluator      73238 ms      10735x
500     core             160 ms         23x
500     ideal            6.8 ms
500     native            47 ms        6.8x   (a process)
500     wasi             211 ms         31x   (a process in Node)
5000    core            1474 ms         17x
5000    ideal             89 ms
5000    native           363 ms        4.1x   (a process)
5000    wasi             854 ms        9.6x   (a process in Node)
```

The command was `BUILT=1 node compiler/gaps/bench-fit.ts 20 500 5000`. Each figure is the median of 3 runs after a warm-up, except the evaluator's, which ran once. Most of the time goes to the logistic model, which takes all 100 steps, halving many of them.

A profile of the core IR's module at 5000 points:
- the logistic's value (`value at.λ`) 10% and its carried gradient 10%;
- the fold of the sums 6%;
- the collector 12%.

Every step makes a closure per point (`value at(model, x)`) and a record for its gradient, and compares the model's name as text down the chain of `if`s. The ideal does none of this.

### The gaps, ranked

**G1. `gradient` of a function chosen at run time wasn't compiled
(fixed, I247).** `derivative` was carried (I245); `gradient` wasn't.
- fit's JavaScript shipped the program's nodes and ran the evaluator's
  derive on each closure's lambda: 1.4 MB.
- `ters wasi` and `ters native` refused the program ("uses gradient,
  which isn't in the scalar profile").

Now a function type asked for its gradient carries derive.ts's gradient,
made ahead, as a derivative is carried. The JavaScript is 305 KB with no
nodes, and all four targets print the same.

**B1. A derivative through `sum(map(xs, …))` of a captured list
(bugs, fixed, I246).** The probe tried
`derivative((q) => sum(map(xs, (x) => q * x)))` at xs = [1, 2]. It found
two bugs:
- Compiled JavaScript gave **1**, not 3. The carried derivative had been
  made from code where the sum and the map were already fused into one
  fold, and derive.ts didn't follow the fused fold's accumulator. It is
  now made from the code as staged, before the fold rewrites.
- Where the evaluator's derive was lowered instead, the printed nodes
  lacked a pair's `second`, which the derivative writes, so it crashed.

**L1. `ters run` can't differentiate through a map of the variable
(L245, Language lane B).** For the same lambda, the evaluator has no
answer ("this fold takes apart data built from the variable"). Written
as a fold over `xs`, the same sum works. So `ters run` and `ters compile`
disagree there. fit's sums are written as folds over the data for this
reason. Language lane B is building forward mode through data in
derive.ts.

*Fixed* (L245, #2595): derive.ts goes forward through lists and
lambdas on `ters run`; a loss written `sum(map(pts, …))` has its gradient.

**M1. The third `show` in one line reads as show at Int (MCP text, bug,
I248).** `show(1.5) ++ show(2.5) ++ show(3.5)` is refused: "show needs an
Int here, and a number with a fraction part can't be one". Two shows
read; a third doesn't. fit shows each Float64 in a let of its own.

*Fixed* (I248): the reader tried at most 16 combinations of the names
with several meanings (each `show` has four), so the right one wasn't
among them; when none of the 16 fits it now chooses a name at a time, each choice checked
with the names not chosen yet as holes. Also `show(1.5)` reads as
Float64's show again (it gave "3/2", Algebraic's).

**M2. `as` doesn't settle a field in a match case (MCP text, I249).**
In `largest y`, `larger(pt.y, largest y(more))` in a `cons(pt, more)`
case asks for `as` ("Point" or "Event"), and given `as` "Point" it asks
again. fit takes the ys out with a `map` first.

*Fixed* (I249): `as` reached only text of one line; it now reaches each
case of a match, fold or handle, and the steps around them.

**M3. A call of a call doesn't read (MCP text, I250).**
`derivative(f)(x)`, the way the Guide writes it, is "isn't read as a
whole"; inside `first(…, else …)` it is "no case named derivative at 11".
fit names the derivative in a let first (`g = gradient(…); g(p)`). This
is how calculus is written too, which hid the gap.

*Fixed* (I250): a call of what a call gives reads, `derivative(f)(x)`.

**R1. The evaluator, 1262x at 20 points and 10735x at 500 (perf).**
A profile shows the machine's own steps (`going`, `step`, `apply`,
`parts`) and the collector, 20%; nothing stands out. The ratio grows
with n, unlike round 14's 330x. Not measured further: the next look is
whether the evaluator re-derives a lambda each time `gradient` is asked
of a new closure of it (its cache is by closure).

**R2. A closure per point and a name compared per point (perf, core JS
17 to 23x).** fit's structure costs it: `value at(model, x)` builds a
closure for every point at every step, and walks a chain of text
comparisons to pick it. A model picked once per fit, outside the loop,
would fix both, in the program or in the compiler; the compiler could
lift the choice out of the fold, since `model` doesn't change in it. Not
measured.

### Next

1. L245, which Language lane B is building: `ters run` and the compiled
   targets agreeing on sums over maps.
2. I248 to I250, the MCP text reader. M1 is a plain bug.
3. R1, measured before anything is built.


## Round 16: trek, a hiking track with units (2026-11-13)

`compiler/gaps/trek` sums up a hiking track from a GPS. Each line of the
file is a fix: seconds, latitude, longitude, height. It smooths the
heights, makes a leg between each two fixes (haversine distance), and
prints:
- the distance, ascent and descent (counted past a 3 m threshold);
- the time moving and stopped, and the pace;
- the highest and lowest points;
- Naismith's and Tobler's time estimates, and the work of the climb;
- the biggest climb and the steepest leg, and a profile of forty bars;
- the fastest and slowest kilometres, and each stop of a minute or more;
- each kilometre, the time at each speed, and the distance at each grade.

Its numbers carry **units**: fields are written `Float64 m` and
`Float64 s`, and constants `6371000.0 m`, `9.81 m/s²`, `75.0 kg`. It was
chosen to need the rows waiting for an example: units in lists (L252d),
a match on an Int's sign (L249b), ropes (L248) and packed interface
values (L256). **96 definitions** (9 types, 87 functions and values),
against rota's 89.

It was written through the MCP, like rounds 12 to 15
(`gaps-round16/drive.ts` in the project's files): 96 `define`s, 139
`replace`s, and 12 `as` answers.

Files:
- `compiler/gaps/trek/`: the program, its README (credits) and a sample
  `track.txt` (400 made-up fixes of a hike over hills).
- `compiler/gaps/trek.ideal.js`: the same by hand. The fixes go in
  arrays, each pass is one loop, and the sums add in the order std's
  `sum` does (from the last item).
- `compiler/gaps/trek.ts`: the evaluator, the core IR's module and the
  ideal, in one process, with a generator of made-up hikes.
- `compiler/test/trek.test.ts`: the three print the same and exit the
  same way on the sample, bad tracks and usage, and 4000 made-up fixes.
  `ters wasi` and `ters native` print what `ters run` prints on the
  sample.
- `compiler/gaps/bench-trek.ts`: the table below.

The evaluator, the core IR's module and the ideal print the same at
400, 4000 and 40000 fixes. The only difference found was in the ideal,
which summed from the first item: std's `sum` adds from the last, and
the ascent's 3 m threshold turned that last bit into 3 m. `ters native` and `ters
wasi` print the same up to 4000.

### Results

```
fixes   way          the report   against the ideal
400     evaluator       800 ms       365x
400     core            7.4 ms       3.4x
400     ideal           2.2 ms
400     native           17 ms       7.8x   (a process, start-up included)
400     wasi             52 ms        24x   (a process in Node)
4000    evaluator     21190 ms      3639x
4000    core            274 ms        47x
4000    ideal           5.8 ms
4000    native         1052 ms       181x   (a process)
4000    wasi            152 ms        26x   (a process in Node)
40000   core          52781 ms       713x
40000   ideal            74 ms
40000   native        94045 ms      1271x   (a process)
40000   wasi              -                 (stack overflow, from 10000 fixes)
```

The command was `BUILT=1 node compiler/gaps/bench-trek.ts 400 4000`, the
median of 3 runs after a warm-up (the evaluator once), and `RUNS=1` for
40000. The ideal grows linearly; the core IR's module, `ters native` and
the evaluator grow as the square (R1).

### The gaps, ranked

**U1. Units vanish through constants, lists and `first`, so most of
trek's mistakes in units would go unseen (Language lane B).** The types'
fields carry units (L252a), and `2.0 m + 1.0 s` is refused. But of the
96 signatures only 7 show a unit (`clock : (Float64 s) -> Text`,
`naismith time : (Totals) -> Float64 s`, …); 26 show a plain `Float64`
where a unit is known. Each of these is accepted:
- `1.0 m + limit` where `limit = 3.0 s`. A value definition isn't
  unit-checked, and its unit isn't used where it's named: `earth radius`,
  `gravity`, `walker mass` and `threshold` type as `a`. So
  `ground distance : (Point, Point) -> Float64`, and
  `climbing work : (Totals) -> Float64` where it is J.
- `sum([1.0 m, 2.0 m]) + 1.0 s`, and a sum of a map. A list has no
  unit (L252d), so `heights of : (List Point) -> List Float64`,
  `time moving : (List Leg) -> Float64`, and `by grade` is a
  `Map Int Float64`. The `Track` field written `List (Float64 m)` loses
  its unit.
- `first(2.0 m / 1.0 s, else 0.0 m/s) + 1.0 s` and
  `2.0 m · exp(0.5) + 1.0 s`. A builtin with no unit rule gives a free
  unit: `first`, `exp`, `asin`. `exp` and `asin` should take and give a
  number without units; `first` should give its arguments' unit.

So L252d is needed, with two more beside it: constants' units, and the
unit rules of `first` and the transcendental functions.

**B1. A name ending in `or` or `and` before an operator isn't read (MCP
text, bug).** `b.anchor + x` is refused: "after .anchor, “+ x” isn't
read: no operator starts it". `typedOut` in editor/typed.ts skips an
operator whose left side ends with any operator's symbol
(`left.endsWith(sym)`) and doesn't check word boundaries for `or` and
`and`. `colour + x` and `band + x` fail the same way. trek renamed the
field `mark`.

**B2. A call of an unknown name takes 8.5 s to refuse, and each `++`
before it multiplies it (MCP text, bug).** In a 50-definition program,
`nosuch(e)` takes 8.5 s, `"a" ++ nosuch(e)` 17 s, and `"a" ++ "b" ++
nosuch(e)` 51 s. A profile puts 90% in `isOperation` (editor/typed.ts),
which scans every node for each field name that `closest` weighs, so
it's O(n²). The operator split then tries each operand at each operator.
The driver seemed to hang at `bucket line`, which named `metres` before
it was defined.

**R1. `drop` on a list stored as an array walks item by item, so
smoothing is quadratic (perf, core JS 47x at 4000 and 713x at 40000).**
`window(hs, i, k)` is `take(drop(hs, i − k), 2k + 1)`. std's `drop` is a
fold, and the array has no job for it, so each window walks i items
(f20 in the core module). At a quarter of a big buffer, `restOf` copies
what's left (the leak guard of I106c), so a walk from the start copies
too. The ideal indexes the array. If `drop` were a job on an array (a
view, O(1)), as `item at` is, the module would be linear. Built by C221:
`drop` and `take` are slices on an array (and log n on lists as trees);
at 40000 fixes the core module is 5.3x the ideal (713x before) and `ters
native` 2.4x (1271x), now faster than WASI.

**R2. `ters native` is 4 to 7x slower than WASI on the same program
(perf, C220).** At 4000 fixes, native takes 1052 ms and WASI 152 ms.
This is C220's machine result again on a second program, with the same
quadratic walk. Since C221 trek's native run is faster than WASI's (the walk
was the cause), and since C220 machine's is about as fast as WASI's
(its counts every step).

**R3. WASI runs out of stack from 10000 fixes (compiler).** `points
from`, `legs of`, `with heights` and std's `sum` recurse once per item.
Node's stack takes 4000 but not 10000. The core module counts its depth
and goes on from where it was; `ters native` has a bigger stack. With
C187 waiting for stack switching, WASI needs another way to grow (or a
deeper stack where the host allows one). Built by C222:
on WebAssembly each such function is a loop, consing and `and` carried
along (cons-loops.ts) and the rest with its frames on the heap
(deep-loops.ts); WASI prints the ideal's output at 10000 and 40000 fixes
(6.3x the ideal's time at 40000).

**L1. A division guarded by a comparison is still a Choice (language).**
`if d > 0.0 m then x / d` and `l.took > 0.0 s and l.length / l.took`
both have no answer at d = 0 as far as the checker knows: only a literal
divisor is known not to be 0. The Choice reaches `print` and is refused
("summary does Console while a Choice is open"). So trek has 9
`first(…, else 0)` that a reader can't see the point of: 7 guarded
divisions, `sqrt` and `asin` of numbers that are always in range. Also
`quotient(c · (n − 1), columns − 1)` had to be written with the literal
39. Hand-written code just divides. Two ways out:
- the checker reads the guard (d > 0 makes d non-zero in the then);
- or a Float64 division that always answers, as IEEE's does (∞ or NaN).

This is a semantics call for Ersagun.

**R4. `ters run` takes 11 s on the 400-fix sample, 0.8 s of it running
(perf).** A profile:
- 5.9 s re-checking units on the represented program
  (`unitProblems` inside `infer`, after the rewrite);
- 5.1 s lowering (`lowerScalar`; `firstArms` alone 2 s).

A rewrite of representations changes no units, so the second unit
check could be skipped. `ters check` takes 1.5 s.

*Later (2026-11-14).* I261 skipped the units (5.4 s), and I264a keeps
the lowered program between runs (a second run takes 1.4 s). One step
was measured and left: re-checking only the definitions the
representations' rewrite changed. withLibraryRepresentations checks
twice, 0.38 s with Map as a tree and 0.44 s with List as an array, and
reachedFrom's cut takes 0.17 s, out of a 5.5 s first run. The rewrite
changes 44 of the 96 own definitions and a type (Track), and adds 59
definitions of its own. So 103 of 155 would still be checked, which
saves about 0.3 s (5%). It would also need a check layered on the
program's own check, which is already layered on the library's.
Checking the Map and List rewrites once, together, would save 0.38 s
(7%). Both are under 10%, so neither was done.

**M1. Smaller things the MCP's text made harder.**
- A `match` as a step with more steps after it isn't read ("a case
  reads Case(fields) → value, not □"); trek made a helper.
- `0.0 m` where a parameter is named `m` is refused with "isn't read as
  a whole: an operator or a word in it isn't Ters's". The rule is right
  (a unit word naming something in scope is that name, L252b), but the
  message should say so.
- `first(largest of(hs), else 0.0 m)`: `largest of` gives an Optional
  and `first` takes a Choice. The message, "first needs Optional a here,
  and a number isn't one", reads backwards.
- `not in order(ps)` reads as a call of `not in order`; the message
  suggests `in order` but not `not (in order(ps))`.
- Each `replace` takes about 1.5 s once the program has 50 definitions.

**Rows waiting for an example.** trek needs L252d (U1). It doesn't need
the others:
- L249b: `direction` splits a grade by sign with `if g > 0 … else if
  g < 0`, which reads well. A `match` on the sign would be no clearer.
- L248: nothing splits or joins long lists.
- L256: no list of different types sharing an interface.

### Next

1. B1 and B2, plain bugs in the MCP's text reader (editor/typed.ts).
2. U1: L252d, constants' units, and builtins' unit rules (Language lane B).
3. R1: `drop` (and `take`) as array jobs, then R3, the WASI stack.
4. L1, once Ersagun says which way.
5. R4, then R2 with C220.

## Round 17: depot, a day of a bike-share network (2026-11-14)

`compiler/gaps/depot` simulates a day of a bike-share network. Its input is a
city file: stations (docks, bikes at midnight, where they are), demands
(riders an hour between two stations) and a profile of how busy each hour is.
It runs the day as a discrete-event simulation:
- riders come at random to each station, thinned by the hour's share (Lewis
  and Shedler, 1979), from a Lehmer generator (Park, Miller and Stockmeyer's
  48271);
- a rider takes a bike if there is one, or walks to the closest station with
  one within 900 m, or goes without;
- a ride that finds its station full rides on to the closest with a free dock;
- a truck moves up to 10 bikes from the fullest station to the emptiest every
  half hour;
- the time each station stands empty and full is counted, and so are the
  fares.

It prints the day's totals, a table of the stations, the ride times as bars,
and each station's bikes hour by hour.

The events are a `Priority queue Float64 Event`. The day's state is one
record of 14 fields, changed with `set`. The stations' stocks are a
`Map Int Stock`. Times are in seconds and distances in metres (units, with
L252e's units in maps and tuples). It was chosen to be larger than trek and
to try what no round had: a simulation's event queue, records updated with
`set` (several fields at once), and a random generator written in the
language. **129 definitions** (14 types, 115 functions and values), against
trek's 96.

It was written through the MCP, like rounds 12 to 16
(`gaps-round17/drive.ts` in the project's files): 129 `define`s, 175
`replace`s, and 14 `as` answers.

Files:
- `compiler/gaps/depot/`: the program, its README (credits) and the sample
  `city.txt` (a made-up town of eight stations with two rush hours).
- `compiler/gaps/depot.ideal.js`: the same by hand. The stations' state is in
  arrays by station, the events in a binary heap ordered by time and then by
  when they were planned, and every floating-point step is in the program's
  order.
- `compiler/gaps/depot.ts`: the evaluator, the core IR's module and the
  ideal, in one process, with a generator of made-up cities.
- `compiler/test/depot.test.ts`: the three print the same and exit the same
  way on the sample (three hours and seeds), on twelve bad files and
  arguments, and on a made-up city of 40 stations. `ters wasi` and
  `ters native` print what `ters run` prints on the sample.
- `compiler/gaps/bench-depot.ts`: the table below.

**Correctness.** The evaluator, the core IR's module, `ters native`,
`ters wasi` and the ideal print the same at every size tried, up to 640
stations. Each of the five agreed the first time.

### Results

```
stations  way        a day          against the ideal
10        evaluator    2815 ms        475x
10        core           12 ms        2.0x
10        ideal         5.9 ms
10        native         13 ms        2.3x   (a process, start-up included)
10        wasi           73 ms         12x   (a process in Node)
40        evaluator    2325 ms        308x
40        core           68 ms        9.1x
40        ideal         7.5 ms
40        native         75 ms        9.9x   (a process)
40        wasi          143 ms         19x   (a process in Node)
160       core         1171 ms         27x
160       ideal          44 ms
160       native       1990 ms         46x   (a process)
160       wasi         1619 ms         37x   (a process in Node)
640       core        65691 ms        156x
640       ideal         422 ms
640       native      87247 ms        207x   (a process)
640       wasi        81947 ms        194x   (a process in Node)
```

The command was `BUILT=1 node compiler/gaps/bench-depot.ts 10 40 160`: the
median of 3 runs after a warm-up, with the evaluator once. For 640 stations
it was `RUNS=1`. Each made-up city has three demands per station, so the
riders grow with the stations. The ideal grows about linearly. The compiled
ways grow about as the square of the stations (D1).

### The gaps, ranked

**D1. The stations stay a linked list read by position, so each lookup
walks the list (C227).** `station at(c, i)` is `item at(c.stations, i,
nowhere)`. `closest` calls it twice for each station it looks at, so each
call walks the list once per station, and `closest` runs for every rider who
finds no bike and every ride that finds a station full. The truck's round
and `docks at` do the same. The chooser took a tree for `Map` and left every
`List` as written: `List Station` is built once (`stations in`) and then
only read by position, but it is not stored as an array. Measured by hand:
the compiled module with `station at` reading from an array built once per
list (a WeakMap in the printed module) prints the same and runs a day of 640
stations in 3.5 s instead of 63 s (18x), and 160 stations in 0.45 s instead
of 1.2 s. That leaves it about 8x the ideal at 640 stations. Native and WASI
lose the same way.

**D2. Checking the units takes most of `ters check`'s 9 s (I278).** Of the
seconds a check of depot takes, about 3.5 are finding unit conflicts and 3.9
are working out the units the signatures show. Both solve the same system
for each definition, because `signatureUnits` solves it again. The systems
are big because a definition's constraints read every one of the program's
own callees through, all the way down. `main`'s system has 6,160 rows, and
`run`, `day`, `simulated`, `run until` and `handled` have 3,600 to 6,100
each: 41,556 rows over the program. (A library function is read through once,
as a summary of its ports.) L252e's slots for maps and tuples took the check
from 7.7 to 9.1 s on depot. trek's got faster, because the signatures now
learn once per program whether it declares a unit. Each `ters run` checks
once before it compiles.

**D3. Bug: a local name hides a longer name that ends with it (I279).** In
`line of(line, n)`, `comment line` (a case of `Line`, with no fields) was
"nothing is named comment line here". `comment line()` found the case ("is
Line, not a function"), so the parameter `line` took the last word. depot
renamed the parameter `text`.

**D4. Bug: a tuple the view prints isn't read back (I280).** The view prints
`set((s) => (s.bikes, s.rentals), st, (1, 2))`, and `replace` refuses that
text ("isn't read as a whole"). `(1, 2)` alone is "expected a value". Only
`tuple(s.bikes, s.rentals)` and `tuple(1, 2)` read. Also, LANGUAGE.md writes
a path as `(p) ↦ p.home.city`, but `↦` isn't read ("expected a value at 1");
the text reads `=>`.

**D5. A range made only to be walked once (C228).** `indices(c)` is
`range(length(c.stations))`. Each `closest` and each of the truck's two
searches makes that list and walks it once. With D1 fixed by hand, making
those lists (range and `length` of the stations) is the largest self time
at 640 stations: 0.67 s of 3.5 s. Building the list could fuse into the
recursion that walks it (deforestation, Wadler 1990).

**D6. Smaller things, measured or seen, not rows yet.**
- `first(value at(w.stocks, i), else no stock)` compiles to a `try` around
  the tree's lookup, so the miss is caught as an exception. `stock at` runs
  for every event (0.18 s self time at 640 stations, after D1). A lookup
  that can miss could return a "no answer" value instead of throwing.
- Each event copies the day's 14-field record two to six times
  (`scheduled`, `reseeded`, `changed`, `set`). The ideal changes variables
  in place. Not measured yet; it is the next thing to look at once D1 and D5
  are done.
- The evaluator is 300 to 475x the ideal.

**M1. Smaller things the MCP's text made harder.**
- A parameter named `s` makes `0.0 s` refused, as trek found with `m`.
  depot renamed the seeds and a station's parameters.
- Every `set` on a parameter's record needs `as`, since `(s) => s.bikes`
  doesn't settle the type: 9 of the 14 `as` answers. For `t.to`, the first
  type the refusal offers is Route, which is wrong for a trip, so the driver
  had to give `Trip` and `Stock` itself.

**Rows waiting for an example.** depot doesn't need any of the open ones:
it pins no unit-generic function (L252e's pins), and its one interface
value is none.

### Next

1. D3 and D4, bugs in the MCP's text reader.
2. D1: why the chooser keeps `List Station` a linked list (C227).
3. D2: unit checks that summarise a program's own callees, and that solve
   each definition's system once (I278).
4. D5, then the record copies in D6, measured first.

### After the fixes

D3 (I279) and D4 (I280) were fixed in the text reader, and D2 (I278) took
depot's cold `ters check` from 9.1 s to 2.0 s. D1 (C227, #2696) wasn't the
chooser's order: the lists were turned down as arrays because `set`, a
builtin, was given a World holding a list, and the boundary let only
builtins that pass their value on take a list it couldn't convert. `set`
gives back the record it's given, of the program's own type, so it passes
too. Lists are now arrays beside the map's tree. A day, against the ideal:

| stations | core | native | wasi |
|---|---|---|---|
| 160 | 4.7x (was 27x) | 6.0x (was 46x) | 5.4x (was 37x) |
| 640 | 8.5x (was 156x) | 11.9x (was 207x) | 9.0x (was 194x) |

## Round 18: pack, LZ77 and Huffman coding (2026-11-15)

`compiler/gaps/pack` makes up a document and packs it the way DEFLATE does at
heart, then unpacks it and checks that the bytes come back:
- the document is words drawn from a vocabulary of 40 by a linear
  congruential generator from seed 2026, with now and then a full stop or a
  comma;
- LZ77 (Ziv and Lempel, 1977) finds, at each position, the longest earlier
  run of 3 to 258 bytes, through hash chains as zlib keeps them: a
  `Map Int (List Int)` from each three-byte key to its 16 latest positions,
  the most recent tried first;
- the tokens' symbols (a byte, or 256 + n − 3 for a copy of n) are counted,
  and a Huffman tree (1952) is built from a `Priority queue Int Tree`, the
  two lightest joined first;
- each token is written as its code, a copy's distance after it in 15 bits,
  and the bits are packed eight to a byte;
- the bytes are read back through the tree, the copies made again, and the
  Adler-32 checksum (RFC 1950) compared with the document's.

It prints four lines: the document's size and checksum, the tokens, the
packed size, and the checksum of what came back. It was chosen to try what no
round had: bytes from text (`utf8 of`, `byte items`), bits shifted and
packed, a map whose values are lists, a priority queue of trees, and a long
list read by position. **40 definitions** (2 types, 38 functions and values).

It was written through the MCP, like rounds 12 to 17
(`gaps-round18/drive.ts` in the project's files): 40 `define`s and one `as`
answer (`copied`'s map, as `List`). No definition was refused.

Files:
- `compiler/gaps/pack/`: the program and its README (credits).
- `compiler/gaps/pack.ideal.js`: the same by hand. The bytes are an array,
  the chains a Map of arrays, the queue a binary heap ordered by weight and
  then by when each tree was added, so it builds the same tree and prints the
  same lines.
- `compiler/gaps/pack.ts`: the evaluator, the core IR's module and the ideal,
  in one process.
- `compiler/test/pack.test.ts`: the three print the same on 200 words, on
  none, a few and arguments that aren't numbers, and the core IR and the
  ideal on 800 words. `ters wasi` and `ters native` print what `ters run`
  prints on 300 words.
- `compiler/gaps/bench-pack.ts`: the table below.

**Correctness.** The evaluator, the core IR's module, `ters native`,
`ters wasi` and the ideal print the same at every size tried, up to 3200
words. Each of the five agreed the first time.

### Results

```
words  way        packed and back   against the ideal
200    evaluator      976 ms        476x
200    core            72 ms         35x
200    ideal          2.1 ms
200    native          27 ms         13x   (a process, start-up included)
200    wasi            85 ms         41x   (a process in Node)
800    evaluator     4153 ms        760x
800    core          1557 ms        285x
800    ideal          5.5 ms
800    native         687 ms        126x   (a process)
800    wasi           970 ms        177x   (a process in Node)
3200   core         31816 ms       2649x
3200   ideal           12 ms
3200   native       12066 ms       1005x   (a process)
3200   wasi         16697 ms       1390x   (a process in Node)
```

The command was `BUILT=1 RUNS=1 EVALUATOR=800 node compiler/gaps/bench-pack.ts
200 800 3200`. The ideal grows about linearly; the compiled ways grow as the
square of the words (P1 to P3).

### The gaps, ranked

**P1. Bytes kept every list as written (C229).** `xs = byte items(utf8 of(text))`
is the only place pack sees a `Bytes`. Bytes is a library type with a list
inside, so the lists' boundary (library-reps.ts `listBoundary`) refused the
whole program: a value whose type holds a list the rewrite doesn't change.
The split beside it (`splitByHolders`) was refused too, because its
converter can't convert a recursive type (the map's tree of lists, given by
`packing` to `codes` and `bits of`). So every list is a linked list read by
position: `key at`, `run length` and `bit at` walk from the front each time.
But Bytes has no type parameters, so it never holds the program's lists,
only its own; and the program never takes one apart. Only `byte items` and
`utf8 of` do, and they could be kept as written and called as a builtin is,
with their lists converted where they cross.

**P2. Equality on a stored list walks both lists (C230).** `packed` tests
`bits = nil` once a byte. On a tree or an array, `equal` is the meaning's,
so each test turns the whole of `bits` back into cons cells: n² over the
bits even with P1 fixed (about 90% of 3200 words' time). Two lists of
different lengths differ, and both rows know their length in one step.

**P3. A copy of `natural` misses Nat's own job (C231).** With lists stored,
`natural` (a fold over `range(i)`) is one of the library definitions the
lists' rewrite copies, since it has a list in it. Nat as an Int replaces
`natural` by its constant-time job, but it looks for the original's id, so
the copy is left and `natural(258)` builds a range of 258 and folds it for
each candidate `run length` tries: with P1 and P2 fixed, 60% of 6400 words'
time.

**P4. A remainder by a literal list's length performs Choice (L262).**
`remainder(n, length(vocabulary))`, `vocabulary` a literal list of 40 words,
performs Choice, as a remainder by 0 has no answer. The checker doesn't read
that a literal list isn't empty. `word for` was written with a guard,
`if w = 0 then "" else …`.

**P5. No reading an Int from text (L263).** `read number` gives a Float64,
so the count of words from the arguments is
`whole of(first(read number(…), else 2000.0))`. Ints have `show` but nothing
the other way.

**P6. Smaller things, seen, not rows yet.**
- `ters compile` of pack takes 6.7 s for 40 definitions, of which 4.7 s is
  choosing representations (`represented`): the program is checked again
  after each row chosen, three times here. depot (129 definitions) takes
  9.5 s, crew 10.4 s. The check alone is 1.0 s.
- `copied` needed a guard (`if back < 1 then nil`) for its remainder too.
- The evaluator is 480 to 760x the ideal.

### Next

1. P1, P2 and P3, in that order, measured after each.
2. P4 and P5, with the examples they came from.

### After the fixes

P4 was done by the language lane's L262 (#2753): a list written out isn't
empty, so `word for` lost its guard. L263 was closed, because
`read whole number` already reads an Int. P1 to P3 (C229 to C231) went in
one PR, since each needs the others before the program checks with its
lists stored:
- C229: Bytes, a library type with no parameters whose fields are plain
  lists, is passed about as it is. `byte items` and `utf8 of` stay as
  written and are called as builtins are, and what they do inside isn't
  weighed by the chooser. The CRC-32 beside Bytes (C192) is now arrays for
  the whole program, not a split.
- C230: a tree's and an array's `equal` compare lengths first.
- C231: a copy of a job is the job, so Nat as an Int replaces the copied
  `natural` too.
- With lists as trees, `length(vocabulary)` became the tree's size of a
  stored literal, so L262's proof was lost and `packing` did Console while
  a Choice was open. signs.ts now reads the rows' lengths and stores as
  `length` and the list.

The lists are trees. Packed and back, against the ideal:

| words | core | native | wasi |
|---|---|---|---|
| 200 | 5.1x (was 35x) | 5.2x (was 13x) | 26x (was 41x) |
| 800 | 14x (was 285x) | 7.9x (was 126x) | 26x (was 177x) |
| 3200 | 41x (was 2649x) | 12.5x (was 1005x) | 38x (was 1390x) |
| 12800 | 59x | 23x | stack overflow |

The command was `BUILT=1 RUNS=3 node compiler/gaps/bench-pack.ts 200 800
3200 12800`. It is no longer n², but it still grows faster than the ideal,
because `item at` on a tree is log n where the ideal's array is one step.
Under WASI, 6400 words and more now overflow the stack. A recursion on the
stored lists goes as deep as the bytes (C232). Before, those sizes took
minutes. Native runs 12800 words.

C232 is done too. `prose`, `tokens` and five more definitions cons onto a call
of themselves. Now they append at the back and call themselves in tail
position, a loop (cons-onto.ts), so `ters wasi` runs 6400 and 12800 words.
That size also showed a bug in pack itself: a copy could reach more than
32767 bytes back, more than its 15 bits can say, so 12800 words came back
different in every way and in the ideal. `best match` now takes only
candidates within 32767 bytes. Against the ideal now:

| words | core | native | wasi |
|---|---|---|---|
| 3200 | 25x | 16x | 34x |
| 12800 | 26x | 16x | 25x |

The lists are arrays now (C233, C234). An array's `append` writes the
shorter list onto the longer one's free end, in place when no other array
has taken it, where it made a new array of both. The chooser counts an
append onto what a loop carries (`unpacked(rest, append(out, [b]))`, and
`flatten`'s `append(x, the rest's answer)` under `flat map`) as the array's
own job, constant, so it takes arrays over the tree; `item at` is one step
again. With arrays a map on workers in `code tree` crashed, since its
columns read the workers' plain array (C233). Against the ideal now:

| words | core | native | wasi |
|---|---|---|---|
| 200 | 11x | 5.3x | 34x |
| 800 | 9.0x | 3.3x | 18x |
| 3200 | 14x | 3.2x | 12x |
| 12800 | 17.5x (was 26x) | 2.8x (was 16x) | 7.5x (was 25x) |

The command was `BUILT=1 RUNS=3 node compiler/gaps/bench-pack.ts 200 800
3200 12800`; native and wasi include starting the process.

C240: `tokens`, `prose` and the rest cons onto a call of themselves, and on
an array that cons stayed a recursion as deep as the items. In the core
IR's JavaScript every call more than a thousand deep runs as a generator,
so everything `tokens` called (the run lengths, the chains' tree) ran so.
cons-onto.ts now applies on arrays too, since an append onto what a loop
carries is a push there. Against the ideal at 12800 words:

| words | core | native | wasi |
|---|---|---|---|
| 3200 | 8.6x (was 14x) | 3.1x | 12.8x |
| 12800 | 7.8x (was 17.5x) | 3.0x | 9.1x (7.5x before, about 20% slower) |

WASI loses some: each item appended is made as an array of one first.

That is where this stops: at 51200 words the core IR is 7.5x the ideal,
and what is left comes in pieces under 10% each. Garbage collection takes
about a third of the time. `run length`'s `1 + itself` is about a tenth.
An array of one made from empty with less room measured within the noise.
The final `equal` walks the items as cons cells.

C250 then took the array of one away: cons-onto adds each item with the
prelude's `added at end`, an array's push. At 12800 words the core IR is
5.9x the ideal (was 7.8x), native 3.0x, WASI 277 ms (was 305; 247 before
C240). WASI's profile is about half garbage collection.

## Round 19: scan, regular expressions made automata (2026-11-15)

`compiler/gaps/scan` makes up a server log and scans it with 19 regular
expressions, each made an automaton three ways:
- the log is 2000 lines (or as many as asked) drawn by a linear
  congruential generator from seed 20261115: a time, a level, a host, a
  user, a private address, a request in quotes, how long it took, a
  hexadecimal id and a few words;
- a pattern's text is read by recursive descent (three definitions that
  call each other, on Nat fuel) into a `Regex`: classes `[...]` and
  `[^...]` with ranges and escapes, `.`, groups, `|`, `*`, `+`, `?` and
  `{m}`, `{m,}`, `{m,n}`, with `^` and `$`. It is made simpler, written
  back as text and read again;
- Thompson's automaton is built from the end back, as a `Map Int Step`;
- the characters are cut into classes every edge treats alike, and the
  subset construction makes a `Dfa`: a `Map (Int, Int) Int` of moves from
  a state and a class, a `Set Int` of final states;
- Moore's refinement gives the fewest states, and a breadth-first search
  over pairs of states checks that it matches the same texts;
- every line is searched for each rule's leftmost longest match by all
  three automata, and again from its end by the reversed expression's;
- the report gives each rule's states and matches, a line with its match
  marked, the users and hosts seen most, the slowest request, a shortest
  text each rule matches, and the texts two rules both match whole.

It was chosen to try what no round had: a parser of a small language,
mutual recursion, an automaton as a map with tuple keys, sets of states
as keys of a map (`Map (Set Int) Int` in the subset construction), and a
hot loop of one map lookup per character. **146 definitions** (8 types,
138 functions and values), against depot's 129 and pack's 40.

It was written through the MCP (`gaps-round19/` in the project's files:
`head.ts` and `body1.ts` to `body4.ts`, run as one driver). No `replace`
was refused once the text was right, and eight `as` answers were given
(`pick`'s List, five tuples' sizes, `compiled of`'s Rule). The text had
to be changed four ways first (S6).

Files:
- `compiler/gaps/scan/`: the program and its README (credits).
- `compiler/gaps/scan.ideal.js`: the same by hand. Expressions are plain
  objects, the automaton's states parallel arrays, a set of states a
  sorted array made with a mark per state, a DFA's moves an `Int32Array`
  indexed by state and class. The class of a code is found as the program
  finds it, counting the borders at or below it, so the comparison is of
  what the compiler makes of the same algorithm.
- `compiler/gaps/scan.ts`: the evaluator, the core IR's module and the
  ideal, in one process.
- `compiler/test/scan.test.ts`: the three print the same on 40 lines, on
  none and one; the core IR and the ideal on 400 lines and on arguments
  that aren't whole numbers. `ters wasi` and `ters native` print what
  `ters run` prints on 200 lines.
- `compiler/gaps/bench-scan.ts`: the table below.

**Correctness.** The evaluator, the core IR's module, `ters native`,
`ters wasi` and the ideal print the same at every size tried, up to 8000
lines, once S1 was worked around. Each agreed the first time. Writing the
ideal found a bug in the program itself, which was fixed before measuring:
a class printed with a range whose ends were escapes (`[^\t-\r G]`, what
`[^G\s]` leaves out) didn't read back, since the reader took a range's
ends only as characters. They may be escapes now, and `\r` is one.

### Results

```
lines  way        scanned   against the ideal
200    evaluator  22244 ms   325x
200    core         309 ms   4.5x
200    ideal         69 ms
200    native       312 ms   4.6x   (a process, start-up included)
200    wasi         283 ms   4.1x   (a process in Node)
2000   core        2792 ms   3.9x
2000   ideal        714 ms
2000   native      2735 ms   3.8x   (a process)
2000   wasi        1974 ms   2.8x   (a process in Node)
8000   core       11258 ms   4.1x
8000   ideal       2729 ms
8000   native     11177 ms   4.1x   (a process)
8000   wasi        9597 ms   3.5x   (a process in Node)
```

The command was `BUILT=1 RUNS=3 node compiler/gaps/bench-scan.ts 200 2000
8000`. Every way grows linearly, as the ideal does: the gap is a constant
factor, unlike pack's and depot's. The lists were chosen as written (Map as
a weight-balanced tree, Nat as an Int), and `ters compile` takes 7.5 s.

Where the core IR's 2.8 s at 2000 lines go (a CPU profile of the run
alone; shares are inclusive and overlap):
- `dfa next`, one per character per automaton: 25%. Of that, `class of`
  is 14%, as in the ideal; the rest is the map lookup (S2 to S4);
- `codes of`, one per line per rule: 21% (S5);
- `nfa step`, the automaton itself: 17%, its sets of states sorted lists
  with `append` (S8);
- the garbage collector: 13%, most of it the allocations of S2 to S5.

### The gaps, ranked

**S1. A builtin passed as a value isn't compiled (C235).**
`for each(lines, print)` is refused by the core IR, `ters wasi` and
`ters native` alike: "main isn't in WebAssembly: calls scan, which uses
print as a value (functions and data need a heap)". The evaluator runs it.
`print` is an effect's operation, so the lowering only knows it called.
Written `(line) => print(line)` it compiles: the compiler could make that
lambda itself where an operation or builtin is used as a value.

**S2. A record a loop passes on is made again at each call (C236).**
`dfa longest(d, s, cs, pos, best, at end)` is a loop; the loop keeps the
five fields of `d` as its own variables, and so each character calls
`dfa next(new K24(l0, l1, l2, l3, l4), s, c)`, a new `Dfa` record built
to be read at once. `dfa found from` does the same around it. The loop
could keep `d` itself as well, since it never changes, or pass the fields
on to a copy of `dfa next` that takes them.

**S3. A lookup with a default is a try (C237).** `first(value at(d.moves,
(s, cls)), else -1)` compiles to a `try` around the lookup, a check for
`R.FAIL` and a `catch` that restores the depth, once per character. A
`first` whose search is one lookup that fails at once has no backtracking
to catch: a lookup that returns a default would do.

**S4. A map with pair keys is read through a tree, a tuple made per read
(C238).** The moves are a `Map (Int, Int) Int`, built once and then read
14 million times for 2000 lines (counted in the ideal); each read allocates the key `(s, cls)`
and walks a weight-balanced tree comparing tuples. The ideal indexes an
`Int32Array` by `s · classes + cls`. A map built once and only read could
be a hash table (C63's tables), and a tuple key read field by field
needn't be allocated.

**S5. Codes from a text go through a list of one-character texts (C239).**
`codes of(t) = map(characters(t), code of)`: `characters` splits the text
(with a surrogate check by regular expression) into a list of texts, and
`character code` of each is a `Choice`. The ideal walks the code points.
`map(characters(t), f)` with `f` reading the code could be fused into one
walk over the text, as C23 fused `characters` with a fold.

**S6. Text the MCP doesn't read (I303).**
- A `match` must start a line or a case's body: `(match b …)` inside a
  case and `if … else match cs …` are "isn't read as a whole", though the
  view never prints them so (it puts a match on its own line). Each was
  rewritten: a helper (`class or either`), or the `if` moved into the
  cases.
- A field read on a tuple asks its size: `p.first` on a triple asks
  `as` (Tuple2 or Tuple3), and the first answer the driver gives is
  Tuple2, which then fails at `p.third`. It took `as: "Tuple3"` for
  `pair move` and `overlap from`. This is I218c working as designed, but
  the question could look at the other fields the definition reads.
- A definition used before it is written needs a hole first (`declare` in
  the driver): `parse alt`, called by `parse atom`, was "there's no
  function named parse alt". Writing it with a hole first works.

**S7. Writing a long definition is slow (I304).** The 146 definitions
took 7 minutes through the MCP, 2.9 s each, and `scan`, with 18 steps, 75
s: each step's `replace` checks the program again. The check alone is
about 1 s.

**S8. Smaller things, seen, not rows yet.**
- `ters native` is no faster than the core IR's JavaScript here (4.1x
  both at 8000 lines), where on pack it was 1.5 times faster. Its cost wasn't looked at.
- The automaton's sets of states are sorted lists (`Set Int` isn't chosen
  as a tree here, rightly for sets of a dozen), and `grown` appends each
  state's successors to its list of states to visit.
  The ideal uses a stack and a mark per state.
- `nfa longest` and `dfa longest` came out generic in their positions
  (`a where a is a Number`), since nothing but `+ 1` and `−1` fixes them.
  They are specialized at Int, but the additions still go through
  `int.add`, which checks for overflow (2.7%).
- The evaluator is 325x the ideal.

### Next

1. S1 (C235), a correctness gap on every compiled target.
2. S2 to S4 (C236 to C238), measured after each on the 8000 lines.
3. S5 (C239), then S6 and S7 (I303, I304) for the MCP.

### After the fixes

C235 (#2767) compiles `for each(lines, print)` on every target. C236 (#2768)
keeps a record passed on unchanged and also used whole in one piece, and C239
(#2769) walks a text's codes without a list of one-character texts. At 8000
lines, against the same ideal:

| Way | Before | After |
|---|---|---|
| core | 12.6 s, 5.2x | 7.7 s, 2.8x |
| native | 11.2 s, 4.6x | 10.8 s, 4.0x |
| wasi | 10.1 s, 4.1x | 9.0 s, 3.3x |

(`BUILT=1 node compiler/gaps/bench-scan.ts 8000`; native and wasi are
processes, start-up included.) Native and wasi gained less than core;
why wasn't looked at (S8). C237 and C238
were measured by hand-patching the compiled program, under 2% and about 4%,
and closed without a pass. What is left is the program's own linear class
lookup walked on a cons list, the tree reads, and GC.

S8's first point, native no faster than core: its time went to reference
counts. The walks that only read, the transition tree's lookup and the class
lookup's list, took each cell apart as they went, a dup of every field and a
drop of the cell per step: 2 billion `lab_drop` calls at 8000 lines. C241
(this PR) lends data that a function only walks, through its match and its
loop, so a lookup takes no counts. Same run, same output:

| Way | After C235-C239 | After C241 |
|---|---|---|
| native | 10.8 s, 4.0x | 7.1 s, 2.6x |

(core 8.6 s and wasi 8.7 s in that run, unchanged by C241.)

C242 made a call let to a local and given back a tail call in C, so the
tree lookup going on into a branch is a round of its loop: 7% fewer
instructions. What was left on native was the reads of the DFA's moves,
a `Map (Int, Int) Int` kept a tree, 18.6% of the instructions, because
the same program's other Maps are keyed by a Set and a List, and a hash
table was chosen only where every Map's key was Ints, Texts and tuples of
them. C243 (HASH-KEYS-2026-11-15.md) lets C's tables take keys that are
data, hashed, compared and ordered by their case, then their fields, so
all of scan's Maps are hash tables in C:

| Way | After C242 | After C243 (C) |
|---|---|---|
| native | 7.0 s | 6.0 s, 2.4x |

(the two binaries timed in turn; core 7.2 s, 2.9x, and wasi 8.8 s, 3.6x,
unchanged, in that `bench-scan.ts` run.) JavaScript keeps the tree: its
tables hold a key by its spelling, and spelling a pair of Ints on every
read made core slower, 8 s to about 14 s, when tried.

C243c does the same for WebAssembly's tables (wasm-table.ts): each data
type a key reaches is walked by its own three functions, its hash, its
equal and its compare. There the tree lookup was a fifth of the time, and
the tables pay more than in C:

| Way | After C243 (C) | After C243c |
|---|---|---|
| wasi | 8.2 s | 5.6 s |

(the two modules run in turn under Node's WASI, 8000 lines, same output
as native's.)

Where round 19 stops. Native's instructions at 1000 lines after C243
(callgrind) leave no stage worth a tenth:

- the program's own class lookup, a linear walk of a cons list, 19%
  inclusive, 7 points of it `lab_int_add` called for its position (20
  instructions a call, a small-Int fast path inlined would save under 4%);
  as an array it is the same walk (C237, under 2%);
- copying the DFA record in and out of calls, `Dfa_dup` and `Dfa_drop`,
  7%;
- allocation (`lab_new`, `lab_fields`, `lab__dead`) about 12%, spread over
  the NFA's steps.

Core keeps the tree (C243 doesn't pay in JavaScript), and its largest part
is the same class lookup. The round stops here: core 2.9x, native 2.4x,
wasi about 2.3x the ideal at 8000 lines.

## Game round 1: moths, boids on a grid hash (2026-11-17)

The first program of the game plan (GAME-READINESS-2026-11-17, BACKLOG
G3): `compiler/gaps/moths`, 61 definitions written through the MCP. Ten
thousand moths flock by Reynolds's boids in a 256 m garden that wraps
round, drawn to whichever of four lamps is lit. Each tick the moths are
filed in a grid of 8 m cells (a list of moth numbers per cell, built with
`replace at` and `cons`), and each moth looks only at its own cell and
the eight around it, in a `map` that only computes. This is the update
loop a game spends its frame on, and the shape the CPU side was tuned for
(drift, herd, pond).

The ideals, `moths.ideal.c` and `moths.ideal.js`, keep the moths as
columns and the grid as a counting sort (cell starts and moth numbers),
walk the cells in the program's order and add in its order, so every way
prints the same digits. All ways agreed the first time
(`compiler/test/moths.test.ts`: evaluator, core, wasi, native).

### Results

`node compiler/gaps/bench-moths.ts 100 3000 10000`, every way a process,
start-up included, median of 3, this container (4 cores):

| way | 3,000 moths | 10,000 moths | against C |
|---|---|---|---|
| C, one thread | 0.10 s | 0.68 s | 1x |
| C, OpenMP on 4 cores | 0.04 s | 0.20 s | 0.3x |
| JavaScript by hand | 0.45 s | 1.32 s | 1.9x |
| `ters native`, one thread | 0.42 s | 2.24 s | 3.3x |
| `ters native`, 4 threads | 0.47 s | 2.14 s | 3.1x (10.7x the OpenMP C) |
| `ters wasi` | 1.55 s | 9.98 s | 14.6x |
| `ters compile`, one thread | 1.68 s | 13.52 s | 19.8x (10.2x the JS by hand) |
| `ters compile`, workers | 1.47 s | 9.84 s | 14.4x |

Threads buy nothing natively (2.24 to 2.14 s; C gets 3.4x from them), and
the compiled JavaScript is 10x the hand-written JavaScript on one thread.

### The gaps, ranked

**M1. A three-item `map` inside each moth's work is sent to the thread
pool, and the nine cells are a list made per moth (native, 26%).**
`around cells` is `flat map(offsets, (dy) => map(offsets, (dx) => …))`,
and its inner map over `[-1, 0, 1]` is a parallel map (`lab_par_map_2`)
called from inside the outer map's work, which is already on a thread:
callgrind at 3,000 moths puts `around cells` at 26% inclusive, most of it
the pool's own work for three items. The list of nine cells is then made
and dropped for every moth. Two fixes: a map inside work already sent
away runs in turn (and a map over a list known to be short never leaves),
and a list made only to be walked once (`flock over` walks it) becomes
the loop that makes it, which is deforestation (Wadler, 1988).

**M2. A cell's moths, a `List Int` stored as an array, are walked by
`match`, and each `rest` makes a new array view (native, about 25%).**
`gathered` matches its list `cons(j, rest)`: `lab_array_first_a2`,
`lab_array_rest_a2` (9%), `lab_new`, `lab__dead` (12%) and `free` for
every moth looked at. The ideal walks an index. A list read by a match
that walks it to its end, in a function that calls itself on `rest`, is
an index loop over the array (C227 did this for `item at`).

**M3. Threads give 1.05x (native).** 93% of the time is under the moths'
map on the pool, so this is not Amdahl. Every moth's work allocates (M1,
M2, the Flock and Vec records), and the threads share one allocator. To
be measured again after M1 and M2; if it holds, per-thread arenas for
work sent away (REGIONS.md measured regions for one thread only).

**M4. Compiled JavaScript: a record per neighbour, and finite checks on
constants (core, 10x the hand-written JS).** `met`, called for every pair
of moths in the nine cells, is 55% of the samples on its own: it makes a
`Vec` for the offset and a `Flock` for the sum on every call, checks
`d2` and the constant `64` for finiteness before comparing them
(`l5 - l5 === 0` on a literal), and reads fields as `f0 ?? fields[0]`.
The garbage collector is another 8%. The C target keeps these records in
registers (owned-records.ts); the JS target needs the same for records
that never leave a function, and no finite check on a literal.

**M5. WebAssembly is 14.6x.** Not profiled yet; likely M1, M2 and M4 at
once, since it lowers the same IR.

Profiled 2026-11-20 (G3e), 300 ticks of 3000 moths through Node's WASI,
built with `TERS_WASM_NAMES=1` so the profile names functions. By then
the run was 11.3x the C (1.75 s for 100 ticks). `array.replaceAt` was
24%: filing the moths by cell copies the whole cells array for every
moth, because WebAssembly has no counts and the one value `empty grid`,
named every tick, isn't one holder's (G3f). The GC was 16%, mostly those
copies. `met` and its loops over the cells were about 30% (M4, G3d).
Small runtime functions Node's V8 doesn't inline, such as an array's
item, `int.less` and `int.small`, were about 10% (G3g).

**M6. The MCP offers the wrong type for a field two types share.**
`l.place` with `Moth` and `Lamp` both having `place` asks `as`, and the
first type it offers was Moth. Known since round 20's notes (the `as`
question doesn't read the rest of the definition).

### Proposed order

M2 and M1 first (native, each a quarter of the time, and they also feed
M3), then M3 measured again, then M4 for pages, which is where the game's
first slice (G6) runs. Rows G3a to G3e in BACKLOG.md.

### After G3a and the first half of G3b

- **G3a (M2):** array-offsets.ts (C196, JavaScript's) now runs for C and
  WebAssembly too, its count an Int there: a cell's moths are read by
  position through the borrowed array, with no view made a step.
- **G3b, first half (M1):** a map's runtime on C, when it is already on
  the threads or there are no threads, runs its items in turn into the
  answer, with no copies of its items, no clock and nothing put aside
  (c.ts `parC`). The nine cells are still a list made per moth: the
  second half (a list made only to be walked, made the loop) is open.

| way, 100 ticks, 10,000 moths | before | after |
|---|---|---|
| `ters native`, one thread | 2.24 s | 1.95 s (2.9x C) |
| `ters native`, 4 threads | 2.14 s | 1.73 s (2.6x C, 8.2x the OpenMP C) |
| `ters wasi` | 9.98 s | 10.03 s |

**M3, found since: the thread pool's cost per item.** With 3 workers the
threads do 2.7x the CPU work of one thread (user time 5.5 s against
2.0 s) for 1.35x less wall time, and two threads give no speed-up at all.
Each moth's work is about 2 µs, and per item the pool changes counts
that every thread shares, atomically: a count measured at about 4.8
taken and 4.8 dropped per moth, a million on the map's closure alone
(`lab_par_one` takes a count of it for each item, and the closure's code
drops it), most of the rest on what the closure captured and on the
grid's cells as they are read. All on a few cache lines, from four
cores. The ideal has none. Fixes, G3c: a worker lends the closure and its
captures to the items it runs (the closure's body as a borrowed
function, as `_b` functions already are), takes items in runs rather
than one at a time, and reads a cell of a shared array without a count
(the bucket read in `flock over` measured alone: 1.83 to 1.58 s).

### G3c, first part: what a map shares isn't counted while its threads run

A map whose answers hold no cell (moths' answers are records of
Float64s) now freezes what it shared while the threads run its items
(c.ts `parC`, `lab_freeze` and `lab_thaw`, which a count's job already
did, I216): the closure, what it captured and the arrays they hold have
a count of 0 for the job's length, so taking and dropping them costs
nothing and touches no shared line. Nothing made in the job can keep
one, since the answers hold no cells.

| moths, 100 ticks, 10,000 | before | after |
|---|---|---|
| `ters native`, one thread | 1.95 s | 1.85-1.97 s |
| `ters native`, 4 threads | 1.73 s | 1.03-1.12 s (1.8x one thread; the OpenMP C gets 3.2x) |

Left of M3: with 3 workers the threads still do about 1.8x the CPU work
of one (3.6 s against 2.0 s). Each moth is about 2 µs of work, and each
item still takes its slot from one shared counter; the next step is
items in runs, measured.

### G3c, second part: the threads take items in runs

Each thread took one item at a time from the map's shared counter, and
told another shared counter (the items run on threads, for
`TERS_BRANCHES=say`) after every item, and the answers of neighbouring
items, written side by side, came from different threads. Now a thread
takes a run of items at once, an eighth of its share (moths: about 300),
and tells what it ran once, at its end (c.ts `parC`).

| moths, 100 ticks, 10,000 | before | after |
|---|---|---|
| `ters native`, 4 threads | 1.03-1.12 s | 0.79-0.83 s (2.4x one thread; OpenMP C 0.21 s) |
| CPU time, 4 threads | 3.6 s | 2.7 s (one thread 1.9 s) |

The threads still do 1.45x the work of one. What is left is per-item
work done on every thread: records made and dropped in `met` and
`flock over`, through malloc from four threads at once. That is G3b and
the allocation part of M1, not the scheduling.

### G3d, measured: compiled JS loses on layout, not on `met`'s code

`met` (what a moth sees of one more moth) is 55% of compiled JS's time
in a profile of 20 ticks (V8 optimizes it and never throws it out). It
is called about 87 times a moth a tick, at about 85 ns a call. The same
function, copied out and called 17.4 million times over 1,000 moths
kept close together, takes 25 ns a call. Removing the `f0 ?? fields[0]`
fallback from it changes nothing measurable (2.70 s against 2.68 s).

What differs is where the moths are. On JS a moth is three objects (a
Moth and two Vecs) and four boxed Float64s, made at different times,
and the neighbours `met` reads are spread over 10,000 of them, so most
reads miss the cache. C keeps the same list as an array of structs,
each moth 32 bytes in a row, and the hand-written JS keeps Float64Array
columns. columns.ts (C60) would do the same here, but it takes an array
only when its items are flat records read field by field. A moth holds
two Vecs, and `gathered` gives the item read whole to `met`, which is
too big to put in place. So G3d is a layout row: columns for records
holding records (a column per leaf field), with an item given to a
function as its fields. It goes with G1b, columns with presence bits.

## Game round 2: greenhouse (2026-11-17, BACKLOG G6)

The first slice of the game (compiler/gaps/greenhouse, 88 definitions;
examples/greenhouse-page, 98). Moths, plants and hung lamps are one
`Pool Thing`, each thing a place and optional parts, and a tick is three
systems over the pool (`updated in pool` twice, `kept in pool` once). It
is the shape ENTITIES.md says a game is written in. The round itself, with
hand-written ideals, is G6b. These are the first measures and what
writing it found.

| a night: 2,700 ticks, 2,000 moths, 24 plants | time |
|---|---|
| `ters native`, one thread | 10.8 s (4.0 ms a tick) |
| `ters native`, 4 threads | 13.4 s |
| compiled JS (Node) | 31.9 s (11.8 ms a tick) |
| the page in Chromium (compiled JS, painting too) | about 27 ticks a second, short of 30 |

Gaps found:

- **G6-1, counts on Optional parts (C265).** A Thing holds three
  Optionals, so on C each read of a moth takes a count on the Thing and
  drops it again. In 600 ticks that is 83 million Thing dups and 247
  million drops, where moths' Moth (Float64s only) had none. An item read
  only to be read should be borrowed.
- **G6-2, threads slower than one (C266).** The pool's maps give Things,
  which hold cells, so G3c's freeze doesn't apply and every item's shared
  reads are counted atomically. Four threads take 13.4 s, one 10.8 s.
- **G6-3, a cell of data holding a Bool (C264).** The page wouldn't
  compile while the gardener held `carrying: Bool`. It carries an
  `Optional Lamp` now, which is also the better entity, but a page's state
  with a Bool in it is ordinary.
- **G6-4, a cell holding a set crashed on every write (fixed here).** The
  held keys are a `Set Text`, compiled as a hash table, which has no
  fields. `equal` (run by every cell write) read them and threw, so key
  presses did nothing. It now compares two tables by their entries.
- **G6-5, the MCP server's memory (I317).** Writing the page ran out of
  the 2 GB heap at the 85th definition; 6 GB was enough.
- **G6-6, text the MCP reads (I318).** `x = …; match y` with the arms on
  the next lines isn't read, nor a match after `else`. The game names a
  function for each instead.

### The round (G6b): ideals and results

The ideals, `greenhouse.ideal.c` and `greenhouse.ideal.js`, keep the pool
as columns by slot (what each slot holds, its place, velocity, plant and
lamp, with generations and a free list), copy the moths out in slot order
each tick, file them with a counting sort, and add in the program's
order. They print the same digits as the evaluator, compiled JS, wasi and
native for a whole night, plants eaten and lamp moved included.

`node compiler/gaps/bench-greenhouse.ts` (a night, 2,700 ticks of 2,000
moths), every way a process, start-up included, this container (4 cores):

| way | a night | against C |
|---|---|---|
| C, one thread | 1.67 s | 1x |
| C, OpenMP on 4 cores | 0.59 s | 0.4x |
| JavaScript by hand | 2.71 s | 1.6x |
| `ters native`, one thread | 10.74 s | 6.4x |
| `ters native`, 4 threads | 13.23 s | 7.9x (22x the OpenMP C) |
| `ters wasi` | 29.03 s | 17.4x |
| `ters compile`, one thread | 30.97 s | 18.6x (11.4x the JS by hand) |
| `ters compile`, workers | 32.23 s | 19.4x |

Moths alone (round 1, after G3a and G3c) were 2.9x the C natively; the
pool of things with optional parts is 6.4x. So the shape ENTITIES.md
proposes costs about twice what plain records did, before any of G1b.

### The gaps, ranked

From callgrind on the native build, 150 ticks of 2,000 moths:

**GH1. Reading a moth by number costs its counts (C265, about a third).**
`item at` of a Thing dups it (three Optional cells), and the read is
dropped again after `met`: `Thing_dup` 9%, `lab_drop`, `lab_fields` and
`lab_dec` 15%, `item at` itself 9%. The ideal reads two doubles from
columns. A borrowed read fixes the counts; columns (G1b with G3d) fix the
reads.

**GH2. The nine cells are a list made per moth (G3b, about 16%).**
`around cells`, its inner parallel map, `lab_new` and `lab__dead`, as in
moths M1. Deforestation, the open half of G3b.

**GH3. Positions and moth numbers are big-capable Ints (C267, 9%).** The
walk over a cell's moth numbers keeps its position, the length and each
number as `lab_int`, with dup, add and sub checked for overflow.

**GH4. `item at`'s stand-in is built on every read (C268, small).** The
Thing given for a number past the end is made 32 million times a night
and never used.

**GH5. Threads cost (C266).** Four threads take 13.2 s against 10.7 s on
one, where the C gets 2.8x from OpenMP. The counts in GH1 are atomic once
shared, so C265 comes first and C266 is measured again after it.

**GH6. Compiled JS and wasi, 11x the JS by hand.** The same layout gap as
moths M4 (G3d measured: `met` is 25 ns alone and 85 ns in place), with
more objects per thing here (a Thing, its Vec, three Optionals). Columns
for records holding records and Optionals, G1b with G3d.

### Proposed order

C265 and C268 (native, a third of the night, small), then C267, then G1b
with G3d (columns with presence, which serves native, JS and the page),
then G3b's second half, then C266 measured again.

## Game round 3: flock (2026-11-18, BACKLOG G6d)

The stress test beside Night watch, as Ersagun asked: 3D boids
(compiler/gaps/flock, 57 definitions; examples/flock-page, 75). Birds
are a `List Bird` of plain Float64 records in a 120 m box cut into
12 x 12 x 12 cells of 10 m. Each tick files the birds by cell, and each
bird reads the 27 cells around its own (`around cells`, a `flat map` of
`flat map` of `map`) and steers by the birds within ten metres. The goal
sweeps the box on triangle waves rather than sin and cos, so the
evaluator, compiled JS, wasi, native and both ideals print the same
digits (`compiler/test/flock.test.ts`). The page flies 2,000 birds at 30
ticks a second and paints them in perspective at 60 frames a second in
Chromium.

The ideals, `flock.ideal.c` and `flock.ideal.js`, keep the birds as
columns, file them by a counting sort each tick, and walk the 27 cells
as three nested loops. `node compiler/gaps/bench-flock.ts`, 100 ticks,
every way a process, start-up included, this container (4 cores):

| way | 5,000 birds | against C | 20,000 birds | against C |
|---|---|---|---|---|
| C, one thread | 0.40 s | 1x | 3.25 s | 1x |
| C, OpenMP on 4 cores | 0.12 s | 0.3x | 2.04 s | 0.6x |
| JavaScript by hand | 0.82 s | 2.0x | 4.70 s | 1.4x |
| `ters native`, one thread | 1.43 s | 3.6x | 9.89 s | 3.0x |
| `ters native`, 4 threads | 0.55 s | 1.4x | 3.31 s | 1.0x |
| `ters wasi` | 6.04 s | 15.0x | 60.06 s | 18.5x |
| `ters compile`, one thread | 8.83 s | 21.9x | 120.41 s | 37.0x |
| `ters compile`, workers | 8.65 s | 21.5x | 66.07 s | 20.3x |

Plain records go a long way: native is 3x the C on one thread, and here
threads pay (2.6x on 4 cores at 5,000 birds, 3x at 20,000), where the
greenhouse's Things made them slower (GH5). Compiled JS falls furthest
behind, and grows worse with the flock's size.

### The gaps, ranked

From callgrind on the native build, 20 ticks of 2,000 birds, one thread:

**FL1. The 27 cells are a list made per bird (G3b, about two thirds).**
`around cells` builds 27 cell numbers as lists of lists, flattened:
`lab_flatten_b` 11%, `lab_wrapped_cell` 9%, `lab_around_cells_*` 10%,
`lab_par_map_1` 6%, `lab_cell_key` 4%, list pushes 6%, and the cells
made and freed again (`lab_new`, `lab__dead`, `lab_fields`) 21%. The
ideal's three loops make nothing. This is moths M1 and greenhouse GH2,
nine cells there, 27 here: the open half of G3b, deforestation, is now
the largest single gap in the game rounds.

**FL2. Cell numbers are big-capable Ints (C267).** The walk keeps cell
keys, positions and bird numbers as `lab_int`, checked for overflow.

**FL3. Compiled JS and wasi, 15x to 26x the JS by hand.** A bird is an
object holding two Vec3 objects, so 20,000 birds are 60,000 objects
re-made each tick, and the cell lists are more. The gap widens from 11x
to 26x as the flock grows, which points at the collector. Columns for
lists of records (G1b with G3d) and G3b both serve it.

The bird itself costs nothing in counts: `Bird` is passed by value in C
with no dups or drops, unlike the greenhouse's Thing (GH1, C265).

### On `neighbours` (2026-11-23, C292)

The flock now asks std's `neighbours` for the birds within ten metres of
each bird, as flock-page does, and its 13 grid definitions are gone. A
bird then adds its neighbours in their numbers' order, so the ideals do
too: each collects the near birds from the 27 cells, sorts them, then
adds them. Every way still prints the ideal's lines. C and WebAssembly
find them with the prelude's `neighbours on a grid`, copied into the
program (near-grid.ts). JavaScript uses its runtime's grid (near.ts),
given the places alone so the birds stay columns. 100 ticks of 5,000
birds, one run each:

| way | own grid (above) | on `neighbours` | C293 step 1 |
|---|---|---|---|
| C, one thread | 0.40 s | 0.45 s | 0.45 s |
| `ters native`, one thread | 1.43 s | 4.07 s | 2.87 s |
| `ters native`, 4 threads | 0.55 s | 4.18 s | 1.41 s |
| `ters wasi` | 6.04 s | 7.22 s | 5.12 s |
| `ters compile`, one thread | 8.83 s | 5.52 s | 5.98 s |
| `ters compile`, workers | 8.65 s | 5.51 s | 5.92 s |

Compiled JS gains a third. Native loses most: the Ters grid allocates a
pair per bird to sort by cell and a list per bird it sorts again, and
keeps big-capable Int keys. Its map isn't shared out on threads either.
That is C293.

C293 step 1: each cell's run is walked into a list in the birds' order
and the 27 merged, not consed and sorted (sorting was half the native
time); each bird's cell key is worked out once and its neighbours' are
that key plus each offset's step; and a `first` of a lookup no longer
counts as a Choice of the map's function (pure-branches.ts), so the
grid's map runs on the threads. What is left natively is the C backend's
general cost: every Int here big-capable (300 million `lab_int_dup` in 30
ticks), and the merges consing onto arrays they often copy.

### Proposed order

G3b's second half moves up: it is two thirds of the flock natively and
16% of the greenhouse, and it serves every target. Then C265 and C268
(the greenhouse), C267 (both), G1b with G3d (columns, which JS and the
page need most), then C266 measured again.

### After G3b's second half

`compiler/src/fuse-walks.ts`: a definition that walks a list carrying an
answer, called on a list made by `map` or `flat map`, walks what they were
given instead, through lets and a call of a definition that only computes
(`around cells`). `flat map` of `flat map` of `map` becomes three walks
with no list made, and the birds are met in the same order, so every way
still prints the same digits. It runs before the representations are
chosen, so it serves every target and the pages.

| 100 ticks, 5,000 birds, one thread | before | after |
|---|---|---|
| `ters native` | 1.53 s | 1.06 s (2.7x the C) |
| `ters compile` | 11.5 s | 7.9 s |

Callgrind now finds no list made or freed in a tick, and half the
instructions of before. What is left of FL1 is the cell arithmetic on
big-capable Ints (`wrapped cell` 17%, `cell key` 9%), which is FL2,
C267. The greenhouse's night is 18% shorter natively (its moths' nine
cells and its wave adding fuse too); moths' barely moves.

### Archetype tables (G4, 2026-11-27)

The greenhouse's systems each touch one kind of Thing: the moths fly,
the plants are nibbled and die. Each system's function is run on what
each shape of Thing says (compiler/src/pool-shapes.ts), and the call is
told the shapes it touches; the pool is then a table per shape
(map-tree.ts "tables"), and a told walk visits only its tables. Same
lines on every target. The bound was the greenhouse split into three
pools by hand (compiled JS 20% faster, native 14%).

| 600 ticks, 2,000 moths, median of 5 | slots | tables |
|---|---|---|
| `ters native`, one thread | 1.06 s | 0.95 s |
| `ters wasi` | 2.69 s | 2.31 s |
| `ters compile`, one thread | 3.98 s | 3.02 s |
| `ters compile` | 4.02 s | 3.18 s |

Two things made the tables slower than slots at first. A table's slots
read out of the list of tables and put back left the old list holding
them, so each removal copied its table; each change now walks the tables
once, taking the slots out as it goes. And `items = pool items(w.things)`
was still walked whole after both of its uses were told their shapes; a
let's pool items no longer read is now nil.

The tables also lost the flight's threads natively (C266): the function
given to `updated in pool` reached the slots' map through a walk of the
tables that passes it on to itself, which the check of what callers give
took for unknown. Passed on as it was, it now counts as what the other
callers give: `ters native` with its threads 0.87 → 0.69 s (four cores),
one thread as before. Running the plants' system beside the moths' (G5)
would save at most the plants' 1% of a tick: closed measured.

The flight itself over the threads (G25, 2026-11-27, four cores):

| 600 ticks, 2,000 moths | one thread | four |
|---|---|---|
| C by hand (OpenMP) | 0.38 s | 0.17 s |
| `ters native` | 0.97 s | 0.60 s |
| `ters compile` | 2.96 s | 2.92 s |

Natively the flight is on the pool already and scales as OpenMP's loop
does here; about a fifth of a tick's instructions stay on the main
thread (the captures shared each tick, the grid filed, the moths' items
kept). Compiled JavaScript never sends the flight to its workers: what a
function given by the caller does is known only on C (C266). Known on JS
too, with the pool's columns and items by shape made to cross, each tick
copies the 2,000 moths to every worker and their answers back, 7 ms
against the flight's 3.4 ms in turn.

## Round 20: strings, the instrument app's signal code (2026-11-22, C262)

`compiler/gaps/strings` is the bigger-program round on the instrument app
(INSTRUMENT-APP-2026-11-17, C262): the FFT, a pitch finder and the
looper's buffer, against code written by hand. It plucks a guitar's six
open strings and listens to them:
- each string is a Karplus-Strong string: a `Queue Float64` one period
  long, filled with noise from a linear congruential generator, each
  sample out of the front and the mean of it and the one before, a little
  quieter, in at the back;
- a fifth of a second in, each string is cut into blocks of 2048 samples
  (8 blocks, or as many as asked), and each block is heard three ways:
  YIN's normalized difference at every lag below 1024 (a million
  multiply-adds a block), the McLeod pitch method as the tuner example
  finds it (the library's `autocorrelation` by FFT, 4096 points), and the
  loudest partial of a Hann-windowed spectrum (`spectrum`, 2048 points);
- YIN's pitch is read off 12-TET (`nearest step`);
- the looper overdubs all six onto a loop of 12000 samples a block
  (`map` over `zipped`), undoes the last and redoes it.

**34 definitions**, all functions and values on lists, the library's
signals and tunings doing the rest. It was written through the MCP
(`gaps-round20/` in the project's files, `head.ts` and `body.ts`): no
`replace` was refused once the text was right, four `as` answers were
given, and the text had to change six ways first (ST6). The whole driver
runs in 12 s, against round 19's 7 minutes (I304's fixes).

Files:
- `compiler/gaps/strings/`: the program and its README (credits).
- `compiler/gaps/strings.ideal.js`: the same by hand: `Float64Array`s, a
  ring buffer for each string, one in-place radix-2 FFT. The in-place FFT
  does the library's arithmetic in the library's order (bit reversal is
  the recursion's evens and odds, each stage one level of it, the same
  twiddles), and sums are added from the end as `sum` adds them, so it
  prints the same digits.
- `compiler/gaps/strings.ideal.c`: the same in C, `cc -O2`.
- `compiler/gaps/strings.ts`: the evaluator, the core IR's module and the
  ideal, in one process.
- `compiler/test/strings.test.ts`: the three agree on no blocks; the core
  IR and the ideal on two and on arguments that aren't whole numbers, and
  YIN and McLeod's method hear each string at its pitch. `ters native` at
  two blocks and `ters wasi` at none print what the ideal prints.
- `compiler/gaps/bench-strings.ts`: the table below.

**Correctness.** The evaluator, the core IR's module, `ters native` and
both ideals print the same at every size tried. `ters wasi` does up to no
blocks and fails past them (ST3). The program's YIN found nothing at first:
the MCP had read its list pattern wrong (ST6), and writing the ideal is
what showed it.

### Results

```
blocks way        heard and looped   against the JS ideal
2      evaluator   113508 ms   921x
2      core           682 ms    31x
2      ideal JS        22 ms
2      ideal C         16 ms   0.7x  (a process)
2      native         159 ms   7.1x  (a process, start-up included)
8      core          2955 ms    34x
8      ideal JS        86 ms
8      ideal C         51 ms   0.6x  (a process)
8      native         630 ms   7.3x  (a process)
32     core         15163 ms    47x
32     ideal JS       325 ms
32     ideal C        186 ms   0.6x  (a process)
32     native        2417 ms   7.4x  (a process)
```

The command was `BUILT=1 EVALUATOR=2 node compiler/gaps/bench-strings.ts
2 8 32`. Native is 13x the C. The core IR grows faster than the ideal; at
8 blocks it is 2.8 s alone (`TERS_WORKERS=0`) and 3.3 s with workers
(ST4).

Where the core IR's 2.8 s at 8 blocks go, alone (a CPU profile, self
time): the garbage collector 25%; `zipped` made into a list of pairs for
YIN's difference 23% and the `sum` over it 11% (ST1); `highest` through
its heap stack 8% (ST2); `arrayOf` 5%. Natively (callgrind at 2 blocks)
it is the same walk: pushing the pairs 23%, the difference 16%, `lab_new`
11%, counts and frees 12%, the FFT 6%.

### The gaps, ranked

**ST1. `zipped` makes a pair per item, and a list of them, for its
consumer (C275).** `difference(xs, w, lag) = sum(map(zipped(take(xs, w),
take(drop(xs, lag), w)), (q) => (q.first − q.second)²))` is YIN's inner
loop. Every target makes the 1024 pairs, pushes them onto an array, maps
them and then sums: a million pairs a block. The ideal reads the two
arrays by position. fuse-walks.ts (G3b) fuses `map` and `flat map` into
the walk that consumes them; `zipped` of two lists read by position could
be read the same way, with no pair made: two thirds of the core IR's time
and of native's.

**ST2. A recursion that combines after its call is a heap stack in JS and
a deep stack everywhere (C276).** `highest(xs)` is `larger(x,
highest(rest))`, the tuner's own. Past depth 1000 the core IR goes
through a generator (`R.drive`, 8%); C runs on a 1 GiB stack; WebAssembly
has neither (ST3). The list's items could be walked into an array first
and combined from its end, in a loop, for any such definition whose
answer is the combination of an item and the call on the rest.

**ST3. `ters wasi` runs out of stack on a loop of 12000 samples (C276).**
"RangeError: Maximum call stack size exceeded" in `highest at Float64`,
12000 deep. The same fix as ST2.

**ST4. Workers make the blocks slower (C277).** `map(fs, (f) => yin
pitch(f, rate))` over 8 blocks goes to the workers: 3.3 s with them, 2.8
s without, 8 s of CPU. Each block is sent encoded as a list of 2048
Float64s per worker per map, three maps per string, and `shared` waits.
What a map item costs was measured, but not what sending it costs.

**ST5. A list of lists between representations was a definition used as
a value (C274, fixed).** `ters native` and `ters wasi` refused the whole
program: "main isn't in C: calls report, which calls string report, which
calls lists as written, which uses items of array as a value". rep-split
converts a `List (List Float64)` (the blocks) with `map(meaning(l),
items of array)`; now it maps a lambda that calls it.

**ST6. Text the MCP reads wrong, or refuses with the wrong reason.**
- A list pattern's rest, `[before, at, after, ..more]`, is read as a
  fourth item named "..more" (view prints `‹..more›`), so the arm matches
  only four items and YIN found no pitch. No refusal (I340).
- An unknown name at the end of a long `++` chain takes minutes to refuse:
  `"a" ++ show(2.5) ++ "b" ++ show(2.5) ++ "b" ++ nosuch` 7 s, four shows
  over 100 s (I341).
- Three refusals name the wrong thing (I342): a print of what a Float64
  `/` gives, inside `for each`'s lambda, is "for each takes 3 inputs,
  given 2" (the cause, Console while a Choice is open, shows when the print
  is alone); a let named `length` hides the function, and `show(length(
  layers))` is "string report works only on a Number with <"; `abs` reads
  as the Int one on Float64s, and the mismatch is reported two steps later
  at a print.
- A let that takes a record apart, `reading(called, place, octave, off,
  target) = nearest step(…)`, is "nothing is named called here" (I343);
  a match in a helper definition reads.
- `map(range(k), (i) => 0.0)` is a list of Ints, as the language says (a
  whole literal nothing fixes); not a gap.

**ST7. Smaller things, seen, not rows yet.**
- The evaluator is 921x the ideal (scan's 325x): YIN's million steps a
  block.
- `loudest partial` hears a high harmonic of most strings (the spectrum's
  tallest peak), as it should; tuners don't use it, which is why it is
  the third way.
- The looper's buffer is a list here, not a cell: C261 measured the cell's
  array, and the looper example keeps it there.

### Proposed order

C275 first: it is most of every target's time and fuse-walks.ts is where
it goes. Then C276, which also makes `ters wasi` run the program, then
C277. The MCP rows go to the lanes that own the reader (I340 first: a
program read wrong without a word).

### After C275

`compiler/src/scalar.ts` (zippedItems): a fold over `zipped(a, b)` of two
arrays is a loop over both, item k their items at k, from the shorter's
last back, as the fold over the array of pairs went; no array of pairs is
made. Every way prints the same digits.

| strings, 32 blocks | before | after |
|---|---|---|
| core IR | 15.2 s (47x) | 8.1 s (23x) |
| `ters native` | 2.42 s | 2.26 s (12x the C) |

Natively, callgrind at 2 blocks counts 36% fewer instructions; what is
left is the library's FFT on cons lists (`lab_new`, counts and frees
together 43%, `fft` 10%), the next stage after C276.

### After C276

deep-loops.ts (C222) takes `larger(x, highest(rest))` as `let r =
highest(rest) in larger(x, r)` where what is given beside the call only
reads, so its frames go on the heap: `ters wasi` prints what the ideal
prints at 2, 8 and 32 blocks (32: 3.8 s, 10.5x the JS ideal). The core
IR's generator for the same is 8% of its time, under the 10% rule.

### After C277

branches-rt.ts `shared`: a site's units run alone once, for their time,
and a site whose shared jobs twice in a row take as long as that runs in
place from then on; and a site marked so really does (its units went to
the workers from the second on). strings on three workers: 8 blocks 3.2 →
2.0 s, 32 blocks 12.7 → 8.2 s, as alone or a little better. What is left
of the core IR's 23x is the library's FFT on lists and the collector.

### C278, measured

Arrays for the library's FFT, autocorrelation and spectrum (the chooser
choosing between arrays and lists as written for each part) print the
same and are slower: at 32 blocks core 9.95 → 11.2 s, native 2.30 →
2.73 s. The FFT as the library writes it makes new lists at every level
on any representation, so arrays only add conversions. Not landed. What
the core IR spends its time on at 8 blocks: the collector 28%, YIN's
`difference` 22% (a pair made for every item of its zipped fold, then
taken apart), the FFT's maps and splits most of the rest.

### After C279

A list a loop builds onto a call of itself, the items so far kept newest
first, is turned round at the end in its own cells in JavaScript, not
made again (scalar.ts `turned`): strings at 32 blocks, three runs each,
core 9.6 → 8.3 s. No pair per item in YIN's zipped fold was tried too and
was within noise.

### Round stopped

The next stage would make fewer lists in the FFT: `map` over `numbered`
and over `zipped` as one walk each. Written so by hand in the library,
as an upper bound on what fusing them could buy, strings at 32 blocks
took 9.2 to 9.5 s in the core IR against 7.6 to 8.0 s as it is, three
runs each: slower, so no fusion row. With C278 measured the same way,
what is left is the collector on the FFT's lists as the library writes
them. The round stops there, at 32 blocks: core IR about 22x the JS
ideal, `ters native` 12x the ideal C, `ters wasi` 12x the JS ideal.

## Round 21: mini, a little functional language typed and run (2026-11-22)

`compiler/gaps/mini` is a program of another kind than round 20's signal
code, and bigger (92 definitions to strings' 34): a little functional
language written in Ters, symbols, trees and environments where strings
had numbers in lists.
- its text becomes tokens, and a recursive-descent parser reads `let`,
  `fun`, `if`, comparisons, sums, products and calls, every step a
  `Parsed` value handed on through a closure (`then parse`);
- algorithm W types it: unknowns in a `Map Int Ty` threaded through as a
  `State`, unification with the occurs check, let-polymorphism by
  schemes over an association list;
- an interpreter runs it: closures over association lists, a let's
  function knowing its own name;
- the report types and runs a corpus of fifteen (factorial, Fibonacci of
  20, compose, Church numerals, Ackermann, S K K, a pair by closures, and
  some that are wrong), and then a batch of generated programs (200, or
  as many as asked), each 4 to 12 lets of arithmetic, functions and
  choices, one in seven ill typed.

Written through the MCP (driver in project files gaps-round21/): 92
definitions, no refusals; a definition naming one not defined yet is
refused, so the parser's and the type printer's are declared first, as
round 19's were. The ideal is `mini.ideal.js`: recursive descent with an
index into an array of tokens, a `Map` of what each unknown was found to
be, exceptions for errors, linked frames for environments. Every way
prints the same; test/mini.test.ts holds them to it.

| mini | 200 | 2000 | 20000 |
|---|---|---|---|
| evaluator | 585 ms (111x) | | |
| core IR | 25.5 ms (4.8x) | 114 ms (4.5x) | 1086 ms (4.5x) |
| ideal JS | 5.3 ms | 25.6 ms | 241 ms |
| `ters native` (a process) | 15.8 ms (3.0x) | 85.8 ms (3.3x) | 792 ms (3.3x) |
| `ters wasi` (a process) | 52.5 ms (9.9x) | 151 ms (5.9x) | 870 ms (3.6x) |

Compiling it takes 2.9 s, against 0.5 s for strings.

**MN1. Two pure calls are planned for workers at every top-level call
(C280).** `resolved`'s `arrow(resolved(s, a), resolved(s, b))`,
`occurs in`'s `or`, and `append(unknowns in(a), unknowns in(b))` are two
calls that only compute, which branches-rt.ts `bothPure` may share out
(C61e). Each call met outside one probes up to eight levels for leaves,
throwing to stop each, and reads the machine's thread count again
(`SIZE`, `os.availableParallelism` through `getBuiltinModule`), before
`shared` runs them in place anyway: mini's types are a few nodes each,
met at every unification. About a fifth of the core IR's time
(1.08 s to 0.89 s at 20000, measured with the fix).

**MN2. A token's characters are made to read one of them (C281).**
`is name` reads `item at(characters(t), 0, "")`, `is number` walks
`all pass(characters(t), …)`: each makes a list of one-character texts,
two cells a character natively (`lab_text_characters` 6% of `ters
native`'s instructions, `chars` and `text$characters` 8% of the core
IR's time) to read the first, or each in turn.

**MN3. A text compared with a literal is counted and called (C282).**
The parser compares each token with keywords and marks (`t = "let"`,
`head of(ts) = "*"`): natively each is `lab_text_equal(lab_dup(t),
literal)`, a call that drops both after a length check and `memcmp`.
`lab_text_equal` is 10.7% of `ters native`'s instructions, `lab_dec` and
`lab__dead` (the counts) 13% more, some of it this.

**MN4. Checking mini takes 2 s, the modes 1.6 s of it (I344, the
checker's).** modes.ts `terminates`, under `lambdaMode` and `joined`, is
1.4 s of the 2.9 s compile: it decides which way each definition can run,
and the parser's closures handed to `then parse` and `expected`, each a
lambda inside a lambda, are asked again and again. For the lane that has
the checker (L266, a faster checker).

The evaluator is 111x the ideal, the interpreter's (L281).

Fix order: C280 (a fifth of the core IR, a runtime change), then C281 and
C282, which are most of what `ters native` does beyond the ideal's work.

### After C280

Two pure calls read the thread count once, and a site whose last call
took under a millisecond runs in place without probing (timed, so one
that grows is planned again).

| mini | 200 | 2000 | 20000 |
|---|---|---|---|
| core IR | 18.9 ms (3.5x) | 89.4 ms (3.5x) | 814 ms (3.5x) |
| ideal JS | 5.4 ms | 25.7 ms | 234 ms |

strings at 32 blocks stays 24x its ideal.

### After C281

A walk down `characters(t)` reads t in place by byte position: `is
name` and `is number` make no list of characters, and `all pass` on
them is no longer weighed for workers. 4 to 7% at 20000 (two runs each,
before → after):

| mini, 20000 | before | after |
|---|---|---|
| core IR | 835 ms | 799 ms (3.4x) |
| `ters native` | 803 ms | 744 ms (3.1x) |
| `ters wasi` | 837 ms | 824 ms (3.5x) |

The lexer's own walk (`tokens from`) still makes the list: it reads
`item at(rest, 0, "")` and `drop(rest, 1)` as well as handing `rest`
on, so it is not a walker.

### C282, measured

A text compared with a literal natively is `lab_text_equal(lab_dup(t),
literal)`. Patched by hand in mini's C into a borrowing compare (21
sites, no count up or down, inlined), it gives 737 → 697 ms at 20000
(five runs each), 5% of `ters native` alone. Not built: under the
round's 10%, and the change is c.ts's printing.

### Round stopped

The next stage buys under 10%. Round 21 ends at 20000 programs:

| mini, 20000 | at the start | at the end |
|---|---|---|
| core IR | 4.5x the ideal | 3.4x |
| `ters native` | 3.3x | 3.1x |
| `ters wasi` | 3.6x | 3.5x |

Left for other lanes: I344 (checking mini takes 2 s, modes.ts 1.6 s of
it, the checker's, L266) and the evaluator at 111x (L281).


## Sweep: every benchmark against its hand-written twin (2026-11-22)

After C283 and C284 closed, every `compiler/gaps/bench-*.ts` was run
once at its own sizes (greenhouse and native left out, routes stopped
at 400 s), to find where the compiled code is furthest from the ideal
or grows faster than it. Core IR against the ideal, smallest size to
largest:

| program | core/ideal | grows? |
|---|---|---|
| strings | 21.8x, 23.8x, 29.1x | slowly (round 20 stopped) |
| board | 22x, 14x, 15x, 35x | yes: adding a card 0.32 → 2.07 ms, the ideal's flat |
| crew | 3.0x, 12.1x, 27.3x | yes, past 50 tasks |
| fit | 17.3x, 17.1x, 19.2x | no |
| rota | 10.8x to 13.2x | no |
| notebook (as written) | 11x to 143x | yes; with trees or the table chosen 3.5 to 5x |
| clinic | 7.0x to 8.5x | no |
| flock, moths | 5.8x to 7.0x (wasi 5.3x to 8.5x) | wasi grows |
| pack, chapters, trek, depot, sheet (chosen), mini, scan, audio | 3x to 6x | no |
| machine, ledger, countdown | 1.6x to 3x | no |

And one far outside the rest: machine's `primes 20000` in WebAssembly
takes 11.2 s (the bench's own lowering) or 13.0 s (`ters wasi`)
against 35 ms in core IR and 27 ms native. The profile is 86%
`array.replaceAt.a1.i64` and 13% the collector: every store into the
machine's memory copies it. owned-arrays.ts (C56) can't take it, since
the program also keeps other Int arrays it reads after changing
(`report`'s `program` and `better`), and that holds for every Array of
Int at once. JS has no such case: its arrays are versions (Baker's
trick, array-view.ts), so a replace writes in place and leaves a note
for the old array. C285. `sort 1000` is the same (2.3 s against 0.25 s).

### After C285

WebAssembly's arrays are versions (wasm.ts `versioned`, `array.reroot`),
so machine's stores write one slot. bench-machine (median of three):

| program | wasm before | wasm after | core IR | native | ideal |
|---|---|---|---|---|---|
| primes 5000 | 810 ms | 6.3 ms | 8.7 ms | 9.7 ms | 3.6 ms |
| primes 20000 | 11,203 ms | 22 ms | 35 ms | 26 ms | 14 ms |
| sort 400 | 243 ms | 23 ms | 41 ms | 28 ms | 15 ms |
| sort 1000 | 2,345 ms | 139 ms | 248 ms | 146 ms | 90 ms |

### After C286

crew's tasks' array, built from the back by a function calling itself,
stays rows (columns.ts), so a task put in front goes into the room
instead of copying every column. bench-crew: 1,000 tasks 304 → 101 ms
(27.3x → 9.2x the ideal); 2,000 tasks 1.19 → 0.22 s.

### fit again, after the sweep (C288)

A fresh profile of fit at 5,000 points (core IR 0.70 s, ideal 34 ms):
13% each in the logistic's value and its gradient (`exp`), 13% the
collector, 4.5% making closures. Two causes:

- Every point at every step made three closures: `predict` applies
  `value at(model, x)`, and `slopes` the derivative of it, each made
  through the runtime. Fixed (C288, known-closures.ts): a closure made
  only to be applied at once is a call of its code, the captures given
  as inputs. 576 → 252 ms (19.2x → 8.2x).
- The program computes the model 2.5x as often as the ideal (4.96
  million logistic values against 1.99 million): a step's `sse` walks
  the points, then `sums` walks them again for the step it took, where
  the ideal keeps the sums it tested. That's how fit is written, not
  something the compiler adds.

### rota again, after the sweep (C289)

A fresh profile of `ters compile`'s rota at 14 x 16 (0.43 s from the
command line): the table read 13%, the tuple key's spelling 7% and its
quote test 2.5%, the collector 12%. The reads are `can work`'s: `on
slot` and `shift on` look up `(person, day)` and `(day, shift)`, and
`load of` a person's count, each read building a fresh text such as
`("Ada",3)` and hashing it again. Fixed (C289, table.ts `held`): a tuple
of Ints and Texts is spelled once and that spelling kept by its parts, so
a key met before gives the same text, with its hash, and none is made.
bench-rota core: 14 x 16 412 → 318 ms (12.7x → 8.7x), 21 x 18 1,101 →
843 ms (12.6x → 9.4x), the same output.

What is left is R4's: the rota's three persistent maps copied or
versioned per branch where the ideal changes arrays and undoes them, each
place's candidates a `keep`, a `sort by` on tuples (`merge by key` 4%)
and a `map`, and the `set tree has` of the plan's off days (3.4%). No
single piece of that is 10%.

### rota again, 11-26 (Language lane)

bench-rota core 6.5x to 8.8x the ideal (21 x 18: 1,069 ms against 128
ms). A profile of `ters compile`'s rota at 21 x 18 on one thread
(`TERS_WORKERS=0`, 1.13 s), by definition, time inside each:

| | ms | share |
|---|---|---|
| `can work` (each place's test of each person) | 571 | 51% |
| of it the tables' reads (`shift on`, `on slot`, `load of`: `value at` on the rota's three maps) | 267 | 24% |
| of those, the key's spelling kept (`held`, `kept`: two Map reads by its parts) | 130 | 12% |
| `sort by` (the candidates, keyed by (load, name)) | 190 | 17% |
| `set tree has` (the plan's off days) | 88 | 8% |
| the collector | 88 | 8% |

Tried by hand on the compiled module, the same output:

- `can work`'s `and`s worked out only while true. Its six tests are
  pure and end, so skipping the rest is invisible, though `and` is
  strict (L259). This took 1.12 to 1.05 s (6%).
- `sort by` as one array sort with the compiled compare, stable as the
  merge is. This took 1.05 to 1.03 s (5%). Built as a runtime sort
  (`list.sortBy`, giving the evaluator's cons cells), it made the bench
  slower, 0.87-0.92 s to 1.09 s, since the cells that come back aren't
  the program's own classes. Not kept.

Neither reaches the 10% bar alone. The tables' reads were three Map
reads each: a tuple key's spelling found by its parts (two), then the
table's own read by that spelling. Built: a map whose keys are pairs of
Ints and Texts is a Map by the first part of Maps by the second
(table.ts `PairMap`, given the pair as it is, core-js.ts tableSpec
`pair`): bench-rota core at 21 x 18 0.95-1.06 s to 0.88-0.93 s (7.9-8.7x
to 7.4-7.5x), the same output. What would close the gap
is the ideal's representation: the people and the days are numbered, so
each map is an array by position, with nothing hashed or spelled. That
is the chooser's (a map whose keys come from a list the program never
grows, kept by position). It was not built here, since the choice step
is the Compiler lane's.

### strings again, after the sweep (C290, measured)

A fresh profile of `ters compile`'s strings at 8 blocks, one thread (1.85
s from the command line, core IR in process 1.68 s, 20.6x): the
collector 31%, YIN's `difference` fold 26% (50 million items, one loop
over both arrays since C275), and the library FFT's maps, `zipped` and
`numbered from` most of the rest, as round 20 left them. Allocation
sampled over the run: 4.7 GB, a sixth of it the fold's pair per item,
the rest the FFT's lists.

- The pair per item, the record made of two array reads that may fail
  (out of range), split into its parts by chosen-parts.ts: the loop
  makes no pair and the output is the same, but 8 blocks went from 1.68
  to 1.75 s and 32 blocks from 7.57 to 7.50 s, five runs each. V8 already
  keeps the pair out of the loop's time. Not landed.
- The fold on its own, timed on the program's own arrays: 3.8 ns an item
  as compiled, 2.4 without the Int subtraction's runtime call and the
  pair, 1.0 on a Float64Array. At 50 million items the first step is 70
  ms of 1.7 s, 4%.

Nothing reaches 10%. What is left is the FFT as the library writes it
(C278: arrays slower; round 20: fused maps slower). Closed as measured.

### strings, the library FFT on arrays (L292, 11-26, Language lane)

The signals module's `fft` takes its list into one array and recurses
over it by start and step (`fft of array`), each transform filled where
it is made (fill-arrays.ts), never copied out into lists of evens and
odds or zipped. The roots of unity are worked out once for the whole
length: root k of a part `step` apart is the whole's root k·step, the
same bits, since 2π·(k·step)/(n·step) rounds as 2π·k/n does when step is
a power of two. So n/2 calls of `from polar` instead of n/2 at every
level; a pair of items at the bottom is put together at once (no arrays
of one item); each product a + b·root and a − b·root worked out where it
is used. The same sums of the same products in the same order, so every
target prints what it did (strings.test.ts, examples-agree on tuner,
strum-tuner, frets, looper). An array made in a loop given its length as
room first was tried by hand on the printed module: no change, not built.

| strings, 8 blocks | before | after |
|---|---|---|
| the FFT, one thread (profile) | 787 ms | 493 ms |
| core IR (bench, median of 3) | 2426 ms, 24.6x | 2014 ms, 19.2x |
| core IR, 32 blocks | 10455 ms, 26.7x | 9544 ms, 23.8x |
| native (a process) | 714 ms | 311 ms |
| wasi (a process) | 1011 ms | 873 ms |

What is left of the FFT in core IR is the fill's loop: a call per item
that makes a Complex for the push to take apart again, and the collector
behind it; YIN's `difference` loop is the next largest (its bounds check
per item, Compiler lane).

## Round 22: mnist, a network learning digits, raced against Python (2026-11-23)

Ersagun asked (2026-11-23): "Can we do ML, on the GPU? We have matrices
and tensors, we have differentiation. Why not race against python
solutions for those? An MNIST demo should be fine for now. Maybe we can
add two different optimization modes to it. One with SGD with Adam, and
one with second derivatives and Newton."

`compiler/gaps/mnist` is that demo, a program of another kind than any
round before: dense numbers, tens of millions of multiply-adds a step.
A network of 784 pixels, 32 tanh units and 10 digits (25,450 parameters)
learns MNIST's handwritten digits (LeCun, Cortes and Burges; the data is
fetched, never kept here) and is then tested:

- **adam**: 100 digits a batch, the gradient by backpropagation, a step
  of Adam (Kingma and Ba, 2015) with its usual settings;
- **newton**: 1000 digits a batch, a damped Newton step: conjugate
  gradients on the exact Hessian plus λI, 10 directions at most, stopped
  at negative curvature, λ by Levenberg-Marquardt (Hessian-free, as
  Martens did it in 2010). The Hessian times a direction is the same
  backward pass run on dual numbers, the parameters moved along the
  direction by ε (forward over backward, Pearlmutter 1994). The network's
  code is generic over its number type for that: Float64 for the
  gradient, Dual for the curvature.

Written through the MCP (driver in project files gaps-round22/): 59
definitions. The ideal is `mnist.ideal.js`: Float64Arrays in loops, the
backward pass and the R-operator written out. The Python is in
`mnist-python/`: NumPy (backpropagation and R-operator by hand, every
layer one matrix product) and PyTorch (its own differentiation:
`torch.func.grad`, and `jvp` of it for the Hessian, as the Ters program
does with duals). Starting weights, batches, Adam and Newton are the same
in all of them, and every way prints the same losses, λ and test count
(test/mnist.test.ts holds the core IR, the ideal, `ters wasi` and `ters
native` to it on made-up digits).

Times on this container (4 cores, no GPU), one run each, processes with
their start-up; for the Python, its time after its imports in brackets:

| mnist | adam 1000 | adam 10000 | adam 60000 | newton 1000 ×3 | newton 10000 |
|---|---|---|---|---|---|
| core IR | 2.43 s (16x) | 20.6 s (18x) | 97.8 s (21x) | 173 s (37x) | 471 s (35x) |
| `ters native` | 0.43 s (2.9x) | 3.57 s (3.0x) | 15.6 s (3.4x) | 12.9 s (2.7x) | 31.7 s (2.4x) |
| `ters wasi` | 1.86 s (12x) | 17.4 s (15x) | fails (DG6) | 109 s (23x) | 290 s (22x) |
| ideal JS | 0.15 s | 1.18 s | 4.64 s | 4.70 s | 13.3 s |
| NumPy | 0.12 s (17 ms) | 0.29 s (0.18 s) | 0.69 s (0.60 s) | 0.24 s (0.14 s) | 0.45 s (0.36 s) |
| PyTorch, CPU, Float64 | 2.47 s (0.74 s) | 3.09 s (1.05 s) | 3.99 s (1.84 s) | 2.81 s (1.00 s) | 3.49 s (1.49 s) |
| PyTorch, CPU, Float32 | 2.86 s (0.84 s) | 2.63 s (0.80 s) | 4.20 s (2.05 s) | 3.00 s (0.92 s) | 2.89 s (1.02 s) |

What they all print: after one pass of Adam over the 60,000 digits, mean
loss 0.5532 and 9,218 of the 10,000 test digits right (92.18%); after
Newton's ten steps over 10,000 digits, loss 1.0230 and 8,227 right
(82.27%); after its three passes over 1,000, 721 of 1,000. The
evaluator: one Adam step on 100 digits, 3.0 s with loading and checking.

So the race: at 60,000 digits NumPy is 22x faster than `ters native`
and 141x faster than the core IR. PyTorch on the CPU loses to NumPy here,
its per-call overhead larger than a batch of 100's work. On a GPU it
would win both; there is no GPU here, so that race is for a machine with
one (the command is in mnist/README.md). Ters has no way onto a GPU for
this program yet (DG1).

### The gaps, ranked

**DG1. Nothing here can reach a GPU.** Ters reaches the GPU in three
ways, none this program's: shaders (pictures and frames), a page's
`draw`, and a page handler's `map`, `keep` or fold of Ints or Bools on
WebGPU (gpu-maps.ts, C61d′). A command-line program has no GPU target,
and a Float64 map never leaves the CPU, by rule: WGSL has no f64, and
WHERE-IT-RUNS.md won't let a place the compiler picks change an answer.
That note names the way out: a Float32 type, whose maps a GPU computes
exactly as its meaning says. That is a language question; Ersagun
chose it on 2026-11-23 (L286). After it, `contracted` and maps of Float32 on WebGPU, on a page
first, raced against PyTorch on Apple's MPS.

**DG2. Tensors can't carry the program.** A batch of 100 digits times
the hidden layer, `contracted(x, w, [(1, 0)])` of a 100 × 784 and a 784
× 32 tensor (2.5 million multiply-adds), takes 259 s compiled; 10 digits
take 10.1 s, so it grows faster than the work. The same product on
arrays takes 0.13 s. `contracted` is TENSORS-2026-11-03.md's meaning: an
index as a list, each item found by walking the items list (`item at`,
n steps), the indices of the shape built as lists of lists. A Tensor
stored as one array with its shape, and `contracted` lowered to the loop
nest it means (a matrix product for one pair of axes), would let the
program say `contracted` where it now says `table of` and `dot`. The
program is written on arrays for this reason.

**DG3. `gradient` is forward mode, so the backward pass is written by
hand.** `gradient` takes a function of a record of Float64s and runs it
once per part (derive.ts, Wengert 1964). This loss has 25,450 inputs in
an array, which `gradient` doesn't take; if it did, a step would be
25,450 forward passes, each about a third of an Adam step's 0.24 s in the
core IR: about half an hour a step (an estimate from those two numbers,
not run), where backpropagation takes one pass back. So `loss and gradient` is backpropagation in Ters, by hand. What
does work: running that hand-written pass on dual numbers gives the exact
Hessian times a vector, which Newton needs. A reverse-mode `gradient`
(Linnainmaa 1970, Speelpenning 1980; JAX's `grad`) for functions of
arrays and tensors would make both modes the language's own
differentiation, the way the PyTorch version is PyTorch's.

**DG4. The core IR's inner loop does four things the ideal doesn't.**
`dot` is 51% of an Adam pass single-threaded, `hidden of`'s cell maker
17%. Each round of `dot`: a step counted for the budget (`R2.step()`;
the checker doesn't see `n` going down to 0 end it), the three Int sums
through the big-capable `int.add` and `int.sub` (positions not known to
be small), `n ≤ 0` as a call (`dot`'s count is left generic, "b is a
Number with <", though every call gives an Int), and each item read
checking it is an `ArrayView`, its version and its bounds, from a JS
Array of boxed numbers rather than a Float64Array. Workers buy nothing:
with them a fifth of the time is `encode`, the parameters and pixels
sent item by item for each map. 16x to 21x the ideal; native 3x.

After C303b (2026-11-24) `dot` reads its two arrays from their buffers,
the view worked out once before the loop, and steps its positions and
count as numbers: 3.1 s of an Adam pass over 3,000 digits is now 0.12 s,
and Adam over 10,000 digits is 9.2 s, 7.9x the ideal (it was 15.1 s).
After C303c its reads aren't checked where its first and last positions
are in the arrays (5x its loop, by hand): 5.6 s, 5.9x the ideal. Boxed
numbers in a JS Array measured no slower than a Float64Array there.

**DG5. Duals in an array are records, read once a field.** In the Newton
mode the network runs on `Array Dual`: each item a two-field record, each
multiply-add allocating one, and `dot`'s body reads the same item from the
array again for each field (three reads where one would do). Newton is
35x the ideal in the core IR and 22x in WASI, where Adam is 16x to 21x.
Natively it is 2.4x, about what Adam is: C's records of two doubles cost
little.

After C303c, C303d and C304a (2026-11-24) the sum is two numbers, not a
Dual a round, and the reads are in range unchecked: Newton over 1000
digits three times 89 s now 42 s, 10x the ideal. With C304b the Dual
array's own test of each position is worked out before the loop too:
29.5 s, 7.0x. With C304c the Dual arrays are two columns each, read
in place by the loop: 13.3 s, 2.9x.

**DG6. `ters wasi` can't read MNIST's training images.** `read bytes`
conses a list of Ints, one cell a byte, then makes the Bytes from it: at
47 MB V8 stops with "requested new array is too large", and with Node's
default stack it crashes (segmentation fault) first. 10,000 digits (7.8
MB) read fine. A file's bytes read into one byte array would do.

**DG7. Writing it: four things the language or the MCP made harder.**
- `/` is Float64's alone; at any number it is `divide`, and
  `first(divide(…), else 0)` in a generic definition keeps Choice in its
  type and leaves `a's Division` effects with unbound type variables:
  `squash` (tanh) got more than twenty. The program passes `recip` and
  `ln` in as functions instead.
- The MCP can't make a type with its own parameter:
  `numbers(lift: (Float64) -> a, …)` is refused, "no type named a" (the
  `define` path has no way to add type parameters). So `lift`, `level`,
  `recip` and `ln` are four inputs of every generic definition.
- A field read `s.params` where two record types have `params` (Adam's
  and Newton's state) takes the first type and refuses the other; Newton's
  field is `weights` for that.
- No number to fixed places (`fixed` is written in the program), no
  power operator.

**DG8. NumPy's matrix products.** Even the ideal JS is 6.7x NumPy at
60,000 digits: NumPy's products are BLAS, blocked for the cache, SIMD
and on every core. After DG2 and DG4, the remaining distance is that
kernel: natively, a product blocked and vectorised on the pool's threads.

### Proposed order

DG2 first (Tensor on one array, `contracted` as loops), with the program
moved onto tensors, then DG4 (what any array loop pays), then DG3 with
the language lane, DG1 once Ersagun has answered the Float32 question,
then DG5, DG6 and DG7's small rows, and DG8 last.

## Round 23: bazaar, a small database whose questions are data (2026-11-24)

The coordinator asked for a round in an area the rounds hadn't covered:
not a parser and interpreter again (round 21), not numbers (round 22).
`compiler/gaps/bazaar` is a small relational database: a bazaar's
customers, products and orders, made up from a seed, and five questions
asked of them. A question is a `Query`, a tree written as data (scan,
filter, match on a key, match nothing, group with aggregates, compute a
column, order, pick columns, first rows), so there is no query text to
parse. The planner pushes each test as low as it goes (into the side of
a join it reads, under an anti join, below a computed column it doesn't
read) and turns the query into a `Plan` whose columns are known by their
place, each join a hash join filing the side it guesses smaller. Each
question prints its plan and its answer as a table.

Written through the MCP (driver in project files gaps-round23/): 75
definitions, 7 of them types. The ideal is `bazaar.ideal.js`: the same engine by
hand, rows as arrays, filing by a JavaScript Map keyed by a cell's text,
groups sorted at the end. Every way prints the same, plans included
(test/bazaar.test.ts holds the evaluator, the core IR, `ters compile`,
`ters wasi` and `ters native` to the ideal).

Times on this container (4 cores), `node compiler/gaps/bench-bazaar.ts
10000 200000`: the ideal and the core IR in one process, the rest as
processes with their start-up.

| bazaar | 10,000 orders | 200,000 orders |
|---|---|---|
| ideal JS | 23 ms | 579 ms |
| core IR | 101 ms (4.4x) | 2.90 s (5.0x) |
| evaluator | 1.83 s (80x) | 41.8 s (72x) |
| `ters compile`, its module as a process | 1.24 s (54x) | 20.2 s (35x) |
| the same, every placement held on the main thread | | 3.12 s (5.4x) |
| `ters native` | 72 ms (3.1x) | 1.30 s (2.2x) |
| `ters wasi` | 168 ms (7.3x) | 1.74 s (3.0x) |

### The gaps, ranked

**BG1. Compiled JavaScript shares a cheap evaluator out to worker
threads, and is 6.5 times slower for it.** `ters compile`'s module takes
20.2 s at 200,000 orders; with the decisions holding every placement on
the main thread it takes 3.12 s. The profile of the 20.2 s run is 13 s in
`shared` and 3 s in the garbage collector, with `encode` and `byShape`
(the values sent to the workers) next. The placements are the
per-row maps and keeps of `rows of`, `joined rows` and `grouped rows`,
and `evaluated`'s two calls of itself (`both`, `added`), halved
(`bothPure`): an expression of three or four nodes a row, its rows'
filed index in what each call closes over. The cost model calls them
slow from the item count alone. A placement whose items close over a big
value should count what each worker is sent, and a halving of a function
whose calls are this small shouldn't be asked at every call (in the core
IR's run, `bothPure` and its checks are still 10% of the time). C323.

**BG2. The core IR is 5x the ideal.** A quarter of its time is the
garbage collector. Each cell is a case object and each row an array of
them, as in the ideal, but each step also builds lists where the ideal
pushes into arrays: `index rows` and `group rows` cons each row onto its
key's list in a Map (a tree, as the program says; the ideal's is a hash
map) and reverse it after, `joined rows` is a flat map of maps, and
`sum values` walks a list built by a map. The maps are a known case
(C63, a map with one holder stored as a hash table): here the Map's keys
are cells and lists of cells, data keys, which the JavaScript tables
don't take yet. C324.

**Not gaps: two readings the driver chose wrong.** The MCP asks when a
field or a function more than one type has is read on a value of no type
yet (`Give as ("Table" or "Planned" or "Matrix")`), and the driver,
round 22's, answers with the first reading offered. Twice that was the
wrong one: `plan join` read `pl.columns` and got Table where the rest of
it needed Planned, and `widest` read `length(t)` and got List's where it
needed Text's. Both were then refused a step or a definition later. They
were worked around in the driver (Planned's field named `heads`; widest
given `as "Text"`), and round 24's driver should answer with the reading
the definition's later steps need.

What went well: native code is 2.2x the hand-written JavaScript at
200,000 orders, and WebAssembly 3.0x. The planner itself (matches over
seven types, lists of tests filtered and put back) was written with no
refusals.

### Next

No gap is the language's this round. BG1 and BG2 go to the Compiler
lane as C323 and C324.

### After the round (2026-11-24)

C323 (#3257, #3258): what a job sends to the workers is counted, and its
writing stops once it couldn't pay; bothPure's cheap calls make nothing.
`ters compile`'s module at 200,000 orders went from 20.2 s with workers
to 1.6 s (1.5 s without). C324a (#3259): two arrays joined in one step,
so the core IR went from 1.75 s to 1.40 s. The rest of C324 is closed as
measured (DONE): hash tables for the data keys were no faster, and no
other single pass buys 10%. The round stops here.

## Round 24: typeset, paragraphs broken into lines (2026-11-24)

Another area the rounds hadn't covered: text set in lines.
`compiler/gaps/typeset` breaks paragraphs of made-up words into lines of
a measure by Knuth and Plass's total fit ("Breaking paragraphs into
lines", 1981, prior art): a paragraph is boxes, glue and penalties; each
line has an adjustment ratio, a badness and a fitness class; demerits
add a line penalty, a hyphen's cost, 3000 for two hyphens running and
2000 for classes far apart; the least total over every way to break the
paragraph is kept, a row of four classes for each break. Words are
hyphenated by two syllable rules (a vowel, a consonant, a vowel; a vowel,
two consonants, a vowel), not Liang's patterns. First fit, word by word,
is counted beside it. It prints the first paragraph's lines with their
ratios, a line for each paragraph and the totals.

Written through the MCP (driver in project files gaps-round24/): 58
definitions, 7 of them types, no refusals. The ideal is
`typeset.ideal.js`: the same typesetter by hand, items and sums in
arrays, the table of best ways one array changed in place. Every way
prints the same (test/typeset.test.ts holds the evaluator, the core IR,
`ters compile`, `ters wasi` and `ters native` to the ideal).

Times on this container (4 cores), `node compiler/gaps/bench-typeset.ts
100 1000` at a measure of 300: the ideal and the core IR in one process,
the rest as processes with their start-up.

| typeset | 100 paragraphs | 1000 paragraphs |
|---|---|---|
| ideal JS | 29 ms | 262 ms |
| core IR | 324 ms (11.1x) | 3.04 s (11.6x) |
| evaluator | 13.1 s (446x) | |
| `ters compile`, its module as a process | 478 ms (16.3x) | 2.95 s (11.3x) |
| `ters native` | 181 ms (6.2x) | 1.65 s (6.3x) |
| `ters wasi` | 312 ms (10.7x) | 2.78 s (10.6x) |

### The gaps, ranked

**TG1. A list with one item replaced, written as a map over it
numbered, builds two lists and asks where to run.** Three quarters of
the core IR's run is `grow`, the table of best ways, and the biggest part
of that is `offer`, which keeps a way into class c when it has fewer
demerits:

    map(numbered(cands), (p) => if p.first = c then best(total, j, cj) else p.second)

`cands` has four items. `numbered` builds its list of pairs (an array
grown by `pushBack`), `map` builds the result (`pushFront` onto a list
reversed), each item calls a closure, and each call checks whether the
map is worth sending to the workers (`mapWorth`). The library has the
word for it, `replace at`, and the driver didn't use it; a person writing
by position will often write the map. *Measured* by writing `offer` with
`replace at(cands, c, best(total, j, cj))`: the core IR at 1000
paragraphs 3.19 → 2.24 s, `ters native` 1.70 → 1.36 s. *Fix:* read a map
over `numbered(xs)` whose function gives `p.second` unless the position
is one value as `replace at`, and in general fuse `map(numbered(xs), f)`
into one loop by position with no pairs; a map over a list the compiler
knows is a handful of items long never asks for workers. C330.

**TG2. The rest is spread thin.** With TG1 written by hand the core IR
is still 8.5x the ideal, with no step over 7%: the garbage collector
(each best way a record, each row of the table four), Int arithmetic
through the runtime's checked `int.add` and `int.mul` where every
number here is small, each read of an array going through its version
(`get buf`), and each division in `ratio of` inside a `try` for the
division that can't be done. No single pass buys 10%, so no row.

**TG3. Text the MCP doesn't read: a match inside an expression.** Two
definitions were first written with a match where an expression goes,
and both were refused as text that "isn't read as a whole":

    b ≥ 0 and (match item of(its, b)
      penalty(w, cost, flagged) → flagged
      …)
    map(range(s, b), (i) => match item of(pa.items, i)
      box(t, w) → t
      …)

A match reads as a whole body or a let's value, not inside parentheses
in an expression and not as a lambda's body among a call's arguments.
Both were worked around with a helper (`is hyphen`, `item text`). I361.

What went well: the program, a dynamic program over a table indexed by
break and class with records of three fields, went through the MCP with
no refusals once the two matches were helpers, and native code is 6.3x
the hand-written JavaScript.

### Next

TG1 goes to the Compiler lane as C330, TG3 to the Language lane as I361.

## Round 25: larder, exact fractions and lines read backwards (2026-11-19, landed 2026-11-26)

`compiler/gaps/larder` plans a week's cooking from a book of recipes:
- a book names units (`unit tbsp 3 tsp`), recipes (`recipe pancakes 4`
  and a line per food, `1 1/2 cup flour`), what the larder has (`have …`),
  the packs the shop sells (`sell 4 cup flour`) and what to make (`make
  pancakes 6`);
- every amount, unit and food line is read by running its printer
  backwards: `spelled item` writes a `Quantity` (`whole`, `part` or
  `mixed`), a unit and a food, and `inverse(spelled item, line)` is every
  way that line could have been printed by it, of which the one whose unit
  and food are one word each is kept;
- amounts are exact `Rational`s; each dish is scaled to its portions, and
  every amount spelled as a kitchen would: exactly, in the largest unit
  holding at least a quarter of one, with halves, thirds, quarters or
  eighths (`all` of a search over units and fractions, its answers
  ranked), else in any unit, else "about" the nearest eighth;
- for each food the larder is short of, every way to buy enough of the
  packs sold is searched (`one of` a count per pack), and the one with the
  least over, then the fewest packs, is kept;
- how many portions the larder alone makes is a product run backwards,
  `inverse((y) => y · per, have)`, per food of each dish.

It was chosen to try what no round had: `inverse` (relations run
backwards) inside a compiled program, `Rational` arithmetic throughout,
and a Choice search whose answers are ranked rather than taken first.
**94 definitions** (10 types, 84 functions and values).

It was written through the MCP (`gaps-round20/drive.ts` in the project's
files). No `replace` was refused once the text was right; four `as`
answers were given (`every item`'s Recipe, `whole part`'s Rational, two
tuples), and five things had to be written another way first (L5).

Files:
- `compiler/gaps/larder/`: the program, its README (credits) and a sample
  `book.txt`.
- `compiler/gaps/larder.ideal.js`: the same by hand. A line's reading is
  found from its words directly (the amount is the words before the last
  two), fractions are `[top, bottom]` pairs of JavaScript numbers kept in
  lowest terms, and the pack search is the same enumeration with the best
  kept as it goes.
- `compiler/gaps/larder.ts`: the evaluator, the core IR's module and the
  ideal, in one process, and `book`, a made-up book of any size.
- `compiler/test/larder.test.ts`: the three print the same on the sample
  book, on small books and on every error; the core IR and the ideal on 16
  recipes. The core IR's "the larder alone makes" line is left out of its
  comparison until L1 is fixed.
- `compiler/gaps/bench-larder.ts`: the table below.

**Correctness.** The evaluator and the ideal print the same on every
book tried. The core IR's module prints the same except one line: it says
the larder makes 0 portions of every dish (L1). `ters wasi` and `ters
native` don't build it at all (L2).

### Results

```
book   way        report     against the ideal
4x3    evaluator   296 ms    464x
4x3    core       20.6 ms     32x
4x3    ideal       0.6 ms
16x3   core        231 ms     67x
16x3   ideal       3.5 ms
16x4   core       1459 ms    157x
16x4   ideal       9.3 ms
64x4   core       7552 ms    262x
64x4   ideal      28.8 ms
```

`node compiler/gaps/bench-larder.ts 4x3 16x3 16x4 64x4` on main of
2026-11-26: recipes by pack sizes per food. The program was written and
first measured on 11-19 (core 50x to 167x then); every gap below was
checked again on 11-26 and is still there. The profile and the measured
fixes are from 11-19. The ideal's cost is the pack search; the core IR's grows
faster than the ideal's with the number of ways to buy (L3, L4).

Where the core IR's 3.05 s at 16x4 go (a CPU profile of `ters compile`'s
module, start-up included; inclusive, overlapping):
- `shop lines`, the pack search: 65%. Of it `sort by` 58% and its key,
  `bought`, 48% (L4);
- Rational arithmetic's lowest terms, `int.gcd` and `int.exact` through
  BigInt: `big2` alone is 26% self (L3);
- `book of`, reading the lines through the relational interpreter: 9%;
- loading the 9.2 MB module: 0.2 s, and the interpreter's first `infer`
  0.1 s (L2).

### The gaps, ranked

**L1. Compiled `inverse` with a Rational answer gives no answer (I373).**
`length(all(inverse((y) => y · two(), h)))`, with `two() = as fraction(2)`
and h 6 as a fraction, is 1 in the evaluator and 0 in `ters run` (the core
IR); the same with Float64s is 1 in both. So `portions of item` is always
`else as fraction(0)` compiled. The module hands `inverse` to the
evaluator's solver (`R.rt("solveAll:…")`, the closure made by `R.closure`
with its captured values); a Rational is a `K0(top, bottom)` record in the
module, and somewhere across that boundary it isn't read or given back as
one. Not looked into further. Fix: convert Rationals both ways where the
module and the relational interpreter meet, as Float64s and data already
are, with the two-line program above as the test.
Fixed 11-26: no conversion was missing; the module didn't hold `negate
fraction`, where relate.ts read Rational's case from (DONE I373).

**L2. `inverse` runs the relational interpreter, shipped in the module, and
no other target has it (I374).** Both kinds of `inverse` here, a printer
(`inverse(spelled item, line)`) and a product with one side unknown
(`inverse((y) => y · per, have)`), compile to `R.rt("solveAll:…")`, the
evaluator's interpreter with the library's saved code: the module is 9.2
MB, a one-line book takes 0.71 s (Node starts in 0.03 s), of which loading
the module is 0.2 s and the interpreter's first `infer` of what it runs
0.11 s. `ters wasi` and `ters native` refuse the program: "main isn't in
WebAssembly: calls run book, … which calls portions of item, which solves
applied by the relational interpreter (its plan isn't fixed before it
runs; not in this profile yet)", and, with that call made a `divide`, the
same for `fitting definition`'s `inverse`. Fix: give these directions
plans fixed before they run (MODES.md), so they compile like any
function: a fraction product with one side unknown is a division; a
printer made of `++` and `show` read backwards is a parser, each `join
text` with both sides unknown a cut at each position of a known text and
`show` backwards `read whole number`. The plan is a search (Choice), which
every target already compiles.

**L3. Int's gcd and exact division go through BigInt in JavaScript
(I375).** Every Rational operation puts its answer in lowest terms with
`int.gcd` and two `int.exact`s; core-rt.ts does both on BigInts whatever
the size (`norm(big(a) / big(b))`), where c-rt.ts has a small-Int fast
path. With the same fast path patched into core-rt.ts (numbers in,
`Math.trunc(a / b)` and Euclid's loop on numbers), same output:

| book | core before | core with the fast path |
|---|---|---|
| 16x4 | 1566 ms, 141x | 517 ms, 41x |
| 64x4 | 8325 ms, 167x | 2410 ms, 57x |

Fix: that patch, and a test that a Rational sum of small numbers makes no
BigInt.

**L4. `sort by` calls its key twice per comparison (I376).** The
library's `sort by` is a merge sort whose `merge by key` calls `key(y)` and
`key(x)` at every step, so a list of n is keyed about 2·n·log₂ n times. Its
comment names Python's `key=`, which keys each item once. `shopping` sorts
every way to buy by (what is left over, how many packs, the counts), and
the leftover is a sum of Rationals: `bought` is 48% of the run. Written
by hand as decorate, sort, undecorate (the "Schwartzian transform",
after Randal L. Schwartz), with `sort by(map(options, (ks) => (key, ks)),
first)` and the keys taken back off, the same book takes 1.29 s instead of
2.73 s as a process, its run alone 0.52 s instead of 1.93 s. Fix: `sort
by` keys each item once, in the library, so every program and target
gains; then, smaller, `nicest of(sort by(xs, key))`, the first of a sort,
could be one pass keeping the least.

**L5. Text the MCP doesn't read, and answers that go wrong far away
(I377).**
- `f(result = y)`, the way the view prints a definition run backwards
  (`greet(result = greeting)` in `examples/backwards`), is "nothing is
  named result here", and `solve f(…)` isn't read either. `inverse(f, y)`
  is all the MCP can write, and it is the form that compiles to the
  interpreter (L2).
- `++` between lists is "join text needs Text here, got List (Item,
  Int)"; `append` was meant. The message could say so.
- A definition named like a library one is written and then can't be
  reached: `define run` succeeded, and the `replace` at `run` that followed
  went to the library's `run`, "no part of #run8 reads □". It became `run
  book`.
- A wrong `as` answer shows up far away. `whole part(y) = whole
  of(floor(as float64(y)))` asks Int, Fixed, Algebraic or Rational, and
  the driver's first answer, Int, made it `(Int) -> Int`. Its callers on
  Rationals then typed with Choice, and the refusal came 30 definitions
  later at `report`: "report does Console while a Choice is open". The
  question could weigh what callers pass, or `replace` could say when a
  definition's effects grow.
- The MCP ran out of Node's default 2 GB heap after about 100 s (the
  first time at the 70th definition, `cover`), as I317 found on the
  greenhouse; the 94 definitions were written in 110 s with a 7 GB heap.

**L6. Smaller things, seen, not rows yet.**
- `y + y = 6` on Rationals has no answer even in the evaluator: the
  fraction relation takes any two sides, and here one unknown is both.
  Int's sum hands such a case to the equation solver (BACKWARDS.md); a
  fraction's could too.
- Reading a line backwards carries Diverge (`fitting item : (Text)
  -[Choice, Diverge]-> Item`), so `main` does, though a printer of a known
  text read back ends: each step reads a shorter text, which BACKWARDS.md
  says the modes see for `show numbers`.
- `ters compile` takes 4.9 s.
- The evaluator is 464x the ideal.

### Next

1. L1 (I373), a correctness gap on JavaScript.
2. L3 and L4 (I375, I376): measured above, together they should bring
   the core IR to a few times the ideal.
3. L2 (I374), which is what lets `ters wasi` and `ters native` build the
   program at all, then the bench again on every target.
4. L5 (I377) for the MCP.

## Game round 4: the flock drawn with data (2026-11-26, FRAMES.md stage 2)

Stage 2's round (FRAMES.md): flock-frame-page, the flock of round 3 drawn
with `render` (a frame of three passes and seven draws: the floor from
floor.ppm, its grid, every bird's shadow and every bird from bird.obj into
a texture, how far each point is into another, then the fog), against the
same page written by hand for WebGPU, `compiler/gaps/flock.ideal-gpu.js`.
The page by hand keeps the birds as Float64Array columns, copies them
into one Float32Array a frame that its three draws of birds share, and
sends the meshes, lines and image once.

`node compiler/gaps/bench-frames.ts` builds both pages, runs each 6 s in
headless Chromium with WebGPU on SwiftShader (no GPU here), and counts
per frame: main-thread milliseconds from a CPU profile, the drawing's
share (the frame's first GPU call to its submit), bytes written to the
GPU, and draw calls. Both run the flock at 30 ticks a second, at most two
a frame.

| birds, way | main ms | draw ms | bytes sent | draw calls | frames a second |
|---|---|---|---|---|---|
| 2,000, by hand | 2.16 | 0.19 | 48,008 | 7 | 60 |
| 2,000, Ters | 15.41 | 1.32 | 144,436 | 7 | 55 |
| 20,000, by hand | 172 | 0.50 | 480,016 | 7 | 6.0 |
| 20,000, Ters | 820 to 1,500 | 11.9 | 1,440,480 | 7 | 0.7 to 1.2 |

At 20,000 birds a frame lasts a second or more, so 6 s hold a handful of
frames and the figure moves between runs.

The round found a bug first: #3417 (G11c) had made the page 100 times
slower, 1,040 ms a frame at 2,000 birds. Its `Image` holds a List, and
wasn't among the types only the runtime reads, so no list of the program
became an array, and each bird read by position walked the list. I379
(#3418) fixed it; the table is after it.

Where the Ters page's main thread goes, per frame, from the profile of an
unminified build (`PROFILE_OUT=… node compiler/gaps/bench-frames.ts`):

| part | 2,000 birds | 20,000 birds |
|---|---|---|
| the flock's ticks (`ticked`) | 5.96 ms | 1,324 ms |
| a cell's value turned for the runtime (`turned`) | 5.16 ms | 53 ms |
| the collector | 1.38 ms | 74 ms |
| the drawing (gpu-frame.ts) | 1.27 ms | 11.5 ms |
| making the frame (`frame of`) | 0.03 ms | 0.16 ms |
| the rest (the page's cells and events) | 1.61 ms | 36 ms |

### The gaps, ranked

**FR1. A cell holding the flock is walked whole on every write and read
(C347).** `now` holds the sky, and `write(now, stepped(...))` and every
`read(now)` go through a host function marked `deep`, which turns each
value between compiled code's JavaScript Bools and the runtime's
`{tag: true}` (core-rt.ts `turned`). The sky has one Bool, the grip's
`held`, so 2,000 birds, 6,000 objects, are walked to find nothing to
turn, and the records' `fields` getters make an array at each. A third of
the page's main thread at 2,000 birds. The compiler knows the type: only
the paths that can hold a Bool need walking, and a type with none needs
no walk.

**FR2. The flock's ticks, 3x to 6x the JavaScript by hand (FL3).**
Measured in Node too, `ters compile` against flock.ideal.js, 20 ticks:
27 ms against 8 ms a tick at 2,000 birds, 980 against 155 ms at 20,000.
On the page the map runs on the main thread (its workers didn't pay at
either size). This is round 3's FL3: in the profile the birds are
objects holding Vec3 objects, read field by field in the neighbour walk.
Columns for lists of records (G1b, #3040) exist in JavaScript, but these
birds aren't held as columns; why is the first thing to find out.

**FR3. The drawing reads the birds as a list, three times a draw
(I380).** gpu-frame.ts reads a draw's instances with `fromList` (items),
which copies an array-held list (an ArrayView) into a new array, and
calls it three times a draw: for the count, for packing and again. Half
the drawing at 20,000 birds is these copies and the records' getters.

**FR4. A list drawn three times is sent three times (I380).** The
shadows, the birds and the birds' distances are three draws of the same
list, and each draw's slot writes its own words: 144 KB a frame at 2,000
birds where the page by hand sends 48 KB. Draws whose sites read the same
leaves of the same list can share one buffer.

**FR5. Packing reads records, not columns.** With FR3 and FR4 gone, the
drawing still reads each bird's place and velocity through two objects
(G8b's packing loop), where the page by hand copies six columns. Birds
held as columns would serve this as they serve FR2.

The frame itself costs nothing: `frame of` makes three passes and seven
draws in under 0.2 ms, and the matching keeps the meshes, lines and image
on the GPU (0 bytes for them after the first frame, as by hand).

### Next

1. I380 (FR3, FR4), the drawing: Editor lane, gpu-frame.ts.
2. C347 (FR1), cells turned by their types: Compiler lane.
3. FR2 and FR5: why the birds aren't columns here (C348).

### After I380

gpu-frame.ts reads each draw's instances once, and sends a list an
earlier draw of the frame sent (same items, same leaves read) not at all.
Lists are compared by their items: compiled code hands each draw its own
list over the birds' array, so before, the birds went every frame even
when no tick had moved them.

| birds | bytes sent | draw ms | by hand |
|---|---|---|---|
| 2,000 | 144,436 → 25,898 | 1.32 → 0.60 | 48,008, 0.20 |
| 20,000 | 1,440,480 → 480,096 | 11.9 → 4.6 | 480,016, 0.45 |

At 2,000 birds the page now sends less than the one by hand, which sends
the birds every frame though half its frames have no tick. What is left of
the drawing is reading two objects a bird (FR5).
