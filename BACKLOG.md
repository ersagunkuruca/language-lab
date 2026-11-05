# Backlog

Every open item from every source (Ersagun's asks, reviews, QA passes,
bigger-program rounds, design notes), in one place. Finished items are in
[DONE.md](docs/process/DONE.md). How items are picked and run is in
[WORKFLOW.md](docs/process/WORKFLOW.md); every doc is listed in [the docs index](docs/README.md).

Each lane's items are grouped by theme. Within a lane, priority (P1 first)
decides what's next, and "Next up" below names it in a line: what's next,
never what's done (that goes to DONE.md).

**Priority:** P0 broken now · P1 blocks the current step or Ersagun asked ·
P2 next steps · P3 nice to have. Within a priority: bugs, then removing a
special case, then what lets programs be written in the editor, then
language, then more targets or speed (WORKFLOW.md "Priority").
**Size:** S hours · M one PR · L several PRs or a design note first.
**Status:** ▶ running · ⏸ held · blank = waiting.

## Next up

| lane | thread | next, in order |
|---|---|---|
| E Editor | "Editor lane" | E237 (after L204), E103 (after infer.ts's idea) |
| C Compiler and targets | "Compiler lane" | C137 (retiring compile.ts); then C30, C93 |
| L Language and library | "Language lane" | next by priority from the table below |
| T Testing | "Replace the slow browser smoke test" | I64, then the smoke's replacement |

## Inbox

New items land here until the next triage gives them a lane and a priority.

| id | item | source | added |
|---|---|---|---|
| I167 | + New definition freezes the editor. Example: Create of `extra(x)` on Insertion sort; done when it runs in tasks of at most 0.1 s. Left: the edit's own task, about 0.23 s in node (the check, the inspector and the Run panel). Was 1.3 to 1.8 s; what took it down is in DONE.md (I167b to I167l) | QA 11-04 L1 | 2026-11-04 |

## E: Editor

### Bugs

| id | item | source | pri | size | status |
|---|---|---|---|---|---|

### Foundations ([FOUNDATIONS-2026-11-03](docs/reports/reviews/FOUNDATIONS-2026-11-03.md))

| id | item | source | pri | size | status |
|---|---|---|---|---|---|

### Writing programs in the editor

| id | item | source | pri | size | status |
|---|---|---|---|---|---|

### Speed of editing

| id | item | source | pri | size | status |
|---|---|---|---|---|---|
| E103 | **Bug.** Adding a value in a definition run backwards is slow (five stages and E133, E103c to e and L226 so far, DONE.md). Example: physics `fall`'s holes, 72 s for all 23 and the worst 18 s (2026-11-05); done when the worst takes under a second. Left: the plans compared per offer (solveMode, about 4 ms each, 2,019 for one hole with 7 distinct answers) and the checks of the group. Next idea: where only a plan changes, check the solves' verdicts instead of a whole inference (reusing a verdict across callees needs a fingerprint of the callee's modes, not cheap and sound yet) | E100 | P3 | M | |

### Blind spots ([BLIND-SPOTS-2026-11-03](docs/reports/reviews/BLIND-SPOTS-2026-11-03.md))

| id | item | source | pri | size | status |
|---|---|---|---|---|---|

### What a good language needs ([ASPECTS-2026-11-03](docs/reports/reviews/ASPECTS-2026-11-03.md))

| id | item | source | pri | size | status |
|---|---|---|---|---|---|

### Plain words for newcomers ([OUTSIDER-READ-2026-11-03](docs/reports/reviews/OUTSIDER-READ-2026-11-03.md))

Rewrite only what the outside reader marked; the next outsider read checks it.

| id | item | source | pri | size | status |
|---|---|---|---|---|---|

## C: Compiler and targets

New targets and speed rank below every language item (Ersagun,
2026-10-24 07:01). Measurements and rounds: docs/reports/GAPS.md.

### Foundations ([FOUNDATIONS-2026-11-03](docs/reports/reviews/FOUNDATIONS-2026-11-03.md), in fix order)

| id | item | source | pri | size | status |
|---|---|---|---|---|---|
| C137 | Retire compile.ts (Ersagun 2026-11-05: frozen from now, no feature or parity PRs; the row is done when the file is gone). compile.ts (3,435 lines) lowers JavaScript straight from the model, beside the core IR every other target shares, so each feature was built twice. Every example's main lowers on the core IR (C137 s5), so nothing needs the evaluator in its place. What got the core IR this far is in DONE.md (C137 a to d, s1 to s5). Steps: (r1) done: a test helper giving a program's compiled definitions by name through the core IR (core-js.ts compiledDefs, plainValue for the evaluator's values), as compile.ts's module gave them, with complex.test.ts on it; tests that compare compile.ts with the core IR keep the core IR alone; (r2 to r5) the 78 ters/test files that import compile.ts moved to it, about 20 a step: r2 done, 24 files with complex.test.ts; tried and kept on compile.ts for now, since the core IR refuses or differs there: algebraic (shows Algebraic), cell-paths (a cell holding a Bool), directions (main not compiled), dual and order (data compared as the core IR's classes: plainValue), fixed, real and ways (a Trig or generic operation left to its ways), generic-implementations (Duo's multiply passed on), handler-finish (a handler's normal finish, L57), item-where and key-paths (path on cells), json-by-type (bytes of base64 not in the program), maps (set union passed on), outcome (a value not Float64, Int or Text); r3 done, 17 files that print; kept back: branch-effects and later (a handler's normal finish, L57; a wait inside all; yield), one-divide (Rational has no Division there), set-through (a field set not in place), state (a function with effects passed), text-ordered (an overflow the evaluator doesn't have); (r6, r7) the 29 compiler/test files; (r8) compiler/gaps' `compiled` ways and compiler/bench.ts go (core, stored and ideal stay), and program.ts's compile.ts use; (r9) ters/cli: `lab compile`, `build-web`, `build-app` and `render --compiled` without `--compile-ts` (a sound whose solves run the evaluator's solver plays on the core IR too), sound.ts and web.ts on the core IR, page.ts's fallback; (r10, with the Editor lane) editor/pageCompile.ts and runWorker.ts on the core IR only; (r11) compile.ts, runtime.js, page-runtime.ts and audio-worklet.ts deleted, with compile.test.ts | [FOUNDATIONS-2026-11-03](docs/reports/reviews/FOUNDATIONS-2026-11-03.md) §2 | P1 | L | |
| C139 | Library types out of the core passes: id tests on library constructors and functions (compile.ts 188, scalar.ts 152, run.ts 82) become representations or builtin records, retired with C137's printer. Done: std's number types show through the prelude's own Shown on every target, as in the evaluator, not cases of Rational and Complex named in scalar.ts, so Fixed shows on WebAssembly and C too (C139a); compare and sort through a type's Ordered on the core IR's targets, Rational's included, not a case of it named in scalar.ts (C139b; a program's own Ordered was ignored there before). Next: Extended's and the algebras' show (no Shown yet) | [FOUNDATIONS-2026-11-03](docs/reports/reviews/FOUNDATIONS-2026-11-03.md) §7 | P3 | M | |

### Bugs and gaps found by programs

| id | item | source | pri | size | status |
|---|---|---|---|---|---|

### Speed of compiled code

| id | item | source | pri | size | status |
|---|---|---|---|---|---|
| C175 | Tidy the scalar printer's output (WGSL, and the core IR's other printers where they share it). Measured on raymarch's WGSL (511 lines): 24 `let a = b` copies; negations not folded (`-(-x)`, `a + (-(b))`); `sin(0.7 · t)` computed 20 times because the gradient re-evaluates the halo motor once per axis (share what the gradient's copies have in common); a 16-part `Pga_2` built where `place of` reads 3 parts; and the motor, which depends only on time, worked out per pixel (compute it once per frame, as a uniform or hoisted value). The GPU's compiler hides some of this; the per-pixel motor is real time | Ersagun 2026-11-05 12:38 (Learn thread: the ray marcher) | P2 | M | |
| C93 | Lists read and written by position stay cons lists (primes 20000 compiled 47.9 s against 43 ms ideal); steps 1 to 3, (c) and s1 to s3b done (DONE.md). Example: machine's primes 20000 on JavaScript, aim 0.11 s (155 ms now on the core IR, split lists); done when it gets there. Left: (s4) that, and a cost for the split against the trees. WebAssembly and C keep trees until arrays are replaced in place there (C56) | [GAPS round 9](docs/reports/GAPS.md#round-9-machine-an-assembler-and-interpreter-on-every-target-2026-11-02) M1 | P3 | L | |
| C30 | Lists as arrays, chosen from use (REPRESENTATIONS.md); the JavaScript stages, Ersagun's two-ended arrays on every target, and s1 to s2c2 done (DONE.md). Example: chapters' word count stored as arrays on WebAssembly and C as on JavaScript (s3); done when it runs there no slower than its cons lists. Beyond it, a row if it earns one: block-in-array (s4), measured first | GAPS.md round 4 P4 | P2 | L | |

### Memory and layout (STABLE-REFERENCES.md §3 to §6)

All invisible to programs: no annotations or hints (Ersagun 2026-10-29).

| id | item | source | pri | size | status |
|---|---|---|---|---|---|
| C56 | "Owned, in place" as a representation chosen when a value has one holder, generalising `$own` and C30 to records, maps and cell contents; reference counts (Perceus) where the compiler can't tell. Steps are C62, C63 | STABLE-REFERENCES.md §3 | P3 | L | |
| C57 | A region per scope: temporaries of one page update, audio block or frame freed at once (Tofte–Talpin) | STABLE-REFERENCES.md §4 | P3 | L | |
| C58 | Keyed collections as a grow-only array with a free list and generational keys (ECS) | STABLE-REFERENCES.md §4 | P3 | M | |
| C59 | Flat inline layout for data built once and read, doubling as a file format (FlatBuffers). Measured on notebook after C71/C72 (GAPS.md round 6, N3: about 10% left for it there, 4.4× the ideal with no one hotspot): its index is built once with one holder (8.5× the ideal on trees) and then only read by every question (8×); a frozen map as sorted key and value arrays makes `entries of` free and `value at` a binary search | STABLE-REFERENCES.md §4, GAPS.md round 6 N3 | P3 | M | after C70, C71 |
| C60 | **Later goal**: a list of records stored as columns when its loops read few fields | STABLE-REFERENCES.md §5 | P3 | L | |
| C61 | **Later goal**: where code runs chosen by cost, never written (workers, GPU compute, main thread). First step: read Bend 2 and write the design note | STABLE-REFERENCES.md §6 | P3 | L | |

### Parallel and concurrent code on the targets

| id | item | source | pri | size | status |
|---|---|---|---|---|---|
| C41 | Pure `together` branches on worker_threads / Web Workers past a cost threshold | LANGUAGE-NEEDS-2026-10-24 | P3 | M | after L62 |
| C42 | Data-parallel `map` and associative folds on a thread pool, later as compute shaders (NESL, Futhark) | LANGUAGE-NEEDS-2026-10-24 | P3 | L | after C30 |
| C43 | Or-parallel `all`/`count` and speculative `first` in canonical order, with work stealing (Cilk, Aurora/Muse) | LANGUAGE-NEEDS-2026-10-24 | P3 | L | after C41 |
| C44 | Fibers in native C (own stacks, an event loop) and in WASM (JSPI) | LANGUAGE-NEEDS-2026-10-24 | P3 | L | after C40 |

### Blind spots ([BLIND-SPOTS-2026-11-03](docs/reports/reviews/BLIND-SPOTS-2026-11-03.md))

| id | item | source | pri | size | status |
|---|---|---|---|---|---|

### The spec ([SPEC](docs/language/SPEC.md) §12)

| id | item | source | pri | size | status |
|---|---|---|---|---|---|

### What a good language needs ([ASPECTS-2026-11-03b](docs/reports/reviews/ASPECTS-2026-11-03b.md))

| id | item | source | pri | size | status |
|---|---|---|---|---|---|

### Compiled output without names or unneeded machinery ([DEBUG-AND-SPEED-2026-11-04](docs/design/targets/DEBUG-AND-SPEED-2026-11-04.md))

| id | item | source | pri | size | status |
|---|---|---|---|---|---|

## L: Language and library

Numbers first (Ersagun, 2026-10-24 07:01), then the rest of
LANGUAGE-REVIEW-2026-10-24. Anything that only adds a target ranks below
all of these.

### Foundations ([FOUNDATIONS-2026-11-03](docs/reports/reviews/FOUNDATIONS-2026-11-03.md), in fix order)

| id | item | source | pri | size | status |
|---|---|---|---|---|---|
| L182 | Flags as hidden kinds: new attributes go through the schema (a), `def.results`, a field's `results` and `def.direction` gone (b, c1, c2; DONE.md). Example: `field.ports` gone, a field's port names read from its own type (c3); done when it is. Waits for function types' parameters to have names, since directions pair fields by them (L182c3 in DONE) | [FOUNDATIONS-2026-11-03](docs/reports/reviews/FOUNDATIONS-2026-11-03.md) §8 | P3 | M | |

### Bugs and gaps found by programs

| id | item | source | pri | size | status |
|---|---|---|---|---|---|

### Ersagun's current asks

| id | item | source | pri | size | status |
|---|---|---|---|---|---|
| L107 | **Open question, not decided** (Ersagun 2026-10-30: "I didn't ask to lift strict positivity BTW, I'm not sure if we should lift that"): drop strict positivity, so a data type may take itself as a function's input in its fields (`knot = wrap(f: knot → Float64)`), with taking one apart carrying Diverge so a function without Diverge still always finishes. Recursive data types themselves (a type holding itself, directly or through others) are allowed and always were; TUTORIAL.md §3.8 says so. If decided yes: LANGUAGE.md "Two rules", TUTORIAL.md §3.8 and the guarantees test | Ersagun 2026-10-30 | P3 | S | open question |
| T7 | Tests in the language ([TESTS-IN-THE-LANGUAGE.md](docs/design/testing/TESTS-IN-THE-LANGUAGE.md)); T7a to T7e14 and T7e16 done (DONE.md). Example: examples-agree.test.ts's sweep runs through `lab test --compiled` for every example with a main; done when it does. Left: (e15) lockstep's main as an accepted answer (`lab run` won't run its main from the command line); the pages, whose mains print nothing, stay on its three-way comparison. Beyond the example, its own rows if they earn them: CI's cache of results by hash (T7c) | TESTING.md T7 | P2 | L | design, T7a and T7b done |

### Numbers (NUMBERS.md)

| id | item | source | pri | size | status |
|---|---|---|---|---|---|
| L230 | `clifford algebra` takes its basis from the multivector record type: one value per field, each with a 1 in its own place, in field order. A program then gives only the signature (`[1, 1, 1, 0]`), and raymarch's 16-line `pga basis` goes; the basis is already used only while compiling (stage.ts, C65) | Ersagun 2026-11-05 12:38 (Learn thread: the ray marcher) | P3 | S | |
| L206 | The evaluator's speed without jets by hash: stage known-data calls in the evaluator (stage.ts) or let a library declare its host implementation beside the definition; retire jets.ts's list. Measured by L202. Steps of about an hour (2026-11-05): (a) measured, not built (L206a in DONE): staging in the evaluator is 6.3× faster than the plain fold on Spacetime's path but staging the program takes 5.3 s and the staged run is still 2.8× the jet's; (b) the library declares a host way for a pure definition beside its other host answers (hosts.ts, as L69's `hosts/js.js`, by the definition's name), checked against the definition by its own test, and run.ts's JETS list goes; (c) the prelude's `table product` moved onto (b). | [MATHEMATICS-AS-LIBRARIES](docs/design/numbers/MATHEMATICS-AS-LIBRARIES-2026-11-03.md) | P3 | M | |
| L207 | The number types leave std.ts for a published `numbers` module written in the language (Rational, Complex, Dual, Fixed, Mat2 to Mat4, Matrix, Algebra, Table entry, Trig, Extended), ids kept for saved programs (L184). After L204 and L205. Algebraic stays host code, registered by the module | [MATHEMATICS-AS-LIBRARIES](docs/design/numbers/MATHEMATICS-AS-LIBRARIES-2026-11-03.md) | P3 | L | |
| L209 | Values stored in the smallest structure they stay in, chosen by the compiler through embeddings: a Complex with no imaginary part as a Float64, a multivector that stays a rotor as a quaternion. Generalizes L203's grade masks; std's own tables (Complex, Dual, the matrices) could get masks the way a program's own table does (L203f left them out, as it changes their compiled code widely). L208 is done; its step f is this row's first: the compiler keeps a value that stays in an embedding's image as the small type (EMBEDDINGS.md L208f, C lane, after L43c). Showing an inserted embedding in the editor is asked of Ersagun first | [MATHEMATICS-AS-LIBRARIES](docs/design/numbers/MATHEMATICS-AS-LIBRARIES-2026-11-03.md) | P3 | L | |
| L44 | Linear maps, geometry and matrices ([MATRICES.md](docs/design/numbers/MATRICES.md), Ersagun 2026-10-31): `Mat2` to `Mat4` done (L44a). Rotors, reflections, projections and PGA motions from the Clifford tables done (L44b); reading a function's matrix done (L44c, src/lang/linear.ts). A `Matrix a` of any size with products, sums and `solved` done (L44d); `determinant` and `inverted` done (L44e); `least squares` done (L44f). Next: the compiler stores linear functions as matrices (C lane, C30b/c); LU kept for many right-hand sides done (L44g: `factored` and `solved with`) | LANGUAGE-REVIEW-2026-10-24 | P1 | M | steps 1-3 started |
| L43 | Grades as types ([GRADES.md](docs/design/numbers/GRADES.md)): rotors, blade masks, mask tables, staging by mask, the editor's mask names and masks as types done (L43a to L43e3, DONE.md). Example: Bounce, which passes vectors, spins and rotors as one 8-part type; done when it stores only each value's masked parts in compiled JS and WGSL (L43c, with the copies staging makes). Beyond it, a row if it earns one: the editor naming an input's mask in its type (L43e) | NUMBERS.md stage 4, [CLIFFORD-DEMOS](docs/reports/CLIFFORD-DEMOS-2026-10-31.md) B3 | P1 | L | rotors and masks done |
| L118c | The evaluator compiles each definition to JavaScript closures once (closure compilation, Feeley and Lapalme 1987), keeping the heap continuation only where a search or a handler needs it; likely 3-10x on all interpreted code; notebook's Run takes 3.2 s for 100 notes, half of it the evaluator's own machine (GAPS.md round 6 N6) ([EVALUATOR-SPEED-2026-10-31.md](docs/reports/EVALUATOR-SPEED-2026-10-31.md) step 2). For later: Ersagun stopped L118 after step 2 | Ersagun 2026-10-31 | P3 | L | for later |
| L88 | Exact reals (EXACT-REALS.md): `Algebraic` done (L88a to L88d, √2·√2 is the Int 2). Next: step 4, `Real` as lazy intervals, when a program needs π exactly. Step e1 done: `Real` in std, made of fractions by + − ·, `approximate(x, p)` within 2⁻ᵖ (real.ts). Step e2 done: `real pi()` by Machin's formula and `real digits(x, n)`, rounded within one in the last place. Step e3 done: `real less than(a, b, fuel)` narrows both until they come apart, no answer (Choice) within 2⁻ᶠᵘᵉˡ. Step e4 done: `real exp` and `real log` (real.ts, e and ln 2 to sixty decimals). Step e5 done: `real sin` and `real cos`. Left of step 4: the one < at Real with Diverge instead of fuel (EXACT-REALS.md), when a program asks. | Ersagun 2026-10-26 | P2 | L | 3 of 4 steps |

### Data and representations (DATA-STRUCTURES.md, REPRESENTATIONS.md)

| id | item | source | pri | size | status |
|---|---|---|---|---|---|
| L212 | A hash array mapped trie for Map and Set, and RRB vectors (32-wide) for `tree of List`, as further representations ([DATA-STRUCTURES.md](docs/design/data/DATA-STRUCTURES.md) "Later representations"): only when a program measures the need, as C63's hash tables did. Credit Bagwell (HAMT, 2001) and Bagwell and Rompf (RRB, 2012), prior art | L61's rest | P3 | M | |
| L98 | A cell owns its value and a write is an edit at a path (STABLE-REFERENCES.md §1): positions done (L98a), keys done (L98b, `key path`). Next: the in-place store is C56's representation | Ersagun 2026-10-29 | P2 | L | steps 1, 2 done |
| L101 | **Later goal**: multithreading where uniqueness allows it (rayon), effect rows deciding what runs side by side (§5) | Ersagun 2026-10-29 | P3 | L | |
| L21 | Folds: a `build` row for user producers, folds with `Choice` asking the table | ROADMAP 5 | P3 | L | |

### Effects and concurrency (ANSWERED-LATER.md, EFFECTS-REVIEW-2026-10-24)

| id | item | source | pri | size | status |
|---|---|---|---|---|---|
| L69 | Foreign definitions ([FOREIGN.md](docs/design/targets/FOREIGN.md)): a program's own effect answered by a host file per target. L69a `hosts/js.js` in the evaluator and compiled JS, results checked at the border, `lab hosts` skeleton (L, M): done (evaluator; compiled JS, L69a2; a page's build-web and build-app, L69a3; asking a host from a page's view or handler is refused, as only the page's effects are allowed there); L69b C and WebAssembly (C, M): done (L69b1 `hosts/c.c` in `lab native`, L69b2 WebAssembly's imports from `hosts/js.js`); L69c the editor's "needs its host" (E, S), done (#860); L69d optional, std's world operations as host files (L, M). Asks Ersagun: may a foreign operation be declared pure | LANGUAGE-NEEDS §5 | P2 | M | design done |

### Relations and totality (BACKWARDS.md, MODES.md)

| id | item | source | pri | size | status |
|---|---|---|---|---|---|

### Grammars, modules and sharing

| id | item | source | pri | size | status |
|---|---|---|---|---|---|
| L72 | JSON as one relation: `json spelled` gives every spelling, `json read` is it run backwards (a to f done, DONE.md). Example: `json printed` is `json spelled`'s first on every target (e1d); done when it is. It waits for the core IR to run a `first` of a Choice without nesting the rest in it: 300 records run out of stack now, though the evaluator prints them in 0.29 s. Beyond it, rows if they earn them: json read's message saying where it stopped (f3), `json printed indented` as a variant (e4) | Ersagun 2026-10-24 | P3 | L | low priority |
| L17 | Data-type upgrades (migrations when constructors and fields move); path namespaces are a name layer (SHARING.md §5) | ROADMAP 5 | P3 | L | |
| L109 | Hashes carry a recipe version; std published with lineages and versions, so a std change adds versions and keeps the old (no more #709-style republishing) | SHARING.md §3 | P3 | M | |
| L110 | Publishing keeps the draft id as the lineage id; refs hold lineage and exact version; `replaces` derived from the lineage | SHARING.md §1, §2 | P3 | M | after L109 |
| L111 | Upgrades by pin generality (new pin at least as general), moved by the editor with a note; Bob's tests must pass once T7 exists | SHARING.md §2 | P3 | M | after L110 |
| L112 | Names pinned per program; one question per upgrade for the author's renames; the program's own renames win | SHARING.md §5 | P3 | M | after L110 |
| L115 | Project store: every published node the project used, kept by hash with it by default; runs when a source is gone; downgrade to any kept version (Ersagun 2026-10-31) | SHARING.md §4b | P3 | M | after L110 |
| L114 | Lineage logs: signed, append-only, "current" and "broken" entries; code fetched by hash from any host; a browser over logs (was L68) | SHARING.md §4 | P3 | L | after L111 |

### Physics and planning ([PHYSICS-AND-PLANNING.md](docs/design/physics/PHYSICS-AND-PLANNING.md), later goals)

Ersagun 2026-11-01: fast bodies passing through each other, and A* for an
agent with inertia. All later goals.

| id | item | source | pri | size | status |
|---|---|---|---|---|---|
| L120 | **Later goal**: time of impact for rotating shapes along a PGA motor (screw motion) by conservative advancement (Mirtich); the compiler choosing it or the closed form by cost (WAYS.md) | Ersagun 2026-11-01 | P3 | L | shapes other than balls |
| L122 | **Later goal**: an agent with inertia, decoupled: navigation-mesh A* (from routes' frontier), the funnel, corners as arcs, the time-optimal speed profile (forward and backward pass), a follower; one page, a hand-made mesh | Ersagun 2026-11-01 | P3 | L | |
| L123 | **Later goal**: the coupled search: Hybrid A*-style over position and velocity, motion primitives exact under linear drag, L122's path length / top speed as the heuristic; compared with L122 on the same map | Ersagun 2026-11-01 | P3 | L | after L122 |
| L124 | **Later goal**: a rapidity speed cap (velocity as a boost in Cl(2, 1)) beside linear drag on L122's page; optional | Ersagun 2026-11-01 | P3 | M | after L122 |

### Someday

| id | item | source | pri | size | status |
|---|---|---|---|---|---|
| L22 | Profiles inferred like effects and shown in the editor ("runs on the GPU"). L22a done: a definition's panel shows where it runs, from the lowering's refusals. Left: the profile inferred in the type, as an effect is, so a caller is told without lowering | REVIEW-2026-10-22b §5 | P3 | L | |
| L24 | Research as it becomes blocking: costs from folds, laws proved by fusion, fast invertible parsing | ROADMAP 8 | P3 | L | |

### Blind spots ([BLIND-SPOTS-2026-11-03](docs/reports/reviews/BLIND-SPOTS-2026-11-03.md))

| id | item | source | pri | size | status |
|---|---|---|---|---|---|
| L214 | Text on every target ([TEXT-2026-11-03.md](docs/design/data/TEXT-2026-11-03.md)); a to e5b4 done (DONE.md): case, graphemes and collation on C and WebAssembly from the library's own tables, with collation tailorings for 30 languages. Example: a program sorting Swedish words with `collate` gives the host's order on WebAssembly; done when it does. Left: (e5b2c) sv, and with it fi, nb, is and others, differ on rare letters, for two causes in collation-tables.ts's build (L214e5b2c in DONE: marks sorted after an `a`, which Swedish makes ä; a letter with two accents whose first makes a letter). Beyond it, rows if they earn them: Greek's ϗ, letters that sort as one in more languages, Han orders | L185, BLIND-SPOTS-2026-11-03 §4 | P3 | M | a to d done |
| L187 | Error messages as one table with a smallest program per problem (src/lang/problems.ts); L187a to L187ae done, 86 problems (DONE.md). Example: every message a program meets in the editor has its row; the err( sites left are internal (extern, a node kind that isn't an expression) or need field ports (POLAR), so this row is done when nothing else is met, and a new message is a new row | [BLIND-SPOTS-2026-11-03](docs/reports/reviews/BLIND-SPOTS-2026-11-03.md) §8 | P3 | M | Editor lane |

### What a good language needs ([ASPECTS-2026-11-03](docs/reports/reviews/ASPECTS-2026-11-03.md))

| id | item | source | pri | size | status |
|---|---|---|---|---|---|

### Plain words for newcomers ([OUTSIDER-READ-2026-11-03](docs/reports/reviews/OUTSIDER-READ-2026-11-03.md))

| id | item | source | pri | size | status |
|---|---|---|---|---|---|

### The spec ([SPEC](docs/language/SPEC.md) §12)

| id | item | source | pri | size | status |
|---|---|---|---|---|---|

## T: Testing and fast feedback

The thread that owns `.github/workflows` and the browser checks. Plan:
docs/process/TESTING.md. T7 is in lane L.

| id | item | source | pri | size | status |
|---|---|---|---|---|---|
| T14 | The slowest single tests (steps a to m done, DONE.md). Example: editing.test.ts's swapAndUndo, 20 s now; done at 5 s. Left: the graph's wire values running fall backwards after each pick (editor/main.ts traceInputs), about 4 s of it resolving arith.ts for each version's search. Beyond it, a row each if they earn one: the next slowest file (simplifyAppend 13.8 s, listItems 12.0 s, implementInterface 10.5 s), measured by stage | [TEST-SPEED-2026-11-03](docs/reports/TEST-SPEED-2026-11-03.md) | P3 | M | |

## Coordinator and process

Not lane work; the coordinator does these or asks Ersagun.

| id | item | source | pri | status |
|---|---|---|---|---|
| P2 | Batch deploys if Actions cost needs it | Ersagun 2026-10-23 | P3 | asked, not requested |
| P3 | A per-repo Actions budget, or a public repo for free Actions | thread "GitHub Actions cost" | P3 | Ersagun's call |
| P7 | A foundation row every fourth item in each lane; the weekly review tracks kind tests across the code (2,805), tests reached by a one-line text.ts edit (145/150 + 44/44) and readers of a kind's fields | [FOUNDATIONS-2026-11-03](docs/reports/reviews/FOUNDATIONS-2026-11-03.md) §10 | P2 | |
| P8 | Add a LICENSE (and say what examples and programs written in Ters carry) once Ersagun picks one | [BLIND-SPOTS-2026-11-03](docs/reports/reviews/BLIND-SPOTS-2026-11-03.md) §3 | P1 | Ersagun's call |
