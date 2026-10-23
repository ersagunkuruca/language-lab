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
| | Editor: a function parameter can't be called until its type is known (no `f(□, □)` for an untyped `f`); blocks higher-order definitions written from scratch | GAPS round 3, editor 1 | 2026-10-23 |
| | Editor: a text literal can't hold a newline (one-line field; `"\n"` is taken literally) | GAPS round 3, editor 2 | 2026-10-23 |
| | Editor: *Add a value here…* adds a step only at a definition's top, never inside a match arm | GAPS round 3, editor 3 | 2026-10-23 |
| | Editor: typing `0` in an Int hole offers nothing (E21 is now in the way of every program with Int) | GAPS round 3, editor 4 | 2026-10-23 |
| | Editor: palette rows with the same label (`show(□)` ×3, `cents(□)` ×2) told apart only by the type line | GAPS round 3, editor 5 | 2026-10-23 |
| | Editor: spaces in a typed text are collapsed (`"  × "` → `" × "`) | GAPS round 3, editor 6 | 2026-10-23 |
| | Editor: Text view drops brackets around an `if` inside `++` | GAPS round 3, editor 7 | 2026-10-23 |
| | Editor: a definition with `Console` runs (and prints) while it's being written | GAPS round 3, editor 8 | 2026-10-23 |

## E: Editor

Thread "Writing programs in the editor". Current step: the can't-edit list,
so the next bigger program can be built in the editor.

| id | item | source | pri | size | status |
|---|---|---|---|---|---|
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

Thread "Bigger programs and compiler gaps". Current step: C2's part left (lists matched on,
and lists built by G22's loops), then the rest in order.

| id | item | source | pri | size | status |
|---|---|---|---|---|---|
| C2 | G21 lists as arrays, the part left: lists that are matched on (the array and a start), and lists built by G22's loops; ledger's G23 is the first program that needs it (four spines per run, `split` lines matched in `entries` and `parse`) | GAPS G21, G23 | P2 | M | parts 1 #182, 2 #188 done |
| C4 | G3 again: a lambda whose result is Bool still boxes it (`keep`'s test); a Bool parameter is data too (ledger's `by name`) | GAPS G3, round 3 | P2 | S | |
| C5 | G14 again: `heading` and `code`/`fromCode` are generators though they have one answer; so are `read whole number` and the other at-most-one builtins under `first` (G24) | GAPS G14, G24 | P2 | S | |
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
| L7 | One record per builtin instead of up to eleven tables; before WASM adds a twelfth. The drift half is guarded already: `compiler/test/builtins.test.ts` asks every job of every builtin. What's left is moving code across `compiler/` (lane C) and the editor, so it waits for a slot between lane C's items | R2 §4 | P2 | L | needs lane C between items |
| L11 | Mode analysis through cases and folds (the general fix for backwards search order). Design: projectional/MODES.md. Next: L11c `relate.ts` follows the schedule (and a `det` mode drops `Choice`); lane C and E parts after | R2 §3, ROADMAP step 4 open | P2 | L | ▶ L11a, L11b done |
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
| L25 | Container matrix, the other four places: a `solve` body, a shader, a representation's job, a pinned export | R2 §1.2, L5 | P2 | M | |
| L26 | The ledger in code: every place that removes an effect from a row calls one `discharge(effect, why)`, and a test compares the calls with the table | R2 §1.2 | P2 | M | |
| L27 | `Log` in a page's views and handlers: the runtime handles it everywhere else, but neither page row allows it | L6 | P3 | S | |

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
| E6 | Show inline refits the graph; canvas labels get a halo | #199 |
| E5 | Tabs: six at most, shrink to fit the pane | #196 |
| E4 | Remove a used input: its uses become holes | #194 |
| E3 | Clearing a node keeps its definition's type while the hole is open | #191 |
| E2 | Reorder an action's steps: Do it earlier / later | #184 |
| E1 | Inner lambda parameters: add, remove, reorder | #179 |
| | Right-click menu edits show what they selected (QA2 H1's last part) | #177 |

### C: Compiler and targets

| id | item | PR |
|---|---|---|
| C20 | G25 list cells nobody else holds changed in place (`$own` copies): ledger's `by account` 35 → 25 ms, about 10% overall | this PR |
| C19 | G22 tail recursion modulo cons: `cons(x, self(rest))` fills holes in a loop, so ledger runs 50,000 lines on the default stack | #200 |
| C3 | GAPS round 3: ledger, 32 definitions built in the editor by clicks; compiled 2 to 4× the ideal; G22 (stack), G23, G24 and eight editor frictions | #197 |
| C2 | G21 parts 1 and 2: lists walked whole, and accumulators, stay arrays (chapters about 3.4× → 1.9× the ideal) | #182, #188 |
| C1 | G16 fusion: steps over a list run as one loop (chapters 550 → 200 ms) | #176 |

### L: Language and library

| id | item | PR |
|---|---|---|
| L11b | Types from modes: a relational `solve` is `Diverge` only when its mode may not end (says why), and a direction nothing pins down is an error at the `solve`; `mayLoop` removed | this PR |
| L11a | `modes.ts`: a schedule, how many answers and whether it ends, for any mode; reports only, checked against relate.ts and the checker (`test/modes.test.ts`). `map` and `show numbers` backwards end, so their `Diverge` is a false alarm | #195 |
| L11 | Design note for mode analysis: projectional/MODES.md | #193 |
| L10 | Shader soak: `npm run smoke-shaders` lets the pictures move for 10 s each way (GPU and CPU) and fails if the page stops answering, the browser goes 500 ms without a frame, or a picture drops under 2 frames a second | #192 |
| L9 | `examples/compose` archived (`examples/archive/`, says why); `quadratic` kept, it type-checks and the editor's numbers program uses it | #190 |
| L8 | The error table names its tests: generated from `test/errors.test.ts`, which fails if a test is missing or the table was edited by hand; new row for effects hidden where a function waits | #189 |
| L6 | A page's rows named once (`PAGE_VIEW`, `PAGE_HANDLER`), checked against the runtime; closed on purpose, WEB.md says why | #186 |
| L5 | Container matrix: 10 places a function can wait × 4 effects, each reaches the type, is refused, or is the runtime's on purpose; no holes found | #185 |
| L4 | One page model: reactive.html draws std's `Html`, its widgets are definitions, `ui.ts` and `UI` removed | #183 |
| L3 | LANGUAGE.md says what runs: effects list, bundled output, totality row, Choice-and-world gap (now tested) | #181 |
| L1 | Run refuses a program that doesn't type-check, naming the definition | #178 |

### Coordinator and process

| id | item | PR |
|---|---|---|
| P4 | CI on a pull request is only the type check (under a minute); unit and browser tests run once per merge before the deploy | #187 |

### Before the backlog

| id | item | PR |
|---|---|---|
| | Countdown in the program list (Hutton credited) | #174 |
| | QA2 H1, H2, M1 to M4 | #137, #139, #159, #160, #158, #156 |
| | Can't-edit: change a call's function keeping its inputs; field types | #151, #147 |
| | GAPS round 2: G9, G11, G13, G14, G15, G17 (one type), G19 (half) | #133 to #170 |
| | Second review fixes 1 to 6 (builtin half), agreement test, TypeScript type-check in CI | #117 to #173 |
