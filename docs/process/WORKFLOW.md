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
| **E: Editor** | `projectional/editor/`, the editor's tests and smoke | "Editor lane" |
| **C: Compiler and targets** | `compiler/`, JS/WASM/WGSL output, performance, packaging | "Compiler lane" |
| **L: Language and library** | the checker, evaluator, `relate.ts`, std, effects, web runtime, examples, docs, the number systems | "Language lane" |

Why three: the editor rule already allows only one thread in
`projectional/editor/` at a time, and the compiler and the language core are
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

## Doing an item

- One item, one PR (one change per PR, never bundled). An L item may be
  split into several rows first.
- The PR body says which item: `Backlog: E3`. The same PR moves the row to
  its lane's table in [DONE.md](DONE.md) with its PR number, updates its
  lane's line in "Next up" at the top of BACKLOG.md, and adds any follow-up rows it found. The
  number isn't known before the PR exists, so write "this PR" and fill it
  in with the lane's next PR: a push only for the number costs a CI run.
- Credit external ideas as the project instructions say.
- Before pushing, run the tests your change reaches: `npm run affected`
  in projectional (unit tests in all three packages; `-- --list` says
  which). The browser tests (the editor, shaders, sound, the GPU check)
  take about ten minutes, so they run once a night, not per change; run
  them before pushing only when a change is risky for the page, with
  `npm run affected -- --browser` (set CHROMIUM to a Chromium if Chrome
  isn't installed). A pull
  request's CI only type-checks. A merge deploys in about two minutes;
  "Check main" runs the same selection beside the deploy, from the last
  commit it passed, without the browser tests, and reports without
  stopping it. After merging, look
  at Check main for your commit: if it is red, whoever broke main fixes it
  next. `npm run affected -- --all` runs everything with every sweep in
  full, as the Nightly workflow does at 03:00 UTC; the coordinator checks
  its result at the daily triage, and a red nightly is a P0.
- Merge when green; the editor rules (click through the live page, run every
  example's main both ways) still apply after editor merges.
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
  checks a slice per run with `sweep()` from `projectional/test/helpers.ts`
  (all of it nightly and with `SWEEP=all`).
- **No coverage targets.** Whether the tests earn their time is judged in
  the critical review, sometimes with a mutation pass (change the code,
  see if any test notices), not by a number to raise.

## Ids and sizes

Ids are a lane letter and a number (`E3`, `C12`, `L7`), never reused, and an
item keeps its id if it changes lane. Sizes: **S** a few hours, **M** about a
day, one PR, **L** several PRs or a design note first.
