# Testing: fast feedback, only what changed

2026-10-23. A design note, written before changing anything. Ersagun's
ask: the 10 minutes between a merge and seeing it live breaks the
iteration loop; test only what changed; don't let tests pin a design we
want to leave (his example: five tests about `cons` would keep us a Lisp);
look at what kinds of testing actually work; consider testing inside the
language.

The short version: **deploy first, test after, and test only what the
change can reach.** The site goes live about 2 minutes after a merge
instead of 10 to 23. The checks still run, but on the part that changed,
and the slow exhaustive sweeps run on a rotating slice per change and in
full once a night. Rules for what a test may say keep tests about the
language, not about today's implementation. Later, the examples' saved
values become the tests, checked by the editor on save, only for the
definitions whose hash changed.

## 1. Where the time goes

Measured on main at `4e4bf4d` (this container, 4 cores; the GitHub runner
has 2) and from the last Pages runs on GitHub.

**Merge to live.** Pages runs build (3 s), all unit tests (3.6 to 5.7 min),
the browser smoke tests (5.3 to 5.8 min), the GPU check (5 s), then deploy
(1.3 min). That is 10.5 to 13 minutes of one job. Merges that land during a
run wait for it, so #251, merged at 20:01, went live at 20:24: **23
minutes.** And when anything in the suite fails, nothing deploys at all:
right now (20:33) run 232 is red in `smoke-shaders`, so the live site is
stuck at #251 although four PRs have merged since. One failing check about
one shader picture holds back every other change.

**Unit tests, by file** (seconds, run one at a time; the runner does two
at a time):

| file | s | what is slow |
|---|---:|---|
| projectional `palette.test.ts` | 120 | every palette filling in calculus (59), backwards (49), queens (18) |
| projectional `lang.test.ts` | 95 | one test, 97 s: every third filling in algebra and **queens again** |
| projectional `agreement.test.ts` | 60 | forward and backwards agree: raymarch (30), wc (19), chapters (4) |
| projectional `dots.test.ts` | 58 | a dot on every wire: physics (33), relations (14), queens (12) |
| projectional `toplevel.test.ts` | 18 | |
| the other 30 projectional files | 40 | most are under 1 s, mostly Node starting up |
| compiler, 16 files | 23 | |
| invertible | 2 | |

**Ten tests take 330 of the 410 seconds.** All ten are sweeps: "for every
X in example Y, a law holds". They are good tests (section 4), they are
just exhaustive, on every merge, whatever changed.

**Browser smoke** (`npm run smoke`, 328 s here): every definition of every
example, about 2.2 s each, most of it waiting out 500 ms click timeouts.

| program | s | defs |
|---|---:|---:|
| Countdown numbers | 63 | 17 (main alone 32) |
| Shader: ray marching | 47 | 16 |
| Calculus | 32 | 21 |
| Relations, as saved by an older editor | 29 | 16 |
| Page: unit converter | 19 | 14 |
| Run backwards | 19 | 12 |
| Shader: ripples | 18 | 6 |
| Conjugation | 17 | 10 |
| Numbers & physics | 17 | 8 |
| the other five | 49 | 26 |

`smoke-shaders` takes 34 s and the GPU check 5 s.

**What merges touch** (the ~50 merges since 2026-10-22 12:00, ignoring
`.md` and pictures): compiler only 12, editor only 14, docs only 4, and
the language core (`projectional/src`, `library`) about 20. So more than
half of the merges cannot affect most of the suite: a compiler-only change
can't change what the editor's palette offers, and an editor-only change
can't change whether forward and backwards agree in `wc`.

**But the import graph alone is too coarse.** 47 of the 54 test files
import, through some chain, the whole language core (`model.ts`,
`infer.ts`, `types.ts`, `std.ts` ...), so "run the tests that import a
changed file" selects nearly everything for any core change. And 26 test
files read `examples/` at run time, which no import graph sees. Granularity
has to come from the **data**: which examples and which definitions a
change can reach.

## 2. What the research says (short, honest)

- **Most tests never fail.** Google's TAP: of 5.5 million affected test
  targets over a month, 63 thousand ever failed; about 1.2% actually caught
  a breakage or a fix; of the targets that both passed and failed, 41% were
  flaky. Targets more than 10 dependency edges from the change never broke
  in their data. TAP runs only the *affected* targets (reverse build
  dependencies of the changed files) and batches changes.
  ([Memon et al., ICSE-SEIP 2017](https://huang.isis.vanderbilt.edu/cs8395-f23/paper/google-testing-icse-seip-17.pdf))
  *Applies:* run what the change reaches; batch the rest. Prior art for
  section 3.
- **Even "affected" is too many.** Facebook's predictive test selection
  learned which tests a change is likely to break and caught over 99.9% of
  faulty changes running under a third of the affected tests, halving the
  cost ([Machalica et al., ICSE-SEIP 2019](https://ar5iv.arxiv.org/html/1810.05286)).
  *Applies:* we are far too small to learn from history, but the lesson
  that a sample per change plus a full run later loses almost nothing does.
- **Coverage is a poor target.** Coverage is not strongly correlated with
  a suite's ability to find faults once suite size is accounted for
  (Inozemtseva and Holmes, ICSE 2014). Mutation testing (change the code,
  see whether any test notices) is a better yardstick: mutants are coupled
  with real faults, and at Google developers shown surviving mutants wrote
  more and better tests
  ([Petrović et al., ICSE 2021](https://arxiv.org/abs/2103.07189v1)).
  *Applies:* no coverage numbers as goals; an occasional mutation pass in
  the critical review tells us whether tests are worth their time.
- **Properties pay off where a law exists.** Thirty property-based testing
  users at Jane Street got the most from model or reference comparisons
  (17/30), round trips such as encode/decode (11/30) and algebraic laws
  (11/30); a third found bugs nothing else did. The cost is writing the
  properties and generators; they want them to run in 50 ms to 30 s
  ([Goldstein et al., ICSE 2024](https://cis.upenn.edu/~bcpierce/papers/icse24-pbt-in-practice)).
  QuickCheck (Claessen and Hughes, 2000) and Hypothesis (MacIver et al.,
  2019) are the standard tools. *Applies:* our best tests already are
  this kind: forward/backward agreement is a round trip, "every filling
  type-checks" is a law. Our language runs functions backwards, so it can
  *generate* inputs of a type itself (section 6).
- **Cache by hash.** Unison "caches test results unless the functions in a
  particular test's dependency graph receive a new hash"
  ([Unison docs](https://www.unison-lang.org/docs/usage-topics/testing)).
  *Applies:* we hash definitions too (`hash.ts`), so a check of a
  definition can be skipped until it or something it uses changes. This
  is prior art for section 6, credited there.
- **Goodhart's law**, in Strathern's wording: "when a measure becomes a
  target, it ceases to be a good measure" (Strathern 1997, after Goodhart
  1975). Ersagun's point goes further: a suite also *steers the design*,
  because whatever the tests describe feels load-bearing. Kent Beck's
  [Test Desiderata](https://kentbeck.github.io/TestDesiderata/) names the
  property we want: tests should be *structure-insensitive*, changing
  only when behaviour changes.

## 3. The plan

### T1. Deploy first, test after

`pages.yml` builds and deploys, nothing else: about **2 minutes** from
merge to live (the deploy step itself is 1.3 min). A separate workflow,
**Check main**, runs on the same push, after it, and *reports*: a red
check on the commit, which the next PR fixes (or reverts). It never blocks
the site. Trade-off: a broken change is live for the few minutes until
someone sees the red check. For a lab with one user who wants to see the
change, that beats a correct site 20 minutes late, and today's failure
shows the other risk is real too: one red check freezes every change.

A nightly full run (T5) moves a `good` tag; running the Pages workflow by
hand on `good` puts the last fully checked site back if ever needed.

### T2. Run only what the change reaches

One script, `npm run affected [base]` (default: the last commit Check main
passed), used by CI and by every thread before pushing:

1. `git diff --name-only base..HEAD`.
2. Docs and pictures only: run nothing.
3. Each changed `.ts`/`.js` file: the test files that import it, through
   the import graph (TAP's affected targets).
4. Each changed `examples/<name>/`: the example tests for **that example
   only**. Tests that loop over examples read a list from `EXAMPLES=`
   (all when unset), so `palette.test.ts` with `EXAMPLES=physics` checks
   physics alone. `npm run smoke -- --only "Numbers & physics"` already
   exists inside smoke.ts (`visit(saved, only)`); it gets a flag.
5. A change to the language core reaches every example, so it runs every
   test, but the sweeps in their per-change size (T3).
6. A change to `editor/` runs the unit tests that import it and the quick
   smoke (T4); `compiler/` runs compiler tests plus the three projectional
   tests that import it.

Expected on the runner: compiler-only change about 40 s, editor-only
about 1.5 min, one example about 1 min, core about 3 min. Today every
case is 10 to 13 min.

### T3. Sweeps: a rotating slice per change, all of it nightly

The ten slow tests keep their laws but take a slice: `SWEEP=1/8` checks
every eighth target, starting at an offset taken from the commit hash, so
eight consecutive changes cover everything; `SWEEP=all` (nightly, and
locally on request) checks all. Also drop `lang.test.ts`'s copy of the
palette sweep over queens, which `palette.test.ts` already covers. Unit
time on a core change: about 410 s of CPU to about 90.

### T4. A quicker smoke (Editor lane)

Per change: each program's first definition and `main`, plus the gestures
it does once per program (Tab, tidy, let and get); every definition
nightly. And cut the waits: a click on something that isn't there costs
a 500 ms timeout, up to six per definition. Expected about 1 min instead
of 5.5.

Done (T4): per change each program's first definition, its `main` and an
eighth of the rest (a different eighth each run, by `SWEEP_AT`, so eight
runs cover them all), every one with `SWEEP=all`. The waits were clicks on
a graph's frames, which are mostly under their own contents: 402 timed-out
clicks a run, 203 of its 340 s. The smoke now clicks the first six parts
whose middle a click actually reaches. Here: 5 min 40 s became 1 min 22 s
per change, and 2 min 17 s for every definition.

### T5. Nightly full run

At 03:00 UTC, only if main changed since the last `good` tag: every test,
every sweep in full, every definition in the smoke, the GPU check. Green
moves `good`; red posts in the project and goes to the top of the backlog
as a P0. This is where an interaction between distant parts of the code is
caught, a day late at most.

### T8. The browser tests leave the per-merge run (2026-10-29)

Ersagun, 2026-10-29: the browser tests take too long and cost either
Actions minutes or Claude tokens. By then the smoke had grown back from
T4's 1 min 22 s to 8.5 of Check main's 10 minutes (unit tests: 20 s), and
almost every merge reached it, about 14 merges a day, so roughly 140
billed minutes a day. Timed here: 6 min opening 59 definitions (one, Page:
Tumble / tap places, takes 52 s alone) and 4 min for 37 editing scenarios.

Now `npm run affected` leaves the browser tests out unless given `--all`
(the nightly run) or `--browser`. Check main is the unit tests only, about
a minute; the browser tests run once a night, when main changed, and a red
nightly is fixed first. Threads no longer run the smoke before every push.

Next, so editor breaks are caught per merge again without a browser:
every example's every definition drawn in Node on a fake page, the
editing scenarios as plain tests of the edits, and a browser check of
about 30 s for what only a browser can show.

### T9. Every definition drawn in Node

`test/draws.test.ts` bundles editor/main.ts as the page is built and runs
it on happy-dom's document in Node (no layout, no canvas, a Run worker that
never answers). It opens each example from the picker, a fresh page each,
and shows the first definition, `main` and an eighth of the rest, with
their values; `SWEEP=all` shows all 240. It fails on anything the page
throws or logs, a run or values that stop with an error, or a list shown
as `cons(…)` in the blocks, and does the same for programs saved by an
older editor. Here: about 65 s per change and 2.5 min for every
definition, where the browser took 6 min for 59. A view made to throw on
Eight queens' `safe` fails it. `affected.ts` runs it when anything the
editor imports, or its page, changes.

Left to the browser for now (T10, T11): the graph's clicks by position,
Tab and Shift+F10, Tidy, folding, and the 37 editing scenarios.

### T10. The editing scenarios in Node

`test/editor-page.ts` is the editor's page from T9 plus a stand-in for the
part of Playwright's page the smoke used: `locator` (with `hasText`,
`first`, `nth`, `:text-is`, `:has-text`), `click` as a person makes it
(pointer and mouse down and up, then click or the context menu), `fill`,
`selectOption`, `keyboard.press` and `type`. A gesture by position
(`boundingBox`, `mouse`, `evaluate`) says it needs a browser. So
`test/editing.test.ts` holds the smoke's scenarios word for word, and a
scenario moves when it passes there: 13 of 31, about 100 s, each checked
to fail when its expectation is changed. They left editor/smoke.ts.

The 18 left drag, drop, measure places or scroll (T11).

### T6. Rules against the paradigm pin (WORKFLOW.md)

- **Tests speak the language's terms.** They state what a program does
  (an example's output, run and compiled printing the same), or a law
  (forward and backwards agree, a round trip, an equality law, every
  palette offer type-checks). Not the shape of an implementation: node
  kinds, private function names, internal data layout, wording of UI text
  unless that text is the feature.
- **Quantify over the examples, don't enumerate cases.** A law over every
  example tests the next example for free, and doesn't make today's
  representation feel load-bearing. Five tests about `cons` cells pin
  `cons`; one law "a list read back from the blocks is the list written"
  survives a switch to arrays.
- **Every test says what it protects** in its first comment. When a design
  goes, its tests go **in the same PR**, and the PR says so. That is
  normal, not cheating. What stays forbidden is weakening a test while the
  intended behaviour is the same, or skipping one to get green.
- **A time budget.** A test file should take under 5 s per change; slower
  ones are sweeps and take a slice (T3).
- **No coverage targets.** Whether the tests are worth their time is
  judged in the critical review, sometimes with a mutation pass, not by a
  number to raise.

Honest check of where we stand: the slow tests are *not* paradigm pins.
All ten are language-level laws over examples, which is the kind worth
keeping; they are slow because they are exhaustive, which T3 fixes. Three
test files mention `cons` directly (`numbers`, `toplevel`, compiler
`compile`); they should be read against these rules in the next review.

### T6b. Who sees a red check

Check main posts a failure into the project the way the routines do, so
the lane that owns the files picks it up. No waiting for a notice that
never comes (the stall of 2026-10-23 morning).

## 4. Cost

Pages + tests today: about 10.5 runner minutes per merge that isn't
cancelled by the next one. After: deploy about 2, Check main about 1 to 3
on average, nightly full run about 11 once a day. On a busy day of 30
merges that is roughly 90 to 150 runner minutes, against roughly 150 to
200 today, so within the cost rule. The extra job start per merge is
about 20 s. If a week's numbers come out higher, Check main batches:
newest pending commit only, diffing from the last green one, so a
cancelled run loses nothing.

## 5. What we give up

- A broken change can be live for minutes. Mitigated by the red check,
  the `good` tag, and the fact that only one person uses the site.
- Something a slice skipped is found up to a day late, by the nightly run.
  TAP and Facebook's data say such misses are rare; ours will tell us. If
  the nightly run catches something per-change runs missed more than once
  a week, widen the slice.
- The `EXAMPLES=` and `SWEEP=` conventions are a little more machinery in
  the tests. It is two lines per sweep.

## 6. Later: tests in the language

The editor already keeps values to run a definition with
(`examples.json`, by definition hash), shows what every node makes of
them, and checks a program incrementally (`infer(code, names, {from,
only})`). Three steps would turn that into the main test suite:

1. **Accepted answers.** Next to a definition's saved inputs, keep the
   answer it gave when you said "that's right". The editor shows a tick
   when today's answer is the same, the difference when it isn't, and a
   button to accept the new one. A test is then written by clicking,
   speaks only in values, and can't pin an implementation. Prior art:
   expect tests (Jane Street's `ppx_expect`) and snapshot tests.
2. **Laws as definitions.** A law is a function to Bool, say
   `inverse(f, f(x)) = x`, run over values. Values come from the saved
   inputs, and from the language itself: running a constructor backwards
   enumerates small values of a type, as SmallCheck does (Runciman et al.,
   2008) and in the spirit of QuickCheck. A `Check` effect reports a
   failure; the editor's handler shows it on the definition, CI's handler
   fails the run.
3. **Re-check only what changed.** A result is kept under the hash of the
   definition and everything it uses (and of the evaluator's own build),
   and is reused until one of those changes. Prior art: Unison's cached
   test results. On save the editor re-checks the dependents of what you
   edited, so the feedback is immediate, and CI runs exactly the checks
   whose hashes changed.

These would gradually replace the TypeScript sweeps that loop over
examples. They are a language design item, for after T1 to T6.

## 7. Recommended order and lanes

| id | what | lane | size |
|---|---|---|---|
| T1 | Deploy first; Check main reports | workflows ("GitHub Actions cost" thread) | small |
| T2 | `npm run affected`, `EXAMPLES=` in example sweeps | process (this thread) | medium |
| T3 | Sweep slices, drop the duplicate queens sweep | process (this thread) | small |
| T4 | Quick smoke per change, full nightly; shorter waits | E | small |
| T5 | Nightly full run, `good` tag, red goes to the project | workflows | small |
| T6 | Testing rules in WORKFLOW.md; review the three `cons` tests | process | small |
| T7 | Accepted answers, laws, hash-cached checks in the editor | L, then E | large |
| T8 | Browser tests nightly only; editor checks without a browser | process, then E | medium |
| T9 | Every definition drawn by the editor in Node (happy-dom) | process | medium |
| T10 | Editing scenarios in Node, on a stand-in for Playwright's page | process | medium |
| T11 | Drags in Node too; one short browser check; smoke.ts deleted | process | medium |

T1 alone gives back most of the 10 minutes. T2 to T4 make the checks
themselves fast, also for threads before they push. T7 is the interesting
one and the one that fits the language best.
