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

Ersagun's "take 40 more tasks" (2026-11-01 11:46): Editor 13, Compiler 13, Language 14.

| lane | thread | next, in order |
|---|---|---|
| E Editor | "Editor lane" | Ersagun's 20 more (2026-11-01, 7 here): I113 (#880), I114 (#882), I115 (#883), I117 (#885), I118 checked and handed to the Language lane (#885), I116 (#886), then I119 (one "show" in the palette); then the next QA round's findings |
| C Compiler and targets | "Compiler lane" | C66 on shaders (a shader's arrays in WebAssembly), C40 step 2e, C64's next step, C67's next step, C31, L125e (niche representations), L43c (after masks on record fields, L43e), C63d (Set as a hash table), then (Ersagun 16:05 "take 20 more") C30's next stage, C56, C45, C58, C59 |
| L Language and library | "Language lane" | Ersagun's 40 (2026-11-01): L125a step 1 done (#842); L125b done, L125d done (#847), L125f done (#848), L71a done (#849), L38's open end done (#851), L71b (`Await` and `together`), L69a2 (hosts in the compiled JS), L43e3 (named masks on list items), L108d2 (laws of match and fold jobs), L29, I84. Earlier today: #809 to #823 |
| T Testing | "Replace the slow browser smoke test" | I64, then the smoke's replacement |

## Inbox

New items land here until the next triage gives them a lane and a priority.

| id | item | source | added |
|---|---|---|---|
| I106c | A rest of a two-ended array is a view on the whole buffer, so after a million `rest`s a one-item array still holds 1.5 M slots (Go's slices leak the same way, which is why Go has `copy`). Copying when a view is much smaller than its buffer would make a repeated match on one small view linear, so it needs a rule that keeps match constant | REVIEW-2026-11-01 §2 | 2026-11-01 |
| I107 | Staging folds `0 · x` to 0 and `x + 0` to x (stage.ts, "as fast-math"), so compiled answers differ from the evaluator's for ∞, NaN and −0, and the preview swaps between the two. Fold only when x is known finite; a test with ∞ and NaN inputs. Settled by L125 (finite `Float64`, decided 2026-11-01): the folds are the type's laws, #834 closes, the checks move to L125c | REVIEW-2026-11-01 §3 | 2026-11-01 |
| I110 | Check main: 49 of its last 60 runs cancelled while queued, a run takes ~19 of its 20 minutes, "affected" reaches 93 of 97 test files. Look at why std.ts and the prelude reach every test; lanes check the latest run when starting an item | REVIEW-2026-11-01 §6 | 2026-11-01 |
| I118 | A wrong argument's error is placed at the wrong part: `nth(s, row, "x")` with s a List Float64 says "this function needs List Text here, got List Float64" about s, not "x" **Checked 2026-11-01 (editor lane):** outside a recursive group the error is at the wrong argument, as it should be (tumble `nth(…, …, "x")` from another definition: "nth needs List Float64 here, got Text" at the "x"). Inside one, a recursive call's argument fixes the group's type first (monomorphic recursion), so a later right use is blamed: the checker should check a definition's own body before its recursive calls, or name both places. Language lane | MCP-TRIAL-2026-11-01.md #8 | 2026-11-01 |
| I119 | Four builtins are named just "show": the generic one (`showAny`), and Float64's, Int's and Algebraic's own. Old PR #44 (2026-10-22) saw them as identical palette entries at a Text hole (not rechecked since) and renamed them "show number"/"show int", but programs call Float64's `show` directly (it runs backwards as read), so renaming makes printed programs read `‹show float64›(x)`. Instead, let the palette offer one "show" and pick the specific one by the value's type, or show the input type beside each entry | old PR #44, closed 2026-11-01 | 2026-11-01 |

## E: Editor

### Bugs

| id | item | source | pri | size | status |
|---|---|---|---|---|---|

### Writing programs in the editor

| id | item | source | pri | size | status |
|---|---|---|---|---|---|
| E161 | **"Same as the library's" line** (SHARING.md §7): when a draft's hash equals a library definition's, or another draft's, its header shows a quiet "Same as `magnitude` in vectors" linking to it; never merges; goes away on the edit that stops the match. Optional "Use the library's" button runs `adopt` on that one definition, on click only. Credit Unison (prior art) where the line is explained | Ersagun 2026-11-01 | P2 | M | after L126 |
| I29 | 66 of 154 definitions open with an empty Run. Pictures run at their pixel (#578); left: Mandelbrot's helpers (called through a fold), derivatives, page parts, newton. **Counted 2026-10-30 (editor lane):** 57 still empty in converter, dice, calculus, Mandelbrot and pedal. Two causes, neither a quick fix: (a) the first call's inputs are functions (`newton(f, f′, x)`, `field(…, view, …)`), **done in #703**: a port's box takes a definition's name as its function, so newton's helpers now open filled; (b) **views done in #761** (empty Runs in converter, dice, Tumble, Pig 47 → 28); **handlers done in #845**: each handler runs once in the dry run as if its event came (Tumble 24 → 17 empty, Pig 4 → 1); left: what runs only in a later state (a Tumble move in progress). Was: the call is inside a page part that runs later (`property("value", view(read(q)))`, a handler, an audio block), which main's trace never enters. Running main in a dry world (files kept in memory, no network) gets past converter's file read but fills none of these | QA-2026-10-28 L4 | P2 | M | step 1 done |

### Speed of editing

| id | item | source | pri | size | status |
|---|---|---|---|---|---|
| E103 | **Bug.** Adding a value in a definition run backwards (physics `fall`) takes about 4 s; five stages (#478 to #504) took fall's holes from 48 s to 18.5 s in all. Stopped by the 10% rule. **Measured again 2026-11-01:** 23 holes 121 s, the worst 22 s, of which the plan comparison per offer 5.7 s and whole checks for offers whose plan changed 10.4 s; E133a took the node copies off (→ 18 s); E133b took the analyzer's full scan per offer off (worst 12.7 s, all 23 holes 67 s); what's left is the whole checks of the ~400 offers that change a plan | E100 | P3 | M | |
| E133 | **Design** ([SHARED-NODES.md](docs/design/editor/SHARED-NODES.md)). Offers share the program's nodes instead of copying ~10,000 each. E133a, one scratch copy per palette (#866; fall's worst hole 22 → 18 s), and E133b, a filled program's analyzer starting from the program's slots (#875; → 12.7 s), are done. What's left is the whole checks of offers that change a plan | E103 | P3 | M | a, b done |

## C: Compiler and targets

New targets and speed rank below every language item (Ersagun,
2026-10-24 07:01). Measurements and rounds: docs/reports/GAPS.md.

### Bugs and gaps found by programs

| id | item | source | pri | size | status |
|---|---|---|---|---|---|
| C40 | Compiled JS for operations answered later (L54/L71): steps 1, 2a to 2d done (#571 to #573), 2e a search whose own definitions wait (C40e). Next: the world's `await(any of …)` as a promise, after L71; a waiting search through its `$k` or record-field copies still says not yet | LANGUAGE-NEEDS-2026-10-24 | P2 | M | step 2 done |

### Speed of compiled code

| id | item | source | pri | size | status |
|---|---|---|---|---|---|
| C67 | **A faster compiler** (Ersagun 2026-10-31: "make the compiler faster"). The editor's compiled swap takes 2 to 7 s. Benchmarks: compiling Bounce, Spacetime and Constructions to JS (main). Before: 6.1, 5.9 and 1.9 s; most of it is the program checked again after staging, over the whole library. Done: C67a, only what the exports reach is compiled (3.5, 4.4, 1.0 s); C67b, ids from a pool of random bytes (3.0, 4.2, 0.8 s); C67c, effect-row chains flattened as they are walked (2.9, 2.7, 0.8 s). Stopped there (2026-10-31): no single function is over 0.5 s now. The largest part left is staging's two whole-program checks (about 1 s of Spacetime's 2.7 s). C67d would check the middle one only on the definitions staging changed (infer's `reuse`, as the palette does), which saves about 10% at best and must merge type info from two checks: not worth it yet. The rest is staging's own work (evaluating at compile time). The rule was to stop when a step buys less than 10% | Ersagun | P3 | M | stopped; C67d open |
| C66 | std's Array on the other targets (Ersagun 2026-10-31 "Yea"). WebAssembly done (C66a), native C done (C66b). Shaders, as Ersagun chose (2026-10-31): Int as an i32 done (C66c1), `first` with a fallback and `count` done (C66c2), arrays of a fixed size done (C66c3), an array as a function's input done (C66d, a copy per size); Int in 32 bits and the flag in WebAssembly done (C66e); left for the Editor lane: editor/picture.ts's `cpu()` lowering with `shader: true` (WebAssembly takes it now; a shader's arrays still fall back to JavaScript). Also left: a shader's arrays in WebAssembly, equal and compare on arrays in WebAssembly and C. Bring the two-ended buffer views from #734 (a start and length on a buffer with room at both ends, a push writing into a free slot) to WASM and C, and to shaders where a fixed size fits | Ersagun | P1 | L | |
| C30 | Lists as arrays. Done so far: P4a, #555, #558, #561 (pedal 2.9×). The split, join and block-in-array stages pay only together (~25% more); do them as one stage when another program needs lists as arrays. The aim: an `array` representation written in the language (REPRESENTATIONS.md), so WASM, C and the editor get it too. C30d (2026-10-31): Ersagun's two-ended array list; JS runtime views (C30d1, #734), the ends and `array of List` (#737), the ends in WebAssembly and C (C30d2, #754), the evaluator's arrays on the same buffer (C30d3a, #762; Ersagun chose "everywhere" 2026-10-31), the preview's chooser picking `array of List` from use (C30d3b); next C30d3c, the compiled targets taking the same choice (WebAssembly and C need `first of array if any`) | GAPS.md round 4 P4 | P2 | L | |
| C55 | Compile each direction of a relation a program uses as its own function (Mercury), dropping results no caller reads. Done: C55a, a solve the relational interpreter ran whose results are each an expression of the inputs is a call per bound result (results.ts; a Dual's unpolar 625 → 0.4 µs). C55b, results bound together are one function that does their shared work once (Fixed's unpolar runs CORDIC's vectoring once for length and angle). Left: Float64's numeric-plan solves still compute every result, and work shared below where results part (a Dual's x² + y²) is still done twice | Ersagun 2026-10-28 | P2 | M | |
| C63 | IN-PLACE.md step 2: a hash table changed in place as a representation of Map and Set, where every value has one holder and keys hash as they're equal. C63a (the one-holder check), C63b (the `hash table` row for Map, Int and Text keys, on JS and the evaluator) and C63c (jobs in a loop weigh n; routes takes the table, 2× faster than on trees) are done. Next C63d, the same for Set (routes' frontier and found sets) | docs/design/data/IN-PLACE.md | P2 | L | |
| C31 | A recursion that gives back a Pair returns its two fields without the record. 3% on the pedal | GAPS.md round 4 P5 | P3 | M | after C30 |
| C64 | Handlers the compiler can see: Pig's `quietly` and `hold at` sit right around `play`. Done: C64a (#759, quiet cases skip the hiding, 330 → 270 ms) and C64b (#787, handlers written into the code they handle, 270 → about 95 ms). C64c (a case written in as a condition is a plain JS condition, about 110 → 77 ms today; earlier numbers were on a busier machine). Left: Random's perform in `die` looks through the handler stack and the world's pooled crypto randomness each roll (about 25 ms of the rest; by hand, Math.random in place gave about 55 ms) | examples/pig | P3 | M | |

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
| L108 | Representations written in the language (REPRESENTATIONS.md). L108a to L108c done: a representation is a definition, the compiler chooses, no explicit selection (#679 to #682). L108d laws done (`lab test` checks each job through its meaning). Left: the laws of jobs that take a function (match, fold); the editor half is E159 | Ersagun 2026-10-30 | P2 | M | 3 of 4 steps |
| T7 | Tests in the language ([TESTS-IN-THE-LANGUAGE.md](docs/design/testing/TESTS-IN-THE-LANGUAGE.md)): T7a `Check`, small values and `lab test` done; T7b accepted answers in examples.json done; T7c results cached by hash: local done (`.lab/checks.json`), CI's cache left (T, S); T7d the editor's tick, difference and accept button done (#829); T7e example sweeps moved to answers and laws, `--compiled` (T, M). Unblocks L108d, L97e | TESTING.md T7 | P2 | L | design, T7a and T7b done |

### Numbers (NUMBERS.md)

| id | item | source | pri | size | status |
|---|---|---|---|---|---|
| L44 | Linear maps, geometry and matrices ([MATRICES.md](docs/design/numbers/MATRICES.md), Ersagun 2026-10-31): `Mat2` to `Mat4` done (L44a). Rotors, reflections, projections and PGA motions from the Clifford tables done (L44b); reading a function's matrix done (L44c, src/lang/linear.ts). Next: the compiler stores linear functions as matrices (C lane, C30b/c); then a linear-algebra library for any size | LANGUAGE-REVIEW-2026-10-24 | P1 | M | steps 1-2 done |
| L42 | `Cl(p, q, r)`: `clifford table` done (L42a). Next: a PGA motor in the ray marcher (L41 is done) | NUMBERS.md stage 4 | P1 | M | step 1 done |
| L43 | Rotors done (L43a: quaternions as the even part of `Cl(3, 0)`). Next, which parts can be nonzero ([GRADES.md](docs/design/numbers/GRADES.md)): L43b blade masks done (src/lang/grades.ts); L43c compiled JS and WGSL store only the masked parts, with L41 (C, M); L43d the editor names a value's mask done (#831); L43e masks are types, a wrong grade is a type error (done: a part read outside the mask; named masks on record fields, `Vector of T` and the others; next: on lists' items, then where the editor names an input's type) (Ersagun 2026-10-31: "each blade combination a different type") (L, M). Bounce passes vectors, spins and rotors as one 8-part type | NUMBERS.md stage 4, [CLIFFORD-DEMOS](docs/reports/CLIFFORD-DEMOS-2026-10-31.md) B3 | P1 | L | rotors and masks done |
| L118 | A faster evaluator ([EVALUATOR-SPEED-2026-10-31.md](docs/reports/EVALUATOR-SPEED-2026-10-31.md)): profile, one hotspot per PR, stop when the next buys <10%. L118a the table product as a jet done (Spacetime's charge path 8.3 s → 0.48 s, Bounce's step 14 → 3.7 ms). L118b, the machine's own hotspots, measured below the noise and stopped. Stopped here (Ersagun 2026-10-31 21:12); L118c is its own row below | Ersagun 2026-10-31 | P1 | M | done for now |
| L118c | The evaluator compiles each definition to JavaScript closures once (closure compilation, Feeley and Lapalme 1987), keeping the heap continuation only where a search or a handler needs it; likely 3-10x on all interpreted code ([EVALUATOR-SPEED-2026-10-31.md](docs/reports/EVALUATOR-SPEED-2026-10-31.md) step 2). For later: Ersagun stopped L118 after step 2 | Ersagun 2026-10-31 | P3 | L | for later |
| L51 | Tensors as the general algebra (NUMBERS.md stage 6) | NUMBERS.md stage 6 | P1 | L | after C30 |
| L97 | `polar` as the relation behind Trig (POLAR.md): L97a to L97c4 done (Trig's polar, unpolar, asin, acos; polar given x, y answered by unpolar). L97e complex laws done (prelude tests). L97d done: Fixed's polar is CORDIC's rotation, its sin and cos come from it. Left: C55, so sin alone doesn't run the cos half | Ersagun 2026-10-28 | P2 | M | done, C55 left, L97d left |
| L96 | Several ways to compute one operation, the compiler choosing by cost (WAYS.md): L96a to L96c done. Left: the steps after L97 | Ersagun 2026-10-28 | P2 | L | 3 of 5 steps |
| L88 | Exact reals (EXACT-REALS.md): `Algebraic` done (L88a to L88d, √2·√2 is the Int 2). Next: step 4, `Real` as lazy intervals, when a program needs π exactly | Ersagun 2026-10-26 | P2 | L | 3 of 4 steps |
| L125 | Which IEEE float values the language keeps ([FLOAT-VALUES-2026-11-01.md](docs/design/numbers/FLOAT-VALUES-2026-11-01.md)): `Float64` as the finite floats with one zero, ±∞ as an ordinary `Extended a`, NaN only as how "no answer" is stored. **Decided 2026-11-01** (Ersagun: finite `Float64` yes; `x / 0` no answer). Steps: L125a the meaning (overflow aborts; `/ sqrt log asin acos ^` get `Choice` at bad arguments; −0 canonical in `show`, `atan2`, `sign`) (L, M); L125b the inferred nonzero/nonnegative fact that drops the check (L, M); L125c compiled checks on JS, WASM, C, staging's folds as laws, #834 closed (C, M); L125d `Extended a` in the library (L, S), shown and typed as ±∞ in the editor (#865); L125e niche representations, `Optional Float64` and `Extended Float64` in one f64 (C, M); L125f host floats checked on entry (L, S) | Ersagun 2026-11-01 | P1 | L | decided; L125a step 1 done (the evaluator stops on a non-finite answer, with the reason); L125d and L125f done; L125b done (no answer is a `Choice` in the evaluator; a view with none shows nothing); L125c1 done (compiled JS stops the same), L125c2 done (WASM and C); L125c3 done (compiled JavaScript gives no answer too, as WebAssembly and C already did; plain scalar code with no Choice still stops) |
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
| L71 | `together`, `race`, `within(ms, a)` as prelude handlers over `await`. Typing written down (ANSWERED-LATER.md "Typing `await` and `together`"): L71a an operation's own type variables (fresh per call, rigid in its case); L71b std's `Await`, `Ticket a` and `together` in the prelude, parked branches kept as thunks; L71c the world answers `await(any of(…))`, then `race` and `within` | LANGUAGE-NEEDS Part 1 | P2 | L | typing designed |
| L63 | Deterministic schedules: under `seeded` the scheduler's choices are seeded, so an interleaving bug is a seed in a test (FoundationDB) | LANGUAGE-NEEDS Part 1 | P2 | M | after L71, L55 |
| L69 | Foreign definitions ([FOREIGN.md](docs/design/targets/FOREIGN.md)): a program's own effect answered by a host file per target. L69a `hosts/js.js` in the evaluator and compiled JS, results checked at the border, `lab hosts` skeleton (L, M): the evaluator's half done, the compiled JS left; L69b C and WebAssembly (C, M); L69c the editor's "needs its host" (E, S), done (#860); L69d optional, std's world operations as host files (L, M). Asks Ersagun: may a foreign operation be declared pure | LANGUAGE-NEEDS §5 | P2 | M | design done |
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
| L126 | `sameAs(code, lib)` in ters (beside `adopt`, modules.ts): hash every draft (memoized) and look it up in a hash → definition index of the prelude, std and the modules the program uses, plus the program's other drafts; for E161, and for `lab check` and the MCP server to report the same (SHARING.md §7) | Ersagun 2026-11-01 | P2 | S | |
| L113 | Structural diff and three-way merge driver for program files, by id, in `.gitattributes`; can go first | SHARING.md §6 | P3 | M | |
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
| L119 | **Later goal**: Bounce's continuous collisions: time of impact for ball and ball (a quadratic, S₁(t)·S₂(t) = −r₁r₂ for conformal spheres) and ball and wall (linear), once for 2D and 3D; step to the first impact with a sub-step cap; a "bullet through a thin wall" case beside the plain step | Ersagun 2026-11-01 | P3 | M | |
| L120 | **Later goal**: time of impact for rotating shapes along a PGA motor (screw motion) by conservative advancement (Mirtich); the compiler choosing it or the closed form by cost (WAYS.md) | Ersagun 2026-11-01 | P3 | L | after L119, shapes other than balls |
| L121 | **Later goal**: speculative contacts in Bounce, compared with L119 on the same scene (cost per frame, ghost bumps) | Ersagun 2026-11-01 | P3 | S | after L119 |
| L122 | **Later goal**: an agent with inertia, decoupled: navigation-mesh A* (from routes' frontier), the funnel, corners as arcs, the time-optimal speed profile (forward and backward pass), a follower; one page, a hand-made mesh | Ersagun 2026-11-01 | P3 | L | |
| L123 | **Later goal**: the coupled search: Hybrid A*-style over position and velocity, motion primitives exact under linear drag, L122's path length / top speed as the heuristic; compared with L122 on the same map | Ersagun 2026-11-01 | P3 | L | after L122 |
| L124 | **Later goal**: a rapidity speed cap (velocity as a boost in Cl(2, 1)) beside linear drag on L122's page; optional | Ersagun 2026-11-01 | P3 | M | after L122 |

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
