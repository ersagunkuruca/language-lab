# Workflow

How work is picked, run and finished in this repo. Started 2026-10-23, after
Ersagun asked for "controlled parallelism": one backlog fed by every source,
prioritized against the roadmap and the project's values, with a fixed small
number of things running at once.

[BACKLOG.md](BACKLOG.md) is the single list of open work. Nothing is worked on
that isn't in it (urgent bugs get written in as they're started).

## Lanes

At most **3 lanes** run at once. Each lane is one long-lived thread that keeps
its context, works on **one item at a time** (one open PR, plus a docs-only PR
if it needs one), and pulls the top item of its own lane when it finishes,
without waiting for the coordinator.

| lane | owns | thread |
|---|---|---|
| **E: Editor** | `projectional/editor/`, the editor's tests and smoke | "Writing programs in the editor" |
| **C: Compiler and targets** | `compiler/`, JS/WASM/WGSL output, performance, packaging | "Bigger programs and compiler gaps" |
| **L: Language and library** | the checker, evaluator, `relate.ts`, std, effects, web runtime, examples, docs | started when its first item is picked |

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

## Intake

Everything that surfaces goes into the backlog, not into a new thread:
Ersagun's messages in chat, ROADMAP.md, planning notes (NOTES.md, WEB.md,
NUMBERS.md, COMPILER.md), REVIEW-\*.md, QA-\*.md, compiler/GAPS.md, and what a
lane finds while working.

- **The coordinator** adds new items to the Inbox at the top of BACKLOG.md
  (a docs-only PR, which runs no tests, batched with others when possible).
- **A lane** that finds something outside its current item writes it into
  its own lane's list in the PR it's working on, and keeps going.
- A report (QA, review, GAPS round) lists its findings in its own doc as
  before, and its PR also adds one backlog row per finding, pointing at it.

## Triage

The coordinator triages **once a day** (with the daily QA pass) and after
every review: Inbox items get a lane, a priority and a size, and each lane's
list is re-ranked by the criteria below. Lanes don't re-rank their own list,
except to move a bug up.

## Priority criteria

From the roadmap (projectional/ROADMAP.md), the values in the project
instructions and NOTES.md "Standing rules", and Ersagun's standing calls.

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
3. **Serves the thesis**: things that let programs be *written in the editor*
   come before things that make them faster or run elsewhere. The 2026-10-22
   review found authoring is the weakest leg.
4. **Serves more legs** (regular programs, shaders, web, mobile) before one.
5. **Smaller first** when all else is equal, so lanes keep moving.

The current roadmap step (set by the second review, 2026-10-22): the editor's
can't-edit list and a bigger program built in the editor, then one page
model, then WebAssembly. Update this line when the step changes.

## Doing an item

- One item, one PR (one change per PR, never bundled). An L item may be
  split into several rows first.
- The PR body says which item: `Backlog: E3`. The same PR moves the row to
  its lane's table under **Done** with its PR number, and adds any follow-up rows it found. The
  number isn't known before the PR exists, so write "this PR" and fill it
  in with the lane's next PR: a push only for the number costs a CI run.
- Credit external ideas as the project instructions say.
- Before pushing, run the tests your change reaches: `npm run affected`
  in projectional (unit tests in all three packages, and the browser tests
  when the pages could change; `-- --list` says which). Set CHROMIUM to a
  Chromium for the browser tests if Chrome isn't installed. A pull
  request's CI only type-checks. A merge deploys in about two minutes;
  "Check main" runs the same selection beside the deploy, from the last
  commit it passed, and reports without stopping it. After merging, look
  at Check main for your commit: if it is red, whoever broke main fixes it
  next. `npm run affected -- --all` runs everything with every sweep in
  full, as the Nightly workflow does at 03:00 UTC; the coordinator checks
  its result at the daily triage, and a red nightly is a P0.
- Merge when green; the editor rules (click through the live page, run every
  example's main both ways) still apply after editor merges.

## Ids and sizes

Ids are a lane letter and a number (`E3`, `C12`, `L7`), never reused, and an
item keeps its id if it changes lane. Sizes: **S** a few hours, **M** about a
day, one PR, **L** several PRs or a design note first.
