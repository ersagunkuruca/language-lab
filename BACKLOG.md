# Backlog

Every open item from every source, in one place. How it's used, the lanes and
the priority criteria are in [WORKFLOW.md](WORKFLOW.md). Each lane's list is in
priority order: a lane takes its top item that isn't running.

First gathered 2026-10-23 from projectional/ROADMAP.md, NOTES.md, WEB.md,
NUMBERS.md, COMPILER.md, REVIEW.md, REVIEW-2026-10-22b.md (R2), QA-2026-10-22.md,
QA-2026-10-23.md (QA2), compiler/GAPS.md, the editor and compiler threads'
queues, and Ersagun's messages in the project chat.

**Status:** ▶ running (don't disturb) · ⏸ parked · blank = waiting.
**Size:** S hours · M one PR · L several PRs or a design note first.

## Inbox

New items land here until the next triage gives them a lane and a priority.

| id | item | source | added |
|---|---|---|---|
| | *(empty)* | | |

## E: Editor

Thread "Writing programs in the editor". Current step: the can't-edit list,
so the next bigger program can be built in the editor.

| id | item | source | pri | size | status |
|---|---|---|---|---|---|
| E2 | Statement order in an action: move a `print` step in `main` up or down | QA2 can't-edit 3, R2 §9.8 | P1 | M | |
| E3 | Clearing a node to a hole generalizes the definition's type (`period : (a, b) -> Number`) | QA2 L3 | P1 | S | |
| E4 | A used input can't be removed: offer remove-and-leave-holes | QA2 can't-edit 5 | P1 | S | |
| E5 | Tabs pile up off the right edge, no overflow control | QA2 UX2 | P2 | S | |
| E6 | Show inline overflows the graph with no refit; its labels sit on wires | QA2 UX3 | P2 | S | |
| E7 | Add a value here: the palette takes 2 to 4.5 s on solved functions (a whole-program check per candidate) | QA 2026-10-22 | P2 | M | |
| E8 | Nested view duplicates footnotes | QA2 L1 | P2 | S | |
| E9 | `^2` in solver output where the editor writes `²` | QA2 L4 | P2 | S | |
| E10 | A program opens on its last open definition, not on `main` | QA2 UX6 | P2 | S | |
| E11 | Zoom level isn't shown ("100%" stays at 60%); Fit pill covers nodes | QA2 UX4, UX5 | P2 | S | |
| E12 | Unit refusals name the units ("speed is m/s, gravity is m/s²") | QA2 UX9 | P2 | S | |
| E13 | Navigator search covers only the open program | QA2 L2 | P2 | S | |
| E14 | Palette on an `a` hole: 211 entries starting with `for each`; a new `main` has no "print first"; check whether `√` and `1 + 2` find anything after #168 | QA2 can't-edit 6 | P2 | S | |
| E15 | Keyboard editing: Tab reaches no node, port or hole | QA2 UX7 | P2 | L | |
| E16 | "Copy into my program" and "pin" gestures for modules | ROADMAP step 5 open | P2 | M | |
| E17 | Tidy that cuts crossings (layered, Sugiyama-style; credit as prior art) | node-editor backlog | P3 | M | |
| E18 | Wires routed around nodes | node-editor backlog | P3 | M | |
| E19 | Minimap / "there's more" cue, and collapsible frames | node-editor backlog, QA2 UX4 | P3 | M | |
| E20 | Phone width (390 px): panes stack into a 3,100 px page | QA2 UX8 | P3 | L | |
| E21 | Palette entry for Int literals | real-sized data follow-up | P3 | S | |

## C: Compiler and targets

Thread "Bigger programs and compiler gaps". Current step: GAPS round 2
(chapters is about 5× the ideal), then round 3, a bigger program built in the
editor.

| id | item | source | pri | size | status |
|---|---|---|---|---|---|
| C2 | G21 lists that are only walked are arrays (and ropes later) | GAPS G21, folds follow-up | P1 | L | ▶ part 1 built: lists walked whole (chapters 199 → 167 ms); next: lists built by consing (`taken`), then matched lists |
| C3 | GAPS round 3: a program bigger than chapters, built in the editor with the DSL off-limits; what hurts goes to lane E | quality practice 3, R2 §7 | P1 | L | after C1, C2 |
| C4 | G3 again: a lambda whose result is Bool still boxes it (`keep`'s test) | GAPS G3 | P2 | S | |
| C5 | G14 again: `heading` and `code`/`fromCode` are generators though they have one answer | GAPS G14 | P2 | S | |
| C6 | G13 again: `sections` builds a `Pile` per line; single-answer functions returning several values | GAPS G13 | P2 | M | |
| C7 | WebAssembly for full programs (WasmGC or our own GC); design note first | ROADMAP 6 | P2 | L | after the editor step and L4 |
| C8 | `Float32` for shaders | ROADMAP 6a left | P2 | M | |
| C9 | Compiled JS still calls the runtime's `$derivative`; expand derivatives as the scalar profile does | shaders follow-up | P2 | S | |
| C10 | Compiled plain recursion past about 10k levels (check what's left after G1's 1 GB stack) | ROADMAP steps 1-5 open | P2 | S | |
| L2 | Fuel means two things: running out inside plain code abandons the whole `with fuel` body when compiled, where the evaluator lets a later branch go on. Fix in compile.ts (out-of-fuel becomes a Choice failure where plain code is called from a search); no program hits it yet (COMPILER.md "Diverge and fuel") | R2 §5 | P2 | M | moved from lane L: the change is in compiler/ |
| C11 | G17 a copy per type for generics used at several types | GAPS G17 | P3 | M | |
| C12 | G18 an Abort handler that never resumes is a try/catch | GAPS G18 | P3 | S | |
| C13 | G1 again: drop `$spend` when no `with fuel` is reachable | GAPS G1 | P3 | S | |
| C14 | G12 `one of([true, false])` runs both branches without a list | GAPS G12 | P3 | S | |
| C15 | G2 equality with a constructed constant, inline form | GAPS G2 | P3 | S | |
| C16 | G10 readability of the output (indentation) | GAPS G10 | P3 | S | |
| C17 | Native binaries through WASM (wasm2c) or C with reference counting | ROADMAP 6 | P3 | L | after C7 |
| C18 | Mobile as a packaged web app (PWA or Capacitor) | ROADMAP 7 | P3 | M | |

## L: Language and library

Thread "Backlog and planned workflow", which also keeps this file current.

| id | item | source | pri | size | status |
|---|---|---|---|---|---|
| L4 | One page model: reactive.html's programs onto std's `Html`, remove `ui.ts`'s `UI` | R2 §5, WEB.md, ROADMAP | P1 | M | |
| L5 | Effect ledger and container matrix: a test that every consumer of a type asks for its effects | R2 §1.2, §9.6 | P1 | M | |
| L6 | A page's `on` row is closed and hand-picked; a named row defined once, or an open row | R2 §5 | P2 | M | |
| L7 | One record per builtin instead of up to eleven tables; before WASM adds a twelfth | R2 §4 | P2 | L | before C7 |
| L8 | The error table generated from tests, each row pointing at its test | R2 §6, REVIEW.md §9 | P2 | M | |
| L9 | Retire or archive `examples/compose` and `examples/quadratic` (untyped, 32-bit ids, six check errors) | R2 §5 | P2 | S | |
| L10 | Shader soak test (10 s) | R2 §9.6 | P2 | S | |
| L11 | Mode analysis through cases and folds (the general fix for backwards search order) | R2 §3, ROADMAP step 4 open | P2 | L | |
| L12 | Tutorial and its screenshots brought up to the current editor | ROADMAP 2 | P2 | M | after the editor step |
| L13 | Keyed lists in pages | ROADMAP 7, WEB.md | P2 | M | |
| L14 | `solve` over a function value: one generic `bind` | ROADMAP 7 | P2 | M | |
| L15 | Static output from `lab run` for pages | ROADMAP 7 | P3 | S | |
| L16 | Guarded corecursion, and a stateful handler form so programs write their own Cells | ROADMAP 4 open | P3 | L | |
| L17 | Data-type upgrades and path namespaces for modules | ROADMAP 5 open | P3 | L | |
| L18 | Relational reads past about 1,300 items; a stackless `relate.ts` | ROADMAP 1-5 open, real-sized data | P3 | M | |
| L19 | Numbers stage 1: Int as data (match/fold view), Rational; stage 2: overloading by name | NUMBERS.md | P3 | L | |
| L20 | `set` with general functions through relations | real-sized data follow-up | P3 | M | |
| L21 | Folds: a `build` row for user producers, user representations per value, folds with `Choice` asking the table | ROADMAP 5 open | P3 | L | |
| L22 | Profiles inferred like effects and shown in the editor ("runs on the GPU"), instead of a second checker in the compiler | R2 §5, REVIEW.md §5.2 | P3 | L | |
| L23 | Showcase `conjugate(f, g)` = f⁻¹ ∘ g ∘ f: colour-space edit, object-vs-world transform, multiband guitar effect | Ersagun 2026-10-22, NOTES.md | P3 | M | |
| L24 | Research as it becomes blocking: costs from folds, laws proved by fusion, fast invertible parsing, exact reals, Clifford algebras | ROADMAP 8 | P3 | L | |

## Coordinator and process

Not lane work; the coordinator does these or asks Ersagun.

| id | item | source | pri | status |
|---|---|---|---|---|
| P1 | PRs #43 and #44 open since 2026-10-22 morning, likely superseded by #49: close or land | R2 §8 | P2 | |
| P2 | Batch deploys (deploy is its own workflow) if Actions cost needs it | Ersagun 2026-10-23 08:26 | P3 | asked, not requested |
| P3 | A per-repo Actions budget, or a public repo for free Actions | thread "GitHub Actions cost" | P3 | Ersagun's call |

## Done

Recent first, one table per lane so that lanes finishing items at the
same time don't edit the same lines. Older history is in git and in the
roadmap's Done table; this section keeps about a week.

### E: Editor

| id | item | PR |
|---|---|---|
| E1 | Inner lambda parameters: add, remove, reorder | #179 |
| | Right-click menu edits show what they selected (QA2 H1's last part) | #177 |

### C: Compiler and targets

| id | item | PR |
|---|---|---|
| C1 | G16 fusion: steps over a list run as one loop (chapters 550 → 200 ms) | #176 |

### L: Language and library

| id | item | PR |
|---|---|---|
| L3 | LANGUAGE.md says what runs: effects list, bundled output, totality row, Choice-and-world gap (now tested) | this PR |
| L1 | Run refuses a program that doesn't type-check, naming the definition | #178 |

### Before the backlog

| id | item | PR |
|---|---|---|
| | Countdown in the program list (Hutton credited) | #174 |
| | QA2 H1, H2, M1 to M4 | #137, #139, #159, #160, #158, #156 |
| | Can't-edit: change a call's function keeping its inputs; field types | #151, #147 |
| | GAPS round 2: G9, G11, G13, G14, G15, G17 (one type), G19 (half) | #133 to #170 |
| | Second review fixes 1 to 6 (builtin half), agreement test, TypeScript type-check in CI | #117 to #173 |
