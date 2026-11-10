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
Rows once held back as later goals are open again (Ersagun 2026-11-09):
a lane takes them when bugs and goal rows are in hand.
**Size:** S hours · M one PR · L several PRs or a design note first.
**Status:** ▶ running · ⏸ held · blank = waiting.

## Next up

| lane | thread | next, in order |
|---|---|---|
| E Editor | "Editor lane" | E103, then Language or Compiler rows agreed with those lanes |
| C Compiler and targets | "Compiler lane" | C187 (fibers in WASM); C184 with the Editor lane |
| L Language and library | "Language lane" | C43 (first where, then a Choice's answers), C42 (associative folds), then L182 when unblocked (core, run.ts, infer.ts, hosts.ts) |
| L Language and library | "Language lane B" | C199c (the Android shell, NATIVE-APPS.md); C58, C59, C200 and C60 wait for a program that needs them; round 12's I187 is with the Editor lane. Skip L107 (waits on Ersagun) and L24 (research). Take a row from another list only after telling that lane. |
| T Testing | "Replace the slow browser smoke test" | I64, then the smoke's replacement |

## Inbox

New items land here until the next triage gives them a lane and a priority.

| id | item | source | added |
|---|---|---|---|
| I196 | Calculus's `newton` opens with an empty Run again ("Give f, slope, guess a value"), or after other definitions on "The search found no result": a regression of #744 (QA11 L2), which started it from main's call with `1.324718`. A definition whose inputs are functions lost its seed from main. | QA 11-10 L1 | 2026-11-10 |
| I193 | Checking any program types the whole library first (43,568 nodes): 2.5 s per process before a program's own definitions, and `ters run examples/wc` on empty input takes 4.5 s where the compiled wc.js takes 0.15 s. Every test file, the MCP and the editor pay it at start. The library's definitions are pinned with their types (signatures.ts), so `infer` should type a program's own definitions and read the library's types from their pins, typing a library body only when something asks for it; the Unicode tables (cases.json) load only when a program uses them. Example: `ters check examples/wc` under 1 s, kept by a budget in the suite (todo test R10 §2, which counts typed nodes) Left (2026-11-09, I193a): the library's check, hashes and order-free hashes are kept on disk in .lab/ and read back by each process (library-store.ts), and the grade check makes its runner only for a program with an algebra: `ters check examples/wc` 3.25 to 1.2-1.3 s, `ters run` on empty input 3.1 to 1.5 s, after the first process. After I193b (2026-11-10, sources stripped once and kept): 1.06 s; after I193c (the library found by its files, not hashed): 0.94 s. What's left is Node loading the sources (main.ts imports every command's modules, the compiler's too), the kept check read back (about 0.25 s), and a first run after any change to src/. The R10 §2 todo still counts typed nodes, which the kept check doesn't lower; typing library bodies only on demand would. | [REVIEW-2026-11-09](docs/reports/reviews/REVIEW-2026-11-09.md) §2 | 2026-11-09 |
| I195 | One gallery example is left out of the core-IR agreement test (compiler/test/core-js.test.ts) because the evaluator, which defines the meaning, is too slow: `agent`'s A* search takes minutes. L118c (a faster evaluator) would bring them back and is held by Ersagun. Example: core-js.test checks agent against the evaluator with no skip Left (2026-11-09, I195a): `numbers` is back, checked as `ters run` stores it (Nat as Int, 0.4 s in the evaluator); `agent` still takes over 400 s in the evaluator even stored, so it waits on L118c. Measured 2026-11-10 after L118c (functions that only compute compiled): `agent`'s main still over 15 min in the evaluator: 43 million calls in the first minute, nearly all of them already run as compiled JavaScript (direct), so it is the amount of work, not the machine; L118e (refs to definitions not looked for in the scope) made it 12% quicker. | [REVIEW-2026-11-09](docs/reports/reviews/REVIEW-2026-11-09.md) §5 | 2026-11-09 |
| I192 | A few definitions still freeze 0.5 to 1 s on opening: machine `all digits` 1.0 s, break `shifted` 1.0 s, ray marcher `shadow`, Spacetime `rapidity picture`, Constructions `is picked`, calc `blank` 0.83. Measured 2026-11-09 18:00 (Editor lane, twice each, the click to the next frame and the long tasks): `all digits` 0.36 s (one task of 0.30), `shifted` 0.26 (0.22), `is picked` 0.46 (0.41), `blank` 0.34 (0.27): I189's remainder, the long run's piece and one view. `shadow` 1.24 s (0.42 + 0.63): the long run's pieces too, its views each a call of the evaluator, then the drawing. New: `rapidity picture` 1.15 s in one task of 1.0, all drawing, no evaluator: the graph laid out and routed 0.32 s (tidyScene, arrange, route, crossings), the blocks 0.17, the graph's hooks 0.13 (Spacetime's algebras found once, 0.06, and the trace), the page laid out when scrolls are put back 0.15. Next: the graph of a big definition drawn in less (what is shown first, the layout kept between opens). I192a (this PR's DONE row): opening from the list or a tab drew the page twice, and a definition of over 400 nodes draws its graph in a task of its own: `rapidity picture` opens in 0.24 to 0.39 s then 0.30 for its graph (was one task of 0.68 to 0.92). Left: the picture's own run after, I189's pieces of 0.4 to 0.7 s, the same before and after. Measured 2026-11-10 after L118c2-c4 and I192b (click to frame, twice each): `all digits` 0.27 to 0.35 s (one task of 0.23 to 0.29, of it the backward search of its graph, relate.ts, 0.18), `shifted` 0.15, `is picked` 0.26, `blank` 0.22, `shadow` 0.73 (two of 0.28), Spacetime `scalar part`'s views 0.25. What's left is mostly the backward search (relate.ts, its own interpreter) and drawing. | QA 11-09 L1 | 2026-11-09 |

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
| E103 | **Bug.** Adding a value in a definition run backwards is slow (five stages and E133, E103c to e and L226 so far, DONE.md). Example: physics `fall`'s holes, 72 s for all 23 and the worst 18 s (2026-11-05); its 8 call holes 119 to 34 s from cold, the worst 41 to 14.5 s, by refusing offers the callers can't use before a whole check (E103f), and before their plans are worked out (E103g: on main since, 37 to 23 s, the worst 16 to 5.9 s); done when the worst takes under a second. 2026-11-05 20:50, 17 holes now: 46 s, the worst 6.7 s; E103j 27.6 s, the worst 4.0 s (fillings alone 2.5 s, the rest the hole's first check). Measured 21:30: in the worst hole (a ref, 201 offers) 1.6 of its 2.7 s is the plans compared per offer, 245 of them at 6.7 ms, 205 the same as the program's; nearly all of it is the group's own mode (fall's body) worked out again, its callees already kept as published ones (keeping an unpublished callee's for the offers, E103k, was tried: 8 of 259 asked, not built). A literal at the hole is a given goal whatever its value, so literals could share one plan; a reference can't, since where a let names it or a higher-order call takes it the callee's mode changes. Left: the plans compared per offer (solveMode, about 4 ms each, 2,019 for one hole with 7 distinct answers) and the checks of the group. Next idea: where only a plan changes, check the solves' verdicts instead of a whole inference (reusing a verdict across callees needs a fingerprint of the callee's modes, not cheap and sound yet). Measured 23:10 (main at #2014): the 17 holes 17.8 s, the worst 1.9 s (cp3j3f), but 0.85 s of that is the first offer of steady sin and steady log working out their modes once per session (whichever hole offers them first pays it); without it the worst is mirt1t, 1.8 s, of which about 1.1 s is 110 checks of the group (one per different outcome among 268 fillings, ~10 ms each) and the plans are under 1 ms an offer. A field called on holes always made the program's plan at each hole (1,161 of 1,178), but sharing that plan bought nothing, since those plans were cheap. Left: the group's check per outcome (fewer outcomes, or a cheaper check of fall), and steady's modes worked out at build time rather than on first offer. Measured 2026-11-06 04:00 on a slower machine (the program on the library's layer, as the editor has it): 20.5 s, the worst 2.3 s; E103l 19.6 s, the worst 2.2 s. The worst's profile is spread: the group's checks (byKind, inlined), modes' run and ask, collection, nodesWhere's filters of the library's builtins for each definition with results. Measured 2026-11-07: 19.4 s, the worst 2.3 s (the first hole, paying steady's modes) and 2.1 s (cp3j3f), whose 1.2 s is newPlans: 245 plans worked out for 201 offers, 4 distinct; every call of a builtin (35), field (76) or constructor (4) with holes gave the program's own plan, and 67 of 73 calls of definitions did, but nothing yet shows the builtins' always do (an equation's sqrt of a hole could change its answers), so it isn't skipped. Next: the modes analysis of the group per offer (solveMode, about 5 ms), not the palette Measured 2026-11-09 (17 holes, 18.5 s, the worst 2.2 s): every call with holes, of a builtin (33 of 595 differ), a field (38 of 1,178) or a definition (160 of 1,259), can change the plan, so no skip by what an offer is. fall's own mode per offer is 1,641 search steps in all, cheap; the worst hole's extra 1.4 s is steady sin, reduced, scaled, two to and exponent worked out backwards once per session (4,096 paths each), and the rest is the group's whole checks, 707 over the 17 holes at about 13 ms. E103n (this PR's DONE row): a filling that makes a solved definition act is refused without one, 545 left, 17.0 to 17.4 s against 18.4 to 18.5 s, the same offers. Of the 454 checks that refuse, 166 more are main printing while a Choice from fall is open, which needs main's handlers to predict. Keeping the first such refusal for every other filling that brings a search's Choice was tried: it lost offers (a trig operation's log, asin, acos and divide, whose Choice signs.ts drops where main's inputs answer it, as it does through definitions), so a sound version needs signs.ts's totalCall per filling. Left: those, the checks that pass (253, each a different group type), and steady's backward modes before the first offer (E103o, this PR: library/steady-modes.json, steady's modes forwards and backwards without their plans, 200 KB; cp3j3f 2.2 to 0.85 s, the 17 holes about 16.6 to 14.7 s, the worst now mirt1t, 1.9 s, the first hole paying its own library modes) Measured after (19:00): mirt1t's 2.2 s has no mode over 70 ms left; 1.3 s of it is its ~100 whole checks of the group and its callers (byKind, about 12 ms each, main the biggest), and 0.4 s the analyzers of the offers' programs. What is left needs a cheaper whole check: checking only what a filling changes in the callers (an incremental check), not more cuts of which fillings are checked. E103p (2026-11-09): a whole check of a filling was about half fixed work over the whole program, 6.7 ms of it even with nothing rechecked (every definition's kind, results and implementation looked at again, every call and number scanned, every kept type zonked), and its callers only about 3 ms; it now looks only at what it rechecks, about 1 ms. The 17 holes 14.4 to 16.7 s against 11.3 to 12.6 s, the worst 1.8 to 1.4 s, the same offers. Skipping the callers' check where each use is an instance of the group's new type was tried: 9 of 340 checks, not built. Left: the group and its callers inferred again for each outcome (about 8 ms a check, main the most). Measured after E103p and I193a (2026-11-09, the 17 holes 11.5 to 12.4 s, the worst mirt1t 1.3 s): of the fillings' time, the group's whole checks are 4.2 s, the plans compared per offer 3.4 s and the baseline and direction rechecks 2.4 s. Inside the plans, 2.5 s is ports.ts filledFrom copying all 43,000 nodes, 28 ms each time, for the 51 offers that bring a use with no body plus each hole's first offer; the modes analysis itself is about 1 s. Filling those offers into the one kept copy instead was tried: it changed the offers and was ten times slower, which points to a cache keyed by the nodes object (later-ops.ts, model.ts sizeOf) reading a copy changed in place. Next: find that cache, then share the copy. Memoizing byPieces's `mentions`, quadratic, bought nothing measurable (terminates runs 4 times a hole). | E100 | P3 | M | |

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
| C200 | tumble's lists stored as the costs choose (arrays: its board read by position), where they are kept as written today: a Cell of the program's lists (a lane's `queue`, `swaps`, its Board) is made on one side and read by the page on the other, and rep-split.ts refuses a Cell holding lists (a cell can't be converted where it is read). A cell made on the stored side could convert at each `read` and `write` on the other, as a field of a stored type converts. Measured 2026-11-10 (Language lane B): settling a scattered board, the most a tap makes, takes 80 µs in compiled JavaScript (2000 boards in 161 ms), against 16 ms a frame, so arrays could save at most a fraction of that: not worth building for tumble. It waits for a program whose cells hold big lists. Example: `ters compile examples/tumble` choosing `array of List` beside main's lists, the same page | C196 (its last refusal, 2026-11-09) | P3 | M | |

### Speed of compiled code

| id | item | source | pri | size | status |
|---|---|---|---|---|---|
| C184 | The pedal's sound from the core IR as quick as compile.ts made it. Measured 2026-11-05 on one machine (bench-audio.ts): the core IR 0.037 ms a block, compile.ts's last 0.021 (its 0.036 on the machine first measured), by hand 0.009; the core IR is 4.0× the hand-written pedal. Where the core IR's time goes: building the block as a cons list and reading it back (sound.ts toList, fromList) 13%; the finite checks before each comparison 11%; the depth counter under 1%; the rest is the cons cells and the pairs a mapping-with-state builds per sample. The gap is compile.ts's lists as arrays chosen from use, which the core IR has only through the language's `array of List` row (C30). Why the pedal's lists stay as written (checked 2026-11-06, Compiler lane): `ters render --compiled` and `soundOf` lower the program as given, and with the chooser run on the sound's root (represented.ts) it still picks `List as written`, since by the declared costs a list read only in order is cheapest as a cons list; forced to `array of List`, listBoundary refuses it for the page's `styles` (an Html, a library type holding lists, which the sound never reaches), and with the program cut to what the sound reaches, for the bands' solve (a relation run backwards over a list). So the step left is the costs (an array's read in order, cheaper than a cons cell's in compiled JavaScript) and a solve over an array. Measured again 2026-11-06 (Compiler lane): the core IR 0.021 ms a block, 2.9 to 3.0× by hand (compile.ts was 2.3× by hand, so the aim is about 2.6×). A profile of the block alone: the tanh solve 16% (its answers made as a list of arrays, `solve$`, `solve$$direct`, `$clean`; `drive` is `first` over every answer of a solve that has one at most, so a solve known to give at most one answer could be a call that fails when it gives none, with no list and no chooser), the garbage collector 11%, `gain for`'s finite checks 9%, the bands' mode plan 3%. A solve of one answer or none is a call now (C184 step, DONE.md): 0.0204 to 0.0187 ms, about 2.65× by hand. Example: compiler/gaps/bench-audio.ts's core IR row within 1.1× compile.ts's on the same machine | Ersagun 2026-11-05 20:00 (what compile.ts did that the core IR doesn't yet) | P3 | S | |

### Memory and layout (STABLE-REFERENCES.md §3 to §6)

All invisible to programs: no annotations or hints (Ersagun 2026-10-29).

| id | item | source | pri | size | status |
|---|---|---|---|---|---|
| C57 | A region per scope: temporaries of one page update, audio block or frame freed at once (Tofte–Talpin) | STABLE-REFERENCES.md §4 | P3 | L | |
| C58 | Keyed collections as a grow-only array with a free list and generational keys (ECS) | STABLE-REFERENCES.md §4 | P3 | M | |
| C59 | Flat inline layout for data built once and read, doubling as a file format (FlatBuffers). Measured on notebook after C71/C72 (GAPS.md round 6, N3: about 10% left for it there, 4.4× the ideal with no one hotspot): its index is built once with one holder (8.5× the ideal on trees) and then only read by every question (8×); a frozen map as sorted key and value arrays makes `entries of` free and `value at` a binary search. 2026-11-06 at 3000 notes (nb profile): questions are 43% of the run (seen with, like line, any scores), the index 22%; `value at` read without a list or a throw took the table way from about 365 to 300 ms against an ideal of about 83 (4.4× to 3.6×), texts compared where they differ (#2095). A frozen map would buy notebook little now: `value at` on the hash table is one lookup and `entries of` a version is sorted once (C72). What's left is spread: `credit`'s `update at` per word makes a new table version and a closure (made as `{ caps }` instead of a function, no change measured), GC 12% | STABLE-REFERENCES.md §4, GAPS.md round 6 N3 | P3 | M | after C70, C71 |
| C60 | A list of records stored as columns when its loops read few fields. Step 1 measured 2026-11-09 by hand in plain JavaScript (100,000 records of six Float64s, median of 9): summing one field 68 ms as objects against 13 ms as a column (Float64Array or plain array alike); moving each (x += vx, y += vy) 179 ms making new records, 9.7 ms changing them in place, 3.6 ms as columns. So columns pay 2.7 to 5 times, but only once three things hold, none of which does today: the list is an array (of the 39 examples only pedal keeps a list of records as one, its pairs: C196), an array read makes no object (C196 (a): today a view, an option and a pair each), and a record is changed in place rather than rebuilt (C93 s5, C56), which is the 18 times. Those three hold since 2026-11-09 (C196 steps, C56). Looked at again then: the lists of records now arrays are agent's (Vec, Triangle, Portal, Leg), spacetime's (Moment, Spacetime multivectors) and pedal's pairs, and each loop over them reads all or most of the record's fields (a point's x and y, a moment's four, a multivector's sixteen in a product), so columns would buy nothing yet. Agent's compiled run spends 45% in `point` (mesh.points by position), which turns the whole Array of points into a cons list on every read: `point` is on the side kept as written, so `item at` there goes through `items` (passed to the Compiler lane, C196). Waits for a program whose loop reads one or two fields of many records (a physics program's bodies moved by velocity while their colour, mass and name sit unread); then columns on JavaScript, WebAssembly and C |
| C61 | Where code runs chosen by cost, never written (workers, GPU compute, main thread). Designed: [WHERE-IT-RUNS.md](docs/design/targets/WHERE-IT-RUNS.md) (Bend 2 read; a worker measured: a copy is about 20 ns an item there and back, a transfer of a one-holder array nearly free; leaving the main thread is asynchronous, so only a caller that can wait). (a) done: WebGPU measured (compiler/gaps/bench-places.ts; about 3 ms a dispatch and 20 ns an item to move, so only work well above that per item pays: 8× at a million items of 100 steps, even emulated). Next: (b) a price list per target, (c) workers for a pure map, (d) the GPU for a map, (e) divide and conquer | STABLE-REFERENCES.md §6 | P3 | L | |

### Mobile (Ersagun 2026-11-09: a goal; native compilation per platform a stretch goal, instead of a webview)

| id | item | source | pri | size | status |
|---|---|---|---|---|---|
| C198 | Revive `ters build-app` and run one app on a phone. It makes an installable web app (manifest, service worker, icons) that is also a Capacitor project for Android and iOS (ters/cli/app.ts, WEB.md "Mobile"), untouched since 11-02, and no app has been run on a phone that we know of. Check it still builds on today's `ters build-web`, works offline once installed, and that the Capacitor project builds an Android APK; ask Ersagun to install it, since containers can't reach a phone. Example: `ters build-app` of dice installed on a phone and played offline. Found 2026-11-09 (Compiler lane): it builds, and plays offline in Chromium; containers can't reach Google's Android SDK, so the Actions workflow "Android app" (#2146, run by hand) builds the APK; waiting on Ersagun to install it | I194 (REVIEW-2026-11-09 §6); Ersagun 2026-11-09 | P2 | M | Compiler lane |
| C199 | Stretch: native apps per platform instead of a webview. Designed in docs/design/targets/NATIVE-APPS.md (2026-11-10): the program through the C target, a thin native shell per platform, and a view host in C mirroring html.ts's `Doc` and `El`; steps C199c to C199e (C199a, C199b done). Example: dice as a native Android app with no webview | Ersagun 2026-11-09 | P3 | L | C199a to C199e |
| C199c | The Android shell: a Kotlin Activity with a JNI view host, the program's C built by the NDK, a command writing the Gradle project, and the APK from the "Android app" workflow (NATIVE-APPS.md). Example: dice as an APK with no webview, installed by Ersagun. Built 2026-11-10 (Language lane B): `ters build-native-app` writes the Gradle project (ters/cli/native-app.ts: the page's C with a JNI view host, and a Java MainActivity making Android's views; Java, not Kotlin, so Gradle needs no Kotlin plugin), its C and JNI side checked on a desktop JVM (compiler/test/c-native-app.test.ts); the "Android app" workflow's `kind: native` builds the APK. Left: a green APK build, then Ersagun installs it | C199 | P3 | M | Language lane B |
| C199d | Layout and style for native apps: Yoga for flexbox and a CSS subset checked at build time, refusing each property it can't map (NATIVE-APPS.md). Example: dice's layout and colours on the phone match the web page, light and dark | C199 | P3 | M | after C199c |
| C199e | The iOS shell: a Swift view host over UIKit (NATIVE-APPS.md). Needs a macOS runner (about 10x a Linux minute against the $20 Actions budget): Ersagun's call. Example: dice on an iPhone simulator | C199 | P3 | M | waits on Ersagun |

### Parallel and concurrent code on the targets

| id | item | source | pri | size | status |
|---|---|---|---|---|---|
| C42 | Associative folds on a thread pool (a `map` of a function that only computes shares its items on workers since C42a, examples/mandelbrot-rows), later maps and folds as compute shaders (NESL, Futhark) | LANGUAGE-NEEDS-2026-10-24 | P3 | L | |
| C43 | Or-parallel `all`/`count` and speculative `first` in canonical order, with work stealing (Cilk, Aurora/Muse). Since C43a a `keep` whose test only computes shares its items on workers (examples/collatz), and since C43b `all pass` and `any pass` whose test ends (examples/nicomachus), stopping past the first deciding item; left: `first where` (its answer an Option the runtime would build), then a Choice's answers (`all`, `count`, `first` of one) by its first choice's alternatives | LANGUAGE-NEEDS-2026-10-24 | P3 | L | |
| C195 | Relations in WebAssembly and C: a solve has no lowering outside JavaScript, where it is the evaluator's solver or a plan printed as JavaScript text (core-solve.ts, modes.ts), so `ters wasi` and `ters native` stop at "solves a relation (not in this profile yet)" (scalar.ts solveUse). A plan written as code the scalar profile lowers (as `derive` writes a derivative) would reach every target. Example: `ters wasi` of examples/relations, backwards, conjugate and physics printing what `ters run` prints (the other 16 examples with a main that isn't a page already do, 2026-11-06). Surveyed 2026-11-06 04:00 (Language lane, which took the row): no one step gets an example there, since each needs a different kind of solve. relations: split and add are solver plans with one way (`once`), square has two answers, polar is numeric or periodic. backwards: angle is `once`, greet a mode plan, magnitudes to is neither (relate.ts runs it). conjugate: brighter is neither (a conjugation of closures). physics: fall is numeric, rotate periodic. Steps: (a) a `once` solver plan (relation.ts compileSolve's `$one`) and a det or semidet mode plan (modes.ts) written as Ters definitions the scalar profile lowers, with `$clean`'s 12-digit rounding as a builtin on C (`%.12g`) and WASM, `$ok` and `$close` as arithmetic; (b) a solver plan with several answers as a Choice (square); (c) numeric plans (tearing, Newton) as Ters code (polar, fall); (d) solves relate.ts runs (magnitudes to, brighter), each a row if it earns one. Done: (a) for solver plans (C195a, 2026-11-06), (b) for ways without a periodic parameter (C195b, 2026-11-09). Mode plans with one answer or none (greet) done too (C195c, 2026-11-09). Tears of one unknown in a search (physics' fall) done too (torn.ts, 2026-11-09). Periodic ways where only a first takes the answer (physics' rotate), and for some over one predicate, done too (2026-11-10): physics prints on WASM and C what ters run prints. A first of a call of a definition that is one such solve (relations' to polar) writes its body in place there (2026-11-10): relations prints on WASM and C what ters run prints. Left: periodic ways in a search whose every answer counts (all, count), and solves relate.ts runs with several answers (backwards' magnitude, cuts, read numbers). Periodic ways, found 2026-11-09: to polar is a several-answer definition that main reads through first, so the solve is in CPS code, not under the first. The solver's stream goes by levels, L = 0 to 10^4, each the whole plan again with every k from −L to L, giving only answers no earlier one had and stopping at a level L > 0 with none new. Written out exactly, that is a loop over levels, a k list built per level, and a dedup check that runs the plan again over every earlier path, all in CPS: a large step. The cheaper way, level 0 when a first takes the answer, needs the first to be seen through the definition's call (first-arms.ts could carry it) | Compiler lane 2026-11-06 (ters wasi survey) | P3 | L | |
| C187 | Fibers in WASM (JSPI, or the stack switching proposal): a program's own handlers that keep the rest, and together and race, as C44 runs them natively. Example: fibers-c.test's generator and together, run through `ters build --wasm` printing what ters run prints. Checked 2026-11-06 04:10 (Editor lane): this container's Node 22.22 has neither (`WebAssembly.Suspending` undefined even with --experimental-wasm-jspi). Headless Chromium 141 has JSPI on by default, but JSPI resumes a suspended stack only through a promise, so a case's `rest(y)` can't give the fiber's answer back synchronously as C44's does: the whole program would have to run under `promising`, every rest a suspending import. The stack switching proposal (WasmFX: cont.new, resume with `(on tag label)`, suspend) is C44's fibers one to one and synchronous. Chromium 141 validates it behind `--js-flags=--experimental-wasm-wasmfx`, but a resume with an on-label handler of a tag [] -> [] failed to compile there ("handler generates 0 operands, target block returns 1"), so V8's encoding of handlers needs checking first. Start with that one-tag module, and run tests in Chromium with the flag | C44 | P3 | L | |

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
| L118d | Functions with a choice in their type still run step by step on the evaluator's heap machine, after L118c (functions that only compute run as compiled JavaScript): about half the notebook's machine calls. Tried twice 2026-11-10 (Editor lane) and set aside: trying them directly hung json.test (a stop deep in a recursive descent reran every outer call), and finishing a stopped caller on a machine of its own was slower (notebook 4.2 s against 2.5). L118d1 (2026-11-10): the bodies of first, optional, all and count that only compute and choose run with success continuations; notebook 2.55 to 2.0 s. Left: a function with a choice called where nothing handles it yet (its caller's handler on the machine). Example: notebook's Run with 300 notes under 1 s in process (1.85 s now) | L118c (Editor lane 2026-11-10) | P3 | M | |

### Data and representations (DATA-STRUCTURES.md, REPRESENTATIONS.md)

| id | item | source | pri | size | status |
|---|---|---|---|---|---|

### Effects and concurrency (ANSWERED-LATER.md, EFFECTS-REVIEW-2026-10-24)

| id | item | source | pri | size | status |
|---|---|---|---|---|---|

### Relations and totality (BACKWARDS.md, MODES.md)

| id | item | source | pri | size | status |
|---|---|---|---|---|---|

### Grammars, modules and sharing

| id | item | source | pri | size | status |
|---|---|---|---|---|---|

### Physics and planning ([PHYSICS-AND-PLANNING.md](docs/design/physics/PHYSICS-AND-PLANNING.md))

Ersagun 2026-11-01: fast bodies passing through each other, and A* for an
agent with inertia: built as L119 to L124 (DONE.md).

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
| T14 | The slowest single tests (steps a to p done, DONE.md; shaderOpens 27 to 19 s by T14p). Example: editing.test.ts's swapAndUndo, 20 s now; done at 5 s. Left: the graph's wire values running fall backwards after each pick (editor/main.ts traceInputs), resolving arith.ts for each version's search was 8 of its 34 s (2026-11-05 17:00): the library's resolving seed was never made after #1860, fixed by #1928, 27 s since. Of the 27, the palettes' whole checks are 6 s: 266 checks, 213 of them refused because the filling breaks the held definition's pin ("is pinned to (a, a, a) -> a …, and this makes it (Float64, …)"). Those are refused before the check now (E103h): swapAndUndo 27 to 24 s. Beyond it, a row each if they earn one: the next slowest file (swapAndUndo 29 s on main at 18:20, 20 s after E103i: its two pages each check the library once, no repeat; the rest is drawing's types 4.2 s and the palettes' whole checks 3.6 s; simplifyAppend 14 to 12 s by T14n: a value written into a hole was checked with no options, so the library was checked a second time; listItems 12.0 s, implementInterface 13.5 to 5.9 s by T14o: a click on a side link that isn't there waited 5 s and was caught silently; the file's other silent catches don't wait), measured by stage. Measured, not built (2026-11-05 19:40): the whole editing.test.ts is 225 s, of it model.ts nodesWhere's own scan 25 s (Object.values of the ~27,000 nodes, for a program not on the library's layer) and the garbage collector 29 s; scanning by id instead took 225 to 219 s, under 10%; keeping the scan per version of the nodes would earn more, if code.nodes is never changed in place, which isn't checked yet | [TEST-SPEED-2026-11-03](docs/reports/TEST-SPEED-2026-11-03.md) | P3 | M | |

## Coordinator and process

Not lane work; the coordinator does these or asks Ersagun.

| id | item | source | pri | status |
|---|---|---|---|---|
| P2 | Batch deploys if Actions cost needs it | Ersagun 2026-10-23 | P3 | asked, not requested |
| P3 | A per-repo Actions budget, or a public repo for free Actions | thread "GitHub Actions cost" | P3 | Ersagun's call |
| P7 | A foundation row every fourth item in each lane; the weekly review tracks kind tests across the code (2,805), tests reached by a one-line text.ts edit (145/150 + 44/44) and readers of a kind's fields | [FOUNDATIONS-2026-11-03](docs/reports/reviews/FOUNDATIONS-2026-11-03.md) §10 | P2 | |
| P8 | Add a LICENSE (and say what examples and programs written in Ters carry) once Ersagun picks one | [BLIND-SPOTS-2026-11-03](docs/reports/reviews/BLIND-SPOTS-2026-11-03.md) §3 | P1 | Ersagun's call |
