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
compiler change.

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
before changing it.

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

Next round: a bigger program with more `Choice` in it (a solver or a
search, not one with `Choice` only at the edges), and one that writes
files, so the handler stack and generators get measured too.
