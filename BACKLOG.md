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

Tidied 2026-10-30. The Compiler lane is idle until Ersagun asks (token
saving, 2026-10-27).

| lane | thread | next, in order |
|---|---|---|
| E Editor | "Editor lane" | I76-I78, I80, I87, I88 (Ersagun's 20 more, 2026-10-31) |
| C Compiler and targets | "Compiler lane" | C30d (lists as two-ended arrays, waits on the Language lane's first/rest/push front), then C66 (Array on WASM, C and shaders), then I37 |
| L Language and library | "Language lane" | Clifford demo rows I95, I89, I92, I83, I93 done; idle until asked |
| T Testing | "Replace the slow browser smoke test" | I64, then the smoke's replacement |

## Inbox

New items land here until the next triage gives them a lane and a priority.

| id | item | source | added |
|---|---|---|---|
| I76 | On a page program, a helper's own Run sits below the 560 px page; when the open definition isn't main, fold or shrink the page | QA11 M2 | 2026-10-31 |
| I77 | A page's main still opens with empty canvas top-left (Tumble's first node 220 px right, 275 px down; pedal lower right); open on the first node | QA11 L1 | 2026-10-31 |
| I78 | `newton` opens with an empty Run; since #703 its function input could start from what main passes it (see I29) | QA11 L2 | 2026-10-31 |
| I79 | Where C65 (#724) can't work a clifford call out (the algebra isn't written down, I86; the evaluator), the call rebuilds the 64-line table every time; let the clifford functions take an algebra built once (table, reverse signs) | [CLIFFORD-DEMOS](docs/reports/CLIFFORD-DEMOS-2026-10-31.md) B1 | 2026-10-31 |
| I80 | A page has no frame event: a simulation steps from a handler, so Bounce and Tumble hide a CSS animation and step on `animationiteration`/`animationend`. Two examples write around it (P2 by the rule) | [CLIFFORD-DEMOS](docs/reports/CLIFFORD-DEMOS-2026-10-31.md) B2 | 2026-10-31 |
| I81 | Multivectors are written and read by position (`solid(0, 0, 0, 2, 0, 1, 0, 0)` for 2e₁₂ + e₁₃; Spacetime names all 16 parts to read one); give a way to write and read them by blade | [CLIFFORD-DEMOS](docs/reports/CLIFFORD-DEMOS-2026-10-31.md) B4 | 2026-10-31 |
| I82 | Changing one field of a record means writing all of them (Bounce's `Body` has 8; 4 places rebuild it) | [CLIFFORD-DEMOS](docs/reports/CLIFFORD-DEMOS-2026-10-31.md) B5 | 2026-10-31 |
| I84 | Bounce's `bump pairs` is inferred Diverge: it recurses on a list it gets back inside a Pair, which the checker can't see is shorter | [CLIFFORD-DEMOS](docs/reports/CLIFFORD-DEMOS-2026-10-31.md) B7 | 2026-10-31 |
| I85 | Bounce in the editor's program list (apps/bounce.html is built since the PR that added it); in the evaluator a solid-world frame takes about 375 ms (see I79, L41) | [CLIFFORD-DEMOS](docs/reports/CLIFFORD-DEMOS-2026-10-31.md) | 2026-10-31 |
| I87 | A page's `Event` has no pointer position: Constructions places and drags points through a grid of 576 transparent SVG squares | [CLIFFORD-DEMOS](docs/reports/CLIFFORD-DEMOS-2026-10-31.md) G1 | 2026-10-31 |
| I88 | A `part` can't sit inside an SVG (it is a `lab-part` HTML element), so a picture redraws whole; Constructions stacks two SVGs | [CLIFFORD-DEMOS](docs/reports/CLIFFORD-DEMOS-2026-10-31.md) G2 | 2026-10-31 |
| I90 | Constructions in the editor's program list (built into apps/ since the PR that added it) | [CLIFFORD-DEMOS](docs/reports/CLIFFORD-DEMOS-2026-10-31.md) | 2026-10-31 |
| I91 | relate needs ~6,400 steps to check one `clifford reflect` (over the agreement test's 5,000), so Constructions writes `mirror` inline instead of as a definition | [CLIFFORD-DEMOS](docs/reports/CLIFFORD-DEMOS-2026-10-31.md) G5 | 2026-10-31 |
| I94 | Spacetime in the editor's program list (built into apps/ since the PR that added it); its charge path takes about 8 s in the evaluator (I79) | [CLIFFORD-DEMOS](docs/reports/CLIFFORD-DEMOS-2026-10-31.md) | 2026-10-31 |

## E: Editor

### Bugs

| id | item | source | pri | size | status |
|---|---|---|---|---|---|

### Writing programs in the editor

| id | item | source | pri | size | status |
|---|---|---|---|---|---|
| I29 | 66 of 154 definitions open with an empty Run. Pictures run at their pixel (#578); left: Mandelbrot's helpers (called through a fold), derivatives, page parts, newton. **Counted 2026-10-30 (editor lane):** 57 still empty in converter, dice, calculus, Mandelbrot and pedal. Two causes, neither a quick fix: (a) the first call's inputs are functions (`newton(f, f′, x)`, `field(…, view, …)`), **done in #703**: a port's box takes a definition's name as its function, so newton's helpers now open filled; (b) the call is inside a page part that runs later (`property("value", view(read(q)))`, a handler, an audio block), which main's trace never enters. Running main in a dry world (files kept in memory, no network) gets past converter's file read but fills none of these | QA-2026-10-28 L4 | P2 | M | step 1 done |
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
| I37 | Compiled JS: a handler of an operation answered later written as a function of the computation (`at once(chain)`) makes plain callers `yield*` it, which esbuild refuses; `seeded` around such a call too. Tumble works round it. Also not compiled: a handler with a normal-finish case and an operation answered later (`notYet`) | examples/tumble | P2 | M | |
| C40 | Compiled JS for operations answered later (L54/L71): steps 1, 2a to 2d done (#571 to #573). Next: a search whose own definitions wait; then the world's `await(any of …)` as a promise, after L71 | LANGUAGE-NEEDS-2026-10-24 | P2 | M | step 2 done |

### Speed of compiled code

| id | item | source | pri | size | status |
|---|---|---|---|---|---|
| C66 | std's Array on the other targets (Ersagun 2026-10-31 "Yea"): every array builtin in compiler/src/builtins.ts is JS-only, so WASM, native C and shaders refuse Array. Bring the two-ended buffer views from #734 (a start and length on a buffer with room at both ends, a push writing into a free slot) to WASM and C, and to shaders where a fixed size fits | Ersagun | P1 | L | |
| C30 | Lists as arrays. Done so far: P4a, #555, #558, #561 (pedal 2.9×). The split, join and block-in-array stages pay only together (~25% more); do them as one stage when another program needs lists as arrays. The aim: an `array` representation written in the language (REPRESENTATIONS.md), so WASM, C and the editor get it too. C30d (2026-10-31): Ersagun's two-ended array list; JS runtime views done (C30d1), next the Language lane's `array first`/`array rest`/`push front` with `array of List`'s costs (cons, match constant; fold linear), then the chooser picking it from use | GAPS.md round 4 P4 | P2 | L | |
| C55 | Compile each direction of a relation a program uses as its own function (Mercury), dropping results no caller reads: `y` of `polar` alone is a plain sine, both together one sincos | Ersagun 2026-10-28 | P2 | M | |
| C62 | IN-PLACE.md step 1: `$own` copies for the cases of any type, so the trees' put, add and remove write along their path in place (GAPS.md M6). Built only if routes measures over 10% | docs/design/data/IN-PLACE.md | P2 | M | |
| C63 | IN-PLACE.md step 2: a hash table changed in place as a representation of Map and Set, where every value has one holder and keys hash as they're equal | docs/design/data/IN-PLACE.md | P2 | L | after C62 |
| C31 | A recursion that gives back a Pair returns its two fields without the record. 3% on the pedal | GAPS.md round 4 P5 | P3 | M | after C30 |
| C64 | Handlers the compiler can see: Pig's `quietly` and `hold at` sit right around `play`, yet every operation goes through `$perform`'s search; calling the case directly closes most of 310 ms vs 25 ms hand-written | examples/pig | P3 | M | |

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
| T7 | Tests in the language: accepted answers next to examples.json inputs, laws as definitions with a `Check` effect, cached by definition hash (Unison). Design note first. Unblocks L108d, L97e | TESTING.md T7 | P2 | L | |

### Numbers (NUMBERS.md)

| id | item | source | pri | size | status |
|---|---|---|---|---|---|
| L38 | One `+ − · −x <` for every number type: steps 1 to 4 done, now the std interfaces Arithmetic and Ordered (L40h). Open: a generic op made Int by a parameter's type alone (no Int literal) is still planned as Float64's equations, because the plan reads the code and not the types | LANGUAGE-REVIEW-2026-10-24 | P1 | S | open ends |
| L44 | Linear maps, geometry and matrices ([MATRICES.md](docs/design/numbers/MATRICES.md), Ersagun 2026-10-31): `Mat2` to `Mat4` done (L44a). Rotors, reflections, projections and PGA motions from the Clifford tables done (L44b); reading a function's matrix done (L44c, src/lang/linear.ts). Next: the compiler stores linear functions as matrices (C lane, C30b/c); then a linear-algebra library for any size | LANGUAGE-REVIEW-2026-10-24 | P1 | M | steps 1-2 done |
| L42 | `Cl(p, q, r)`: `clifford table` done (L42a). Next: a PGA motor in the ray marcher, after L41 | NUMBERS.md stage 4 | P1 | M | step 1 done |
| L43 | Rotors done (L43a: quaternions as the even part of `Cl(3, 0)`). Next: grade inference on the units machinery (Bounce passes vectors, spins and rotors as one 8-part type) | NUMBERS.md stage 4, [CLIFFORD-DEMOS](docs/reports/CLIFFORD-DEMOS-2026-10-31.md) B3 | P1 | L | rotors done |
| L41 | Table products expanded at compile time, zero terms dropped (with lane C). Measured in Bounce: a Cl(3, 0) product is 0.10 ms compiled, about 200 times a hand-written one | LANGUAGE-REVIEW-2026-10-24, [CLIFFORD-DEMOS](docs/reports/CLIFFORD-DEMOS-2026-10-31.md) B1 | P1 | M | |
| L51 | Tensors as the general algebra (NUMBERS.md stage 6) | NUMBERS.md stage 6 | P1 | L | after C30 |
| L97 | `polar` as the relation behind Trig (POLAR.md): L97a to L97c4 done (Trig's polar, unpolar, asin, acos; polar given x, y answered by unpolar). Next: L97d Fixed's CORDIC; L97e complex laws after T7 | Ersagun 2026-10-28 | P2 | M | 3 of 5 steps, step 3 finished |
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
| L69 | Foreign definitions: a typed declaration with its row and a body per target (Gleam's `@external`, Elm's ports) | LANGUAGE-NEEDS §5 | P2 | M | |
| L62 | Branches with no world effects marked pure by a row constraint, so the runtime may run them on another core | LANGUAGE-NEEDS Part 1 | P3 | S | after L71 |
| L64 | Scoped channels (`Channel a`, `send`, `receive`), when a program needs a pipeline | LANGUAGE-NEEDS Part 1 | P3 | M | |

### Relations and totality (BACKWARDS.md, MODES.md)

| id | item | source | pri | size | status |
|---|---|---|---|---|---|
| L46 | Bounded counting is total (an Int moving towards its bound), so raymarch loses `with fuel` | LANGUAGE-REVIEW §7 | P2 | M | |

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
