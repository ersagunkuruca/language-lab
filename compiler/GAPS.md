# Gaps: what the compiler emits vs what it should

This doc comes back with each compiler milestone. Each round goes like this.
Write a program in the language that's bigger than the last one. Write by
hand the JavaScript a good compiler would emit for it: same program, same
algorithm, same output, same value representation. Then put that next to
what `compiler/src/compile.ts` actually emits. What differs is a gap. Each
gap below gets its evidence, a fix and a rank.

The programs are original, written for this purpose.

## Round 1: calc (2026-10-22)

`projectional/examples/calc` is a calculator for whole numbers of any size.
It reads lines from standard input. A line can be an expression with
`+ - * / % ^` and parentheses, `let name = expression`, or `? expression`,
which shows how the expression was read with every operation in
parentheses. A line that fails prints its reason with the line number to
standard error, and the session carries on. The exit code is 1 if any line
failed.

```
$ printf 'let x = 2 ^ 100\nx * x - 1\n? -2 ^ 2 + 3 * (4 - 5)\n7 / 0\n' | node projectional/cli/lab.ts run projectional/examples/calc
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
  (dropped in C24, once the full fix made it only a start-up cost).
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

`projectional/examples/countdown` is the Countdown numbers game: every way
to reach a target from some of the numbers with `+ − × ÷`, each number used
at most once. The search is Graham Hutton's, from "The countdown problem",
*Journal of Functional Programming* 12(6), 2002
(https://www.cs.nott.ac.uk/~pszgmh/countdown.pdf). It uses his `valid`,
which skips answers that only differ by commutativity or by 1. For 765 from
1, 3, 7, 10, 25 and 50 it finds his 49 solutions.

```
$ node projectional/cli/lab.ts run projectional/examples/countdown | head -2
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
kind: plain text work that ends in files. `projectional/examples/chapters`
splits a Markdown book into one file per chapter (at each `# ` heading),
writes `contents.md`, a list of them with links and word counts, and adds a
line per chapter to `chapters.log`. It reads with `read file`, writes with
`write file` and `append file`, and stops with `Abort` when the book is
missing or has no text. `main` handles that `Abort` and turns it into a
message and exit code 1 (2 for a wrong command line).

```
$ mkdir out && node projectional/cli/lab.ts run projectional/examples/chapters book.md out
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
compiled program pays. (Gone since C24: with C21's heap continuations main runs on
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
*Fix:* builder/consumer fusion (`projectional/NUMBERS.md`, after its
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
of `projectional/NUMBERS.md`'s fold table: a list that's never consed onto,
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
example's functions backwards (`projectional/test/agreement.test.ts`) fails on
three of chapters' text functions in `relate.ts`:

1. `words` backwards from 0 overflows the stack. (`words` is
   `length(keep(split(line, " "), w ≠ ""))`.)
2. So does `words` backwards from 1.
3. `words in(["", "ab"]) = 1` with both sides known gives no answer, but the
   evaluator gives 1. That's a wrong answer, not only a slow one.

The check also took 13 minutes on chapters alone, so the step budget doesn't
bound this search. These went to `relate.ts`, not to the compiler, and are fixed by PR #142: whole-number add and subtract and `split` run backwards, and the chapters check takes under a second.

## Round 3: ledger (2026-10-23)

`projectional/examples/ledger` reads a file of money entries, one per line
(`date,account,cents,memo`; blank lines and `#` comments skipped), and
prints totals by account, largest first, totals by month, the smallest
entry and the grand total. A line that doesn't have four fields, or whose
amount isn't a whole number of cents, stops the run with its line number.

```
$ node projectional/cli/lab.ts run projectional/examples/ledger ledger.csv
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
