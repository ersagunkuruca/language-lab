# What the command-line examples take, and what you can change, 2026-11-17

Ersagun, 2026-11-17: the bigger programs in the picker are still confusing.
A person won't read a lot of code to learn what a program does, and what is
hidden or read-only can't be tried. Named: file inputs with no way to see or
change the file, default number arguments that can't be changed, and calc
not saying what to type. Also: some of them simulate things that should be
drawn, or that are about running in parallel, as text. Why?

This is the survey before any fix. Rows E273 to E278 in BACKLOG.md.

**How it was checked:** `ters check` for each example's `main` type, the
picker's `run` entries in editor/examples.json, the files beside each
program, and each Run panel as it opens (editor built from `main` at
`6caf5bd`, headless Chromium).

## What the Run panel does now

- **Arguments** are fixed. The button reads `Run main budget.txt`, and a
  hint below says `Arguments · budget.txt · files budget.txt`. Nothing there
  can be clicked or typed in.
- **Files** the example brings (budget.txt, primes.asm…) go to the run but
  are never shown. Their text is in the repository and nowhere in the
  editor. What a run writes goes to the browser's storage, also unseen.
- **Standard input** is an empty box. For calc that is all you get: no
  example, no hint of what a line looks like. calc's examples.json already
  holds a run with input (`1 + 2`, `3 * (4 - 1)`, `2 ^ 10 / 4`); the editor
  doesn't use it.
- **What the program does** is only in main's comment, in the text pane,
  and in a README the editor never shows.

## Each example

| example | main takes | given in the editor | what's wrong |
|---|---|---|---|
| sheet | arguments, files | `budget.txt`, its file | file unseen, argument fixed |
| machine | arguments, files | `primes.asm`, five .asm files | can't see a program, or pick another of the five |
| notebook | arguments, files | `notes.txt`, its file | file unseen, argument fixed |
| routes | arguments, files | `roads.txt`, its file | file unseen, argument fixed |
| ledger | arguments, files | `book.csv`, its file | file unseen, argument fixed |
| chapters | arguments, files | `book.md out`, book.md | file unseen; the chapters it writes to `out/` unseen |
| crew | arguments, files | `plan.txt`, its file | file unseen, argument fixed |
| pond | arguments | `30 100` | ticks and fish fixed; the README says `300 400`, and nothing says what the two numbers are |
| calc | standard input | an empty box | nothing says what to type |
| clinic | a file it may read | nothing | reads clinic.txt's settings if there is one, and none is shipped, so the settings can't be seen or changed; writes clinic.csv, unseen |
| break | nothing | — | three breaks fixed in the code; nothing to change without editing it |
| board | nothing | — | a page; fine |

## Simulations printed as text: why

Four of them are simulations of something you would want to watch: **pond**
(fish and herons on a 48 m square), **break** (sixteen balls on a table),
**clinic** (patients, desks and a queue over a day) and **crew** (workers
taking tasks over simulated minutes). Two are also about parallel work:
pond's plans are made by a `map` that can run on several threads, and crew
schedules tasks onto workers.

They print text because they were written as compiler benchmarks, not as
demos. Each bigger-program round (GAPS.md) writes a program larger than the
last, compiles it, and compares it with hand-written JavaScript or C for
the same output and its speed. Text on standard output is what `ters run`,
`ters native` and the hand-written versions can all be diffed and timed on.
The 2026-11-14 examples triage then kept them as written ("bigger programs
stay what they are", since rewriting one breaks its GAPS comparison) and
gave them comments, not pages. So the picker shows them as they were
benchmarked, which suits the compiler lane and not a person trying them.

The parallel part is invisible for a further reason: the editor runs a
program on one worker, so pond's `map` runs one fish at a time there; it
spreads over threads only when compiled for native or WebAssembly targets.

**Proposal:** keep each text `main` as the benchmark record, untouched, and
add a page beside it that uses the same definitions and draws what they
compute: pond as the square with fish, food and herons moving, a tick
slider and the fish count; break as the table with the balls rolling and
the event log beside it; clinic as the queue and desks over the day, with
its settings as fields; crew as a chart of workers and tasks over time,
the critical path marked. The definitions stay one copy, so GAPS still
compares the same code.

## Rows

| id | what | lane | pri | size |
|---|---|---|---|---|
| E273 | Arguments editable in Run: a field holding the example's arguments, a reset to them | E | P1 | M |
| E274 | Input files shown and editable in Run: each file the example brings opens in a text box; edits kept in the browser per program, with a reset; files a run writes listed after it | E | P1 | M |
| E275 | Standard input starts with the example's own input (examples.json's main run), so calc opens with lines to run | E | P1 | S |
| E276 | What main does, where you run it: main's comment as Run's ⓘ, and each argument named (pond: ticks, fish) | E | P1 | S |
| E277 | clinic ships a clinic.txt with its default settings, so they show as an input file (E274) | L | P1 | S |
| E278 | Pages for the simulations, beside the benchmark mains: pond, break, clinic, crew (one PR each) | E | P2 | L |

Bugs first, so E275 and E277 come early; E273 and E274 are the main change.
