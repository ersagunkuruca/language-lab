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
| E Editor | "Editor lane" | L211's later step (a use's produced ports drawn as outputs), E228's rest, E231's rest; then E200b, E103 |
| C Compiler and targets | "Compiler lane" | C93's rest, C86, C40's rest; then C30, C67 |
| L Language and library | "Language lane" | next by priority from the table below |
| T Testing | "Replace the slow browser smoke test" | I64, then the smoke's replacement |

## Inbox

New items land here until the next triage gives them a lane and a priority.

| id | item | source | added |
|---|---|---|---|
| I154 | A list written out with a thousand items (a table of data pasted in) stops the checker: "Maximum call stack size exceeded" in infer.ts, which walks the list as a thousand nested calls of the list maker, one stack frame each (500 items check). The evaluator, staging and the compilers walk it the same way. Either walk a chain of the list maker in a loop in each pass, or keep a written list as one node of n items | C128 (fuzz test, 2026-11-03) | 2026-11-03 |

## E: Editor

### Bugs

| id | item | source | pri | size | status |
|---|---|---|---|---|---|

### Foundations ([FOUNDATIONS-2026-11-03](docs/reports/reviews/FOUNDATIONS-2026-11-03.md))

| id | item | source | pri | size | status |
|---|---|---|---|---|---|
| E228 | editor/main.ts (4,589 lines, 254 kind tests) split by job (a: one element maker, editor/dom.ts; b: run runtimes and views, editor/runViews.ts; c: the Guide, editor/guide.ts; d: the solver's derived program, editor/solverText.ts; e: the picture and the page, editor/pagePanel.ts, through a `PageHost`; f: the Selected panel's row, unit and Same as parts, editor/selectedParts.ts; g: values and test results, editor/runViews.ts; h: the navigator, editor/navigator.ts; i: Run main, editor/runPanel.ts) (selection, palette, run, files); the palette and inspector read L178's schema instead of switching on kinds | [FOUNDATIONS-2026-11-03](docs/reports/reviews/FOUNDATIONS-2026-11-03.md) §11 | P3 | L | |

### Writing programs in the editor

| id | item | source | pri | size | status |
|---|---|---|---|---|---|
| E237 | The editor's literals and display for library number types through L204's and L205's interfaces, not editor/typed.ts's own list (`EXOTIC`, the Rational literal paths) | [MATHEMATICS-AS-LIBRARIES](docs/design/numbers/MATHEMATICS-AS-LIBRARIES-2026-11-03.md) | P3 | M | after L204, L205 |

### Speed of editing

| id | item | source | pri | size | status |
|---|---|---|---|---|---|
| E200b | A click that only selects still redraws the whole graph. After step 1 (#1119) a click in Constructions is 55 to 120 ms: the inspector ~25 ms, the graph ~20, putting the scroll places back ~20 (the layout the new page forces). Step 2, patch the graph instead of drawing it again on a selection, has to redo everything the selection changes there: the `sel` class (every `[data-id]` but `.use-hit`), the lit binding and its uses (`scene.lit`, item groups, `.tw.use` wires), the resize grip of a selected node, and the layering that draws the selection's outermost frame over its neighbours (two groups per layer). The last needs elements moved between the groups, or a fall back to drawing when the selection's top frame changes. Worth it only if clicks still feel slow | [REVIEW-2026-11-02b](docs/reports/reviews/REVIEW-2026-11-02b.md) §4 | P3 | M | step 1 done; step 2 measured, not started. Measured again 2026-11-03: the first click after opening 120 to 180 ms (the parent indexes built once per version), the next ones 65 to 100 ms in Constructions, 45 to 80 in Tumble, under 55 in clinic |
| E103 | **Bug.** Adding a value in a definition run backwards (physics `fall`) takes about 4 s; five stages (#478 to #504) took fall's holes from 48 s to 18.5 s in all. Stopped by the 10% rule. **Measured again 2026-11-01:** 23 holes 121 s, the worst 22 s, of which the plan comparison per offer 5.7 s and whole checks for offers whose plan changed 10.4 s; E133a took the node copies off (→ 18 s); E133b took the analyzer's full scan per offer off (worst 12.7 s, all 23 holes 67 s); E103c (#898) checks once for every offer that makes the same of the group's types and plans, each offer's units on their own (fall's 23 holes 80 → 47 s, the worst 16 → 8 s, measured on a busy machine; same offers); E103d (#902): a filled program's solves and calls are listed from the program's, not by scanning its ~10,000 nodes in `useDirections` and the jobs check (all 23 holes 50 → 30 s, the worst 10.6 → 4.2 s; same offers); E103e (#938): an offer's units are checked once, not again inside its whole check (23 holes 30 → 23 s, the worst 4.2 → 3.7 s); **measured again 2026-11-01 21:40** (busy machine, all 23 holes ~31 s): the plans compared per candidate 8.2 s (7,452 plans, ~1.1 ms each), the type-group checks 10 s (2,229 distinct groups, ~4.5 ms each: an offer of another shape makes fall's own type another shape, so few share), the whole checks of risky offers 7.7 s (400, ~19 ms each; checking their units apart buys nothing). Stopped by the 10% rule: the next stage needs a new idea, such as checking a group's callers against its new type instead of a whole inference, or a plan that can tell from the filling alone that it can't change; what's left is the checks' own work. **Measured again 2026-11-02** (all 23 holes 29.7 s, the worst 5.2 s, fall's whole body): that hole asks 1,221 plan comparisons and 645 distinct type-and-plan checks for 113 offers kept, because a changed plan is part of the check's key and most candidates change it a little. The next idea is infer.ts's (Language lane): where only a plan changes, check the solves' verdicts (Diverge, how many answers) instead of a whole inference of the group | E100 | P3 | M | |

### Blind spots ([BLIND-SPOTS-2026-11-03](docs/reports/reviews/BLIND-SPOTS-2026-11-03.md))

| id | item | source | pri | size | status |
|---|---|---|---|---|---|
| E231 | Keyboard-only and screen-reader use of the editor, done part by part with E228's split (a: refused edits reachable and saying why, the unit chips, the picture, live status lines; b: the navigator by arrow keys, open programs marked; the QA format has both checks, WORKFLOW.md) | [BLIND-SPOTS-2026-11-03](docs/reports/reviews/BLIND-SPOTS-2026-11-03.md) §10 | P3 | L | |

### What a good language needs ([ASPECTS-2026-11-03](docs/reports/reviews/ASPECTS-2026-11-03.md))

| id | item | source | pri | size | status |
|---|---|---|---|---|---|
| E232 | Pause and step a run in the editor: stop at a node, step, see each effect answered so far, step back (on L186's log). Today "Show values" shows one finished run | [ASPECTS-2026-11-03](docs/reports/reviews/ASPECTS-2026-11-03.md) 204, 205 | P3 | L | after L186 |

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
| C137 | The compiled targets on one lowering. compile.ts (3,435 lines) lowers JS straight from the model while WebAssembly, C, WGSL and js-scalar share scalar.ts's core IR, so each feature is built twice in the compiler. (a) From now on nothing goes into compile.ts alone: a model-to-model pass or the shared lowering (written in compile.ts's header and CORE-IR.md); (b) done: `Lowered` is `CoreIR`, its contract in docs/design/targets/CORE-IR.md; (c) a JavaScript printer from it, grown until it runs compile.ts's examples, checked by I111 and the differential test: c1 to c17 done (`lab compile --core`, `lab build-web --core`; the evaluator's values; the evaluator's builtins with no lowering, by id; cells and page effects, the world's clock and draws, 6 pages agree; solves through the evaluator's solver, its budget spent, given closures that carry their nodes; core-js.ts: data, Int, Text, arrays, tables, seeded Random, searches, budgets, aborts, the world; every fuzz program and the 16 examples whose main lowers agree with the evaluator, core-js.test.ts), next: the pages and examples that don't lower (pig's handler parameter, tumble's Animate, designed in [PROGRAM-EFFECTS-2026-11-03](docs/design/targets/PROGRAM-EFFECTS-2026-11-03.md): evidence passing where each case resumes in tail position, continuation passing where a case uses the rest; a function choosing among several answers (conjugate, pedal; designed in [SEVERAL-ANSWER-FUNCTIONS-2026-11-03](docs/design/targets/SEVERAL-ANSWER-FUNCTIONS-2026-11-03.md): the convention from the type, steps c22 to c25); physics' polar, calculus' derivative and backwards' budget run since C137c19 to C137c21); deep recursion that isn't a tail call runs on the heap (C137c18); (d) compile.ts retired piece by piece | [FOUNDATIONS-2026-11-03](docs/reports/reviews/FOUNDATIONS-2026-11-03.md) §2 | P2 | L | |
| C138 | C30's aim first: an `array` representation of List written in the language and chosen by the representation layer, on the core IR, replacing compile.ts's 50 CONS/NIL tests and the per-target copies (C30d2, C30d3). C138a: the core IR takes the layer's arrays on JavaScript, WebAssembly and C, so compile.ts's tests go with C137. Left: compile.ts makes every list an array in compiled JS, while the chooser picks arrays only for programs reaching `length`, `item at` or `replace at`; measure (sort, queens, pedal on the core IR) whether the chooser should weigh a fold's or a cons's constant cost so more programs get arrays before compile.ts goes. C138b measured ledger: core IR 4–5× the ideal, compile.ts 2–3×, mostly garbage from `{tag, fields: [...]}` (two objects per constructor); next, one object per constructor on the core IR (fields as own properties, the evaluator's layout made at the boundary) | [FOUNDATIONS-2026-11-03](docs/reports/reviews/FOUNDATIONS-2026-11-03.md) §3 | P2 | L | |
| C139 | Library types out of the core passes: id tests on library constructors and functions (compile.ts 188, scalar.ts 152, run.ts 82) become representations or builtin records, retired with C137's printer | [FOUNDATIONS-2026-11-03](docs/reports/reviews/FOUNDATIONS-2026-11-03.md) §7 | P3 | M | |

### Bugs and gaps found by programs

| id | item | source | pri | size | status |
|---|---|---|---|---|---|
| C40 | Compiled JS for operations answered later (L54/L71): steps 1, 2a to 2d done (#571 to #573), 2e a search whose own definitions wait (C40e). The world answering main's own waits (`start timer`, `await` of a ticket or of `any of(…)`) done (#958: the runtime's `$main`, sleeping on the world's clock or, in a world that can't sleep, a promise). Next: a page that waits (page-runtime.ts; the evaluator's browser world can't wait either, and a page's event handler that waits is first a design question: what the page shows meanwhile), and a waiting search that folds over a list now passes its waits on (step 2f, it gave wrong answers before); a function that waits and chooses, given to the library (`map`, `keep`), now compiles (step 2g); a fold whose step waits now compiles (step 2h); a wait inside a list being built, a search through a function given on, and map or sum of a waiting function were checked and compile. Left: a page that waits, designed in [PAGE-WAITS-2026-11-03](docs/design/targets/PAGE-WAITS-2026-11-03.md) (what the page shows meanwhile and what a second event does are Ersagun's call; recommended: each stretch between waits lands, and events take turns at their waits) | LANGUAGE-NEEDS-2026-10-24 | P2 | M | step 2 done |

### Speed of compiled code

| id | item | source | pri | size | status |
|---|---|---|---|---|---|
| C93 | Lists read and written by position stay cons lists: machine's registers, memory, code and counts are walked at every step (primes 20000: compiled 47.9 s, ideal 43 ms, 1100×; sort 1000 183×; collatz 7×). Step 1 done: machine's lists are trees, beside its Map and Set hash tables in JavaScript (compiled primes 20000 47.9 → 0.47 s; `lab native` sort 1000 30.4 → 2.2 s, primes 20000 about 36 → 0.47 s). Step 2 done: a definition recurring through a stored list's match, not in a tail call, ran out of stack in compiled JS past a few thousand items (it called itself through the case's function); the match is now put in place. Step 3 done: the WebAssembly the round measures stores lists as trees too (primes 5000 5.3 s → 58 ms, sort 400 5.3 → 0.16 s). Step (c) done: `array of List` replaces in one step (in place in C with one holder). Left: machine still picks trees, because it also builds onto a match's rest and appends, n each on an array (its appends are in the assembler, not the step loop, but one choice is made per type for the whole program, so a choice per value is what's missing); a row that does both in log n and reads in 1, or arrays that share a rest, would take primes 20000 to about 0.11 s (measured by hand-editing the output). Part of C30 | [GAPS round 9](docs/reports/GAPS.md#round-9-machine-an-assembler-and-interpreter-on-every-target-2026-11-02) M1 | P3 | L | |
| C86 | A write of a whole new value wakes every reader of the cell: board's running frame changes one card's time, and the three columns' formulas, their rows' matching, the counts, the tags and the history all run again (1.8 ms a frame at 1,000 cards, about 20 ms at 10,000, against the ideal's 0.01 and 0.9); an add the same (3.6 ms at 1,000, ideal 0.01). C86a done (#1048): the old and new values are compared once, skipping what they share, and only path and view readers of the places that differ wake (frame 1.97 → 1.59 ms at 1,000 cards). Left: board's readers read the whole state (`read(stc).board.cards`), so they still all wake. L160's paths are there, but either board's views read by path or a plain `read` inside a formula gives a tracked view (L99's, today only each's rows), which changes what every reader sees: a design call (checked 2026-11-02). Designed in [CELL-READERS-2026-11-03](docs/design/data/CELL-READERS-2026-11-03.md): a plain read inside a view or formula as a tracked view, which can't change what it sees (no Update there); next C86b in cells.ts, measured on bench-board. Prior art: Solid's `reconcile`. With L160 | [GAPS round 8](docs/reports/GAPS.md#round-8-board-a-page-written-in-the-editor-2026-11-02) B2 | P2 | L | |
| C67 | **A faster compiler** (Ersagun 2026-10-31: "make the compiler faster"). The editor's compiled swap takes 2 to 7 s. Benchmarks: compiling Bounce, Spacetime and Constructions to JS (main). Before: 6.1, 5.9 and 1.9 s; most of it is the program checked again after staging, over the whole library. Done: C67a, only what the exports reach is compiled (3.5, 4.4, 1.0 s); C67b, ids from a pool of random bytes (3.0, 4.2, 0.8 s); C67c, effect-row chains flattened as they are walked (2.9, 2.7, 0.8 s). Stopped there (2026-10-31): no single function is over 0.5 s now. The largest part left is staging's two whole-program checks (about 1 s of Spacetime's 2.7 s). C67d would check the middle one only on the definitions staging changed (infer's `reuse`, as the palette does), which saves about 10% at best and must merge type info from two checks: not worth it yet. Measured again 2026-11-01 (a busy machine): 3.5, 3.3 and 2.8 s, since L125b's check of which calls always answer cloned the whole substitution for each builtin call it looked at; C67e reads a builtin's own type once instead (2.2, 2.4, 1.8 s). C67f made the check itself about twice as fast (Constructions' infer 660 → 350 ms): a pinned definition is checked on a trial over the substitution, not a copy of it; each definition with results is asked its direction on the program's own modes analysis plus the few new nodes; signs reads each input once (1.6, 2.6, 1.5 s). What is left is the modes analysis itself and staging's own work (evaluating at compile time). The rule was to stop when a step buys less than 10%. C67g (#1062): cut to what the exports reach before hoisting, sheet 1.1 → 0.6 s; C67h: staging's scopes chained, not copied (Bounce, Spacetime, Constructions 2.4, 2.7, 2.6 → 2.1, 2.3, 2.4 s); C67i: one modes analyzer for every solve (2.0, 2.4, 2.5 s), under 10%, so stopped again | Ersagun | P3 | M | C67g done |
| C30 | Lists as arrays. Done so far: P4a, #555, #558, #561 (pedal 2.9×). The split, join and block-in-array stages pay only together (~25% more); do them as one stage when another program needs lists as arrays. The aim: an `array` representation written in the language (REPRESENTATIONS.md), so WASM, C and the editor get it too. C30d (2026-10-31): Ersagun's two-ended array list; JS runtime views (C30d1, #734), the ends and `array of List` (#737), the ends in WebAssembly and C (C30d2, #754), the evaluator's arrays on the same buffer (C30d3a, #762; Ersagun chose "everywhere" 2026-10-31), the preview's chooser picking `array of List` from use (C30d3b), and the compiled targets taking the same choice (C30d3c: WebAssembly and C lower `first of array if any`). Next: the split, join and block-in-array stages, when a program needs them | GAPS.md round 4 P4 | P2 | L | |
| C68 | Tuples passed and returned as separate values on every target (WebAssembly multi-value, a struct or out-pointers in C), generalising C31 ([PORTS-2026-11-01.md](docs/design/relations-and-effects/PORTS-2026-11-01.md) §6) | Ersagun 2026-11-01 19:27 | P3 | M | after L128 |
| C64 | Handlers the compiler can see: Pig's `quietly` and `hold at` sit right around `play`. Done: C64a (#759, quiet cases skip the hiding, 330 → 270 ms) and C64b (#787, handlers written into the code they handle, 270 → about 95 ms). C64c (a case written in as a condition is a plain JS condition, about 110 → 77 ms today; earlier numbers were on a busier machine). C64d (Random that nothing in the program handles is drawn from the world straight away, `$random()`: Pig's 20,000 games about 60 → 42 ms, best of 15). Left: nothing measured; the same for Time's `now` if a program shows it | examples/pig | P3 | M | |

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
| C143 | A stop in compiled code names the node it came from: compiled JS, WebAssembly and C carry each node's id where they can stop (Abort, overflow, no answer, a hole), so `lab run` of compiled code and a page print it and the editor selects it (source maps, influence) | [ASPECTS-2026-11-03b](docs/reports/reviews/ASPECTS-2026-11-03b.md) 269 | P3 | M | |
| C150 | Words as machine words (L193): Word8 to Word64 compiled to u8/u16/u32/u64 (WASM i32/i64, C's uint8_t to uint64_t, JS numbers with `>>> 0` or BigInt.asUintN) instead of an Int record wrapped by `bits and`; (and, or, xor since C150a, shifted down since C150b: on Int, so each op on a word still wraps by an and). Measured on words.test.ts's FNV-1a and xorshift. Design C150c ([MACHINE-WORDS-2026-11-03](docs/design/numbers/MACHINE-WORDS-2026-11-03.md)): the compiler proves an Int fits a word; next C150d known bits of an Int on the core IR, C150e a field that fits stored as a word, C150f the mask after an op as the wrapping op, C150g compare/show and the 10 ms gate | L193 | P3 | M | |
| C160 | Tensors on WASM and C: the two-layer network of ters/test/tensor-network.test.ts (L51d; `contracted`, Tensor's + item by item, `tensor map`, `stop with` on a shape mismatch) runs on the core IR JS, WASM and C and gives the same items | L51d | P2 | M | |

## L: Language and library

Numbers first (Ersagun, 2026-10-24 07:01), then the rest of
LANGUAGE-REVIEW-2026-10-24. Anything that only adds a target ranks below
all of these.

### Foundations ([FOUNDATIONS-2026-11-03](docs/reports/reviews/FOUNDATIONS-2026-11-03.md), in fix order)

| id | item | source | pri | size | status |
|---|---|---|---|---|---|
| L211 | A use gives its produced ports as a tuple (decided in L179, PORTS-2026-11-01.md §3 "Decided (L179)"). Step a done: a use with no body is read at load (ports.ts `fillUses`, from `base` and `fromFile`) as the use binding each produced port with their tuple as its body, so every engine runs it. Step b done: the model's `binds` and `body` are optional, read through model.ts `bindsOf`/`bodyOf` (compiler/src/uses.ts since C158, the editor since E240). Step c done: the checker types a use with no body as its produced port or their tuple (infer.ts `useResult`), each port typed where a binder would be, with Choice as before. Step d done: the evaluator runs one (run.ts, ports.ts `answerKeys`; the passes on its way read model.ts `useKids`). Left: modes.ts and relate.ts (a use inside a relation), derive.ts, the renderers and the compilers run it; saved uses move with a `SHAPE_STEPS` entry (a body becomes a let of the tuple) and `binds`/`body` leave the node. The editor lane draws the produced ports as outputs | L179 | P2 | L | |
| L182 | Flags as hidden kinds: every new node attribute goes through L178's schema; as L128d and L130 land, `def.results`, `def.direction` and `field.results/ports` become ports on the definition's type | [FOUNDATIONS-2026-11-03](docs/reports/reviews/FOUNDATIONS-2026-11-03.md) §8 | P3 | M | |
| L215 | Check per definition group, cached ([CHECK-BY-GROUP-2026-11-03.md](docs/design/tools/CHECK-BY-GROUP-2026-11-03.md)), one PR each: (a) closed group results keyed by the group's hashes, its dependencies' schemes, the implementations it needs and the options, with a randomized cache-against-scratch test; (b) a `Checker` cache on the editor's edit path, timed on I157, I158 and a one-character edit in Constructions; (c) typedef groups, units, modes in the cache; (d) `reuse` removed | L183, FOUNDATIONS-2026-11-03 §9 | P3 | L | design done |
| L217 | Resolve the library's arithmetic once per process: `makeRunner`'s `resolveArithmetic` walks the library again for every new program (2,999 calls, about 300 s in the unit tests) | [TEST-SPEED-2026-11-03](docs/reports/TEST-SPEED-2026-11-03.md) | P2 | S | |

### Bugs and gaps found by programs

| id | item | source | pri | size | status |
|---|---|---|---|---|---|
| L173b | The rest of REVIEW-2026-11-02d §5, which `lab mcp` couldn't write: machine's `args mapped` as `fields mapped(instruction, f)` is refused because a replaced body loses the parameter's type (the text has no way to say `instruction : Instr`), and board's `card of` as `first where(cards, (c) => c.id = id)` because `c.id` picks among Edit's, Timer's and Card's `id` (E213). Also `zeros` as `copies(count, 0)` turns its type into a generic Number list (L175's question). Needs a parameter's type written in the text, or the editor | [REVIEW-2026-11-02d](docs/reports/reviews/REVIEW-2026-11-02d.md) §5, L173 | P3 | S | |
| L143 | A tuple shows as `tuple(1, "a")` while its type shows `(Int, Text)`: show done (L143a, #1000); left: the text view's literal as `(1, "a")`, which waits on the editor's reader (Editor lane) | [REVIEW-2026-11-01b](docs/reports/reviews/REVIEW-2026-11-01b.md) §8 | P3 | S | |
| L29 | Function variables' rows checked in any order (the closing use should win either way). The other half, `inverse(f, …)` typed from f at the call, is done (#701). Tried 2026-11-01: letting an open row be taken in by a closed one where `opened` copies it broke three effects tests (a handler's row then leaks outward), so it needs two passes: rows settled after every use is seen | L14 | P3 | M | needs two passes |

### Ersagun's current asks

| id | item | source | pri | size | status |
|---|---|---|---|---|---|
| L107 | **Open question, not decided** (Ersagun 2026-10-30: "I didn't ask to lift strict positivity BTW, I'm not sure if we should lift that"): drop strict positivity, so a data type may take itself as a function's input in its fields (`knot = wrap(f: knot → Float64)`), with taking one apart carrying Diverge so a function without Diverge still always finishes. Recursive data types themselves (a type holding itself, directly or through others) are allowed and always were; TUTORIAL.md §3.8 says so. If decided yes: LANGUAGE.md "Two rules", TUTORIAL.md §3.8 and the guarantees test | Ersagun 2026-10-30 | P3 | S | open question |
| L108 | Representations written in the language (REPRESENTATIONS.md). L108a to L108c done: a representation is a definition, the compiler chooses, no explicit selection (#679 to #682). L108d laws done (`lab test` checks each job through its meaning, match and fold too, L108d2). Left: the editor half, E159 | Ersagun 2026-10-30 | P2 | M | 4 of 4 steps; E159 left |
| T7 | Tests in the language ([TESTS-IN-THE-LANGUAGE.md](docs/design/testing/TESTS-IN-THE-LANGUAGE.md)): T7a `Check`, small values and `lab test` done; T7b accepted answers in examples.json done; T7c results cached by hash: local done (`.lab/checks.json`), CI's cache left (T, S); T7d the editor's tick, difference and accept button done (#829); T7e example sweeps moved to answers and laws, `--compiled` (T, M). Unblocks L108d, L97e | TESTING.md T7 | P2 | L | design, T7a and T7b done |

### Numbers (NUMBERS.md)

| id | item | source | pri | size | status |
|---|---|---|---|---|---|
| L203 | Grade masks for any library: grades.ts reads which parts can be nonzero from the table and the code, not from the prelude's `clifford …` names and std's `Algebra` constructor (the only compiled-speed gap L202 measured). Step a done: a copy of the prelude's definitions is known by its meaning's hash. Left: the general reading, for a library of its own | [MATHEMATICS-AS-LIBRARIES](docs/design/numbers/MATHEMATICS-AS-LIBRARIES-2026-11-03.md) | P2 | M | |
| L204 | Number types by interface only. Step a done: a library type's + − · < wait for the lookup exactly when the library has an implementation for it (types.ts `Subst.waits`, from the layer under, L216), so `IMPLEMENTED` and `WORD_TYPES` went and a type without one is still told at the use. Left: types.ts `requireArith`, infer.ts `isNumberType`, arith.ts `DATA_NUMBERS` and the per-type literal constructors become Arithmetic, Ordered and a literal interface ("from a fraction", INTERFACES.md); `std.` types stop skipping the lookup; `MATRIX_SIZE` goes; Rational's and Algebraic's ordering in run.ts and compile.ts goes through Ordered | [MATHEMATICS-AS-LIBRARIES](docs/design/numbers/MATHEMATICS-AS-LIBRARIES-2026-11-03.md) | P2 | L | |
| L205 | Showing by interface: L205a done (std's `Shown` interface, the prelude's Rational, Complex and Fixed implement it, and `show any` in the evaluator shows a value of a type with one through it, so a type of the program's own shows its own way). L205b done (a search's `show any` shows the same way, relate.ts given the runner's resolver). Left: the editor's chips pass a resolver (Editor lane; run.ts would export one made from a program's check), then run.ts `showValue`'s Rational, Complex and Fixed branches go; compiled code done (C148) | [MATHEMATICS-AS-LIBRARIES](docs/design/numbers/MATHEMATICS-AS-LIBRARIES-2026-11-03.md) | P2 | M | steps a, b done |
| L206 | The evaluator's speed without jets by hash: stage known-data calls in the evaluator (stage.ts) or let a library declare its host implementation beside the definition; retire jets.ts's list. Measured by L202 | [MATHEMATICS-AS-LIBRARIES](docs/design/numbers/MATHEMATICS-AS-LIBRARIES-2026-11-03.md) | P3 | M | |
| L207 | The number types leave std.ts for a published `numbers` module written in the language (Rational, Complex, Dual, Fixed, Mat2 to Mat4, Matrix, Algebra, Table entry, Trig, Extended), ids kept for saved programs (L184). After L204 and L205. Algebraic stays host code, registered by the module | [MATHEMATICS-AS-LIBRARIES](docs/design/numbers/MATHEMATICS-AS-LIBRARIES-2026-11-03.md) | P3 | L | |
| L208 | Generalization as a feature (Ersagun 2026-11-03 09:38): an embedding is a representation whose meaning keeps the operations; the checker inserts only canonical (unique) ones and the rest are named; two canonical paths must agree; laws checked (T7). Step a done: design note EMBEDDINGS.md (a std `Embedding a b` record; only the canonical one per pair inserted, where both types are known; two paths must agree or a direct one is declared). Left: b the record and its laws checked, c the checker inserts it (and lifts the smaller side of + − · <), d the diamond rule, e literals as the embedding from Int (with L204), f the compiler keeps a value in the image as the small type (C lane, after L43c); the editor showing an inserted one is asked of Ersagun first | [EMBEDDINGS](docs/design/numbers/EMBEDDINGS.md) | P2 | L | |
| L209 | Values stored in the smallest structure they stay in, chosen by the compiler through embeddings: a Complex with no imaginary part as a Float64, a multivector that stays a rotor as a quaternion. Generalizes L203's grade masks. After L208 | [MATHEMATICS-AS-LIBRARIES](docs/design/numbers/MATHEMATICS-AS-LIBRARIES-2026-11-03.md) | P3 | L | |
| L210 | A number type for programs that need the same bits on every machine (lockstep games, multiplayer; SPEC §3.2): a Float64 whose sin, cos, exp, log, pow are written in Ters (fdlibm's algorithms) in the library, carried only by programs that use it; lockstep's Fixed is the other way | Ersagun 2026-11-03 (C141) | P3 | M | |
| L44 | Linear maps, geometry and matrices ([MATRICES.md](docs/design/numbers/MATRICES.md), Ersagun 2026-10-31): `Mat2` to `Mat4` done (L44a). Rotors, reflections, projections and PGA motions from the Clifford tables done (L44b); reading a function's matrix done (L44c, src/lang/linear.ts). A `Matrix a` of any size with products, sums and `solved` done (L44d); `determinant` and `inverted` done (L44e); `least squares` done (L44f). Next: the compiler stores linear functions as matrices (C lane, C30b/c); LU kept for many right-hand sides when a program needs it | LANGUAGE-REVIEW-2026-10-24 | P1 | M | steps 1-3 started |
| L43 | Rotors done (L43a: quaternions as the even part of `Cl(3, 0)`). Next, which parts can be nonzero ([GRADES.md](docs/design/numbers/GRADES.md)): L43b blade masks done (src/lang/grades.ts); L43c compiled JS and WGSL store only the masked parts, with L41 (C, M; done: the algebra's mask tables come from its blades, 14 s to 0.2 s on Spacetime, #942; staging multiplies only the masked parts of a definition's inputs, worked out from its callers, #952, and in shaders, #961; next: storing only those parts, and the copies staging makes); L43d the editor names a value's mask done (#831); L43e masks are types, a wrong grade is a type error (done: a part read outside the mask; named masks on record fields, `Vector of T` and the others, and on lists' items (L43e3); next: where the editor names an input's type) (Ersagun 2026-10-31: "each blade combination a different type") (L, M). Bounce passes vectors, spins and rotors as one 8-part type | NUMBERS.md stage 4, [CLIFFORD-DEMOS](docs/reports/CLIFFORD-DEMOS-2026-10-31.md) B3 | P1 | L | rotors and masks done |
| L118 | A faster evaluator ([EVALUATOR-SPEED-2026-10-31.md](docs/reports/EVALUATOR-SPEED-2026-10-31.md)): profile, one hotspot per PR, stop when the next buys <10%. L118a the table product as a jet done (Spacetime's charge path 8.3 s → 0.48 s, Bounce's step 14 → 3.7 ms). L118b, the machine's own hotspots, measured below the noise and stopped. Stopped here (Ersagun 2026-10-31 21:12); L118c is its own row below | Ersagun 2026-10-31 | P1 | M | done for now |
| L118c | The evaluator compiles each definition to JavaScript closures once (closure compilation, Feeley and Lapalme 1987), keeping the heap continuation only where a search or a handler needs it; likely 3-10x on all interpreted code; notebook's Run takes 3.2 s for 100 notes, half of it the evaluator's own machine (GAPS.md round 6 N6) ([EVALUATOR-SPEED-2026-10-31.md](docs/reports/EVALUATOR-SPEED-2026-10-31.md) step 2). For later: Ersagun stopped L118 after step 2 | Ersagun 2026-10-31 | P3 | L | for later |
| L97 | `polar` as the relation behind Trig (POLAR.md): L97a to L97c4 done (Trig's polar, unpolar, asin, acos; polar given x, y answered by unpolar). L97e complex laws done (prelude tests). L97d done: Fixed's polar is CORDIC's rotation, its sin and cos come from it. C55 closed: a solve the relational interpreter would run, binding one result, is a call for that result alone (C55a): Fixed's polar given the angle and binding y alone compiles to `fixed_polar_s_y` only (checked 2026-11-02) | Ersagun 2026-10-28 | P2 | M | done |
| L96 | Several ways to compute one operation, the compiler choosing by cost (WAYS.md): L96a to L96c done; L96d the ways' agreement checked as laws done. Left: the editor shows the pick per field (WAYS.md step 5, Editor lane) | Ersagun 2026-10-28 | P2 | L | 4 of 5 steps |
| L88 | Exact reals (EXACT-REALS.md): `Algebraic` done (L88a to L88d, √2·√2 is the Int 2). Next: step 4, `Real` as lazy intervals, when a program needs π exactly | Ersagun 2026-10-26 | P2 | L | 3 of 4 steps |
| L125 | Which IEEE float values the language keeps ([FLOAT-VALUES-2026-11-01.md](docs/design/numbers/FLOAT-VALUES-2026-11-01.md)): `Float64` as the finite floats with one zero, ±∞ as an ordinary `Extended a`, NaN only as how "no answer" is stored. **Decided 2026-11-01** (Ersagun: finite `Float64` yes; `x / 0` no answer). Steps: L125a the meaning (overflow aborts; `/ sqrt log asin acos ^` get `Choice` at bad arguments; −0 canonical in `show`, `atan2`, `sign`) (L, M); L125b the inferred nonzero/nonnegative fact that drops the check (L, M); L125c compiled checks on JS, WASM, C, staging's folds as laws, #834 closed (C, M); L125d `Extended a` in the library (L, S), shown and typed as ±∞ in the editor (#865); L125e niche representations, `Optional Float64` and `Extended Float64` in one f64 (C, M), done in WebAssembly and C (compiled JavaScript keeps them as data); L125f host floats checked on entry (L, S) | Ersagun 2026-11-01 | P1 | L | decided; L125a step 1 done (the evaluator stops on a non-finite answer, with the reason); L125d and L125f done; L125b done (no answer is a `Choice` in the evaluator; a view with none shows nothing); L125c1 done (compiled JS stops the same), L125c2 done (WASM and C); L125c3 done (compiled JavaScript gives no answer too, as WebAssembly and C already did; plain scalar code with no Choice still stops); L125e done |
| L89 | Fixed point for games (FIXED-POINT.md): `Fixed`, exact show, CORDIC trig and examples/lockstep done (L89a to L89d). Left: i64 on WASM and C (lane C) | Ersagun 2026-10-26 | P3 | M | 3 of 4 steps |

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
| L54 | Operations answered later, at most once (ANSWERED-LATER.md): step 1 done (L54a); compiled side is C40 | EFFECTS-REVIEW §1.5, §5 | P1 | L | step 1 done |
| L59 | A page's fetch and wait resume instead of re-running the handler; `Wait` folds into `Time`. L59a done (the evaluator's page: a handler goes on from its fetch). Left: L59b `wait` in a page handler parks on a timer the same way, and `Wait` folds into `Time` (a view's row still leaves the clock's waiting out); L59c the fetch memo scoped to one search and one event, not the page (§1.2); compiled JS's page resumes (C40). L59b waits for C40: a compiled page would stop at a wait the evaluator's page lets through | EFFECTS-REVIEW §1.1-1.3 | P1 | M | step a done |
| L69 | Foreign definitions ([FOREIGN.md](docs/design/targets/FOREIGN.md)): a program's own effect answered by a host file per target. L69a `hosts/js.js` in the evaluator and compiled JS, results checked at the border, `lab hosts` skeleton (L, M): done (evaluator; compiled JS, L69a2; a page's build-web and build-app, L69a3; asking a host from a page's view or handler is refused, as only the page's effects are allowed there); L69b C and WebAssembly (C, M); L69c the editor's "needs its host" (E, S), done (#860); L69d optional, std's world operations as host files (L, M). Asks Ersagun: may a foreign operation be declared pure | LANGUAGE-NEEDS §5 | P2 | M | design done |

### Relations and totality (BACKWARDS.md, MODES.md)

| id | item | source | pri | size | status |
|---|---|---|---|---|---|
| I84 | Bounce's `bump pairs` is inferred Diverge: it recurses on a list it gets back inside a Pair, which the checker can't see is shorter. Needs a size analysis that follows a list through a record's fields (sized types), not a tweak to the structural check | [CLIFFORD-DEMOS](docs/reports/CLIFFORD-DEMOS-2026-10-31.md) B7 | P3 | L | needs sizes |
| L46b | Raymarch's `march` and `shadow` count steps in an Int and `colour` drops `with fuel` (bounded counting is total since L46). Waits on Int in the scalar profile outside shaders (C66's WebAssembly int32 step; plain JS and C too), or the editor's CPU-side pictures and the scalar tests refuse it | L46 | P3 | S | |

### Grammars, modules and sharing

| id | item | source | pri | size | status |
|---|---|---|---|---|---|
| C110 | A grammar's backward mode compiled to recursive descent when it is LL(1), from COMPILER.md's planned mode analysis (GRAMMARS-2026-11-02 step 4) | L70 | P3 | L | after L70b |
| L72 | Grammars and their machines (Chomsky hierarchy) as ordinary data, parsing and printing one relation run both ways; extends L70 | Ersagun 2026-10-24 | P3 | L | low priority |
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
| L16 | Guarded corecursion, and a stateful handler form so programs write their own Cells. The stateful handler is done (L16a: std `State` with `with state` written in the prelude); left: guarded corecursion | ROADMAP 4 | P3 | L | step a done |
| L22 | Profiles inferred like effects and shown in the editor ("runs on the GPU") | REVIEW-2026-10-22b §5 | P3 | L | |
| L24 | Research as it becomes blocking: costs from folds, laws proved by fusion, fast invertible parsing | ROADMAP 8 | P3 | L | |

### Blind spots ([BLIND-SPOTS-2026-11-03](docs/reports/reviews/BLIND-SPOTS-2026-11-03.md))

| id | item | source | pri | size | status |
|---|---|---|---|---|---|
| L214 | Text as decided in [TEXT-2026-11-03.md](docs/design/data/TEXT-2026-11-03.md) (L185), one PR each: (a) done: NFC where text enters (read input, read line, read file, list folder, fetch text, start fetch, a page's field) in the evaluator, compiled JS and WASM's host, and `normalized`; stored literals are E239 and C's host C151; (b) `Locale`, `uppercase`/`lowercase` taking it, `my locale` as a world effect, today's A-to-Z ones renamed `ascii …`; (c) `graphemes`, `grapheme count`; (d) `collated(locale)` | L185, BLIND-SPOTS-2026-11-03 §4 | P3 | M | decided |
| L187 | Error messages as one table (id, message, usual fix, the gesture that fixes it) with a smallest program per problem as its test | [BLIND-SPOTS-2026-11-03](docs/reports/reviews/BLIND-SPOTS-2026-11-03.md) §8 | P3 | M | |
| L188 | Dates and times: Instant, calendar Date, Duration (on units.ts), time zone; now and the local zone as world effects (java.time, Temporal, influence) | [BLIND-SPOTS-2026-11-03](docs/reports/reviews/BLIND-SPOTS-2026-11-03.md) §9 | P3 | M | |

### What a good language needs ([ASPECTS-2026-11-03](docs/reports/reviews/ASPECTS-2026-11-03.md))

| id | item | source | pri | size | status |
|---|---|---|---|---|---|
| L189 | `Bytes`: a byte sequence, meaning a list of Ints 0 to 255, stored as a buffer by the representation layer; Files and Network read and write it. Audio files, images, binary formats, hashes and WASM/C buffers need it; today there is only Text | [ASPECTS-2026-11-03](docs/reports/reviews/ASPECTS-2026-11-03.md) 153, 164, 290 | P2 | M | |
| L190 | JSON (then CSV) as a grammar run both ways (L70): one definition parses and prints, typed to the program's own records; websites and apps talk JSON | [ASPECTS-2026-11-03](docs/reports/reviews/ASPECTS-2026-11-03.md) 63, 166 | P2 | M | |
| L191 | Network beyond `fetch text`: a request with method, headers and body, a response with status, headers and body (Text or L189's Bytes), as Network operations answered by the world or a test's handler | [ASPECTS-2026-11-03](docs/reports/reviews/ASPECTS-2026-11-03.md) 162 | P2 | M | |
| L213 | Resources as handlers ([RESOURCES-2026-11-03.md](docs/design/relations-and-effects/RESOURCES-2026-11-03.md)): (a) a handler's release case, run once on every exit (normal, Abort, the uncatchable stop, fuel); (b) handler names (`with open file(p) as source`), operations given one, escaping refused as a scope error; (c) the first resource, `with open file` with `read line`, `write line`; (d) LANGUAGE.md's error row becomes checked | L192 | P3 | M | design done |

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
| T14 | The single slow tests left after L216: Tumble's clear backwards 74 s, tree of List 50 s, every builtin backwards 103 s, core-js examples and pages 116 s, editing's swapAndUndo 43 s. Each becomes a sweep or gets a smaller input, toward 5 s a file | [TEST-SPEED-2026-11-03](docs/reports/TEST-SPEED-2026-11-03.md) | P3 | M | |

## Coordinator and process

Not lane work; the coordinator does these or asks Ersagun.

| id | item | source | pri | status |
|---|---|---|---|---|
| P1 | PRs #43 and #44, open since 2026-10-22, likely superseded by #49: close or land | REVIEW-2026-10-22b §8 | P2 | |
| P2 | Batch deploys if Actions cost needs it | Ersagun 2026-10-23 | P3 | asked, not requested |
| P3 | A per-repo Actions budget, or a public repo for free Actions | thread "GitHub Actions cost" | P3 | Ersagun's call |
| P4 | Lanes' squash merges carry every commit message of their long-lived branch (#952's lists C52, C30, C40 2a to 2d, C65, C66a to C66c3, I79 … before its own): squash with the PR's own title and summary only | [REVIEW-2026-11-01b](docs/reports/reviews/REVIEW-2026-11-01b.md) §8 | P3 | |
| P7 | A foundation row every fourth item in each lane; the weekly review tracks kind tests across the code (2,805), tests reached by a one-line text.ts edit (145/150 + 44/44) and readers of a kind's fields | [FOUNDATIONS-2026-11-03](docs/reports/reviews/FOUNDATIONS-2026-11-03.md) §10 | P2 | |
| P8 | Add a LICENSE (and say what examples and programs written in Ters carry) once Ersagun picks one | [BLIND-SPOTS-2026-11-03](docs/reports/reviews/BLIND-SPOTS-2026-11-03.md) §3 | P1 | Ersagun's call |
