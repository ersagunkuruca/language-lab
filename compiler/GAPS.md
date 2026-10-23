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
changed. The inline form (G2) is still open. *Later* (second review):
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
  `lab compile` writes runs `main` in a worker thread with a 1 GB stack.
  20,000 and 100,000 nested parentheses work. It costs about 130 ms of
  start-up for now, because the module, with its heavy runtime, loads
  twice. G8's lazy runtime brings that down.
- *Fuel*: every call into a `Diverge` definition does `$spendOrThrow()`,
  even though nothing in calc ever installs `with fuel`. Removing those
  calls saves 6 to 10 ms of the 88. *Fix:* look at the whole program. If no
  `with fuel` can be on the stack when a function runs, don't emit the
  check. Starting from `main`, that's a reachability question.

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
and `===` for Text and Int. This is the compiled half of G0.

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
read.

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

**G13. Records taken apart at once are still built (perf: part of G11's
remainder).** `split` returns a `halves` and `results` a `found`, and the
caller matches on it straight away. With G11, they become two arguments to
`k`. Without it, they're the "return two values" form of G9 from round 1.

**G1 again (fuel).** `if ($spend())` before each recursive call: unmeasurable
here (240 → 242 ms), because `$spend` is cheap when no fuel is active. The
whole-program "no `with fuel` reachable" check from round 1 would still
remove it. Low priority.

**G12. `one of([true, false])` is a list and a loop.** It builds the list
each time (hoisting it: 240 → 234 ms) and tests the Bool it picked. The
ideal runs the two branches one after the other. Small, and G9 covers the
building part.

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
