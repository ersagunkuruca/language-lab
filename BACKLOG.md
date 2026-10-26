# Backlog

Every open item from every source, in one place. How it's used, the lanes and
the priority criteria are in [WORKFLOW.md](WORKFLOW.md). Each lane's list is in
priority order: a lane takes its top item that isn't running.

First gathered 2026-10-23 from projectional/ROADMAP.md, NOTES.md, WEB.md,
NUMBERS.md, COMPILER.md, REVIEW.md, REVIEW-2026-10-22b.md (R2), QA-2026-10-22.md,
QA-2026-10-23.md (QA2), QA-2026-10-23b.md (QA3), QA-2026-10-24.md (QA4), QA-2026-10-24b.md (QA5), compiler/GAPS.md, the editor and compiler threads'
queues, and Ersagun's messages in the project chat.

**Status:** ▶ running (don't disturb) · ⏸ parked · blank = waiting.
**Size:** S hours · M one PR · L several PRs or a design note first.

## Inbox

New items land here until the next triage gives them a lane and a priority.

| id | item | source | added |
|---|---|---|---|

## E: Editor

Thread "Writing programs in the editor". Current step (coordinator 2026-10-24 08:28): the language review's drawing-only rows, moved here from L; the next QA pass's findings come before them.

| id | item | source | pri | size | status |
|---|---|---|---|---|---|
| E127 | Run backwards shows nothing until the whole search ends: show the first answer as soon as it's found and keep looking for others after (`fibFast(n) = 8` waits 26 s for an answer found in 11 steps) | BACKWARDS.md "A worked example: Fibonacci" (Learn thread, 2026-10-26) | P2 | S | |
| E128 | A function written in place is offered only at a hole of function type; at a new value (`Add a value before this`, type `a`) there's no "new function", so a local helper can't be started. Offer it where the type is open | BACKWARDS.md "A worked example: Fibonacci" (Learn thread, 2026-10-26) | P3 | S | |
| E125 | The graph's palette pop-up covers neighbouring nodes and repeats the side panel's palette; was Inbox I16 | QA-2026-10-26 L3 | P3 | S |  |
| E126 | Refusals for units don't mention units (Change the function on `speed · time` → `subtract`: "Nothing that fits matches"); was Inbox I17 | QA-2026-10-26 L4 | P3 | S |  |
| E111 | Group a selection into one box: a view-only fold of picked nodes, like a frame's fold | Ersagun 2026-10-24 18:33 (editor-findings 16–26) | P2 | M | feature, waits for resume |
| E114 | Taking out an `append` and flattening its lists by hand should be short (follows from E104 and E108; E98 does it for you) | Ersagun 2026-10-24 18:33 (editor-findings 16–26) | P3 | S |  |
| E103 | **Bug.** In a definition that something runs backwards (physics `fall`), adding a value takes about 4 s: each of ~450 candidates changes the solve's plan differently (the plan names the call it is stuck on), so each is checked against the whole program. Elsewhere (dice `main`) it is 0.3 s. Needs a cheaper "does this plan change matter" test | found doing E100 | P3 | M | |
| E98 | Meaning-keeping simplifications offered as a menu suggestion when they apply, one undoable edit: first `append([a, b], [c])` → `[a, b, c]` and `cons(x, [a])` → `[x, a]` within a definition | Ersagun 2026-10-24 11:11 | P3 | M | later |
| E80 | Operations answered later in the editor: declare one (`returns T, later`, toplevel.ts beside the returns toggle) and draw a handler case's rest binder as `yield(item) with rest`, the way the text does (ANSWERED-LATER.md, L54a) | ANSWERED-LATER.md | P2 | S | ready: L54a done (#396) |
| E77 | A fraction prints as `ratio(1, 2)` in show and Run; read as 1/2 (language `show`: Language lane may take it) | QA-2026-10-24b L1 | P3 | S | moved to L74 (Language lane) |
| E78 | Steps and Nested views of an action-heavy `main` read as `t1 = …` temporaries and `(_₁) => …` chains | QA-2026-10-24b L9 | P4 | M | |
| E61 | Nested patterns as a view over nested matches (ledger's `parse`, the `main`s); design note first; drawing only, in the text and the graph | L37, LANGUAGE-REVIEW-2026-10-24 §4 | P2 | L | design note projectional/PATTERNS.md (#370); step 1 text rows (#372); step 2 shared bodies as otherwise (#373); step 3 graph rows next |
| E62 | A fold with an accumulator drawn as `fold … from x` over the function-folding tree (queens' `safe`); drawing only, in the text and the graph | L48, LANGUAGE-REVIEW-2026-10-24 §7 | P3 | M | |

## C: Compiler and targets

Thread "Bigger programs and compiler gaps". Current step: the items below in order. New targets and speed rank below every language item (Ersagun, 2026-10-24 07:01): the language comes first, and this lane helps L38's compiled side (generic code: copies or dictionaries) when asked.

| id | item | source | pri | size | status |
|---|---|---|---|---|---|
| C48 | C47's follow-ups: switch to `LIBRARY.reps` (Language lane, with a Set tree and `byType` equal, show and compare) when it is published, which also gives Set its tree; let a map inside another value (a list of maps, main's answer) take the tree by giving equal, show and compare the meaning at every depth | C47 | P3 | S | waits on LIBRARY.reps |
| C30 | Round 4, P4: lists as arrays, OPEN after P4a (#330, pedal at 2.9×; compiler/GAPS.md P4). Measured by hand: (d) the block coming in as an array (a view in the Choice path's split) buys about 8%. (b) the split and (c) the join writing into arrays only pay together, and with (d) they come to about 25%, so about 2.2×. Fusion on top: about 5% more (2.1×). Stopped here by the 10% rule; worth doing as one stage, (b) to (d) together, when lists as arrays is next for another program | compiler/GAPS.md round 4 | P2 | L | |
| C31 | Round 4, P5: a recursion that gives back a Pair (the compressor's samples and level) returns the two fields without the record. Measured by hand on the compiled pedal: 3%, so it waits for C30, where the compressor's list goes into an array anyway | compiler/GAPS.md round 4 | P3 | M | |
| C25 | Audio: a sound is a function on blocks of samples with its state in cells, played by a page's `listen` attribute in an AudioWorklet, rendered offline by `lab render`. Design: projectional/AUDIO.md. Stages A1 (blocks offline, the pedal in a file), A2 (live in a page: microphone, file, knobs), A3 (compressor, crossover), A4 (editor Run panel, with lane E), A5 (measure). First program: the conjugation pedal (drive in tanh space, on one band of a Haar split) | coordinator 2026-10-24 03:36, NOTES.md conjugation | P2 | L | ▶ A1 to A5 done (the pedal plays live at apps/pedal.html, 39× real time compiled; A4: the editor's preview plays it, lane E) |
| C40 | **Proposal**: compiled JS for L54/L71: definitions that perform an answered-later operation get suspendable copies (C21's generators); the world's `await(any of …)` as a promise | LANGUAGE-NEEDS-2026-10-24 | P2 | M | after L71 |
| C41 | **Proposal**: pure `together` branches on worker_threads / Web Workers past a cost threshold | LANGUAGE-NEEDS-2026-10-24 | P3 | M | after L62 |
| C42 | **Proposal**: data-parallel `map` and associative folds over arrays on a thread pool, later as compute shaders (NESL, Futhark prior art); associativity from L38's algebra laws | LANGUAGE-NEEDS-2026-10-24 | P3 | L | after C30, L38 |
| C43 | **Proposal**: or-parallel `all`/`count` and speculative `first` kept in canonical order, with work stealing (Cilk, Aurora/Muse prior art) | LANGUAGE-NEEDS-2026-10-24 | P3 | L | after C41 |
| C44 | **Proposal**: fibers in native C (own stacks, an event loop; thread-shared cells get atomic counts, as Koka) and in WASM (JSPI) | LANGUAGE-NEEDS-2026-10-24 | P3 | L | after C40 |
| C45 | **Proposal**: a persistent vector (RRB trees, Bagwell and Rompf) as a representation of `List` for indexed updates | LANGUAGE-NEEDS-2026-10-24 | P3 | M | after C30 |

## L: Language and library

Thread "Language and library lane". Order (Ersagun, 2026-10-24 07:01): L38, one `+` for every number system, and the number types (fractions, complex, Clifford, matrices, tensors) first, then the rest of LANGUAGE-REVIEW-2026-10-24. Anything that only adds a target ranks below all of these.

| id | item | source | pri | size | status |
|---|---|---|---|---|---|
| L82 | **Bug.** Backwards, an arm's checks don't cut the branch before its calls run: `fib(n) = 5` tries `n = 2` in the arm where `n` isn't 1 or 2 and starts `fib(0)`, which recurses forever (fairness keeps the search alive; every non-Fibonacci input ends in a stack overflow) | BACKWARDS.md "A worked example: Fibonacci" (Learn thread, 2026-10-26) | P2 | M | |
| L83 | Backwards search past the first answer piles up: `fib3(1, 1, n) = 8` keeps unfolding with `a` past 8 and one more waiting equation per level (1,398 at depth 1,400), each step re-reading all of them: about 26 s to a stack overflow in the editor. Stop when a known input only grows while the result is fixed (size-change on values), and don't re-read every equation each step | BACKWARDS.md "A worked example: Fibonacci" (Learn thread, 2026-10-26) | P2 | M | |
| L86 | **What `Number` means** (Ersagun 2026-10-26, after L85): design note projectional/WHAT-NUMBER-MEANS.md recommends `Number` as the family (the `arith` constraint, "a is a Number") with a plain literal typed as some Number (Haskell `fromInteger`/defaulting), whole literals defaulting to Int; build after Ersagun reads the note | Ersagun 2026-10-26 | P1 | M | proposal |
| L87 | **Currying only when asked** (Ersagun 2026-10-26: "underlying representation should be non curried. Non curried is easier to reason about, easier to shuffle the order and simplify, extends to variadic functions more seamlessly"). Today the core is already uncurried: a lambda has a list of params and a call a list of args on every target and backwards (model.ts); what's left is an explicit `curry`/partial-application operation for when it's wanted | Ersagun 2026-10-26 | P3 | S | |
| L38 | **Numbers first** (Ersagun 2026-10-24: numbers ahead of everything else in this lane). One `+ − · −x <` for every number type, decided by Ersagun; design and steps in projectional/NUMBERS.md "One `+` for every number system". **Step 1 done in #348**: generic builtins `builtin.arith.*` (std.ts ARITH), the `arith`/`ordered` constraint (types.ts requireArith, in schemes and pins), and `src/lang/arith.ts` resolveArithmetic (each call to its type's own builtin, copies per type, Number by default), called by makeRunner, relate's interpreter, compile() and lowerScalar(); tests in test/arith.test.ts; not offered by the palette yet. **Step 2, language side, done in this PR:** a type prints what its number variables may be (`(a) -> a where a is a number type`; types.ts showType's `arith` argument, schemeArith for pins) in the editor, the text view and pin notes, and derive.ts differentiates the generic ops as Number's. Open: a generic op that resolves to Int and is run backwards is planned as Number's, and the `int.*` ops aren't in equations.ts NUMERIC (found by lane E in #350). **Step 3 done in this PR:** the vectors module is written with the one `+ −` (`plus`, `minus`, `times` are now only those under their old names, kept for a release); raymarch uses `+` and `−` on points; arith.ts copies pinned module definitions too, derive.ts takes a generic op on records part by part, and Float32 resolves the generic ops before rounding. **Step 4 done in this PR:** `examples/generic`, one polynomial (Horner's rule, no literal) at Int, Number and fractions, with a `walk` loop for lane C to measure on each target; compiled JS agrees with the evaluator. **Next:** L40 Complex. (Earlier plan: step 2, the palette offers the generic ops instead of the per-type ones and types print the constraint (needs lane E for the editor side; derive.ts should treat `builtin.arith.*` like Number's for the editor's generated derivatives); step 3, the vectors module written with `+ − ·`; step 4, an example with one generic definition at Int and Number for lane C to measure (lane C asked for this) | LANGUAGE-REVIEW-2026-10-24 Part 2 | P1 | L | steps 1-4 done (language side) |
| L39 | Rational: **L39a done in this PR** (`std.rational`, `lowest terms` builtin, prelude fraction arithmetic that the generic `+ − · −x <` resolves to, `fraction` and `divide fractions` with no answer at zero, test/rational.test.ts). **L39b:** relate.ts's linear step generic over the field, so fractions run backwards exactly; `lowest terms` records in WASM, C and WGSL (with lane C) | LANGUAGE-REVIEW-2026-10-24 Part 2, NUMBERS.md stage 1 | P1 | M | L39a done; L39b open |
| L40b | **Proposal**: `algebra(table)` for monomial multiplication tables (Complex, dual numbers, quaternions each one table), and a Mandelbrot or domain-colouring shader on Complex (`vec2f`, works since L40) | LANGUAGE-REVIEW-2026-10-24 Part 2 | P1 | M | proposal; Complex itself done (L40) |
| L61 | **Data structures** (Ersagun 2026-10-24 07:50: "we need better data structures; list being an array underneath is a good start but we need more"). Arrays, maps, sets and persistent structures as *representations* in the NUMBERS.md sense: a meaning (List, a finite map, a set as ordinary data) plus a representation (array, HAMT, balanced tree, RRB vector) with its jobs and costs, chosen per value, with no new node kinds; the editor shows the meaning. Builds on C30 (lists as arrays); L65 (`Map k v`, `Set k`) is its first piece. Wait for the design thread "Plan concurrency and what a good language needs" before building; if complex numbers finish first, start the design doc here and coordinate | Ersagun 2026-10-24 07:50, coordinator | P1 | L | after L40 |
| L44 | **Proposal**: small matrices `Mat2` to `Mat4` as the matrix-unit table, `mat4x4f` on the GPU | LANGUAGE-REVIEW-2026-10-24 Part 2 | P1 | M | proposal |
| L42 | **Proposal**: `Cl(p, q, r)` from the signature; dual, split-complex and `Cl(3, 0)` named; a PGA (`Cl(3, 0, 1)`) motor in the ray marcher | LANGUAGE-REVIEW-2026-10-24 Part 2, NUMBERS.md stage 4 | P1 | M | proposal |
| L43 | **Proposal**: grade inference on the units machinery; quaternions as the rotor representation of `Cl(3, 0)` | NUMBERS.md stage 4 | P1 | L | proposal |
| L45 | **Proposal**: dual numbers and jets as a second `derivative`, tested against derive.ts | NUMBERS.md stage 8 | P1 | M | proposal |
| L41 | **Proposal**: table products expanded at compile time, zero terms dropped (with lane C, like C9's gradient expansion) | LANGUAGE-REVIEW-2026-10-24 Part 2 | P1 | M | proposal |
| L51 | Tensors: NUMBERS.md stage 6, as the general algebra after lists as arrays (C30) | LANGUAGE-REVIEW-2026-10-24 Plan 17, NUMBERS.md stage 6 | P1 | L | after L38, and C30 for arrays |
| L54 | Operations answered later, at most once: design in projectional/ANSWERED-LATER.md (a `later` flag on the operation's variant, the rest as one more binder in the case's arm typed `(T) -[ε]-> R`, one-shot checked at run time, declared so rows say what may suspend). Step 1 done (L54a, #396); next C40, L56 | EFFECTS-REVIEW-2026-10-24 §1.5, §5 | P1 | L | design written, step 1 done |
| L55 | **Proposal**: Console, Files and Network declared in std like Random, answered by the world when nothing handles them; "world" a flag on the declaration. Only Choice and Diverge stay built in | EFFECTS-REVIEW-2026-10-24 §2.2 | P1 | M | after L53 |
| L56 | **Proposal**: effects take type parameters (`Yield a`, `Channel a`, `State s`); rows hold applied effects | EFFECTS-REVIEW-2026-10-24 §2.3 | P1 | M | |
| L59 | **Proposal**: after L54, a page's fetch and wait resume instead of re-running the handler; `Wait` folds into `Time`; the fetch memo scoped to a search, so a page can fetch again | EFFECTS-REVIEW-2026-10-24 §1.1-1.3 | P1 | M | after L54 |
| L60 | **Proposal**: after L54, the audio worklet's run of `main` replays the page's random numbers and clock under a handler, so `main`'s row no longer depends on the page having sound | EFFECTS-REVIEW-2026-10-24 §1.4 | P2 | M | after L54 |
| L57 | **Proposal**: a handler's case for the normal finish (`\| done(x) → some(x)`), so a handler can change the result's type | EFFECTS-REVIEW-2026-10-24 §2.5 | P2 | S | |
| L58 | **Proposal**: named rows for the hosts in std (`View`, `Handler`, `Main`, `Sound`), used by `Html` and `Attribute` by name; the ledger lists them | EFFECTS-REVIEW-2026-10-24 §2.6 | P2 | M | |
| L46 | **Proposal**: bounded counting is total (an Int moving towards the bound it is compared against), so raymarch loses `with fuel` | LANGUAGE-REVIEW-2026-10-24 §7 | P2 | M | proposal |
| L47 | **Proposal**: `conjugate` and `inverse` without `Choice` when the mode says one answer (with L29), so `first(() => conjugate(…)(x), () => x)` goes | LANGUAGE-REVIEW-2026-10-24 §7 | P2 | M | proposal |
| L29 | Function variables' rows checked in any order: a use that fixes a variable's row wider before the use that closes it (a page field's `view` handed to `inverse` before it's shown) still clashes; the closing use should win, as it does in the other order. And the checker typing `inverse(f, …)` from f at the call, as the modes already do, instead of Diverge | L14 | P3 | M | |
| L11 | Mode analysis through cases and folds (the general fix for backwards search order). Design: projectional/MODES.md. Next: lane E shows the mode on the `solve` node | R2 §3, ROADMAP step 4 open | P2 | L | ▶ L11a to L11e done |
| L12 | Tutorial and its screenshots brought up to the current editor | ROADMAP 2 | P2 | M | after the editor step |
| L16 | Guarded corecursion, and a stateful handler form so programs write their own Cells | ROADMAP 4 open | P3 | L | |
| L17 | Data-type upgrades and path namespaces for modules | ROADMAP 5 open | P3 | L | |
| L18 | Relational reads past about 1,300 items; a stackless `relate.ts` | ROADMAP 1-5 open, real-sized data | P3 | M | show numbers reads back 3,000 numbers since L11c (each level of a fold run backwards starts on a fresh stack); plain recursion still uses the stack |
| L19 | Numbers stage 1: Int as data (match/fold view), Rational; stage 2: overloading by name | NUMBERS.md | P3 | L | Rational and stage 2 proposed again as L39 and L38 (LANGUAGE-REVIEW-2026-10-24) |
| L20 | `set` with general functions through relations | real-sized data follow-up | P3 | M | |
| L21 | Folds: a `build` row for user producers, user representations per value, folds with `Choice` asking the table | ROADMAP 5 open | P3 | L | |
| L22 | Profiles inferred like effects and shown in the editor ("runs on the GPU"), instead of a second checker in the compiler | R2 §5, REVIEW.md §5.2 | P3 | L | |
| L24 | Research as it becomes blocking: costs from folds, laws proved by fusion, fast invertible parsing, exact reals, Clifford algebras | ROADMAP 8 | P3 | L | |
| L71 | **Proposal**: L54's design note written with this one, then `together(actions)`, `race`, `within(ms, a)` as prelude handlers over `await` (std's waiting ops as start + await, `Ticket a`): answers in order, an Abort stops the siblings, cancellation is a dropped one-shot rest | LANGUAGE-NEEDS-2026-10-24 Part 1 | P2 | L | after L54, L56 |
| L63 | **Proposal**: deterministic schedules: under `seeded` the scheduler's choices are seeded; a match answering `await` gives virtual time and a fake network, so an interleaving bug is a seed in a test (FoundationDB prior art) | LANGUAGE-NEEDS-2026-10-24 Part 1 | P2 | M | after L71, L55 |
| L62 | **Proposal**: branches with no world effects, no Update and no waits marked pure by a row constraint and shown in the editor, so the runtime may run them on another core | LANGUAGE-NEEDS-2026-10-24 Part 1 | P3 | S | after L71, L53 |
| L69 | **Proposal**: foreign definitions: a typed declaration with its row (trusted) and a body per target, on L7's builtin records (Gleam's `@external`, Elm's ports as influences); for browser and device APIs | LANGUAGE-NEEDS-2026-10-24 §5 | P2 | M | proposal |
| L70 | **Proposal**: design note: grammars written once as printers and parsed by running them backwards; calc's parser first. Also number formatting, interpolation as a view, `graphemes` | LANGUAGE-NEEDS-2026-10-24 §8 | P3 | M | proposal |
| L72 | Grammars and their machines as language tools, beyond regex (Ersagun 2026-10-24 08:02: "why are there no built in tools for other stuff like context free languages and their duals, the machines"). Regular, context-free and above (the Chomsky hierarchy) as ordinary data; the machines (finite automata, pushdown automata) derived from them; parsing and printing one relation run both ways. Extends L70 (grammars written as printers, parsed by running them backwards). Prior art to credit when designed: parser combinators, Brzozowski derivatives, invertible syntax descriptions (Rendel and Ostermann 2010), Ohm and PEGs | Ersagun 2026-10-24 08:02 | P3 | L | proposal; low priority |
| L64 | **Proposal**: scoped channels (`Channel a`, `send`, `receive` that wait), when a program needs a pipeline | LANGUAGE-NEEDS-2026-10-24 Part 1 | P3 | M | proposal |
| L68 | **Proposal**: sharing modules between projects by hash, with a browser of what's published (Unison prior art) | LANGUAGE-NEEDS-2026-10-24 §10 | P3 | L | proposal |
| T7 | Tests in the language: accepted answers next to examples.json inputs, laws as definitions with a `Check` effect, results cached by definition hash and re-checked on save (Unison prior art). Design note first | projectional/TESTING.md T7 | P2 | L | |

## Testing and fast feedback

Thread "Testing strategy and fast feedback", which owns `.github/workflows`
since 2026-10-23. Plan and measurements: projectional/TESTING.md. T1-T3,
T4 to T6 are done; T7 is in lane L.

| id | item | source | pri | size | status |
|---|---|---|---|---|---|

## Coordinator and process

Not lane work; the coordinator does these or asks Ersagun.

| id | item | source | pri | status |
|---|---|---|---|---|
| P1 | PRs #43 and #44 open since 2026-10-22 morning, likely superseded by #49: close or land | R2 §8 | P2 | |
| P2 | Batch deploys (deploy is its own workflow) if Actions cost needs it | Ersagun 2026-10-23 08:26 | P3 | asked, not requested |
| P3 | A per-repo Actions budget, or a public repo for free Actions | thread "GitHub Actions cost" | P3 | Ersagun's call |
| P4 | **Proposal** (LANGUAGE-REVIEW-2026-10-24): bigger-program rounds also record language gaps (where a program declares a type, defines a helper or wraps a call only because the language lacks something), and WORKFLOW.md ranks "a gap two examples write around" as P2 | LANGUAGE-REVIEW-2026-10-24 | P2 | proposal |

## Done

Recent first, one table per lane so that lanes finishing items at the
same time don't edit the same lines. Older history is in git and in the
roadmap's Done table; this section keeps about a week.

### E: Editor

| id | item | PR |
|---|---|---|
| E124 | Loose parts read as loose: and the expression they are (loose: length / gravity), not as a function _1(…); the frame reads loose : Number | #452 |
| E123 | A search that finds nothing in a hole that takes no effects says why: a loose part is a value, and a value can't print or roll | #450 |
| E122 | A loose literal (or lone name) has an output on its pill, so it can be dragged onto an input like any node | #448 |
| E121 | On a phone, + New program shows the palette for its hole, and tapping a hole already selected brings it too | #447 |
| E120 | A loose part wires back in by its own last node's output, as the status says, not only by its frame's end; the drag also checks the fit as it goes | #445 |
| E110 | A wire goes round a frame it doesn't start or end in, as round a node, however tall the frame | #439 |
| E113 | Already so since E92: a call picked in the graph offers Open (its function) and Change the function; now tested in the graph too | #438 |
| E112 | Let and get nodes for every value at once: Show every value as let and get nodes (and back) on the canvas's menu, and a Guide line | #438 |
| E109 | A dot clicked onto a wire sits where you clicked, and nothing else moves (its let used to reshuffle the whole graph) | #437 |
| E119 | Pitfall 11 says what's refused now: wiring that doesn't fit, never leaving the tree unfinished (with E118) | #436 |
| E118 | A value added on the graph's canvas is a loose part where you clicked; loose parts are drawn faded and dashed (pitfall 11 rewritten with it, E119) | #436 |
| E115 | An empty input of a call or a list is drawn as a hollow port, not a □ node: its type on hover, a click for the palette, a drop target | #435 |
| E117 | Dropping a value on an input that has one swaps it in; the old value lies loose (a lone variable is just replaced) | #434 |
| E116 | Loose parts: Delete and unwiring leave what fed the node loose, kept in drafts.json and shown at the end of Blocks and in the graph, wired back in by a drag (E117's Delete and unwire with it) | #433 |
| E104 | Delete takes out one node; what fed it is kept, loose (with E116/E117) | #433 |
| E108 | Dropping a value on a list's + adds it as a new item | #432 |
| E107 | A folded frame is selected, outlined and dragged like a node | #431 |
| E106 | Tidy everything lays it all out afresh, the same every time, and a fresh graph is drawn that way | #430 |
| E105 | Choosing a part keeps the text and panels where they were scrolled | #429 |
| E73 | Phone held upright: the top bar fits, links behind More | #427 |
| E74 | The map starts hidden where it would cover nodes | #426 |
| E76 | The status bar says what was typed or set in a page's field | #425 |
| E75 | Opening a program shows its open definition in the navigator | #424 |
| E72 | No longer reproduces (one subtract row); smoke checks it | #423 |
| E71 | The palette says a generic function's a is a number type | #423 |
| E102 | Blocks pane: a long press opens the part's menu | #422 |
| E101 | Graph: drop an input on another of its list or chain to move it there | #421 |
| E100 | Right-click on the blocks' empty space adds a value | #420 |
| E97 | Graph and Blocks parity audit (NODE-EDITOR.md); gaps filed as E100-E102 | #419 |
| E91 | A list's items and a + b + c's inputs: add, move, take out, in both views; + on graph nodes | #418 |
| E90 | Duplicate a definition: a copy to change, next to it | #417 |
| E88 | Menu items say what they do, and a greyed one says why | #416 |
| E87 | Programs with no units keep the unit chooser folded away | #415 |
| E86 | Replace with… on a selected part opens the palette in its place | #414 |
| E95 | Holes show their type without repeating the where clause | #413 |
| E93 | A Text port in Run reads what's typed as text, quotes or not | #412 |
| E92 | In the blocks a function's name picks its whole call; a call's panel has Change the function | #411 |
| E89 | A call with no inputs reads where a value is typed: die() + 1 | #410 |
| E84 | Inside a held or pinned definition its parts take the pin's types: a cleared input stays the Number it was | #409 |
| E94 | Page calls hover as their own type, not with the page's row (with E85) | #408 |
| E85 | A definition's name hovers as its own type; types it's used at follow without the caller's effects | #408 |
| E83 | The Selected panel heads a part with what it is; its id only on hover | #407 |
| E96 | The top bar's Learn opens GUIDE.md as a page (guide.html), which links on to the tutorial | #406 |
| E99 | The Guide tab says how the editor works today: two views, selecting, holes and the palette, copy and paste, held types, Run, today's effects | #405 |
| E82 | A hole in a held definition says its type is kept, with Let it loosen beside the palette; a refusal of a held type says what the fill would add and the ways out | #404 |
| E81 | The palette offers only fills that keep a held or pinned definition's type (die() no longer offered at a seed hole without Random) | #403 |
| E70 | Run offers no Run for an action that may give no answer or several (Choice) and says to call it inside first/all/count/optional; Show values says first answer | #400 |
| E79 | Maps and sets written out read as tables in the blocks; Run's Gives shows a map or set as a table | #397 |
| E69 | A typed 1/2 where a fraction goes is one half; each whole number takes the type its place expects | #395 |
| E68 | Create a definition: 3.8 s → 0.85 s; a filling's recheck checks units only in the definitions it can affect | #392 |
| E67 | The palette reads calls of several-word names: as fraction(3), ‹as fraction›(3) | #390 |
| E66 | The palette reads < ≤ > ≥ = ++ and -x, from the notation itself | #388 |
| E65 | Blocks pane: right-click opens the part's menu, clicking an operator selects its call | #387 |
| E63 | The Blocks pane draws what the blocks text prints: one printer, render.ts blocksOf | #384 |
| E64 | One pane at a time, a hole's palette and the New definition form switch to the side pane | #380 |
| E60 | An action handed to a handler is drawn by name, first(queens(8), else nil); its graph frame is titled action (was L36) | #368 |
| E59 | A value of a one-case type taken apart is drawn as a let of its fields, found(expr, value) = results(front), in the text and the graph (was L35) | #367 |
| E58 | A field read is drawn as p.x in the text and .x in the graph (was L34) | #366 |
| E55 | The palette reads a typed call, sqrt(x + 1), as one fill; a shared name is tried as each of its meanings | #365 |
| E53 | Landscape phone: graph 208 to 234 px (one-line status, slimmer panes); tablet top bar fits (names and notation cycle) | #364 |
| E56 | The status bar says what was done on a page (clicks on it, Stop sound, Restart) | #362 |
| E57 | The dice page before any roll says Rolls: 0 | #361 |
| E54 | Change the function is one step to undo | #357 |
| E52 | A page has a base look (page.ts PAGE_BASE, in :where) in the editor and saved; the frame grows with the page | #356 |
| E51 | The map can be put away: Map button beside Fit, off by default on a phone, at most a fifth of the pane | #353 |
| E50 | A page's main says it is the page above; no Run main printing its Html | #351 |
| E49 | The palette offers the one generic + − · −x < (typed arithmetic too); units and backwards solving read it | #350 |
| L50 | Blocks text: a step nothing reads is just the step; an unnamed binder is named for its type | #344 |
| L49 | Blocks text: a match as an if condition shows its arms; a branch's steps sit after then/else | #342 |
| E48 | Steps done for their effects start at the left edge, so a big main (Numbers & physics) opens with its first steps in view; was Inbox I2 (QA3 L4) | #300 |
| E47 | Pages keep running across program switches; dice says Rolls: 1; ray marcher constructor is rgb (no colour₁). L4 lopsided first view is the layout's shape: Inbox I2 | #298 |
| E46 | CPU picture: still or paused (click) pictures redraw sharp at canvas size; one-line status | #296 |
| E45 | Folded box names its calls; unfolding moves contents to the nearest clear place (tidy keeps a folded frame's space on purpose) | #295 |
| E44 | Run main in a worker with Stop; Countdown's run keeps frames under 60 ms | #294 |
| E43 | Palette arithmetic reads names in scope: x * 2 in double(x) | #292 |
| E42 | Undo first in the phone top bar; hints say tap and long-press on touch | #291 |
| E41 | Pinch to zoom in the graph: two fingers zoom about their middle and pan with it; the one-finger pan and the long press step aside for the second finger | #290 |
| E40 | One pane at a time below 900 px wide or 500 px high (phones either way up, tablets); the stacked layout is gone; the smoke checks 844x390 and 768x1024 | #288 |
| E39 | Keyboard: Enter in a literal's or name's field saves and returns to the program; Enter on a call opens its menu on Change the function; Shift+F10 / Menu key opens the menu, arrows move, Escape returns | #287 |
| E38 | By touch, Pick keeps every picked node: the tap ending a long press landed on the graph redrawn for the menu as a click; when a touch last opened a menu now outlives one drawing | #285 |
| E37 | The minimap copies the graph (classes kept, ids and data-* dropped) instead of drawing it through <use>, whose copy rules like .tgraph .rg don't reach: frames were black | #283 |
| E36 | Touch: a long press opens the graph's menu (iOS has no right-click), the menu's Pick stands in for shift-click, and a picked dot drags to move as alt-drag does | #278 |
| E20 | Phone width: under 600 px one pane at a time (Programs, Graph, Text, Run) from a bar at the bottom, instead of a 4,614 px page; the smoke checks it at 390x844 | #277 |
| E35 | Frames fold into one box (▾, or right-click): wires in end on its left, values out leave on its right; it sits where its contents put the frame, so dragging or tidying it moves them. A view in layout.json | #275 |
| T4 | A quicker smoke: each program's first definition, main and an eighth of the rest per change (all nightly), and graph clicks only where a click reaches (402 half-second timeouts a run were frames under their contents): 5 min 40 s to 1 min 22 s | #274 |
| I1 | Without a GPU the ray marcher's colour record runs as WebAssembly (WasmGC struct, read by the module's field readers), not JavaScript: 244 to 144 ms a frame at 160x160 | #272 |
| E19 | A map in the graph's corner while part of it is out of view (the 'there's more' cue); click or drag to look there. Collapsible frames split to E35 | #270 |
| E18 | Wires bend over or under nodes in their way when a short detour crosses no more wires: tunnels 333 to 136, bridges 410 to 438 | #263 |
| E17 | Tidy reorders columns to cut crossings (Sugiyama barycenter + swaps) and stops pushing nodes across wires: examples 410 to 375 crossings after tidy (was 522) | #256 |
| E21 | Int literals in the palette ("an integer"): already there since 79f95d0; closed on review | none |
| E16 | Copy into my program and Pin this type: already in the Definition tab since 0ca7b27 (Oct 22); closed on review | none |
| E34 | Programs have a comment like definitions; each example's credits became that comment, credits.json is gone (Ersagun 19:34) | #253 |
| E15 | Tab and Shift+Tab step through a program's parts in reading order; Enter edits the selected one | #251 |
| E33 | Bug: a list of tall items showed as cons(…) in the blocks (Ersagun 19:16) | #248 |
| E14 | Palette: most-used first, √ finds sqrt, typed arithmetic fills as calls | #247 |
| E32 | Picture CPU fallback and its GPU check run in Float32 | #245 |
| E31 | Same-label palette rows name their holes' types: show(□: Int) | #244 |
| E30 | Add a value before this… puts a step anywhere, inside one arm of a match | #242 |
| E29 | A short text literal gets a new line with Shift+Enter | #241 |
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
| C7 W4c | Abort in WebAssembly: status 2 with the reason in a global (the host reads it with `Abort.reason`); a match on Abort is a block that takes status 2, puts the fuel back as the evaluator does and gives its arm; first, optional, all, count and budgets let it go on out. Everything in wc, ledger, chapters and calc but their Console and Files parts compiles: calc's tokens, parser and evaluate, and ledger's entries and report (a 2000-entry book) give the evaluator's answers and reasons | #284 |
| C7 W3b-1 | The world in WebAssembly through a JavaScript host: Console and Files as imports from `world` (one that fails gives status 2 and then `world.reason`, an Abort where it was called); `runMain` runs a main as `runProgram` does. wc, ledger, chapters and calc run whole, main included, and print, write files and exit as the evaluator does | #286 |
| C7 W3c | mod and the show of a Number written in WebAssembly: mod from musl's fmod (adapted, credited), exact against JavaScript on edge values; show writes tiny numbers (1.5e-7) itself, and fixes wholes past 2⁵³ (they had wrong digits). Countdown runs as a WASI command with no JavaScript at all (imports only fd_write and proc_exit). Left for a JS-free host: sin and the other Math functions (refused with a reason), and a show needing 15 or more digits (traps) | #297 |
| C30 P4a | Round 4, P4a: destination passing for plain definitions. A definition that builds its list front to back gets an `$into` copy that pushes onto an array it is handed: tail calls hand it on, a call of itself is a jump. A two-field record with a list (the compressor's samples and level) is written the same way and returns the other field. A block function has a version the audio runtimes call through `$arrayOf`. The compressor is now a loop with the level in a local, and the pedal went from 3.5× to 2.9× the hand-written one. test/into.test.ts covers 200,000 items with no stack. gaps/bench-audio.ts takes the best of five runs | #330 |
| C32 | Round 4, P6: the drive's leftovers. `first` of one answer given back from a definition runs its statements in place (no closure); a let among a search's parts is statements; a one-answer solve with one bind gives the value itself (no one-item array). drive is now four lines. The pedal from 3.6× to 3.5× | #329 |
| C29 | Round 4, P3: a mode function written out tries each arm in a labelled block it leaves when it fails (no closure per arm), tests a case with no fields by its tag (not `$eq`), drops an arm whose plan only fails, and returns its one output itself (not in a one-item array). The pedal from 4.6× to 3.6× the hand-written one | #328 |
| C28 | Round 4, P2: a solve with at most one answer (a written-out mode, or a plan with one way and no case for the solver) also gets `name$one`, giving its binds or `$no`; a solve site tests it instead of looping over a list of lists, and `first` over such a solve is a plain test. The pedal from 5.1× to 4.6× the hand-written one | #327 |
| C27 | Round 4 (the pedal, compiler/GAPS.md), P1: `$clean`, the solver's 12-digit rounding, without the string (n over a power of ten, toPrecision only where n could be a half off); test/clean.test.ts against toPrecision on 300,000 values. The pedal from 6.0× to 5.1× the hand-written one | #326 |
| C25 A5 | The pedal measured (compiler/gaps/bench-audio.ts): compiled 0.069 ms a block, 14 500 blocks/s, 39× real time; by hand in JavaScript 6× quicker; evaluator 8 blocks/s. A solve with one way to an answer (compiler/src/relation.ts) pushes its answer with no key or set to tell answers apart: the pedal 2× quicker. Left: `$clean` (12-digit rounding through a string) | #325 |
| C25 A3 | The pedal compresses: `following` carries the level from sample to sample (rises at once, falls by half in 0.06 s) and `compress` keeps it in a cell from block to block, so the output is the same at any block size; 4 to 1 over 0.5, so the drive no longer goes past ±1. Compiled 2063 blocks/s. The planned Linkwitz–Riley crossover is dropped: a filter's state makes its join a sum, not its split run backwards, so conjugation doesn't apply (AUDIO.md). test/sound-browser.ts checks the compressor and the knob on the strum | #324 |
| C25 A2 | Sound live in a page: Attribute `listen(to: Input, play)`, Input = `microphone` or `recording(address)` (std.ts); a click plays, another stops. The page runtime (src/lang/audio-page.ts) opens the input and runs an AudioWorkletNode; the program bundled for the audio thread (src/lang/audio-worklet.ts, cli/web.ts) runs main again there with a world of seeded noise, takes the n-th `listen`'s block function, and gets the page's writes to main's cells over the port, matched by the order cells were made (cells.ts onCell/onWrite). examples/pedal's main is the pedal page (microphone, a Karplus–Strong strum recording, Softer/Harder); `pedal` is what `lab render --main pedal` plays. `lab build-web` copies recordings beside the page; editor/build.ts builds apps/pedal.html (one additive line). test/sound-browser.ts plays it in Chromium over the DevTools protocol (Playwright pauses AudioWorklets for its debugger), a fake microphone in, an analyser out | #323 |
| C25 A1c | Haar's join as arithmetic: the pedal's split in lifting steps (fast = a − b, slow = b + fast/2, an odd sample fails), so each step run backwards has one unknown; compiler/src/modes.ts reads + − neg, and × ÷ by a nonzero number written there, backwards on Numbers; projectional/src/lang/modes.ts: a match whose arms build its result with different cases (or `fail`) gives at most one answer when the result is known (Mercury's switch detection on an output); a written-out plan stops at `fail`. The pedal compiled: 0.3 ms a block, 3258 blocks/s (375 needed; it was 41). Sweldens' lifting credited | #322 |
| C25 A1b | `inverse(f, y)` and `conjugate(f, g)` of a named f (g a function written there or a name) compile to a solve on f (compiler/src/inverses.ts), which a mode with one answer makes plain arithmetic (#250): the pedal's drive is tanh in closed form, 340× faster, and the pedal plays 41 blocks/s instead of 17. Answers are the evaluator's as the language compares numbers (its interpreter solves with fractions); test/inverses.test.ts. Partial evaluation credited | #321 |
| C25 A1 | Audio, stage A1: sounds offline. A sound is what its maker returns, a function from a block of samples (List Number) to a block, rows `AUDIO_BLOCK` (Cells, Update, Random, Diverge) and `AUDIO_MAKER` (Cells, Diverge) in std.ts; `src/lang/audio.ts` checks one and plays it block by block; `lab render <program> in.wav [-o out.wav] [--block n] [--compiled]` with a WAV reader and writer (cli/wav.ts); `examples/pedal`: drive as conjugate(atanh, scale) on the slow band of conjugate(Haar). Evaluator and compiled play the same bits at blocks of 128 and 256 (test/audio.test.ts). Compiled: 17 blocks/s of 375 | #320 |
| C26 | `lab compile`'s main without a worker thread: since C21 recursion that isn't a tail call goes on the heap, so the 1 GiB-stack worker only cost start-up (it loaded the program twice). Start-up 214 to 76 ms (bare node 40), Countdown 317 to 179 ms, ledger on 50,000 entries 435 to 296 ms (gaps/bench-native.ts); calc on 100,000 nested parentheses as before | #318 |
| C18 | Mobile as a packaged web app. `lab build-app <program> [-o folder]` (projectional/cli/app.ts): folder/www is the page with a web app manifest, a cache-first service worker keeping every file (cache named by content) and two icons; the folder is a Capacitor project (webDir www, README with the Android and iOS steps). Chromium reports the dice app installable with no errors and reloads it offline; test/app.test.ts runs the service worker against a cache in memory | #317 |
| C50 | A compiled program that runs relations or derivatives at run time carries the interpreter's copy of itself (`$loadProgram`): now the core, its own definitions and what they reach (modules.ts `pointsAt`), not every library module. backwards.js 366 KB → 61 KB, calculus.js 377 KB → 72 KB; found when the trees module would have added 217 KB to each | this PR |
| C49 | **Bug.** A list named by a let and walked once (`let xs = range(n)`, then `fold xs`) is a counted loop again: compiler/src/inline-lets.ts puts a let whose value is a storage's maker (range, characters), from names and effect-free builtins, where its one use is, when that use runs at most once (not in a function or a fold's arm), before compile() and lowerScalar(); a range used twice is still made. Tests: compiled JS (no range left), WebAssembly (fold over characters fused) | this PR |
| C34 | A program's own effect whose operations all never return compiles in WebAssembly and C as Abort does, found by that shape (scalar.ts `opOf`), not by `ABORT_OP`'s id: status 2 + the effect's number, the operation as a value of the effect's type (WebAssembly: an `eqref` global; C: `lab_reason`), and its handler a case on it. Two effects of the program's own, one passing through the other's handler, through a handler of Abort and through first, and an arm performing its sibling operation give the evaluator's answers, every cell freed | #454 |
| C47 | Library representations chosen automatically (src/lang/library-reps.ts): a program that uses std's Map gets the representation the chooser picks from the costs of its jobs, the sorted entries or L76's weight-balanced tree, in `lab` (run, compile, native, build-web, build-app; a representations.json row for Map still wins, `--as-defined` turns it off) and the editor's Run. equal, show and compare given a Map get its meaning, so they see the entries, not the tree's shape; a program with a map inside another value keeps the definition for now (C48). A word count with maps put in two orders prints the same on the tree, evaluated and as compiled JS, and its counts lower to WebAssembly and C | #398 |
| C46 | `compare` (L66) in WebAssembly and C: lowered per type in scalar.ts (a `T.compare` function giving −1, 0 or 1, then the Order case): Numbers as `equal` sees them, Ints, text by code point, Bools and cases by their place in the type, fractions by value, fields left to right with the last a tail call. The prelude's sort and the maps and sets of L65 compile to both targets; a constant of a generic type (`empty map`) is made at the type it's used at. Checked against the evaluator on Numbers with NaN and ±∞, Ints past 2⁶⁴, Unicode text, lists, pairs, Optionals, fractions, sort of 300 Ints and a Map tally, every C cell freed (also under AddressSanitizer) | #394 |
| C33 | Fractions (L39a's Rational) in WebAssembly and native code: `lowest terms` lowered to the runtime's `int.gcd` (Euclid's algorithm, textbook) and `int.exact`, written in WAT and C; Rational itself is data, so the rest needed nothing. Random Ints past 2⁶⁴ give the evaluator's answers in both, none at a zero bottom, every C cell freed (also under AddressSanitizer). WASM.md, NATIVE.md | #355 |
| C17 N5c | Native programs, stage 5c: a matched cell nobody else holds becomes the arm's next cell with the same fields (Lean 4's reset and reuse, credited); every way through uses it or frees it, and fields read where used are read at the arm's top. Ledger on 50,000 entries 646M to 388M instructions (108 to 79 ms); with N5b 815M to 388M. Countdown unchanged (nothing it takes apart has the fields of what it builds). Numbers in NATIVE.md. C17 done | #336 |
| C17 N5b | Native programs, stage 5b: a match on a cell nobody else holds moves its fields into the arm's locals with no dup, drops the fields nobody reads by type and frees the cell, with no lab_drop or lab_fields (Perceus's drop specialization, credited); shared cells are dup'd as before. Measured first by hand. Countdown 893M to 746M instructions (114 to 96 ms), ledger on 50,000 entries 815M to 646M (123 to 107 ms); numbers in NATIVE.md | #334 |
| C17 N5a | Native programs, stage 5a: measured, and cells from free lists. `compiler/gaps/bench-native.ts` runs native, compiled JavaScript and WebAssembly (node:wasi) as whole processes on Countdown, queens, wc, ledger and chapters, with wall time and peak memory; malloc and free were 46% of Countdown's native time, so cells up to 256 bytes now come from a free list per size, cut from blocks (plain malloc under a sanitizer). Countdown 196 to 115 ms, ledger on 200,000 entries 807 to 488 ms; native is fastest everywhere, at a tenth of the memory or less. Numbers in NATIVE.md | #316 |
| C17 N4b | Native programs, stage 4b: whole programs in C. The console and files over the C library and POSIX, with Node's world's words for failures; main gets the arguments and runs on a thread with a 1 GiB stack (calc's 100,000 nested parentheses), its Int the exit code, an unhandled Abort's reason on standard error with 1. `lab native <program> [-o out]` writes the C and builds it. wc, ledger, chapters, calc, queens and the world fixture give the evaluator's output, errors, exit codes and files on 70 runs | #315 |
| C17 N4a | Native programs, stage 4a: Int, Text and Abort in C (compiler/src/c-rt.ts). An Int is one word, the value while it fits 62 bits, else a counted cell of limbs (Knuth's Algorithm D as Hacker's Delight writes it, credited); a Text a counted UTF-8 cell; Number shown as JavaScript's String; Abort as status 2 with handlers as labels. Calls are statements, in order (an argument's call may drop a cell another argument reads). Calc's big Int arithmetic, tokens and parser, chapters, wc, ledger's amounts and aborts, and the converter give the evaluator's answers with every cell freed | #314 |
| C17 N3 | Native programs, stage 3: functions as values, one answer or none, and searches in C (projectional/NATIVE.md). Closures are counted cells holding their captures, called through a typed pointer and owning the closure; a partial function sets a status and gives a stand-in value, each call checks it and leaves through a label that drops what it owns; first/optional/all/count and failing budgets are a body, then a label for none. Countdown's whole search (solutions), algebra's evaluate, simplify and newton, calculus's partial definitions and the Peano and binary numbers give the evaluator's answers with no cell left, under AddressSanitizer too. Found on the way: ±∞ counted as whole numbers in the shared lowering (so WebAssembly and shaders too), now as Number.isInteger; `and`/`or` evaluate both sides in C as in WebAssembly | #313 |
| C17 N2 | Native programs, stage 2: data in C with reference counts (projectional/NATIVE.md). Cells per case, a static one for each case with no fields; dup and drop from liveness while printing (a use is the last or a dup, a branch drops what it doesn't use, a field read borrows), Perceus's (Koka) liveness half; a cell's fields are freed from a stack, not by recursion. sort, the calculus polynomials (100,000 coefficients), Countdown's valid, algebra's derivative, equal on lists and a rose tree's folds give the evaluator's answers, with no cell left after each call, also under AddressSanitizer | #312 |
| C17 N1 | Native programs, stage 1 (design: projectional/NATIVE.md, C from the same lowering with Perceus-style counts): the scalar profile and records print as C (compiler/src/c.ts), structs by value, self tail calls as loops, budgets; calculus, physics, the ray marcher's colours and the strip integral give the evaluator's bits with GCC and clang. Math is V8's fdlibm translated to C by compiler/math/to-c.ts: Node's bits on 140,000 inputs. C runs a call's arguments in any order (GCC right to left), so later stages put the impure ones in locals first | #311 |
| C11 | G17's copy per type for generics used at several types, measured and left: what a type changes in compiled JS is equality, and none of the 17 example programs with a main compiles a generic `$eq` any more (converter's one compares Optionals, not a generic); the one-type case (round 2) was already within noise on chapters, since `$eq` answers texts and numbers at once. Reopen with a program where a generic compare at two types is hot | #310 |
| C21 | G1's full fix: recursion that isn't a tail call goes on the heap in compiled JS, so pages and imported modules go past about 1,500 levels. A definition in a cycle of calls gets a generator copy whose calls in the cycle yield; past 1,000 such calls on the stack the call runs that copy under `$drive`, which keeps the waiting calls in an array (Kotlin's DeepRecursiveFunction, trampolined style; credited). calc takes 100,000 nested parentheses on Node's default stack (845 ms; before, it stopped near 1,500), and its sessions take the same time. Shallow calls pay a counter; a catch that goes on, and each page update, puts it back | #309 |
| C7 | WebAssembly for full programs (WasmGC), all five stages of projectional/WASM.md: data, closures, text and the world (also as WASI commands with no JavaScript, Math included), searches and effects, Int past 64 bits. The last W1 item, one cast per arm rather than per field read, measured and left: V8 with every cast skipped (`--experimental-wasm-assume-ref-cast-succeeds`) runs Countdown in WebAssembly no faster (79-88 ms against 74-88, noise), so fewer casts can't buy anything | #308 |
| C7 W3e | Math with no JavaScript host: under WASI, sin, cos, tan, exp, log, pow and atan2 are V8's port of fdlibm (what Node's Math runs; Sun's and V8's notices kept, credited) compiled by clang to WebAssembly and turned into runtime functions by compiler/math/gen.ts (generated src/wasm-math.ts, 10 functions), their tables and stack in a memory of their own (multi-memory, on by default in Node 22 and wasmtime). 350,000 inputs (any bits, edges, past 2²⁰·π/2) give exactly Node's bits. A JavaScript host still imports Math, so a page matches the browser's evaluator. WebAssembly modules now need nothing from a host but the world | #307 |
| C7 W1d | Folds over nested data in WebAssembly: a field holding the type inside a container (a rose tree's List of children, a List of Lists) folds to that container with each one folded, one function per container type made by the fold (Coq's nested inductive types, as the evaluator's nested.ts; credited), tail recursive modulo cons so 50,000 children need no stack; with Choice too. A type inside itself at other arguments (List (List Tree)) is now in the profile | #306 |
| C7 W5c | Quotient, remainder and power on big Ints in WebAssembly: Knuth's algorithm D on 32-bit limbs (as Hacker's Delight writes it; credited), floor division with the divisor's sign as int.ts does; power by squaring on the big multiply. The smallest i64 over -1 is 2⁶³ now, not a trap. Matches BigInt on 57,000 random divisions (limbs chosen to reach the rare add-back step) and the evaluator in the test. An Int no longer traps anywhere but a power too big for memory | #305 |
| C7 W5b | Int in WebAssembly grows past 64 bits: past an i64 it is a `$huge`, a sign and 32-bit limbs, written in WebAssembly (add, subtract, multiply, compare, equal, show, read, as Number, whole part; Knuth's classical algorithms, credited), with i31 and i64 fast paths so the small case costs nothing measurable (wc the same time, 1.1 KB more). The host passes big ones limb by limb (`toInt`, `fromInt`). Matches the evaluator around the i31 and i64 edges and on random Ints up to 320 bits. Left: quotient, remainder and power past 2⁶³ still trap (W5c) | #304 |
| C24 | WebAssembly tail recursion modulo cons: a function whose answer ends as cons(x, itself(…)) keeps the items so far in one more input and turns them round onto the answer at its other ends, so each step is a tail call (reversing, not filling holes, as WasmGC cells are immutable). ledger's entries: 15,000 lines ran out of stack, 200,000 now take 1.1 s | #303 |
| C23 | WebAssembly folds over `characters(t)` with no list and no stack: one function walks t's bytes from the end, a character per tail call (fusion, Wadler credited); the host fills a text four bytes a call. wc on 100,000 lines 4.2 s → 0.38 s (11×) | #302 |
| C7 W5a | Int in WebAssembly is an `i31ref` while it fits in 31 bits, else a `$big` box (now an i64, limbs in W5b), as Hoot and wasm_of_ocaml keep small ints (credited); the runtime's Int functions stay on i64s behind generated wrappers, the host makes and reads Ints with `Int.of` and `Int.get`. No measurable cost on ledger and wc | #301 |
| C7 W3d | A Number's show needs no host: past the plain decimals it is JavaScript's String, with Ryū's shortest digits written in WebAssembly (adapted, credited; tables built with BigInt into one global) and ECMA-262's layout. The same as String on every binary exponent, the decimal powers and random bits (2.6 million checked once, 30,000 in the test); the `host.show` import is gone, so modules import only Math and the world | #299 |
| C7 W3b-2 | Programs as WASI commands, with no JavaScript: the world written in WebAssembly over `wasi_snapshot_preview1`, and `_start` running main (`npm run wasi -- wc` in compiler/). wc, ledger, chapters, calc and a program using the rest of the world give the evaluator's output, files and exit codes under `node:wasi` on 90 runs, and run under wasmtime | #289 |
| C7 W4d | Searches with several answers in WebAssembly: a function that chooses takes the rest of the search as a closure and calls it on each answer (Mercury's success continuations, as the JS `$k` copies); handlers keep answers in a mutable box. queens and Countdown run whole; Countdown at 1.0-1.1× the hand-written ideal JS (compiled JS 1.2-1.5×) | #293 |
| C7 W4b | Choosing in WebAssembly: in first, optional, all and count, lets that choose `one of` a list (keep's shape, and nested) are a loop per choice, a tail call per item in the evaluator's order (all collects backwards and turns the list round); functions with Choice as values give a status too, and a generic definition is lowered per effect row as well as per type (keep with a test that may have no answer is a search itself). Every pure function of chapters and calc at known types compiles; 207 of their calls and the new searches fixture match the evaluator, a keep over 2×10⁴ items in constant stack | #280 |
| C7 W4a | Searches with one answer or none in WebAssembly: a partial function (Choice, or spending from a budget) gives a status after its answer (Mercury's semidet calling convention, credited); a call checks it and branches to the nearest handler's block, a tail call to a function that gives the same stays `return_call`; `first`, `optional`, `all` and `count` are blocks; `fail`, `value of`, and the Choice builtins (quotient, remainder, power, whole part, read, find, character code, character) are runtime functions with a status. Running out of a budget is no answer where it happens, which the nearest handler sees, as in the evaluator (the shader profile keeps its count check). chapters' `heading` and `lower` and ledger's `newline` and `table` now compile; 515 inputs match the evaluator | #279 |
| C7 W3a | Int and Text in WebAssembly: Int an i64 whose overflow traps (a runtime error, big Ints are W5), Text a UTF-8 byte array with positions counted in characters; compiler/src/wasm-rt.ts is a small runtime written in WebAssembly's text format (concat, length, slice, split, join all, characters, comes before, equal, show of Int and Number, range) that an assembler there turns into bytes, so the module's text is what runs. Library definitions (map, keep) now lower at known types (their body's type variables differ from their type's). wc's, chapters' and ledger's text functions match the evaluator | #276 |
| C7 W2 | Functions as values in WebAssembly: a function type is a closure struct holding its code (`(ref $code)`) and a code type taking the closure and the inputs, one rec group; a lambda is a function of its own plus a closure struct of what it captured; a definition by name is a closure made once; a call of a function value is `call_ref`, `return_call_ref` in tail position; a constant is a function of no inputs. Queens' `safe` (a fold into a function), numbers' `factorial` (a constant), calculus `newton` (takes functions) compile; answers match the evaluator | #273 |
| C7 W1c | Structural `equal` on data in WebAssembly (the evaluator's rule on each number, the last field a tail call: two lists of a million compare in constant stack); a fold whose arms each fold one child (lists, chains) is a loop, `down` keeping a stack of the values passed and `up` giving each its arm, the evaluator's order: polynomial over 10⁴ coefficients overflowed the stack, now 10⁶ run (375 ms) | #271 |
| C7 W1b | Data in WebAssembly (`data`): types with several cases and types that contain themselves (lists, expression trees) as a base struct with the case's number and a subtype per case, one recursion group; a match is `br_table`; a fold is a recursive function of its own, a result used once computed where it's used (insert stops at its place); a module that may not finish runs as in JS. sort, insert, polynomial, ∂polynomial/∂x, Countdown's valid and combine, algebra's derivative give the evaluator's answers through exported makers and readers (`List.cons`, `List.case`, `List.cons.head`) | #269 |
| C7 W1a | Records in WebAssembly as WasmGC structs, an exported reader per field (`Colour.red`), a generic definition at two types exported under both; the ray marcher's colours match the evaluator exactly. The editor's CPU fallback could now use WebAssembly for colour records (Inbox) | #265 |
| C7 design | projectional/WASM.md: whole programs to WasmGC by growing the scalar profile towards the heap; representation table, text as UTF-8 arrays, Int past 64 bits from the host, the five stages | #262 |
| C6 | G13 again, the part left: a single-answer function whose answers are one record leaves their fields in `$got` (a `$fields` copy) when its caller goes on with the answer; Countdown's `join` builds no `found`, 1.47× → 1.30× the ideal | #259 |
| C22 | G23's last part measured and left: `entries` kept as an array for the folds from the end made 50,000 lines 146 ms against 138 ms (noise), since each step's `add to` is the cost, not the spine (GAPS.md G23) | #255 |
| C22 | G23 part 2: a list from `split` matched and handed back to its own definition (ledger's `entries`, calc's `run lines`) is the array and an index; the folds from the end are still open above | #246 |
| C16 | G10: the output's indentation follows its brackets, not the ones in text or comments | #243 |
| C15 | G2: equality with a value built in place is a tag test and its fields, with nothing built | #240 |
| C14 | G12: `one of` a few constants written in place runs each in turn, with no list | #238 |
| C12 | G18: a handler whose cases all escape is an inline try/catch (calc enters one per line; gain within noise) | #233 |
| C13 | G1 again: a program `lab compile` writes spends fuel only in calls that can be under a `with fuel` (calc has no checks left; the gain is within noise) | #230 |
| C2 | G21 part 3: a list from `split` taken apart by matches is an index into the array (ledger's `parse` makes no cells, about 5 to 10%); the rest is C22 | #228 |
| C8 | `Float32`: an approximate representation of `Number` (every job rounded to binary32, literals too), so f32 is in the program rather than the GPU's choice; on the GPU test, 578 of 1001 values (functions of + − × only) now match the evaluator exactly instead of closely. Design #220, builtin #224, representation #225 | #226 |
| C10 | Deep recursion checked: `lab compile` takes 1,000,000 nested parentheses; on the default stack compiled and the ideal both stop near 1,500, no gap; heap continuations left as C21 | #218 |
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
| L66 | `compare(a, b)` on all plain data (std `Order`: before, same, after): numbers by value, text by code point, cases in declared order, then fields; `sort` in the prelude, a bottom-up merge sort with no Diverge; evaluator, compiled JS (`$order`), relate forwards; WASM and C are C46 | #382 |
| L67 | `Outcome a = done(value) \| refused(reason)` in std, the data form of Abort; prelude `attempt(action)` and `value or abort(o)`, plain matches; LANGUAGE.md "`Outcome`: the data form of Abort" | #385 |
| L65 | `Map k v` and `Set k` in std with one spelling (entries sorted by `compare`, no key twice) and 21 prelude operations (`value at` a Choice, `put`, `remove key`, `set union`...), linear until L76; DATA-STRUCTURES.md step 1, LANGUAGE.md "Maps and sets" | #389 |
| L76 | Maps as a weight-balanced tree (Adams 1993), `withMapTree` in src/lang/map-tree.ts: a representation of L65's Map, `canonical: false`, put/value at/remove key/has key in log n, checked against the meaning with the balance after each step; chooser picks it for a word count (3.5× on 1,200 words). Automatic choice and equal/show through meaning are C47 | #391 |
| L84 | Recursive lets: a let's function may call itself by the let's name and use the inputs around it (ML's `let rec`); checked for termination like a definition; src/lang/lift-lets.ts lifts it into a definition before the evaluator, relate.ts and every target run (via resolveArithmetic); the palette offers the name inside; the scope error now says "has no value here"; evaluator, JS, WebAssembly and C tests | #PR |
| L85 | `Number` renamed `Float64` (Ersagun 2026-10-26: not JavaScript's name): the type, `as float64` and `fraction as float64`, every message, note, palette text, test, example and living doc; ids and hashes unchanged, so saved programs open as before; the GPU's floats stay `Float32` | #458 |
| L81 | Infinities equal only to themselves: `close` (and compiled JS's `$near`, WebAssembly, C and WGSL's near) counts only a finite gap as near, so `equal(∞, −∞)`, `equal(∞, 0)` and `equal(1e308, ∞)` are false (newton on 1/x in examples/algebra used to stop on ∞ = 0 and now runs on, within `root near`'s budget); evaluator, JS, WebAssembly and C tests | #453 |
| L80 | Ints that know they're Ints: an Int is a JS number only below 2^28 and a BigInt beyond (int.ts), so `sameNumber` is near on every JS number with no wholeness test and exact on BigInts; √1e17·√1e17 = 1e17 now holds; compiled JS literals, WebAssembly and C's near, and the boundary tests follow | #446 |
| L79 | Private constructors: a `private` flag on a variant; `set of`, `map of` and `ratio` private to the prelude (and the map tree), refused elsewhere with what to use instead, not offered by the palette, a match still open; checker option `insiders` | #444 |
| L78 | An exact, total order for `compare`: Numbers exactly (NaN after the rest and the same as itself, −0 the same as 0), `equal` keeps its tolerance; sets, maps and sort no longer depend on input order, NaN can't break them, the map tree agrees on Number keys; JS, WebAssembly and C | #443 |
| L77 | The language explained in plain words for a newcomer (development pause): LANGUAGE.md "Start here" and "What's new since 2026-10-23", a plain note for every builtin and std type (src/lang/notes.ts), LIBRARY.md printed from them by library/reference.ts and kept current by a test | #401 |
| L54a | Operations answered later in the evaluator and checker: `later` on the variant, the rest as one more arm binder `(T) -[ε]-> R` (deep), twice on one path refused by the checker, a passed-on rest called twice stops the run; generator, page fetch, two-fiber scheduler as tests in the language; compiled JS refuses until C40 | #396 |
| L75 | Literals at Rational (`of: "std.rational"`, a whole number or `"top/bottom"`, put in lowest terms; a zero bottom is a checker error) and at Complex (`of: "std.complex"`, the real part), drawn as written and spelled as their constructor's call by arith.ts before anything runs; the language half of QA-2026-10-24b's "ratio(1, 2) + 1 is refused", E69 is the palette half | #381 |
| L74 | `show` (and Run) print a fraction as 1/2 and a complex number as 3 − 4i, not `ratio(1, 2)`: number types show as numbers, evaluated and compiled (one `showValue`); was E77 (QA-2026-10-24b) | #379 |
| L73 | `smaller`, `larger`, `at most`, `more than`, `at least` over the one generic `<`, so they work on Int and fractions as + − · < do (found by QA-2026-10-24b); the Number-only versions stay published and hidden so saved programs open, and the examples moved onto the new ones | #377 |
| L40 | Complex numbers: `std.complex`, `complex(re, im)` of two Numbers; the one `+ − · −x` resolve to prelude definitions (· the complex product) from the same table as Rational's, no `<`; `as complex`, `i`, `complex conjugate`, `modulus`, `angle of`, `polar`, `divide complex`, `complex exp`, `show complex`; a `vec2f` on the GPU and two f64s in WebAssembly with no back-end change; derivatives through it right | #374 |
| L53 | The world-under-Choice rule comes from the types: a search's function (`all`, `count`, `first`, `optional`) has a row of its own that can't take `Console`, `Files` or `Update`, contained in the call's row (Koka subeffecting, influence), so a printer taken out of a list or passed down is refused and code beside a search may still print; pins carry it (`noWorld`, `subs`); `worldUnderChoice` gone | #369 |
| L52 | A page's event handler that fetches is taken back and run again when the reply lands (cells.ts `attempt`, `undo`, `later`; STM's retry, influence), so what it did before the fetch happens once | #363 |
| L33 | `≤ > ≥` (`at most`, `more than`, `at least`), `smaller` and `larger` in the prelude over `<`, and Text's `≤ > ≥` (`not after`, `comes after`, `not before`) over `comes before`, drawn with glyphs. pedal and raymarch adopted the prelude's `smaller`/`larger` (pedal's `louder` was `larger`); calc, chapters and countdown read `c ≥ "0" and c ≤ "9"` instead of `not ‹comes before›(…)`. ledger's `larger` is on Int and stays until L38. | this PR |
| L32 | Int's arithmetic drawn with Number's glyphs (`n + 1`, `a < b`, not `add(n, 1)`, `‹less than›(a, b)`) in every style; presentation only (LANGUAGE-REVIEW-2026-10-24 §1) | #341 |
| L31 | The pedal's microphone says what goes wrong, on the page (Ersagun's gaming headset gave nothing): each refusal in words under the button (not allowed, none found, in use or the driver refused, needs https), silence for 3 s said as "muted?", a microphone at a rate the browser won't connect across (Firefox) given its own context at that rate, a stereo input mixed to mono; the constraints only ask (no rate, channels or device), and fall back to plain audio if refused. test/sound-browser.ts checks a refusal is shown | #340 |
| L30 | The pedal you can hear (Ersagun: Softer and Harder sounded like volume): a Clean/Driven switch for A/B; the output brought back to the loudness that came in, sample by sample (two mean squares in cells, gain at most 4, samples under 0.95), so the drive changes the tone and can't run away into feedback; drive 32 by default, capped at 256; a picture of a sine before and after the drive, SVG drawn by the program. Strum: crest 8.8 to 5.4 at the same loudness. Compiled 63× real time (by hand 4× quicker; the matching is plain recursion building pairs) | #338 |
| L23 | `conjugate(f, g)` = f⁻¹ ∘ g ∘ f in the prelude, over `inverse`; `examples/conjugate` (in the editor as "Conjugation"): brighter in linear light, a quarter turn about a point, the fast band of a Haar split softened; run and compiled the same | #249 |
| L15 | Static output: `lab run` on a page prints it once as an HTML document (every text, part and attribute drawn, handlers left out); `<style>` and `<script>` text unescaped | #235 |
| L27 | `Log` in a page's views and handlers: both rows allow it, a line goes to the browser console (a view's each time it runs), evaluator and compiled the same | #232 |
| L14 | One generic bind: the prelude's `inverse(f, y)` runs any function value backwards (a solve over `applied(f, x) = f(x)`). The converter's fields read back with `inverse(view, typed)` and its ten `from X` definitions are gone (646 nodes to 559). Found and closed a hole: a function given to a solve as a port lost its effects; they now reach the row around. A closed function in a variable opens at each use (Koka's `open`), so a field's `view` can be both shown and inverted. Compiled pages mark builtins used as values, so `inverse(show, …)` runs compiled too | #229 |
| L28 | The html module: each tag a function of its children, attributes by wrapping (`styled`, `classed`, `named`, `with`), `button`, `words`, a style sheet as a list of rules. The dice and converter pages rewritten with it (dice 475 nodes to 382; the converter's style sheet is its own definition) | #209 |
| L13 | Keyed lists in pages: `each(items, f)` in cells (Solid's `mapArray`) and the html module's `for each(items, row, inside)`, which keeps an item's row, cells and all, when the list changes; evaluator and compiled pages the same | #222 |
| L25 | Container matrix, the other places: a solve's body, a function run backwards, a shader (with and without a literal with fuel), a representation's job, a module's pinned export and one whose pin leaves an effect out. One hole found and closed: a job that did an effect its definition doesn't was only caught when the rewritten program happened not to check; `jobProblem` refuses it before the rewrite (`lab` asks it) | #219 |
| L26 | The effect ledger in code: every place an effect leaves a row calls `discharge(where, effects, why)` (`src/lang/ledger.ts`); LANGUAGE.md's "Where effects go" table is generated from the calls, and a test checks each builtin's type drops exactly its row | #216 |
| L7 | One record per builtin for the compiler's targets (`compiler/src/builtins.ts`): its JavaScript (an expression, std.ts's implementation, or written by compile.ts, saying where) and its scalar operation for WASM and WGSL, or why it has none, which a shader's refusal now says. compile.ts's OPS and impl rule and scalar.ts's table are derived from it, and a full WASM target adds a field, not a table. The language's jobs stay in their modules: relate.ts's backwards rules are closures over its search and derive.ts's come from invertible's table, so a record would only point at them; `builtins.test.ts` asks each of them for every builtin | #252 |
| L11e | MODES step 5: a relational `solve` whose mode is `det` or `semidet` compiles to its plan written out (`compiler/src/modes.ts`), with no interpreter in the module when every solve is like that; several answers stay with relate.ts | #250 |
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
| T6 | Testing rules in WORKFLOW.md ("Tests"): the language's terms, laws over all examples, tests go with the design they pin, under 5 s per file or a sweep, no coverage targets. The tests that mention `cons` read against them: toplevel.test.ts edits a match on a list's cons arm (would change with arrays, as it should); compiler checks that output has no `$cons` (the opposite of a pin) | this PR |
| T5 | Nightly at 03:00 UTC, when main changed since the `good` tag: `npm run affected -- --all` (every test, every sweep in full, the browser and GPU checks); green moves `good`. Running Pages by hand on `good` puts back the last fully checked site | #267 |
| T2 | `npm run affected` runs only the tests a change reaches: the import graph across the three packages, the test files that read a changed example, the browser tests when the pages could change; Check main runs it from its last green commit. Over the last 40 merges: 6 needed nothing, 5 nearly every unit test, the rest a few files; the browser tests (now the long pole, T4) for 31 | #266 |
| T3 | The four slowest test files check a rotating eighth of their sweep per run (`SWEEP=all` for everything, `SWEEP_AT` picks the eighth; Check main passes its run number): about 330 s → 60 s; lang.test.ts no longer repeats palette.test.ts's queens sweep | #264 |
| T1 | Deploy first: a merge is live in about 2 minutes (86 s for #262); the suites run beside it in "Check main" and report instead of blocking | #261 |
| P4 | CI on a pull request is only the type check (under a minute); unit and browser tests run once per merge before the deploy | #187 |

### Before the backlog

| id | item | PR |
|---|---|---|
| | Countdown in the program list (Hutton credited) | #174 |
| | QA2 H1, H2, M1 to M4 | #137, #139, #159, #160, #158, #156 |
| | Can't-edit: change a call's function keeping its inputs; field types | #151, #147 |
| | GAPS round 2: G9, G11, G13, G14, G15, G17 (one type), G19 (half) | #133 to #170 |
| | Second review fixes 1 to 6 (builtin half), agreement test, TypeScript type-check in CI | #117 to #173 |
