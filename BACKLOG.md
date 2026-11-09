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
| E Editor | "Editor lane" | E103, then Language or Compiler rows agreed with those lanes |
| C Compiler and targets | "Compiler lane" | C187 (fibers in WASM); C184 with the Editor lane |
| L Language and library | "Language lane" | L44, then L182 when unblocked (core, run.ts, infer.ts, hosts.ts) |
| L Language and library | "Language lane B" | C60 (columns, after C196 and C93 s5); round 12's I187 is with the Editor lane. L118c waits on Ersagun, who stopped L118 after step 2. Skip L107 (waits on Ersagun) and L24 (research). Take a row from another list only after telling that lane. |
| T Testing | "Replace the slow browser smoke test" | I64, then the smoke's replacement |

## Inbox

New items land here until the next triage gives them a lane and a priority.

| id | item | source | added |
|---|---|---|---|
| I193 | Checking any program types the whole library first (43,568 nodes): 2.5 s per process before a program's own definitions, and `lab run examples/wc` on empty input takes 4.5 s where the compiled wc.js takes 0.15 s. Every test file, the MCP and the editor pay it at start. The library's definitions are pinned with their types (signatures.ts), so `infer` should type a program's own definitions and read the library's types from their pins, typing a library body only when something asks for it; the Unicode tables (cases.json) load only when a program uses them. Example: `lab check examples/wc` under 1 s, kept by a budget in the suite (todo test R10 §2, which counts typed nodes) | [REVIEW-2026-11-09](docs/reports/reviews/REVIEW-2026-11-09.md) §2 | 2026-11-09 |
| I195 | One gallery example is left out of the core-IR agreement test (compiler/test/core-js.test.ts) because the evaluator, which defines the meaning, is too slow: `agent`'s A* search takes minutes. L118c (a faster evaluator) would bring them back and is held by Ersagun. Example: core-js.test checks agent against the evaluator with no skip Left (2026-11-09, I195a): `numbers` is back, checked as `lab run` stores it (Nat as Int, 0.4 s in the evaluator); `agent` still takes over 400 s in the evaluator even stored, so it waits on L118c. | [REVIEW-2026-11-09](docs/reports/reviews/REVIEW-2026-11-09.md) §5 | 2026-11-09 |
| I192 | A few definitions still freeze 0.5 to 1 s on opening: machine `all digits` 1.0 s, break `shifted` 1.0 s, ray marcher `shadow`, Spacetime `rapidity picture`, Constructions `is picked`, calc `blank` 0.83. Measured 2026-11-09 18:00 (Editor lane, twice each, the click to the next frame and the long tasks): `all digits` 0.36 s (one task of 0.30), `shifted` 0.26 (0.22), `is picked` 0.46 (0.41), `blank` 0.34 (0.27): I189's remainder, the long run's piece and one view. `shadow` 1.24 s (0.42 + 0.63): the long run's pieces too, its views each a call of the evaluator, then the drawing. New: `rapidity picture` 1.15 s in one task of 1.0, all drawing, no evaluator: the graph laid out and routed 0.32 s (tidyScene, arrange, route, crossings), the blocks 0.17, the graph's hooks 0.13 (Spacetime's algebras found once, 0.06, and the trace), the page laid out when scrolls are put back 0.15. Next: the graph of a big definition drawn in less (what is shown first, the layout kept between opens). I192a (this PR's DONE row): opening from the list or a tab drew the page twice, and a definition of over 400 nodes draws its graph in a task of its own: `rapidity picture` opens in 0.24 to 0.39 s then 0.30 for its graph (was one task of 0.68 to 0.92). Left: the picture's own run after, I189's pieces of 0.4 to 0.7 s, the same before and after. | QA 11-09 L1 | 2026-11-09 |

## E: Editor

### Bugs

| id | item | source | pri | size | status |
|---|---|---|---|---|---|
| I189 | Opening some definitions still freezes the page for a second or more. Measured 2026-11-06 03:00 after I179: Spacetime `scalar part` 1.75 s (its longest task 0.93), machine `all digits` 1.6 s (1.5). After I189a (03:20): `all digits` 0.37 s (0.32). After I189b (04:00, the long run's drawing yields between views): `scalar part`'s longest task 0.40 s (was 0.82). After I189c (`table product`'s host 3.2× faster): the views 0.33 to 0.37 s. After I189e (05:20): the warm-up after opening Numbers, one task of 0.49 s, is three of 0.30, 0.21 and 0.17. Left: the long run's first piece is its 0.4 s main budget, and each view is one call that a piece can't cut, most of it the evaluator's own steps (run.ts step, parts, apply); the evaluator faster, or the long run stopping once the opened definition has its value. Measured again 2026-11-07: still 0.40 then views of 0.30 s, each one call of the evaluator's CEK machine (step, apply, going, parts), so what's left waits on L118c (the evaluator compiled to closures). Example: Spacetime `scalar part` opens in tasks of at most 0.3 s | I179 (QA-2026-11-05b M1) | P2 | M | a to c, e done |

### Foundations ([FOUNDATIONS-2026-11-03](docs/reports/reviews/FOUNDATIONS-2026-11-03.md))

| id | item | source | pri | size | status |
|---|---|---|---|---|---|

### Writing programs in the editor

| id | item | source | pri | size | status |
|---|---|---|---|---|---|

### Speed of editing

| id | item | source | pri | size | status |
|---|---|---|---|---|---|
| E103 | **Bug.** Adding a value in a definition run backwards is slow (five stages and E133, E103c to e and L226 so far, DONE.md). Example: physics `fall`'s holes, 72 s for all 23 and the worst 18 s (2026-11-05); its 8 call holes 119 to 34 s from cold, the worst 41 to 14.5 s, by refusing offers the callers can't use before a whole check (E103f), and before their plans are worked out (E103g: on main since, 37 to 23 s, the worst 16 to 5.9 s); done when the worst takes under a second. 2026-11-05 20:50, 17 holes now: 46 s, the worst 6.7 s; E103j 27.6 s, the worst 4.0 s (fillings alone 2.5 s, the rest the hole's first check). Measured 21:30: in the worst hole (a ref, 201 offers) 1.6 of its 2.7 s is the plans compared per offer, 245 of them at 6.7 ms, 205 the same as the program's; nearly all of it is the group's own mode (fall's body) worked out again, its callees already kept as published ones (keeping an unpublished callee's for the offers, E103k, was tried: 8 of 259 asked, not built). A literal at the hole is a given goal whatever its value, so literals could share one plan; a reference can't, since where a let names it or a higher-order call takes it the callee's mode changes. Left: the plans compared per offer (solveMode, about 4 ms each, 2,019 for one hole with 7 distinct answers) and the checks of the group. Next idea: where only a plan changes, check the solves' verdicts instead of a whole inference (reusing a verdict across callees needs a fingerprint of the callee's modes, not cheap and sound yet). Measured 23:10 (main at #2014): the 17 holes 17.8 s, the worst 1.9 s (cp3j3f), but 0.85 s of that is the first offer of steady sin and steady log working out their modes once per session (whichever hole offers them first pays it); without it the worst is mirt1t, 1.8 s, of which about 1.1 s is 110 checks of the group (one per different outcome among 268 fillings, ~10 ms each) and the plans are under 1 ms an offer. A field called on holes always made the program's plan at each hole (1,161 of 1,178), but sharing that plan bought nothing, since those plans were cheap. Left: the group's check per outcome (fewer outcomes, or a cheaper check of fall), and steady's modes worked out at build time rather than on first offer. Measured 2026-11-06 04:00 on a slower machine (the program on the library's layer, as the editor has it): 20.5 s, the worst 2.3 s; E103l 19.6 s, the worst 2.2 s. The worst's profile is spread: the group's checks (byKind, inlined), modes' run and ask, collection, nodesWhere's filters of the library's builtins for each definition with results. Measured 2026-11-07: 19.4 s, the worst 2.3 s (the first hole, paying steady's modes) and 2.1 s (cp3j3f), whose 1.2 s is newPlans: 245 plans worked out for 201 offers, 4 distinct; every call of a builtin (35), field (76) or constructor (4) with holes gave the program's own plan, and 67 of 73 calls of definitions did, but nothing yet shows the builtins' always do (an equation's sqrt of a hole could change its answers), so it isn't skipped. Next: the modes analysis of the group per offer (solveMode, about 5 ms), not the palette Measured 2026-11-09 (17 holes, 18.5 s, the worst 2.2 s): every call with holes, of a builtin (33 of 595 differ), a field (38 of 1,178) or a definition (160 of 1,259), can change the plan, so no skip by what an offer is. fall's own mode per offer is 1,641 search steps in all, cheap; the worst hole's extra 1.4 s is steady sin, reduced, scaled, two to and exponent worked out backwards once per session (4,096 paths each), and the rest is the group's whole checks, 707 over the 17 holes at about 13 ms. E103n (this PR's DONE row): a filling that makes a solved definition act is refused without one, 545 left, 17.0 to 17.4 s against 18.4 to 18.5 s, the same offers. Of the 454 checks that refuse, 166 more are main printing while a Choice from fall is open, which needs main's handlers to predict. Keeping the first such refusal for every other filling that brings a search's Choice was tried: it lost offers (a trig operation's log, asin, acos and divide, whose Choice signs.ts drops where main's inputs answer it, as it does through definitions), so a sound version needs signs.ts's totalCall per filling. Left: those, the checks that pass (253, each a different group type), and steady's backward modes before the first offer (E103o, this PR: library/steady-modes.json, steady's modes forwards and backwards without their plans, 200 KB; cp3j3f 2.2 to 0.85 s, the 17 holes about 16.6 to 14.7 s, the worst now mirt1t, 1.9 s, the first hole paying its own library modes) Measured after (19:00): mirt1t's 2.2 s has no mode over 70 ms left; 1.3 s of it is its ~100 whole checks of the group and its callers (byKind, about 12 ms each, main the biggest), and 0.4 s the analyzers of the offers' programs. What is left needs a cheaper whole check: checking only what a filling changes in the callers (an incremental check), not more cuts of which fillings are checked. | E100 | P3 | M | |

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

### Bugs and gaps found by programs

| id | item | source | pri | size | status |
|---|---|---|---|---|---|
| C196 | **Ersagun 2026-11-06: choose the storage for each list, not once per program** ("pedal is creating cons lists in the audio loop. That's just wrong. Add whatever mechanism is needed for choosing for each list"). Today library-reps.ts picks one representation of List for everything the program reaches, so one list the rewrite can't change keeps all of them cons lists. 9 of the 32 examples with a main are held back this way: the costs pick arrays or trees, but `listBoundary` refuses the whole program because it reaches a library type with a list inside (Html for compass, converter, dice, pig, tumble, pedal and spacetime; Algebra for bounce and impact). Choosing per group (rep-split.ts, C93 s3, C188) is only a fallback today: it runs only when the program-wide pick is trees, only for groups read by position in a loop, and only on JavaScript. Make it the normal way: every group of lists that flow into one another (rep-groups.ts) gets its own storage from its own uses. The costs are in-order reads, cons, by-position reads and replaces, priced for the target (an array read in order is cheaper than a cons cell in compiled JavaScript, C184). Convert where a list crosses into a library type's field or a builtin. Example: the pedal's sound through the core IR (`lab render --compiled`, bench-audio.ts) builds and reads its blocks as arrays, with no cons cells in the audio loop; checked also by `lab compile` of examples/spacetime choosing `array of List`. Found 2026-11-09 (DONE.md, C196 step): the pedal's costs tie (a list read in order costs 1 a step either way), so it keeps cons lists; forced to arrays it gives the same samples but takes 2 to 4 times as long a block, since in compiled JavaScript each array read makes a view, an option and a pair (std.ts front, restOf) and each push front a view, where a cons match makes nothing. Left: (a) done (DONE.md: reads and builds with no object an item, #2124, #2131; a sound's lists are arrays where the costs tie, so the pedal's are: 0.034 ms a block against 0.022 on lists, its bands solve printed as its mode plan since (DONE.md); the gap is spread: copies as a built array outgrows its room, views the plan's front and push make); (b) done for pages with Html (pedal, pig: DONE.md); Algebra's lists done for spacetime (arrays) and bounce (trees) (DONE.md, C196 step); still refused: impact (a holder taken apart in a seed), compass (its own basis and squares passed to clifford algebra), tumble's cells of lists (a cell of the program's own type holding lists, read by the page as written and by the rest: a cell can't be converted where it's read; dice's `seeded` done, DONE.md) | Discussion thread 2026-11-06; Ersagun 04:59 | P1 | L | Compiler lane |

### Speed of compiled code

| id | item | source | pri | size | status |
|---|---|---|---|---|---|
| C184 | The pedal's sound from the core IR as quick as compile.ts made it. Measured 2026-11-05 on one machine (bench-audio.ts): the core IR 0.037 ms a block, compile.ts's last 0.021 (its 0.036 on the machine first measured), by hand 0.009; the core IR is 4.0× the hand-written pedal. Where the core IR's time goes: building the block as a cons list and reading it back (sound.ts toList, fromList) 13%; the finite checks before each comparison 11%; the depth counter under 1%; the rest is the cons cells and the pairs a mapping-with-state builds per sample. The gap is compile.ts's lists as arrays chosen from use, which the core IR has only through the language's `array of List` row (C30). Why the pedal's lists stay as written (checked 2026-11-06, Compiler lane): `lab render --compiled` and `soundOf` lower the program as given, and with the chooser run on the sound's root (represented.ts) it still picks `List as written`, since by the declared costs a list read only in order is cheapest as a cons list; forced to `array of List`, listBoundary refuses it for the page's `styles` (an Html, a library type holding lists, which the sound never reaches), and with the program cut to what the sound reaches, for the bands' solve (a relation run backwards over a list). So the step left is the costs (an array's read in order, cheaper than a cons cell's in compiled JavaScript) and a solve over an array. Measured again 2026-11-06 (Compiler lane): the core IR 0.021 ms a block, 2.9 to 3.0× by hand (compile.ts was 2.3× by hand, so the aim is about 2.6×). A profile of the block alone: the tanh solve 16% (its answers made as a list of arrays, `solve$`, `solve$$direct`, `$clean`; `drive` is `first` over every answer of a solve that has one at most, so a solve known to give at most one answer could be a call that fails when it gives none, with no list and no chooser), the garbage collector 11%, `gain for`'s finite checks 9%, the bands' mode plan 3%. A solve of one answer or none is a call now (C184 step, DONE.md): 0.0204 to 0.0187 ms, about 2.65× by hand. Example: compiler/gaps/bench-audio.ts's core IR row within 1.1× compile.ts's on the same machine | Ersagun 2026-11-05 20:00 (what compile.ts did that the core IR doesn't yet) | P3 | S | |

### Memory and layout (STABLE-REFERENCES.md §3 to §6)

All invisible to programs: no annotations or hints (Ersagun 2026-10-29).

| id | item | source | pri | size | status |
|---|---|---|---|---|---|
| C56 | "Owned, in place" as a representation chosen when a value has one holder, generalising `$own` and C30 to records, maps and cell contents; reference counts (Perceus) where the compiler can't tell. Steps are C62, C63. On JavaScript, arrays (C93 s4) and records (C93 s5) of a type whose every value has one holder are written in place; WebAssembly and C still copy them | STABLE-REFERENCES.md §3 | P3 | L | |
| C57 | A region per scope: temporaries of one page update, audio block or frame freed at once (Tofte–Talpin) | STABLE-REFERENCES.md §4 | P3 | L | |
| C58 | Keyed collections as a grow-only array with a free list and generational keys (ECS) | STABLE-REFERENCES.md §4 | P3 | M | |
| C59 | Flat inline layout for data built once and read, doubling as a file format (FlatBuffers). Measured on notebook after C71/C72 (GAPS.md round 6, N3: about 10% left for it there, 4.4× the ideal with no one hotspot): its index is built once with one holder (8.5× the ideal on trees) and then only read by every question (8×); a frozen map as sorted key and value arrays makes `entries of` free and `value at` a binary search. 2026-11-06 at 3000 notes (nb profile): questions are 43% of the run (seen with, like line, any scores), the index 22%; `value at` read without a list or a throw took the table way from about 365 to 300 ms against an ideal of about 83 (4.4× to 3.6×), texts compared where they differ (#2095). A frozen map would buy notebook little now: `value at` on the hash table is one lookup and `entries of` a version is sorted once (C72). What's left is spread: `credit`'s `update at` per word makes a new table version and a closure (made as `{ caps }` instead of a function, no change measured), GC 12% | STABLE-REFERENCES.md §4, GAPS.md round 6 N3 | P3 | M | after C70, C71 |
| C60 | **Later goal**: a list of records stored as columns when its loops read few fields. Step 1 measured 2026-11-09 by hand in plain JavaScript (100,000 records of six Float64s, median of 9): summing one field 68 ms as objects against 13 ms as a column (Float64Array or plain array alike); moving each (x += vx, y += vy) 179 ms making new records, 9.7 ms changing them in place, 3.6 ms as columns. So columns pay 2.7 to 5 times, but only once three things hold, none of which does today: the list is an array (of the 39 examples only pedal keeps a list of records as one, its pairs: C196), an array read makes no object (C196 (a): today a view, an option and a pair each), and a record is changed in place rather than rebuilt (C93 s5, C56), which is the 18 times. Do those first; then the example is a physics program's bodies moved each frame (impact or physics), chosen as columns on JavaScript, WebAssembly and C | STABLE-REFERENCES.md §5 | P3 | L | |
| C61 | **Later goal**: where code runs chosen by cost, never written (workers, GPU compute, main thread). Designed: [WHERE-IT-RUNS.md](docs/design/targets/WHERE-IT-RUNS.md) (Bend 2 read; a worker measured: a copy is about 20 ns an item there and back, a transfer of a one-holder array nearly free; leaving the main thread is asynchronous, so only a caller that can wait). (a) done: WebGPU measured (compiler/gaps/bench-places.ts; about 3 ms a dispatch and 20 ns an item to move, so only work well above that per item pays: 8× at a million items of 100 steps, even emulated). Next: (b) a price list per target, (c) workers for a pure map, (d) the GPU for a map, (e) divide and conquer | STABLE-REFERENCES.md §6 | P3 | L | |

### Mobile (Ersagun 2026-11-09: a goal; native compilation per platform a stretch goal, instead of a webview)

| id | item | source | pri | size | status |
|---|---|---|---|---|---|
| C198 | Revive `lab build-app` and run one app on a phone. It makes an installable web app (manifest, service worker, icons) that is also a Capacitor project for Android and iOS (ters/cli/app.ts, WEB.md "Mobile"), untouched since 11-02, and no app has been run on a phone that we know of. Check it still builds on today's `lab build-web`, works offline once installed, and that the Capacitor project builds an Android APK; ask Ersagun to install it, since containers can't reach a phone. Example: `lab build-app` of dice installed on a phone and played offline | I194 (REVIEW-2026-11-09 §6); Ersagun 2026-11-09 | P2 | M | |
| C199 | Stretch: native apps per platform instead of a webview: the program compiled through the core IR to each platform's own code and UI (Swift and SwiftUI on iOS, Kotlin and Compose on Android, or C through the C target with a thin native shell), a page's Html as native views. Design first: which target and which UI layer, what a page's cells and events become, and what the C and WebAssembly targets already give. Example: dice as a native Android app with no webview | Ersagun 2026-11-09 | P3 | L | after C198 |

### Parallel and concurrent code on the targets

| id | item | source | pri | size | status |
|---|---|---|---|---|---|
| C41 | Pure `together` branches on worker_threads / Web Workers past a cost threshold | LANGUAGE-NEEDS-2026-10-24 | P3 | M | after L62 |
| C42 | Data-parallel `map` and associative folds on a thread pool, later as compute shaders (NESL, Futhark) | LANGUAGE-NEEDS-2026-10-24 | P3 | L | after C30 |
| C43 | Or-parallel `all`/`count` and speculative `first` in canonical order, with work stealing (Cilk, Aurora/Muse) | LANGUAGE-NEEDS-2026-10-24 | P3 | L | after C41 |
| C195 | Relations in WebAssembly and C: a solve has no lowering outside JavaScript, where it is the evaluator's solver or a plan printed as JavaScript text (core-solve.ts, modes.ts), so `lab wasi` and `lab native` stop at "solves a relation (not in this profile yet)" (scalar.ts solveUse). A plan written as code the scalar profile lowers (as `derive` writes a derivative) would reach every target. Example: `lab wasi` of examples/relations, backwards, conjugate and physics printing what `lab run` prints (the other 16 examples with a main that isn't a page already do, 2026-11-06). Surveyed 2026-11-06 04:00 (Language lane, which took the row): no one step gets an example there, since each needs a different kind of solve. relations: split and add are solver plans with one way (`once`), square has two answers, polar is numeric or periodic. backwards: angle is `once`, greet a mode plan, magnitudes to is neither (relate.ts runs it). conjugate: brighter is neither (a conjugation of closures). physics: fall is numeric. Steps: (a) a `once` solver plan (relation.ts compileSolve's `$one`) and a det or semidet mode plan (modes.ts) written as Ters definitions the scalar profile lowers, with `$clean`'s 12-digit rounding as a builtin on C (`%.12g`) and WASM, `$ok` and `$close` as arithmetic; (b) a solver plan with several answers as a Choice (square); (c) numeric plans (tearing, Newton) as Ters code (polar, fall); (d) solves relate.ts runs (magnitudes to, brighter), each a row if it earns one. Done: (a) for solver plans (C195a, 2026-11-06), (b) for ways without a periodic parameter (C195b, 2026-11-09). Mode plans with one answer or none (greet) done too (C195c, 2026-11-09). Left: periodic ways (polar's angle, which also stops relations' main), and solves relate.ts runs with several answers (backwards' magnitude, cuts, read numbers). Periodic ways, found 2026-11-09: to polar is a several-answer definition that main reads through first, so the solve is in CPS code, not under the first. The solver's stream goes by levels, L = 0 to 10^4, each the whole plan again with every k from −L to L, giving only answers no earlier one had and stopping at a level L > 0 with none new. Written out exactly, that is a loop over levels, a k list built per level, and a dedup check that runs the plan again over every earlier path, all in CPS: a large step. The cheaper way, level 0 when a first takes the answer, needs the first to be seen through the definition's call (first-arms.ts could carry it) | Compiler lane 2026-11-06 (lab wasi survey) | P3 | L | |
| C187 | Fibers in WASM (JSPI, or the stack switching proposal): a program's own handlers that keep the rest, and together and race, as C44 runs them natively. Example: fibers-c.test's generator and together, run through `lab build --wasm` printing what lab run prints. Checked 2026-11-06 04:10 (Editor lane): this container's Node 22.22 has neither (`WebAssembly.Suspending` undefined even with --experimental-wasm-jspi). Headless Chromium 141 has JSPI on by default, but JSPI resumes a suspended stack only through a promise, so a case's `rest(y)` can't give the fiber's answer back synchronously as C44's does: the whole program would have to run under `promising`, every rest a suspending import. The stack switching proposal (WasmFX: cont.new, resume with `(on tag label)`, suspend) is C44's fibers one to one and synchronous. Chromium 141 validates it behind `--js-flags=--experimental-wasm-wasmfx`, but a resume with an on-label handler of a tag [] -> [] failed to compile there ("handler generates 0 operands, target block returns 1"), so V8's encoding of handlers needs checking first. Start with that one-tag module, and run tests in Chromium with the flag | C44 | P3 | L | |

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

### Numbers (NUMBERS.md)

| id | item | source | pri | size | status |
|---|---|---|---|---|---|
| L44 | Linear maps, geometry and matrices ([MATRICES.md](docs/design/numbers/MATRICES.md)). Example: a program's rotation function compiled as a matrix product. Left: the compiler stores linear functions as matrices (C lane, C30b/c) | LANGUAGE-REVIEW-2026-10-24 | P1 | M | a-g done |
| L118c | The evaluator compiles each definition to JavaScript closures once (closure compilation, Feeley and Lapalme 1987), keeping the heap continuation only where a search or a handler needs it; likely 3-10x on all interpreted code; notebook's Run takes 3.2 s for 100 notes, half of it the evaluator's own machine (GAPS.md round 6 N6) ([EVALUATOR-SPEED-2026-10-31.md](docs/reports/EVALUATOR-SPEED-2026-10-31.md) step 2). For later: Ersagun stopped L118 after step 2. Measured 2026-11-05 (Editor lane): notebook with 500, 1,000 and 2,000 notes and as many queries, `lab run` against the same program compiled through the core IR (`lab compile`): the run itself (startup of 6.3 s taken off) 5.4 s against 0.25, 19.9 against 0.44, 76 against 2.0, 22 to 45 times; nearly all of it the evaluator's own machine (run.ts going, step, resume, apply). So it would earn far more than 10%. First step done (Editor lane, docs/process/DONE.md): `lab run` runs a main that lowers through the core IR's JavaScript, the evaluator for the rest; what is left is the evaluator's own speed, for what doesn't lower and for the editor's Run | Ersagun 2026-10-31 | P3 | L | for later |

### Data and representations (DATA-STRUCTURES.md, REPRESENTATIONS.md)

| id | item | source | pri | size | status |
|---|---|---|---|---|---|
| L101 | **Later goal**: multithreading where uniqueness allows it (rayon), effect rows deciding what runs side by side (§5) | Ersagun 2026-10-29 | P3 | L | |

### Effects and concurrency (ANSWERED-LATER.md, EFFECTS-REVIEW-2026-10-24)

| id | item | source | pri | size | status |
|---|---|---|---|---|---|

### Relations and totality (BACKWARDS.md, MODES.md)

| id | item | source | pri | size | status |
|---|---|---|---|---|---|

### Grammars, modules and sharing

| id | item | source | pri | size | status |
|---|---|---|---|---|---|

### Physics and planning ([PHYSICS-AND-PLANNING.md](docs/design/physics/PHYSICS-AND-PLANNING.md), later goals)

Ersagun 2026-11-01: fast bodies passing through each other, and A* for an
agent with inertia. All later goals.

| id | item | source | pri | size | status |
|---|---|---|---|---|---|

### Someday

| id | item | source | pri | size | status |
|---|---|---|---|---|---|
| L24 | Research as it becomes blocking: costs from folds, laws proved by fusion, fast invertible parsing | ROADMAP 8 | P3 | L | |

### Blind spots ([BLIND-SPOTS-2026-11-03](docs/reports/reviews/BLIND-SPOTS-2026-11-03.md))

| id | item | source | pri | size | status |
|---|---|---|---|---|---|

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
| T14 | The slowest single tests (steps a to m done, DONE.md). Example: editing.test.ts's swapAndUndo, 20 s now; done at 5 s. Left: the graph's wire values running fall backwards after each pick (editor/main.ts traceInputs), resolving arith.ts for each version's search was 8 of its 34 s (2026-11-05 17:00): the library's resolving seed was never made after #1860, fixed by #1928, 27 s since. Of the 27, the palettes' whole checks are 6 s: 266 checks, 213 of them refused because the filling breaks the held definition's pin ("is pinned to (a, a, a) -> a …, and this makes it (Float64, …)"). Those are refused before the check now (E103h): swapAndUndo 27 to 24 s. Beyond it, a row each if they earn one: the next slowest file (swapAndUndo 29 s on main at 18:20, 20 s after E103i: its two pages each check the library once, no repeat; the rest is drawing's types 4.2 s and the palettes' whole checks 3.6 s; simplifyAppend 14 to 12 s by T14n: a value written into a hole was checked with no options, so the library was checked a second time; listItems 12.0 s, implementInterface 13.5 to 5.9 s by T14o: a click on a side link that isn't there waited 5 s and was caught silently; the file's other silent catches don't wait), measured by stage. Measured, not built (2026-11-05 19:40): the whole editing.test.ts is 225 s, of it model.ts nodesWhere's own scan 25 s (Object.values of the ~27,000 nodes, for a program not on the library's layer) and the garbage collector 29 s; scanning by id instead took 225 to 219 s, under 10%; keeping the scan per version of the nodes would earn more, if code.nodes is never changed in place, which isn't checked yet | [TEST-SPEED-2026-11-03](docs/reports/TEST-SPEED-2026-11-03.md) | P3 | M | |

## Coordinator and process

Not lane work; the coordinator does these or asks Ersagun.

| id | item | source | pri | status |
|---|---|---|---|---|
| P2 | Batch deploys if Actions cost needs it | Ersagun 2026-10-23 | P3 | asked, not requested |
| P3 | A per-repo Actions budget, or a public repo for free Actions | thread "GitHub Actions cost" | P3 | Ersagun's call |
| P7 | A foundation row every fourth item in each lane; the weekly review tracks kind tests across the code (2,805), tests reached by a one-line text.ts edit (145/150 + 44/44) and readers of a kind's fields | [FOUNDATIONS-2026-11-03](docs/reports/reviews/FOUNDATIONS-2026-11-03.md) §10 | P2 | |
| P8 | Add a LICENSE (and say what examples and programs written in Ters carry) once Ersagun picks one | [BLIND-SPOTS-2026-11-03](docs/reports/reviews/BLIND-SPOTS-2026-11-03.md) §3 | P1 | Ersagun's call |
