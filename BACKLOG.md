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

## E: Editor

Thread "Writing programs in the editor". Current step: the can't-edit list,
so the next bigger program can be built in the editor.

| id | item | source | pri | size | status |
|---|---|---|---|---|---|
| E29 | A short text literal can't get a newline (the multiline box only opens for text that already has one, #206) | GAPS round 3, editor 2 | P2 | S | |
| E30 | *Add a value here…* adds a step only at a definition's top, never inside a match arm | GAPS round 3, editor 3 | P2 | M | |
| E31 | Palette rows with the same label (`show(□)` ×3) told apart only by the type line | GAPS round 3, editor 5 | P2 | S | |
| E32 | Picture CPU fallback and its check run in float64; run them in Float32 (`withFloat32` + `represent`, as compiler/gpu.ts) | C8 | P2 | S | |
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
| C6 | G13 again, the part left: single-answer functions returning several values (Countdown's `join` builds its `found`) | GAPS G13 | P3 | M | fold part done |
| C7 | WebAssembly for full programs (WasmGC or our own GC); design note first | ROADMAP 6 | P2 | L | after the editor step and L4 |
| C22 | G21/G23 again: a list matched and handed to itself (ledger's `entries`) as an array and an index (`$arr` copies taking both), and lists built by G22's holes kept as arrays, so the folds from the end need no spine | GAPS G23 | P3 | M | |
| C21 | Recursion that isn't a tail call on the heap (the evaluator's continuations) for definitions the checker finds recursive, so web pages and imported modules go past about 1,500 levels as `lab compile` does | GAPS G1, C10 | P3 | L | |
| C11 | G17 a copy per type for generics used at several types | GAPS G17 | P3 | M | |
| C15 | G2 equality with a constructed constant, inline form | GAPS G2 | P3 | S | |
| C16 | G10 readability of the output (indentation) | GAPS G10 | P3 | S | |
| C17 | Native binaries through WASM (wasm2c) or C with reference counting | ROADMAP 6 | P3 | L | after C7 |
| C18 | Mobile as a packaged web app (PWA or Capacitor) | ROADMAP 7 | P3 | M | |

## L: Language and library

Thread "Backlog and planned workflow", which also keeps this file current.

| id | item | source | pri | size | status |
|---|---|---|---|---|---|
| L7 | One record per builtin instead of up to eleven tables; before WASM adds a twelfth. The drift half is guarded already: `compiler/test/builtins.test.ts` asks every job of every builtin. What's left is moving code across `compiler/` (lane C) and the editor, so it waits for a slot between lane C's items | R2 §4 | P2 | L | needs lane C between items |
| L11 | Mode analysis through cases and folds (the general fix for backwards search order). Design: projectional/MODES.md. Next: lane C compiles `det` and `semidet` modes as plain functions, lane E shows the mode on the `solve` node | R2 §3, ROADMAP step 4 open | P2 | L | ▶ L11a to L11d done |
| L12 | Tutorial and its screenshots brought up to the current editor | ROADMAP 2 | P2 | M | after the editor step |
| L16 | Guarded corecursion, and a stateful handler form so programs write their own Cells | ROADMAP 4 open | P3 | L | |
| L17 | Data-type upgrades and path namespaces for modules | ROADMAP 5 open | P3 | L | |
| L18 | Relational reads past about 1,300 items; a stackless `relate.ts` | ROADMAP 1-5 open, real-sized data | P3 | M | show numbers reads back 3,000 numbers since L11c (each level of a fold run backwards starts on a fresh stack); plain recursion still uses the stack |
| L19 | Numbers stage 1: Int as data (match/fold view), Rational; stage 2: overloading by name | NUMBERS.md | P3 | L | |
| L20 | `set` with general functions through relations | real-sized data follow-up | P3 | M | |
| L21 | Folds: a `build` row for user producers, user representations per value, folds with `Choice` asking the table | ROADMAP 5 open | P3 | L | |
| L22 | Profiles inferred like effects and shown in the editor ("runs on the GPU"), instead of a second checker in the compiler | R2 §5, REVIEW.md §5.2 | P3 | L | |
| L23 | Showcase `conjugate(f, g)` = f⁻¹ ∘ g ∘ f: colour-space edit, object-vs-world transform, multiband guitar effect | Ersagun 2026-10-22, NOTES.md | P3 | M | |
| L24 | Research as it becomes blocking: costs from folds, laws proved by fusion, fast invertible parsing, exact reals, Clifford algebras | ROADMAP 8 | P3 | L | |
| L29 | Function variables' rows checked in any order: a use that fixes a variable's row wider before the use that closes it (a page field's `view` handed to `inverse` before it's shown) still clashes; the closing use should win, as it does in the other order. And the checker typing `inverse(f, …)` from f at the call, as the modes already do, instead of Diverge | L14 | P3 | M | |

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
| E28 | An untyped input can be called from the palette: before(□, □) | #239 |
| E27 | A whole number typed in an Int hole fills it as an Int | #237 |
| E26 | Definitions that print or write files run only when asked | #236 |
| E25 | Text view brackets a one-line if inside ++ | #234 |
| E24 | Graph keeps the spaces in a text literal (SVG collapsed them) | #231 |
| E13 | Navigator search finds definitions in every program | #227 |
| E12 | Unit refusals name the units on both sides | #223 |
| E23 | Bug: the live page's buttons went dead after opening another definition (Chrome drops listeners when the frame is redrawn) | #221 |
| E11 | The zoom button shows the zoom; Fit keeps clear of the pill | #215 |
| E10 | A program opens on `main`, its showcase definition in the next tab | #212 |
| E9 | Solver output writes powers as superscripts (`time²`) | #211 |
| E8 | Nested view listed a comment on a called lambda as two footnotes | #207 |
| E22 | Long and multiline text literals render compactly (first line + "· N lines", full text on hover, multiline edit box) | #206 |
| E7 | Add a value here: palette 7.5 s → 1.7 s on solved functions | #203 |
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
| C14 | G12: `one of` a few constants written in place runs each in turn, with no list | this PR |
| C12 | G18: a handler whose cases all escape is an inline try/catch (calc enters one per line; gain within noise) | #233 |
| C13 | G1 again: a program `lab compile` writes spends fuel only in calls that can be under a `with fuel` (calc has no checks left; the gain is within noise) | #230 |
| C2 | G21 part 3: a list from `split` taken apart by matches is an index into the array (ledger's `parse` makes no cells, about 5 to 10%); the rest is C22 | #228 |
| C8 | `Float32`: an approximate representation of `Number` (every job rounded to binary32, literals too), so f32 is in the program rather than the GPU's choice; on the GPU test, 578 of 1001 values (functions of + − × only) now match the evaluator exactly instead of closely. Design #220, builtin #224, representation #225 | #226 |
| C10 | Deep recursion checked: `lab compile` takes 1,000,000 nested parentheses; on the default stack compiled and the ideal both stop near 1,500, no gap; heap continuations left as C21 | this PR |
| C9 | Compiled JS expands `derivative` and `gradient` of a known function at compile time, as the scalar profile does; only a function known at run time asks the runtime's `$derivative` | #217 |
| C6 | G13 again, the fold part: a fold whose answer is one record carries its fields in locals and builds it once (chapters' `sections`, one record fewer per line) | #214 |
| L2 | Fuel in plain code inside a search: running out fails that branch only, as in the evaluator, instead of ending the whole `with fuel` body (guards only in programs that use `with fuel`) | #210 |
| C4 | G3 again: Bool parameters of definitions only called by name, and tests written in place for a fused `keep`, are JS booleans (ledger's `goes before`, chapters' `slug` and `words`) | #208 |
| C5 | G24 and G14 again: Choice builtins are partial (`$partial`, one answer or none), and `first` over a body with one answer runs it in place (ledger's `amount`, chapters' `lower`) | #204 |
| C20 | G25 list cells nobody else holds changed in place (`$own` copies): ledger's `by account` 35 → 25 ms, about 10% overall | #202 |
| C19 | G22 tail recursion modulo cons: `cons(x, self(rest))` fills holes in a loop, so ledger runs 50,000 lines on the default stack | #200 |
| C3 | GAPS round 3: ledger, 32 definitions built in the editor by clicks; compiled 2 to 4× the ideal; G22 (stack), G23, G24 and eight editor frictions | #197 |
| C2 | G21 parts 1 and 2: lists walked whole, and accumulators, stay arrays (chapters about 3.4× → 1.9× the ideal) | #182, #188 |
| C1 | G16 fusion: steps over a list run as one loop (chapters 550 → 200 ms) | #176 |

### L: Language and library

| id | item | PR |
|---|---|---|
| L15 | Static output: `lab run` on a page prints it once as an HTML document (every text, part and attribute drawn, handlers left out); `<style>` and `<script>` text unescaped | this PR |
| L27 | `Log` in a page's views and handlers: both rows allow it, a line goes to the browser console (a view's each time it runs), evaluator and compiled the same | #232 |
| L14 | One generic bind: the prelude's `inverse(f, y)` runs any function value backwards (a solve over `applied(f, x) = f(x)`). The converter's fields read back with `inverse(view, typed)` and its ten `from X` definitions are gone (646 nodes to 559). Found and closed a hole: a function given to a solve as a port lost its effects; they now reach the row around. A closed function in a variable opens at each use (Koka's `open`), so a field's `view` can be both shown and inverted. Compiled pages mark builtins used as values, so `inverse(show, …)` runs compiled too | #229 |
| L28 | The html module: each tag a function of its children, attributes by wrapping (`styled`, `classed`, `named`, `with`), `button`, `words`, a style sheet as a list of rules. The dice and converter pages rewritten with it (dice 475 nodes to 382; the converter's style sheet is its own definition) | #209 |
| L13 | Keyed lists in pages: `each(items, f)` in cells (Solid's `mapArray`) and the html module's `for each(items, row, inside)`, which keeps an item's row, cells and all, when the list changes; evaluator and compiled pages the same | #222 |
| L25 | Container matrix, the other places: a solve's body, a function run backwards, a shader (with and without a literal with fuel), a representation's job, a module's pinned export and one whose pin leaves an effect out. One hole found and closed: a job that did an effect its definition doesn't was only caught when the rewritten program happened not to check; `jobProblem` refuses it before the rewrite (`lab` asks it) | #219 |
| L26 | The effect ledger in code: every place an effect leaves a row calls `discharge(where, effects, why)` (`src/lang/ledger.ts`); LANGUAGE.md's "Where effects go" table is generated from the calls, and a test checks each builtin's type drops exactly its row | #216 |
| L11d | A `solve` whose mode gives exactly one answer and ends has no `Choice`: the checker, run.ts (no choice point) and the compiler (a plain call) agree. A one-case constructor taken apart always matches | #213 |
| L11c | `relate.ts` follows the schedule: each function in each mode runs its goals in the order modes.ts planned. The ordering rules (`cheap`, `computable`, `waitsOnly`, `hence` reversed, match and fold and solve orders) are gone; goals a stuck direction never reaches wait for what they need | #205 |
| L11b | Types from modes: a relational `solve` is `Diverge` only when its mode may not end (says why), and a direction nothing pins down is an error at the `solve`; `mayLoop` removed | #198 |
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
