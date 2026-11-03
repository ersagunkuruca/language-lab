# Why the full unit tests take so long (2026-11-03)

Ersagun asked (2026-11-03 17:43) why the Language lane's test runs take
so long. This report measures them, finds the causes, and lists the fixes
as BACKLOG rows (L216, L217, T12 to T14). Nothing is fixed here.

## How it was measured

On main at 3c064a3 (#1341), in a 4-core container, every one of the 202
unit test files (ters 156, compiler 46) was run on its own with Node's
JUnit reporter, three files at a time. That gave a time per file and per
test (1,193 tests). A second run counted, per file, the calls to `infer`
that check a program from scratch, the calls that reuse an earlier check,
and the time in `resolveArithmetic`, with a counter patched into a local
copy (not committed).

Three files at a time on four cores is a little slower per file than the
lane's `--test-concurrency=2`, so the times below are a bit high. The
proportions are what matter.

## What a Language lane change runs

`npm run affected` picks what a change can reach through its imports.
Almost every Language lane change touches `std.ts`, the prelude, `infer.ts`
or `run.ts`, which every test imports. The last two code changes (#1340,
#1341) each picked **199 of 202 files**, so for this lane "affected" is the
full run. (Inbox I110 found the same for Check main on 2026-11-01.)

The 202 files take about **70 minutes of CPU**, which is **35 to 40
minutes** at two files at a time. On 2026-10-23 (TESTING.md) the same
measurement was 410 s.

- **78 of the 202 files take over 5 s**, the limit WORKFLOW.md sets
  ("Under 5 seconds per file per change"). Those 78 take 3,873 of the
  4,186 file-seconds. The other 124 files take 313 s together.
- **12 tests take 1,639 s, 41% of everything.**

| file | s | the slow part |
|---|---:|---|
| ters lang.test.ts | 632 | "every filling the palette offers keeps the program free of errors": 615 s, on an eighth of the targets |
| ters dots.test.ts | 465 | "a dot on any wire": physics 295 s, relations 94 s, queens 60 s |
| ters palette.test.ts | 280 | calculus fillings 98 s, held definition 47 s, results 45 s, backwards 36 s |
| compiler builtins.test.ts | 262 | each builtin runs backwards 103 s, compiles 67 s, type-checks 66 s |
| ters editing.test.ts | 260 | swapAndUndo 43 s, simplifyAppend 21 s, 23 more at 5 to 15 s |
| compiler core-js.test.ts | 172 | examples 70 s, pages 46 s, build-web 40 s |
| ters toplevel.test.ts | 168 | 41 tests, most 2 to 24 s |
| ters draws.test.ts | 156 | 34 programs, 3 to 11 s each |
| ters modes.test.ts | 102 | Tumble's clear run backwards 74 s |
| compiler c.test.ts | 90 | whole programs in C 15 s, then several 5 to 9 s |
| ters agreement.test.ts | 77 | raymarch 24 s |
| ters rep-costs.test.ts | 68 | a tree of List 50 s |

## Cause 1: every small program re-checks the whole library

A test builds a program, puts the library under it (`base(code)`) and calls
`infer`. `infer` then checks **all 495 library definitions** again, not
only the program's own. Each such check costs about **320 ms** today, most
of it the library: units, the modes analysis, and `resultsDirection` for
every definition with results (in a profile of builtins.test.ts,
`resultsDirection` alone is 21% of the time).

Over the whole suite there are **6,823 of these full checks, about 2,200 s,
53% of all the test time.**

| file | full checks | s in them |
|---|---:|---:|
| ters lang.test.ts | 2,032 | 537 |
| ters dots.test.ts | 748 | 375 |
| ters palette.test.ts | 1,015 | 237 |
| compiler builtins.test.ts | 694 | 180 |
| compiler core-js.test.ts | 88 | 60 |
| ters reader.test.ts | 151 | 41 |
| compiler wgsl.test.ts | 80 | 36 |

The counter doesn't see the editor bundle that editing.test.ts and
toplevel.test.ts run, but those check through the same `infer`.

**The library's check could be done once per process.** `infer` already
takes `reuse: { from, only }`. Checking the library alone once (0.8 s) and
then each of the 34 examples with `only` = its own definitions:

- 14 examples gave **the same errors and the same schemes** as a full
  check, in **0.65 s instead of 14.4 s** (22 times faster);
- the other 20 threw (`Cannot read properties of null (reading 'params')`),
  so `reuse` misses something when a program uses parts of the library
  that a check of the library alone doesn't set up. That is the work of
  the row.

The design for the general version exists: CHECK-BY-GROUP-2026-11-03.md
(L215, P3), checking per definition group with a cache keyed by hashes. The
library is the easy case of it, because it is one fixed block that doesn't
change during a test run (or while the editor is open). Row L216 is that
case alone, ahead of L215. The editor gets the same speed-up on every open
and edit (I157 to I159).

## Cause 2: the sweeps outgrew their slices

TESTING.md T3 made the exhaustive sweeps check a rotating eighth per
change. The eighth is of the **targets** (the holes, the wires), but each
target is then tried with **every filling the palette offers**, and the
palette offers every library definition that fits. So the work per target
grew with the library, and each filling pays Cause 1's 320 ms:

- lang.test.ts's palette sweep: its comment says all of it took about 30 s;
  an eighth now takes 615 s.
- dots.test.ts on physics: 295 s for an eighth.

The work grows as the library squared: more fillings, each checking a
bigger library. L216 removes one factor; T12 holds each sweep to a fixed
number of checks per change.

## Cause 3: re-resolving arithmetic per program

`makeRunner` calls `resolveArithmetic`, which walks the whole program,
library included, to replace the generic `+` with each type's own. It is
cached per program, but every test program is a new program: **2,999
calls, about 300 s** (some of it overlaps with Cause 1). The library's
part is the same every time (L217).

## What is fine

Node starting and importing the sources is about 0.3 s a file. Most of the
124 fast files are under 2 s. Process isolation is not the problem.

## Rows

| row | what | expected gain |
|---|---|---|
| L216 (P1) | Check the library once per process; a program's check reuses it and checks its own definitions | about half of the suite; the editor's opens and edits too |
| T12 (P1) | Hold each sweep to a fixed number of checks per change, rotating; all of it nightly | lang, dots, palette: about 1,500 s down to under a minute |
| L217 (P2) | Resolve the library's arithmetic once per process | up to 300 s |
| T13 (P2) | After L216 and T12, measure again; then decide whether a Language change should run a capped fast set, with Check main and the nightly running the rest | the lane waits minutes, not tens of minutes |
| T14 (P3) | The single slow tests left after L216 (Tumble backwards 74 s, tree of List 50 s, builtins backwards 103 s, core-js 116 s, editing's swapAndUndo 43 s): each made a sweep or given a smaller input | the rest of the over-5 s files |

L216 and T12 together should bring the full run from 35 to 40 minutes
down to roughly 15 (an estimate: the 2,200 s of full checks and most of the sweeps go). T13 is the step that would make it a few minutes, and
it is Ersagun's call, because #932 broke the site when a change ran fewer
tests than it reached.
