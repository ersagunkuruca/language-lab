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
| E103 | **Bug.** Adding a value in a definition run backwards (physics `fall`) takes about 4 s; five stages (#478 to #504) took fall's holes from 48 s to 18.5 s in all. Stopped by the 10% rule. **Measured again 2026-11-01:** 23 holes 121 s, the worst 22 s, of which the plan comparison per offer 5.7 s and whole checks for offers whose plan changed 10.4 s; E133a took the node copies off (→ 18 s); E133b took the analyzer's full scan per offer off (worst 12.7 s, all 23 holes 67 s); E103c (#898) checks once for every offer that makes the same of the group's types and plans, each offer's units on their own (fall's 23 holes 80 → 47 s, the worst 16 → 8 s, measured on a busy machine; same offers); E103d (#902): a filled program's solves and calls are listed from the program's, not by scanning its ~10,000 nodes in `useDirections` and the jobs check (all 23 holes 50 → 30 s, the worst 10.6 → 4.2 s; same offers); E103e (#938): an offer's units are checked once, not again inside its whole check (23 holes 30 → 23 s, the worst 4.2 → 3.7 s); **measured again 2026-11-01 21:40** (busy machine, all 23 holes ~31 s): the plans compared per candidate 8.2 s (7,452 plans, ~1.1 ms each), the type-group checks 10 s (2,229 distinct groups, ~4.5 ms each: an offer of another shape makes fall's own type another shape, so few share), the whole checks of risky offers 7.7 s (400, ~19 ms each; checking their units apart buys nothing). Stopped by the 10% rule: the next stage needs a new idea, such as checking a group's callers against its new type instead of a whole inference, or a plan that can tell from the filling alone that it can't change; what's left is the checks' own work. **Measured again 2026-11-02** (all 23 holes 29.7 s, the worst 5.2 s, fall's whole body): that hole asks 1,221 plan comparisons and 645 distinct type-and-plan checks for 113 offers kept, because a changed plan is part of the check's key and most candidates change it a little. **Measured again 2026-11-04** after E248 and E250 (L211e and the steady module had made it slower): fall's 17 holes 64 s, the whole body's hole 9 s after the first; what's left is the checks' own work (inference of the group, 7 of 9 s). **Measured again 2026-11-05:** fall's 23 holes 127 s, the worst 32 s: each check of a filling scanned every node of the program and the library for the uses that close an input's row (infer.ts closingUse, 11 s of the worst hole); L226 (#1647) scans only the group being checked (23 holes 127 → 72 s, the worst 32 → 18 s, the same offers). What's left: the plans compared per offer (solveMode, ~4 ms each, 2,019 for one hole with 7 distinct answers) and the checks of the group. A plan per builtin class (modes.ts builtinGoal gives most builtins one forward way) would save under 10%: 318 of a hole's 2,019 plans are builtins', 1,187 definitions'. The next idea: where only a plan changes, check the solves' verdicts instead of a whole inference. Hole 0 again (17.8 s): 948 call fillings each analyse fall's one solve afresh (7.5 s; the analyzer is per Code, and fall's own lambda is not kept as a published one is), for 5 distinct verdicts. Reusing a verdict across callees needs a fingerprint of the callee's modes in every known set and its size-change graphs, none cheap and sound yet | E100 | P3 | M | |

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
| C30 | Lists as arrays. Done so far: P4a, #555, #558, #561 (pedal 2.9×). The split, join and block-in-array stages pay only together (~25% more); do them as one stage when another program needs lists as arrays. The aim: an `array` representation written in the language (REPRESENTATIONS.md), so WASM, C and the editor get it too. C30d (2026-10-31): Ersagun's two-ended array list; JS runtime views (C30d1, #734), the ends and `array of List` (#737), the ends in WebAssembly and C (C30d2, #754), the evaluator's arrays on the same buffer (C30d3a, #762; Ersagun chose "everywhere" 2026-10-31), the preview's chooser picking `array of List` from use (C30d3b), and the compiled targets taking the same choice (C30d3c: WebAssembly and C lower `first of array if any`). Next: the split, join and block-in-array stages, when a program needs them Steps, about an hour each (2026-11-05): (s1) done, measured by hand (2026-11-05, 3,000 chapters): chapters' word count (`split` by space, keep the non-empty, count) written over the array `split` gives takes the core IR's run from 213 to 150 ms and 252 to 166 (about 30%), while the same count kept on the cons list with its filter as a plain loop gains only about 5%, so the gain is the list being an array; (s2) done another way: `lab compile chapters` already stores its lists as `array of List`, and that ran 4.8× its cons-list time on the core IR (1,143 against 239 ms; gaps/chapters.ts measures the program as written, not as `lab compile` stores it), because the array's fold made a cons list of its items on every call; it now walks the array by position (scalar.ts arrayItems) and reads each item without a BigInt (core-rt.ts array.get), 1,143 to 710 ms; (s2b) done for the rest: on the core IR's JavaScript the rest an array's fold hands its arm is a view of the array from that item (scalar.ts restAsView, core-rt.ts array.from), chapters 710 to 545 ms; left (s2c): the 2.3× still against cons lists (239 ms) is the pair and the arm's closure call per item and the views made, and the chooser counting both folds as linear, so it picks arrays for chapters where cons lists are faster. Measured by hand (2026-11-05): the views are about a fifth of it (chapters stored, 525 to 405 ms with `array.from` made to give nothing, the same output), since no arm of chapters' folds reads its rest; but the arm is a closure the library's fold helper is given (core IR f19 to f20), so whether it reads the rest is known only where the helper is called. So (s2c1) done: a definition given a function written in place gets a copy specialized to it, its call direct, and a loop's record field handed only to an input nothing reads carried as it was (compiler/src/closure-args.ts, core IR's JavaScript): chapters stored as arrays 507-541 to 326-349 ms, against 239 on cons lists; (s2c2) started: `split` gives its pieces as a list read from the array it made (std.ts, ItemsList), so `array of` copies them once instead of walking cons cells: chapters stored as arrays 307-366 to 262-282 ms (cons lists 215); done (2026-11-05, Ersagun's yes): the chooser's pick of arrays for chapters, which `length` made (1 on an array, n on a cons list, weighed once per line in `words`): a priced function of one list at most linear, given a list a call or a let has just made, costs no more steps than making it, so it isn't weighed by a loop it is in and isn't a job where every use is so (represent.ts freshUses); chapters keeps cons lists (about 210 ms, 347 as arrays) and no other example's choice changes; done (2026-11-05): gaps/chapters.ts measures the stored program too (its `stored` way, the core IR of what `lab compile` stores, checked in chapters.test.ts and timed in bench-chapters.ts: 3,000 chapters 326 ms stored against 246 as written, on a slow day); (s3) the same in WebAssembly and C; (s4) block-in-array, measured the same way first. | GAPS.md round 4 P4 | P2 | L | |

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
| L182 | Flags as hidden kinds: (a) every new node attribute goes through L178's schema, done by construction (model.ts `SCHEMA` is typed so a new attribute doesn't compile without its slot, L178b); (b) in part: `def.results` is gone (L225d: a definition's results are its lambda's) and so is a field's `results` list (L128d3); `def.direction` gone too (L182c2: a direction is a way of its relation); left `field.ports` (a field's port names). Steps of about an hour (2026-11-05): (c1) done: a direction is a way whose target is a relation (WAYS.md "A direction is a way of its relation"); (c2) done: `def.direction` read as `way`; (c3) `field.ports` read from the field's own type instead of a list beside it: looked at (L182c3), set aside until function types' parameters have names, since directions pair fields by these names. | [FOUNDATIONS-2026-11-03](docs/reports/reviews/FOUNDATIONS-2026-11-03.md) §8 | P3 | M | |
| L215 | Check per definition group, cached ([CHECK-BY-GROUP-2026-11-03.md](docs/design/tools/CHECK-BY-GROUP-2026-11-03.md)), one PR each: (a) done: closed group results (check-cache.ts, `opts.cache`); (b) done: the editor's checks share one; (c) typedef groups, units, modes in the cache (in part: a value that isn't an implementation is a group like the others, so an edit to a constant no longer rechecks everything, L215c1; an edit's keys and the layer's scan skip what didn't change, L215c2; a published definition's checked mode kept between programs, L215c3); (d) `reuse` removed. Steps of about an hour (2026-11-05): (c4) and (c5) measured and not built (L215c4/c5 in DONE: typedef checks are about 1 ms and units 0.5 to 10 ms of an edit, nearly all of it the edited definition and those reaching it); (d1) done: `signatures.ts` `recheck` removed, its test now the cache's; (d2) and (d3) measured and not built (L215d2 in DONE: the palette's recheck through `reuse` is 72 to 103 ms a trial, a whole check through the cache 128 to 169, so the cache can't answer the trials faster, and `reuse` stays as their faster path). | L183, FOUNDATIONS-2026-11-03 §9 | P3 | L | (a), (b), (c1), (c2), (c3) done, (c4), (c5) measured |

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
| L43 | Rotors done (L43a: quaternions as the even part of `Cl(3, 0)`). Next, which parts can be nonzero ([GRADES.md](docs/design/numbers/GRADES.md)): L43b blade masks done (src/lang/grades.ts); L43c compiled JS and WGSL store only the masked parts, with L41 (C, M; done: the algebra's mask tables come from its blades, 14 s to 0.2 s on Spacetime, #942; staging multiplies only the masked parts of a definition's inputs, worked out from its callers, #952, and in shaders, #961; next: storing only those parts, and the copies staging makes); L43d the editor names a value's mask done (#831); L43e masks are types, a wrong grade is a type error (done: a part read outside the mask; named masks on record fields, `Vector of T` and the others, and on lists' items (L43e3); next: where the editor names an input's type) (Ersagun 2026-10-31: "each blade combination a different type") (L, M). Bounce passes vectors, spins and rotors as one 8-part type | NUMBERS.md stage 4, [CLIFFORD-DEMOS](docs/reports/CLIFFORD-DEMOS-2026-10-31.md) B3 | P1 | L | rotors and masks done |
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
| L72 | Grammars and their machines (Chomsky hierarchy) as ordinary data, parsing and printing one relation run both ways; extends L70. A first case: JSON, whose printer (`json printed`) and hand-written reader (`json read`, L190b) would become one relation run both ways (was L190c). Steps of about an hour (2026-11-05): (a) measured (L72a in DONE): descent (C110) can't read `json printed` yet, for three reasons, one step each: (b) `join all(map(xs, f), sep)`, a list read item by item between separators (json list, object and quoted text all print this way): (b1) done in descent.ts and first-sets.ts, so the evaluator reads such a printer backwards (L72b1); (b2) done: the same in reader.ts for a list of the printer's own values (`read <printer> list`), so compiled targets read it too; an item read by another function is left for (d); (c) show of a Float64 read back (JSON's numbers): done in descent.ts (L72c), the written reader too (c2, done: reader.ts `read float`, the longest text `read number` reads and show gives back exactly); (d) done (L72d): `json printed` reads back by descent in the evaluator, as `json read` reads compact JSON: a function of one character is read back from what it writes for the first 128 characters, worked out forward once, and itself elsewhere; a match on an input still to be read reads each case; an input passes into a definition read through its body; (d2) done: the same in reader.ts, so compiled targets read `json printed` backwards too (L72d2); then (e) done as a design note (GRAMMAR-DESCENT-2026-11-05.md "JSON: one relation"): `json read` accepts all of RFC 8259 and `json printed` writes one spelling, so JSON becomes `json spelled`, a Choice of every spelling with the canonical first; `json printed` is its first and `json read` it run backwards; (e1) done in part (L72e1): `blank`, `json character spelled` (itself, \\uXXXX in either case, the short escapes) and `json spelled` in the prelude, its first spelling json printed's text and run backwards by descent reading blanks and escapes as `json read` does (json-spelled.test.ts); (e1b) done: a number spelled any way `json read` reads it (`1.0`, `1e3`: `json number spelled`, show's first, then `inverse(json number read, x)`, L72e1b); left: (e1c) done: \\uXXXX for any character (`json string character`: json character spelled, or `inverse(json escape read, c)`), read by descent and the written reader, json read's speed or better on 111 KB (L72e1c); surrogate pairs done too (L72e1c2: `\\uD83C\\uDF89` joined, as json read joins them); (e1d) `json printed` defined as `json spelled`'s first (its hash moves); (e3) measured and fixed (L72e3): descent reads `json spelled` faster than `json read` reads, 0.55 s against 1.34 s for 111 KB of indented JSON, once a definition's spellings of a character are kept; (e2) done in descent.ts (L72e2): a piece written `one of(texts)`, or `if one of([…]) then a else b`, reads every alternative and keeps the one that reads farthest, the first of those that tie, so a blank reads any run greedily (descent-choice.test.ts); (e2b) done: the same in reader.ts, so compiled targets read `json spelled` too (L72e2b); (f) done (L72f): `json read` is `json spelled` run backwards, the hand-written reader deleted; left: (f3) json read's message says where the text stopped and what was expected, as calc's lines do (L70c), (e1d) `json printed` as `json spelled`'s first (L72e1d1: fast in the evaluator now, but the core IR runs all of json spelled inside its Choice and runs out of stack, so it waits for the core IR to run a `first` of a Choice without nesting), (e4) `json printed indented` as a variant of json spelled with its blanks first | Ersagun 2026-10-24 | P3 | L | low priority |
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
| L214 | Text as decided in [TEXT-2026-11-03.md](docs/design/data/TEXT-2026-11-03.md) (L185): steps a to d done in the evaluator and compiled JS (NFC where text enters, `Locale` with `uppercase`/`lowercase` and `my locale()`, `graphemes`, `collated` with `sort with`; DONE.md L214a to L214d). Left: WebAssembly and C, where case, graphemes and collation need the Unicode tables (the library's own code with generated tables, checked against the host on JS, TEXT §"How each target does it"). Steps of about an hour (2026-11-05): (e1) done: the case tables, read off the host as C's NFC tables are (case-tables.ts); (e2) done: `table uppercase`/`table lowercase`, the cases module (cases-source.ts), the host's in en, tr, az, lt and el; its context rules done too (L214e2b: final sigma through case-ignorables, Lithuanian's dot, Greek's diaeresis and lone ή); and a Greek letter's own combining marks, L214e2c; (e3) grapheme breaks from their tables: (e3a) done, the tables read off the host and UAX #29's rules over them in TypeScript (grapheme-tables.ts, library/graphemes.json); (e3b) done: those rules written in Ters, `table graphemes` in the cases module; (e4) done: collation's root order, read off the host's `Intl.Collator` into three-level elements, the letters that sort as two and the contractions found too (collation-tables.ts); (e4b) done: the elements saved (library/collation.json) and UTS #10's comparison written in Ters, `table collated` in the cases module, over the tables as six-bit text in chunks (NFC text read code point by code point, Hangul by arithmetic, marks put in canonical order by their combining class); (e5) done for case and graphemes: C and WebAssembly run the cases module's `table uppercase`, `table lowercase` and `table graphemes` where a program uses uppercase, lowercase or graphemes (compiler/src/table-text.ts, c-cases.test.ts against the evaluator in en and tr); (e5b4) done (L214e5b4): C and WebAssembly run `table collated` where a program uses `collate`; (e5b) needed the locales' tailorings first (`table collated` is the root order only, and `collate` takes a locale): (e5b1) measured (L214e5b1 in DONE): collation-tables.ts's build run on a locale's own `Intl.Collator` agrees with the host on es, de, hu, pl, tr and phonebook German, and a tailoring is small as the code points it moves against root (tr 3, sv 12, fr-CA 9, de 0), except a script put first (ru 443, el 406, hi 719) and Han orders (ja 35,739); steps: (e5b2), (e5b2b) and (e5b3) done (L214e5b2 to e5b3): `table collated` takes a locale and uses its language's tailoring, for 30 languages (af, az, be, bg, cs, da, eo, es, et, fil, gl, hu, hy, ka, kk, ky, lt, mk, mn, pl, ro, ru, sk, sl, sr, tk, tr, uk, vi, yo), each checked against the host when built; (e5b2c) left as root because they differ from the host on random words: bs, cy, el, fi, fo, ha, hr, is, lv, mt, nb, nn, se, sq, sv, to, wo (sv and fi on rare letters, ǖ against Ǜ; el on ϗ); measured (L214e5b2c): two causes in collation-tables.ts's build: the marks are sorted after an `a`, which some locales make a letter of its own with a mark (Swedish ä), and a letter with two accents whose first makes a letter (Swedish ǖ, ü then a macron) is taken as one letter; sorting marks after an `x` makes fi agree, and reading ǖ as ü and a macron makes sv nearly agree but breaks is and nb (ǻ), so both wait for a closer look; (e5b4) letters that sort as one (da aa, cs ch), which the build doesn't find; (e5b5) secondary tailorings (sv's ø against ő); (e5b6) Han orders, later. | L185, BLIND-SPOTS-2026-11-03 §4 | P3 | M | a to d done |
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
| T14 | The single slow tests left after L216: editing's swapAndUndo, 63 s since E248, about 26 s now (core-js done: T14a; tree of List: T14b; Tumble's clear: T14c; every builtin backwards is under a second now; the palette's modes of steady's functions 13 to 7 s of it: T14d). What is left of swapAndUndo: the graph's wire values running fall backwards after each pick (editor/main.ts traceInputs, 9 s; the search's cache keyed by each version of the code, not a hash of it: 8.2 to 5.8 s, T14e; left is resolving arith.ts for each version's search, ~4 s; a type held while a hole is filled no longer checks and resolves the library again, swapAndUndo 37 to 27 s, T14f); a port's text read as a value no longer finds every name in the program and library first, only when the text names something, once per version, T14g: parseValue 1.3 to 0.25 s of the profile; an edit's copy to the rows a shared otherwise stands for finds parents from the library's, found once, T14h: sameEverywhere 0.8 to 0.14 s; the search's runner no longer resolves the search's resolved program again, T14i: swapAndUndo 21.4 to 18.6 s, and steady pow's own modes, 2 to 3 s each of the two asked, 0.8 s since L227 (swapAndUndo 30 to 26 s). The palette's fillings, measured in node on physics' fall (2026-11-05): the first hole 2.3 s, the next 1.2 s; of the first, 1.0 s is working out the modes of the solve of fall for each offer, most of it steady's functions' own modes once (kept after), 0.75 s the shared whole checks (about 35 per hole, each 20 to 25 ms), 0.16 s units; no step left buys more than about 10%, so next is a smaller input for the test, not the palette. Each becomes a sweep or gets a smaller input, toward 5 s a file. Steps of about an hour (2026-11-05): Step j done: swapAndUndo's gestures on a small program of its own, units still on fall, 25.1 to 19.8 s; Step k done (measured 2026-11-05): editing.test.ts's slowest are now swapAndUndo 20.2 s, simplifyAppend 13.8 s, listItems 12.0 s, implementInterface 10.5 s; simplifyAppend on a small program of its own gains under 10% (12.5 s), so not built. The slowest single tests anywhere are the sweeps in slow.json, which run only after a merge: lang.test.ts's every filling (615 s on 11-03) and dots.test.ts's a dot on any wire (physics 295 s). Step l done: dots.test.ts's physics measured by stage (29 dots: running main 85 s, removing a dot 7 s, adding 4.5 s, checking 1.1 s), so main runs for one dot in eight there, as queens' for one in forty: physics 102 to 29 s a change. (m) dots.test.ts's shared dot 28 to 10 s: only dots of a known type tried, onto slots of that type (done), and relations' main run for one dot in four (1.3 s a run, 28 of 37 s; done). Next: (n) the next slowest test file, measured by stage. | [TEST-SPEED-2026-11-03](docs/reports/TEST-SPEED-2026-11-03.md) | P3 | M | |

## Coordinator and process

Not lane work; the coordinator does these or asks Ersagun.

| id | item | source | pri | status |
|---|---|---|---|---|
| P2 | Batch deploys if Actions cost needs it | Ersagun 2026-10-23 | P3 | asked, not requested |
| P3 | A per-repo Actions budget, or a public repo for free Actions | thread "GitHub Actions cost" | P3 | Ersagun's call |
| P7 | A foundation row every fourth item in each lane; the weekly review tracks kind tests across the code (2,805), tests reached by a one-line text.ts edit (145/150 + 44/44) and readers of a kind's fields | [FOUNDATIONS-2026-11-03](docs/reports/reviews/FOUNDATIONS-2026-11-03.md) §10 | P2 | |
| P8 | Add a LICENSE (and say what examples and programs written in Ters carry) once Ersagun picks one | [BLIND-SPOTS-2026-11-03](docs/reports/reviews/BLIND-SPOTS-2026-11-03.md) §3 | P1 | Ersagun's call |
