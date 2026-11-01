# Backlog

Every open item from every source (Ersagun's asks, reviews, QA passes,
bigger-program rounds, design notes), in one place. Finished items are in
[DONE.md](docs/process/DONE.md). How items are picked and run is in
[WORKFLOW.md](docs/process/WORKFLOW.md); every doc is listed in [the docs index](docs/README.md).

Each lane's items are grouped by theme. Within a lane, priority (P1 first)
decides what's next, and "Next up" below names it. When the order changes,
change "Next up" in the same PR.

**Priority:** P0 broken now · P1 blocks the current step or Ersagun asked ·
P2 next steps · P3 nice to have. Within a priority: bugs, then removing a
special case, then what lets programs be written in the editor, then
language, then more targets or speed (WORKFLOW.md "Priority").
**Size:** S hours · M one PR · L several PRs or a design note first.
**Status:** ▶ running · ⏸ held · blank = waiting.

## Next up

Ersagun's "take 20 tasks" (2026-11-01): Editor 7, Compiler 7, Language 6.

| lane | thread | next, in order |
|---|---|---|
| E Editor | "Editor lane" | I101, I102, I103, I104 (QA12), I99 (drag a built point), T7d (the editor's tick and accept button), L43d (the editor names a value's mask) |
| C Compiler and targets | "Compiler lane" | L41 (table products expanded at compile time), L43c (store only the masked parts), C40's next step, C66 on shaders, C55, C63, C64's next step |
| L Language and library | "Language lane" | Next up for all lanes (#809), L43e named masks on fields (this PR), L38 (Int from a parameter's type alone), L54b, L108d (representation laws), L97d (Fixed's CORDIC polar), L69a (foreign definitions, JS host). Yesterday's run ended with I100 (#805) |
| T Testing | "Replace the slow browser smoke test" | I64, then the smoke's replacement |

## Inbox

New items land here until the next triage gives them a lane and a priority.

| id | item | source | added |
|---|---|---|---|
| I101 | **Bug.** Opening Clifford page helpers freezes the page 2 to 4 s: Spacetime `rapidity picture` 3.7 s frame gap, Bounce `solid bodies` 2.4 s, Constructions `equal arcs` 2.3 s; cap opening work at ~300 ms or run it in the worker | QA12 H1 | 2026-11-01 |
| I102 | Dice `landed`, to-do `field`, Constructions `drawn` (cells/handlers, effects) still open on "search found no result"; say Show values runs it, neutrally | QA12 M1 | 2026-11-01 |
| I103 | Tumble `contains` opens on a red "No answer": `holds` is ticked true though main's first call (items = []) gave false | QA12 L1 | 2026-11-01 |
| I104 | Tumble's main still opens with ~250 px empty canvas above its first row | QA12 L2 | 2026-11-01 |
| I99 | Drag a built point on Constructions and Compass (a crossing, a midpoint, an inverted point), not only free ones. Running the construction backwards has endless answers (either line could turn about either of its points), so it needs a rule to pick one: proposed "least movement", moving the free points it depends on as little as possible so the point lands under the pointer (a few Newton steps on the free points' coordinates); the simpler "carry the parents" slides every free point it depends on by the same amount. Ersagun was told least movement is the recommendation. | Ersagun 2026-10-31 21:08 | 2026-10-31 |

## E: Editor

### Bugs

| id | item | source | pri | size | status |
|---|---|---|---|---|---|

### Writing programs in the editor

| id | item | source | pri | size | status |
|---|---|---|---|---|---|
| I29 | 66 of 154 definitions open with an empty Run. Pictures run at their pixel (#578); left: Mandelbrot's helpers (called through a fold), derivatives, page parts, newton. **Counted 2026-10-30 (editor lane):** 57 still empty in converter, dice, calculus, Mandelbrot and pedal. Two causes, neither a quick fix: (a) the first call's inputs are functions (`newton(f, f′, x)`, `field(…, view, …)`), **done in #703**: a port's box takes a definition's name as its function, so newton's helpers now open filled; (b) **views done in #761** (empty Runs in converter, dice, Tumble, Pig 47 → 28); left: what only a handler calls, which waits for an event. Was: the call is inside a page part that runs later (`property("value", view(read(q)))`, a handler, an audio block), which main's trace never enters. Running main in a dry world (files kept in memory, no network) gets past converter's file read but fills none of these | QA-2026-10-28 L4 | P2 | M | step 1 done |
| I49 | Resize a node by hand: "not now, but likely needed at some point" | Ersagun 2026-10-29 | P3 | S | |

### Speed of editing

| id | item | source | pri | size | status |
|---|---|---|---|---|---|
| E103 | **Bug.** Adding a value in a definition run backwards (physics `fall`) takes about 4 s; five stages (#478 to #504) took fall's holes from 48 s to 18.5 s in all. Stopped by the 10% rule; what's left is E133 | E100 | P3 | M | |
| I40 | Add a step before this on physics `main` takes ~2 s: the palette checks each of ~590 candidates against the whole program (same cause as E103) | smoke fix, 2026-10-29 | P3 | M | |
| E133 | **Design.** Fillings share the program's nodes instead of copying ~3000 each: a persistent node store under `Code` (HAMT or overlay map), about 20% off a palette. Design note before building | E103 | P3 | L | ⏸ held |

## C: Compiler and targets

New targets and speed rank below every language item (Ersagun,
2026-10-24 07:01). Measurements and rounds: docs/reports/GAPS.md.

### Bugs and gaps found by programs

| id | item | source | pri | size | status |
|---|---|---|---|---|---|
| C40 | Compiled JS for operations answered later (L54/L71): steps 1, 2a to 2d done (#571 to #573). Next: a search whose own definitions wait; then the world's `await(any of …)` as a promise, after L71 | LANGUAGE-NEEDS-2026-10-24 | P2 | M | step 2 done |

### Speed of compiled code

| id | item | source | pri | size | status |
|---|---|---|---|---|---|
| C67 | **A faster compiler** (Ersagun 2026-10-31: "make the compiler faster"). The editor's compiled swap takes 2 to 7 s. Benchmarks: compiling Bounce, Spacetime and Constructions to JS (main). Before: 6.1, 5.9 and 1.9 s; most of it is the program checked again after staging, over the whole library. Done: C67a, only what the exports reach is compiled (3.5, 4.4, 1.0 s); C67b, ids from a pool of random bytes (3.0, 4.2, 0.8 s); C67c, effect-row chains flattened as they are walked (2.9, 2.7, 0.8 s). Stopped there (2026-10-31): no single function is over 0.5 s now. The largest part left is staging's two whole-program checks (about 1 s of Spacetime's 2.7 s). C67d would check the middle one only on the definitions staging changed (infer's `reuse`, as the palette does), which saves about 10% at best and must merge type info from two checks: not worth it yet. The rest is staging's own work (evaluating at compile time). The rule was to stop when a step buys less than 10% | Ersagun | P3 | M | stopped; C67d open |
| C66 | std's Array on the other targets (Ersagun 2026-10-31 "Yea"). WebAssembly done (C66a), native C done (C66b). Shaders, as Ersagun chose (2026-10-31): Int as an i32 done (C66c1), `first` with a fallback and `count` done (C66c2), arrays of a fixed size done (C66c3); left: an array as a shader function's input (a copy per size), then Int in 32 bits and the flag in WebAssembly's scalar profile, so the editor's pictures (CPU side) can turn `shader` on. Also left: equal and compare on arrays in WebAssembly and C. Bring the two-ended buffer views from #734 (a start and length on a buffer with room at both ends, a push writing into a free slot) to WASM and C, and to shaders where a fixed size fits | Ersagun | P1 | L | |
| C30 | Lists as arrays. Done so far: P4a, #555, #558, #561 (pedal 2.9×). The split, join and block-in-array stages pay only together (~25% more); do them as one stage when another program needs lists as arrays. The aim: an `array` representation written in the language (REPRESENTATIONS.md), so WASM, C and the editor get it too. C30d (2026-10-31): Ersagun's two-ended array list; JS runtime views (C30d1, #734), the ends and `array of List` (#737), the ends in WebAssembly and C (C30d2, #754), the evaluator's arrays on the same buffer (C30d3a, #762; Ersagun chose "everywhere" 2026-10-31), the preview's chooser picking `array of List` from use (C30d3b); next C30d3c, the compiled targets taking the same choice (WebAssembly and C need `first of array if any`) | GAPS.md round 4 P4 | P2 | L | |
| C55 | Compile each direction of a relation a program uses as its own function (Mercury), dropping results no caller reads: `y` of `polar` alone is a plain sine, both together one sincos | Ersagun 2026-10-28 | P2 | M | |
| C63 | IN-PLACE.md step 2: a hash table changed in place as a representation of Map and Set, where every value has one holder and keys hash as they're equal. Needs step 1's one-holder analysis, not its node reuse (C62 measured no gain) | docs/design/data/IN-PLACE.md | P2 | L | |
| C31 | A recursion that gives back a Pair returns its two fields without the record. 3% on the pedal | GAPS.md round 4 P5 | P3 | M | after C30 |
| C64 | Handlers the compiler can see: Pig's `quietly` and `hold at` sit right around `play`. Done: C64a (#759, quiet cases skip the hiding, 330 → 270 ms) and C64b (#787, handlers written into the code they handle, 270 → about 95 ms). Next: Random's perform in `die` still searches for the world's handler (about 95 ms vs the ideal 25 ms); a case written in as a function called at once could be a plain let | examples/pig | P3 | M | |

### Memory and layout (STABLE-REFERENCES.md §3 to §6)

All invisible to programs: no annotations or hints (Ersagun 2026-10-29).

| id | item | source | pri | size | status |
|---|---|---|---|---|---|
| C56 | "Owned, in place" as a representation chosen when a value has one holder, generalising `$own` and C30 to records, maps and cell contents; reference counts (Perceus) where the compiler can't tell. Steps are C62, C63 | STABLE-REFERENCES.md §3 | P3 | L | |
| C45 | A persistent vector (RRB trees, Bagwell and Rompf) as a representation of `List` for indexed updates | LANGUAGE-NEEDS-2026-10-24 | P3 | M | after C30 |
| C57 | A region per scope: temporaries of one page update, audio block or frame freed at once (Tofte–Talpin) | STABLE-REFERENCES.md §4 | P3 | L | |
| C58 | Keyed collections as a grow-only array with a free list and generational keys (ECS) | STABLE-REFERENCES.md §4 | P3 | M | |
| C59 | Flat inline layout for data built once and read, doubling as a file format (FlatBuffers) | STABLE-REFERENCES.md §4 | P3 | M | |
| C60 | **Later goal**: a list of records stored as columns when its loops read few fields | STABLE-REFERENCES.md §5 | P3 | L | |
| C61 | **Later goal**: where code runs chosen by cost, never written (workers, GPU compute, main thread). First step: read Bend 2 and write the design note | STABLE-REFERENCES.md §6 | P3 | L | |

### Parallel and concurrent code on the targets

| id | item | source | pri | size | status |
|---|---|---|---|---|---|
| C41 | Pure `together` branches on worker_threads / Web Workers past a cost threshold | LANGUAGE-NEEDS-2026-10-24 | P3 | M | after L62 |
| C42 | Data-parallel `map` and associative folds on a thread pool, later as compute shaders (NESL, Futhark) | LANGUAGE-NEEDS-2026-10-24 | P3 | L | after C30 |
| C43 | Or-parallel `all`/`count` and speculative `first` in canonical order, with work stealing (Cilk, Aurora/Muse) | LANGUAGE-NEEDS-2026-10-24 | P3 | L | after C41 |
| C44 | Fibers in native C (own stacks, an event loop) and in WASM (JSPI) | LANGUAGE-NEEDS-2026-10-24 | P3 | L | after C40 |

## L: Language and library

Numbers first (Ersagun, 2026-10-24 07:01), then the rest of
LANGUAGE-REVIEW-2026-10-24. Anything that only adds a target ranks below
all of these.

### Bugs and gaps found by programs

| id | item | source | pri | size | status |
|---|---|---|---|---|---|
| L29 | Function variables' rows checked in any order (the closing use should win either way). The other half, `inverse(f, …)` typed from f at the call, is done (#701) | L14 | P3 | M | |

### Ersagun's current asks

| id | item | source | pri | size | status |
|---|---|---|---|---|---|
| L107 | **Open question, not decided** (Ersagun 2026-10-30: "I didn't ask to lift strict positivity BTW, I'm not sure if we should lift that"): drop strict positivity, so a data type may take itself as a function's input in its fields (`knot = wrap(f: knot → Float64)`), with taking one apart carrying Diverge so a function without Diverge still always finishes. Recursive data types themselves (a type holding itself, directly or through others) are allowed and always were; TUTORIAL.md §3.8 says so. If decided yes: LANGUAGE.md "Two rules", TUTORIAL.md §3.8 and the guarantees test | Ersagun 2026-10-30 | P3 | S | open question |
| L108 | Representations written in the language (REPRESENTATIONS.md). L108a to L108c done: a representation is a definition, the compiler chooses, no explicit selection (#679 to #682). Left: L108d, laws, after T7; the editor half is E159 | Ersagun 2026-10-30 | P2 | M | 3 of 4 steps |
| T7 | Tests in the language ([TESTS-IN-THE-LANGUAGE.md](docs/design/testing/TESTS-IN-THE-LANGUAGE.md)): T7a `Check`, small values and `lab test` done; T7b accepted answers in examples.json done; T7c results cached by hash: local done (`.lab/checks.json`), CI's cache left (T, S); T7d the editor's tick, difference and accept button (E, M); T7e example sweeps moved to answers and laws, `--compiled` (T, M). Unblocks L108d, L97e | TESTING.md T7 | P2 | L | design, T7a and T7b done |

### Numbers (NUMBERS.md)

| id | item | source | pri | size | status |
|---|---|---|---|---|---|
| L38 | One `+ − · −x <` for every number type: steps 1 to 4 done, now the std interfaces Arithmetic and Ordered (L40h). Open: a generic op made Int by a parameter's type alone (no Int literal) is still planned as Float64's equations, because the plan reads the code and not the types | LANGUAGE-REVIEW-2026-10-24 | P1 | S | open ends |
| L44 | Linear maps, geometry and matrices ([MATRICES.md](docs/design/numbers/MATRICES.md), Ersagun 2026-10-31): `Mat2` to `Mat4` done (L44a). Rotors, reflections, projections and PGA motions from the Clifford tables done (L44b); reading a function's matrix done (L44c, src/lang/linear.ts). Next: the compiler stores linear functions as matrices (C lane, C30b/c); then a linear-algebra library for any size | LANGUAGE-REVIEW-2026-10-24 | P1 | M | steps 1-2 done |
| L42 | `Cl(p, q, r)`: `clifford table` done (L42a). Next: a PGA motor in the ray marcher, after L41 | NUMBERS.md stage 4 | P1 | M | step 1 done |
| L43 | Rotors done (L43a: quaternions as the even part of `Cl(3, 0)`). Next, which parts can be nonzero ([GRADES.md](docs/design/numbers/GRADES.md)): L43b blade masks done (src/lang/grades.ts); L43c compiled JS and WGSL store only the masked parts, with L41 (C, M); L43d the editor names a value's mask (E, S); L43e masks are types, a wrong grade is a type error (done: a part read outside the mask; named masks on record fields, `Vector of T` and the others; next: on lists' items, then where the editor names an input's type) (Ersagun 2026-10-31: "each blade combination a different type") (L, M). Bounce passes vectors, spins and rotors as one 8-part type | NUMBERS.md stage 4, [CLIFFORD-DEMOS](docs/reports/CLIFFORD-DEMOS-2026-10-31.md) B3 | P1 | L | rotors and masks done |
| L118 | A faster evaluator ([EVALUATOR-SPEED-2026-10-31.md](docs/reports/EVALUATOR-SPEED-2026-10-31.md)): profile, one hotspot per PR, stop when the next buys <10%. L118a the table product as a jet done (Spacetime's charge path 8.3 s → 0.48 s, Bounce's step 14 → 3.7 ms). L118b, the machine's own hotspots, measured below the noise and stopped. Stopped here (Ersagun 2026-10-31 21:12); L118c is its own row below | Ersagun 2026-10-31 | P1 | M | done for now |
| L118c | The evaluator compiles each definition to JavaScript closures once (closure compilation, Feeley and Lapalme 1987), keeping the heap continuation only where a search or a handler needs it; likely 3-10x on all interpreted code ([EVALUATOR-SPEED-2026-10-31.md](docs/reports/EVALUATOR-SPEED-2026-10-31.md) step 2). For later: Ersagun stopped L118 after step 2 | Ersagun 2026-10-31 | P3 | L | for later |
| L41 | Table products expanded at compile time, zero terms dropped (with lane C). Measured in Bounce: a Cl(3, 0) product is 0.10 ms compiled, about 200 times a hand-written one | LANGUAGE-REVIEW-2026-10-24, [CLIFFORD-DEMOS](docs/reports/CLIFFORD-DEMOS-2026-10-31.md) B1 | P1 | M | |
| L51 | Tensors as the general algebra (NUMBERS.md stage 6) | NUMBERS.md stage 6 | P1 | L | after C30 |
| L97 | `polar` as the relation behind Trig (POLAR.md): L97a to L97c4 done (Trig's polar, unpolar, asin, acos; polar given x, y answered by unpolar). L97e complex laws done (prelude tests). Next: L97d Fixed's CORDIC | Ersagun 2026-10-28 | P2 | M | 4 of 5 steps, L97d left |
| L96 | Several ways to compute one operation, the compiler choosing by cost (WAYS.md): L96a to L96c done. Left: the steps after L97 | Ersagun 2026-10-28 | P2 | L | 3 of 5 steps |
| L88 | Exact reals (EXACT-REALS.md): `Algebraic` done (L88a to L88d, √2·√2 is the Int 2). Next: step 4, `Real` as lazy intervals, when a program needs π exactly | Ersagun 2026-10-26 | P2 | L | 3 of 4 steps |
| L89 | Fixed point for games (FIXED-POINT.md): `Fixed`, exact show, CORDIC trig and examples/lockstep done (L89a to L89d). Left: i64 on WASM and C (lane C) | Ersagun 2026-10-26 | P3 | M | 3 of 4 steps |

### Data and representations (DATA-STRUCTURES.md, REPRESENTATIONS.md)

| id | item | source | pri | size | status |
|---|---|---|---|---|---|
| L61 | Better data structures as representations: a meaning (List, Map, Set) plus representations (array, HAMT, balanced tree, RRB vector) chosen per value, no new node kinds. `Map` and `Set` done (L65); written in the language since L108b | Ersagun 2026-10-24 | P1 | L | Map and Set done |
| L98 | A cell owns its value and a write is an edit at a path (STABLE-REFERENCES.md §1): positions done (L98a). Next: keys, with L99 | Ersagun 2026-10-29 | P2 | L | step 1 done |
| L99 | Reads tracked by path, so data in cells stays plain (§2): `each` follows edits (L99a), tracked views (L99b), nested lists (L99c) done. Next: the compiler picking views where a watcher reads; a plain `State` handler | Ersagun 2026-10-29 | P2 | L | 3 steps done |
| L101 | **Later goal**: multithreading where uniqueness allows it (rayon), effect rows deciding what runs side by side (§5) | Ersagun 2026-10-29 | P3 | L | |
| L18 | Relational reads past about 1,300 items: a stackless `relate.ts` (folds already read 3,000) | real-sized data | P3 | M | |
| L20 | `set` with general functions through relations | real-sized data | P3 | M | |
| L21 | Folds: a `build` row for user producers, folds with `Choice` asking the table | ROADMAP 5 | P3 | L | |

### Effects and concurrency (ANSWERED-LATER.md, EFFECTS-REVIEW-2026-10-24)

| id | item | source | pri | size | status |
|---|---|---|---|---|---|
| L54 | Operations answered later, at most once (ANSWERED-LATER.md): step 1 done (L54a); compiled side is C40 | EFFECTS-REVIEW §1.5, §5 | P1 | L | step 1 done |
| L59 | A page's fetch and wait resume instead of re-running the handler; `Wait` folds into `Time` | EFFECTS-REVIEW §1.1-1.3 | P1 | M | after L54 |
| L60 | The audio worklet's run of `main` replays the page's random numbers and clock under a handler | EFFECTS-REVIEW §1.4 | P2 | M | after L54 |
| L71 | `together`, `race`, `within(ms, a)` as prelude handlers over `await` | LANGUAGE-NEEDS Part 1 | P2 | L | after L54 |
| L63 | Deterministic schedules: under `seeded` the scheduler's choices are seeded, so an interleaving bug is a seed in a test (FoundationDB) | LANGUAGE-NEEDS Part 1 | P2 | M | after L71, L55 |
| L69 | Foreign definitions ([FOREIGN.md](docs/design/targets/FOREIGN.md)): a program's own effect answered by a host file per target. L69a `hosts/js.js` in the evaluator and compiled JS, results checked at the border, `lab hosts` skeleton (L, M); L69b C and WebAssembly (C, M); L69c the editor's "needs its host" (E, S); L69d optional, std's world operations as host files (L, M). Asks Ersagun: may a foreign operation be declared pure | LANGUAGE-NEEDS §5 | P2 | M | design done |
| L62 | Branches with no world effects marked pure by a row constraint, so the runtime may run them on another core | LANGUAGE-NEEDS Part 1 | P3 | S | after L71 |
| L64 | Scoped channels (`Channel a`, `send`, `receive`), when a program needs a pipeline | LANGUAGE-NEEDS Part 1 | P3 | M | |

### Relations and totality (BACKWARDS.md, MODES.md)

| id | item | source | pri | size | status |
|---|---|---|---|---|---|
| I84 | Bounce's `bump pairs` is inferred Diverge: it recurses on a list it gets back inside a Pair, which the checker can't see is shorter | [CLIFFORD-DEMOS](docs/reports/CLIFFORD-DEMOS-2026-10-31.md) B7 | P3 | L | |
| L46b | Raymarch's `march` and `shadow` count steps in an Int and `colour` drops `with fuel` (bounded counting is total since L46). Waits on Int in the scalar profile outside shaders (C66's WebAssembly int32 step; plain JS and C too), or the editor's CPU-side pictures and the scalar tests refuse it | L46 | P3 | S | |

### Grammars, modules and sharing

| id | item | source | pri | size | status |
|---|---|---|---|---|---|
| L70 | Design note: grammars written once as printers and parsed by running them backwards; calc's parser first | LANGUAGE-NEEDS §8 | P3 | M | |
| L72 | Grammars and their machines (Chomsky hierarchy) as ordinary data, parsing and printing one relation run both ways; extends L70 | Ersagun 2026-10-24 | P3 | L | low priority |
| L17 | Data-type upgrades (migrations when constructors and fields move); path namespaces are a name layer (SHARING.md §5) | ROADMAP 5 | P3 | L | |
| L113 | Structural diff and three-way merge driver for program files, by id, in `.gitattributes`; can go first | SHARING.md §6 | P3 | M | |
| L109 | Hashes carry a recipe version; std published with lineages and versions, so a std change adds versions and keeps the old (no more #709-style republishing) | SHARING.md §3 | P3 | M | |
| L110 | Publishing keeps the draft id as the lineage id; refs hold lineage and exact version; `replaces` derived from the lineage | SHARING.md §1, §2 | P3 | M | after L109 |
| L111 | Upgrades by pin generality (new pin at least as general), moved by the editor with a note; Bob's tests must pass once T7 exists | SHARING.md §2 | P3 | M | after L110 |
| L112 | Names pinned per program; one question per upgrade for the author's renames; the program's own renames win | SHARING.md §5 | P3 | M | after L110 |
| L115 | Project store: every published node the project used, kept by hash with it by default; runs when a source is gone; downgrade to any kept version (Ersagun 2026-10-31) | SHARING.md §4b | P3 | M | after L110 |
| L114 | Lineage logs: signed, append-only, "current" and "broken" entries; code fetched by hash from any host; a browser over logs (was L68) | SHARING.md §4 | P3 | L | after L111 |

### Someday

| id | item | source | pri | size | status |
|---|---|---|---|---|---|
| L12 | Tutorial screenshots brought up to the current editor | ROADMAP 2 | P3 | M | |
| L16 | Guarded corecursion, and a stateful handler form so programs write their own Cells | ROADMAP 4 | P3 | L | |
| L22 | Profiles inferred like effects and shown in the editor ("runs on the GPU") | REVIEW-2026-10-22b §5 | P3 | L | |
| L24 | Research as it becomes blocking: costs from folds, laws proved by fusion, fast invertible parsing | ROADMAP 8 | P3 | L | |

## T: Testing and fast feedback

The thread that owns `.github/workflows` and the browser checks. Plan:
docs/process/TESTING.md. T7 is in lane L.

| id | item | source | pri | size | status |
|---|---|---|---|---|---|
| I64 | The browser smoke fails at letNodes: it waits for dice's `die` call node, which since auto-fold (#619) sits in a folded handler. Pick a call that's drawn, or unfold its frame first | smoke thread, 2026-10-29 | P2 | S | |

## Coordinator and process

Not lane work; the coordinator does these or asks Ersagun.

| id | item | source | pri | status |
|---|---|---|---|---|
| P1 | PRs #43 and #44, open since 2026-10-22, likely superseded by #49: close or land | REVIEW-2026-10-22b §8 | P2 | |
| P2 | Batch deploys if Actions cost needs it | Ersagun 2026-10-23 | P3 | asked, not requested |
| P3 | A per-repo Actions budget, or a public repo for free Actions | thread "GitHub Actions cost" | P3 | Ersagun's call |
