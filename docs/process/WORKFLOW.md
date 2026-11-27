# Workflow

How work is picked, run and finished in this repo. Started 2026-10-23, after
Ersagun asked for "controlled parallelism": one backlog fed by every source,
prioritized against the roadmap and the project's values, with a fixed small
number of things running at once.

[BACKLOG.md](../../BACKLOG.md) is the single list of open work, grouped by lane
and theme, with a "Next up" table at the top. Nothing is worked on that
isn't in it (urgent bugs get written in as they're started). Finished
items move to [DONE.md](DONE.md).

## Lanes

At most **3 lanes** run at once. Each lane is one long-lived thread that keeps
its context, works on **one item at a time** (one open PR, plus a docs-only PR
if it needs one), and pulls the top item of its own lane when it finishes,
without waiting for the coordinator.

| lane | owns | thread |
|---|---|---|
| **E: Editor** | `editor/`, the editor's tests and smoke | "Editor lane" |
| **C: Compiler and targets** | `compiler/`, JS/WASM/WGSL output, performance, packaging | "Compiler lane" |
| **L: Language and library** | the checker, evaluator, `relate.ts`, std, effects, web runtime, examples, docs, the number systems | "Language lane" |

Why three: the editor rule already allows only one thread in
`editor/` at a time, and the compiler and the language core are
the two other places that change independently. A fourth lane would mean two
threads in the same files. Lanes are areas, not people: an item that needs
two areas goes to the lane where most of its change is, and that lane asks
the other before touching its files.

**Exceptions**, the only ways around the three lanes:

1. **P0 bug** (see below): may run as a fourth, temporary lane, or interrupt
   the lane that owns the files. It ends when the fix is merged.
2. **Ersagun's explicit call**: "do this next" puts an item at the top of its
   lane; "do this now" lets it interrupt the lane's current item (which is
   parked, not thrown away, and resumes after).

The recurring quality practices (QA pass, critical review, bigger program;
see the project instructions) don't take a lane: QA and review write reports
only, and their findings come in as backlog items. The bigger-program round
is lane C's item when it's due.
Each bigger-program round also reports how far the generated programs reach
(`node ters/test/reach.ts`, T18a): the share of `compiler/src` and
`ters/src/lang` that `compiler/test/fuzz.test.ts` runs, and the files it never
enters. A round that adds a part of the language to the generator says which
file it aimed at and the reach before and after (EPHYRA-LESSONS-2026-11-27).

**Keyboard and screen reader, every QA pass** (E231, BLIND-SPOTS-2026-11-03
§10). Besides the mouse, each QA pass does one task with the keyboard only
(Tab, Enter, Esc, Shift+F10 for a menu) and reads one panel as a screen
reader gets it (Playwright's `page.accessibility.snapshot()`, or the
accessibility tree in devtools): every control reachable, named, and a
refused edit saying why. What fails becomes E231 rows, one part at a time.

**Language gaps, every round.** Each bigger-program round records
*language gaps* next to compiler gaps: every place the program declares a
type, defines a helper or wraps a call only because the language lacks
something, and which other examples write around the same thing. Each gap
becomes an L row (P2 when two examples write around it). Targets have a
measure (milliseconds) and notation didn't, which is how the language fell
behind the targets; this is its measure (LANGUAGE-REVIEW-2026-10-24, P4).

## Intake

Everything that surfaces goes into the backlog, not into a new thread:
Ersagun's messages in chat, design notes (docs/README.md lists
them), REVIEW-\*.md, QA-\*.md, docs/reports/GAPS.md, and what a
lane finds while working.

- **The coordinator** adds new items to the Inbox at the top of BACKLOG.md
  (a docs-only PR, which runs no tests, batched with others when possible).
- **A lane** that finds something outside its current item writes it into
  its own lane's list, under the theme it belongs to, in the PR it's
  working on, and keeps going.
- A report (QA, review, GAPS round) lists its findings in its own doc as
  before, and its PR also adds one backlog row per finding, pointing at it.
  Where docs go is in [docs/README.md](../README.md): a QA pass is
  `docs/reports/qa/QA-<date>.md` with its screenshots in
  `docs/reports/qa/screenshots/<date>/`, a review
  `docs/reports/reviews/REVIEW-<date>.md`, a bigger-program round a new
  section of `docs/reports/GAPS.md`, and a design note goes in its area
  under `docs/design/`.

## Triage

The coordinator triages **once a day** (with the daily QA pass) and after
every review: Inbox items get a lane, a priority and a size, and each lane's
list is re-ranked by the criteria below, and "Next up" is set to match.
Lanes don't re-rank their own list, except to move a bug up.

## Priority criteria

From the values in the project instructions and NOTES.md "Standing
rules", and Ersagun's standing calls.

| priority | meaning | examples |
|---|---|---|
| **P0** | Broken now: the live page or an example fails, a crash, a wrong answer, or a claim the language makes is false. Preempts. | shader preview freezes; `equal` disagrees forward and backwards |
| **P1** | Blocks the current roadmap step, or Ersagun asked for it. | the editor's can't-edit list (the next bigger program is written in the editor) |
| **P2** | The next roadmap steps, and bugs that don't block anything. | WASM with GC; duplicated footnotes |
| **P3** | Nice to have, showcases, research. | `conjugate(f, g)`; Clifford algebras |

Within a priority, in this order:

1. **Bugs before features** (step-by-step rule).
2. **Removes a special case before adds a feature** (uniformity: one system,
   no special node kinds). Two page models becoming one beats a new widget.
3. **Removes a workaround in programs**: a place where programs write
   around the language (declare a type, define a helper, wrap a call only
   because the language lacks something). A gap that two examples write
   around is at least **P2** (LANGUAGE-REVIEW-2026-10-24, "Why the language
   stalled behind targets").
4. **Serves the thesis**: things that let programs be *written in the editor*
   come before things that make them faster or run elsewhere. The 2026-10-22
   review found authoring is the weakest leg.
5. **Serves more legs** (regular programs, shaders, web, mobile) before one.
6. **More targets last**: a new target or more speed ranks below every
   language item (Ersagun, 2026-10-24).
7. **Smaller first** when all else is equal, so lanes keep moving.

What each lane takes next is the "Next up" table at the top of BACKLOG.md;
the coordinator updates it at triage and when Ersagun changes direction.
Each lane's cell names only the next few items, in order, in a line or two.
A finished item is removed from it, never logged there: its record is its
row in DONE.md (Ersagun 2026-11-02 asked why BACKLOG.md opened with walls
of text; they were these cells logging every finished row).

### Targets and allocations (Ersagun 2026-11-25)

- **The browser is not Ters's first target.** It is where demos are easy
  to show, nothing more. A design or a speed step isn't chosen because it
  suits JavaScript or the browser, and native and WebAssembly are not
  "the other targets".
- **Don't rely on the engine to absorb allocations.** V8, or any browser
  engine, may make a short-lived value cheap today, but its JIT has a
  small time budget and our compiler can analyse more ("It will hurt us
  eventually"). An allocation idea that measures nothing on JavaScript or
  WebAssembly because the engine hides it is not closed for that: judge
  it on C, or by the allocations it removes, and build it for every
  target where it applies.

## Doing an item

- One item, one PR (one change per PR, never bundled). An L item may be
  split into several rows first. The exception: tiny steps of one row
  (a law, a problem-table row, a renamed message), each well under an
  hour, go together in one PR, so a step doesn't cost a whole check and
  merge cycle (Ersagun 2026-11-05).
- A row that takes more than about an hour is split into one-hour steps
  before a run starts, each its own line in the row, so finished steps
  show and a run isn't spent on rows that never close.
- Each row names one example, and is done when that example works
  (Ersagun 2026-11-05, PROGRESS-2026-11-05.md). Anything beyond it is a
  new row, which has to earn its place by priority like any other. A row
  says only what is left; what was done is its rows in DONE.md, not a
  history in the row.
- **No new examples** (Ersagun 2026-11-25: "Stop adding new examples").
  Lanes add no new programs under `examples/`. A row whose
  example would be a new program waits; a row that an existing example
  shows is built and judged against that example. (This replaces the
  2026-11-14 rule that a row with no example gets one written.)
- Measure an idea by hand before building it (a scratch script, a profile,
  a timing of the slow path), and build it only if it buys at least 10%
  of what it targets. Speed work stops when the next stage buys less (the
  10-hour run of 2026-11-04/05 spent about three hours in two lanes on
  speed ideas that gained 4% or less).
  - **What an idea targets is a kind of cost, not one site** (Ersagun
    2026-11-25, TEN-PERCENT-RULE-2026-11-25.md). Measure it as the kind it
    is (every unneeded finite check, every versioned read, every pair made
    per item) over every benchmark and target it touches, not at one site
    of one benchmark. It passes at 10% on one benchmark, or at about 3%
    geometric mean over the benchmarks it touches.
  - **Where the work has a goal, judge a batch against the goal** (Ersagun
    2026-11-25). For a goal written down (0.5 s a compile, a key in 16 ms,
    a ratio to the ideal), a lane may take steps under 10% while each
    batch of three PRs buys 10% together and the goal is still in reach;
    it stops when a batch doesn't. A flat profile, many parts each under
    10%, is not a stop by itself (stage 4: machine's recompile 820 to 450
    ms in seven PRs, five of them under 10%).
  - **A round that stops "spread thin" names its cause** (Ersagun
    2026-11-25). A performance round or row that stops above 3x the ideal
    because no single pass buys 10% writes a row for what the leftover is
    made of (a representation, a kind of check, the collector on lists
    made between steps), never "no row". If such a row already exists,
    the stop adds its program to that row's examples.
  - **Every idea closed under the bar goes in the cut log**
    ([CUTS.md](../reports/CUTS.md), Ersagun 2026-11-25): one line in the
    PR that closes it, with program, target, kind and what was measured.
    The weekly review sums it by kind and target and asks whether a kind
    now clears the bar as a whole.
- The PR body says which item: `Backlog: E3`. The same PR moves the row to
  the table of the lane that did it in [DONE.md](DONE.md) (its own table,
  at the top, whatever the row's letter, so two lanes never edit the same
  lines; QA, reviews, rounds and the coordinator use the last table) with
  its PR number, takes it off its
  lane's line in "Next up" at the top of BACKLOG.md, and adds any follow-up rows it found. The
  number isn't known before the PR exists, so write "this PR" and fill it
  in with the lane's next PR: a push only for the number costs a CI run.
- Credit external ideas as the project instructions say.
- **UI text is lean** (Ersagun 2026-11-16): heads and labels name things,
  structure (sections, size, spacing, colour, component) explains them, and
  explanations go in tooltips, warnings and help, not in the panel.
  [UI-TEXT.md](../design/editor/UI-TEXT.md) has the rule and the words; the
  `ui-text` project skill is its checklist, and `unslop` checks longer text.
- **Before merging: type-check, then `node ters/test/affected.ts`, and
  trust what it runs** (TESTING.md §8, T16, Ersagun 2026-11-14). It picks
  the tests from the test map (what each test ran and read, recorded by
  CI): the cheapest set that still runs every line your branch changed,
  the tests named for a changed file, the ones that broke main on
  2026-11-27 (choices, kept-items, module-decisions, map-tree, the mnist
  tests), then every other test that ran a changed line or read a changed
  file, quickest first, while the whole run fits in about ten minutes
  (Ersagun 2026-11-27). `--list --why` says which and why. Never pick files by hand, never add `--full` or `--all` "to be
  safe", and after a fix run it again rather than a bigger set: it runs
  only what the fix reaches. While working, run the file of what you
  edited by name (`node --test test/….test.ts`); the command is for the
  merge. The browser tests (the editor, shaders, sound, the GPU check) run
  once a night; `-- --browser` runs them now, only for a change risky for
  the page. A pull request's CI only type-checks.
- **After merging, CI does the rest.** A merge deploys in about two
  minutes. "Check main" runs, beside the deploy, every test that ran a line
  changed since its own last run (`--since-map`), and records what it ran
  back into the map. The Nightly (03:00 UTC) adds the tests due for review
  (1, 2, 4, then 7 days of clean runs; a failure or an edit to the test
  brings it back to daily), so every test still runs weekly and none runs
  twice on code it passed on. A file that fails names the commit that
  broke it in the run's summary (`--bisect`). Look at Check main for your
  commit; if it is red, or a later run names your commit, revert your
  commit at once (a pull request titled "Main red (<failing file>): revert
  #N"), then land it again with the fix (Ersagun 2026-11-27: main was red
  7.5 of 14 hours from fixes made forward). Main red for more than an hour stops every lane's merges
  (P10, REVIEW-2026-11-16 §1: 42 merged through 16 red hours): merge
  nothing until Check main is green again, or the failing file has a row
  a lane is taking; a lane's own fix for it merges. The "Main green" check (T17,
  ters/test/main-red.ts) enforces this: a pull request fails it while Check
  main has been red for more than an hour, unless its title names a failing
  file (path or file name); re-run it once main is green. The coordinator
  watches Check main and the Nightly (a red nightly is a P0). This rule is settled: when it costs too much or misses
  too much, tune affected.ts and the map, not the rule.
- Merge when green; the editor rules (click through the live page, run every
  example's main both ways) still apply after editor merges.
- Squash with the PR's own title and summary only: pass the merge a commit
  title (the PR title and number) and a commit message (the PR's summary).
  Left out, the squash carries every commit message of the lane's long-lived
  branch since it last merged.
- **Never end a turn waiting for a notice** (Ersagun, 2026-10-31: "threads
  keep waiting for stuff that never happens"). CI, review and merge notices
  often don't arrive. After pushing, check the PR yourself in the same
  turn: its workflow run for the head commit, and whether it can merge. A
  PR with a merge conflict runs no CI at all, so merge main in first. Wait
  and re-check for up to about 15 minutes. If it's still pending, start the
  next item and come back to the PR between steps. The same goes for
  another lane's answer. Something only Ersagun can decide is asked once,
  and the thread moves to its next item while it waits.

## Tests

What a test may say, so tests protect the language without pinning
today's design in place (Ersagun, 2026-10-23: a suite of `cons` tests
would keep us a Lisp; docs/process/TESTING.md has the reasoning).

- **Say it in the language's terms.** A test states what a program does
  (an example's output; run and compiled printing the same), or a law
  (forward and backwards agree, a round trip, an equality law, every
  palette offer type-checks). Not the shape of an implementation: node
  kinds, private functions, internal data layout, or the wording of UI
  text unless the text is the feature.
- **Quantify over the examples, don't list cases.** A law over every
  example tests the next example for free and doesn't make today's
  representation feel load-bearing. One law "a list read back from the
  blocks is the list written" survives a move from `cons` to arrays; five
  tests about `cons` cells don't.
- **Every test says what it protects** in its first comment. When a
  design goes, its tests go in the same PR, and the PR says so. That is
  normal, not cheating. Still never allowed: weakening or skipping a test
  while the behaviour it protects is meant to stay the same.
- **Under 5 seconds per file per change.** Anything slower is a sweep and
  checks a slice per run with `sweep()` from `ters/test/helpers.ts`
  (all of it nightly and with `SWEEP=all`).
- **No coverage targets.** Whether the tests earn their time is judged in
  the critical review, sometimes with a mutation pass (change the code,
  see if any test notices), not by a number to raise.

## Ids and sizes

Ids are a lane letter and a number (`E3`, `C12`, `L7`), never reused, and an
item keeps its id if it changes lane. Sizes: **S** a few hours, **M** about a
day, one PR, **L** several PRs or a design note first.
